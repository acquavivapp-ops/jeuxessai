#!/usr/bin/env python3
"""Import the authentic IGN LiDAR HD MNT WMS BIL subset, with exact node alignment.

The default output is a ~20 metre municipal grid of source altitudes. The source
float32 bytes, geographic request and official product licence record are kept.
Network access is explicit; missing/nodata/error responses preserve prior data.
"""
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import struct
import sys
import urllib.parse
import urllib.request

SPEC = importlib.util.spec_from_file_location("building_import", Path(__file__).with_name("import-building-heights.py"))
HELPER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)
ROOT = Path(__file__).resolve().parents[1]
LAYER = "IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G"
ENDPOINT = "https://data.geopf.fr/wms-r/wms"
METADATA_URL = "https://data.geopf.fr/csw?" + urllib.parse.urlencode({"REQUEST": "GetRecordById", "SERVICE": "CSW", "VERSION": "2.0.2", "OUTPUTSCHEMA": "http://standards.iso.org/iso/19115/-3/mdb/2.0", "elementSetName": "full", "ID": "IGNF_MNT-LIDAR-HD"})


def request_for(bounds, columns, rows):
    if not 2 <= columns <= 1024 or not 2 <= rows <= 1024:
        raise ValueError("Grid dimensions must be 2..1024")
    # WMS returns PixelIsArea centres. Extending each edge by half a node step
    # makes the first/last returned samples lie exactly on the game map bounds.
    dx = (bounds["east"] - bounds["west"]) / (columns - 1)
    dy = (bounds["north"] - bounds["south"]) / (rows - 1)
    request_bounds = {"west": bounds["west"] - dx / 2, "south": bounds["south"] - dy / 2,
        "east": bounds["east"] + dx / 2, "north": bounds["north"] + dy / 2}
    params = {"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": LAYER,
        "STYLES": "", "CRS": "EPSG:4326", "BBOX": ",".join(str(request_bounds[k]) for k in ("south", "west", "north", "east")),
        "WIDTH": columns, "HEIGHT": rows, "FORMAT": "image/x-bil;bits=32"}
    return ENDPOINT + "?" + urllib.parse.urlencode(params), request_bounds


def decode(raw, content_type, columns, rows, required=None):
    if "bil" not in str(content_type).lower() or len(raw) != columns * rows * 4:
        raise ValueError("Expected the exact little-endian float32 BIL response; XML, images and truncated grids are refused")
    values = list(struct.unpack("<" + str(columns * rows) + "f", raw))
    if required is not None and len(required) != len(values):
        raise ValueError("Municipal land mask dimensions differ from the source grid")
    if any(not math.isfinite(value) or not -50 < value < 9000 for i, value in enumerate(values) if required is None or required[i]):
        raise ValueError("IGN grid contains nodata or invalid altitudes; no invented replacement values are allowed")
    return [round(value, 3) if required is None or required[i] else None for i, value in enumerate(values)]


def municipal_land_nodes(world, columns, rows):
    """Exact scan-line membership avoids O(grid size × boundary vertices)."""
    if not world.get('municipalBoundary'):
        return None
    def intervals(ring, y):
        xs = sorted(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]) for a, b in zip(ring, ring[1:]) if (a[1] > y) != (b[1] > y))
        return list(zip(xs[::2], xs[1::2]))
    def contains(x, segments):
        return any(a <= x < b for a, b in segments)
    required = []
    for row in range(rows):
        y = row / (rows - 1) * world['height']
        land = [segment for ring in world['landPolygons'] for segment in intervals(ring, y)]
        municipal = [(intervals(polygon['outer'], y), [segment for hole in polygon.get('holes', []) for segment in intervals(hole, y)]) for polygon in world['municipalBoundary']['polygons']]
        for column in range(columns):
            x = column / (columns - 1) * world['width']
            required.append(contains(x, land) and any(contains(x, outer) and not contains(x, holes) for outer, holes in municipal))
    if not any(required):
        raise ValueError('The real municipal/coastal polygons contain no grid nodes')
    return required


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "BlueNight-Calvi-verified-LiDAR-import/1"}), timeout=30) as response:
        raw = response.read(5_000_001)
        if len(raw) > 5_000_000:
            raise ValueError("Source exceeds the bounded 5 MB request limit")
        return raw, {"contentType": response.headers.get("Content-Type"), "lastModified": response.headers.get("Last-Modified"), "finalUrl": response.geturl()}


