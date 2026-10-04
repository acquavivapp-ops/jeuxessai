#!/usr/bin/env python3
"""Synthetic format/matching fixtures only; none are Calvi measurements."""
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("height_import", Path(__file__).with_name("import-building-heights.py"))
IMPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORT)
BOUNDS = {"west": 8.7545, "south": 42.56, "east": 8.765, "north": 42.57}
RING = [[100, 100], [140, 100], [140, 140], [100, 140], [100, 100]]


def synthetic_map(buildings=None):
    return {"status": "ready", "metadata": {"city": "Calvi", "bounds": BOUNDS, "pixelsPerMetre": 4},
        "width": 3443.49, "height": 4452.78,
        "buildings": buildings or [{"osmId": 1, "polygon": RING, "osmTags": {"building:levels": "4"}}]}


def geographic(ring):
    sx = IMPORT.EARTH_RADIUS * math.cos(math.radians(42.565)) * math.pi / 180 * 4
    sy = IMPORT.EARTH_RADIUS * math.pi / 180 * 4
    return [[BOUNDS["west"] + x / sx, BOUNDS["north"] - y / sy] for x, y in ring]


def feature(ring=RING, properties=None, source_id="SYNTHETIC TEST SOURCE"):
    return {"type": "Feature", "id": source_id, "geometry": {"type": "Polygon", "coordinates": [geographic(ring)]},
        "properties": {"cleabs": source_id, **({"hauteur": 12} if properties is None else properties)}}


def document(*features):
    return {"type": "FeatureCollection", "features": list(features)}


