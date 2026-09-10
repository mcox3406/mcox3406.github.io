"""Offline importer checks with synthetic fixtures; no personal archive needed."""
import csv
import gzip
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('bulk', Path(__file__).parents[1] / 'scripts/import-running-bulk.py')
bulk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bulk)


class BulkImportTests(unittest.TestCase):
    def test_simplification_preserves_turns_and_endpoints(self):
        points = [(0, 0), (10, 1), (20, 0), (20, 50), (30, 50)]
        self.assertEqual(bulk.simplify(points, 2), [(0, 0), (20, 0), (20, 50), (30, 50)])
        self.assertEqual(bulk.simplify([(0, 0), (0, 10), (0, 0)], 2), [(0, 0), (0, 10), (0, 0)])

    def fixture(self, directory, filename='activities/different-file-id.gpx.gz'):
        directory = Path(directory)
        (directory / 'activities').mkdir()
        # Repeated native columns, a deliberately different file ID, and two
        # separate track segments. The first segment crosses a large GPS gap.
        with (directory / 'activities.csv').open('w', newline='') as stream:
            writer = csv.writer(stream)
            writer.writerow(['Activity ID', 'Activity Type', 'Distance', 'Distance', 'Moving Time', 'Average Heart Rate', 'Filename'])
            writer.writerow(['1', 'Run', '1.0', '1000.0', '300', '150', filename])
        gpx = '<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk>'
        for segment in [[(42.36, -71.09), (42.361, -71.09), (42.40, -71.09), (42.401, -71.09)], [(42.35, -71.08), (42.351, -71.08)]]:
            gpx += '<trkseg>' + ''.join(f'<trkpt lat="{lat}" lon="{lon}"><ele>3</ele><time>2025-01-01T12:00:00Z</time></trkpt>' for lat, lon in segment) + '</trkseg>'
        with gzip.open(directory / 'activities/different-file-id.gpx.gz', 'wt') as stream:
            stream.write(gpx + '</trk></gpx>')
        snapshot = {'activities': [{'id': '1', 'startLocal': '2025-01-01T07:00:00', 'distanceMeters': 1000, 'movingSeconds': 300}]}
        return directory, snapshot

    def test_matches_csv_filename_and_meter_column_and_preserves_segments(self):
        with tempfile.TemporaryDirectory() as directory:
            root, snapshot = self.fixture(directory)
            result = bulk.build(root, snapshot)
            self.assertEqual(result['report']['routes'], 1)
            self.assertEqual(result['report']['samples']['time'], 6)
            self.assertEqual(result['activities']['1']['averageHeartRate'], 150)
            self.assertEqual(len(result['activities']['1']['paths']), 3)
            self.assertEqual(snapshot['activities'][0]['startLocal'], '2025-01-01T07:00:00')
            snapshot['activities'][0]['distanceMeters'] = 1001
            with self.assertRaisesRegex(ValueError, 'disagrees'):
                bulk.build(root, snapshot)

    def test_rejects_paths_outside_activity_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root, snapshot = self.fixture(directory, '../private.gpx')
            with self.assertRaisesRegex(ValueError, 'escapes'):
                bulk.build(root, snapshot)


if __name__ == '__main__':
    unittest.main()
