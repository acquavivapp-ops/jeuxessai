#!/usr/bin/env python3
"""Boundary and bounded-download validation using explicitly synthetic fixtures."""
import importlib.util
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BOUNDARY = load('boundary_import', 'import-boundary.py')
OSM = load('osm_download', 'download-osm-municipality.py')
MAP = load('calvi_import', 'import-calvi.py')


class SyntheticBoundaryChecks(unittest.TestCase):
    def test_edge_identity_joins_reversed_members_without_invented_nodes(self):
        self.assertEqual(BOUNDARY.join_rings([[1, 2], [3, 2], [3, 4], [4, 1]]), [[1, 2, 3, 4, 1]])
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            BOUNDARY.join_rings([[1, 2], [2, 3]])

    def test_multiple_closed_islands_stay_distinct(self):
        rings = BOUNDARY.join_rings([[1, 2, 3, 1], [4, 5, 6, 4]])
        self.assertEqual(len(rings), 2)
        self.assertEqual(set(rings[0]), {1, 2, 3})

    def test_wrong_commune_and_missing_members_are_refused(self):
        raw = b'<osm><relation id="1151255"><member type="way" ref="10" role="outer"/><tag k="boundary" v="administrative"/><tag k="admin_level" v="8"/><tag k="ref:INSEE" v="2B051"/></relation></osm>'
        with self.assertRaisesRegex(ValueError, 'municipality'):
            BOUNDARY.parse_boundary(raw)
        with self.assertRaisesRegex(ValueError, 'member ways'):
            BOUNDARY.parse_boundary(raw.replace(b'2B051', b'2B050'))

    def test_archive_merge_keeps_actual_highest_version_by_type_and_id(self):
        pieces = [{'raw': b'<osm><node id="1" version="1" lon="1" lat="2"/><way id="1" version="1"><nd ref="1"/></way></osm>'},
                  {'raw': b'<osm><node id="1" version="2" lon="3" lat="4"/></osm>'}]
        result = OSM.merge(pieces)
        self.assertEqual(len(result.findall('node')), 1)
        self.assertEqual(result.find('node').attrib['lon'], '3')
        self.assertEqual(len(result.findall('way')), 1, 'OSM type is part of object identity')

    def test_quadrants_share_edges_and_exactly_cover_the_real_requested_box(self):
        pieces = OSM.quarters((0, 0, 10, 8))
        self.assertEqual(pieces, [(0, 0, 5, 4), (5, 0, 10, 4), (0, 4, 5, 8), (5, 4, 10, 8)])

    def test_streets_are_clipped_to_actual_municipal_outer_and_hole(self):
        outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
        hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
        polygons = [[outer, hole]]
        edges = [(a, b) for ring in (outer, hole) for a, b in zip(ring, ring[1:])]
        result = MAP.clip_boundary_line([[-1, 5], [11, 5]], polygons, edges)
        self.assertEqual(result, [[[0, 5], [4, 5]], [[6, 5], [10, 5]]])


if __name__ == '__main__':
    unittest.main()
