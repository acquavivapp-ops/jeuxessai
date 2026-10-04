#!/usr/bin/env python3
"""Offline imagery atlas checks; every generated JPEG is explicitly SYNTHETIC.

Synthetic image samples exercise format validation only. They are neither
geographic observations nor assets, and are never written into the game atlas.
The map fixture mirrors the real world's dimensions to make resolution and
edge-tile regressions observable without downloading any imagery.
"""
import copy
import importlib.util
import io
import math
from pathlib import Path
import struct
import unittest
from unittest import mock
import urllib.parse


SCRIPT = Path(__file__).with_name('import-imagery-tiles.py')
spec = importlib.util.spec_from_file_location('imagery_tiles_import', SCRIPT)
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)

try:
    from PIL import Image
except ImportError:
    Image = None


# Test input only: real map extent/dimensions, no invented geographic features.
SYNTHETIC_MAP = {
    'status': 'ready', 'width': 35766.74, 'height': 30930.25,
    'metadata': {
        'city': 'Calvi', 'pixelsPerMetre': 4, 'sha256': 'f' * 64,
        'bounds': {
            'west': 8.7063593, 'south': 42.5150237,
            'east': 8.8153936, 'north': 42.5844865,
        },
    },
}


def plan():
    return importer.build_plan(copy.deepcopy(SYNTHETIC_MAP), target_mpp=.5,
                               tile_size=1024, source_tile_size=2048)


def synthetic_header(width, height):
    """Intentionally incomplete JPEG; useful for pre-decode rejection tests."""
    return (b'\xff\xd8\xff\xc0'
            + struct.pack('>HBHHB', 11, 8, height, width, 1)
            + b'\x01\x11\x00' + b'\x00' * 1500 + b'\xff\xd9')


