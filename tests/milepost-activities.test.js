const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/js/milepost-core.js');
const A = require('../assets/js/milepost-activities-core.js');
const today = '2026-09-08';
const run = (id = '101', overrides = {}) => ({ id, startLocal: '2026-09-07T06:30:00', sport: 'Run', name: 'Synthetic AM run', distanceMeters: 16093.44, movingSeconds: 4200, ...overrides });
const snapshot = (overrides = {}) => A.parseSnapshot(JSON.stringify({ version: 1, kind: 'strava-activities', source: 'strava-official-mcp', athleteId: '1234', exportedAt: '2026-09-08T14:00:00Z', rangeStart: '2026-08-01', rangeEnd: '2026-09-07', complete: true, activities: [run()], ...overrides }), today);
const history = () => A.merge(A.emptyHistory(), snapshot()).history;
const state = () => ({ plan: C.samplePlan(), checkins: { '2026-09-07': { completed: true, rpe: 3, notes: 'Felt normal.' } }, activityHistory: history(), today, brief: null, isDemo: true });
const proposal = (current, changes = [], overrides = {}) => JSON.stringify({ version: 1, kind: 'training-adjustment', contextKey: A.contextKey(current), summary: 'Synthetic review: consider reducing Wednesday volume.', changes, ...overrides });
const change = (current, date = '2026-09-09') => {
  const before = current.plan.days.find(row => row.date === date);
  return { date, reason: 'Synthetic recovery observation supplied by the runner.', workout: { ...before, title: 'Easy recovery run', distance: 8, minutes: 60, easyMinutes: 60, pace: 'Easy, conversational', description: '8 mi easy; no PM run.' } };
};