class HeightImportTest(unittest.TestCase):
    def test_official_licence_is_product_specific_and_version_is_not_inferred_from_ccby(self):
        info = IMPORT.license_from_metadata(b'<metadata>BD TOPO; Licence Ouverte / Open License (compatible CC-BY 2.0)</metadata>')
        self.assertIsNone(info['version'])
        with self.assertRaises(ValueError):
            IMPORT.license_from_metadata(b'<metadata>BD ORTHO; Licence Ouverte</metadata>')
        with self.assertRaises(ValueError):
            IMPORT.license_from_metadata(b'<metadata>BD TOPO; all rights reserved</metadata>')

    def test_explicit_height_retains_source_fields_without_floors_guess(self):
        result = IMPORT.import_features(document(feature(properties={"hauteur": 11.8, "altitude_minimale_sol": 25.2, "altitude_maximale_toit": 38.4})), synthetic_map(), "SYNTHETIC TEST ONLY")
        entry = result["entries"][0]
        self.assertEqual(entry["heightMeters"], 11.8)
        self.assertEqual(entry["method"], "hauteur")
        self.assertEqual(entry["groundMinMeters"], 25.2)
        self.assertEqual(entry["match"]["iou"], 1)

    def test_height_derived_only_from_two_actual_source_altitudes(self):
        fields = IMPORT.height_fields({"altitude_minimale_sol": 40, "altitude_maximale_toit": 53.5})
        self.assertEqual(fields["heightMeters"], 13.5)
        self.assertEqual(fields["method"], "roof-max-minus-ground-min")
        for properties in [{"building:levels": 4}, {"altitude_maximale_toit": 53.5}, {"hauteur": -3, "altitude_minimale_sol": 40, "altitude_maximale_toit": 53.5}, {"hauteur": True}, {"hauteur": "nan"}]:
            self.assertIsNone(IMPORT.height_fields(properties))

    def test_concave_polygons_use_actual_area_instead_of_bbox(self):
        ring = [[0, 0], [40, 0], [40, 10], [10, 10], [10, 40], [0, 40], [0, 0]]
        a = IMPORT.shape([[ring]])
        self.assertAlmostEqual(a["area"], 700)
        self.assertAlmostEqual(IMPORT.overlap(a, a), 1)
        self.assertEqual(IMPORT.overlap(a, IMPORT.shape([[[[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]]]])), 0)

    def test_polygon_holes_are_subtracted_and_never_match_courtyard(self):
        hole = [[110, 110], [130, 110], [130, 130], [110, 130], [110, 110]]
        a = IMPORT.shape([[RING, hole]])
        self.assertEqual(a["area"], 1200)
        self.assertAlmostEqual(IMPORT.overlap(a, a), 1)
        self.assertAlmostEqual(IMPORT.overlap(a, IMPORT.shape([[hole]])), 0)

    def test_two_equal_source_footprints_are_ambiguous_not_nearest_guesses(self):
        with self.assertRaisesRegex(ValueError, "No unambiguous"):
            IMPORT.import_features(document(feature(source_id="a"), feature(source_id="b")), synthetic_map(), "SYNTHETIC TEST ONLY")

    def test_one_source_cannot_be_assigned_to_two_osm_buildings(self):
        buildings = [{"osmId": i, "polygon": RING} for i in (1, 2)]
        with self.assertRaisesRegex(ValueError, "No unambiguous"):
            IMPORT.import_features(document(feature()), synthetic_map(buildings), "SYNTHETIC TEST ONLY")

    def test_neighbouring_footprints_and_low_overlap_stay_unknown(self):
        shifted = [[x + 100, y] for x, y in RING]
        with self.assertRaisesRegex(ValueError, "No unambiguous"):
            IMPORT.import_features(document(feature(shifted)), synthetic_map(), "SYNTHETIC TEST ONLY")
        shifted = [[x + 10, y] for x, y in RING]  # IoU=.6, below the documented threshold.
        with self.assertRaisesRegex(ValueError, "No unambiguous"):
            IMPORT.import_features(document(feature(shifted)), synthetic_map(), "SYNTHETIC TEST ONLY")

    def test_projected_crs_and_non_features_are_refused(self):
        value = {**document(feature()), "crs": {"properties": {"name": "EPSG:2154"}}}
        with self.assertRaisesRegex(ValueError, "WGS84"):
            IMPORT.import_features(value, synthetic_map(), "SYNTHETIC TEST ONLY")
        with self.assertRaisesRegex(ValueError, "FeatureCollection"):
            IMPORT.import_features({"features": []}, synthetic_map(), "SYNTHETIC TEST ONLY")

    def test_failed_cli_import_preserves_existing_dataset(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            source = folder / "source.geojson"
            source.write_text(json.dumps(document(feature(properties={"building:levels": 4}))))
            map_file = folder / "map.json"
            map_file.write_text(json.dumps(synthetic_map()))
            output = folder / "height.js"
            output.write_text("DO NOT REPLACE ON FAILURE")
            run = subprocess.run([sys.executable, str(Path(__file__).with_name("import-building-heights.py")), str(source), "--map", str(map_file), "--output", str(output), "--source-url", "SYNTHETIC TEST ONLY"], capture_output=True, text=True)
            self.assertNotEqual(run.returncode, 0)
            self.assertEqual(output.read_text(), "DO NOT REPLACE ON FAILURE")
            self.assertFalse((folder / "calvi-building-heights-source.geojson.gz").exists())

    def test_successful_cli_archives_and_hashes_original_source(self):
        import gzip
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            raw = json.dumps(document(feature()), ensure_ascii=False).encode()
            source, map_file, output = folder / "source.geojson", folder / "map.json", folder / "height.js"
            source.write_bytes(raw)
            map_file.write_text(json.dumps(synthetic_map()))
            run = subprocess.run([sys.executable, str(Path(__file__).with_name("import-building-heights.py")), str(source), "--map", str(map_file), "--output", str(output), "--source-url", "SYNTHETIC TEST ONLY"], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            self.assertEqual(gzip.decompress((folder / "calvi-building-heights-source.geojson.gz").read_bytes()), raw)
            provenance = json.loads((folder / "calvi-building-heights-provenance.json").read_text())
            self.assertEqual(provenance["sha256"], hashlib.sha256(raw).hexdigest())
            self.assertEqual(provenance["sourceUrl"], "SYNTHETIC TEST ONLY")
            self.assertEqual(provenance["matchedBuildingCount"], 1)


if __name__ == "__main__":
    unittest.main()
