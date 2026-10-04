#!/usr/bin/env python3
"""Audit actual archived photo pixels and source geography behind game objects."""
import hashlib
import gzip
import importlib.util
import json
import math
import unittest
from collections import defaultdict
from pathlib import Path

from PIL import Image
from PIL import ImageStat

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('aerial', ROOT / 'tools/import-aerial-objects.py')
AERIAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AERIAL)


def inside_ring(x, y, ring):
    inside = False
    for a,b in zip(ring, ring[1:]+ring[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            inside = not inside
    return inside


class AerialObservationAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = json.loads(AERIAL.SOURCE.read_text())
        cls.objects = AERIAL.read_js(AERIAL.OUTPUT, 'CALVI_AERIAL_OBJECTS')
        cls.city = AERIAL.read_js(ROOT / 'data/calvi-map.js', 'CALVI_MAP')
        cls.sources = {tile['id']: tile for tile in cls.source['sourceTiles'] + cls.source['annotationSources']}
        cls.annotations = json.loads(AERIAL.ANNOTATIONS.read_text())

    def test_every_archived_original_is_byte_identical(self):
        self.assertTrue(AERIAL.check(self.objects, self.source))
        self.assertEqual(len(self.source['sourceTiles']), 72)
        used = {p['sourcePlacement']['tileId'] for p in self.objects['vegetation'] + self.objects['vehicles'] + self.objects['excludedObservations']}
        self.assertTrue(used <= set(self.sources))
        self.assertGreaterEqual(len(self.source['annotationSources']), 6)

    def test_source_world_and_vector_fingerprint_have_not_drifted(self):
        metadata = self.objects['metadata']
        self.assertEqual(metadata['vectorSha256'], self.city['metadata']['sha256'])
        self.assertEqual(metadata['boundsWGS84'], self.city['metadata']['bounds'])
        self.assertEqual((metadata['worldWidth'], metadata['worldHeight']), (self.city['width'], self.city['height']))
        self.assertEqual(AERIAL.world_point(self.source, 0, 0), (0, 0))
        self.assertEqual(AERIAL.world_point(self.source, self.source['image']['width'], self.source['image']['height']), (self.city['width'], self.city['height']))

    def test_all_detected_centres_are_supported_by_real_green_photo_pixels(self):
        groups = defaultdict(list)
        for item in self.objects['vegetation']:
            if 'pixelX' in item['sourcePlacement']:
                groups[item['sourcePlacement']['tileId']].append(item)
        checked = 0
        for tile_id, items in groups.items():
            tile = self.sources[tile_id]
            with Image.open(ROOT / tile['url'].removeprefix('./')) as original:
                image = original.convert('RGB').resize((math.ceil(tile['width'] / AERIAL.SAMPLE), math.ceil(tile['height'] / AERIAL.SAMPLE)), Image.Resampling.BOX)
                for item in items:
                    p = item['sourcePlacement']
                    x = int((p['pixelX'] - tile['pixelRect']['x']) / AERIAL.SAMPLE)
                    y = int((p['pixelY'] - tile['pixelRect']['y']) / AERIAL.SAMPLE)
                    self.assertTrue(AERIAL.green_pixel(image.getpixel((x, y))), item['id'])
                    self.assertGreaterEqual(p['classifiedPixelCount'], 3 if p['osmVegetationClass'] in (1, 4) else 6)
                    checked += 1
        self.assertEqual(checked, len(self.objects['vegetation']) - len(self.annotations['vegetation']))

    def test_generated_trunks_avoid_source_roads_buildings_sea_and_reserved_accesses(self):
        allowed, _, _ = AERIAL.source_masks(self.source, self.city)
        for item in self.objects['vegetation']:
            p = item['sourcePlacement']
            if 'pixelX' not in p:
                continue
            x, y = int(p['pixelX'] / AERIAL.SAMPLE), int(p['pixelY'] / AERIAL.SAMPLE)
            self.assertEqual(allowed.getpixel((x, y)), 255, item['id'])

    def test_unknown_rural_greenery_is_low_maquis_not_invented_tall_trees(self):
        rural = [item for item in self.objects['vegetation'] if item['sourcePlacement'].get('osmVegetationClass') == 0]
        self.assertGreater(len(rural), 500)
        for item in rural:
            self.assertEqual(item['type'], 'scrub')
            self.assertLessEqual(item['heightMeters'], 1.5)

    def test_grey_port_palms_are_explicit_photo_annotations(self):
        palms = [item for item in self.objects['vegetation'] if item.get('species') == 'palm']
        self.assertEqual(len(palms), 4)
        for item in palms:
            self.assertTrue(item['estimatedHeight'])
            self.assertIn('manual', item['sourcePlacement']['method'])
            self.assertEqual(item['sourcePlacement']['tileId'], 'detail-urban-c2-r1')
            self.assertGreater(len(item['canopyPolygon']), 8)

    def test_vehicle_annotations_are_exact_source_positions_and_bounded_masks(self):
        observations = self.objects['vehicles'] + self.objects['excludedObservations']
        self.assertEqual({v['id'] for v in observations}, {v['id'] for v in self.annotations['vehicles']})
        for car in observations:
            self.assertGreater(car['width'], 0)
            self.assertGreater(car['length'], 0)
            p = car['sourcePlacement']
            self.assertEqual(p['pixelCoordinateSpace'], 'source-image')
            self.assertIn('manual', p['method'])
            tile = self.sources[p['tileId']]
            self.assertTrue(0 <= p['centerPixel'][0] < tile['width'])
            self.assertTrue(0 <= p['centerPixel'][1] < tile['height'])
            xs, ys = zip(*car['maskPolygon'])
            limit = 360 if car.get('mobilityType') == 'plane' else 260 if car.get('mobilityType') == 'boat' else 80
            self.assertLessEqual(max(xs)-min(xs), limit)
            self.assertLessEqual(max(ys)-min(ys), limit)
            self.assertTrue(min(xs) <= car['x'] <= max(xs))
            self.assertTrue(min(ys) <= car['y'] <= max(ys))
            patch = car['groundPatch']['sourceBoundsWorld']
            self.assertGreater(patch['w'], 0)
            self.assertGreater(patch['h'], 0)
            self.assertGreater(math.hypot(patch['x']-car['x'], patch['y']-car['y']), 5)

    def test_dark_square_crowns_missing_from_green_detector_are_sourced(self):
        square = [v for v in self.objects['vegetation'] if v['id'].startswith('photo-tree-square-')]
        self.assertEqual(len(square), 28)
        for tree in square:
            self.assertEqual(len(tree['canopyPolygon']), 12)
            self.assertIn(tree['sourcePlacement']['tileId'], ('detail-urban-c2-r1', 'detail-urban-c2-r2'))
            self.assertTrue(tree['estimatedHeight'])
        proof = next(v for v in square if v['id'] == 'photo-tree-square-19')
        self.assertEqual((proof['x'], proof['y']), (16308, 8855))
        self.assertEqual(proof['sourcePlacement']['centerPixel'], [1212, 259])

    def test_pier_geometry_is_unchanged_archived_osm_and_width_is_estimated(self):
        piers = self.objects['piers']
        self.assertEqual({p['sourceId'] for p in piers}, {115676052, 115676056, 115676057, 115676059, 115676060, 1089398758})
        for pier in piers:
            provenance = pier['sourcePlacement']
            raw = (ROOT / provenance['sourceFile']).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), provenance['compressedSha256'])
            self.assertEqual(hashlib.sha256(gzip.decompress(raw)).hexdigest(), provenance['sha256'])
            self.assertEqual(provenance['tags']['man_made'], 'pier')
            self.assertTrue(pier['widthEstimated'])
            self.assertTrue(pier['heightEstimated'])
            self.assertEqual(len(pier['points']), len(provenance['coordinatesWGS84']))
            bounds = self.source['boundsWGS84']
            for (x, y), (lon, lat) in zip(pier['points'], provenance['coordinatesWGS84']):
                self.assertAlmostEqual(x, (lon-bounds['west'])/(bounds['east']-bounds['west'])*self.source['worldWidth'], places=2)
                self.assertAlmostEqual(y, (bounds['north']-lat)/(bounds['north']-bounds['south'])*self.source['worldHeight'], places=2)

    def test_every_reviewed_boat_group_is_accounted_for_and_water_patches_are_real(self):
        observations = [v for v in self.objects['vehicles'] + self.objects['excludedObservations'] if v.get('mobilityType') == 'boat']
        self.assertEqual({v['sourcePlacement']['observationGroup'] for v in observations}, set(range(107)))
        for boat in observations:
            p = boat['sourcePlacement']
            self.assertGreaterEqual(p['supportPixelCount'], 20)
            tile = self.sources[p['tileId']]
            b = tile['boundsWorld'];patch = boat['groundPatch']['sourceBoundsWorld']
            rect = ((patch['x']-b['x'])*tile['width']/b['w'], (patch['y']-b['y'])*tile['height']/b['h'])
            with Image.open(ROOT / tile['url'].removeprefix('./')) as im:
                crop = im.crop((rect[0],rect[1],rect[0]+patch['w']*tile['width']/b['w'],rect[1]+patch['h']*tile['height']/b['h']))
                red,green,blue = ImageStat.Stat(crop).mean
            self.assertGreater(blue, red + 5, boat['id'])
            self.assertLess(red, 75, boat['id'])
            self.assertIn(boat['sourcePierId'], {p['id'] for p in self.objects['piers']})
        groups = defaultdict(list)
        for boat in observations:groups[boat['sourcePlacement']['observationGroup']].append(boat)
        for group,count in ((45,4),(60,6),(71,4),(79,8),(80,7)):
            self.assertEqual(len(groups[group]), count)

    def test_exclusions_preserve_full_sources_and_real_calvi_aircraft_boundary(self):
        excluded = self.objects['excludedObservations']
        self.assertTrue(all(v.get('excludedReason') for v in excluded))
        self.assertFalse(any(v.get('excludedReason') for v in self.objects['vehicles']))
        outside = [v for v in excluded if v.get('mobilityType') == 'plane']
        self.assertEqual(len(outside), 4)
        self.assertTrue(all(v['excludedReason'].startswith('outside-calvi-administrative-boundary') for v in outside))
        self.assertEqual(len([v for v in self.objects['vehicles'] if v.get('mobilityType') == 'plane']), 2)
        for plane in outside:
            self.assertFalse(any(inside_ring(plane['x'],plane['y'],polygon['outer']) and not any(inside_ring(plane['x'],plane['y'],hole) for hole in polygon.get('holes',[])) for polygon in self.city['municipalBoundary']['polygons']))
        self.assertIn('photo-car-port-extension-27', {v['id'] for v in excluded})

    def test_physical_boat_hull_vertices_are_unbuffered_native_photo_pixels(self):
        photos = {}
        tiles = self.source['annotationSources']
        for boat in self.objects['vehicles'] + self.objects['excludedObservations']:
            if boat.get('mobilityType') != 'boat':
                continue
            body = boat['bodyPolygonWorld']
            self.assertGreaterEqual(len(body), 3)
            for x,y in body:
                tile = next(t for t in tiles if t['boundsWorld']['x'] <= x < t['boundsWorld']['x'] + t['boundsWorld']['w'] and t['boundsWorld']['y'] <= y < t['boundsWorld']['y'] + t['boundsWorld']['h'])
                if tile['id'] not in photos:
                    with Image.open(ROOT / tile['url'].removeprefix('./')) as im:photos[tile['id']] = im.convert('RGB')
                b = tile['boundsWorld']
                pixel = photos[tile['id']].getpixel((round((x-b['x'])*tile['width']/b['w']),round((y-b['y'])*tile['height']/b['h'])))
                self.assertGreater(min(pixel), 135, boat['id'])
                self.assertLess(max(pixel)-min(pixel), 90, boat['id'])

    def test_object_budget_and_artistic_limits_are_explicit(self):
        metadata = self.objects['metadata']
        self.assertLessEqual(len(self.objects['vegetation']), AERIAL.MAX_VEGETATION)
        self.assertEqual(metadata['vegetationCount'], len(self.objects['vegetation']))
        self.assertEqual(metadata['vehicleCount'], len(self.objects['vehicles']))
        self.assertFalse(metadata['photographModified'])
        self.assertIn('not exhaustive', metadata['vegetationNote'])
        self.assertIn('not an exhaustive', metadata['vehiclesNote'])
        for item in self.objects['vegetation']:
            self.assertTrue(item['estimatedHeight'])
            self.assertIn('not measured', item['heightSource'])


if __name__ == '__main__':
    unittest.main()
