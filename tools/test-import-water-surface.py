#!/usr/bin/env python3
"""Offline water-colour checks. Synthetic colours are test inputs, not assets."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('water_surface', Path(__file__).with_name('import-water-surface.py'))
water = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(water)
try:
    from PIL import Image
except ImportError:
    Image = None


def bit(bits, index):
    return bool(bytes.fromhex(bits)[index // 8] & (1 << (7 - index % 8)))


@unittest.skipIf(Image is None, 'Pillow is required to classify actual image pixels')
class WaterPixelTests(unittest.TestCase):
    def test_dark_blue_water_is_accepted_but_land_and_white_boats_are_rejected(self):
        for colour, expected in (
            ((18, 34, 55), True), ((25, 65, 95), True),
            ((245, 245, 242), False), ((30, 80, 35), False),
            ((130, 120, 95), False), ((2, 3, 5), False),
        ):
            with self.subTest(colour=colour):
                bits = water.classify_image(Image.new('RGB', (64, 64), colour))
                self.assertEqual(bits, ('ff' if expected else '00') * 128)

    def test_one_white_boat_pixel_rejects_its_cell_even_in_otherwise_blue_water(self):
        image = Image.new('RGB', (64, 64), (18, 34, 55))
        image.putpixel((0, 0), (255, 255, 255))
        bits = water.classify_image(image)
        self.assertFalse(bit(bits, 0))
        self.assertTrue(bit(bits, 1))
        self.assertTrue(bit(bits, 32))
        self.assertEqual(sum(byte.bit_count() for byte in bytes.fromhex(bits)), 1023)

    def test_incomplete_source_edges_preserve_the_last_pixel_and_row_major_bit_order(self):
        image = Image.new('RGB', (67, 71), (18, 34, 55))
        image.putpixel((66, 70), (220, 220, 220))
        bits = water.classify_image(image)
        self.assertEqual(len(bits), 256)
        self.assertFalse(bit(bits, 1023))
        self.assertTrue(bit(bits, 1022))
        self.assertTrue(bit(bits, 991))
        self.assertEqual(sum(byte.bit_count() for byte in bytes.fromhex(bits)), 1023)

    def test_empty_pixel_cells_are_refused(self):
        image = Image.new('RGB', (16, 16), (18, 34, 55))
        with self.assertRaises(ValueError):
            water.classify_image(image)

    def test_source_bytes_must_match_the_archived_jpeg_fingerprint(self):
        image = Image.new('RGB', (64, 64), (18, 34, 55))
        encoded = io.BytesIO()
        image.save(encoded, 'JPEG')
        blob = encoded.getvalue()
        source = {'id': 'test-source', 'url': './assets/aerial/test-only.jpg',
            'width': 64, 'height': 64, 'byteLength': len(blob), 'sha256': '0' * 64,
            'boundsWorld': {'x': 0, 'y': 0, 'w': 64, 'h': 64}}
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'test-only.jpg'
            path.write_bytes(blob)
            with mock.patch.object(water, 'source_path', return_value=path):
                with self.assertRaises(ValueError):
                    water.observe_tile((0, source))
                source['sha256'] = hashlib.sha256(blob).hexdigest()
                observed = water.observe_tile((0, source))
                self.assertEqual(observed['sha256'], source['sha256'])
                self.assertEqual(observed['boundsWorld'], source['boundsWorld'])


class WaterGeometryTests(unittest.TestCase):
    def setUp(self):
        self.mapdata = {'metadata': {'sha256': 'f' * 64}}
        self.source = {'id': 'c0-r0', 'url': './assets/aerial/test-only.jpg',
            'sha256': 'e' * 64, 'width': 64, 'height': 64,
            'boundsWorld': {'x': 16, 'y': 32, 'w': 64, 'h': 64}}
        self.manifest = {'tiles': [self.source], 'detailTiles': [], 'worldWidth': 100, 'worldHeight': 100,
            'boundsWGS84': {'west': 8.75, 'east': 8.76, 'north': 42.56, 'south': 42.55}}
        self.blob = json.dumps(self.manifest).encode()
        self.data = {'status': 'ready', 'version': 1, 'metadata': {
            'boundsWGS84': copy.deepcopy(self.manifest['boundsWGS84']), 'worldWidth': 100, 'worldHeight': 100,
            'imageryManifestSha256': hashlib.sha256(self.blob).hexdigest(), 'vectorSourceSha256': 'f' * 64,
            'thresholds': copy.deepcopy(water.THRESHOLDS), 'columns': 32, 'rows': 32,
            'tileCount': 1, 'baseTileCount': 1, 'detailTileCount': 0},
            'tiles': [{**copy.deepcopy(self.source), 'lod': 0, 'columns': 32, 'rows': 32, 'bitsHex': 'ff' * 128}]}

    def test_changed_bounds_dimensions_or_hash_cannot_reuse_water_observations(self):
        water.validate_dataset(self.data, self.manifest, self.mapdata, self.blob)
        for field, value in (
            ('boundsWorld', {'x': 0, 'y': 0, 'w': 64, 'h': 64}),
            ('width', 63), ('sha256', 'a' * 64), ('lod', 1), ('bitsHex', 'ff' * 127),
        ):
            with self.subTest(field=field):
                damaged = copy.deepcopy(self.data)
                damaged['tiles'][0][field] = value
                with self.assertRaises(ValueError):
                    water.validate_dataset(damaged, self.manifest, self.mapdata, self.blob)

    def test_foreign_map_or_manifest_source_is_refused(self):
        for key, value in (('vectorSourceSha256', 'a' * 64), ('imageryManifestSha256', 'b' * 64), ('worldWidth', 101)):
            with self.subTest(field=key):
                damaged = copy.deepcopy(self.data)
                damaged['metadata'][key] = value
                with self.assertRaises(ValueError):
                    water.validate_dataset(damaged, self.manifest, self.mapdata, self.blob)

    def test_remote_or_escaping_source_urls_are_refused(self):
        for url in ('https://example.com/photo.jpg', './assets/aerial/../../private.jpg', './assets/aerial/source-2048/photo.jpg'):
            with self.assertRaises(ValueError):
                water.source_path(url)


if __name__ == '__main__':
    unittest.main()