def self_test():
    import unittest
    class ImportChecks(unittest.TestCase):
        def test_centres_are_exactly_map_endpoints(self):
            bounds = {"west": 8.7545, "south": 42.56, "east": 8.765, "north": 42.57}
            url, requested = request_for(bounds, 173, 224)
            dx, dy = (requested["east"] - requested["west"]) / 173, (requested["north"] - requested["south"]) / 224
            self.assertAlmostEqual(requested["west"] + dx / 2, bounds["west"])
            self.assertAlmostEqual(requested["east"] - dx / 2, bounds["east"])
            self.assertAlmostEqual(requested["north"] - dy / 2, bounds["north"])
            self.assertAlmostEqual(requested["south"] + dy / 2, bounds["south"])
            params = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            self.assertEqual(params["BBOX"][0], ",".join(str(requested[k]) for k in ("south", "west", "north", "east")))
        def test_values_stay_north_up_and_preserve_valid_negative_coast_altitudes(self):
            self.assertEqual(decode(struct.pack("<4f", -.4, 1, 2, 63), "image/x-bil;bits=32", 2, 2), [-.4, 1, 2, 63])
        def test_nodata_truncated_and_error_responses_are_refused(self):
            for raw, kind in [(b'<ServiceException/>', 'text/xml'), (struct.pack('<4f', 1, 2, -9999, 4), 'image/x-bil'), (struct.pack('<4f', 1, 2, float('nan'), 4), 'image/x-bil'), (struct.pack('<3f', 1, 2, 3), 'image/x-bil')]:
                with self.assertRaises(ValueError):
                    decode(raw, kind, 2, 2)
        def test_licence_must_be_the_lidar_mnt_product(self):
            with self.assertRaises(ValueError):
                HELPER.license_from_metadata(b'<metadata>BD ORTHO Licence Ouverte</metadata>', 'MNT LiDAR', METADATA_URL)
            info = HELPER.license_from_metadata(b'<metadata>MNT LiDAR Licence Ouverte / Open License (compatible CC-BY 2.0)</metadata>', 'MNT LiDAR', METADATA_URL)
            self.assertIsNone(info['version'])
        def test_only_proven_outside_land_nodata_can_be_masked(self):
            raw = struct.pack('<4f', 10, -9999, 20, 30)
            self.assertEqual(decode(raw, 'image/x-bil', 2, 2, [True, False, True, True]), [10, None, 20, 30])
            with self.assertRaises(ValueError):
                decode(raw, 'image/x-bil', 2, 2, [True, True, True, True])
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ImportChecks))
    return 0 if result.wasSuccessful() else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--map", type=Path, default=ROOT / "data/calvi-map.js")
    parser.add_argument("--output", type=Path, default=ROOT / "data/calvi-lidar-elevation.js")
    parser.add_argument("--columns", type=int, help="Explicit source grid columns; otherwise derive from the physical spacing")
    parser.add_argument("--rows", type=int, help="Explicit source grid rows; otherwise derive from the physical spacing")
    parser.add_argument("--spacing-metres", type=float, default=20, help="Municipal source sampling spacing (default20m), not a claim about native resolution")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--source-provenance", type=Path)
    parser.add_argument("--license-record", type=Path)
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if bool(args.download) == bool(args.input):
        parser.error("Use --download or --input with its archived provenance and product licence")
    try:
        world, map_sha = HELPER.read_map(args.map)
        scale = world['metadata'].get('pixelsPerMetre', 4)
        if not math.isfinite(args.spacing_metres) or args.spacing_metres <= 0:
            raise ValueError('Source sampling spacing must be positive')
        args.columns = args.columns or math.ceil(world['width'] / scale / args.spacing_metres) + 1
        args.rows = args.rows or math.ceil(world['height'] / scale / args.spacing_metres) + 1
        bounds = world["metadata"]["bounds"]
        source_url, request_bounds = request_for(bounds, args.columns, args.rows)
        if args.download:
            raw, headers = fetch(source_url)
            record, _ = fetch(METADATA_URL)
        else:
            if not args.source_provenance or not args.license_record:
                raise ValueError("Offline import requires the archived request provenance and official licence record")
            provenance = json.loads(args.source_provenance.read_text())
            if provenance.get("sourceUrl") != source_url or provenance.get("columns") != args.columns or provenance.get("rows") != args.rows:
                raise ValueError("Archived BIL georeferencing does not match the requested node grid")
            raw, record = args.input.read_bytes(), args.license_record.read_bytes()
            headers = provenance["responseHeaders"]
            if hashlib.sha256(raw).hexdigest() != provenance.get("sha256"):
                raise ValueError("Archived source hash differs from its provenance")
        required = municipal_land_nodes(world, args.columns, args.rows)
        values = decode(raw, headers["contentType"], args.columns, args.rows, required)
        valid_values = [value for value in values if value is not None]
        license_info = HELPER.license_from_metadata(record, "MNT LiDAR", METADATA_URL)
        metadata = {"source": "IGN LiDAR HD MNT", "sourceUrl": source_url, "layer": LAYER,
            "sourceLicense": license_info["identifier"], "license": license_info, "attribution": "© IGN — MNT LiDAR HD — Licence Ouverte / Open Licence",
            "sourceArchive": "calvi-source-lidar-mnt.bil", "sha256": hashlib.sha256(raw).hexdigest(), "mapSha256": map_sha,
            "downloadedAt": provenance.get("downloadedAt") if args.input else dt.datetime.now(dt.timezone.utc).isoformat(), "observationDate": None,
            "observationDateNote": "Local airborne acquisition date and vertical reference have not been established from the product record; this is not a reconstruction of 1994.",
            "nativeProductSpacingMetres": .5, "gridSpacingMetres": {"eastWest": world["width"] / scale / (args.columns - 1), "northSouth": world["height"] / scale / (args.rows - 1)},
            "sampleGridBounds": bounds, "sourceRequestBounds": request_bounds,
            "georeferencing": {"crs": "EPSG:4326", "wmsVersion": "1.3.0", "bboxAxisOrder": "latitude,longitude", "imageAxes": "right=east, down=south", "pixelInterpretation": "PixelIsArea centres aligned with map-endpoint sample nodes by a half-step request buffer", "bilEncoding": "little-endian IEEE float32, one band, first row north"},
            "quantisationMetres": .001, "quantisationNote": "Storage rounding only; not a survey accuracy claim", "responseHeaders": headers,
            "coverage": {"scope": "Actual municipal land-node mask" if required is not None else "Full requested grid",
                "landGridCoverageVerified": True, "landNodeCount": sum(required) if required is not None else len(values),
                "validLandNodeCount": len(valid_values), "missingLandNodeCount": 0, "maskedOutsideMunicipalLandCount": len(values) - len(valid_values),
                "note": "Outside municipal land, values are explicitly null; offshore WMS nodata interpolation is never interpreted as bathymetry or filled with invented heights. All actual municipal land nodes were validated."}}
        data = {"status": "ready", "columns": args.columns, "rows": args.rows, "width": world["width"], "height": world["height"], "metresPerPixel": 1 / scale,
            "bounds": bounds, "minElevation": min(valid_values), "maxElevation": max(valid_values), "metadata": metadata, "values": values}
        provenance = {**metadata, "columns": args.columns, "rows": args.rows, "rawBytes": len(raw), "minElevation": min(valid_values), "maxElevation": max(valid_values)}
        HELPER.atomic_write(args.output.parent / "calvi-source-lidar-mnt.bil", raw)
        HELPER.atomic_write(args.output.parent / "calvi-lidar-elevation-license.xml", record)
        HELPER.atomic_write(args.output.parent / "calvi-lidar-elevation-provenance.json", (json.dumps(provenance, ensure_ascii=False, indent=2) + "\n").encode())
        HELPER.atomic_write(args.output, ("// Authentic IGN LiDAR HD MNT source grid; see ELEVATION.md.\nexport const CALVI_LIDAR_ELEVATION = " + json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + ";\n").encode())
        print(f"Imported authentic LiDAR MNT {args.columns}x{args.rows}; {len(valid_values)} valid municipal land heights, {len(values)-len(valid_values)} outside-land cells masked; range {min(valid_values)}..{max(valid_values)} m; SHA-256 {metadata['sha256']}")
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"LiDAR import failed; existing verified grid preserved: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
