const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/js/milepost-core.js');

const sample = () => C.samplePlan();
test('analysis separates scheduled totals, completed prescriptions, and reported RPE', () => {
  const specs = [
    ['easy', 10, 80, 3, 80], ['quality', 8, 60, 7, 30], ['rest', 0, 0, 0, 0], ['cross', 0, 60, 5, 0],
    ['easy', 5, 40, 3, 40], ['long', 20, 150, 4, 150], ['rest', 0, 0, 0, 0], ['easy', 6, 48, 3, 48]
  ];
  const plan = C.validatePlan({ version: 1, title: 'Analytics fixture', units: 'mi', days: specs.map(([type, distance, minutes, rpe, easyMinutes], i) => ({ date: C.dateKey(C.addDays('2026-09-07', i)), type, distance, minutes, rpe, easyMinutes, title: type, pace: '', description: '' })) });
  const checkins = { '2026-09-07': { completed: true, rpe: 2 }, '2026-09-08': { completed: true }, '2026-09-09': { completed: true, rpe: 1 }, '2026-09-10': { completed: true, rpe: 6 }, '2026-09-11': { rpe: 5 }, '2026-09-12': { completed: true, rpe: 8 } };
  const before = JSON.stringify({ plan, checkins });
  const stats = C.analyzePlan(plan, checkins, '2026-09-11');
  assert.equal(stats.total.distance, 49);
  assert.equal(stats.total.minutes, 378);
  assert.equal(stats.total.effort, 1524);
  assert.deepEqual(stats.total.completed, { distance: 18, minutes: 140, effort: 660 });
  assert.equal(stats.total.completedDays, 2);
  assert.equal(stats.total.completionPercent, 100); // Today and future training are excluded from the denominator.
  assert.equal(stats.total.reportedDays, 2); // Rest, cross-training and future ratings are excluded.
  assert.equal(stats.weekly[0].reportedRpe, 3.5);
  assert.equal(stats.weekly[0].reportedDays, 2);
  assert.equal(stats.total.averageWeek, 43);
  assert.equal(stats.total.peakWeek, 43);
  assert.equal(stats.total.peakRollingDistance, 43);
  assert.equal(stats.daily[7].rollingDistance, 39);
  assert.equal(stats.daily[5].rollingDistance, null);
  assert.equal(stats.weekly[1].partial, true);
  assert.equal(stats.weekly[1].distanceChange, null);
  assert.equal(stats.total.longDistance, 20);
  assert.equal(stats.total.longestRun, 20);
  assert.deepEqual(stats.daily.at(-1).cumulative, { distance: 49, minutes: 378, effort: 1524 });
  assert.deepEqual(stats.weekly[0].composition.map(item => item.distance), [15, 8, 20]);
  assert.equal(JSON.stringify({ plan, checkins }), before);
});
test('analysis handles pre-plan dates, zero mileage, partial weeks, and missing effort', () => {
  const plan = sample();
  const early = C.analyzePlan(plan, { '2026-09-07': { completed: true, rpe: 3 } }, '2026-09-01');
  assert.equal(early.total.completed.distance, 0);
  assert.equal(early.total.completionPercent, null);
  assert.equal(early.total.reportedDays, 0);
  assert.equal(early.total.distance, 872);
  assert.equal(early.total.longDistance, 203);
  assert.equal(early.total.averageWeek, 872 / 9);
  assert.ok(Math.abs(early.weekly[1].distanceChange - 100 * 4 / 90) < 1e-10);
  assert.equal(early.weekly[0].distanceChange, null);
  const empty = { ...plan, days: [{ ...plan.days[0], type: 'rest', distance: 0, minutes: 0, easyMinutes: 0, rpe: 0 }] };
  const analysis = C.analyzePlan(C.validatePlan(empty), {}, '2026-12-01');
  assert.equal(analysis.total.distance, 0);
  assert.equal(analysis.total.effort, 0);
  assert.equal(analysis.total.easyPercent, null);
  assert.equal(analysis.total.averageWeek, null);
  assert.equal(analysis.total.peakWeek, null);
  assert.equal(analysis.total.peakRollingDistance, null);
  assert.equal(analysis.total.longPercent, null);
  assert.equal(analysis.weekly[0].reportedRpe, null);
  assert.equal(analysis.weekly[0].partial, true);
});
test('sample connects five preparation weeks to the marathon block with consistent volume', () => {
  const plan = sample();
  assert.equal(plan.days[0].date, '2026-09-07');
  assert.equal(plan.days.at(-1).date, '2026-11-08');
  assert.equal(plan.days.length, 63);
  assert.deepEqual(C.weeks(plan).map(week => C.summarize(week.days).distance), [90, 94, 98, 100, 92, 96, 104, 110, 88]);
  assert.equal(plan.days[34].date, '2026-10-11');
  assert.equal(plan.days[35].date, '2026-10-12');
  assert.equal(plan.days[34].phase, 'Speed and aerobic volume');
  assert.equal(plan.days[35].phase, 'Marathon-specific');
  const week = C.weeks(plan)[5];
  const totals = C.summarize(week.days, { '2026-10-13': { completed: true } });
  assert.equal(totals.runs, 7);
  assert.equal(totals.completed, 1);
  assert.equal(totals.detailedEffort, true);
  assert.ok(totals.easyPercent > 80 && totals.easyPercent < 90);
  const long = week.days[6];
  assert.equal(long.distance, 22);
  assert.equal(long.easyMinutes, 83); // 12 mi at 6:55/mi.
  assert.ok(Math.abs(long.minutes - long.easyMinutes - 10 * 352 / 60) < 0.1);
});
test('date arithmetic handles month, year, leap-year and daylight-saving boundaries', () => {
  assert.equal(C.dateKey(C.addDays('2026-12-31', 1)), '2027-01-01');
  assert.equal(C.dateKey(C.addDays('2028-02-28', 1)), '2028-02-29');
  assert.equal(C.dateKey(C.addDays('2026-03-08', 1)), '2026-03-09');
  assert.equal(C.dateKey(C.monday('2026-11-01')), '2026-10-26');
  assert.throws(() => C.parseDate('2026-02-29'), /real calendar/);
  assert.throws(() => C.parseDate('2026-2-09'), /YYYY-MM-DD/);
  assert.equal(C.dateKey(C.monday('2000-01-01')), '1999-12-27');
  assert.equal(C.dateKey(C.addDays('2100-12-31', 1)), '2101-01-01');
  const boundary = sample(); boundary.days = [{ ...boundary.days[0], date: '2000-01-01' }];
  assert.equal(C.weeks(C.validatePlan(boundary))[0].start, '1999-12-27');
  boundary.days[0].date = '1999-12-31';
  assert.throws(() => C.validatePlan(boundary), /between 2000 and 2100/);
});
test('malformed imports never become a partial plan', () => {
  const mutations = [
    p => p.days[1].date = p.days[0].date,
    p => p.days.splice(1, 1),
    p => p.days[1].distance = -1,
    p => p.days[1].distance = '4',
    p => p.days[1].rpe = 11,
    p => p.days[1].rpe = 2.5,
    p => p.days[1].minutes = 0,
    p => p.days[0].type = 'rest',
    p => p.days[4].type = 'cross',
    p => p.days[1].fueling = null,
    p => p.units = 'miles',
    p => p.version = 2,
    p => p.days[0].title = '<b>'.repeat(101),
    p => p.days[1].type = 'race',
    p => p.days[1].easyMinutes = p.days[1].minutes + 1,
    p => p.paceReference.timeSeconds = -100,
    p => p.paceReference.basis = 'measured-vo2max'
  ];
  for (const mutate of mutations) { const p = sample(); mutate(p); assert.throws(() => C.validatePlan(p)); }
  assert.throws(() => C.parseImport('{nope}'), /not valid JSON/);
  assert.throws(() => C.parseImport('x'.repeat(C.MAX_BYTES + 1)), /1 MB/);
});
test('export round-trip accepts fenced JSON, preserves check-ins and strips unexpected keys', () => {
  const input = { ...sample(), sample: true, checkins: { '2026-10-13': { completed: true, rpe: 3, notes: 'Felt good' }, '1999-01-01': { completed: true } }, apiKey: 'not-a-real-key' };
  const result = C.parseImport('```json\n' + JSON.stringify(input) + '\n```');
  assert.equal(result.isDemo, true);
  assert.equal(result.checkins['2026-10-13'].completed, true);
  assert.equal(result.checkins['2026-10-13'].notes, 'Felt good');
  assert.equal(result.checkins['1999-01-01'], undefined);
  assert.equal(result.plan.apiKey, undefined);
  assert.equal(result.plan.days.length, 63);
  assert.deepEqual(result.plan.paceReference, sample().paceReference);
  assert.equal(result.plan.days[41].easyMinutes, 83);
  assert.equal(result.plan.days[0].phase, 'Speed and aerobic volume');
});
test('unit conversion round-trips without changing the source distance', () => {
  assert.equal(C.convertDistance(10, 'mi', 'km'), 16.09344);
  assert.ok(Math.abs(C.convertDistance(16.09344, 'km', 'mi') - 10) < 1e-10);
  assert.equal(C.convertDistance(10, 'mi', 'mi'), 10);
});
test('rest-only weeks do not divide by zero', () => {
  assert.equal(C.summarize([{ type: 'rest', distance: 0, minutes: 0, rpe: 0 }]).easyPercent, null);
  assert.equal(C.summarize([]).distance, 0);
});
test('prompt includes user instructions, block dates, units and the import contract', () => {
  const prompt = C.buildPrompt({ startDate: '2026-12-21', weeks: '4', units: 'km', days: ['Tuesday', 'Sunday'], goal: '10K', mileage: '30', baseline: 'Returning after a break', longDay: 'Sunday', instructions: 'Prefer hills over track intervals' });
  assert.match(prompt, /2027-01-17/);
  assert.match(prompt, /ALL 28 consecutive/);
  assert.match(prompt, /Prefer hills over track intervals/);
  assert.match(prompt, /"units": "km"/);
  assert.match(prompt, /Tuesday, Sunday/);
});
test('calendar export escapes injection and folds unicode at 75 UTF-8 octets', () => {
  const plan = sample();
  plan.days[0].title = 'Run, café; \\ test\nEND:VEVENT';
  plan.days[0].description = '🏃é'.repeat(200);
  const ics = C.toICS(plan);
  assert.equal(ics.match(/^BEGIN:VEVENT$/gm).length, 63);
  assert.equal(ics.match(/^END:VEVENT$/gm).length, 63);
  assert.match(ics, /DTSTART;VALUE=DATE:20260907/);
  assert.match(ics, /DTEND;VALUE=DATE:20260908/);
  assert.match(ics, /SUMMARY:Run\\, café\\; \\\\ test\\nEND:VEVENT/);
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('🏃é'.repeat(200)));
});
test('2:35 goal yields reproducible Daniels–Gilbert equivalents with exact marathon pace', () => {
  const result = C.equivalentPaces({ distanceMeters: 42195, timeSeconds: 9300, basis: 'goal' });
  assert.ok(Math.abs(result.score - 63.8177883) < 0.00001);
  assert.deepEqual(result.races.map(race => C.formatTime(race.perMile)), ['5:55', '5:39', '5:24', '5:12', '4:42']);
  assert.deepEqual(result.races.map(race => C.formatTime(race.seconds)), ['2:35:00', '1:14:04', '33:33', '16:10', '4:42']);
  assert.ok(Math.abs(result.races[0].perMile - 9300 / (42195 / 1609.344)) < 1e-9);
  assert.equal(C.formatTime(result.races[0].perKm), '3:40');
  assert.equal(C.formatTime(result.races[3].per400, 1), '1:17.6');
  const reverse = C.equivalentPaces({ distanceMeters: 5000, timeSeconds: result.races[3].seconds, basis: 'recent-race' });
  assert.ok(Math.abs(reverse.races[0].seconds - 9300) < 1e-6);
});
test('equivalence agrees with V.O2 published 40-minute 10K to 5:38 mile example', () => {
  const result = C.equivalentPaces({ distanceMeters: 10000, timeSeconds: 2400, basis: 'recent-race' });
  assert.ok(Math.abs(result.races[4].seconds - 338) < 2);
});
test('time input and rounding handle invalid fields and carries', () => {
  assert.equal(C.parseTime('2:35:00'), 9300);
  assert.equal(C.parseTime('16:10'), 970);
  assert.equal(C.formatTime(3599.6), '1:00:00');
  assert.equal(C.formatTime(59.96, 1), '1:00.0');
  for (const value of ['2:75:00', '2:35:90', '2.35', '0:00', 'hello', '1:2:3']) assert.throws(() => C.parseTime(value));
  assert.throws(() => C.validatePaceReference({ distanceMeters: 42195, timeSeconds: 1000, basis: 'goal' }), /VDOT range/);
  assert.throws(() => C.validatePaceReference({ distanceMeters: 42.195, timeSeconds: 9300, basis: 'goal' }), /reference performance/);
});
test('legacy plans remain valid without pace references or segment estimates', () => {
  const legacy = sample(); delete legacy.paceReference;
  for (const day of legacy.days) delete day.easyMinutes;
  const validated = C.validatePlan(legacy);
  assert.equal(validated.paceReference, undefined);
  const totals = C.summarize(validated.days);
  assert.equal(totals.detailedEffort, false);
  assert.ok(totals.easyPercent > 0);
});
test('prompt distinguishes target volume and finish time from current fitness', () => {
  const prompt = C.buildPrompt({ startDate: '2026-10-12', weeks: '4', units: 'mi', days: ['Tuesday', 'Sunday'], goal: 'Marathon', goalTime: '2:35:00', peakMileage: '110', mileage: '80', baseline: 'Recent consistent training', longDay: 'Sunday' });
  assert.match(prompt, /Target race time: 2:35:00/);
  assert.match(prompt, /Peak weekly distance target: 110 mi; target only/);
  assert.match(prompt, /"timeSeconds": 9300/);
  assert.match(prompt, /"basis": "goal"/);
  assert.match(prompt, /easyMinutes/);
});
test('preparation phase has spaced speed sessions, aerobic Sundays, and bounded easy minutes', () => {
  const prep = sample().days.slice(0, 35);
  for (let w = 0; w < 5; w++) {
    const week = prep.slice(w * 7, w * 7 + 7);
    assert.deepEqual(week.map((day, i) => day.type === 'quality' ? i : null).filter(i => i !== null), [1, 4]);
    assert.match(week[1].description, /easy jog between repetitions/);
    assert.match(week[4].description, /full .* m easy jog/);
    assert.equal(week[6].type, 'long');
    assert.ok(week[6].distance >= 22 && week[6].distance <= 24);
    assert.equal(week[6].minutes, week[6].easyMinutes);
    assert.ok(C.summarize(week).distance >= 90 && C.summarize(week).distance <= 100);
    for (const day of week) assert.ok(day.easyMinutes > 0 && day.easyMinutes <= day.minutes);
  }
  assert.match(prep[1].pace, /3:14 \/1 km/);
  assert.match(prep[4].pace, /0:35 \/200 m/);
});
test('longer Sundays redistribute mileage and retain the two specified fast finishes', () => {
  const plan = sample();
  const sundays = plan.days.filter(day => day.type === 'long');
  assert.deepEqual(sundays.map(day => day.distance), [22, 22, 23, 24, 22, 22, 24, 22, 22]);
  assert.deepEqual(sundays.filter(day => day.rpe > 4).map(day => day.date), ['2026-10-18', '2026-11-01']);
  for (const day of sundays.filter(day => day.rpe <= 4)) {
    assert.equal(day.easyMinutes, day.minutes);
    assert.ok(day.minutes > 150);
    assert.match(day.fueling.during, /90 g/);
  }
});
test('sample revision preserves logs, custom workouts, past dates and weekly mileage', () => {
  const previous = () => JSON.parse(JSON.stringify(C.samplePlan(false)).replace(/Practice/g, 'Practise').replace(/practice/g, 'practise'));
  const original = previous();
  const current = C.extendSample(C.validatePlan(original), {}, '2026-09-08');
  assert.deepEqual(current.days, sample().days);
  assert.equal(current.nutritionNote, sample().nutritionNote);
  for (const mode of ['past', 'logged', 'edited']) {
    const old = previous();
    const checkins = mode === 'logged' ? { '2026-09-09': { completed: false, rpe: null, notes: 'Already ran this' } } : {};
    if (mode === 'edited') old.days[2].description = 'My custom Wednesday';
    delete old.paceReference;
    const updated = C.extendSample(C.validatePlan(old), checkins, mode === 'past' ? '2026-09-10' : '2026-09-08');
    assert.deepEqual(updated.days.slice(0, 7).map(day => day.distance), old.days.slice(0, 7).map(day => day.distance));
    assert.equal(updated.days[13].distance, 22);
    assert.deepEqual(C.weeks(updated).map(week => C.summarize(week.days).distance), [90, 94, 98, 100, 92, 96, 104, 110, 88]);
    assert.equal(updated.paceReference, undefined);
    if (mode === 'edited') assert.equal(updated.days[2].description, 'My custom Wednesday');
    assert.deepEqual(C.validateCheckins(checkins, updated), checkins);
  }
});
test('extending the prior CIM sample preserves existing workouts, paces, and applicable check-ins', () => {
  const prior = sample();
  prior.days = prior.days.slice(35);
  prior.sampleRevision = 'cim-2026-1';
  prior.title = 'CIM 2026 · Marathon-specific block';
  prior.days[1].description = 'My edited workout details';
  prior.paceReference = { distanceMeters: 10000, timeSeconds: 2010, basis: 'recent-race' };
  const checkins = { '2026-10-13': { completed: true, rpe: 6, notes: 'Keep my log' } };
  const extended = C.extendSample(C.validatePlan(prior));
  assert.equal(extended.days.length, 63);
  assert.equal(extended.days[36].description, 'My edited workout details');
  assert.deepEqual(extended.paceReference, prior.paceReference);
  assert.deepEqual(C.validateCheckins(checkins, extended), checkins);
  assert.equal(extended.sampleRevision, C.SAMPLE_REVISION);
  assert.equal(extended.title, 'CIM 2026 · Training plan');
  assert.equal(C.extendSample(extended), extended); // Idempotent.
  delete prior.paceReference;
  assert.equal(C.extendSample(prior).paceReference, undefined);
  delete prior.sampleRevision;
  assert.equal(C.extendSample(prior), prior); // No auto-extension of unrecognized imports.
});
