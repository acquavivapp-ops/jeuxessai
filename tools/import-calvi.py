#!/usr/bin/env python3
"""Import a local OSM/Overpass extract into Blue Night's offline vector map.

The input must be real downloaded data, never a generated stand-in. This script
uses only Python's standard library and does not contact a map service unless
--download is explicitly supplied. Coordinates use local equirectangular metres
at the middle latitude of the documented Calvi extraction.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET

EARTH_RADIUS = 6_378_137
DEFAULT_BOUNDS = (8.7545, 42.560, 8.765, 42.570)
WIDTHS = {
    "primary": 9, "secondary": 8, "tertiary": 7,
    "residential": 5.5, "unclassified": 5.5, "service": 4,
    "living_street": 4, "pedestrian": 3.5, "footway": 2.5,
    "path": 2, "steps": 2,
}


def read_osm(raw):
    """Normalize both OSM API XML and Overpass JSON without discarding tags."""
    if raw.lstrip().startswith(b"<"):
        root = ET.fromstring(raw)
        nodes = {int(n.attrib["id"]): {"lat": float(n.attrib["lat"]), "lon": float(n.attrib["lon"])} for n in root.findall("node")}
        ways = {}
        for way in root.findall("way"):
            ids = [int(n.attrib["ref"]) for n in way.findall("nd")]
            if any(n not in nodes for n in ids):
                continue
            ways[int(way.attrib["id"])] = {
                "type": "way", "id": int(way.attrib["id"]), "nodes": ids,
                "geometry": [nodes[n] for n in ids],
                "tags": {t.attrib["k"]: t.attrib["v"] for t in way.findall("tag")},
            }
        relations = []
        for rel in root.findall("relation"):
            members = []
            for member in rel.findall("member"):
                if member.attrib["type"] == "way":
                    reference = int(member.attrib["ref"])
                    source = ways.get(reference, {"type": "way", "id": reference, "geometry": []})
                    members.append({**source, "ref": reference, "role": member.attrib.get("role", "")})
            relations.append({"type": "relation", "id": int(rel.attrib["id"]), "members": members, "tags": {t.attrib["k"]: t.attrib["v"] for t in rel.findall("tag")}})
        places = [{"type": "node", "id": int(n.attrib["id"]), **nodes[int(n.attrib["id"])], "tags": {t.attrib["k"]: t.attrib["v"] for t in n.findall("tag")}} for n in root.findall("node") if n.findall("tag")]
        return list(ways.values()) + relations + places, root.attrib.get("timestamp", "")
    document = json.loads(raw)
    if not isinstance(document.get("elements"), list):
        raise ValueError("Expected an OSM API XML or Overpass JSON document")
    return document["elements"], document.get("osm3s", {}).get("timestamp_osm_base", "")


def clip_segment(a, b, width, height):
    dx, dy = b[0] - a[0], b[1] - a[1]
    start, end = 0, 1
    for p, q in ((-dx, a[0]), (dx, width - a[0]), (-dy, a[1]), (dy, height - a[1])):
        if abs(p) < 1e-12:
            if q < 0:
                return None
            continue
        t = q / p
        if p < 0:
            start = max(start, t)
        else:
            end = min(end, t)
        if start > end:
            return None
    return [[a[0] + dx * start, a[1] + dy * start], [a[0] + dx * end, a[1] + dy * end]]


def clip_line(points, width, height):
    parts = []
    for a, b in zip(points, points[1:]):
        segment = clip_segment(a, b, width, height)
        if not segment:
            continue
        if parts and math.dist(parts[-1][-1], segment[0]) < 1e-4:
            parts[-1].append(segment[1])
        else:
            parts.append(segment)
    return parts


def clip_polygon(points, width, height):
    """Sutherland–Hodgman clipping preserves the actual footprint vertices."""
    if points and points[0] == points[-1]:
        points = points[:-1]
    for axis, edge, keep_low in ((0, 0, False), (0, width, True), (1, 0, False), (1, height, True)):
        output = []
        if not points:
            return []
        previous = points[-1]
        previous_inside = previous[axis] <= edge if keep_low else previous[axis] >= edge
        for point in points:
            inside = point[axis] <= edge if keep_low else point[axis] >= edge
            if inside != previous_inside:
                ratio = (edge - previous[axis]) / (point[axis] - previous[axis])
                output.append([previous[0] + ratio * (point[0] - previous[0]), previous[1] + ratio * (point[1] - previous[1])])
            if inside:
                output.append(point)
            previous, previous_inside = point, inside
        points = output
    return points + [points[0]] if len(points) >= 3 else []


def join_lines(lines):
    pending = [list(line) for line in lines if len(line) >= 2]
    joined = []
    while pending:
        line = pending.pop(0)
        changed = True
        while changed:
            changed = False
            for i, other in enumerate(pending):
                if math.dist(line[-1], other[0]) < .02:
                    line.extend(other[1:])
                elif math.dist(line[-1], other[-1]) < .02:
                    line.extend(reversed(other[:-1]))
                elif math.dist(line[0], other[-1]) < .02:
                    line = other[:-1] + line
                elif math.dist(line[0], other[0]) < .02:
                    line = list(reversed(other[1:])) + line
                else:
                    continue
                pending.pop(i)
                changed = True
                break
        joined.append(line)
    return joined


def rounded(points):
    return [[round(x, 2), round(y, 2)] for x, y in points]


def area(points):
    return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:]))) / 2


def signed_area(points):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:])) / 2


def coastline_masks(shorelines, width, height):
    """Close one mainland coast at the map border, preserving OSM orientation.

    OSM coastline ways keep land on their left in geographical coordinates.
    The north-up screen's reversed Y makes the land ring's signed area negative.
    A disjoint mainland coast requires a different extract; refusing it is safer
    than treating one of its land/sea components as guessed geometry.
    """
    open_lines, islands = [], []
    for line in shorelines:
        if math.dist(line[0], line[-1]) < .05:
            islands.append(line)
        else:
            open_lines.append(line)
    if len(open_lines) != 1:
        raise ValueError("Coastline must form one complete mainland chain across the bounds. Include all coast ways, or adjust the bounds; no guessed land mask was written")
    line = open_lines[0]
    perimeter = 2 * (width + height)
    def edge_position(point):
        x, y = point
        if abs(y) < .05:
            return x
        if abs(x - width) < .05:
            return width + y
        if abs(y - height) < .05:
            return width + height + width - x
        if abs(x) < .05:
            return 2 * width + height + height - y
        raise ValueError("A coastline endpoint lies inside the bounds: the downloaded extract is incomplete")
    start, end = edge_position(line[0]), edge_position(line[-1])
    corners = [(0, [0, 0]), (width, [width, 0]), (width + height, [width, height]), (2 * width + height, [0, height])]
    def closure(clockwise):
        delta = (start - end) % perimeter if clockwise else (end - start) % perimeter
        encountered = []
        for position, corner in corners:
            travel = (position - end) % perimeter if clockwise else (end - position) % perimeter
            if 1e-5 < travel < delta - 1e-5:
                encountered.append((travel, corner))
        return line + [p for _, p in sorted(encountered)] + [line[0]]
    candidates = [closure(True), closure(False)]
    land = next((ring for ring in candidates if signed_area(ring) < 0), None)
    sea = next((ring for ring in candidates if signed_area(ring) > 0), None)
    if not land or not sea:
        raise ValueError("Coastline closure has inconsistent orientation; output was not written")
    return [rounded(land)] + [rounded(ring) for ring in islands if signed_area(ring) < 0], [rounded(sea)]


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary.write(content)
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, path)


def in_ring(point, ring):
    x, y = point
    result = False
    for a, b in zip(ring, ring[1:]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            result = not result
    return result


def inside_boundary(point, polygons):
    return any(in_ring(point, polygon[0]) and not any(in_ring(point, hole) for hole in polygon[1:]) for polygon in polygons)


def clip_boundary_line(points, polygons, edges):
    """Keep real street segments inside the actual municipal contour."""
    parts = []
    for a, b in zip(points, points[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        low_x, high_x, low_y, high_y = min(a[0], b[0]), max(a[0], b[0]), min(a[1], b[1]), max(a[1], b[1])
        cuts = [0.0, 1.0]
        for c, d in edges:
            if max(c[0], d[0]) < low_x or min(c[0], d[0]) > high_x or max(c[1], d[1]) < low_y or min(c[1], d[1]) > high_y:
                continue
            ex, ey = d[0] - c[0], d[1] - c[1]
            denominator = dx * ey - dy * ex
            if abs(denominator) < 1e-10:
                continue
            t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / denominator
            u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / denominator
            if 0 < t < 1 and 0 <= u <= 1:
                cuts.append(t)
        cuts = sorted(set(cuts))
        for start, end in zip(cuts, cuts[1:]):
            middle = (start + end) / 2
            if not inside_boundary([a[0] + dx * middle, a[1] + dy * middle], polygons):
                continue
            segment = [[a[0] + dx * t, a[1] + dy * t] for t in (start, end)]
            if parts and math.dist(parts[-1][-1], segment[0]) < 1e-4:
                parts[-1].append(segment[1])
            else:
                parts.append(segment)
    return parts


def project_map(elements, bounds, scale, source, timestamp, raw_hash, boundary=None):
    west, south, east, north = bounds
    latitude = math.radians((south + north) / 2)
    metres_x = EARTH_RADIUS * math.cos(latitude) * math.pi / 180
    metres_y = EARTH_RADIUS * math.pi / 180
    width, height = round((east - west) * metres_x * scale, 2), round((north - south) * metres_y * scale, 2)
    project = lambda p: [(p["lon"] - west) * metres_x * scale, (north - p["lat"]) * metres_y * scale]
    roads, buildings, shorelines, areas, places = [], [], [], [], []
    municipal = None
    municipal_polygons = None
    boundary_edges = []
    if boundary:
        if boundary.get("type") != "Feature" or boundary.get("properties", {}).get("insee") != "2B050" or boundary.get("geometry", {}).get("type") != "MultiPolygon":
            raise ValueError("Expected the documented real Calvi municipal boundary")
        municipal_polygons = [[[project({"lon": p[0], "lat": p[1]}) for p in ring] for ring in polygon] for polygon in boundary["geometry"]["coordinates"]]
        boundary_edges = [(a, b) for polygon in municipal_polygons for ring in polygon for a, b in zip(ring, ring[1:])]
        municipal = {key: boundary["properties"][key] for key in ("name", "insee", "source", "sourceId", "bounds", "areaSquareKm", "areaMethod", "metadata")}
        municipal["polygons"] = [{"outer": rounded(polygon[0]), "holes": [rounded(ring) for ring in polygon[1:]]} for polygon in municipal_polygons]
    belongs = lambda point: not municipal_polygons or inside_boundary(point, municipal_polygons)
    def intersects_footprint(polygon):
        if not municipal_polygons:
            return True
        center = [sum(p[0] for p in polygon[:-1]) / (len(polygon) - 1), sum(p[1] for p in polygon[:-1]) / (len(polygon) - 1)]
        return belongs(center) or any(belongs(point) for point in polygon)
    def add_place(element, points):
        tags = element.get("tags", {})
        named = tags.get("name") or tags.get("name:fr") or tags.get("name:co")
        landmark = tags.get("railway") in ("station", "halt") or tags.get("aeroway") in ("aerodrome", "terminal") or tags.get("historic") in ("castle", "fort", "citywalls") or tags.get("natural") in ("beach", "cape") or tags.get("leisure") == "marina" or tags.get("man_made") == "lighthouse"
        if not named or not landmark or not points:
            return
        position = points[0] if element["type"] == "node" else [sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)]
        position_method = "source node" if element["type"] == "node" else "vertex mean of actual source geometry, not an entrance survey"
        if not belongs(position) and element["type"] != "node":
            actual_vertex = next((p for p in points if belongs(p)), None)
            if actual_vertex is not None:
                position = actual_vertex
                position_method = "actual source boundary vertex inside municipality; the geometry mean is outside"
        if belongs(position):
            places.append({"id": f'osm-place-{element["type"]}-{element["id"]}', "osmId": element["id"], "osmType": element["type"], "name": named,
                "x": round(position[0], 2), "y": round(position[1], 2), "positionMethod": position_method, "osmTags": tags})
    occupied_relation_ways = set()
    # Courtyards must remain courtyards, rather than an enclosing collision box.
    for relation in (e for e in elements if e.get("type") == "relation" and e.get("tags", {}).get("building") not in (None, "no")):
        members = [m for m in relation.get("members", []) if m.get("type") == "way"]
        if not members or any(not m.get("geometry") or any(p is None for p in m["geometry"]) for m in members):
            raise ValueError(f"Building relation {relation['id']} is missing member geometry; include all member ways before importing")
        outers = join_lines([[project(p) for p in m.get("geometry", []) if p] for m in members if m.get("role") in ("outer", "")])
        inners = join_lines([[project(p) for p in m.get("geometry", []) if p] for m in members if m.get("role") == "inner"])
        for ring in outers + inners:
            if len(ring) < 4 or math.dist(ring[0], ring[-1]) > .02:
                raise ValueError(f"Building relation {relation['id']} contains an incomplete ring; include all member ways before importing")
        for index, ring in enumerate(outers):
            polygon = clip_polygon(ring, width, height)
            if area(polygon) > 6 * scale * scale and intersects_footprint(polygon):
                buildings.append({"id": f"osm-rel-{relation['id']}-{index}", "osmId": relation['id'], "osmType": "relation", "polygon": rounded(polygon), "holes": [rounded(clip_polygon(hole, width, height)) for hole in inners if clip_polygon(hole, width, height)], "osmTags": relation.get("tags", {})})
        occupied_relation_ways.update(m.get("ref", m.get("id")) for m in members)
    for element in elements:
        if element.get("type") == "node":
            add_place(element, [project(element)])
            continue
        if element.get("type") != "way":
            continue
        geometry = element.get("geometry", [])
        tags = element.get("tags", {})
        if len(geometry) < 2 or any(p is None for p in geometry):
            if tags.get("building") not in (None, "no") or "highway" in tags or tags.get("natural") == "coastline":
                raise ValueError(f"Way {element['id']} has incomplete geometry; request out geom with all source vertices")
            continue
        points = [project(p) for p in geometry]
        add_place(element, points)
        if "highway" in tags and tags["highway"] not in ("construction", "proposed"):
            parts = clip_line(points, width, height)
            if municipal_polygons:
                parts = [piece for part in parts for piece in clip_boundary_line(part, municipal_polygons, boundary_edges)]
            for index, part in enumerate(parts):
                if sum(math.dist(a, b) for a, b in zip(part, part[1:])) < 2 * scale:
                    continue
                highway = tags["highway"]
                original_ids = element.get("nodes", [])
                node_ids = []
                for point in part:
                    original = next((i for i, p in enumerate(points) if math.dist(point, p) < 1e-4), None)
                    node_ids.append(str(original_ids[original]) if original is not None and original < len(original_ids) else f"clip-{element['id']}-{index}-{len(node_ids)}")
                roads.append({"id": f"osm-road-{element['id']}-{index}", "points": rounded(part), "nodeIds": node_ids, "width": round(WIDTHS.get(highway, 4) * scale, 2), "name": tags.get("name", ""), "type": highway, "pedestrian": highway in ("pedestrian", "footway", "steps", "path"), "layer": tags.get("layer", "0"), "bridge": tags.get("bridge", "no"), "tunnel": tags.get("tunnel", "no"), "osmId": element["id"], "osmTags": tags})
        if tags.get("building") not in (None, "no") and element["id"] not in occupied_relation_ways:
            if len(points) < 4 or math.dist(points[0], points[-1]) > .02:
                raise ValueError(f"Building way {element['id']} is not a complete closed footprint")
            polygon = clip_polygon(points, width, height)
            if area(polygon) > 6 * scale * scale and intersects_footprint(polygon):
                buildings.append({"id": f"osm-building-{element['id']}", "osmId": element['id'], "osmType": "way", "polygon": rounded(polygon), "holes": [], "osmTags": tags})
        if tags.get("natural") == "coastline":
            shorelines.append(points)
        if tags.get("natural") in ("beach", "wood", "scrub") or "landuse" in tags or tags.get("leisure") in ("park", "garden", "marina") or tags.get("amenity") == "parking" or tags.get("aeroway") == "aerodrome":
            polygon = clip_polygon(points, width, height)
            if polygon and intersects_footprint(polygon):
                areas.append({"id": f"osm-area-{element['id']}", "osmId": element["id"], "osmType": "way", "polygon": rounded(polygon), "kind": tags.get("natural", tags.get("leisure", tags.get("landuse", tags.get("amenity", tags.get("aeroway"))))), "name": tags.get("name", ""), "osmTags": tags})
    joined_shores = join_lines(shorelines)
    mainland_shores = [line for line in joined_shores if math.dist(line[0], line[-1]) >= .05]
    island_shores = [line for line in joined_shores if math.dist(line[0], line[-1]) < .05]
    clipped_mainland = [rounded(part) for line in mainland_shores for part in clip_line(line, width, height)]
    # A closed real island clipped at a map edge becomes an open coastal line.
    # Preserve its known complete source polygon rather than misclassifying it
    # as a second incomplete mainland coast or inventing its missing edge.
    land_polygons, sea_polygons = coastline_masks(clipped_mainland, width, height)
    land_polygons.extend(rounded(polygon) for line in island_shores if signed_area(line) < 0 for polygon in [clip_polygon(line, width, height)] if polygon)
    clipped_shores = clipped_mainland + [rounded(part) for line in island_shores for part in clip_line(line, width, height)]
    return {
        "status": "ready",
        "metadata": {"city": "Calvi", "source": "OpenStreetMap", "sourceUrl": source, "license": "ODbL-1.0", "attribution": "© OpenStreetMap contributors", "downloadedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "osmTimestamp": timestamp, "sha256": raw_hash, "bounds": {"west": west, "south": south, "east": east, "north": north}, "projection": "local equirectangular metres at the extract's middle latitude, north up", "pixelsPerMetre": scale, "roadWidths": "Illustrative widths inferred from highway class, not measured OSM widths"},
        "width": width, "height": height,
        "roads": roads, "buildings": buildings,
        "shorelines": clipped_shores,
        "landPolygons": land_polygons, "seaPolygons": sea_polygons,
        "coastalSeaMask": True,
        "areas": areas, "places": places, "municipalBoundary": municipal,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_file", type=Path, nargs="?", help="Downloaded OSM API XML or Overpass JSON (optionally .gz)")
    parser.add_argument("--input", type=Path, help="Alternative explicit input-file argument")
    parser.add_argument("--output", type=Path, default=Path("data/calvi-map.js"))
    parser.add_argument("--bounds", type=float, nargs=4, metavar=("WEST", "SOUTH", "EAST", "NORTH"), default=DEFAULT_BOUNDS)
    parser.add_argument("--scale", type=float, default=4, help="Pixels per real metre (default: 4)")
    parser.add_argument("--source-url", default="https://www.openstreetmap.org/#map=16/42.563/8.7565")
    parser.add_argument("--boundary", type=Path, help="The validated real Calvi boundary GeoJSON; its exact bounds override --bounds")
    parser.add_argument("--download-provenance", type=Path, help="Original request records when the OSM extract was assembled from archived API pieces")
    parser.add_argument("--download", help="Explicit public OSM API/Overpass URL; save its untouched response as input")
    args = parser.parse_args()
    boundary = json.loads(args.boundary.read_text()) if args.boundary else None
    if boundary:
        bb = boundary["properties"]["bounds"]
        args.bounds = [bb[k] for k in ("west", "south", "east", "north")]
    input_path = args.input or args.input_file
    if not input_path:
        parser.error("Supply an input file path, also when using --download")
    if args.scale <= 0 or not (args.bounds[0] < args.bounds[2] and args.bounds[1] < args.bounds[3]):
        parser.error("Scale must be positive and bounds must be west,south,east,north")
    if args.download:
        request = urllib.request.Request(args.download, headers={"User-Agent": "BlueNight-map-import/1.0 (local game development)"})
        with urllib.request.urlopen(request, timeout=45) as response:
            downloaded = response.read()
        atomic_write(input_path, gzip.compress(downloaded, mtime=0) if input_path.suffix == ".gz" else downloaded)
        args.source_url = args.download
    raw = input_path.read_bytes()
    if input_path.suffix == ".gz":
        raw = gzip.decompress(raw)
    elements, timestamp = read_osm(raw)
    document = project_map(elements, args.bounds, args.scale, args.source_url, timestamp, hashlib.sha256(raw).hexdigest(), boundary)
    if boundary:
        document["metadata"]["municipality"] = {key: document["municipalBoundary"][key] for key in ("name", "insee", "source", "sourceId", "bounds", "areaSquareKm")}
    document["metadata"]["importedAt"] = document["metadata"]["downloadedAt"]
    document["metadata"]["downloadedAt"] = dt.datetime.fromtimestamp(input_path.stat().st_mtime, tz=dt.timezone.utc).isoformat()
    document["metadata"]["inputFormat"] = "OSM API XML" if raw.lstrip().startswith(b"<") else "Overpass JSON"
    if args.download_provenance:
        download_provenance = json.loads(args.download_provenance.read_text())
        if download_provenance.get("sha256") != hashlib.sha256(raw).hexdigest():
            raise ValueError("Assembled OSM extract differs from its download provenance")
        document["metadata"]["sourceRequests"] = [request["url"] for request in download_provenance["requests"]]
        document["metadata"]["sourceAssembly"] = download_provenance["assembly"]
        document["metadata"]["sourceSnapshotNote"] = download_provenance["snapshotNote"]
    if not document["roads"] or not document["buildings"] or not document["shorelines"]:
        raise ValueError("Extract must contain real streets, building footprints and coastline; output was not written")
    output_text = "// Generated from the documented OSM extract; see data/SOURCES.md.\nexport const CALVI_MAP = " + json.dumps(document, ensure_ascii=False, separators=(",", ":")) + ";\n"
    provenance = {**document["metadata"], "rawExtract": str(input_path), "generatedModule": str(args.output), "counts": {"roads": len(document["roads"]), "buildings": len(document["buildings"]), "coastlines": len(document["shorelines"]), "places": len(document["places"]), "areas": len(document["areas"])}}
    atomic_write(args.output.with_name("calvi-provenance.json"), (json.dumps(provenance, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    source_rows = ["kind,osm_type,source_id"]
    source_rows.extend(f"road,way,{road['osmId']}" for road in document["roads"])
    source_rows.extend(f"building,{building['osmType']},{building['osmId']}" for building in document["buildings"])
    atomic_write(args.output.with_name("calvi-source-ids.csv"), ("\n".join(source_rows) + "\n").encode("utf-8"))
    atomic_write(args.output, output_text.encode("utf-8"))
    print(f"Imported {len(document['roads'])} road sections, {len(document['buildings'])} buildings, {len(document['shorelines'])} coastline sections; {document['width']} × {document['height']} world pixels")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, EOFError, ET.ParseError) as error:
        print(f"Calvi import failed: {error}. The existing map module was preserved. Download a complete public OSM extract on an allowed network and run this command with --input PATH, or enable the requested OSM host and retry.", file=sys.stderr)
        sys.exit(2)