def synthetic_jpeg(width=128, height=96, uniform=False):
    """Encode synthetic colored squares, with no photographic content."""
    if Image is None:
        raise unittest.SkipTest('Pillow is optional; a full JPEG decoder is unavailable')
    image = Image.new('RGB', (width, height), (70, 70, 70))
    if not uniform:
        image.putdata([
            ((240, 35, 70) if ((x // 4) + (y // 4)) % 2 else (20, 210, 245))
            for y in range(height) for x in range(width)
        ])
    out = io.BytesIO()
    image.save(out, format='JPEG', quality=92)
    return out.getvalue()


class ImageryAtlasPlanTests(unittest.TestCase):
    def setUp(self):
        self.manifest = plan()

    def assert_coverage(self, tiles, size):
        """Independently check every expected cell and its geographic mapping."""
        width, height = 17884, 15466
        expected = {
            (x, y, min(size, width - x), min(size, height - y))
            for y in range(0, height, size) for x in range(0, width, size)
        }
        actual = [(t['pixelRect']['x'], t['pixelRect']['y'],
                   t['pixelRect']['w'], t['pixelRect']['h']) for t in tiles]
        self.assertEqual(len(actual), len(expected))
        self.assertEqual(set(actual), expected)
        self.assertEqual(len({t['id'] for t in tiles}), len(tiles))
        bounds = SYNTHETIC_MAP['metadata']['bounds']
        lon_span = bounds['east'] - bounds['west']
        lat_span = bounds['north'] - bounds['south']
        for tile in tiles:
            px, world, geographic = tile['pixelRect'], tile['boundsWorld'], tile['boundsWGS84']
            self.assertEqual((tile['width'], tile['height']), (px['w'], px['h']))
            self.assertLessEqual(tile['width'], size)
            self.assertLessEqual(tile['height'], size)
            self.assertLessEqual(tile['width'] * tile['height'] * 4,
                                 (4 if size == 1024 else 16) * 1024 * 1024)
            self.assertAlmostEqual(world['x'], px['x'] / width * 35766.74, places=5)
            self.assertAlmostEqual(world['y'], px['y'] / height * 30930.25, places=5)
            self.assertAlmostEqual(world['w'], px['w'] / width * 35766.74, places=5)
            self.assertAlmostEqual(world['h'], px['h'] / height * 30930.25, places=5)
            self.assertAlmostEqual(geographic['west'], bounds['west'] + lon_span * px['x'] / width, places=10)
            self.assertAlmostEqual(geographic['east'], bounds['west'] + lon_span * (px['x'] + px['w']) / width, places=10)
            self.assertAlmostEqual(geographic['north'], bounds['north'] - lat_span * px['y'] / height, places=10)
            self.assertAlmostEqual(geographic['south'], bounds['north'] - lat_span * (px['y'] + px['h']) / height, places=10)

        rows = {}
        columns = {}
        for tile in tiles:
            rows.setdefault(tile['pixelRect']['y'], []).append(tile)
            columns.setdefault(tile['pixelRect']['x'], []).append(tile)
        for row in rows.values():
            row.sort(key=lambda tile: tile['pixelRect']['x'])
            self.assertEqual(row[0]['boundsWorld']['x'], 0)
            for left, right in zip(row, row[1:]):
                self.assertAlmostEqual(left['boundsWorld']['x'] + left['boundsWorld']['w'], right['boundsWorld']['x'], places=5)
                self.assertAlmostEqual(left['boundsWGS84']['east'], right['boundsWGS84']['west'], places=10)
            self.assertAlmostEqual(row[-1]['boundsWorld']['x'] + row[-1]['boundsWorld']['w'], 35766.74, places=5)
        for column in columns.values():
            column.sort(key=lambda tile: tile['pixelRect']['y'])
            self.assertEqual(column[0]['boundsWorld']['y'], 0)
            for top, bottom in zip(column, column[1:]):
                self.assertAlmostEqual(top['boundsWorld']['y'] + top['boundsWorld']['h'], bottom['boundsWorld']['y'], places=5)
                self.assertAlmostEqual(top['boundsWGS84']['south'], bottom['boundsWGS84']['north'], places=10)
            self.assertAlmostEqual(column[-1]['boundsWorld']['y'] + column[-1]['boundsWorld']['h'], 30930.25, places=5)

    def test_runtime_and_source_grids_cover_the_entire_world_without_gaps(self):
        self.assertEqual(self.manifest['image']['width'], 17884)
        self.assertEqual(self.manifest['image']['height'], 15466)
        self.assertEqual(len(self.manifest['tiles']), 288)
        self.assertEqual(len(self.manifest['sourceTiles']), 72)
        self.assert_coverage(self.manifest['tiles'], 1024)
        self.assert_coverage(self.manifest['sourceTiles'], 2048)
        importer.validate_manifest(self.manifest, SYNTHETIC_MAP)

    def test_half_metre_resolution_accounts_for_world_pixels_per_metre(self):
        for world_size, pixels in ((35766.74, 17884), (30930.25, 15466)):
            metres = world_size / SYNTHETIC_MAP['metadata']['pixelsPerMetre']
            self.assertEqual(math.ceil(metres / .5), pixels)
            self.assertLessEqual(metres / pixels, .5)
            self.assertGreater(metres / pixels, .4999)
        self.assertEqual(self.manifest['worldWidth'], 35766.74)
        self.assertEqual(self.manifest['worldHeight'], 30930.25)
        self.assertEqual(self.manifest['boundsWGS84'], SYNTHETIC_MAP['metadata']['bounds'])

    def test_real_source_request_urls_use_wms_latitude_longitude_order(self):
        for tile in self.manifest['sourceTiles']:
            url = urllib.parse.urlparse(tile['sourceUrl'])
            self.assertEqual(url.scheme, 'https')
            self.assertEqual(url.netloc, 'data.geopf.fr')
            query = urllib.parse.parse_qs(url.query)
            self.assertEqual(query['SERVICE'], ['WMS'])
            self.assertEqual(query['VERSION'], ['1.3.0'])
            self.assertEqual(query['REQUEST'], ['GetMap'])
            self.assertEqual(query['LAYERS'], ['ORTHOIMAGERY.ORTHOPHOTOS'])
            self.assertEqual(query['CRS'], ['EPSG:4326'])
            self.assertEqual(query['FORMAT'], ['image/jpeg'])
            self.assertEqual(query['WIDTH'], [str(tile['width'])])
            self.assertEqual(query['HEIGHT'], [str(tile['height'])])
            actual_bbox = [float(v) for v in query['BBOX'][0].split(',')]
            bounds = tile['boundsWGS84']
            for actual, key in zip(actual_bbox, ('south', 'west', 'north', 'east')):
                self.assertAlmostEqual(actual, bounds[key], places=10)

    def test_foreign_bbox_and_image_dimensions_are_rejected(self):
        def global_bbox(m):
            m['boundsWGS84']['west'] += .001
        def tile_bbox(m):
            m['tiles'][0]['boundsWGS84']['north'] -= .001
        def source_bbox(m):
            m['sourceTiles'][0]['boundsWGS84']['east'] += .001
        def image_dimensions(m):
            m['image']['width'] += 1
        def tile_dimensions(m):
            m['tiles'][0]['width'] -= 1
        for mutation in (global_bbox, tile_bbox, source_bbox, image_dimensions, tile_dimensions):
            with self.subTest(mutation=mutation.__name__):
                damaged = copy.deepcopy(self.manifest)
                mutation(damaged)
                with self.assertRaises(ValueError):
                    importer.validate_manifest(damaged, SYNTHETIC_MAP)

    def test_changed_map_geometry_cannot_reuse_an_old_atlas(self):
        for kind in ('world', 'bounds', 'scale', 'source'):
            with self.subTest(kind=kind):
                foreign_map = copy.deepcopy(SYNTHETIC_MAP)
                if kind == 'world':
                    foreign_map['width'] += 40
                elif kind == 'bounds':
                    foreign_map['metadata']['bounds']['east'] += .001
                elif kind == 'scale':
                    foreign_map['metadata']['pixelsPerMetre'] = 2
                else:
                    foreign_map['metadata']['sha256'] = 'e' * 64
                with self.assertRaises(ValueError):
                    importer.validate_manifest(self.manifest, foreign_map)

    def test_foreign_wms_bbox_and_request_size_are_rejected(self):
        for key, value in (('BBOX', '0,0,1,1'), ('WIDTH', '17'), ('CRS', 'EPSG:3857')):
            with self.subTest(query_key=key):
                damaged = copy.deepcopy(self.manifest)
                tile = damaged['sourceTiles'][0]
                url = urllib.parse.urlparse(tile['sourceUrl'])
                query = urllib.parse.parse_qs(url.query)
                query[key] = [value]
                tile['sourceUrl'] = urllib.parse.urlunparse(url._replace(query=urllib.parse.urlencode(query, doseq=True)))
                with self.assertRaises(ValueError):
                    importer.validate_manifest(damaged, SYNTHETIC_MAP)

    def test_foreign_coordinate_transform_cannot_reinterpret_the_same_pixels(self):
        for key, value in (('crs', 'EPSG:3857'), ('bboxAxisOrder', 'longitude,latitude'),
                           ('imageAxes', 'right=west, down=north'), ('worldWidth', 123),
                           ('imageToWorld', 'x=v; y=u')):
            with self.subTest(field=key):
                damaged = copy.deepcopy(self.manifest)
                damaged['georeferencing'][key] = value
                with self.assertRaises(ValueError):
                    importer.validate_manifest(damaged, SYNTHETIC_MAP)

    def test_runtime_urls_cannot_escape_the_local_atlas(self):
        for grid in ('tiles', 'sourceTiles'):
            for url in ('https://example.com/foreign.jpg', '//example.com/foreign.jpg',
                        '/tmp/foreign.jpg', '../foreign.jpg', './assets/aerial/../../foreign.jpg',
                        './assets/aerial/%2e%2e/foreign.jpg', './assets/aerial/..%2fforeign.jpg',
                        './assets/aerial/..\\foreign.jpg', 'file:///tmp/foreign.jpg'):
                with self.subTest(grid=grid, url=url):
                    damaged = copy.deepcopy(self.manifest)
                    damaged[grid][0]['url'] = url
                    with self.assertRaises(ValueError):
                        importer.validate_manifest(damaged, SYNTHETIC_MAP)

    def test_runtime_crops_must_remain_within_the_declared_source_tile(self):
        for kind in ('source', 'offset', 'size'):
            with self.subTest(kind=kind):
                damaged = copy.deepcopy(self.manifest)
                tile = damaged['tiles'][0]
                if kind == 'source':
                    tile['sourceTileId'] = 'c1-r1'
                elif kind == 'offset':
                    tile['sourceCrop']['x'] += 1
                else:
                    tile['sourceCrop']['w'] += 1
                with self.assertRaises(ValueError):
                    importer.validate_manifest(damaged, SYNTHETIC_MAP)

    def test_ready_manifest_requires_license_and_tile_fingerprints(self):
        damaged = copy.deepcopy(self.manifest)
        damaged['status'] = 'ready'
        with self.assertRaises(ValueError):
            importer.validate_manifest(damaged, SYNTHETIC_MAP)
        damaged['license'] = {'identifier': 'Licence Ouverte / Open Licence'}
        with self.assertRaises(ValueError):
            importer.validate_manifest(damaged, SYNTHETIC_MAP)

    def test_missing_tiles_are_rejected_in_both_grids(self):
        for key in ('tiles', 'sourceTiles'):
            with self.subTest(grid=key):
                damaged = copy.deepcopy(self.manifest)
                del damaged[key][len(damaged[key]) // 2]
                with self.assertRaises(ValueError):
                    importer.validate_manifest(damaged, SYNTHETIC_MAP)

    def test_overlap_is_rejected_even_with_unchanged_tile_count(self):
        for key in ('tiles', 'sourceTiles'):
            with self.subTest(grid=key):
                damaged = copy.deepcopy(self.manifest)
                duplicate = copy.deepcopy(damaged[key][0])
                duplicate['id'] = 'SYNTHETIC-overlapping-tile'
                if 'url' in duplicate:
                    duplicate['url'] = 'assets/calvi-orthophoto-tiles/SYNTHETIC-overlap.jpg'
                damaged[key][1] = duplicate
                with self.assertRaises(ValueError):
                    importer.validate_manifest(damaged, SYNTHETIC_MAP)

    def test_nonfinite_geographic_bounds_and_world_sizes_are_rejected(self):
        for value in (float('nan'), float('inf'), -1):
            with self.subTest(value=value):
                damaged = copy.deepcopy(self.manifest)
                damaged['tiles'][0]['boundsWorld']['w'] = value
                with self.assertRaises(ValueError):
                    importer.validate_manifest(damaged, SYNTHETIC_MAP)


class ImageryDetailPlanTests(unittest.TestCase):
    def setUp(self):
        self.base = plan()
        self.detail = importer.build_detail_plan(copy.deepcopy(SYNTHETIC_MAP))
        self.manifest = copy.deepcopy(self.base)
        self.manifest.update(copy.deepcopy(self.detail))

    def test_detail_preserves_all_original_base_cells_and_adds_two_bounded_regions(self):
        importer.validate_manifest(self.manifest, SYNTHETIC_MAP)
        self.assertEqual(self.manifest['tiles'], self.base['tiles'])
        self.assertEqual(self.manifest['sourceTiles'], self.base['sourceTiles'])
        self.assertEqual(len(self.detail['detailTiles']), 410)
        self.assertEqual(len(self.detail['detailSourceTiles']), 106)
        self.assertEqual([r['id'] for r in self.detail['detailRegions']], ['urban', 'airport'])
        self.assertEqual(sum(r['image']['width'] * r['image']['height'] for r in self.detail['detailRegions']), 382_000_000)
        self.assertEqual(self.detail['detailMetresPerPixel'], {'x': .25, 'y': .25})

    def test_each_detail_grid_covers_its_real_region_once_without_missing_edges(self):
        for region in self.detail['detailRegions']:
            rect = region['boundsWorld']
            width, height = region['image']['width'], region['image']['height']
            for field, size in (('detailTiles', 1024), ('detailSourceTiles', 2048)):
                with self.subTest(region=region['id'], grid=field):
                    expected = {(x, y, min(size, width - x), min(size, height - y))
                        for y in range(0, height, size) for x in range(0, width, size)}
                    tiles = [t for t in self.detail[field] if t['regionId'] == region['id']]
                    cells = [(t['pixelRect']['x'], t['pixelRect']['y'], t['pixelRect']['w'], t['pixelRect']['h']) for t in tiles]
                    self.assertEqual(set(cells), expected)
                    self.assertEqual(len(cells), len(expected))
                    self.assertEqual(sum(t['width'] * t['height'] for t in tiles), width * height)
                    for tile in tiles:
                        pixels, world = tile['pixelRect'], tile['boundsWorld']
                        self.assertAlmostEqual(world['x'], rect['x'] + pixels['x'])
                        self.assertAlmostEqual(world['y'], rect['y'] + pixels['y'])
                        self.assertAlmostEqual(world['w'], pixels['w'])
                        self.assertAlmostEqual(world['h'], pixels['h'])
                    self.assertEqual(min(t['boundsWorld']['x'] for t in tiles), rect['x'])
                    self.assertEqual(min(t['boundsWorld']['y'] for t in tiles), rect['y'])
                    self.assertEqual(max(t['boundsWorld']['x'] + t['boundsWorld']['w'] for t in tiles), rect['x'] + rect['w'])
                    self.assertEqual(max(t['boundsWorld']['y'] + t['boundsWorld']['h'] for t in tiles), rect['y'] + rect['h'])

    def test_detailed_source_requests_keep_geographic_axis_order_and_true_export_size(self):
        for tile in self.detail['detailSourceTiles']:
            query = urllib.parse.parse_qs(urllib.parse.urlparse(tile['sourceUrl']).query)
            self.assertEqual(query['WIDTH'], [str(tile['width'])])
            self.assertEqual(query['HEIGHT'], [str(tile['height'])])
            self.assertEqual(query['CRS'], ['EPSG:4326'])
            for number, key in zip(query['BBOX'][0].split(','), ('south', 'west', 'north', 'east')):
                self.assertAlmostEqual(float(number), tile['boundsWGS84'][key], places=10)
            self.assertIn('/source-2048/calvi-detail-', tile['url'])

    def test_detail_cells_cannot_change_urls_coordinates_sizes_or_source_crops(self):
        mutations = (
            ('url', './assets/aerial/foreign.jpg'), ('width', 512),
            ('regionId', 'foreign'), ('sourceTileId', 'detail-airport-c0-r0'),
            ('sourceCrop', {'x': 17, 'y': 0, 'w': 1024, 'h': 1024}),
            ('boundsWorld', {'x': 0, 'y': 0, 'w': 1024, 'h': 1024}),
        )
        for key, value in mutations:
            with self.subTest(field=key):
                damaged = copy.deepcopy(self.manifest)
                damaged['detailTiles'][0][key] = value
                with self.assertRaises(ValueError):
                    importer.validate_manifest(damaged, SYNTHETIC_MAP)

    def test_missing_or_duplicate_detail_cells_are_rejected_in_both_grids(self):
        for field in ('detailTiles', 'detailSourceTiles'):
            for mutation in ('missing', 'duplicate'):
                with self.subTest(grid=field, mutation=mutation):
                    damaged = copy.deepcopy(self.manifest)
                    if mutation == 'missing':
                        del damaged[field][len(damaged[field]) // 2]
                    else:
                        damaged[field][1] = copy.deepcopy(damaged[field][0])
                    with self.assertRaises(ValueError):
                        importer.validate_manifest(damaged, SYNTHETIC_MAP)

    def test_detail_resolution_and_region_boundaries_cannot_be_relabelled(self):
        for key in ('resolution', 'region'):
            damaged = copy.deepcopy(self.manifest)
            if key == 'resolution':
                damaged['detailMetresPerPixel']['x'] = .2
            else:
                damaged['detailRegions'][0]['boundsWorld']['x'] += 4
            with self.assertRaises(ValueError):
                importer.validate_manifest(damaged, SYNTHETIC_MAP)

    def test_invalid_detail_regions_and_excessive_pixel_count_are_rejected(self):
        for regions in (
            [{'id': '../foreign', 'boundsWorld': {'x': 0, 'y': 0, 'w': 100, 'h': 100}}],
            [{'id': 'outside', 'boundsWorld': {'x': -1, 'y': 0, 'w': 100, 'h': 100}}],
            [{'id': 'nan', 'boundsWorld': {'x': 0, 'y': math.nan, 'w': 100, 'h': 100}}],
            [{'id': 'a', 'boundsWorld': {'x': 0, 'y': 0, 'w': 100, 'h': 100}},
             {'id': 'b', 'boundsWorld': {'x': 50, 'y': 50, 'w': 100, 'h': 100}}],
        ):
            with self.subTest(regions=regions):
                with self.assertRaises(ValueError):
                    importer.build_detail_plan(SYNTHETIC_MAP, regions=regions)
        with self.assertRaises(ValueError):
            importer.build_detail_plan(SYNTHETIC_MAP, target_mpp=.2)

    def test_ready_detail_cells_require_actual_byte_counts_and_fingerprints(self):
        # Supply provenance for every base/fine cell, then remove one fine hash.
        ready = copy.deepcopy(self.manifest)
        ready['status'] = 'ready'
        ready['license'] = {'identifier': 'Licence Ouverte / Open Licence'}
        for field in ('tiles', 'sourceTiles', 'detailTiles', 'detailSourceTiles'):
            for tile in ready[field]:
                tile.update(byteLength=1, sha256='f' * 64)
        importer.validate_manifest(ready, SYNTHETIC_MAP)
        del ready['detailTiles'][0]['sha256']
        with self.assertRaises(ValueError):
            importer.validate_manifest(ready, SYNTHETIC_MAP)


class ImageryTileFormatTests(unittest.TestCase):
    def tile(self, width=128, height=96):
        return {'id': 'SYNTHETIC-format-fixture', 'width': width, 'height': height}

    def test_xml_html_and_incomplete_jpeg_are_rejected_even_with_jpeg_mime(self):
        for blob in (b'<ServiceException>bad layer</ServiceException>',
                     b'<html>403</html>', b'\xff\xd8broken',
                     b'\xff\xd8\xff\xe0\x00\x01\xff\xd9'):
            with self.subTest(blob=repr(blob[:24])):
                with self.assertRaises(ValueError):
                    importer.validate_tile(blob, {'contentType': 'image/jpeg'}, self.tile())

    def test_wrong_mime_is_rejected(self):
        with self.assertRaises(ValueError):
            importer.validate_tile(synthetic_header(128, 96), {'contentType': 'text/xml'}, self.tile())

    def test_jpeg_dimensions_cannot_substitute_for_the_requested_tile(self):
        with self.assertRaises(ValueError):
            importer.validate_tile(synthetic_header(64, 32), {'contentType': 'image/jpeg'}, self.tile())

    def test_decoded_tile_memory_limit_is_checked_before_full_decode(self):
        blob = synthetic_header(4096, 2048)
        with mock.patch.dict('sys.modules', {'PIL': None}):
            with self.assertRaises(ValueError):
                importer.validate_tile(blob, {'contentType': 'image/jpeg'}, self.tile(4096, 2048))

    @unittest.skipIf(Image is None, 'Optional Pillow decoder is unavailable')
    def test_synthetic_nonuniform_jpeg_is_accepted(self):
        importer.validate_tile(synthetic_jpeg(), {'contentType': 'image/jpeg'}, self.tile())

    @unittest.skipIf(Image is None, 'Optional Pillow decoder is unavailable')
    def test_matching_header_without_decodable_image_data_is_rejected(self):
        with self.assertRaises((ValueError, OSError)):
            importer.validate_tile(synthetic_header(128, 96), {'contentType': 'image/jpeg'}, self.tile())

    @unittest.skipIf(Image is None, 'Optional Pillow decoder is unavailable')
    def test_uniform_image_requires_explicit_allowance(self):
        blob = synthetic_jpeg(256, 256, uniform=True)
        tile = self.tile(256, 256)
        with self.assertRaises(ValueError):
            importer.validate_tile(blob, {'contentType': 'image/jpeg'}, tile)
        importer.validate_tile(blob, {'contentType': 'image/jpeg'}, tile, allow_uniform=True)

    @unittest.skipIf(Image is None, 'Optional Pillow decoder is unavailable')
    def test_all_black_or_white_jpeg_is_rejected_even_with_uniform_allowance(self):
        for color in (0, 255):
            with self.subTest(color=color):
                image = Image.new('RGB', (256, 256), (color, color, color))
                out = io.BytesIO()
                image.save(out, format='JPEG')
                with self.assertRaises(ValueError):
                    importer.validate_tile(out.getvalue(), {'contentType': 'image/jpeg'},
                                           self.tile(256, 256), allow_uniform=True)

    @unittest.skipIf(Image is None, 'Optional Pillow decoder is unavailable')
    def test_truncated_jpeg_is_rejected(self):
        with self.assertRaises(ValueError):
            importer.validate_tile(synthetic_jpeg()[:-2], {'contentType': 'image/jpeg'}, self.tile())


if __name__ == '__main__':
    unittest.main()
