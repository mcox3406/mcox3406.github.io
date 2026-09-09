/* Shared plan model: no network, DOM, or storage dependencies. */
(function (root) {
  'use strict';
  const KM_PER_MILE = 1.609344;
  const TYPES = ['easy', 'quality', 'long', 'rest', 'cross'];
  const MAX_BYTES = 1000000;
  const SAMPLE_REVISION = 'cim-2026-3';
  const RACE_DISTANCES = [
    { label: 'MP', name: 'Marathon', meters: 42195 },
    { label: 'HMP', name: 'Half marathon', meters: 21097.5 },
    { label: '10K', name: '10 km', meters: 10000 },
    { label: '5K', name: '5 km', meters: 5000 },
    { label: 'Mile', name: '1 mile', meters: 1609.344 }
  ];
  function parseTime(value) {
    if (typeof value !== 'string' || !/^(?:\d{1,2}:)?\d{1,2}:\d{2}$/.test(value.trim())) throw new Error('Enter time as m:ss or h:mm:ss.');
    const parts = value.trim().split(':').map(Number);
    if (parts.at(-1) >= 60 || (parts.length === 3 && parts[1] >= 60)) throw new Error('Minutes and seconds must be below 60 in h:mm:ss.');
    const seconds = parts.reduce((total, part) => total * 60 + part, 0);
    if (!seconds) throw new Error('Enter a positive race time.');
    return seconds;
  }
  function formatTime(seconds, decimals = 0) {
    const scale = 10 ** decimals, ticks = Math.round(seconds * scale);
    const hours = Math.floor(ticks / (3600 * scale)), minutes = Math.floor(ticks / (60 * scale)) % 60;
    const remainder = ((ticks % (60 * scale)) / scale).toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
  }
  // Daniels–Gilbert oxygen-cost/duration equations; d in meters, t in minutes.
  // Reproduced in Smyth et al. (2022), equations 7–9: doi:10.1007/s11257-021-09299-3.
  // This is a performance index, not a laboratory measurement of VO2max.
  function vdot(meters, seconds) {
    const t = seconds / 60, v = meters / t;
    return (-4.6 + 0.182258 * v + 0.000104 * v * v) /
      (0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t));
  }
  function validatePaceReference(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Pace reference must be an object.');
    if (!RACE_DISTANCES.some(race => race.meters === input.distanceMeters)) throw new Error('Choose marathon, half marathon, 10K, 5K, or mile for the reference performance.');
    const timeSeconds = number(input.timeSeconds, 'Reference time in seconds', 120, 36000);
    if (!['goal', 'recent-race'].includes(input.basis)) throw new Error('Pace basis must be goal or recent-race.');
    const score = vdot(input.distanceMeters, timeSeconds);
    if (score < 15 || score > 85) throw new Error('This reference is outside the supported VDOT range (15–85). Check the race distance and time.');
    return { distanceMeters: input.distanceMeters, timeSeconds, basis: input.basis };
  }
  function equivalentPaces(input) {
    const reference = validatePaceReference(input);
    const score = vdot(reference.distanceMeters, reference.timeSeconds);
    return { score, races: RACE_DISTANCES.map(race => {
      let low = 30, high = 86400;
      for (let i = 0; i < 80; i++) {
        const mid = (low + high) / 2;
        if (vdot(race.meters, mid) > score) low = mid; else high = mid;
      }
      const seconds = race.meters === reference.distanceMeters ? reference.timeSeconds : (low + high) / 2;
      return { ...race, seconds, perMile: seconds / race.meters * 1609.344, perKm: seconds / race.meters * 1000, per400: seconds / race.meters * 400 };
    }) };
  }
  function dateKey(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }
  function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Dates must use YYYY-MM-DD.');
    const [year, month, day] = value.split('-').map(Number);
    const result = new Date(year, month - 1, day, 12);
    if (year < 1000 || dateKey(result) !== value) throw new Error('Use real calendar dates with four-digit years.');
    return result;
  }
  function addDays(value, count) { const d = typeof value === 'string' ? parseDate(value) : new Date(value); d.setDate(d.getDate() + count); return d; }
  function monday(value) { const d = typeof value === 'string' ? parseDate(value) : new Date(value); return addDays(d, -((d.getDay() + 6) % 7)); }
  function text(value, name, limit, required = false) {
    if (value === undefined && !required) return '';
    if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw new Error(`${name} must be ${required ? 'nonempty ' : ''}text of at most ${limit} characters.`);
    return value.trim();
  }
  function number(value, name, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be a number from ${min} to ${max}.`);
    return value;
  }
  function validatePlan(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The plan must be a JSON object.');
    if (input.version !== 1) throw new Error('This planner accepts version 1 plans. Use “Create plan” for the expected format.');
    if (!['mi', 'km'].includes(input.units)) throw new Error('Plan units must be "mi" or "km".');
    if (!Array.isArray(input.days) || input.days.length < 1 || input.days.length > 168) throw new Error('A plan must contain 1–168 consecutive days, including rest days.');
    const plan = { version: 1, title: text(input.title, 'Plan title', 120, true), units: input.units, nutritionNote: text(input.nutritionNote, 'Nutrition note', 3000), days: [] };
    if (input.paceReference !== undefined) plan.paceReference = validatePaceReference(input.paceReference);
    if (['cim-2026-1', 'cim-2026-2', SAMPLE_REVISION].includes(input.sampleRevision)) plan.sampleRevision = input.sampleRevision;
    input.days.forEach((day, i) => {
      if (!day || typeof day !== 'object' || Array.isArray(day)) throw new Error(`Day ${i + 1} must be an object.`);
      parseDate(day.date);
      if (day.date < '2000-01-01' || day.date > '2100-12-31') throw new Error('Plan dates must fall between 2000 and 2100.');
      if (!TYPES.includes(day.type)) throw new Error(`${day.date}: type must be easy, quality, long, rest, or cross.`);
      const distance = number(day.distance, `${day.date} distance`, 0, input.units === 'mi' ? 200 : 322);
      const minutes = number(day.minutes, `${day.date} minutes`, 0, 2880);
      const rpe = number(day.rpe, `${day.date} RPE`, 0, 10);
      if (!Number.isInteger(rpe)) throw new Error(`${day.date}: RPE must be a whole number.`);
      if (['rest', 'cross'].includes(day.type) && distance !== 0) throw new Error(`${day.date}: rest and cross-training days must have zero running distance.`);
      if (day.type === 'rest' && (minutes !== 0 || rpe !== 0)) throw new Error(`${day.date}: rest days must have zero minutes and RPE.`);
      if (day.type !== 'rest' && (minutes === 0 || rpe === 0)) throw new Error(`${day.date}: active sessions need minutes and an RPE of 1–10.`);
      if (['easy', 'quality', 'long'].includes(day.type) && distance === 0) throw new Error(`${day.date}: runs need a positive distance.`);
      if (i && day.date !== dateKey(addDays(plan.days[i - 1].date, 1))) throw new Error('Include every date once, in order, with rest days between sessions.');
      const fueling = day.fueling === undefined ? {} : day.fueling;
      if (!fueling || typeof fueling !== 'object' || Array.isArray(fueling)) throw new Error(`${day.date}: fueling must be an object with before, during, and after text.`);
      const clean = {
        date: day.date, type: day.type, title: text(day.title, `${day.date} title`, 100, true), distance, minutes, rpe,
        pace: text(day.pace, `${day.date} pace`, 180), description: text(day.description, `${day.date} description`, 5000),
        fueling: { before: text(fueling.before, 'Before-run fueling', 2000), during: text(fueling.during, 'During-run fueling', 2000), after: text(fueling.after, 'After-run fueling', 2000) }
      };
      if (day.phase !== undefined) clean.phase = text(day.phase, `${day.date} training phase`, 60);
      if (day.easyMinutes !== undefined) {
        clean.easyMinutes = number(day.easyMinutes, `${day.date} easy running minutes`, 0, minutes);
        if (['rest', 'cross'].includes(day.type) && clean.easyMinutes !== 0) throw new Error(`${day.date}: non-running days must have zero easy running minutes.`);
      }
      plan.days.push(clean);
    });
    return plan;
  }
  function parseImport(raw, maxBytes = MAX_BYTES) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > maxBytes) throw new Error(`Choose a plan file smaller than ${maxBytes / 1000000} MB.`);
    const stripped = raw.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim();
    let input;
    try { input = JSON.parse(stripped); } catch { throw new Error('That is not valid JSON. Paste only the structured plan from your AI chat, including the outer { } braces.'); }
    const plan = validatePlan(input);
    return { plan, checkins: validateCheckins(input.checkins, plan), isDemo: input.sample === true };
  }
  function validateCheckins(input, plan) {
    const result = {};
    if (!input || typeof input !== 'object') return result;
    for (const day of plan.days) {
      const row = Object.hasOwn(input, day.date) ? input[day.date] : null;
      if (!row || typeof row !== 'object') continue;
      result[day.date] = { completed: row.completed === true, rpe: Number.isInteger(row.rpe) && row.rpe >= 1 && row.rpe <= 10 ? row.rpe : null, notes: typeof row.notes === 'string' ? row.notes.slice(0, 3000) : '' };
    }
    return result;
  }
  function convertDistance(value, from, to) { return from === to ? value : from === 'mi' ? value * KM_PER_MILE : value / KM_PER_MILE; }
  function weeks(plan) {
    const groups = [];
    for (const day of plan.days) {
      const key = dateKey(monday(day.date));
      if (!groups.length || groups[groups.length - 1].start !== key) groups.push({ start: key, days: [] });
      groups[groups.length - 1].days.push(day);
    }
    return groups;
  }
  function summarize(days, checkins = {}) {
    const runs = days.filter(day => ['easy', 'quality', 'long'].includes(day.type));
    const distance = runs.reduce((total, day) => total + day.distance, 0);
    const minutes = runs.reduce((total, day) => total + day.minutes, 0);
    const detailedEffort = runs.length > 0 && runs.every(day => day.easyMinutes !== undefined);
    const easyMinutes = runs.reduce((total, day) => total + (day.easyMinutes ?? (day.rpe <= 4 ? day.minutes : 0)), 0);
    return { distance, minutes, easyMinutes, detailedEffort, easyPercent: minutes ? Math.round(easyMinutes / minutes * 100) : null, runs: runs.length, completed: runs.filter(day => checkins[day.date]?.completed).length };
  }
  function analyzePlan(plan, checkins = {}, today = dateKey(new Date())) {
    const cumulative = { distance: 0, minutes: 0, effort: 0 };
    const completedCumulative = { ...cumulative };
    const daily = plan.days.map(day => {
      const run = ['easy', 'quality', 'long'].includes(day.type);
      const planned = { distance: run ? day.distance : 0, minutes: run ? day.minutes : 0, effort: run ? day.minutes * day.rpe : 0 };
      const done = run && day.date <= today && checkins[day.date]?.completed === true;
      const completed = Object.fromEntries(Object.entries(planned).map(([key, value]) => [key, done ? value : 0]));
      for (const key of Object.keys(cumulative)) { cumulative[key] += planned[key]; completedCumulative[key] += completed[key]; }
      return { date: day.date, type: day.type, run, done, planned, completed, cumulative: { ...cumulative }, completedCumulative: { ...completedCumulative },
        reportedRpe: run && day.date <= today ? checkins[day.date]?.rpe ?? null : null };
    });
    daily.forEach((day, i) => { day.rollingDistance = i < 6 ? null : daily.slice(i - 6, i + 1).reduce((total, row) => total + row.planned.distance, 0); });
    const byDate = new Map(daily.map(day => [day.date, day]));
    const weekly = weeks(plan).map(week => {
      const rows = week.days.map(day => byDate.get(day.date));
      const planned = summarize(week.days);
      const reported = rows.filter(row => row.reportedRpe !== null);
      return { ...week, ...planned, partial: week.days.length !== 7,
        effort: rows.reduce((total, row) => total + row.planned.effort, 0),
        completed: rows.reduce((totals, row) => {
          for (const key of ['distance', 'minutes', 'effort']) totals[key] += row.completed[key];
          return totals;
        }, { distance: 0, minutes: 0, effort: 0 }),
        completedDays: rows.filter(row => row.done).length,
        longestRun: Math.max(0, ...rows.map(row => row.planned.distance)),
        qualityDays: week.days.filter(day => day.type === 'quality').length,
        reportedRpe: reported.length ? reported.reduce((total, row) => total + row.reportedRpe, 0) / reported.length : null,
        reportedDays: reported.length,
        composition: ['easy', 'quality', 'long'].map(type => ({ type, distance: rows.filter(row => row.type === type).reduce((total, row) => total + row.planned.distance, 0) })) };
    });
    weekly.forEach((week, i) => {
      const prior = weekly[i - 1];
      week.distanceChange = prior && !prior.partial && !week.partial && prior.distance > 0 ? (week.distance / prior.distance - 1) * 100 : null;
    });
    const fullWeeks = weekly.filter(week => !week.partial);
    const total = summarize(plan.days);
    const pastRuns = daily.filter(day => day.run && day.date < today);
    const longDistance = daily.filter(day => day.type === 'long').reduce((sum, day) => sum + day.planned.distance, 0);
    return { daily, weekly, total: { ...total, effort: cumulative.effort, completed: { ...completedCumulative },
      completedDays: daily.filter(day => day.done).length,
      scheduledPastDays: pastRuns.length, completedPastDays: pastRuns.filter(day => day.done).length,
      completionPercent: pastRuns.length ? 100 * pastRuns.filter(day => day.done).length / pastRuns.length : null,
      averageWeek: fullWeeks.length ? fullWeeks.reduce((sum, week) => sum + week.distance, 0) / fullWeeks.length : null,
      peakWeek: fullWeeks.length ? Math.max(...fullWeeks.map(week => week.distance)) : null,
      peakRollingDistance: daily.length >= 7 ? Math.max(...daily.map(day => day.rollingDistance ?? 0)) : null,
      longestRun: Math.max(0, ...daily.map(day => day.planned.distance)), longDistance,
      longPercent: total.distance ? longDistance / total.distance * 100 : null,
      qualityDays: plan.days.filter(day => day.type === 'quality').length,
      longDays: plan.days.filter(day => day.type === 'long').length,
      reportedDays: daily.filter(day => day.reportedRpe !== null).length } };
  }
  function sampleFueling(type, minutes, evening) {
    return {
      before: type === 'quality' || type === 'long' ? 'Use a familiar carbohydrate-rich meal before the main session. Timing and portion size should reflect prior tolerance; avoid introducing new foods on a long-workout day.' : evening ? 'Maintain carbohydrate availability for both runs; include a meal or snack between AM and PM sessions.' : 'Use your normal pre-run meal or snack according to timing and tolerance.',
      during: type === 'long' ? (minutes > 150 ? 'Reference range for runs over 2.5 h: up to 90 g carbohydrate/h if tolerated. Practice the intended race products and record intake and GI symptoms. Individualize fluids to conditions and sweat losses.' : `For this ~${(minutes / 60).toFixed(1)} h run, practice 30–60 g carbohydrate/h. Record intake and GI tolerance. Individualize fluids to conditions and sweat losses.`) : type === 'quality' ? 'For individual sessions lasting 1–2.5 h, 30–60 g carbohydrate/h is a reference range. Count drink and gel carbohydrate together; adjust to tolerance.' : 'Schedule water access. Fuel longer individual runs according to duration; daily mileage from doubles is not one continuous exercise bout.',
      after: evening ? 'Include carbohydrate and protein after the AM session, then eat normally before the PM run. Record recovery and appetite rather than inferring energy needs from mileage alone.' : 'Include carbohydrate and protein in the next meal. Review total intake against training demand, recovery, and dietary preferences.'
    };
  }
  function preparationDays(paces, longRuns) {
    const start = parseDate('2026-09-07');
    const ten = paces[2], five = paces[3], mile = paces[4];
    const distances = longRuns
      ? [[12, 14, 12, 10, 12, 8, 22], [12, 16, 12, 10, 14, 8, 22], [12, 16, 14, 11, 14, 8, 23], [12, 16, 14, 12, 14, 8, 24], [12, 14, 12, 12, 12, 8, 22]]
      : [[12, 14, 14, 12, 12, 8, 18], [12, 16, 14, 12, 14, 8, 18], [14, 16, 16, 12, 14, 8, 18], [14, 16, 16, 12, 14, 8, 20], [12, 14, 14, 12, 12, 10, 18]];
    const intervals = [
      { count: 6, meters: 1000, race: five, label: '5K', recovery: '2 min' },
      { count: 5, meters: 1609.344, race: ten, label: '10K', recovery: '2 min' },
      { count: 8, meters: 800, race: five, label: '5K', recovery: '2 min' },
      { count: 4, meters: 2000, race: ten, label: '10K', recovery: '3 min' },
      { count: 5, meters: 1000, race: five, label: '5K', recovery: '2 min' }
    ];
    const repetitions = [{ count: 8, meters: 200 }, { count: 10, meters: 200 }, { count: 6, meters: 400 }, { count: 10, meters: 200 }, { count: 6, meters: 200 }];
    return distances.flatMap((week, w) => week.map((distance, d) => {
      const evening = d < 5 ? 4 : 0, morning = distance - evening;
      let type = d === 6 ? 'long' : 'easy', fast = 0, rate = 0;
      let title = evening ? `Easy ${morning} + ${evening} mi` : d === 6 ? 'Aerobic long run' : 'Easy run';
      let pace = d === 6 ? '6:50–7:20 /mi · easy' : '6:50–7:40 /mi · easy';
      let description = evening ? `AM ${morning} mi easy; PM ${evening} mi easy. Keep both runs conversational; adjust the sample pace range to recovery and conditions.` : `${distance} mi easy at conversational effort.${d === 6 ? ' Continuous aerobic running; keep the finish easy. The marathon-specific progression runs start in October.' : ' Keep this run easy between Friday repetitions and Sunday’s long run.'}`;
      if (d === 1) {
        const workout = intervals[w];
        const repLabel = workout.meters === 1609.344 ? '1 mi' : workout.meters >= 1000 ? `${workout.meters / 1000} km` : `${workout.meters} m`;
        const repTime = formatTime(workout.race.seconds * workout.meters / workout.race.meters);
        type = 'quality'; fast = workout.count * workout.meters / 1609.344; rate = workout.race.perMile;
        title = `${workout.count} × ${repLabel} @ ${workout.label}`;
        pace = `${repTime} /${repLabel} · ${workout.label}`;
        description = `AM ${morning} mi total: 2 mi easy warm-up; ${workout.count} × ${repLabel} at estimated ${workout.label} pace (~${repTime} per rep), with ${workout.recovery} easy jog between repetitions; easy cool-down to ${morning} mi. PM ${evening} mi easy. Keep the repetitions controlled and even.${w === 4 ? ' Reduced interval volume before the marathon-specific block begins.' : ''}`;
      } else if (d === 4) {
        const workout = repetitions[w], repTime = formatTime(mile.per400 * workout.meters / 400);
        type = 'quality'; fast = workout.count * workout.meters / 1609.344; rate = mile.perMile;
        title = `${workout.count} × ${workout.meters} m @ mile`;
        pace = `${repTime} /${workout.meters} m · mile`;
        description = `AM ${morning} mi total: 2 mi easy warm-up; ${workout.count} × ${workout.meters} m at relaxed mile effort (~${repTime} per rep), with a full ${workout.meters} m easy jog between repetitions. Extend recovery if needed to retain relaxed form; easy cool-down completes ${morning} mi. PM ${evening} mi easy. This is a short speed/economy session with full recoveries. The pace is a goal-based reference; use current mile effort rather than forcing the estimate.`;
      }
      const easyMinutes = Math.round((distance - fast) * (d === 6 ? 425 : 435) / 60 * 10) / 10;
      const minutes = Math.round((easyMinutes + fast * rate / 60) * 10) / 10;
      return { date: dateKey(addDays(start, w * 7 + d)), phase: 'Speed and aerobic volume', type, title, distance, minutes, easyMinutes,
        rpe: d === 1 ? 7 : d === 4 ? 6 : d === 6 ? 4 : 3, pace, description, fueling: sampleFueling(type, minutes, evening) };
    }));
  }
  function extendSample(plan, checkins = {}, today = dateKey(new Date())) {
    const fourWeeks = plan.sampleRevision === 'cim-2026-1' && plan.days.length === 28 && plan.days[0].date === '2026-10-12';
    const nineWeeks = plan.sampleRevision === 'cim-2026-2' && plan.days.length === 63 && plan.days[0].date === '2026-09-07';
    if (plan.units !== 'mi' || (!fourWeeks && !nineWeeks) || plan.days.at(-1).date !== '2026-11-08') return plan;
    const latest = samplePlan(), previous = samplePlan(false);
    const baseline = new Map(previous.days.map(day => [day.date, day]));
    const updates = new Map(latest.days.map(day => [day.date, day]));
    const extended = validatePlan({ ...plan,
      days: fourWeeks ? [...latest.days.slice(0, 35), ...plan.days.map(day => ({ ...day, phase: day.phase || 'Marathon-specific' }))] : plan.days });
    // Apply each mileage redistribution as a whole. Preserve any changed date that
    // is past, logged, or customized, and retain the rest of that week's distances.
    const comparable = day => JSON.stringify(day).replace(/\bPractise\b/g, 'Practice').replace(/\bpractise\b/g, 'practice');
    extended.days = weeks(extended).flatMap(week => {
      const changed = week.days.filter(day => baseline.get(day.date).distance !== updates.get(day.date).distance);
      const canUpdate = changed.every(day => {
        const log = checkins[day.date];
        return day.date >= today && !(log?.completed || log?.rpe || log?.notes) && comparable(day) === comparable(baseline.get(day.date));
      });
      return canUpdate ? week.days.map(day => changed.includes(day) ? updates.get(day.date) : day) : week.days;
    });
    extended.days = extended.days.map(day => {
      const fueling = { ...day.fueling };
      for (const phase of ['before', 'during', 'after']) {
        const normalized = fueling[phase].replace(/\bPractise\b/g, 'Practice').replace(/\bpractise\b/g, 'practice');
        if (normalized === baseline.get(day.date).fueling[phase]) fueling[phase] = normalized;
      }
      return { ...day, fueling };
    });
    return validatePlan({ ...extended, sampleRevision: SAMPLE_REVISION,
      nutritionNote: plan.nutritionNote === previous.nutritionNote.replace(/\bPractice\b/g, 'Practise') ? latest.nutritionNote : plan.nutritionNote,
      title: plan.title === 'CIM 2026 · Marathon-specific block' ? latest.title : plan.title });
  }
  // The previous distance schedule is retained only to recognize untouched sample
  // workouts during migration; public calls use the current sample by default.
  function samplePlan(longRuns = true) {
    const start = parseDate('2026-10-12');
    const paceReference = { distanceMeters: 42195, timeSeconds: 9300, basis: 'goal' };
    const paces = equivalentPaces(paceReference).races;
    const half = paces[1], ten = paces[2], five = paces[3], mile = paces[4];
    const distances = longRuns
      ? [[12, 16, 14, 14, 10, 8, 22], [14, 18, 14, 16, 10, 8, 24], [14, 18, 18, 16, 12, 10, 22], [10, 14, 12, 10, 10, 10, 22]]
      : [[12, 16, 14, 14, 10, 8, 22], [14, 18, 16, 16, 10, 8, 22], [14, 18, 18, 16, 12, 10, 22], [10, 14, 14, 12, 10, 10, 18]];
    const pm = [[4, 4, 4, 4, 4, 0, 0], [4, 6, 4, 8, 4, 0, 0], [4, 6, 6, 4, 4, 0, 0], [4, 4, 4, 4, 4, 0, 0]];
    const tuesday = [
      { title: '6 × 1 mi @ HMP', fast: 6, rate: half.perMile, pace: `${formatTime(half.perMile)} /mi · HMP`, description: 'AM 12 mi: 3 mi warm-up; 6 × 1 mi at HMP with 5 × 0.2 mi easy jog (~85–95 s); 2 mi cool-down. PM 4 mi easy. Controlled repetitions faster than MP; maintain the same pace across reps.' },
      { title: '5 × 1 mi @ 10K', fast: 5, rate: ten.perMile, pace: `${formatTime(ten.perMile)} /mi · 10K`, description: 'AM 12 mi: 3 mi warm-up; 5 × 1 mi at 10K pace with 4 × 0.25 mi easy jog; 3 mi cool-down. PM 6 mi easy. Approximately 27 min of work at estimated 10K pace.' },
      { title: '3 × 2 mi @ HMP', fast: 6, rate: half.perMile, pace: `${formatTime(half.perMile)} /mi · HMP`, description: 'AM 12 mi: 2 mi warm-up; 3 × 2 mi at HMP with 2 × 0.5 mi easy jog; 3 mi cool-down. PM 6 mi easy. The peak-volume week has one midweek workout plus the Sunday progression.' },
      { title: '8 × 1 km @ 10K', fast: 8 / KM_PER_MILE, rate: ten.perMile, pace: `${formatTime(ten.perKm)} /km · 10K`, description: 'AM 10 mi total: 2 mi warm-up; 8 × 1 km at 10K pace with 7 × 250 m easy jog; easy cool-down to 10 mi. PM 4 mi easy. Retain a faster session while reducing weekly volume.' }
    ];
    const days = distances.flatMap((week, w) => week.map((distance, d) => {
      const evening = pm[w][d], morning = distance - evening;
      let type = d === 6 ? 'long' : 'easy', fast = 0, rate = 0, easyRate = d === 6 ? 425 : 435;
      let title = evening ? `Easy ${morning} + ${evening} mi` : d === 6 ? 'Aerobic long run' : 'Easy run';
      let pace = d === 6 ? '6:50–7:20 /mi · easy' : '6:50–7:40 /mi · easy';
      let description = evening ? `AM ${morning} mi easy; PM ${evening} mi easy. Keep both runs conversational. The pace range is a sample assumption; effort, terrain, and recovery determine the actual pace.` : `${distance} mi continuous at conversational effort. Sample easy-pace range; do not force the pace to meet a number.`;
      if (d === 1) {
        const workout = tuesday[w];
        ({ title, pace, description, fast, rate } = workout); type = 'quality';
      } else if (d === 3 && w < 2) {
        type = 'quality';
        if (w === 0) {
          title = '12 × 400 m @ 5K'; fast = 4.8 / KM_PER_MILE; rate = five.perMile;
          pace = `${formatTime(five.per400)} /400 m · 5K`;
          description = 'AM 10 mi total: 2 mi warm-up; 12 × 400 m at 5K pace with 11 × 200 m easy jog; easy cool-down to 10 mi. PM 4 mi easy. About 15.5 min of faster running; avoid accelerating the final repetitions.';
        } else {
          title = '10 × 200 m @ mile'; fast = 2 / KM_PER_MILE; rate = mile.perMile;
          pace = `${formatTime(mile.per400 / 2)} /200 m · mile`;
          description = 'AM 8 mi including 10 × 200 m at estimated mile pace, with full 200–400 m easy jog recoveries; warm-up and cool-down complete the 8 mi. PM 8 mi easy. Use relaxed form and full recovery; the mile equivalent is especially sensitive to individual speed and economy.';
        }
      } else if (d === 6 && (w === 0 || w === 2)) {
        title = '22 mi · last 10 < MP'; fast = 10; rate = 352; easyRate = 415;
        pace = 'Last 10: 5:50–5:54 /mi';
        description = '12 mi easy at approximately 6:50–7:00 /mi, then 10 mi at 5:50–5:54 /mi (slightly faster than the 5:54.7 /mi marathon goal). No additional run. This is a substantial marathon-specific session; the alternating Sunday is entirely easy. The prescribed finish comes from your workout preference, not a trial establishing an optimal 10-mile dose.';
      }
      const easyMinutes = Math.round((distance - fast) * easyRate / 60 * 10) / 10;
      const minutes = Math.round((easyMinutes + fast * rate / 60) * 10) / 10;
      return {
        date: dateKey(addDays(start, w * 7 + d)), phase: 'Marathon-specific', type, title, distance, minutes, easyMinutes,
        rpe: type === 'quality' ? 7 : fast ? 7 : d === 6 ? 4 : 3, pace, description,
        fueling: sampleFueling(type, minutes, evening)
      };
    }));
    return validatePlan({ version: 1, sampleRevision: longRuns ? SAMPLE_REVISION : 'cim-2026-2', title: 'CIM 2026 · Training plan', units: 'mi', paceReference,
      nutritionNote: 'Carbohydrate reference ranges: 30–60 g/h for continuous sessions of 1–2.5 h; up to 90 g/h beyond 2.5 h if tolerated. Practice race fueling in long runs and record GI response. Daily energy requirements need more context than mileage alone.', days: [...preparationDays(paces, longRuns), ...days] });
  }
  function buildPrompt(brief) {
    const start = dateKey(parseDate(brief.startDate));
    const count = Number(brief.weeks) * 7;
    const example = { version: 1, title: 'My training block', units: brief.units, nutritionNote: 'Overall fueling approach, preferences, and assumptions.', days: [{ date: start, type: 'rest', title: 'Rest day', distance: 0, minutes: 0, rpe: 0, pace: '', description: 'Purpose of the day and any optional recovery notes.', fueling: { before: 'Meal or snack ideas, if relevant.', during: 'Fueling and hydration notes, if relevant.', after: 'Recovery meal ideas, if relevant.' } }] };
    const race = RACE_DISTANCES.find(item => item.name.toLowerCase() === String(brief.goal).toLowerCase() || item.label === brief.goal);
    if (brief.goalTime) {
      const seconds = parseTime(brief.goalTime);
      if (race) example.paceReference = validatePaceReference({ distanceMeters: race.meters, timeSeconds: seconds, basis: 'goal' });
    }
    return `Develop a running and nutrition plan in American English using precise training terminology and an evidence-based rationale. First review my context, ask about important missing information, and discuss any conflicts or goals that are not supported by my recent training. Distinguish measured data, model estimates, coaching judgment, and my preferences. Cite relevant research for training and nutrition decisions, including its limitations. Do not invent my fitness or assume that a goal pace is my current fitness. I want to refine the plan with you before exporting it.

MY TRAINING BRIEF
Goal: ${brief.goal}
Race date: ${brief.raceDate || 'No fixed date'}
Target race time: ${brief.goalTime || 'Not specified'}
Current weekly running distance: ${brief.mileage} ${brief.units}
Peak weekly distance target: ${brief.peakMileage ? `${brief.peakMileage} ${brief.units}; target only, not current baseline` : 'Not specified'}
Recent training, experience, and fitness: ${brief.baseline}
Block: ${count} consecutive days, ${start} through ${dateKey(addDays(start, count - 1))}
Available running days: ${brief.days.join(', ')}
Preferred long-run day: ${brief.longDay}
Time per session: ${brief.time || 'Ask me if needed'}
Injuries, recovery, and other training: ${brief.constraints || 'Not specified; ask before making assumptions'}
Nutrition preferences and allergies: ${brief.nutrition || 'Not specified; ask before tailoring food suggestions'}
My coaching instructions: ${brief.instructions || 'No additional instructions'}

PLANNING GUIDANCE
Ground the workload in my recent sustainable training, recovery, and available time. Explain the purpose of sessions, include rest and appropriate recovery, and discuss progression and any taper in context. Include warm-ups, recoveries, cool-downs, and both runs of a double in daily distance and time. Describe AM/PM splits and recovery intervals explicitly. Supply easyMinutes per day when the easy portions can be estimated; it must be between 0 and total minutes, and must include easy warm-up, recovery, cool-down, and second-run minutes. Label estimated durations. Express the main session's effort using RPE (1–10); when fitness evidence is insufficient for numerical paces, use effort cues and ask for more context. Numeric pace text must include /mi, /km, or an explicit repetition distance such as /400 m. Do not equate HMP with measured lactate threshold or infer mile ability precisely from a marathon goal. Cross-training distance must be zero because the dashboard measures running distance only.
For nutrition, focus on practical meal and fueling ideas around the sessions, respect allergies and preferences, and ask about missing context. Do not prescribe weight-loss targets, calorie restriction, supplements, injury treatment, or medical nutrition therapy. Flag circumstances that need a qualified clinician or sports dietitian. Label assumptions and uncertainty.

WHEN WE AGREE ON THE PLAN, EXPORT FOR THE RUNNING PLANNER
Return one valid JSON object, without commentary, matching this example structure:
${JSON.stringify(example, null, 2)}

The example contains only one day to show the format. The final days array must include ALL ${count} consecutive dates in order, including rest days. Use version 1 and units "${brief.units}" throughout. Allowed types: easy, quality, long, rest, cross. Every day needs date, type, title, distance, minutes, rpe, pace, description, and a fueling object with before, during, after. Use numbers (not strings) for distance, minutes, rpe, and optional easyMinutes. Runs need positive distance and minutes; active sessions need a whole-number RPE of 1–10. Rest days have distance, minutes, rpe, and easyMinutes all zero; cross-training has zero running distance and easyMinutes. Optional plan-level paceReference has distanceMeters (42195, 21097.5, 10000, 5000, or 1609.344), timeSeconds, and basis ("goal" or "recent-race"); use only a reference performance supplied by me. Preserve the example's goal reference unless we agree on a recent race result instead. Use empty strings for inapplicable text. Keep title under 100 characters, pace under 180, descriptions under 5000, and each fueling field under 2000. Do not include API keys or other credentials. This JSON becomes a calendar that I can review and check off locally.`;
  }
  function toICS(plan) {
    const escape = value => String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Milepost//Running Planner//EN', 'CALSCALE:GREGORIAN'];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    plan.days.forEach(day => {
      const details = [day.description, `${day.distance} ${plan.units} · ${day.minutes} min · RPE ${day.rpe}/10`, day.pace, `Before: ${day.fueling.before}`, `During: ${day.fueling.during}`, `After: ${day.fueling.after}`].join('\n\n');
      lines.push('BEGIN:VEVENT', `UID:milepost-${day.date}@mcox3406.github.io`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${dateKey(addDays(day.date, 1)).replace(/-/g, '')}`, `SUMMARY:${escape(day.title)}`, `DESCRIPTION:${escape(details)}`, 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    // RFC 5545 limits physical lines to 75 octets, without splitting UTF-8 characters.
    return lines.map(line => {
      let folded = '', length = 0;
      for (const char of line) {
        const size = new TextEncoder().encode(char).length;
        if (length + size > 75) { folded += '\r\n '; length = 1; }
        folded += char; length += size;
      }
      return folded;
    }).join('\r\n') + '\r\n';
  }
  const api = { MAX_BYTES, SAMPLE_REVISION, RACE_DISTANCES, TYPES, parseTime, formatTime, vdot, validatePaceReference, equivalentPaces, dateKey, parseDate, addDays, monday, validatePlan, validateCheckins, parseImport, convertDistance, weeks, summarize, analyzePlan, extendSample, samplePlan, buildPrompt, toICS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MilepostCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
