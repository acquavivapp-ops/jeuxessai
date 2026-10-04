#!/usr/bin/env python3
"""Import a real WGS84 DEM into Blue Night's offline Calvi elevation grid.

Uses Python's standard library, including TIFF LZW/Deflate decoding. Accepts
signed 16-bit north-up GeoTIFF strips or SRTM HGT (optionally gzip). Network
access happens only with --download; incomplete/void input preserves output.
"""
import argparse
from collections import OrderedDict
import datetime as dt
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys
import tempfile
import urllib.request
import zlib

EARTH_RADIUS = 6_378_137
DEFAULT_BOUNDS = (8.7545, 42.560, 8.765, 42.570)
MIRROR_URL = 'https://raw.githubusercontent.com/fafa1899/SRTM/fd7a14a17517ab31798b7ace0a5d1fe8a8416433/SRTM-GL1/Eurasia/N42E008.tif'
SRTM_ATTRIBUTION = 'SRTM data courtesy of the U.S. Geological Survey'


def decode_lzw(raw):
    """TIFF 6.0 LZW uses MSB-first codes and early-change code widths."""
    position, width, previous, dictionary = 0, 9, None, [bytes([i]) for i in range(256)] + [None, None]
    result = bytearray()
    while position + width <= len(raw) * 8:
        code = 0
        for _ in range(width):
            code = code * 2 + ((raw[position // 8] >> (7 - position % 8)) & 1)
            position += 1
        if code == 256:
            dictionary = [bytes([i]) for i in range(256)] + [None, None]
            width, previous = 9, None
            continue
        if code == 257:
            return bytes(result)
        if code < len(dictionary) and dictionary[code] is not None:
            entry = dictionary[code]
        elif code == len(dictionary) and previous is not None:
            entry = previous + previous[:1]
        else:
            raise ValueError('Invalid TIFF LZW stream')
        result.extend(entry)
        if previous is not None and len(dictionary) < 4096:
            dictionary.append(previous + entry[:1])
            if len(dictionary) == (1 << width) - 1 and width < 12:
                width += 1
        previous = entry
    raise ValueError('Truncated TIFF LZW stream')


class GeoTiff:
    def __init__(self, raw):
        self.raw = raw
        self.endian = '<' if raw[:2] == b'II' else '>' if raw[:2] == b'MM' else None
        if not self.endian or self.unpack('H', 2)[0] != 42:
            raise ValueError('Expected a classic GeoTIFF, not BigTIFF')
        offset = self.unpack('I', 4)[0]
        count = self.unpack('H', offset)[0]
        self.tags = {}
        types = {1: ('B', 1), 2: ('c', 1), 3: ('H', 2), 4: ('I', 4), 8: ('h', 2), 9: ('i', 4), 11: ('f', 4), 12: ('d', 8)}
        for i in range(count):
            location = offset + 2 + i * 12
            tag, kind, length, pointer = self.unpack('HHII', location)
            if kind not in types:
                continue
            fmt, size = types[kind]
            values = self.unpack(fmt * length, location + 8 if size * length <= 4 else pointer)
            self.tags[tag] = values
        self.columns, self.rows = self.scalar(256), self.scalar(257)
        if self.scalar(258) != 16 or self.scalar(277, 1) != 1 or self.scalar(339, 1) != 2 or self.scalar(274, 1) != 1:
            raise ValueError('DEM must be one-channel signed 16-bit north-up TIFF')
        self.compression, self.predictor = self.scalar(259, 1), self.scalar(317, 1)
        if self.compression not in (1, 5, 8, 32946) or self.predictor not in (1, 2):
            raise ValueError('Unsupported TIFF compression or predictor')
        self.strip_rows = self.scalar(278, self.rows)
        self.offsets, self.lengths = self.tags.get(273, ()), self.tags.get(279, ())
        if not self.offsets or len(self.offsets) != len(self.lengths):
            raise ValueError('Expected complete TIFF strips')
        keys = self.tags.get(34735, ())
        geography = {keys[i]: keys[i + 3] for i in range(4, len(keys) - 3, 4) if keys[i + 1] == 0}
        if geography.get(1024) != 2 or not (geography.get(2048) == 4326 or geography.get(2050) == 6326):
            raise ValueError('DEM must use geographic WGS84 coordinates')
        matrix = self.tags.get(34264)
        if matrix:
            if len(matrix) != 16 or any(abs(matrix[i]) > 1e-12 for i in (1, 2, 4, 6)):
                raise ValueError('Rotated TIFF grids are unsupported')
            west, north, self.dx, self.dy = matrix[3], matrix[7], matrix[0], -matrix[5]
        else:
            scale, tie = self.tags.get(33550), self.tags.get(33922)
            if not scale or not tie or len(tie) < 6:
                raise ValueError('DEM lacks its geographic pixel transform')
            self.dx, self.dy = scale[0], scale[1]
            west, north = tie[3] - tie[0] * self.dx, tie[4] + tie[1] * self.dy
        if self.dx <= 0 or self.dy <= 0 or self.columns < 2 or self.rows < 2:
            raise ValueError('Invalid TIFF geographic dimensions')
        # PixelIsPoint grids locate the first sample on the transform origin;
        # PixelIsArea grids locate its sample at the pixel centre.
        shift = 0 if geography.get(1025, 1) == 2 else .5
        self.west, self.north = west + shift * self.dx, north - shift * self.dy
        self.cache = OrderedDict()

    def unpack(self, fmt, offset):
        try:
            return struct.unpack_from(self.endian + fmt, self.raw, offset)
        except struct.error as error:
            raise ValueError('Truncated TIFF metadata or strip') from error

    def scalar(self, key, default=None):
        values = self.tags.get(key)
        if values:
            return values[0]
        if default is not None:
            return default
        raise ValueError(f'TIFF tag {key} is missing')

    def sample(self, column, row):
        strip = row // self.strip_rows
        if strip not in self.cache:
            offset, length = self.offsets[strip], self.lengths[strip]
            raw = self.raw[offset:offset + length]
            if len(raw) != length:
                raise ValueError('Truncated TIFF strip')
            decoded = decode_lzw(raw) if self.compression == 5 else zlib.decompress(raw) if self.compression in (8, 32946) else raw
            strip_height = min(self.strip_rows, self.rows - strip * self.strip_rows)
            if len(decoded) != self.columns * strip_height * 2:
                raise ValueError('TIFF strip has an unexpected sample count')
            values = list(struct.unpack(self.endian + 'H' * (len(decoded) // 2), decoded))
            if self.predictor == 2:
                for r in range(strip_height):
                    for c in range(1, self.columns):
                        index = r * self.columns + c
                        values[index] = (values[index] + values[index - 1]) & 65535
            self.cache[strip] = [v if v < 32768 else v - 65536 for v in values]
            if len(self.cache) > 8:
                self.cache.popitem(last=False)
        return self.cache[strip][(row % self.strip_rows) * self.columns + column]


class Hgt:
    def __init__(self, raw, tile):
        if len(raw) % 2:
            raise ValueError('HGT file has a truncated sample')
        self.columns = self.rows = math.isqrt(len(raw) // 2)
        if self.columns not in (1201, 3601) or self.columns * self.columns * 2 != len(raw):
            raise ValueError('Expected an SRTM HGT tile of 1201 or 3601 square samples')
        match = re.search(r'([NS])(\d{2})([EW])(\d{3})', tile.upper())
        if not match:
            raise ValueError('HGT needs its geographic tile name, e.g. N42E008')
        latitude = int(match[2]) * (1 if match[1] == 'N' else -1)
        longitude = int(match[4]) * (1 if match[3] == 'E' else -1)
        self.west, self.north, self.dx, self.dy = longitude, latitude + 1, 1 / (self.columns - 1), 1 / (self.rows - 1)
        self.raw = raw

    def sample(self, column, row):
        return struct.unpack_from('>h', self.raw, (row * self.columns + column) * 2)[0]


def sample_geographic(dem, longitude, latitude):
    column, row = (longitude - dem.west) / dem.dx, (dem.north - latitude) / dem.dy
    if not (-1e-6 <= column <= dem.columns - 1 + 1e-6 and -1e-6 <= row <= dem.rows - 1 + 1e-6):
        raise ValueError('DEM does not cover all requested map bounds')
    column, row = max(0, min(dem.columns - 1, column)), max(0, min(dem.rows - 1, row))
    left, top = min(dem.columns - 2, math.floor(column)), min(dem.rows - 2, math.floor(row))
    u, v = column - left, row - top
    samples = [dem.sample(left, top), dem.sample(left + 1, top), dem.sample(left, top + 1), dem.sample(left + 1, top + 1)]
    if any(value == -32768 for value in samples):
        raise ValueError('DEM contains a void in the map; no guessed altitude is substituted')
    a, b, c, d = samples
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v


def build_grid(dem, bounds, pixels_per_metre, metadata):
    west, south, east, north = bounds
    if not (west < east and south < north and pixels_per_metre > 0):
        raise ValueError('Invalid geographic bounds or map scale')
    columns, rows = math.ceil((east - west) / dem.dx) + 1, math.ceil((north - south) / dem.dy) + 1
    if columns * rows > 1_000_000:
        raise ValueError('Elevation bounds are too large for a game grid')
    width_metres = math.radians(east - west) * EARTH_RADIUS * math.cos(math.radians((north + south) / 2))
    height_metres = math.radians(north - south) * EARTH_RADIUS
    values = [round(sample_geographic(dem, west + (east - west) * c / (columns - 1), north - (north - south) * r / (rows - 1)), 3) for r in range(rows) for c in range(columns)]
    return {
        'status': 'ready', 'columns': columns, 'rows': rows, 'values': values,
        'width': round(width_metres * pixels_per_metre, 2), 'height': round(height_metres * pixels_per_metre, 2),
        'metresPerPixel': 1 / pixels_per_metre,
        'bounds': dict(zip(('west', 'south', 'east', 'north'), bounds)),
        'metadata': {**metadata, 'sourceGrid': {'columns': dem.columns, 'rows': dem.rows, 'longitudeStep': dem.dx, 'latitudeStep': dem.dy},
                     'gridSpacingMetres': {'eastWest': width_metres / (columns - 1), 'northSouth': height_metres / (rows - 1)},
                     'minimum': min(values), 'maximum': max(values), 'orientation': 'north-up, row-major',
                     'resampling': 'bilinear at the source sampling scale; does not add terrain detail'},
    }


def atomic_write(path, contents):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='wb', dir=path.parent, prefix=path.name + '.', delete=False) as file:
            temporary = Path(file.name)
            file.write(contents)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, help='Authentic GeoTIFF or N42E008.hgt(.gz)')
    parser.add_argument('--download', nargs='?', const=MIRROR_URL, help='Download explicitly, default pinned SRTM mirror')
    parser.add_argument('--tile', default='N42E008', help='HGT tile coordinates; GeoTIFF reads its own transform')
    parser.add_argument('--source-url', default=MIRROR_URL)
    parser.add_argument('--bounds', default=','.join(map(str, DEFAULT_BOUNDS)))
    parser.add_argument('--pixels-per-metre', type=float, default=4)
    parser.add_argument('--output', type=Path, default=Path('data/calvi-elevation.js'))
    parser.add_argument('--archive', type=Path, default=Path('data/calvi-source-N42E008.tif'))
    parser.add_argument('--provenance', type=Path, default=Path('data/calvi-elevation-provenance.json'))
    parser.add_argument('--downloaded-at', help='Known archive download date; otherwise current import date')
    args = parser.parse_args()
    try:
        if args.download:
            request = urllib.request.Request(args.download, headers={'User-Agent': 'BlueNightCalviTerrain/1.0'})
            with urllib.request.urlopen(request, timeout=60) as response:
                archive = response.read(64 * 1024 * 1024 + 1)
            source_url = args.download
        elif args.input:
            archive, source_url = args.input.read_bytes(), args.source_url
        else:
            raise ValueError('Specify --input or --download; imports never download implicitly')
        if len(archive) > 64 * 1024 * 1024:
            raise ValueError('Source exceeds 64 MiB')
        raw = gzip.decompress(archive) if archive[:2] == b'\x1f\x8b' else archive
        dem = GeoTiff(raw) if raw[:2] in (b'II', b'MM') else Hgt(raw, args.tile)
        bounds = tuple(float(value) for value in args.bounds.split(','))
        if len(bounds) != 4 or not all(math.isfinite(v) for v in bounds):
            raise ValueError('Bounds must be west,south,east,north')
        timestamp = dt.datetime.now(dt.timezone.utc).isoformat()
        metadata = {'city': 'Calvi', 'source': 'SRTM GL1', 'sourceUrl': source_url,
                    'license': 'Public domain (USGS/NASA SRTM data)', 'attribution': SRTM_ATTRIBUTION,
                    'sourceEpoch': 'Shuttle Radar Topography Mission, February 2000',
                    'downloadedAt': args.downloaded_at or timestamp, 'importedAt': timestamp,
                    'sha256': hashlib.sha256(archive).hexdigest(), 'rawSha256': hashlib.sha256(raw).hexdigest(),
                    'rawSource': str(args.archive), 'verticalReference': 'SRTM orthometric elevation, EGM96, metres',
                    'accuracyNote': 'Radar surface elevation: buildings/vegetation and coastal interpolation can affect heights; not an IGN ground survey'}
        grid = build_grid(dem, bounds, args.pixels_per_metre, metadata)
        module = '// Authentic SRTM-derived offline elevation; see data/ELEVATION.md.\nexport const CALVI_ELEVATION = ' + json.dumps(grid, separators=(',', ':'), ensure_ascii=False) + ';\n'
        # All reading, decoding and geographic checks finish before any output.
        atomic_write(args.archive, archive)
        atomic_write(args.provenance, (json.dumps({**grid['metadata'], 'bounds': grid['bounds'], 'columns': grid['columns'], 'rows': grid['rows'], 'generatedModule': str(args.output)}, indent=2) + '\n').encode())
        atomic_write(args.output, module.encode())
        print(f'Imported authentic elevation grid {grid["columns"]} × {grid["rows"]}, {grid["metadata"]["minimum"]}…{grid["metadata"]["maximum"]} metres')
    except (ValueError, OSError, EOFError, struct.error, zlib.error) as error:
        print(f'Elevation import failed: {error}; existing elevation module was preserved.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
