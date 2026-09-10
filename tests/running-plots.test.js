const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/js/running-core.js');
const run = (id, date, distanceMeters = 10000, movingSeconds = 3600) => ({ id, startLocal: `${date}T07:00:00`, name: 'Run', sport: 'Run', distanceMeters, movingSeconds });

test('year comparisons stop at coverage gaps and use the same calendar date', () => {
  const data = C.normalize({ version: 1, activities: [run('a', '2025-01-01'), run('b', '2026-01-02', 15000), run('c', '2026-01-04')], coverage: {
    '2025-01-01': true, '2025-01-02': true, '2025-01-03': true,
    '2026-01-01': true, '2026-01-02': true, '2026-01-03': false, '2026-01-04': true
  } });
  const lines = C.cumulative(data, '2026-09-10'), result = C.compareCumulative(lines, '2026');
  assert.equal(lines[1].points.length, 2);
  assert.equal(lines[1].points[0].distance, 0);
  assert.deepEqual(result, { year: '2026', otherYear: '2025', through: '01-02', current: 15000, previous: 10000, difference: 5000, percent: 50 });
  assert.equal(C.compareCumulative(lines, '2025').difference, -5000);
  assert.equal(C.cumulative(data, '2026-01-02')[1].points.length, 1);
});

test('leap-year cumulative curves align March 1 and compare only shared dates', () => {
  const data = C.normalize({ version: 1, rangeStart: '2024-01-01', rangeEnd: '2025-03-01', complete: true,
    activities: [run('leap', '2024-02-29'), run('next', '2025-03-01', 20000)] });
  const lines = C.cumulative(data, '2026-01-01');
  assert.equal(lines[0].points.find(p => p.date === '2024-03-01').index, lines[1].points.at(-1).index);
  assert.equal(C.compareCumulative(lines, '2025').difference, 10000);
  assert.equal(C.calendarIndex('2024-02-29'), 59);
});

test('zero-distance baselines have an absolute comparison and no percentage', () => {
  const data = C.normalize({ version: 1, activities: [run('a', '2026-01-01')], coverage: { '2025-01-01': true, '2026-01-01': true } });
  assert.equal(C.compareCumulative(C.cumulative(data, '2026-01-02'), '2026').percent, null);
  assert.deepEqual(C.cumulative({ activities: [], coverage: {} }, '2026-01-01'), []);
});

test('monthly pace curves weight activities equally and distinguish empty months', () => {
  const months = C.monthlyPaces([run('a', '2025-01-01', 1000, 300), run('b', '2025-01-02', 10000, 4000), run('c', '2025-03-01', 5000, 1500)]);
  assert.deepEqual(months[0].values, [300, 400]);
  assert.equal(months[0].median, 350);
  assert.equal(months[1].median, null);
  assert.equal(months[2].median, 300);
  const samples = [280, 300, 320];
  assert.deepEqual(C.density([300], samples), C.density([300, 300], samples));
  const curve = C.density([300], samples);
  assert.equal(curve[0], curve[2]); assert.ok(curve[1] > curve[0]);
  assert.deepEqual(C.density([], samples), [0, 0, 0]);
});

test('plot details are matched by ID and unchanged summary fields; demo data never joins', () => {
  const row = run('a', '2025-01-01'), data = { activities: [row] };
  const details = { version: 1, kind: 'running-plot-details', activities: { a: { ...row, averageHeartRate: 150 } } };
  assert.equal(C.matchingDetails(data, details).get('a').averageHeartRate, 150);
  for (const field of ['startLocal', 'distanceMeters', 'movingSeconds']) {
    assert.equal(C.matchingDetails({ activities: [{ ...row, [field]: 'changed' }] }, details).size, 0);
  }
  assert.equal(C.matchingDetails({ ...data, demo: true }, details).size, 0);
  assert.equal(C.matchingDetails(data, null).size, 0);
});

test('site details match all summary records and contain finite, bounded route geometry', () => {
  const data = require('../assets/data/running.json'), details = require('../assets/data/running-details.json');
  assert.equal(C.matchingDetails(data, details).size, data.activities.length);
  const regions = new Set(details.regions.map(region => region.id));
  for (const row of Object.values(details.activities)) {
    if (row.averageHeartRate != null) assert.ok(row.averageHeartRate >= 20 && row.averageHeartRate <= 260);
    if (!row.paths) continue;
    assert.ok(regions.has(row.region));
    for (const path of row.paths) {
      assert.ok(path.length >= 2);
      for (const point of path) assert.ok(point.length === 2 && point.every(value => Number.isFinite(value) && Math.abs(value) < 200000));
    }
  }
});
