#!/usr/bin/env python3
"""Download and archive bounded public OSM API pieces for the Calvi municipality.

The OSM map API caps responses at 50,000 nodes. Four real requests, recursively
split only if the documented node limit is reached, preserve every original
response and its SHA-256. Merging keeps actual object IDs/tags/coordinates.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import gzip
import hashlib
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

BASE = 'https://api.openstreetmap.org/api/0.6/'


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'BlueNight-Calvi-municipal-offline-import/1'}), timeout=60) as response:
        raw = response.read(30_000_001)
        if len(raw) > 30_000_000:
            raise ValueError('An OSM piece exceeds the 30 MB import bound')
        return raw


def quarters(bounds):
    west, south, east, north = bounds
    middle_x, middle_y = (west + east) / 2, (south + north) / 2
    return [(west, south, middle_x, middle_y), (middle_x, south, east, middle_y),
            (west, middle_y, middle_x, north), (middle_x, middle_y, east, north)]


def get_piece(item):
    index, bounds, depth = item
    url = BASE + 'map?bbox=' + ','.join(str(v) for v in bounds)
    try:
        raw = fetch(url)
    except urllib.error.HTTPError as error:
        body = error.read(1000).decode(errors='replace')
        if error.code == 400 and 'too many nodes' in body.lower() and depth < 3:
            pieces = []
            for i, quarter in enumerate(quarters(bounds)):
                pieces.extend(get_piece((f'{index}-{i}', quarter, depth + 1)))
            return pieces
        raise ValueError(f'OSM request failed HTTP {error.code}: {body}') from error
    return [{'name': f'part-{index}.osm.xml.gz', 'url': url, 'bounds': list(bounds), 'raw': raw,
        'sha256': hashlib.sha256(raw).hexdigest(), 'rawBytes': len(raw), 'downloadedAt': dt.datetime.now(dt.timezone.utc).isoformat()}]


def merge(pieces):
    objects = {}
    root = ET.Element('osm', {'version': '0.6', 'generator': 'BlueNight-merge-of-archived-OSM-responses', 'copyright': 'OpenStreetMap and contributors', 'attribution': 'https://www.openstreetmap.org/copyright', 'license': 'https://opendatacommons.org/licenses/odbl/1-0/'})
    for piece in pieces:
        document = ET.fromstring(piece['raw'])
        for element in document:
            if element.tag not in ('node', 'way', 'relation'):
                continue
            key = element.tag, int(element.attrib['id'])
            previous = objects.get(key)
            if previous is None or int(element.attrib.get('version', 0)) > int(previous.attrib.get('version', 0)):
                objects[key] = element
    for kind in ('node', 'way', 'relation'):
        for key in sorted(key for key in objects if key[0] == kind):
            root.append(objects[key])
    return root


def missing_building_relations(root):
    ways = {int(e.attrib['id']) for e in root.findall('way')}
    return [int(e.attrib['id']) for e in root.findall('relation')
        if {t.attrib['k']: t.attrib['v'] for t in e.findall('tag')}.get('building') not in (None, 'no')
        and any(m.attrib['type'] == 'way' and int(m.attrib['ref']) not in ways for m in e.findall('member'))]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--boundary', type=Path, default=Path('data/calvi-boundary.geojson'))
    parser.add_argument('--output', type=Path, default=Path('data/calvi-osm.xml.gz'))
    parser.add_argument('--parts-dir', type=Path, default=Path('data/calvi-osm-parts'))
    parser.add_argument('--download', action='store_true', required=True, help='Explicitly permit bounded public OSM downloads')
    args = parser.parse_args()
    try:
        feature = json.loads(args.boundary.read_text())
        if feature.get('properties', {}).get('insee') != '2B050':
            raise ValueError('The actual Calvi municipal boundary is required')
        b = feature['properties']['bounds']
        bounds = (b['west'] - .0002, b['south'] - .0002, b['east'] + .0002, b['north'] + .0002)
        with ThreadPoolExecutor(max_workers=2) as pool:
            groups = list(pool.map(get_piece, [(str(i), q, 0) for i, q in enumerate(quarters(bounds))]))
        pieces = [piece for group in groups for piece in group]
        merged = merge(pieces)
        for relation_id in missing_building_relations(merged):
            url = BASE + f'relation/{relation_id}/full'
            raw = fetch(url)
            pieces.append({'name': f'building-relation-{relation_id}.osm.xml.gz', 'url': url, 'raw': raw,
                'sha256': hashlib.sha256(raw).hexdigest(), 'rawBytes': len(raw), 'downloadedAt': dt.datetime.now(dt.timezone.utc).isoformat()})
        merged = merge(pieces)
        if missing_building_relations(merged):
            raise ValueError('Building relation members remain incomplete after the bounded downloads')
        raw = ET.tostring(merged, encoding='utf-8', xml_declaration=True)
        args.parts_dir.mkdir(parents=True, exist_ok=True)
        requests = []
        for piece in pieces:
            (args.parts_dir / piece['name']).write_bytes(gzip.compress(piece['raw'], mtime=0))
            requests.append({k: v for k, v in piece.items() if k != 'raw'})
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(gzip.compress(raw, mtime=0))
        provenance = {'source': 'OpenStreetMap', 'license': 'ODbL-1.0', 'attribution': '© OpenStreetMap contributors',
            'requests': requests, 'requestedBounds': dict(zip(('west', 'south', 'east', 'north'), bounds)),
            'municipalBoundarySourceId': 1151255, 'sha256': hashlib.sha256(raw).hexdigest(), 'rawBytes': len(raw),
            'assembly': 'Actual source objects deduplicated by type/ID, retaining the highest downloaded source version; no geometry or tags invented',
            'snapshotNote': 'Individual OSM requests are not an atomic global timestamp; request retrieval times are retained'}
        args.output.with_name('calvi-osm-download-provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n')
        print(f'Archived {len(pieces)} real OSM responses; {len(merged.findall("node"))} nodes, {len(merged.findall("way"))} ways; merged SHA-256 {provenance["sha256"]}')
    except (ValueError, OSError, KeyError, ET.ParseError) as error:
        print(f'Municipal OSM download failed; no map is generated: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