test('official snapshot parsing preserves local dates, IDs, doubles, units, and missing fields', () => {
  const input = snapshot({ activities: [run('102', { startLocal: '2026-09-07T23:30:00', distanceMeters: 6437.376, movingSeconds: 1800, averageHeartRate: null, elevationMeters: 25, privateToken: 'not retained' }), run()] });
  assert.equal(input.activities[0].id, '101');
  assert.equal(input.activities[1].startLocal, '2026-09-07T23:30:00');
  assert.equal(input.activities[1].averageHeartRate, undefined);
  assert.equal(input.activities[1].privateToken, undefined);
  const saved = A.merge(A.emptyHistory(), input).history;
  const totals = A.daily(saved, 'mi', today)['2026-09-07'];
  assert.ok(Math.abs(totals.distance - 14) < 1e-9);
  assert.equal(totals.minutes, 100);
  assert.equal(totals.count, 2);
  assert.ok(Math.abs(A.daily(saved, 'km', today)['2026-09-07'].distance - 22.530816) < 1e-9);
  assert.equal(A.daily(saved, 'mi', '2026-09-06')['2026-09-07'], undefined);
});
test('rejects invalid IDs, dates, ranges, measures, duplicates, and non-running activities', () => {
  for (const overrides of [{ id: 101 }, { id: 'javascript:alert(1)' }, { startLocal: '2026-02-30T12:00:00' }, { startLocal: '2026-09-07T24:30:00' }, { startLocal: '2026-09-07T06:30:00Z' }, { distanceMeters: '10' }, { distanceMeters: -1 }, { movingSeconds: 0 }, { elapsedSeconds: 4000 }, { averageHeartRate: 0 }, { sport: 'Ride' }]) assert.throws(() => snapshot({ activities: [run('101', overrides)] }));
  for (const overrides of [{ rangeStart: '2026-09-08', rangeEnd: '2026-09-07' }, { rangeStart: '2025-01-01' }, { rangeEnd: '2026-09-09' }, { rangeEnd: '2026-09-06' }, { complete: 'true' }, { exportedAt: '2026-02-30T12:00:00Z' }, { exportedAt: '2026-09-08T25:00:00Z' }, { exportedAt: '2027-01-01T12:00:00Z' }, { activities: [run(), run()] }, { source: 'unofficial-api' }]) assert.throws(() => snapshot(overrides));
  assert.throws(() => A.readJSON('x'.repeat(A.MAX_BYTES + 1)), /4 MB/);
});
test('re-import is idempotent; updated IDs replace data; inputs are never mutated', () => {
  const old = history(), before = JSON.stringify(old);
  const result = A.merge(old, snapshot());
  assert.deepEqual(result.counts, { added: 0, updated: 0, unchanged: 1, removed: 0 });
  assert.equal(result.history.activities.length, 1);
  const update = A.merge(old, snapshot({ activities: [run('101', { distanceMeters: 12000 }), run('102', { startLocal: '2026-09-07T18:00:00' })] }));
  assert.deepEqual(update.counts, { added: 1, updated: 1, unchanged: 0, removed: 0 });
  assert.equal(update.history.activities[0].distanceMeters, 12000);
  assert.equal(JSON.stringify(old), before);
});
test('complete snapshots reconcile deletions only within the range; partial exports retain runs and invalidate coverage', () => {
  const old = A.merge(A.emptyHistory(), snapshot({ activities: [run(), run('102', { startLocal: '2026-08-01T12:00:00' })] })).history;
  const partial = A.merge(old, snapshot({ rangeStart: '2026-09-07', complete: false, activities: [] }));
  assert.equal(partial.history.activities.length, 2);
  assert.equal(partial.history.coverage['2026-09-07'], false);
  assert.equal(partial.history.coverage['2026-08-01'], true);
  const complete = A.merge(old, snapshot({ rangeStart: '2026-09-07', activities: [] }));
  assert.equal(complete.counts.removed, 1);
  assert.deepEqual(complete.history.activities.map(row => row.id), ['102']);
  assert.equal(complete.history.coverage['2026-09-07'], true);
});
test('account mixing and older exports cannot overwrite history', () => {
  assert.throws(() => A.merge(history(), snapshot({ athleteId: '9999' })), /different athlete/);
  assert.throws(() => A.merge(history(), snapshot({ exportedAt: '2026-09-08T13:59:59Z' })), /older/);
});
test('history survives JSON backup round trips; corrupt history is rejected', () => {
  const saved = history();
  assert.deepEqual(A.validateHistory(A.readJSON(JSON.stringify(saved))), saved);
  assert.deepEqual(A.validateHistory(undefined), A.emptyHistory());
  assert.throws(() => A.validateHistory({ ...saved, coverage: { '2026-09-07': 'true' } }), /Coverage/);
  assert.throws(() => A.validateHistory({ ...saved, activities: [run(), run()] }), /more than once/);
  const backup = JSON.stringify({ ...C.samplePlan(), activityHistory: saved });
  assert.equal(C.parseImport(backup, A.MAX_BYTES).plan.title, C.samplePlan().title);
  assert.deepEqual(A.validateHistory(A.readJSON(backup).activityHistory), saved);
});
test('analysis separates imported totals from completion, handles doubles, and excludes outside-plan/future dates', () => {
  const saved = A.merge(A.emptyHistory(), snapshot({ rangeEnd: today, activities: [run(), run('102', { startLocal: '2026-09-07T18:00:00', distanceMeters: 6437.376, movingSeconds: 1800 }), run('103', { startLocal: '2026-08-31T12:00:00' }), run('104', { startLocal: '2026-09-08T12:00:00' })] })).history;
  const data = A.analyze(C.analyzePlan(C.samplePlan(), {}, today), saved, 'mi', today);
  assert.ok(Math.abs(data.total.actual.distance - 24) < 1e-9);
  assert.equal(data.total.actual.count, 3);
  assert.equal(data.total.actual.minutes, 170);
  assert.equal(data.total.completed.distance, 0);
  assert.equal(data.daily[0].actual.count, 2);
  assert.equal(data.daily[0].covered, true);
  assert.equal(data.daily[1].covered, false); // Today is unfinished even with a complete snapshot.
  assert.equal(data.weekly[0].coveredDays, 1);
  assert.equal(data.total.actual.effort, undefined);
  assert.equal(data.total.reportedDays, 0);
  const early = A.analyze(C.analyzePlan(C.samplePlan(), {}, '2026-09-06'), saved, 'mi', '2026-09-06');
  assert.equal(early.total.actual.distance, 0);
});
test('proposal preview is atomic, validates full replacement days, and reports changed weekly mileage', () => {
  const current = state(), before = JSON.stringify(current);
  const result = A.parseAdjustment(proposal(current, [change(current)]), current);
  assert.equal(JSON.stringify(current), before);
  assert.equal(result.plan.days.find(day => day.date === '2026-09-09').distance, 8);
  assert.deepEqual(result.plan.days[0], current.plan.days[0]);
  assert.deepEqual(result.weeks, [{ start: '2026-09-07', before: 90, after: 86 }]);
  assert.deepEqual(result.plan.paceReference, current.plan.paceReference);
  const invalid = change(current); invalid.workout.easyMinutes = 999;
  assert.throws(() => A.parseAdjustment(proposal(current, [invalid]), current), /easy running minutes/);
  assert.equal(JSON.stringify(current), before);
});
test('review protects past, today, logged days, dates beyond two weeks, and duplicate changes', () => {
  const current = state();
  for (const date of ['2026-09-07', today, '2026-09-23']) assert.throws(() => A.parseAdjustment(proposal(current, [change(current, date)]), current), /tomorrow/);
  for (const log of [{ completed: true }, { rpe: 3 }, { notes: 'Planned travel.' }]) {
    const logged = { ...current, checkins: { ...current.checkins, '2026-09-09': log } };
    assert.throws(() => A.parseAdjustment(proposal(logged, [change(logged)]), logged), /training log/);
  }
  assert.throws(() => A.parseAdjustment(proposal(current, [change(current), change(current)]), current), /only once/);
  const mismatch = change(current); mismatch.workout.date = '2026-09-10';
  assert.throws(() => A.parseAdjustment(proposal(current, [mismatch]), current), /must match/);
});
test('proposals expire after plan, pace, log, activity, or local-date changes', () => {
  const current = state(), raw = proposal(current, [change(current)]);
  const altered = [
    { ...current, today: '2026-09-09' },
    { ...current, checkins: {} },
    { ...current, activityHistory: A.emptyHistory() },
    { ...current, brief: { goal: '10K' } },
    { ...current, plan: { ...current.plan, title: 'New plan' } },
    { ...current, plan: { ...current.plan, paceReference: { ...current.plan.paceReference, timeSeconds: 9400 } } }
  ];
  for (const next of altered) assert.throws(() => A.parseAdjustment(raw, next), /changed since/);
});
test('no-change reviews are valid and do not add new training dates', () => {
  const current = state(), result = A.parseAdjustment(proposal(current), current);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(result.weeks, []);
  assert.deepEqual(result.plan, current.plan);
  const addition = change(current); addition.date = '2026-12-01'; addition.workout.date = addition.date;
  assert.throws(() => A.parseAdjustment(proposal(current, [addition]), current), /existing plan dates/);
});
test('prompts require verified connector fields, protect missing data, and embed the current review token', () => {
  const prompt = A.exportPrompt('2026-08-01', '2026-09-07');
  assert.match(prompt, /official MCP/); assert.match(prompt, /all pages/); assert.match(prompt, /NOT the connector's native schema/);
  const current = state(), review = A.reviewPrompt(current, 'Sleep 7 hours; legs feel normal.');
  assert.match(review, /Sleep 7 hours/); assert.match(review, /Missing imports do not mean rest days/);
  assert.ok(review.includes(A.contextKey(current))); assert.ok(review.includes('Felt normal.'));
  assert.match(review, /changes:\[\]/); assert.match(review, /never alter today, past dates/);
  assert.match(review, /2026-12-06/); assert.match(review, /peakMilesPerWeek":110/);
});
