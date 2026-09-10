#!/usr/bin/env python3
"""Build plot data from a Strava bulk export, matched to the existing summary.

Reads only activities.csv and the GPX files it references. Python standard library.
Original files and the summary snapshot are never modified.
"""
import argparse
import csv
import gzip
import json
import math
from pathlib import Path
import statistics
import xml.etree.ElementTree as ET

RADIUS = 6371008.8
# Broad geographic labels, not reverse-geocoded addresses. Other places retain
# coordinate labels. Assignment uses the median position, within 35 km.
PLACES = [
    ("boston", "Boston / Cambridge, MA", 42.36, -71.09),
    ("dallas", "Dallas, TX", 32.80, -96.78),
    ("los-angeles", "Los Angeles, CA", 34.05, -118.25),
    ("cambridge-uk", "Cambridge, UK", 52.20, .12),
    ("santa-fe", "Santa Fe, NM", 35.68, -105.94),
    ("sydney", "Sydney, Australia", -33.87, 151.21),
    ("new-york", "New York, NY", 40.73, -74.0),
    ("wichita", "Wichita, KS", 37.69, -97.24),
    ("duluth", "Duluth, MN", 46.79, -92.10),
    ("acadia", "Mount Desert Island, ME", 44.35, -68.28),
    ("clearwater", "Clearwater, FL", 27.98, -82.80),
]


def project(lat, lon, center):
    """Local equirectangular projection in meters; north is positive y."""
    return (RADIUS * math.radians(lon - center[1]) * math.cos(math.radians(center[0])),
            RADIUS * math.radians(lat - center[0]))


def simplify(points, tolerance=20):
    """Iterative Ramer–Douglas–Peucker; preserve segment endpoints."""
    if len(points) < 3:
        return points
    keep, stack = {0, len(points) - 1}, [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        ax, ay = points[start]; bx, by = points[end]
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        best, index = tolerance * tolerance, None
        for i in range(start + 1, end):
            x, y = points[i]
            t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / length)) if length else 0
            d = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2
            if d > best:
                best, index = d, i
        if index is not None:
            keep.add(index); stack.extend([(start, index), (index, end)])
    return [points[i] for i in sorted(keep)]


def read_gpx(path):
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rb') as stream:
        root = ET.parse(stream).getroot()
    segments, sample_counts = [], {"points": 0, "heartRate": 0, "altitude": 0, "time": 0}
    for segment in root.findall('.//{*}trkseg'):
        points = []
        for point in segment.findall('{*}trkpt'):
            lat, lon = float(point.attrib['lat']), float(point.attrib['lon'])
            if not math.isfinite(lat + lon) or not (-90 < lat < 90 and -180 <= lon <= 180):
                raise ValueError(f'Invalid coordinate in {path.name}')
            points.append((lat, lon)); sample_counts['points'] += 1
            for field, tag in [('heartRate', 'hr'), ('altitude', 'ele'), ('time', 'time')]:
                if point.find('.//{*}' + tag) is not None:
                    sample_counts[field] += 1
        if len(points) > 1:
            segments.append(points)
    return segments, sample_counts


def read_rows(path):
    with path.open(newline='', encoding='utf-8-sig') as stream:
        reader = csv.reader(stream)
        headers = next(reader)
        # Strava repeats Distance and Elapsed Time. The later detailed columns
        # are meters/seconds; validate them against the verified summary below.
        indexes = {name: index for index, name in enumerate(headers)}
        required = ['Activity ID', 'Activity Type', 'Filename', 'Distance', 'Moving Time', 'Average Heart Rate']
        if any(name not in indexes for name in required):
            raise ValueError('activities.csv is missing required columns')
        rows = {}
        for cells in reader:
            row = {name: cells[index] for name, index in indexes.items()}
            if row['Activity ID'] in rows:
                raise ValueError('Duplicate activity ID in bulk export')
            rows[row['Activity ID']] = row
        return rows


