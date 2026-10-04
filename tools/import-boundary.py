#!/usr/bin/env python3
"""Archive the actual OSM administrative boundary for Calvi (INSEE 2B050).

This is the OSM administrative representation, not an IGN cadastral contour.
All relation members and nodes must be present; no missing edge is invented.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import math
from pathlib import Path
import sys
import urllib.request
import xml.etree.ElementTree as ET

RELATION_ID = 1151255
SOURCE_URL = f"https://api.openstreetmap.org/api/0.6/relation/{RELATION_ID}/full"
ROOT = Path(__file__).resolve().parents[1]


def join_rings(paths):
    pending, rings = [list(path) for path in paths], []
    while pending:
        ring = pending.pop(0)
        while ring[0] != ring[-1]:
            for i, other in enumerate(pending):
                if ring[-1] == other[0]:
                    ring.extend(other[1:])
                elif ring[-1] == other[-1]:
                    ring.extend(reversed(other[:-1]))
                elif ring[0] == other[-1]:
                    ring = other[:-1] + ring
                elif ring[0] == other[0]:
                    ring = list(reversed(other[1:])) + ring
                else:
                    continue
                pending.pop(i)
                break
            else:
                raise ValueError("Administrative boundary is incomplete: no edge is fabricated to close it")
        if len(ring) < 4:
            raise ValueError("Administrative ring is degenerate")
        rings.append(ring)
    return rings


def inside(point, ring):
    x, y = point
    result = False
    for a, b in zip(ring, ring[1:]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            result = not result
    return result


def parse_boundary(raw):
    root = ET.fromstring(raw)
    relation = root.find(f"relation[@id='{RELATION_ID}']")
    if relation is None:
        raise ValueError("Expected the actual Calvi administrative relation 1151255")
    tags = {tag.attrib['k']: tag.attrib['v'] for tag in relation.findall('tag')}
    if tags.get('ref:INSEE') != '2B050' or tags.get('boundary') != 'administrative' or tags.get('admin_level') != '8':
        raise ValueError("Source does not identify the Calvi municipality (INSEE 2B050)")
    nodes = {int(node.attrib['id']): [float(node.attrib['lon']), float(node.attrib['lat'])] for node in root.findall('node')}
    ways = {int(way.attrib['id']): [int(node.attrib['ref']) for node in way.findall('nd')] for way in root.findall('way')}
    by_role = {'outer': [], 'inner': []}
    for member in relation.findall('member'):
        if member.attrib.get('role') not in by_role:
            continue
        if member.attrib['type'] != 'way' or int(member.attrib['ref']) not in ways:
            raise ValueError("All administrative boundary member ways are required")
        path = ways[int(member.attrib['ref'])]
        if any(node not in nodes for node in path):
            raise ValueError("All administrative boundary nodes are required")
        by_role[member.attrib['role']].append(path)
    outer = [[nodes[node] for node in ring] for ring in join_rings(by_role['outer'])]
    inner = [[nodes[node] for node in ring] for ring in join_rings(by_role['inner'])]
    if not outer:
        raise ValueError("Source has no complete external administrative ring")
    polygons = [[ring, *[hole for hole in inner if inside(hole[0], ring)]] for ring in outer]
    if sum(len(polygon) - 1 for polygon in polygons) != len(inner):
        raise ValueError("Administrative hole is not contained by an external ring")
    points = [point for polygon in polygons for point in polygon[0]]
    bounds = {'west': min(p[0] for p in points), 'south': min(p[1] for p in points), 'east': max(p[0] for p in points), 'north': max(p[1] for p in points)}
    latitude = (bounds['north'] + bounds['south']) / 2
    sx = 6_378_137 * math.cos(math.radians(latitude)) * math.pi / 180
    sy = 6_378_137 * math.pi / 180
    def area(ring):
        # Translate before shoelace arithmetic to avoid cancellation of WGS84.
        points = [[(p[0] - bounds['west']) * sx, (p[1] - bounds['south']) * sy] for p in ring]
        return abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:]))) / 2
    square_km = sum(area(p[0]) - sum(area(hole) for hole in p[1:]) for p in polygons) / 1_000_000
    return {'type': 'Feature', 'properties': {'name': 'Calvi', 'insee': '2B050', 'source': 'OpenStreetMap administrative boundary',
        'sourceId': RELATION_ID, 'osmTags': tags, 'bounds': bounds, 'areaSquareKm': round(square_km, 6),
        'areaMethod': 'Approximate local equirectangular area of the actual OSM boundary; not an official cadastral surface'},
        'geometry': {'type': 'MultiPolygon', 'coordinates': polygons}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/calvi-boundary.geojson')
    args = parser.parse_args()
    if bool(args.download) == bool(args.input):
        parser.error('Supply --download or the complete archived --input relation')
    try:
        if args.download:
            with urllib.request.urlopen(urllib.request.Request(SOURCE_URL, headers={'User-Agent': 'BlueNight-Calvi-boundary-import/1'}), timeout=30) as response:
                raw = response.read(5_000_001)
            if len(raw) > 5_000_000:
                raise ValueError('Administrative extract exceeds the 5 MB bound')
        else:
            raw = args.input.read_bytes()
            if raw[:2] == b'\x1f\x8b':
                raw = gzip.decompress(raw)
        feature = parse_boundary(raw)
        provenance = {**feature['properties'], 'sourceUrl': SOURCE_URL, 'license': 'ODbL-1.0',
            'attribution': '© OpenStreetMap contributors', 'sha256': hashlib.sha256(raw).hexdigest(), 'rawBytes': len(raw),
            'importedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'rawSource': 'data/calvi-boundary-source.osm.xml.gz',
            'sourceKind': 'OSM administrative relation, not an IGN cadastral or historical contour'}
        feature['properties']['metadata'] = provenance
        # No existing output is changed until the full topology is validated.
        args.output.parent.mkdir(parents=True, exist_ok=True)
        (args.output.parent / 'calvi-boundary-source.osm.xml.gz').write_bytes(gzip.compress(raw, mtime=0))
        (args.output.parent / 'calvi-boundary-provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n')
        args.output.write_text(json.dumps(feature, ensure_ascii=False, separators=(',', ':')) + '\n')
        print(json.dumps({'insee': '2B050', 'bounds': provenance['bounds'], 'areaSquareKm': provenance['areaSquareKm'], 'rings': len(feature['geometry']['coordinates']), 'sha256': provenance['sha256']}))
    except (ValueError, OSError, KeyError, ET.ParseError) as error:
        print(f'Boundary import failed; no invented contour installed: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
