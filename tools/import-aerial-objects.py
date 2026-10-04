#!/usr/bin/env python3
"""Reproducible, conservative vegetation/photo-car annotations from archived IGN pixels.

No image is downloaded or modified. Canopy centres are observations of colour
clusters, not a cadastral tree inventory. Their heights are game art estimates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import deque
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageStat

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/calvi-aerial-objects-source.json'
ANNOTATIONS = ROOT / 'tools/calvi-aerial-annotations.json'
OUTPUT = ROOT / 'data/calvi-aerial-objects.js'
SAMPLE = 4  # Native .5 m pixels -> 2 m observation cells, never invented detail.
MAX_VEGETATION = 12000


def read_js(path: Path, name: str):
    text = path.read_text()
    return json.loads(text.split(f'export const {name} = ', 1)[1].rstrip().removesuffix(';'))


def world_point(source, pixel_x, pixel_y):
    return (pixel_x * source['worldWidth'] / source['image']['width'],
            pixel_y * source['worldHeight'] / source['image']['height'])


def world_ring(source, ring):
    return [[round(v, 3) for v in world_point(source, x, y)] for x, y in ring]


def pixel_point(source, x, y):
    return (x / source['worldWidth'] * source['image']['width'] / SAMPLE,
            y / source['worldHeight'] * source['image']['height'] / SAMPLE)


def source_masks(source, city):
    size = (math.ceil(source['image']['width'] / SAMPLE), math.ceil(source['image']['height'] / SAMPLE))
    land = Image.new('L', size)
    draw = ImageDraw.Draw(land)
    for polygon in city['municipalBoundary']['polygons']:
        draw.polygon([pixel_point(source, *p) for p in polygon['outer']], fill=255)
        for hole in polygon.get('holes', []):
            draw.polygon([pixel_point(source, *p) for p in hole], fill=0)
    # The municipality has a marine component. Intersect with real OSM land.
    coast = Image.new('L', size)
    c = ImageDraw.Draw(coast)
    for ring in city['landPolygons']:
        c.polygon([pixel_point(source, *p) for p in ring], fill=255)
    import PIL.ImageChops
    land = PIL.ImageChops.multiply(land, coast)
    draw = ImageDraw.Draw(land)
    for building in city['buildings']:
        ring = building.get('polygon', [])
        if len(ring) > 2:
            draw.polygon([pixel_point(source, *p) for p in ring], fill=0)
            draw.line([pixel_point(source, *p) for p in ring + [ring[0]]], fill=0, width=3)
    for road in city['roads']:
        # Trunks cannot occupy mapped roads or paths. Widths are illustrative
        # source highway-class widths, so this intentionally under-detects edges.
        width = max(2, math.ceil((road.get('width', 12) + 28) / 8))
        draw.line([pixel_point(source, *p) for p in road['points']], fill=0, width=width)
    b = source['boundsWGS84']
    # Conservative omission around existing mission boarding/approaches keeps
    # gameplay clear; omitted plants remain visible in the original ground photo.
    for lon, lat in [(8.756770179469406,42.56497621095051),
                     (8.756109201711055,42.5643104981607),
                     (8.759372261136232,42.56711500455895),
                     (8.756197507470619,42.562566003710046),
                     (8.756674512443182,42.5648695373825),
                     (8.755055524074546,42.564823498718084),
                     (8.790680340665155,42.52634303552752)]:
        cx = (lon - b['west']) / (b['east'] - b['west']) * size[0]
        cy = (b['north'] - lat) / (b['north'] - b['south']) * size[1]
        radius = 12  # 24 m on ground, 96 world pixels.
        draw.ellipse((cx-radius,cy-radius,cx+radius,cy+radius),fill=0)
    types = Image.new('L', size)
    td = ImageDraw.Draw(types)
    # 1: mapped woodland; 2: scrub; 3: grass/cultivated low vegetation.
    for area in city.get('areas', []):
        kind = area.get('kind')
        value = 1 if kind == 'wood' else 2 if kind == 'scrub' else 3 if kind in ('grass', 'meadow', 'farmland', 'vineyard', 'orchard') else 0
        if value and len(area.get('polygon', [])) > 2:
            td.polygon([pixel_point(source, *p) for p in area['polygon']], fill=value)
    urban = Image.new('L', size)
    ud = ImageDraw.Draw(urban)
    for area in city.get('areas', []):
        if area.get('kind') in ('residential', 'park', 'garden', 'cemetery') and len(area.get('polygon', [])) > 2:
            ud.polygon([pixel_point(source, *p) for p in area['polygon']], fill=255)
    for building in city['buildings']:
        xs, ys = zip(*(pixel_point(source, *p) for p in building['polygon']))
        # Individual trees in gardens can be absent from OSM natural=wood.
        # A 32 m vicinity is only a classification hint, never a planting mask.
        ud.rectangle((min(xs)-16,min(ys)-16,max(xs)+16,max(ys)+16), fill=255)
    return land, types, urban


def green_pixel(rgb):
    r, g, b = rgb
    # Mediterranean canopy is often muted rather than vivid green. Reject
    # water/blue roofs and beige bare earth; accept the excess-green signature.
    return 20 <= g <= 170 and g - b >= 5 and g - r >= -2 and 2 * g - r - b >= 9


def extract_tile(source, tile, land, types, urban):
    path = ROOT / tile['url'].removeprefix('./')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != tile['sha256']:
        raise ValueError(f"Changed original photograph: {tile['id']}")
    with Image.open(path) as original:
        original.load()
        if original.size != (tile['width'], tile['height']):
            raise ValueError(f"Wrong source dimensions: {tile['id']}")
        im = original.convert('RGB').resize((math.ceil(tile['width'] / SAMPLE), math.ceil(tile['height'] / SAMPLE)), Image.Resampling.BOX)
    origin_x, origin_y = tile['pixelRect']['x'] // SAMPLE, tile['pixelRect']['y'] // SAMPLE
    local_land = land.crop((origin_x, origin_y, origin_x + im.width, origin_y + im.height))
    local_types = types.crop((origin_x, origin_y, origin_x + im.width, origin_y + im.height))
    local_urban = urban.crop((origin_x, origin_y, origin_x + im.width, origin_y + im.height)).tobytes()
    colour = list(im.get_flattened_data())
    allowed = local_land.tobytes()
    kind_pixels = local_types.tobytes()
    mask = bytearray(255 if permitted and green_pixel(rgb) else 0 for rgb, permitted in zip(colour, allowed))
    # Ignore isolated JPEG colour noise. Dense photo support must surround every
    # centre; there is no random seeding over geographic woodland polygons.
    support = Image.frombytes('L', im.size, bytes(mask)).filter(ImageFilter.MedianFilter(3)).tobytes()
    cells = {}
    for i, value in enumerate(support):
        if not value or not mask[i]:
            continue
        x, y = i % im.width, i // im.width
        # 24 m photo-supported clusters in remote maquis, 12 m in woodland,
        # 8 m around town. Splitting follows actual classified pixels.
        mapped = kind_pixels[i] or (4 if local_urban[i] else 0)
        # Unknown rural green texture is conservative low maquis, not an
        # invented stand of tall trees. Only woodland/urban crowns rise higher.
        stride = 6 if mapped == 1 else 4 if mapped == 4 else 12
        key = (mapped, x // stride, y // stride)
        cells.setdefault(key, []).append(i)
    found = []
    for (mapped, _, _), members in cells.items():
        if len(members) < (3 if mapped in (1, 4) else 6):
            continue
        xs, ys = [i % im.width for i in members], [i // im.width for i in members]
        min_x, min_y, max_x, max_y = min(xs), min(ys), max(xs), max(ys)
        # A real crown centre is a classified member, never an empty centroid.
        mean_x, mean_y = sum(xs) / len(xs), sum(ys) / len(ys)
        centre = min(members, key=lambda i: (i % im.width - mean_x) ** 2 + (i // im.width - mean_y) ** 2)
        cx, cy = centre % im.width, centre // im.width
        rgb = colour[centre]
        luminances = [sum(colour[i]) / 3 for i in members]
        contrast = max(luminances) - min(luminances)
        if mapped == 3:
            # Cultivated fields/grass are not automatically trees. Only textured
            # dark crown-like clusters receive a low vegetation relief.
            if contrast < 13 or sum(rgb) > 290:
                continue
        elif mapped == 4 and (contrast < 9 or sum(rgb) > 330):
            # Uniform lawns/green paint are excluded from urban tree candidates.
            continue
        local_x = min(tile['width'] - .5, (cx + .5) * SAMPLE)
        local_y = min(tile['height'] - .5, (cy + .5) * SAMPLE)
        pixel_x, pixel_y = tile['pixelRect']['x'] + local_x, tile['pixelRect']['y'] + local_y
        wx, wy = world_point(source, pixel_x, pixel_y)
        is_scrub = mapped not in (1, 4)
        radius = min(36 if is_scrub else 22, max(7, math.sqrt(len(members) / math.pi) * 8))
        # Nearby coloured samples determine foliage palette, not a fictional
        # green blanket. Canopy form and height are artistic interpretations.
        average = tuple(round(sum(colour[i][k] for i in members) / len(members)) for k in range(3))
        source_rect = {'x': tile['pixelRect']['x'] + min_x * SAMPLE,
                       'y': tile['pixelRect']['y'] + min_y * SAMPLE,
                       'w': min(tile['width'] - min_x * SAMPLE, (max_x - min_x + 1) * SAMPLE),
                       'h': min(tile['height'] - min_y * SAMPLE, (max_y - min_y + 1) * SAMPLE)}
        found.append({'id': f"aerial-vegetation-{tile['id']}-{cx}-{cy}",
                      'x': round(wx, 3), 'y': round(wy, 3), 'radius': round(radius, 2),
                      'heightMeters': 1.2 if is_scrub else 6.5 if mapped == 1 else 5.0,
                      'estimatedHeight': True, 'heightSource': 'artistic estimate; not measured',
                      'type': 'scrub' if is_scrub else 'tree',
                      'color': '#%02x%02x%02x' % average,
                      'sourcePlacement': {'tileId': tile['id'], 'pixelX': pixel_x, 'pixelY': pixel_y,
                          'pixelRect': source_rect, 'sha256': tile['sha256'],
                          'method': 'excess-green photo cluster; conservative OSM ground/building/road masks',
                          'classifiedPixelCount': len(members), 'observationCellMetres': 2,
                          'osmVegetationClass': mapped},
                      '_score': (3000 if mapped == 4 else 1000 if mapped == 1 else 0) + len(members) + contrast / 16})
    return found


def photo_vehicles(source, annotations):
    by_id = {tile['id']: tile for tile in source['sourceTiles'] + source.get('annotationSources', [])}
    vehicles = []
    for annotation in annotations['vehicles']:
        tile = by_id[annotation['tileId']]
        rect = annotation['pixelRect']
        b = tile['boundsWorld']
        sx, sy = b['w'] / tile['width'], b['h'] / tile['height']
        def local_world(px, py):
            return (b['x'] + px * sx, b['y'] + py * sy)
        x, y = local_world(*annotation['center'])
        polygon = annotation['maskPolygon']
        mask = [[round(v, 3) for v in local_world(a, b)] for a, b in polygon]
        patch = annotation['groundPatch']
        patch_world = local_world(patch['x'], patch['y'])
        patch_end = local_world(patch['x'] + patch['w'], patch['y'] + patch['h'])
        with Image.open(ROOT / tile['url'].removeprefix('./')) as im:
            mean = ImageStat.Stat(im.crop((patch['x'], patch['y'], patch['x'] + patch['w'], patch['y'] + patch['h']))).mean
        color = '#%02x%02x%02x' % tuple(round(c) for c in mean[:3])
        vehicle = {'id': annotation['id'], 'x': round(x, 3), 'y': round(y, 3),
            'angle': annotation['angle'], 'width': annotation.get('width', 8), 'length': annotation.get('length', 18),
            'color': annotation.get('color', '#c8c5b9'),
            'maskPolygon': mask,
            'groundPatch': {'sourceBoundsWorld': {'x': round(patch_world[0], 3), 'y': round(patch_world[1], 3),
                'w': round(patch_end[0] - patch_world[0], 3), 'h': round(patch_end[1] - patch_world[1], 3)}, 'color': color},
            'groundColor': color,
            'sourcePlacement': {'tileId': tile['id'], 'sha256': tile['sha256'],
                'pixelRect': rect, 'pixelCoordinateSpace': 'source-image', 'centerPixel': annotation['center'],
                'sourceBoundsWorld': b, 'sourceImageWidth': tile['width'], 'sourceImageHeight': tile['height'],
                'method': 'manual verified photo annotation; playable model and ground/water clone are artistic',
                'inspectionNote': annotation['note']}}
        if annotation.get('mobilityType'):
            vehicle['mobilityType'] = annotation['mobilityType']
        if annotation.get('boarding'):
            bx, by = local_world(*annotation['boarding'])
            vehicle['boarding'] = {'x': round(bx, 3), 'y': round(by, 3)}
            vehicle['sourcePlacement']['boardingPixel'] = annotation['boarding']
        if annotation.get('model'):
            vehicle['model'] = annotation['model']
        if annotation.get('aliasOf'):
            vehicle['aliasOf'] = annotation['aliasOf']
        if annotation.get('excludedReason'):
            vehicle['excludedReason'] = annotation['excludedReason']
        if annotation.get('sourcePierId'):
            vehicle['sourcePierId'] = annotation['sourcePierId']
        if annotation.get('bodyPolygon'):
            vehicle['bodyPolygonWorld'] = [[round(v, 3) for v in local_world(a, b)] for a,b in annotation['bodyPolygon']]
        for key in ('observationGroup', 'splitCount', 'supportPixelCount', 'observationMethod'):
            if key in annotation:
                vehicle['sourcePlacement'][key] = annotation[key]
        vehicles.append(vehicle)
    return vehicles


def manual_vegetation(source, annotations):
    by_id = {tile['id']: tile for tile in source['sourceTiles'] + source.get('annotationSources', [])}
    result = []
    for item in annotations.get('vegetation', []):
        tile = by_id[item['tileId']]
        b = tile['boundsWorld']
        x = b['x'] + item['center'][0] * b['w'] / tile['width']
        y = b['y'] + item['center'][1] * b['h'] / tile['height']
        result.append({'id': item['id'], 'x': round(x, 3), 'y': round(y, 3),
            'radius': item['radius'], 'heightMeters': item['heightMeters'], 'type': 'tree',
            'estimatedHeight': True, 'heightSource': 'artistic estimate; not measured',
            'species': item.get('species', 'unidentified'), 'color': item['color'],
            'canopyPolygon': item.get('canopyPolygon'),
            'sourcePlacement': {'tileId': tile['id'], 'sha256': tile['sha256'],
                'centerPixel': item['center'], 'pixelRect': item['pixelRect'], 'pixelCoordinateSpace': 'source-image',
                'sourceBoundsWorld': b, 'sourceImageWidth': tile['width'], 'sourceImageHeight': tile['height'],
                'method': 'manually verified photo crown; no inferred inventory or measured height',
                'inspectionNote': item['note']}})
    return result


def make(source, city, annotations):
    land, types, urban = source_masks(source, city)
    vegetation = []
    for tile in source['sourceTiles']:
        objects = extract_tile(source, tile, land, types, urban)
        vegetation.extend(objects)
        print(f"{tile['id']}: {len(objects)} photo-supported vegetation clusters", flush=True)
    manual = manual_vegetation(source, annotations)
    # Manually verified grey palms are deliberately retained: green-only colour
    # classification cannot detect all actual crowns in bright paving.
    vegetation = [item for item in vegetation if all(math.hypot(item['x']-palm['x'],item['y']-palm['y']) > item['radius']+palm['radius'] for palm in manual)]
    if len(vegetation) > MAX_VEGETATION - len(manual):
        # Keep the strongest observed clusters, not random invented replacements.
        vegetation = sorted(vegetation, key=lambda obj: (-obj['_score'], obj['id']))[:MAX_VEGETATION - len(manual)]
    vegetation.sort(key=lambda obj: obj['id'])
    for item in vegetation:
        del item['_score']
    vegetation.extend(manual)
    observations = photo_vehicles(source, annotations)
    vehicles = [item for item in observations if not item.get('excludedReason')]
    excluded = [item for item in observations if item.get('excludedReason')]
    return {'metadata': {'status': 'ready', 'version': 1, 'kind': 'photo-supported-game-objects',
        'boundsWGS84': source['boundsWGS84'], 'worldWidth': source['worldWidth'], 'worldHeight': source['worldHeight'],
        'observationImage': source['image'], 'sourceMetresPerPixel': .5,
        'sourceManifestSha256': source['sourceManifestSha256'], 'vectorSha256': city['metadata']['sha256'],
        'attribution': source['attribution'], 'licence': 'Licence Ouverte / Open Licence; OSM masks ODbL-1.0',
        'vegetationNote': 'Conservative colour-derived canopy/low scrub clusters, not exhaustive tree species/count/height measurements',
        'vehiclesNote': 'Manually verified photographed cars, boats and aircraft in inspected areas; not an exhaustive detection of every vehicle in Calvi',
        'coverageRegions': annotations.get('coverageRegions', []),
        'vegetationCount': len(vegetation), 'vehicleCount': len(vehicles),
        'observedVehicleCount': len(observations), 'excludedObservationCount': len(excluded),
        'manualVegetationCount': len(manual), 'maximumVegetation': MAX_VEGETATION,
        'heightSource': 'Artistic canopy elevation; not LiDAR tree height', 'photographModified': False},
        'vegetation': vegetation, 'vehicles': vehicles, 'excludedObservations': excluded, 'piers': source.get('piers', [])}


def check(objects, source):
    ids = set()
    by_id = {tile['id']: tile for tile in source['sourceTiles'] + source.get('annotationSources', [])}
    for obj in objects['vegetation'] + objects['vehicles'] + objects.get('excludedObservations', []):
        if obj['id'] in ids:
            raise ValueError('Duplicate object id')
        ids.add(obj['id'])
        if not (0 <= obj['x'] <= source['worldWidth'] and 0 <= obj['y'] <= source['worldHeight']):
            raise ValueError('Object outside real atlas')
        provenance = obj['sourcePlacement']
        if provenance['sha256'] != by_id[provenance['tileId']]['sha256']:
            raise ValueError('Wrong photograph hash')
        if 'pixelX' in provenance:
            expected = world_point(source, provenance['pixelX'], provenance['pixelY'])
            if any(abs(a - b) > .001 for a, b in zip((obj['x'], obj['y']), expected)):
                raise ValueError('Wrong photographic georeferencing')
        elif 'centerPixel' in provenance:
            tile = by_id[provenance['tileId']]
            b = tile['boundsWorld']
            expected = (b['x']+provenance['centerPixel'][0]*b['w']/tile['width'],
                        b['y']+provenance['centerPixel'][1]*b['h']/tile['height'])
            if any(abs(a-b)>.001 for a,b in zip((obj['x'],obj['y']),expected)):
                raise ValueError('Wrong annotation georeferencing')
    for tile in source['sourceTiles'] + source.get('annotationSources', []):
        raw = (ROOT / tile['url'].removeprefix('./')).read_bytes()
        if hashlib.sha256(raw).hexdigest() != tile['sha256']:
            raise ValueError(f"Changed source photograph: {tile['id']}")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Check generated objects and all unchanged source hashes')
    args = parser.parse_args()
    source = json.loads(SOURCE.read_text())
    if args.check:
        objects = read_js(OUTPUT, 'CALVI_AERIAL_OBJECTS')
    else:
        city = read_js(ROOT / 'data/calvi-map.js', 'CALVI_MAP')
        objects = make(source, city, json.loads(ANNOTATIONS.read_text()))
        temporary = OUTPUT.with_suffix('.js.tmp')
        temporary.write_text('// Generated from archived IGN photographs; see CALVI_AERIAL_OBJECTS.md.\nexport const CALVI_AERIAL_OBJECTS = ' + json.dumps(objects, separators=(',', ':')) + ';\n')
        temporary.replace(OUTPUT)
    check(objects, source)
    print(f"Verified {len(objects['vegetation'])} vegetation clusters, {len(objects['vehicles'])} eligible photo vehicles and {len(objects.get('excludedObservations', []))} explicitly excluded observations")


if __name__ == '__main__':
    main()
