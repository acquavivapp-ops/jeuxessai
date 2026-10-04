#!/usr/bin/env python3
"""Archive detailed IGN BD ORTHO imagery and publish a local, bounded tile atlas.

Explicit --download fetches genuine WMS JPEGs at about 0.5 metres per pixel.
--detail --download adds genuine 0.25-metre exports for the urban/airport
regions while retaining the complete municipal half-metre grid unchanged.
Original 2048-pixel responses are retained; runtime crops are at most 1024 pixels
and contain no resized or generated detail. Pillow is needed only for this
developer import. The game loads local JPEGs and never requests imagery from IGN.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime as dt
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import urllib.parse

SPEC = importlib.util.spec_from_file_location('imagery_import', Path(__file__).with_name('import-imagery.py'))
IMAGERY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMAGERY)
ROOT = Path(__file__).resolve().parents[1]
MAX_RUNTIME_DECODE_BYTES = 4 * 1024 * 1024
MAX_SOURCE_DECODE_BYTES = 16 * 1024 * 1024
# Real-map rectangles; quarter-metre exports are restricted to developed Calvi
# and the airport rather than multiplying rural texture storage everywhere.
DETAIL_REGIONS = (
    {'id': 'urban', 'boundsWorld': {'x': 11000, 'y': 4500, 'w': 15500, 'h': 15500}},
    {'id': 'airport', 'boundsWorld': {'x': 21000, 'y': 20000, 'w': 13500, 'h': 10500}},
)


def atomic_write(path, blob):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.' + path.name + '-', delete=False) as stream:
            stream.write(blob)
            temporary = Path(stream.name)
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def world_bounds(bounds, rect, world_width, world_height):
    west, south, east, north = (bounds[k] for k in ('west', 'south', 'east', 'north'))
    return {'west': west + rect['x'] / world_width * (east - west),
        'south': north - (rect['y'] + rect['h']) / world_height * (north - south),
        'east': west + (rect['x'] + rect['w']) / world_width * (east - west),
        'north': north - rect['y'] / world_height * (north - south)}


def build_plan(mapdata, target_mpp=.5, tile_size=1024, source_tile_size=2048):
    if not isinstance(target_mpp, (int, float)) or not math.isfinite(target_mpp) or not .2 <= target_mpp <= 4:
        raise ValueError('Imagery sampling must be 0.2..4 metres per pixel')
    if tile_size not in (256, 512, 1024) or source_tile_size not in (1024, 2048) or source_tile_size % tile_size:
        raise ValueError('Runtime tiles must be 256/512/1024 pixels and divide 1024/2048 source tiles')
    bounds = mapdata['metadata']['bounds']
    width, height = mapdata['width'], mapdata['height']
    ppm = mapdata['metadata'].get('pixelsPerMetre')
    if not isinstance(ppm, (int, float)) or not math.isfinite(ppm) or ppm <= 0:
        raise ValueError('The map must declare its physical pixels per metre')
    image_width, image_height = math.ceil(width / ppm / target_mpp), math.ceil(height / ppm / target_mpp)
    if image_width * image_height > 400_000_000:
        raise ValueError('The proposed atlas exceeds 400 million source pixels')
    plan = {'status': 'planned', 'version': 1, 'kind': 'aerial-orthophotography-tile-atlas',
        'provider': 'IGN GeoPlateforme', 'product': 'BD ORTHO', 'layer': IMAGERY.LAYER,
        'boundsWGS84': dict(bounds), 'worldWidth': width, 'worldHeight': height,
        'image': {'width': image_width, 'height': image_height},
        'metresPerPixel': {'x': width / ppm / image_width, 'y': height / ppm / image_height},
        'requestedMetresPerPixel': target_mpp, 'runtimeTileSize': tile_size, 'sourceTileSize': source_tile_size,
        'georeferencing': {'crs': 'EPSG:4326', 'wmsVersion': '1.3.0', 'bboxAxisOrder': 'latitude,longitude',
            'imageAxes': 'right=east, down=south', 'worldWidth': width, 'worldHeight': height,
            'imageToWorld': 'x=u*worldWidth/imageWidth; y=v*worldHeight/imageHeight',
            'vectorSourceSha256': mapdata['metadata'].get('sha256')},
        'attribution': '© IGN — BD ORTHO — Licence Ouverte / Open Licence',
        'captureDate': None, 'captureDateNote': 'Current WMS mosaic; local acquisition date has not been established',
        'tiles': [], 'sourceTiles': []}
    for size, field in ((source_tile_size, 'sourceTiles'), (tile_size, 'tiles')):
        for row, py in enumerate(range(0, image_height, size)):
            for col, px in enumerate(range(0, image_width, size)):
                tw, th = min(size, image_width - px), min(size, image_height - py)
                rect = {'x': px * width / image_width, 'y': py * height / image_height,
                    'w': tw * width / image_width, 'h': th * height / image_height}
                tile_bounds = world_bounds(bounds, rect, width, height)
                tile = {'id': f'c{col}-r{row}', 'column': col, 'row': row,
                    'width': tw, 'height': th, 'pixelRect': {'x': px, 'y': py, 'w': tw, 'h': th},
                    'boundsWorld': rect, 'boundsWGS84': tile_bounds}
                if field == 'sourceTiles':
                    tile.update(url=f'./assets/aerial/source-2048/calvi-c{col}-r{row}.jpg',
                        sourceUrl=IMAGERY.image_request(tile_bounds, tw, th))
                else:
                    source_col, source_row = px // source_tile_size, py // source_tile_size
                    tile.update(url=f'./assets/aerial/calvi-c{col}-r{row}.jpg',
                        sourceTileId=f'c{source_col}-r{source_row}',
                        sourceCrop={'x': px % source_tile_size, 'y': py % source_tile_size, 'w': tw, 'h': th})
                plan[field].append(tile)
    return plan


def build_detail_plan(mapdata, target_mpp=.25, regions=DETAIL_REGIONS):
    """A second authentic pixel grid; never replace or enlarge the base exports."""
    if not isinstance(target_mpp, (int, float)) or not math.isfinite(target_mpp) or not .2 <= target_mpp <= .5:
        raise ValueError('Detailed imagery sampling must be 0.2..0.5 metres per pixel')
    bounds = mapdata['metadata']['bounds']
    world_width, world_height = mapdata['width'], mapdata['height']
    ppm = mapdata['metadata'].get('pixelsPerMetre')
    if not isinstance(ppm, (int, float)) or not math.isfinite(ppm) or ppm <= 0:
        raise ValueError('The map must declare its physical pixels per metre')
    detail = {'detailRequestedMetresPerPixel': target_mpp,
        'detailMetresPerPixel': {'x': target_mpp, 'y': target_mpp},
        'detailRegions': [], 'detailTiles': [], 'detailSourceTiles': []}
    identifiers, total_pixels = set(), 0
    for region in regions:
        ident, rect = region.get('id'), region.get('boundsWorld')
        if not isinstance(ident, str) or not ident.isalnum() or ident in identifiers:
            raise ValueError('Detail regions need unique alphanumeric identities')
        identifiers.add(ident)
        if not isinstance(rect, dict) or any(not isinstance(rect.get(key), (int, float)) or not math.isfinite(rect[key]) for key in ('x', 'y', 'w', 'h')):
            raise ValueError('Detail region geometry must be finite')
        if rect['x'] < 0 or rect['y'] < 0 or rect['w'] <= 0 or rect['h'] <= 0 or rect['x'] + rect['w'] > world_width or rect['y'] + rect['h'] > world_height:
            raise ValueError('Detail regions must lie within the photographed map')
        for previous in detail['detailRegions']:
            old = previous['boundsWorld']
            if rect['x'] < old['x'] + old['w'] and rect['x'] + rect['w'] > old['x'] and rect['y'] < old['y'] + old['h'] and rect['y'] + rect['h'] > old['y']:
                raise ValueError('Detail regions cannot overlap')
        width, height = math.ceil(rect['w'] / ppm / target_mpp), math.ceil(rect['h'] / ppm / target_mpp)
        total_pixels += width * height
        if total_pixels > 400_000_000:
            raise ValueError('Detailed imagery exceeds 400 million source pixels')
        region_bounds = world_bounds(bounds, rect, world_width, world_height)
        detail['detailRegions'].append({'id': ident, 'boundsWorld': dict(rect),
            'boundsWGS84': region_bounds, 'image': {'width': width, 'height': height},
            'metresPerPixel': {'x': rect['w'] / ppm / width, 'y': rect['h'] / ppm / height}})
        for size, field in ((2048, 'detailSourceTiles'), (1024, 'detailTiles')):
            for row, py in enumerate(range(0, height, size)):
                for col, px in enumerate(range(0, width, size)):
                    tw, th = min(size, width - px), min(size, height - py)
                    tile_rect = {'x': rect['x'] + px * rect['w'] / width, 'y': rect['y'] + py * rect['h'] / height,
                        'w': tw * rect['w'] / width, 'h': th * rect['h'] / height}
                    tile_bounds = world_bounds(bounds, tile_rect, world_width, world_height)
                    tile = {'id': f'detail-{ident}-c{col}-r{row}', 'regionId': ident, 'column': col, 'row': row,
                        'width': tw, 'height': th, 'pixelRect': {'x': px, 'y': py, 'w': tw, 'h': th},
                        'boundsWorld': tile_rect, 'boundsWGS84': tile_bounds}
                    if field == 'detailSourceTiles':
                        tile.update(url=f'./assets/aerial/source-2048/calvi-detail-{ident}-c{col}-r{row}.jpg',
                            sourceUrl=IMAGERY.image_request(tile_bounds, tw, th))
                    else:
                        tile.update(url=f'./assets/aerial/calvi-detail-{ident}-c{col}-r{row}.jpg',
                            sourceTileId=f'detail-{ident}-c{px // 2048}-r{py // 2048}',
                            sourceCrop={'x': px % 2048, 'y': py % 2048, 'w': tw, 'h': th})
                    detail[field].append(tile)
    return detail


def validate_detail_manifest(manifest, mapdata):
    expected = build_detail_plan(mapdata, manifest.get('detailRequestedMetresPerPixel', .25))
    if manifest.get('detailRegions') != expected['detailRegions'] or not same_numbers(manifest.get('detailMetresPerPixel'), expected['detailMetresPerPixel'], ('x', 'y')):
        raise ValueError('Detailed imagery regions or sampling differ from the real map plan')
    for field in ('detailTiles', 'detailSourceTiles'):
        actual = manifest.get(field)
        if not isinstance(actual, list) or len(actual) != len(expected[field]):
            raise ValueError('Detailed imagery has missing geographic cells')
        by_id = {tile.get('id'): tile for tile in actual}
        if len(by_id) != len(actual):
            raise ValueError('Duplicate detail tile identities are refused')
        for wanted in expected[field]:
            tile = by_id.get(wanted['id'])
            keys = ('url', 'width', 'height', 'pixelRect', 'regionId', 'sourceUrl') if field == 'detailSourceTiles' else ('url', 'width', 'height', 'pixelRect', 'regionId', 'sourceTileId', 'sourceCrop')
            if not tile or any(tile.get(key) != wanted[key] for key in keys):
                raise ValueError('Detailed tiles must retain exact source URLs and unchanged pixel crops')
            if not same_numbers(tile.get('boundsWorld'), wanted['boundsWorld'], ('x', 'y', 'w', 'h')) or not same_numbers(tile.get('boundsWGS84'), wanted['boundsWGS84'], ('west', 'south', 'east', 'north')):
                raise ValueError('Detailed tile bounds differ from the requested real geography')
    return True


def same_numbers(actual, expected, fields):
    return isinstance(actual, dict) and all(isinstance(actual.get(k), (int, float)) and
        math.isfinite(actual[k]) and abs(actual[k] - expected[k]) <= max(1e-10, abs(expected[k]) * 1e-11) for k in fields)


def validate_manifest(manifest, mapdata):
    expected = build_plan(mapdata, manifest.get('requestedMetresPerPixel', .5),
        manifest.get('runtimeTileSize', 1024), manifest.get('sourceTileSize', 2048))
    if not same_numbers(manifest.get('boundsWGS84'), expected['boundsWGS84'], ('west', 'south', 'east', 'north')):
        raise ValueError('Atlas geographic bounds do not match the real map')
    if not same_numbers(manifest, expected, ('worldWidth', 'worldHeight')) or manifest.get('image') != expected['image']:
        raise ValueError('Atlas dimensions do not match the real map')
    geographic = manifest.get('georeferencing', {})
    if not isinstance(geographic, dict) or any(geographic.get(key) != value for key, value in expected['georeferencing'].items()):
        raise ValueError('Atlas projection and source map fingerprint do not match the real geography')
    if not same_numbers(manifest.get('metresPerPixel'), expected['metresPerPixel'], ('x', 'y')):
        raise ValueError('The reported sampling must match actual image and world dimensions')
    for field in ('sourceTiles', 'tiles'):
        actual = manifest.get(field)
        if not isinstance(actual, list) or len(actual) != len(expected[field]):
            raise ValueError('Atlas does not cover the complete source pixel grid')
        by_id = {tile.get('id'): tile for tile in actual}
        if len(by_id) != len(actual):
            raise ValueError('Duplicate tile identities are refused')
        for wanted in expected[field]:
            tile = by_id.get(wanted['id'])
            if not tile or any(tile.get(key) != wanted[key] for key in ('url', 'width', 'height', 'pixelRect')):
                raise ValueError('Tiles must use the complete planned local pixel grid; foreign URLs/paths are refused')
            if not same_numbers(tile.get('boundsWorld'), wanted['boundsWorld'], ('x', 'y', 'w', 'h')) or not same_numbers(tile.get('boundsWGS84'), wanted['boundsWGS84'], ('west', 'south', 'east', 'north')):
                raise ValueError('Tile bounds differ from the requested real geography')
            limit = MAX_SOURCE_DECODE_BYTES if field == 'sourceTiles' else MAX_RUNTIME_DECODE_BYTES
            if tile['width'] * tile['height'] * 4 > limit:
                raise ValueError('The tile exceeds the bounded decoding memory')
            if field == 'sourceTiles' and tile.get('sourceUrl') != wanted['sourceUrl']:
                raise ValueError('The original WMS request must match the geographic tile')
            if field == 'tiles' and any(tile.get(key) != wanted[key] for key in ('sourceTileId', 'sourceCrop')):
                raise ValueError('Runtime pixels must be a crop of their authentic source tile')
    if any(key in manifest for key in ('detailTiles', 'detailSourceTiles', 'detailRegions')):
        validate_detail_manifest(manifest, mapdata)
    if manifest.get('status') == 'ready':
        if not manifest.get('license', {}).get('identifier', '').startswith('Licence Ouverte'):
            raise ValueError('The ready atlas needs verified IGN open licence provenance')
        for tile in manifest['tiles'] + manifest['sourceTiles'] + manifest.get('detailTiles', []) + manifest.get('detailSourceTiles', []):
            if not isinstance(tile.get('byteLength'), int) or tile['byteLength'] <= 0 or not isinstance(tile.get('sha256'), str) or len(tile['sha256']) != 64:
                raise ValueError('Each ready tile needs its source fingerprint and actual byte count')
    return True


def validate_tile(blob, headers, tile, allow_uniform=False):
    width, height = tile['width'], tile['height']
    if not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0 or width * height * 4 > MAX_SOURCE_DECODE_BYTES:
        raise ValueError('Source tile dimensions exceed the 16 MiB decoding budget')
    if 'image/jpeg' not in (headers.get('contentType') or '').lower() or IMAGERY.image_dimensions(blob) != (width, height):
        raise ValueError('Expected a complete JPEG with the exact requested tile dimensions')
    from PIL import Image, ImageStat
    with Image.open(io.BytesIO(blob)) as image:
        image.load()
        if image.size != (width, height):
            raise ValueError('Decoded JPEG does not match its tile')
        stat = ImageStat.Stat(image.convert('RGB'))
        uniform = max(stat.stddev) < .8
        if uniform and (not allow_uniform or max(stat.mean) < 5 or min(stat.mean) > 250):
            raise ValueError('A blank response is refused; genuine uniform coastal water may be retained explicitly')
    return True


def local_file(url):
    if not url.startswith('./assets/aerial/') or '..' in Path(url).parts:
        raise ValueError('Only local atlas asset URLs are accepted')
    return ROOT / url[2:]


def load_source(source):
    path = local_file(source['url'])
    record_path = path.with_suffix('.json')
    if path.exists() and record_path.exists():
        record = json.loads(record_path.read_text())
        blob = path.read_bytes()
        if record.get('sourceUrl') == source['sourceUrl'] and record.get('sha256') == hashlib.sha256(blob).hexdigest():
            validate_tile(blob, record['responseHeaders'], source, allow_uniform=True)
            return blob, record
    blob, headers = IMAGERY.fetch(source['sourceUrl'])
    validate_tile(blob, headers, source, allow_uniform=True)
    record = {'sourceUrl': source['sourceUrl'], 'sha256': hashlib.sha256(blob).hexdigest(),
        'byteLength': len(blob), 'downloadedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'responseHeaders': headers, 'fullyDecodedDuringImport': True}
    atomic_write(path, blob)
    atomic_write(record_path, (json.dumps(record, ensure_ascii=False, indent=2) + '\n').encode())
    return blob, record


def crop_source(source, children):
    from PIL import Image, JpegImagePlugin, __version__ as pillow_version
    blob, record = load_source(source)
    source.update(record)
    runtime_bytes = 0
    with Image.open(io.BytesIO(blob)) as image:
        image.load()
        for tile in children:
            crop = tile['sourceCrop']
            cut = image.crop((crop['x'], crop['y'], crop['x'] + crop['w'], crop['y'] + crop['h']))
            encoded = io.BytesIO()
            cut.save(encoded, 'JPEG', quality=-1, qtables=image.quantization,
                subsampling=JpegImagePlugin.get_sampling(image), optimize=True)
            runtime_blob = encoded.getvalue()
            validate_tile(runtime_blob, {'contentType': 'image/jpeg'}, tile, allow_uniform=True)
            atomic_write(local_file(tile['url']), runtime_blob)
            tile.update(sha256=hashlib.sha256(runtime_blob).hexdigest(), byteLength=len(runtime_blob),
                sourceSha256=record['sha256'], fullyDecodedDuringImport=True,
                transformation={'method': 'pixel crop without resizing; JPEG re-encoding', 'encoder': 'Pillow',
                    'encoderVersion': pillow_version, 'quantization': 'preserved from the original WMS JPEG',
                    'subsampling': 'preserved from the original WMS JPEG',
                    'note': 'JPEG compression introduces small pixel differences; no imagery or geographic detail is generated'})
            runtime_bytes += len(runtime_blob)
    return len(blob), runtime_bytes


def overview(plan, fallback_path):
    from PIL import Image, __version__ as pillow_version
    source = fallback_path.read_bytes()
    source_width, source_height = IMAGERY.image_dimensions(source)
    width, height = 1024, round(1024 * plan['worldHeight'] / plan['worldWidth'])
    with Image.open(io.BytesIO(source)) as image:
        image.load()
        if not (source_width == 4096 and source_height == 3542):
            raise ValueError('The retained genuine municipal fallback image is required for overview')
        reduced = image.resize((width, height), Image.Resampling.BOX)
        encoded = io.BytesIO()
        reduced.save(encoded, 'JPEG', quality=85, subsampling=2, optimize=True)
    blob = encoded.getvalue()
    url = './assets/aerial/calvi-overview.jpg'
    atomic_write(local_file(url), blob)
    return {'url': url, 'asset': url[2:], 'width': width, 'height': height,
        'boundsWorld': {'x': 0, 'y': 0, 'w': plan['worldWidth'], 'h': plan['worldHeight']},
        'boundsWGS84': dict(plan['boundsWGS84']), 'byteLength': len(blob), 'sha256': hashlib.sha256(blob).hexdigest(),
        'sourceAsset': fallback_path.relative_to(ROOT).as_posix(), 'sourceSha256': hashlib.sha256(source).hexdigest(),
        'transformation': {'method': 'BOX downsample and JPEG re-encoding for navigational overview only',
            'encoder': 'Pillow', 'encoderVersion': pillow_version, 'quality': 85,
            'sourceWidth': source_width, 'sourceHeight': source_height}}


def check_files(manifest, mapdata):
    validate_manifest(manifest, mapdata)
    for tile in manifest['sourceTiles'] + manifest['tiles'] + manifest.get('detailSourceTiles', []) + manifest.get('detailTiles', []):
        blob = local_file(tile['url']).read_bytes()
        if len(blob) != tile['byteLength'] or hashlib.sha256(blob).hexdigest() != tile['sha256']:
            raise ValueError('A local tile differs from its original manifest fingerprint')
        if IMAGERY.image_dimensions(blob) != (tile['width'], tile['height']):
            raise ValueError('A local tile has incorrect dimensions')
    image = manifest['overview']
    blob = local_file(image['url']).read_bytes()
    if hashlib.sha256(blob).hexdigest() != image['sha256'] or IMAGERY.image_dimensions(blob) != (image['width'], image['height']):
        raise ValueError('The local overview differs from its source manifest')
    licence = (ROOT / manifest['licenseRecordAsset']).read_bytes()
    if hashlib.sha256(licence).hexdigest() != manifest['license']['recordSha256']:
        raise ValueError('The archived IGN licence does not match its provenance')
    return True


def import_details(manifest_path, mapdata, workers, maximum_bytes):
    """Publish only after validating all old and new genuine files together."""
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('status') != 'ready':
        raise ValueError('Detailed import requires the existing ready half-metre atlas')
    check_files(manifest, mapdata)
    candidate = json.loads(json.dumps(manifest))
    candidate.update(build_detail_plan(mapdata))
    candidate['status'] = 'planned'
    validate_manifest(candidate, mapdata)
    children = {}
    for tile in candidate['detailTiles']:
        children.setdefault(tile['sourceTileId'], []).append(tile)
    # Priority affects only request order, not the exact georeferenced grid.
    sources = sorted(candidate['detailSourceTiles'], key=lambda tile:
        (0 if tile['regionId'] == 'urban' else 1,
         math.hypot(tile['boundsWorld']['x'] - 16500, tile['boundsWorld']['y'] - 8500)))
    base_source_bytes = sum(tile['byteLength'] for tile in candidate['sourceTiles'])
    base_runtime_bytes = sum(tile['byteLength'] for tile in candidate['tiles'])
    overview_bytes = candidate['overview']['byteLength']
    source_bytes = runtime_bytes = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        tasks = {pool.submit(crop_source, source, children[source['id']]): source for source in sources}
        for completed, future in enumerate(as_completed(tasks), 1):
            original, cropped = future.result()
            source_bytes += original
            runtime_bytes += cropped
            total = base_source_bytes + base_runtime_bytes + overview_bytes + source_bytes + runtime_bytes
            print(f'Validated detail {completed}/{len(sources)}; detail-originals={source_bytes} detail-runtime={runtime_bytes} total={total} bytes', flush=True)
            if total > maximum_bytes:
                for task in tasks:
                    task.cancel()
                raise ValueError('Detailed imagery exceeds the explicit total storage bound; existing ready manifest retained')
    candidate['storage'] = {'baseSourceBytes': base_source_bytes, 'baseRuntimeBytes': base_runtime_bytes,
        'detailSourceBytes': source_bytes, 'detailRuntimeBytes': runtime_bytes,
        'sourceBytes': base_source_bytes + source_bytes, 'runtimeBytes': base_runtime_bytes + runtime_bytes,
        'overviewBytes': overview_bytes, 'totalBytes': base_source_bytes + base_runtime_bytes + source_bytes + runtime_bytes + overview_bytes,
        'maximumRuntimeDecodedBytesPerTile': MAX_RUNTIME_DECODE_BYTES}
    candidate['detailDownloadedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
    candidate['status'] = 'ready'
    check_files(candidate, mapdata)
    atomic_write(manifest_path, (json.dumps(candidate, ensure_ascii=False, indent=2) + '\n').encode())
    print(f'Published authentic detail atlas: {len(candidate["detailTiles"])} detail runtime tiles / {len(sources)} originals; all imagery={candidate["storage"]["totalBytes"]} bytes', flush=True)
    return candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true', help='Explicitly fetch the real IGN source tiles and product licence')
    parser.add_argument('--check', action='store_true', help='Verify all local files and manifest without network or mutation')
    parser.add_argument('--detail', action='store_true', help='Plan/add genuine quarter-metre urban and airport exports without replacing the half-metre municipal atlas')
    parser.add_argument('--map', type=Path, default=ROOT / 'data/calvi-map.js')
    parser.add_argument('--manifest', type=Path, default=ROOT / 'data/calvi-imagery-tiles.json')
    parser.add_argument('--metres-per-pixel', type=float, default=.5)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--max-total-bytes', type=int, default=125_000_000)
    args = parser.parse_args()
    try:
        mapdata, _ = IMAGERY.load_map(args.map)
        if args.check:
            manifest = json.loads(args.manifest.read_text())
            check_files(manifest, mapdata)
            print(f'Atlas verified: {len(manifest["tiles"])} base + {len(manifest.get("detailTiles", []))} detail runtime JPEGs, {len(manifest["sourceTiles"])} base + {len(manifest.get("detailSourceTiles", []))} detail archived originals; {manifest["storage"]["totalBytes"]} bytes')
            return 0
        if args.detail:
            if not args.download:
                detail = build_detail_plan(mapdata)
                print(json.dumps({'status': 'planned', 'regions': detail['detailRegions'],
                    'runtimeTiles': len(detail['detailTiles']), 'sourceTiles': len(detail['detailSourceTiles']),
                    'requestedMetresPerPixel': detail['detailRequestedMetresPerPixel'],
                    'maximumRuntimeDecodedBytes': MAX_RUNTIME_DECODE_BYTES}, indent=2))
                return 0
            if not 1 <= args.workers <= 4 or args.max_total_bytes <= 0:
                raise ValueError('Import concurrency is 1..4 and the storage bound must be positive')
            import_details(args.manifest, mapdata, args.workers, args.max_total_bytes)
            return 0
        plan = build_plan(mapdata, args.metres_per_pixel)
        validate_manifest(plan, mapdata)
        if not args.download:
            print(json.dumps({'status': 'planned', 'image': plan['image'], 'sourceTiles': len(plan['sourceTiles']),
                'runtimeTiles': len(plan['tiles']), 'metresPerPixel': plan['metresPerPixel'],
                'maximumRuntimeDecodedBytes': MAX_RUNTIME_DECODE_BYTES, 'exampleRequest': plan['sourceTiles'][0]['sourceUrl']}, indent=2))
            return 0
        if not 1 <= args.workers <= 4 or args.max_total_bytes <= 0:
            raise ValueError('Import concurrency is 1..4 and the storage bound must be positive')
        raw_record, _ = IMAGERY.fetch(IMAGERY.METADATA_URL)
        licence = IMAGERY.license_from_metadata(raw_record)
        plan['license'] = licence
        plan['licenseRecordAsset'] = 'data/calvi-imagery-tiles-license.xml'
        atomic_write(ROOT / plan['licenseRecordAsset'], raw_record)
        children = {}
        for tile in plan['tiles']:
            children.setdefault(tile['sourceTileId'], []).append(tile)
        # Fetch the port/citadelle first so the earliest validated samples cover
        # the initial viewport; this order does not alter source coordinates.
        sources = sorted(plan['sourceTiles'], key=lambda tile: (tile['column'] - 4) ** 2 + (tile['row'] - 2) ** 2)
        source_bytes = runtime_bytes = 0
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            tasks = {pool.submit(crop_source, source, children[source['id']]): source for source in sources}
            for completed, future in enumerate(as_completed(tasks), 1):
                original, cropped = future.result()
                source_bytes += original; runtime_bytes += cropped
                print(f'Validated {completed}/{len(sources)} source tiles; originals={source_bytes} runtime={runtime_bytes} bytes', flush=True)
                if source_bytes + runtime_bytes > args.max_total_bytes:
                    raise ValueError('The original and runtime imagery exceeds the explicit storage bound; no ready atlas was published')
        plan['overview'] = overview(plan, ROOT / 'assets/calvi-orthophoto.jpg')
        plan['storage'] = {'sourceBytes': source_bytes, 'runtimeBytes': runtime_bytes,
            'overviewBytes': plan['overview']['byteLength'], 'totalBytes': source_bytes + runtime_bytes + plan['overview']['byteLength'],
            'maximumRuntimeDecodedBytesPerTile': MAX_RUNTIME_DECODE_BYTES}
        if plan['storage']['totalBytes'] > args.max_total_bytes:
            raise ValueError('The finished atlas exceeds its storage bound')
        plan['downloadedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
        plan['status'] = 'ready'
        validate_manifest(plan, mapdata)
        check_files(plan, mapdata)
        atomic_write(args.manifest, (json.dumps(plan, ensure_ascii=False, indent=2) + '\n').encode())
        print(f'Published authentic local atlas: {len(plan["tiles"])} runtime tiles; total={plan["storage"]["totalBytes"]} bytes', flush=True)
        return 0
    except (ValueError, OSError, KeyError, ImportError) as error:
        print(f'IGN tile import failed; no new ready manifest published: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
