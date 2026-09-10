const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/js/running-core.js');
const run = (id, startLocal, movingSeconds = 3600, distanceMeters = 10000) => ({ id, startLocal, sport: 'Run', name: 'A run', movingSeconds, distanceMeters });
const snapshot = (activities, extra = {}) => C.normalize({ version: 1, rangeStart: '2025-01-01', rangeEnd: '2025-01-07', complete: true, activities, ...extra });
const analyze = (data, year = '2025', today = '2026-01-01') => C.analyze(data, year, today);

test('clock probability includes covered rest days and prorates fractional bins', () => {
  const stats = analyze(snapshot([run('1', '2025-01-01T07:07:30', 900)]));
  assert.equal(stats.coveredDays, 7);
  assert.equal(stats.groups.all.bins[28], 100 * .5 / 7);
  assert.equal(stats.groups.all.bins[29], 100 * .5 / 7);
  assert.equal(stats.groups.all.bins[30], 0);
  assert.equal(stats.groups.weekdays.days, 5);
  assert.equal(stats.groups.weekdays.bins[28], 10);
  assert.equal(stats.groups.weekends.days, 2);
  assert.equal(stats.groups.weekends.bins[28], 0);
});

test('overlapping runs count once in the clock but keep their recorded distance and IDs', () => {
  const stats = analyze(snapshot([run('1', '2025-01-01T07:00:00'), run('2', '2025-01-01T07:30:00'), run('3', '2025-01-01T18:00:00')]));
  assert.equal(stats.groups.all.bins[30], 100 / 7);
  assert.equal(stats.groups.all.bins[33], 100 / 7);
  assert.equal(stats.groups.all.bins[34], 0);
  assert.equal(stats.totalDistance, 30000);
  assert.equal(stats.doubles, 1);
  assert.equal(stats.runDays, 1);
  assert.ok(stats.groups.all.bins.every(value => value <= 100));
});

test('cross-midnight and cross-year intervals contribute on the correct covered dates', () => {
  const data = snapshot([run('1', '2024-12-31T23:45:00', 1800), run('2', '2025-01-01T23:45:00', 1800)], { rangeStart: '2024-12-31', rangeEnd: '2025-01-02' });
  const stats = analyze(data);
  assert.equal(stats.groups.all.bins[0], 100);
  assert.equal(stats.groups.all.bins[95], 50);
  assert.equal(stats.totalDistance, 10000);
  assert.equal(stats.activities.length, 1);
});

test('partial dates and today are excluded from denominators, but recorded totals remain visible', () => {
  const data = snapshot([run('1', '2025-01-01T07:00:00'), run('2', '2025-01-02T07:00:00'), run('3', '2025-01-03T07:00:00')], { coverage: { '2025-01-01': false, '2025-01-02': true, '2025-01-03': true, '2025-01-04': true } });
  const stats = analyze(data, '2025', '2025-01-03');
  assert.equal(stats.coveredDays, 1);
  assert.equal(stats.groups.all.bins[28], 100);
  assert.equal(stats.totalDistance, 30000);
  assert.equal(stats.byDate.get('2025-01-03').covered, false);
  assert.equal(stats.weekdays[2].days, 0);
  assert.equal(stats.weekdays[3].distance, 10000);
});

test('empty complete histories mean zero; incomplete histories mean unknown', () => {
  const complete = analyze(snapshot([]));
  const partial = analyze(snapshot([], { complete: false }));
  assert.equal(complete.groups.all.bins[0], 0);
  assert.equal(partial.groups.all.bins[0], null);
  assert.equal(partial.totalDistance, 0);
  assert.equal(partial.longest, 0);
  assert.equal(partial.activities.length, 0);
});

test('weekday means include rest days and weeks start Monday with partial edge weeks', () => {
  const stats = analyze(snapshot([run('1', '2025-01-01T07:00:00'), run('2', '2025-01-08T07:00:00', 3600, 6000)], { rangeEnd: '2025-01-15' }));
  assert.equal(stats.weekdays[2].days, 3);
  assert.equal(stats.weekdays[2].distance, 16000);
  assert.equal(stats.weeks[0].start, '2025-01-01');
  assert.equal(stats.weeks[0].days, 5);
  assert.equal(stats.weeks[1].start, '2025-01-06');
});

