#!/usr/bin/env python3
"""Derive conservative water-colour cells from archived genuine IGN JPEGs.

No network and no source-image mutation. --build is explicit; --check
recomputes every cell and verifies source fingerprints and real geometry.
The cells support artistic wave placement, never navigation or bathymetry.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
GRID_SIZE = 32
THRESHOLDS = {'blueMinusRedMinimum': 8, 'blueMinusGreenMinimum': 2,
    'blueMinimum': 25, 'luminanceMaximum': 110,
    'cellRule': 'Every source pixel in the cell must pass; one rejected pixel clears the cell'}
DEFAULT_OUTPUT = ROOT / 'data/calvi-water-surface.js'
SPEC = importlib.util.spec_from_file_location('imagery_tiles', Path(__file__).with_name('import-imagery-tiles.py'))
ATLAS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ATLAS)


def classify_image(image, columns=GRID_SIZE, rows=GRID_SIZE):
    """Evaluate original RGB pixels; never blur/interpolate a boat into water."""
    from PIL import ImageChops
    if not isinstance(columns, int) or not isinstance(rows, int) or columns <= 0 or rows <= 0 or columns > image.width or rows > image.height:
        raise ValueError('Each classification cell must contain source pixels')
    red, green, blue = image.convert('RGB').split()
    def at_least(value):
        return [0 if pixel < value else 255 for pixel in range(256)]
    mask = ImageChops.subtract(blue, red).point(at_least(THRESHOLDS['blueMinusRedMinimum']))
    mask = ImageChops.multiply(mask, ImageChops.subtract(blue, green).point(at_least(THRESHOLDS['blueMinusGreenMinimum'])))
    mask = ImageChops.multiply(mask, blue.point(at_least(THRESHOLDS['blueMinimum'])))
    luminance = image.convert('RGB').convert('L').point([255 if pixel <= THRESHOLDS['luminanceMaximum'] else 0 for pixel in range(256)])
    mask = ImageChops.multiply(mask, luminance)
    bits = bytearray(math.ceil(columns * rows / 8))
    for row in range(rows):
        top, bottom = row * image.height // rows, (row + 1) * image.height // rows
        for column in range(columns):
            left, right = column * image.width // columns, (column + 1) * image.width // columns
            # Exact minimum, rather than an average: bright boats and quay
            # pixels must not disappear inside a mostly-water source cell.
            if mask.crop((left, top, right, bottom)).getextrema()[0] == 255:
                index = row * columns + column
                bits[index // 8] |= 1 << (7 - index % 8)
    return bits.hex()


def source_path(url):
    if not isinstance(url, str) or not re.fullmatch(r'\./assets/aerial/[\w.-]+\.jpg', url):
        raise ValueError('Water observations must use local runtime imagery URLs')
    return ROOT / url[2:]


def observe_tile(item):
    from PIL import Image
    lod, source = item
    blob = source_path(source['url']).read_bytes()
    if len(blob) != source.get('byteLength') or hashlib.sha256(blob).hexdigest() != source.get('sha256'):
        raise ValueError('Water source JPEG differs from its archived imagery fingerprint')
    with Image.open(io.BytesIO(blob)) as image:
        image.load()
        if image.size != (source['width'], source['height']):
            raise ValueError('Water source pixel dimensions differ from the georeferenced imagery')
        bits = classify_image(image)
    return {'id': source['id'], 'lod': lod, 'url': source['url'], 'sha256': source['sha256'],
        'width': source['width'], 'height': source['height'],
        'boundsWorld': dict(source['boundsWorld']), 'columns': GRID_SIZE, 'rows': GRID_SIZE, 'bitsHex': bits}


def build_dataset(manifest, mapdata, manifest_blob, workers=1):
    ATLAS.validate_manifest(manifest, mapdata)
    if manifest.get('status') != 'ready':
        raise ValueError('Water classification requires ready genuine imagery')
    if not isinstance(workers, int) or not 1 <= workers <= 4:
        raise ValueError('Classification concurrency is bounded to 1..4 readers')
    items = [(0, source) for source in manifest['tiles']] + [(1, source) for source in manifest.get('detailTiles', [])]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        tiles = list(pool.map(observe_tile, items))
    return {'status': 'ready', 'version': 1, 'metadata': {
        'kind': 'conservative-photographic-water-colour-cells', 'city': 'Calvi',
        'boundsWGS84': dict(manifest['boundsWGS84']), 'worldWidth': manifest['worldWidth'], 'worldHeight': manifest['worldHeight'],
        'vectorSourceSha256': mapdata['metadata'].get('sha256'),
        'imageryManifestAsset': 'data/calvi-imagery-tiles.json',
        'imageryManifestSha256': hashlib.sha256(manifest_blob).hexdigest(),
        'provider': manifest['provider'], 'product': manifest['product'], 'attribution': manifest['attribution'],
        'licenseRecordAsset': manifest['licenseRecordAsset'], 'licenseRecordSha256': manifest['license']['recordSha256'],
        'thresholds': dict(THRESHOLDS), 'columns': GRID_SIZE, 'rows': GRID_SIZE,
        'bitOrder': 'row-major, most significant bit first within each byte',
        'sourcePixels': 'Day-colour pixels of the archived JPEGs; runtime day/night does not change classification',
        'limitations': 'Colour classification for sparse artistic waves. OSM marine geometry must also accept each point. Not coastline measurement, depth, boat recognition, or collision data.',
        'priority': 'Detail lod=1 cells override base lod=0 cells wherever detail coverage exists',
        'tileCount': len(tiles), 'baseTileCount': len(manifest['tiles']), 'detailTileCount': len(manifest.get('detailTiles', [])),
        'waterCellCount': sum(sum(byte.bit_count() for byte in bytes.fromhex(tile['bitsHex'])) for tile in tiles)},
        'tiles': tiles}


def validate_dataset(dataset, manifest, mapdata, manifest_blob):
    if dataset.get('status') != 'ready' or dataset.get('version') != 1:
        raise ValueError('Water data is not ready')
    metadata = dataset.get('metadata', {})
    if metadata.get('boundsWGS84') != manifest['boundsWGS84'] or metadata.get('worldWidth') != manifest['worldWidth'] or metadata.get('worldHeight') != manifest['worldHeight']:
        raise ValueError('Water data does not match the real imagery bounds')
    if metadata.get('imageryManifestSha256') != hashlib.sha256(manifest_blob).hexdigest() or metadata.get('vectorSourceSha256') != mapdata['metadata'].get('sha256'):
        raise ValueError('Water data source fingerprints differ from the actual map/atlas')
    if metadata.get('thresholds') != THRESHOLDS or metadata.get('columns') != GRID_SIZE or metadata.get('rows') != GRID_SIZE:
        raise ValueError('Water classification thresholds or grid dimensions differ')
    expected = [(0, source) for source in manifest['tiles']] + [(1, source) for source in manifest.get('detailTiles', [])]
    tiles = dataset.get('tiles')
    if not isinstance(tiles, list) or len(tiles) != len(expected):
        raise ValueError('Water data has missing imagery tiles')
    for tile, (lod, source) in zip(tiles, expected):
        for field in ('id', 'url', 'sha256', 'width', 'height', 'boundsWorld'):
            if tile.get(field) != source[field]:
                raise ValueError('Water tile dimensions, location or fingerprint differ from the real source')
        if tile.get('lod') != lod or tile.get('columns') != GRID_SIZE or tile.get('rows') != GRID_SIZE:
            raise ValueError('Water tile priority or dimensions differ')
        if not isinstance(tile.get('bitsHex'), str) or not re.fullmatch(r'[0-9a-f]{256}', tile['bitsHex']):
            raise ValueError('Each 32×32 water grid needs exactly 128 bytes')
    if metadata.get('tileCount') != len(expected) or metadata.get('baseTileCount') != len(manifest['tiles']) or metadata.get('detailTileCount') != len(manifest.get('detailTiles', [])):
        raise ValueError('Water tile counts differ from actual coverage')
    return True


def read_dataset(path):
    match = re.fullmatch(r'export const CALVI_WATER_SURFACE = (\{.*\});\s*', path.read_text(), re.S)
    if not match:
        raise ValueError('Water surface module is not an explicit JSON data export')
    return json.loads(match.group(1))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', action='store_true', help='Explicitly derive local colour cells; never download or alter imagery')
    parser.add_argument('--check', action='store_true', help='Verify source hashes and recompute all water cells without mutation')
    parser.add_argument('--workers', type=int, default=1)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        manifest_blob = (ROOT / 'data/calvi-imagery-tiles.json').read_bytes()
        manifest = json.loads(manifest_blob)
        mapdata, _ = ATLAS.IMAGERY.load_map(ROOT / 'data/calvi-map.js')
        if not args.build and not args.check:
            print(json.dumps({'status': 'planned', 'baseTiles': len(manifest['tiles']), 'detailTiles': len(manifest.get('detailTiles', [])),
                'cellsPerTile': GRID_SIZE ** 2, 'bytesPerTile': GRID_SIZE ** 2 // 8, 'thresholds': THRESHOLDS}, indent=2))
            return 0
        actual = build_dataset(manifest, mapdata, manifest_blob, args.workers)
        validate_dataset(actual, manifest, mapdata, manifest_blob)
        if args.check:
            retained = read_dataset(args.output)
            validate_dataset(retained, manifest, mapdata, manifest_blob)
            if retained != actual:
                raise ValueError('Retained colour cells differ from the genuine original pixels')
            print(f'Water cells verified: {actual["metadata"]["tileCount"]} source fingerprints and grids; {actual["metadata"]["waterCellCount"]} conservative water cells')
        else:
            ATLAS.atomic_write(args.output, ('export const CALVI_WATER_SURFACE = ' + json.dumps(actual, ensure_ascii=False, separators=(',', ':')) + ';\n').encode())
            print(f'Water cells published: {actual["metadata"]["tileCount"]} grids, {args.output.stat().st_size} bytes; JPEGs and atlas manifest unchanged')
        return 0
    except (ValueError, OSError, KeyError, ImportError) as error:
        print(f'Water classification failed: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
