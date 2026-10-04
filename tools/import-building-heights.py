#!/usr/bin/env python3
"""Import genuine IGN BD TOPO WGS84 GeoJSON heights into the offline OSM map.

No height is guessed from floors, neighbouring roofs, imagery, or the SRTM DEM.
Only mutual, unambiguous footprint-overlap matches are retained. Dependencies:
Python standard library. Network access requires the explicit --download flag.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

SOURCE = "IGN BD TOPO"
LAYER = "BDTOPO_V3:batiment"
LICENSE = "Licence Ouverte / Open Licence"
ENDPOINT = "https://data.geopf.fr/wfs"
METADATA_URL = "https://data.geopf.fr/csw?" + urllib.parse.urlencode({"REQUEST": "GetRecordById", "SERVICE": "CSW", "VERSION": "2.0.2", "OUTPUTSCHEMA": "http://standards.iso.org/iso/19115/-3/mdb/2.0", "elementSetName": "full", "ID": "IGNF_BD-TOPO"})
ROOT = Path(__file__).resolve().parents[1]
EARTH_RADIUS = 6_378_137
MIN_IOU = .7
MIN_GAP = .15


def license_from_metadata(raw, product="BD TOPO", record_url=METADATA_URL):
    root = ET.fromstring(raw)
    text = ' '.join(t.strip() for t in root.itertext() if t.strip())
    normalized = re.sub(r'[^a-z0-9]+', ' ', text.lower())
    if not all(word.lower() in normalized for word in product.split()):
        raise ValueError("The official ISO record does not identify the expected product")
    clauses = []
    for element in root.iter():
        if element.tag.split('}')[-1] not in {'MD_LegalConstraints', 'useLimitation', 'otherConstraints', 'metadata'}:
            continue
        clause = ' '.join(t.strip() for t in element.itertext() if t.strip())
        if re.search(r'licence\s+ouverte|open\s+licen[cs]e', clause, re.I):
            clauses.append((clause, element))
    if not clauses:
        raise ValueError("The official ISO product record did not establish a Licence Ouverte")
    clause, element = min(clauses, key=lambda item: len(item[0]))
    version = re.search(r'(?:licence\s+ouverte|open\s+licen[cs]e)\s*(?:version\s*|v\s*)?(\d+\.\d+)', clause, re.I)
    references = [value for child in element.iter() for key, value in child.attrib.items() if key.split('}')[-1] == 'href' and value.startswith('https://')]
    return {"identifier": LICENSE, "version": version.group(1) if version else None, "providerRecord": record_url,
        "providerLicenceStatement": clause, "providerLicenceReference": references[0] if references else None,
        "recordSha256": hashlib.sha256(raw).hexdigest(), "verification": "Official IGN ISO product metadata explicitly names the open licence; CC-BY compatibility is not a licence version"}


def read_map(path):
    text = Path(path).read_text(encoding="utf-8")
    match = re.search(r"export const CALVI_MAP\s*=\s*(\{.*\})\s*;", text, re.S)
    data = json.loads(match.group(1)) if match else json.loads(text)
    bounds = data.get("metadata", {}).get("bounds")
    if data.get("status") != "ready" or not bounds or not data.get("buildings"):
        raise ValueError("A ready real OSM map and its geographic bounds are required")
    if data.get("metadata", {}).get("city") != "Calvi":
        raise ValueError("The importer is restricted to the documented Calvi extract")
    return data, hashlib.sha256(Path(path).read_bytes()).hexdigest()


def cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def signed_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:] + ring[:1])) / 2


def triangulate(ring):
    """Ear clipping supports concave footprints; malformed rings are refused."""
    points = [list(p[:2]) for p in ring]
    if points and points[0] == points[-1]:
        points.pop()
    points = [p for i, p in enumerate(points) if i == 0 or p != points[i - 1]]
    if len(points) < 3 or any(len(p) != 2 or not all(math.isfinite(v) for v in p) for p in points):
        raise ValueError("Invalid footprint ring")
    if signed_area(points) < 0:
        points.reverse()
    if signed_area(points) <= 1e-7:
        raise ValueError("Degenerate footprint ring")
    triangles = []
    while len(points) > 3:
        for i, b in enumerate(points):
            a, c = points[i - 1], points[(i + 1) % len(points)]
            if cross(a, b, c) <= 1e-9:
                continue
            others = [p for j, p in enumerate(points) if j not in {(i - 1) % len(points), i, (i + 1) % len(points)}]
            if any(min(cross(a, b, p), cross(b, c, p), cross(c, a, p)) >= -1e-9 for p in others):
                continue
            triangles.append([a, b, c])
            points.pop(i)
            break
        else:
            # Removing a strictly collinear vertex changes no footprint area.
            for i, b in enumerate(points):
                if abs(cross(points[i - 1], b, points[(i + 1) % len(points)])) <= 1e-9:
                    points.pop(i)
                    break
            else:
                raise ValueError("Non-simple or unsupported footprint ring")
            if len(points) < 3:
                raise ValueError("Degenerate footprint ring")
    triangles.append(points)
    return triangles


def triangle_intersection(a, b):
    points = a
    for p, q in zip(b, b[1:] + b[:1]):
        output = []
        if not points:
            return 0.0
        previous = points[-1]
        previous_side = cross(p, q, previous)
        for point in points:
            side = cross(p, q, point)
            if (side >= -1e-9) != (previous_side >= -1e-9):
                ratio = previous_side / (previous_side - side)
                output.append([previous[k] + ratio * (point[k] - previous[k]) for k in (0, 1)])
            if side >= -1e-9:
                output.append(point)
            previous, previous_side = point, side
        points = output
    return abs(signed_area(points)) if len(points) >= 3 else 0.0


def shape(polygons):
    triangles = []
    all_points = []
    for polygon in polygons:
        for i, ring in enumerate(polygon):
            sign = 1 if i == 0 else -1
            triangles.extend((triangle, sign) for triangle in triangulate(ring))
            all_points.extend(ring)
    area = sum(abs(signed_area(t)) * sign for t, sign in triangles)
    if area <= 1e-7:
        raise ValueError("Empty polygon area")
    return {"triangles": triangles, "area": area, "bbox": (min(p[0] for p in all_points), min(p[1] for p in all_points), max(p[0] for p in all_points), max(p[1] for p in all_points))}


def overlap(a, b):
    ax, ay, ar, ab = a["bbox"]
    bx, by, br, bb = b["bbox"]
    if ax >= br or bx >= ar or ay >= bb or by >= ab:
        return 0.0
    intersection = sum(triangle_intersection(at, bt) * sa * sb for at, sa in a["triangles"] for bt, sb in b["triangles"])
    intersection = max(0.0, min(intersection, a["area"], b["area"]))
    return intersection / (a["area"] + b["area"] - intersection)


def numeric(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (ValueError, TypeError):
        return None
    return number if math.isfinite(number) and -500 < number < 9000 else None


def height_fields(properties):
    fields = {key: numeric(properties.get(name)) for key, name in (
        ("groundMinMeters", "altitude_minimale_sol"), ("groundMaxMeters", "altitude_maximale_sol"),
        ("roofMinMeters", "altitude_minimale_toit"), ("roofMaxMeters", "altitude_maximale_toit"))}
    height = numeric(properties.get("hauteur"))
    method = "hauteur"
    if height is None and fields["roofMaxMeters"] is not None and fields["groundMinMeters"] is not None:
        height = fields["roofMaxMeters"] - fields["groundMinMeters"]
        method = "roof-max-minus-ground-min"
    if height is None or not 0 < height < 500:
        return None
    return {"heightMeters": height, "method": method, **fields}


def import_features(document, map_data, source_url, source_date=None):
    if document.get("type") != "FeatureCollection" or not isinstance(document.get("features"), list):
        raise ValueError("Expected an IGN BD TOPO GeoJSON FeatureCollection")
    crs = document.get("crs", {}).get("properties", {}).get("name", "CRS:84")
    if not any(token in crs.upper() for token in ("CRS84", "CRS:84", "4326")):
        raise ValueError("Request WGS84 longitude/latitude GeoJSON; projected CRS is unsupported")
    bounds = map_data["metadata"]["bounds"]
    latitude = (bounds["north"] + bounds["south"]) / 2
    pixels_per_metre = map_data["metadata"].get("pixelsPerMetre", 4)
    sx = EARTH_RADIUS * math.cos(math.radians(latitude)) * math.pi / 180 * pixels_per_metre
    sy = EARTH_RADIUS * math.pi / 180 * pixels_per_metre
    def project(point):
        if len(point) < 2 or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in point[:2]):
            raise ValueError("Invalid geographic coordinate")
        lon, lat = point[:2]
        if not -180 <= lon <= 180 or not -90 <= lat <= 90:
            raise ValueError("Invalid WGS84 coordinate; projected input is not accepted")
        return [(lon - bounds["west"]) * sx, (bounds["north"] - lat) * sy]
    osm = []
    for building in map_data["buildings"]:
        try:
            footprint = shape([[building["polygon"], *building.get("holes", [])]])
        except ValueError:
            continue
        osm.append({"building": building, "shape": footprint})
    sources, skipped = [], {"missingHeight": 0, "invalidGeometry": 0, "missingSourceId": 0}
    for feature in document["features"]:
        p = feature.get("properties") or {}
        fields = height_fields(p)
        if fields is None:
            skipped["missingHeight"] += 1
            continue
        source_id = p.get("cleabs") or feature.get("id") or p.get("id")
        if not source_id:
            skipped["missingSourceId"] += 1
            continue
        g = feature.get("geometry") or {}
        polygons = [g.get("coordinates")] if g.get("type") == "Polygon" else g.get("coordinates") if g.get("type") == "MultiPolygon" else None
        try:
            if not polygons:
                raise ValueError("Expected Polygon or MultiPolygon")
            footprint = shape([[[project(point) for point in ring] for ring in polygon] for polygon in polygons])
        except (ValueError, TypeError, IndexError):
            skipped["invalidGeometry"] += 1
            continue
        sources.append({"sourceId": str(source_id), "shape": footprint, "sourceDate": source_date,
            "sourceRecordDate": p.get("date_modification") or p.get("date_creation") or None,
            "acquisitionMethod": p.get("methode_d_acquisition_altimetrique") or None,
            "verticalAccuracyMeters": numeric(p.get("precision_altimetrique")), **fields})
    # A source feature and an OSM building must each be the other's clear best.
    source_cells = {}
    for si, source in enumerate(sources):
        left, top, right, bottom = source["shape"]["bbox"]
        for gx in range(math.floor(left / 256), math.floor(right / 256) + 1):
            for gy in range(math.floor(top / 256), math.floor(bottom / 256) + 1):
                source_cells.setdefault((gx, gy), []).append(si)
    candidates = []
    reverse = [[] for _ in sources]
    for oi, item in enumerate(osm):
        scores = []
        left, top, right, bottom = item["shape"]["bbox"]
        nearby = set()
        for gx in range(math.floor(left / 256), math.floor(right / 256) + 1):
            for gy in range(math.floor(top / 256), math.floor(bottom / 256) + 1):
                nearby.update(source_cells.get((gx, gy), []))
        for si in nearby:
            source = sources[si]
            score = overlap(item["shape"], source["shape"])
            if score > 0:
                scores.append((score, si))
                reverse[si].append((score, oi))
        candidates.append(sorted(scores, reverse=True))
    reverse = [sorted(scores, reverse=True) for scores in reverse]
    entries = []
    for oi, scores in enumerate(candidates):
        if not scores or scores[0][0] < MIN_IOU:
            continue
        score, si = scores[0]
        alternatives = reverse[si]
        if alternatives[0][1] != oi or (len(scores) > 1 and score - scores[1][0] < MIN_GAP) or (len(alternatives) > 1 and score - alternatives[1][0] < MIN_GAP):
            continue
        building, source = osm[oi]["building"], sources[si]
        entries.append({"osmId": building["osmId"], "sourceId": source["sourceId"], "heightMeters": source["heightMeters"],
            "method": source["method"], "sourceDate": source["sourceDate"], "sourceRecordDate": source["sourceRecordDate"],
            "acquisitionMethod": source["acquisitionMethod"], "verticalAccuracyMeters": source["verticalAccuracyMeters"], "footprint": building["polygon"],
            "match": {"method": "mutual-footprint-overlap", "iou": round(score, 6), "minimumIou": MIN_IOU, "minimumGap": MIN_GAP},
            **{key: source[key] for key in ("groundMinMeters", "groundMaxMeters", "roofMinMeters", "roofMaxMeters")}})
    if not entries:
        raise ValueError("No unambiguous source height matched the actual OSM footprints; existing data is preserved")
    return {"status": "ready", "bounds": bounds, "width": map_data["width"], "height": map_data["height"], "entries": entries,
        "metadata": {"city": "Calvi", "source": SOURCE, "layer": LAYER, "sourceUrl": source_url, "sourceLicense": LICENSE,
            "sourceDate": source_date, "importedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "sourceFeatureCount": len(document["features"]),
            "matchedBuildingCount": len(entries), "unknownBuildingCount": len(map_data["buildings"]) - len(entries), "skipped": skipped,
            "heightMeaning": "IGN source hauteur, or explicitly derived roof maximum minus ground minimum. Not a roof shape survey; field accuracy and observation epochs may vary.",
            "matching": "Mutual geometric best match: IoU >= 0.70, gap >= 0.15 in both directions. Ambiguous or changed footprints remain unknown."}}


def download(bounds):
    features = []
    urls = []
    for start in range(0, 10000, 1000):
        query = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": LAYER,
            "SRSNAME": "CRS:84", "BBOX": f'{bounds["west"]},{bounds["south"]},{bounds["east"]},{bounds["north"]},CRS:84',
            "OUTPUTFORMAT": "application/json", "COUNT": 1000, "STARTINDEX": start}
        url = ENDPOINT + "?" + urllib.parse.urlencode(query)
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "BlueNight-offline-height-importer/1"}), timeout=30) as response:
            raw = response.read(20_000_001)
        if len(raw) > 20_000_000:
            raise ValueError("The WFS response exceeds the bounded download limit")
        page = json.loads(raw)
        if page.get("type") != "FeatureCollection" or not isinstance(page.get("features"), list):
            raise ValueError("The WFS did not return a GeoJSON FeatureCollection")
        urls.append(url)
        if features and page["features"] and page["features"][0].get("id") == features[0].get("id"):
            raise ValueError("WFS pagination repeated the first page")
        features.extend(page["features"])
        if len(page["features"]) < 1000:
            return json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False).encode(), urls
    raise ValueError("WFS pagination exceeded the bounded 10,000-feature limit")


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary.write(content)
        name = temporary.name
    Path(name).replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path, help="A genuine BD TOPO GeoJSON file, optionally gzip-compressed")
    parser.add_argument("--download", action="store_true", help="Explicitly fetch the bounded official WFS subset with TLS verification")
    parser.add_argument("--map", type=Path, default=ROOT / "data/calvi-map.js")
    parser.add_argument("--output", type=Path, default=ROOT / "data/calvi-building-heights.js")
    parser.add_argument("--source-url", default=ENDPOINT, help="Document the actual original IGN service/archive or licensed mirror")
    parser.add_argument("--source-date", help="Only a documented source epoch, never an estimated building year")
    parser.add_argument("--license-record", type=Path, help="An archived official BD TOPO ISO licence record for an offline import")
    args = parser.parse_args()
    if bool(args.input) == bool(args.download):
        parser.error("Supply either a local source file or --download")
    try:
        map_data, map_sha = read_map(args.map)
        if args.download:
            raw, urls = download(map_data["metadata"]["bounds"])
            with urllib.request.urlopen(METADATA_URL, timeout=30) as response:
                license_raw = response.read(2_000_001)
        else:
            raw = args.input.read_bytes()
            if raw[:2] == b"\x1f\x8b":
                raw = gzip.decompress(raw)
            urls = [args.source_url]
            record = args.license_record or ROOT / "data/calvi-building-heights-license.xml"
            license_raw = record.read_bytes() if record.exists() else None
        license_info = license_from_metadata(license_raw) if license_raw else {"identifier": None, "version": None, "verification": "No official ISO licence record supplied with this local input"}
        data = import_features(json.loads(raw), map_data, args.source_url, args.source_date)
        sha = hashlib.sha256(raw).hexdigest()
        data["metadata"].update({"sha256": sha, "mapSha256": map_sha, "sourceArchive": "calvi-building-heights-source.geojson.gz", "license": license_info, "sourceLicense": license_info["identifier"]})
        provenance = {**data["metadata"], "bounds": data["bounds"], "requests": urls,
            "rawBytes": len(raw), "derivedHeights": sum(e["method"] != "hauteur" for e in data["entries"])}
        # Validation and matching complete before any existing output is replaced.
        atomic_write(args.output.parent / "calvi-building-heights-source.geojson.gz", gzip.compress(raw, mtime=0))
        if license_raw:
            atomic_write(args.output.parent / "calvi-building-heights-license.xml", license_raw)
        atomic_write(args.output.parent / "calvi-building-heights-provenance.json", (json.dumps(provenance, ensure_ascii=False, indent=2) + "\n").encode())
        atomic_write(args.output, ("// Generated only from the archived genuine BD TOPO subset; see BUILDING_HEIGHTS.md.\nexport const CALVI_BUILDING_HEIGHTS = " + json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + ";\n").encode())
        print(f'Imported {len(data["entries"])} authentic source heights; {data["metadata"]["unknownBuildingCount"]} buildings remain unknown. SHA-256: {sha}')
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"Height import failed; no successful height dataset was written: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