test('calendar arithmetic handles leap days and is independent of browser timezone', () => {
  const data = snapshot([run('1', '2024-02-29T23:30:00')], { rangeStart: '2024-02-28', rangeEnd: '2024-03-01' });
  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York'; const a = analyze(data, '2024');
    process.env.TZ = 'Asia/Tokyo'; const b = analyze(data, '2024');
    assert.deepEqual(a, b);
    assert.equal(a.days.length, 366);
    assert.equal(a.byDate.get('2024-02-29').weekday, 3);
    assert.equal(a.groups.all.bins[0], 100 / 3);
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('import rejects duplicate IDs, bad times, impossible dates, units as strings, and invalid durations', () => {
  const good = run('1', '2025-01-01T07:00:00');
  assert.throws(() => snapshot([good, good]), /appears twice/);
  for (const change of [{ startLocal: '2025-02-30T07:00:00' }, { startLocal: '2025-01-01T25:00:00' }, { startLocal: '2025-01-01T07:00:00Z' }, { distanceMeters: '10000' }, { movingSeconds: 0 }, { elapsedSeconds: 3000 }, { distanceMeters: NaN }, { sport: 'Ride' }, { id: 123 }, { name: '' }]) assert.throws(() => snapshot([{ ...good, ...change }]));
  assert.throws(() => snapshot([good], { rangeEnd: '2024-12-31' }), /ordered/);
  assert.throws(() => snapshot([good], { rangeStart: '2025-01-02' }), /inside/);
  assert.throws(() => snapshot([good], { complete: 'true' }), /complete/);
});

test('normalization drops routes, credentials, and extra fields; backup round trips preserve statistics', () => {
  const data = snapshot([{ ...run('1', '2025-01-01T07:00:00'), route: 'private-route', access_token: 'secret' }], { credentials: 'secret', athleteId: '123' });
  assert.ok(!JSON.stringify(data).includes('secret'));
  assert.ok(!JSON.stringify(data).includes('private-route'));
  assert.deepEqual(C.parse(JSON.stringify(data)), data);
  assert.deepEqual(C.parse('```json\n' + JSON.stringify(data) + '\n```'), data);
  assert.deepEqual(C.normalize({ activityHistory: { ...data, kind: undefined, updatedAt: '2025-01-08T00:00:00Z' } }), data);
});

test('CSV parses quoted commas, embedded newlines, UTF-8 BOM, explicit units and missing optional fields', () => {
  const raw = '\uFEFFid,startLocal,sport,name,distanceMeters,movingSeconds,elevationMeters\r\n1,2025-01-01T07:00:00,Run,"Morning, \"\"sunny\"\"\nloop",10000,3600,\r\n';
  const data = C.parse(raw, true);
  assert.equal(data.activities[0].name, 'Morning, "sunny"\nloop');
  assert.equal(data.activities[0].distanceMeters, 10000);
  assert.equal(data.activities[0].elevationMeters, undefined);
  assert.equal(analyze(data).groups.all.bins[28], null);
  assert.throws(() => C.parse('distance,time\n10,60', true), /template headers/);
  assert.throws(() => C.parse(raw + '2,2025-01-01T07:00:00,Run,Test,10000\n', true), /same number/);
  assert.throws(() => C.parse(raw + '"unclosed', true), /unclosed/);
});

test('example generator is explicitly synthetic and its probabilities stay bounded', () => {
  const data = C.demo();
  assert.equal(data.demo, true);
  assert.deepEqual(data, C.demo());
  const stats = analyze(data);
  assert.equal(stats.coveredDays, 365);
  assert.ok(stats.groups.all.bins.every(value => value >= 0 && value <= 100));
  assert.equal(stats.totalDistance, stats.weeks.reduce((sum, week) => sum + week.distance, 0));
});

test('published snapshot satisfies the import contract', () => {
  const data = C.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '../assets/data/running.json'), 'utf8'));
  assert.deepEqual(C.normalize(data), data);
});