def build(export, snapshot):
    export = export.resolve()
    rows = read_rows(export / 'activities.csv')
    regions = [{"id": key, "label": label, "center": [lat, lon]} for key, label, lat, lon in PLACES]
    activities, skipped, samples = {}, {}, {"points": 0, "heartRate": 0, "altitude": 0, "time": 0}
    for activity in snapshot['activities']:
        key = activity['id']
        row = rows.get(key)
        if row is None or row['Activity Type'] not in ('Run', 'Trail Run', 'Virtual Run'):
            raise ValueError(f'Running activity {key} is missing from the archive')
        if abs(float(row['Distance']) - activity['distanceMeters']) > .11 or float(row['Moving Time']) != activity['movingSeconds']:
            raise ValueError(f'Summary distance/time disagrees for {key}; review source units and history')
        detail = {name: activity[name] for name in ('startLocal', 'distanceMeters', 'movingSeconds')}
        if row['Average Heart Rate']:
            hr = float(row['Average Heart Rate'])
            if not math.isfinite(hr) or not 20 <= hr <= 260:
                raise ValueError(f'Invalid average heart rate for {key}')
            detail['averageHeartRate'] = hr
        filename = row['Filename']
        if filename.endswith(('.gpx', '.gpx.gz')):
            path = (export / filename).resolve()
            if not path.is_relative_to(export / 'activities'):
                raise ValueError('Activity filename escapes the archive activities directory')
            segments, counts = read_gpx(path)
            for field, value in counts.items():
                samples[field] += value
            if segments:
                points = [point for segment in segments for point in segment]
                center = [statistics.median(p[0] for p in points), statistics.median(p[1] for p in points)]
                region = min(regions, key=lambda r: math.hypot(*project(*center, r['center'])))
                if math.hypot(*project(*center, region['center'])) > 35000:
                    region = {"id": 'region-' + str(len(regions)), "label": f'{abs(center[0]):.1f}° {"N" if center[0] >= 0 else "S"}, {abs(center[1]):.1f}° {"E" if center[1] >= 0 else "W"}', "center": center}
                    regions.append(region)
                paths = []
                for segment in segments:
                    projected = [project(*point, region['center']) for point in segment]
                    # Avoid drawing a connection across a GPS jump > 1 km.
                    part = []
                    for point in projected:
                        if part and math.dist(part[-1], point) > 1000:
                            if len(part) > 1:
                                paths.append(simplify(part))
                            part = []
                        part.append(point)
                    if len(part) > 1:
                        paths.append(simplify(part))
                if paths:
                    detail.update(region=region['id'], paths=[[[round(x), round(y)] for x, y in path] for path in paths])
            else:
                skipped['empty GPX'] = skipped.get('empty GPX', 0) + 1
        else:
            reason = 'FIT (not decoded)' if filename.endswith('.fit.gz') else 'no GPX file'
            skipped[reason] = skipped.get(reason, 0) + 1
        activities[key] = detail
    used = {row.get('region') for row in activities.values()}
    report = {"matchedActivities": len(activities), "routes": sum('paths' in row for row in activities.values()),
              "averageHeartRate": sum('averageHeartRate' in row for row in activities.values()), "samples": samples, "routesUnavailable": skipped}
    return {"version": 1, "kind": "running-plot-details", "simplificationMeters": 20,
            "regions": [r for r in regions if r['id'] in used], "activities": activities, "report": report}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('export', type=Path)
    parser.add_argument('--snapshot', type=Path, default=Path('assets/data/running.json'))
    parser.add_argument('--output', type=Path, default=Path('assets/data/running-details.json'))
    args = parser.parse_args()
    result = build(args.export, json.loads(args.snapshot.read_text()))
    args.output.write_text(json.dumps(result, separators=(',', ':'), ensure_ascii=False) + '\n')
    print(json.dumps(result['report'], indent=2))
    print(f'Wrote {args.output} ({args.output.stat().st_size:,} bytes)')
