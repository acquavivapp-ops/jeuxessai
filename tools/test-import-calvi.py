#!/usr/bin/env python3
"""Importer checks using SYNTHETIC geometry only, never a real Calvi snapshot."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("import-calvi.py")
spec = importlib.util.spec_from_file_location("calvi_import", SCRIPT)
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


class SyntheticImportTests(unittest.TestCase):
    def test_clip_polygon_preserves_slanted_edges(self):
        polygon = importer.clip_polygon([[-4, 2], [7, 2], [8, 8], [-4, 2]], 6, 6)
        self.assertGreaterEqual(len(polygon), 4)
        self.assertTrue(all(0 <= x <= 6 and 0 <= y <= 6 for x, y in polygon))
        self.assertTrue(any(x not in (0, 6) and y == 6 for x, y in polygon))

    def test_coast_masks_cover_bounds_without_guessing_missing_coast(self):
        land, sea = importer.coastline_masks([[[80, 100], [67, 40], [50, 0]]], 100, 100)
        self.assertAlmostEqual(importer.area(land[0]) + importer.area(sea[0]), 10000)
        self.assertLess(importer.signed_area(land[0]), 0)
        with self.assertRaises(ValueError):
            importer.coastline_masks([[[80, 100], [67, 40]]], 100, 100)

    def test_closed_source_island_clipped_at_edge_stays_land_without_a_second_mainland_chain(self):
        def coast(identifier, coordinates):
            return {"type": "way", "id": identifier, "tags": {"natural": "coastline"},
                    "geometry": [{"lon": lon, "lat": lat} for lon, lat in coordinates]}
        mainland = coast(1, [[.0008, 0], [.00065, .0005], [.0005, .001]])
        island = coast(2, [[.0001, .0011], [.0001, .0009], [.0002, .0009], [.0002, .0011], [.0001, .0011]])
        result = importer.project_map([mainland, island], (0, 0, .001, .001), 4, "SYNTHETIC TEST ONLY", "", "")
        self.assertEqual(len(result["landPolygons"]), 2)
        clipped_island = result["landPolygons"][1]
        self.assertEqual(clipped_island[0], clipped_island[-1])
        self.assertTrue(any(y == 0 for _, y in clipped_island))
        self.assertTrue(importer.in_ring([result["width"] * .15, result["height"] * .05], clipped_island))
        self.assertTrue(all(0 <= x <= result["width"] and 0 <= y <= result["height"] for x, y in clipped_island))
        self.assertEqual(len(result["shorelines"]), 2)
        self.assertNotEqual(result["shorelines"][1][0], result["shorelines"][1][-1])

    def test_osm_xml_keeps_shared_node_identity(self):
        raw = b'<osm><node id="1" lat="0" lon="0"/><node id="2" lat="1" lon="1"/><node id="3" lat="1" lon="0"/><way id="11"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way><way id="12"><nd ref="3"/><nd ref="2"/><tag k="highway" v="service"/></way></osm>'
        elements, _ = importer.read_osm(raw)
        self.assertEqual(elements[0]["nodes"][-1], elements[1]["nodes"][-1])
        self.assertEqual(elements[0]["geometry"][-1], elements[1]["geometry"][-1])

    def test_overpass_timestamp_survives(self):
        raw = json.dumps({"elements": [], "osm3s": {"timestamp_osm_base": "SYNTHETIC-TEST-TIMESTAMP"}}).encode()
        _, timestamp = importer.read_osm(raw)
        self.assertEqual(timestamp, "SYNTHETIC-TEST-TIMESTAMP")

    def test_incomplete_multipolygon_is_not_closed_by_guessing(self):
        relation = {"type": "relation", "id": 1, "tags": {"building": "yes"}, "members": [{"type": "way", "role": "outer", "geometry": [{"lon": 8.755, "lat": 42.563}, {"lon": 8.756, "lat": 42.563}, {"lon": 8.756, "lat": 42.564}]}]}
        with self.assertRaisesRegex(ValueError, "incomplete ring"):
            importer.project_map([relation], importer.DEFAULT_BOUNDS, 4, "SYNTHETIC TEST ONLY", "", "")

    def test_incomplete_extract_preserves_existing_map(self):
        with tempfile.TemporaryDirectory(prefix="synthetic-map-") as folder:
            source, output = Path(folder) / "SYNTHETIC.osm.xml", Path(folder) / "map.js"
            source.write_text('<osm><node id="1" lat="42.56" lon="8.75"/></osm>')
            output.write_text("ORIGINAL PENDING MODULE")
            result = subprocess.run([sys.executable, str(SCRIPT), "--input", str(source), "--output", str(output)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_text(), "ORIGINAL PENDING MODULE")
            self.assertIn("existing map module was preserved", result.stderr)
            self.assertFalse((Path(folder) / "calvi-provenance.json").exists())


if __name__ == "__main__":
    unittest.main()
