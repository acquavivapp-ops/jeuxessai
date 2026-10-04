#!/usr/bin/env python3
"""Synthetic format/error fixtures and independent archived SRTM decode checks."""
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('import-elevation.py')
spec = importlib.util.spec_from_file_location('elevation_import', SCRIPT)
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def synthetic_tiff(pixel_is_area=False):
    """A tiny signed WGS84 TIFF with explicit sample values, never geographic data."""
    entries = {
        256: (4, [2]), 257: (4, [2]), 258: (3, [16]), 259: (3, [1]), 262: (3, [1]),
        273: (4, [0]), 274: (3, [1]), 277: (3, [1]), 278: (4, [2]), 279: (4, [8]), 339: (3, [2]),
        34264: (12, [.5, 0, 0, 8, 0, -.5, 0, 43, 0, 0, 1, 0, 0, 0, 0, 1]),
        34735: (3, [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1 if pixel_is_area else 2, 2048, 0, 1, 4326]),
    }
    offset = 8 + 2 + len(entries) * 12 + 4
    metadata, body = [], bytearray()
    for tag, (kind, values) in sorted(entries.items()):
        encoded = struct.pack('<' + {3: 'H', 4: 'I', 12: 'd'}[kind] * len(values), *values)
        pointer = encoded.ljust(4, b'\0') if len(encoded) <= 4 else struct.pack('<I', offset + len(body))
        if len(encoded) > 4:
            body.extend(encoded)
        metadata.append([tag, kind, len(values), pointer])
    strip_offset = offset + len(body)
    for entry in metadata:
        if entry[0] == 273:
            entry[3] = struct.pack('<I', strip_offset)
    return b'II' + struct.pack('<HIH', 42, 8, len(entries)) + b''.join(struct.pack('<HHI', *entry[:3]) + entry[3] for entry in metadata) + b'\0\0\0\0' + body + struct.pack('<hhhh', -12, 50, 100, 150)


class ElevationImportTests(unittest.TestCase):
    def test_geotiff_uses_signed_samples_and_north_up_geographic_transform(self):
        dem = importer.GeoTiff(synthetic_tiff())
        self.assertEqual((dem.west, dem.north, dem.dx, dem.dy), (8, 43, .5, .5))
        self.assertEqual(dem.sample(0, 0), -12)
        self.assertEqual(dem.sample(0, 1), 100)
        self.assertAlmostEqual(importer.sample_geographic(dem, 8.25, 42.75), 72)

    def test_pixel_is_area_centres_are_not_shifted_half_a_cell(self):
        dem = importer.GeoTiff(synthetic_tiff(pixel_is_area=True))
        self.assertEqual((dem.west, dem.north), (8.25, 42.75))
        self.assertEqual(importer.sample_geographic(dem, 8.25, 42.75), -12)

    def test_hgt_big_endian_signed_samples(self):
        raw = bytearray(1201 * 1201 * 2)
        struct.pack_into('>h', raw, 0, -12)
        struct.pack_into('>h', raw, (1201 * 1200) * 2, 51)
        dem = importer.Hgt(raw, 'N42E008')
        self.assertEqual(dem.sample(0, 0), -12)
        self.assertEqual(dem.sample(0, 1200), 51)
        self.assertEqual((dem.west, dem.north), (8, 43))

    def test_lzw_clear_dictionary_and_self_referencing_entry(self):
        codes = [256, 65, 66, 258, 260, 257]
        bits = ''.join(f'{code:09b}' for code in codes)
        bits += '0' * (-len(bits) % 8)
        raw = bytes(int(bits[i:i + 8], 2) for i in range(0, len(bits), 8))
        self.assertEqual(importer.decode_lzw(raw), b'ABABABA')
        with self.assertRaises(ValueError):
            importer.decode_lzw(raw[:3])

    def test_voids_and_noncovered_bounds_do_not_invent_elevation(self):
        dem = importer.GeoTiff(synthetic_tiff())
        with self.assertRaisesRegex(ValueError, 'does not cover'):
            importer.sample_geographic(dem, 9, 42)
        dem.sample = lambda column, row: -32768
        with self.assertRaisesRegex(ValueError, 'void'):
            importer.sample_geographic(dem, 8.25, 42.75)

    def test_failed_input_preserves_existing_module_and_has_no_new_archive(self):
        with tempfile.TemporaryDirectory(prefix='SYNTHETIC-elevation-') as folder:
            folder = Path(folder)
            source, output, archive, provenance = [folder / name for name in ('broken.tif', 'elevation.js', 'source.tif', 'provenance.json')]
            source.write_bytes(b'II*\0BROKEN')
            output.write_text('EXISTING VERIFIED MODULE')
            run = subprocess.run([sys.executable, str(SCRIPT), '--input', str(source), '--output', str(output), '--archive', str(archive), '--provenance', str(provenance)], capture_output=True, text=True)
            self.assertNotEqual(run.returncode, 0)
            self.assertEqual(output.read_text(), 'EXISTING VERIFIED MODULE')
            self.assertFalse(archive.exists())
            self.assertFalse(provenance.exists())
            self.assertIn('existing elevation module was preserved', run.stderr)

    def test_archived_srtm_decoding_matches_independently_read_pixel_values(self):
        # These TIFF coordinates/values were checked with Pillow's independent
        # decoder during import; Pillow is not needed to run these tests.
        source = SCRIPT.parent.parent / 'data/calvi-source-N42E008.tif'
        dem = importer.GeoTiff(source.read_bytes())
        self.assertEqual((dem.columns, dem.rows), (3601, 3601))
        self.assertAlmostEqual(dem.dx, 1 / 3600)
        for longitude, latitude, height in [(8.7609, 42.5683, 60), (8.7588, 42.5648, 0), (8.7545, 42.57, 2)]:
            x, y = round((longitude - dem.west) / dem.dx), round((dem.north - latitude) / dem.dy)
            self.assertEqual(dem.sample(x, y), height)


if __name__ == '__main__':
    unittest.main()
