#!/usr/bin/env python3
"""Fetch a real IGN orthophoto for the exact Calvi game bounds.

This is a developer import, never a game-time request. Original image bytes are
preserved. Missing imagery, an OGC error document, or unverifiable product
licensing leave existing image/provenance files untouched.
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import sys
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

BASE_URL = 'https://data.geopf.fr/wms-r/wms'
LAYER = 'ORTHOIMAGERY.ORTHOPHOTOS'
METADATA_URL = ('https://data.geopf.fr/csw?REQUEST=GetRecordById&SERVICE=CSW&VERSION=2.0.2'
                '&OUTPUTSCHEMA=http%3A%2F%2Fstandards.iso.org%2Fiso%2F19115%2F-3%2Fmdb%2F2.0'
                '&elementSetName=full&ID=IGNF_BD-ORTHO')
LICENSE_URL = 'https://github.com/etalab/licence-ouverte/blob/master/LO.md'
MAX_BYTES = 20 * 1024 * 1024


def load_map(path):
    text = path.read_text(encoding='utf-8')
    match = re.search(r'export const CALVI_MAP\s*=\s*(\{.*\})\s*;', text, re.S)
    if not match:
        raise ValueError('Calvi vector module is not an explicit JSON data export')
    data = json.loads(match.group(1))
    bounds = data.get('metadata', {}).get('bounds', {})
    fields = ['west', 'south', 'east', 'north']
    if data.get('status') != 'ready' or data.get('metadata', {}).get('city') != 'Calvi' or any(not isinstance(bounds.get(k), (float, int)) or not math.isfinite(bounds[k]) for k in fields):
        raise ValueError('A ready, georeferenced Calvi vector map is required')
    if not (-180 < bounds['west'] < bounds['east'] < 180 and -90 < bounds['south'] < bounds['north'] < 90):
        raise ValueError('Invalid WGS84 map bounds')
    if not (data.get('width', 0) > 0 and data.get('height', 0) > 0):
        raise ValueError('Invalid game world dimensions')
    return data, {k: bounds[k] for k in fields}


def image_request(bounds, width, height):
    # WMS 1.3.0 EPSG:4326 requires latitude,longitude axis order.
    params = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
              'LAYERS': LAYER, 'STYLES': '', 'FORMAT': 'image/jpeg',
              'CRS': 'EPSG:4326',
              'BBOX': ','.join(str(bounds[k]) for k in ['south', 'west', 'north', 'east']),
              'WIDTH': width, 'HEIGHT': height, 'TRANSPARENT': 'FALSE'}
    return BASE_URL + '?' + urllib.parse.urlencode(params)


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'BlueNightCalviOrthophotoImporter/1.0'})
    with urllib.request.urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise ValueError(f'Source returned HTTP {response.status}')
        content = response.read(MAX_BYTES + 1)
        if len(content) > MAX_BYTES:
            raise ValueError('Source exceeds the 20 MiB import limit')
        return content, {'contentType': response.headers.get('Content-Type'),
                         'lastModified': response.headers.get('Last-Modified'),
                         'finalUrl': response.geturl()}


def image_dimensions(blob):
    if not blob.startswith(b'\xff\xd8') or not blob.endswith(b'\xff\xd9'):
        raise ValueError('The response is not a complete JPEG image; XML/HTML and OGC errors are rejected')
    at = 2
    sof = {0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf}
    while at + 4 < len(blob):
        if blob[at] != 0xff:
            raise ValueError('Malformed JPEG marker stream')
        while at < len(blob) and blob[at] == 0xff:
            at += 1
        marker = blob[at]
        at += 1
        if marker in {0xd8, 0xd9, 0x01} or 0xd0 <= marker <= 0xd7:
            continue
        length = int.from_bytes(blob[at:at + 2], 'big')
        if length < 2 or at + length > len(blob):
            raise ValueError('Truncated JPEG segment')
        if marker in sof:
            if length < 8:
                raise ValueError('Incomplete JPEG size header')
            height, width = struct.unpack('>HH', blob[at + 3:at + 7])
            if not width or not height:
                raise ValueError('Empty JPEG image')
            return width, height
        if marker == 0xda:
            break
        at += length
    raise ValueError('JPEG size header is missing')


def validate_image(blob, headers, width, height):
    if 'image/jpeg' not in (headers.get('contentType') or '').lower():
        raise ValueError(f'Expected image/jpeg, received {headers.get("contentType")}')
    if len(blob) < 1024 or image_dimensions(blob) != (width, height):
        raise ValueError('Downloaded JPEG dimensions or size do not match the geographic request')
    decoded = False
    try:
        from PIL import Image, ImageStat
    except ImportError:
        pass
    else:
        import io
        with Image.open(io.BytesIO(blob)) as image:
            image.load()
            if image.size != (width, height):
                raise ValueError('Decoded image dimensions do not match the JPEG header')
            if max(ImageStat.Stat(image.convert('RGB')).stddev) < .8:
                raise ValueError('The imagery response is blank or almost uniform')
            decoded = True
    return decoded


def license_from_metadata(blob):
    root = ET.fromstring(blob)
    text = ' '.join(t.strip() for t in root.itertext() if t.strip())
    normalized = re.sub(r'[^a-z0-9]+', ' ', text.lower())
    clauses = []
    for element in root.iter():
        if element.tag.split('}')[-1] not in {'MD_LegalConstraints', 'useLimitation', 'otherConstraints', 'metadata'}:
            continue
        clause = ' '.join(t.strip() for t in element.itertext() if t.strip())
        if re.search(r'licence\s+ouverte|open\s+licen[cs]e', clause, re.I):
            clauses.append((clause, element))
    if not ('ortho' in normalized and clauses):
        raise ValueError('The official BD ORTHO record did not establish a Licence Ouverte licence; no asset was installed')
    clause, element = min(clauses, key=lambda item: len(item[0]))
    hrefs = [value for child in element.iter() for key, value in child.attrib.items()
             if key.split('}')[-1] == 'href' and value.startswith('https://')]
    # Compatibility with CC-BY 2.0 is not a Licence Ouverte version number.
    version = re.search(r'(?:licence\s+ouverte|open\s+licen[cs]e)\s*(?:version\s*|v\s*)?(\d+\.\d+)', clause, re.I)
    return {'identifier': 'Licence Ouverte / Open Licence',
            'version': version.group(1) if version else None,
            'providerRecord': METADATA_URL, 'licenseText': LICENSE_URL,
            'providerLicenceReference': hrefs[0] if hrefs else None,
            'providerLicenceStatement': clause,
            'recordSha256': hashlib.sha256(blob).hexdigest(),
            'verification': 'Official IGN BD ORTHO ISO metadata record explicitly mentions the open licence'}


def save_pair(image_path, provenance_path, image_bytes, metadata):
    image_path.parent.mkdir(parents=True, exist_ok=True)
    provenance_path.parent.mkdir(parents=True, exist_ok=True)
    staged = []
    previous_image = image_path.read_bytes() if image_path.exists() else None
    try:
        for path, content in [(image_path, image_bytes), (provenance_path, (json.dumps(metadata, ensure_ascii=False, indent=2) + '\n').encode())]:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.' + path.name + '-', delete=False) as temp:
                temp.write(content)
                staged.append(Path(temp.name))
        os.replace(staged[0], image_path)
        try:
            os.replace(staged[1], provenance_path)
        except Exception:
            if previous_image is None:
                image_path.unlink(missing_ok=True)
            else:
                image_path.write_bytes(previous_image)
            raise
    finally:
        for path in staged:
            path.unlink(missing_ok=True)


def self_test():
    import unittest
    class ImportChecks(unittest.TestCase):
        def test_axis_order(self):
            bounds = dict(west=8.7545, south=42.56, east=8.765, north=42.57)
            params = urllib.parse.parse_qs(urllib.parse.urlparse(image_request(bounds, 1024, 1324)).query)
            self.assertEqual(params['BBOX'], ['42.56,8.7545,42.57,8.765'])
            self.assertEqual(params['CRS'], ['EPSG:4326'])
        def test_errors_are_not_photos(self):
            for blob in [b'<ServiceException>bad layer</ServiceException>', b'<html>403</html>', b'\xff\xd8broken']:
                with self.assertRaises(ValueError):
                    image_dimensions(blob)
        def test_license_is_not_assumed(self):
            with self.assertRaises(ValueError):
                license_from_metadata(b'<metadata>BD ORTHO; all rights reserved</metadata>')
            licence = license_from_metadata(b'<metadata>BD ORTHO; Licence Ouverte 2.0 Etalab</metadata>')
            self.assertEqual(licence['version'], '2.0')
            compatible = license_from_metadata(b'<metadata>BD ORTHO; Licence Ouverte / Open License (compatible CC-BY 2.0)</metadata>')
            self.assertIsNone(compatible['version'])
        def test_wrong_dimensions_rejected(self):
            # Synthetic JPEG header only, never geographic imagery or an asset.
            header = b'\xff\xd8\xff\xc0' + struct.pack('>HBHHB', 11, 8, 32, 64, 1) + b'\x01\x11\x00'
            blob = header + b'\x00' * 1500 + b'\xff\xd9'
            self.assertEqual(image_dimensions(blob), (64, 32))
            with self.assertRaises(ValueError):
                validate_image(blob, {'contentType': 'image/jpeg'}, 128, 64)
        def test_failure_preserves_files(self):
            with tempfile.TemporaryDirectory(prefix='SYNTHETIC-imagery-check-') as folder:
                image = Path(folder) / 'image.jpg'; provenance = Path(folder) / 'provenance.json'
                image.write_bytes(b'original asset'); provenance.write_text('{"status":"pending"}')
                before = image.read_bytes(), provenance.read_bytes()
                with self.assertRaises(ValueError):
                    validate_image(b'<html>403</html>', {'contentType': 'text/html'}, 1024, 1324)
                self.assertEqual((image.read_bytes(), provenance.read_bytes()), before)
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ImportChecks))
    return 0 if result.wasSuccessful() else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true', help='Request the official image and product licence metadata')
    parser.add_argument('--self-test', action='store_true', help='Run import validation checks without downloading imagery')
    parser.add_argument('--check-image', type=Path, help='Read and decode a JPEG for format validation only; makes no geographic claim')
    parser.add_argument('--map', type=Path, default=Path('data/calvi-map.js'))
    parser.add_argument('--output', type=Path, default=Path('assets/calvi-orthophoto.jpg'))
    parser.add_argument('--provenance', type=Path, default=Path('data/calvi-imagery-provenance.json'))
    parser.add_argument('--width', type=int, default=1024)
    parser.add_argument('--height', type=int)
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    try:
        if args.check_image:
            blob = args.check_image.read_bytes()
            width, height = image_dimensions(blob)
            decoded = validate_image(blob, {'contentType': 'image/jpeg'}, width, height)
            print(f'JPEG verified {width} × {height}; full decoder={decoded}. This check does not verify geography or import an asset.')
            return 0
        data, bounds = load_map(args.map)
        height = args.height or round(args.width * data['height'] / data['width'])
        if not 64 <= args.width <= 4096 or not 64 <= height <= 4096:
            raise ValueError('Image dimensions must be between 64 and 4096 pixels')
        if args.output.suffix.lower() not in {'.jpg', '.jpeg'}:
            raise ValueError('The original WMS JPEG must be saved with a .jpg or .jpeg extension')
        url = image_request(bounds, args.width, height)
        if not args.download:
            print('No image downloaded. Exact official request:\n' + url)
            return 0
        blob, headers = fetch(url)
        decoded = validate_image(blob, headers, args.width, height)
        source_record, _ = fetch(METADATA_URL)
        licence = license_from_metadata(source_record)
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        provenance = {'status': 'ready', 'kind': 'aerial-orthophotography', 'provider': 'IGN GeoPlateforme',
                      'product': 'BD ORTHO', 'layer': LAYER, 'sourceUrl': url, 'metadataUrl': METADATA_URL,
                      'asset': args.output.as_posix(), 'boundsWGS84': bounds,
                      'image': {'width': args.width, 'height': height, 'format': 'image/jpeg', 'bytes': len(blob),
                                'sha256': hashlib.sha256(blob).hexdigest(), 'fullyDecodedDuringImport': decoded},
                      'georeferencing': {'crs': 'EPSG:4326', 'wmsVersion': '1.3.0', 'bboxAxisOrder': 'latitude,longitude',
                                        'imageAxes': 'right=east, down=south', 'worldWidth': data['width'], 'worldHeight': data['height'],
                                        'imageToWorld': 'x=u*worldWidth/imageWidth; y=v*worldHeight/imageHeight',
                                        'vectorSourceSha256': data['metadata'].get('sha256')},
                      'license': licence, 'attribution': '© IGN — BD ORTHO — Licence Ouverte / Open Licence',
                      'downloadedAt': now, 'captureDate': None,
                      'captureDateNote': 'Current WMS mosaic; local aerial acquisition date has not been established',
                      'responseHeaders': headers}
        save_pair(args.output, args.provenance, blob, provenance)
        print(f'Imported authentic IGN orthophotography {args.width} × {height}; acquisition date remains unspecified.')
        return 0
    except (OSError, ValueError, ET.ParseError) as error:
        print(f'Orthophoto import failed: {error}. Existing image and provenance were preserved.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
