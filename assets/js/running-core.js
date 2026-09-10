/* Activity normalization and descriptive statistics. No service or planner dependencies. */
(function (root) {
  'use strict';
  const DAY = 86400000, BIN = 15 * 60, MAX_BYTES = 12000000;
  const sports = ['Run', 'TrailRun', 'VirtualRun'];
  const dateKey = time => new Date(time).toISOString().slice(0, 10);
  // UTC is only a calendar-arithmetic container; startLocal stays in the activity's local clock.
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2100-12-31') throw new Error('Dates must use YYYY-MM-DD, between 2000 and 2100.');
    const time = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(time) || dateKey(time) !== value) throw new Error('An activity or coverage date is not a real calendar date.');
    return time;
  }
  function number(value, name, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be a number between ${min} and ${max}.`);
    return value;
  }
  function activity(row) {
    if (!row || typeof row !== 'object') throw new Error('Each activity must be an object.');
    if (typeof row.id !== 'string' || !/^[\w:-]{1,100}$/.test(row.id)) throw new Error('Each activity needs its original ID as a string (letters, numbers, :, - or _).');
    if (typeof row.startLocal !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(row.startLocal)) throw new Error('Use local start times as YYYY-MM-DDTHH:mm:ss, without a timezone suffix.');
    date(row.startLocal.slice(0, 10));
    if (!sports.includes(row.sport)) throw new Error('Include only Run, TrailRun, or VirtualRun activities.');
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200) throw new Error('Activity names need 1–200 characters.');
    const result = { id: row.id, startLocal: row.startLocal, sport: row.sport, name: row.name.trim(),
      distanceMeters: number(row.distanceMeters, 'Distance in meters', 0.01, 500000), movingSeconds: number(row.movingSeconds, 'Moving time in seconds', 1, 604800) };
    for (const [key, min, max] of [['elapsedSeconds', result.movingSeconds, 604800], ['elevationMeters', 0, 50000]]) {
      if (row[key] != null) result[key] = number(row[key], key, min, max);
    }
    return result;
  }
  function normalize(input) {
    // Accept the former planner's exported backups and saved activity history, too.
    if (input?.activityHistory) input = input.activityHistory;
    if (!input || typeof input !== 'object' || input.version !== 1 || !Array.isArray(input.activities)) throw new Error('Use a version 1 activity snapshot with an activities array.');
    if (input.activities.length > 20000) throw new Error('Import at most 20,000 activities per snapshot.');
    const ids = new Set();
    const activities = input.activities.map(activity).sort((a, b) => a.startLocal.localeCompare(b.startLocal) || a.id.localeCompare(b.id));
    for (const row of activities) {
      if (ids.has(row.id)) throw new Error(`Activity ID ${row.id} appears twice. Keep one record per original activity.`);
      ids.add(row.id);
    }
    const coverage = {};
    if (input.coverage != null) {
      if (typeof input.coverage !== 'object' || Array.isArray(input.coverage)) throw new Error('Coverage must map local dates to true or false.');
      for (const [key, complete] of Object.entries(input.coverage)) {
        date(key);
        if (typeof complete !== 'boolean') throw new Error('Coverage values must be true or false.');
        coverage[key] = complete;
      }
    } else {
      const start = date(input.rangeStart), end = date(input.rangeEnd);
      if (end < start || end - start > 366 * 50 * DAY) throw new Error('Choose an ordered activity range of at most 50 years.');
      if (typeof input.complete !== 'boolean') throw new Error('Set complete to true only when every activity in the date range was exported.');
      if (activities.some(row => row.startLocal.slice(0, 10) < input.rangeStart || row.startLocal.slice(0, 10) > input.rangeEnd)) throw new Error('Every activity must start inside the export range.');
      for (let t = start; t <= end; t += DAY) coverage[dateKey(t)] = input.complete;
    }
    if (Object.keys(coverage).length > 18300) throw new Error('Coverage must span at most 18,300 dates.');
    const athleteId = input.athleteId == null ? null : String(input.athleteId);
    if (athleteId && !/^[\w:-]{1,100}$/.test(athleteId)) throw new Error('Use a short athlete ID containing letters, numbers, :, - or _.');
    return { version: 1, kind: 'running-activities', demo: input.demo === true, athleteId, activities, coverage };
  }
  function csvRows(raw) {
    const rows = [], row = [];
    let value = '', quoted = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '"') {
        if (quoted && raw[i + 1] === '"') { value += '"'; i++; }
        else if (quoted || value === '') quoted = !quoted;
        else throw new Error('Malformed CSV quote.');
      } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
        row.push(value); value = '';
        if (c !== ',') { if (row.some(cell => cell.trim())) rows.push(row.slice()); row.length = 0; if (c === '\r' && raw[i + 1] === '\n') i++; }
      } else value += c;
    }
    if (quoted) throw new Error('The CSV contains an unclosed quote.');
    row.push(value); if (row.some(cell => cell.trim())) rows.push(row);
    return rows;
  }
  function parse(raw, csv = false) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('Choose a snapshot smaller than 12 MB.');
    raw = raw.replace(/^\uFEFF/, '').trim();
    if (!csv) {
      let input;
      try { input = JSON.parse(raw.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1')); } catch { throw new Error('The file is not valid JSON. Choose an activity snapshot or the CSV template.'); }
      return normalize(input);
    }
    const [headers, ...rows] = csvRows(raw);
    const required = ['id', 'startLocal', 'sport', 'name', 'distanceMeters', 'movingSeconds'];
    if (!headers || required.some(key => !headers.includes(key)) || new Set(headers).size !== headers.length) throw new Error('Use the CSV template headers: ' + required.join(', ') + '. Distances are meters and times are seconds.');
    const activities = rows.map(cells => {
      if (cells.length !== headers.length) throw new Error('Each CSV row must have the same number of fields as its header.');
      const row = Object.fromEntries(headers.map((key, i) => [key, cells[i]]));
      for (const key of ['distanceMeters', 'movingSeconds', 'elapsedSeconds', 'elevationMeters']) {
        if (row[key] != null && row[key] !== '') row[key] = Number(row[key]); else delete row[key];
      }
      return row;
    });
    // A CSV has no coverage assertion: missing dates remain unknown.
    return normalize({ version: 1, activities, coverage: {} });
  }
  function years(data) {
    return [...new Set([...Object.keys(data.coverage), ...data.activities.map(row => row.startLocal)].map(key => key.slice(0, 4)))].sort().reverse();
  }
  function analyze(data, year, today) {
    const start = date(`${year}-01-01`), end = date(`${year}-12-31`), days = [], byDate = new Map();
    for (let t = start; t <= end; t += DAY) {
      const key = dateKey(t), weekday = (new Date(t).getUTCDay() + 6) % 7;
      const day = { date: key, weekday, covered: data.coverage[key] === true && key < today, activities: [], distance: 0, seconds: 0, intervals: [] };
      days.push(day); byDate.set(key, day);
    }
    const activities = data.activities.filter(row => row.startLocal.startsWith(String(year)) && row.startLocal.slice(0, 10) <= today);
    for (const row of activities) {
      const day = byDate.get(row.startLocal.slice(0, 10));
      day.activities.push(row); day.distance += row.distanceMeters; day.seconds += row.movingSeconds;
    }
    // Merge overlapping estimated running intervals before counting time, including midnight/year crossings.
    for (const row of data.activities) {
      let cursor = Date.parse(row.startLocal + 'Z'), finish = cursor + row.movingSeconds * 1000;
      if (finish <= start || cursor >= end + DAY) continue;
      while (cursor < finish) {
        const midnight = Math.floor(cursor / DAY) * DAY, stop = Math.min(finish, midnight + DAY), day = byDate.get(dateKey(cursor));
        if (day?.covered) day.intervals.push([(cursor - midnight) / 1000, (stop - midnight) / 1000]);
        cursor = stop;
      }
    }
    const groups = Object.fromEntries(['all', 'weekdays', 'weekends'].map(key => [key, { days: 0, bins: Array(96).fill(0) }]));
    const weekdays = Array.from({ length: 7 }, () => ({ days: 0, distance: 0, runs: 0 }));
    const weeks = [];
    let streak = 0, longestStreak = 0;
    for (const day of days) {
      if (day.covered && day.activities.length) { streak++; longestStreak = Math.max(longestStreak, streak); } else streak = 0;
      if (day.weekday === 0 || !weeks.length) weeks.push({ start: day.date, distance: 0, covered: 0, days: 0 });
      const week = weeks.at(-1); week.distance += day.distance; week.days++; week.covered += Number(day.covered);
      if (!day.covered) continue;
      const weekday = weekdays[day.weekday]; weekday.days++; weekday.distance += day.distance; weekday.runs += day.activities.length;
      const targets = [groups.all, groups[day.weekday < 5 ? 'weekdays' : 'weekends']];
      targets.forEach(group => group.days++);
      const merged = [];
      for (const interval of day.intervals.sort((a, b) => a[0] - b[0])) {
        const last = merged.at(-1);
        if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]); else merged.push(interval.slice());
      }
      for (const [from, to] of merged) {
        for (let bin = Math.floor(from / BIN); bin < Math.ceil(to / BIN); bin++) {
          const fraction = (Math.min(to, (bin + 1) * BIN) - Math.max(from, bin * BIN)) / BIN;
          targets.forEach(group => { group.bins[bin] += fraction; });
        }
      }
    }
    for (const group of Object.values(groups)) group.bins = group.bins.map(value => group.days ? 100 * value / group.days : null);
    return { days, byDate, activities, groups, weekdays, weeks, longestStreak, coveredDays: groups.all.days,
      totalDistance: activities.reduce((sum, row) => sum + row.distanceMeters, 0),
      totalSeconds: activities.reduce((sum, row) => sum + row.movingSeconds, 0),
      runDays: days.filter(day => day.activities.length).length,
      doubles: days.filter(day => day.activities.length > 1).length,
      longest: activities.length ? Math.max(...activities.map(row => row.distanceMeters)) : 0 };
  }
  function demo() {
    let seed = 1789;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const activities = [], start = date('2025-01-01');
    for (let i = 0; i < 365; i++) {
      const key = dateKey(start + i * DAY), weekday = new Date(start + i * DAY).getUTCDay();
      if (random() < .16 || (i >= 191 && i <= 199)) continue;
      const long = weekday === 0, quality = weekday === 2 || weekday === 5;
      const season = 1 + .18 * Math.sin((i - 50) / 365 * Math.PI * 4);
      const distance = Math.round((long ? 22000 + random() * 12000 : 6500 + random() * 10500) * season);
      const hour = weekday === 0 || weekday === 6 ? 7 + random() * 3 : random() < .8 ? 5.8 + random() * 2 : 16.5 + random() * 2;
      const pace = (quality ? 255 : long ? 293 : 310) + random() * 55;
      const add = (meters, at, secondsPerKm, name) => {
        const seconds = Math.round(at * 3600);
        activities.push({ id: `demo-${activities.length + 1}`, startLocal: `${key}T${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`, sport: 'Run', name, distanceMeters: meters, movingSeconds: Math.round(meters / 1000 * secondsPerKm), elevationMeters: Math.round(meters / 1000 * random() * 13) });
      };
      add(distance, hour, pace, long ? 'Sunday long run' : quality ? 'A little quicker today' : 'The usual loop');
      if (hour < 10 && !long && random() < .22) add(Math.round(4000 + random() * 3500), 17 + random() * 2, 320 + random() * 30, 'An evening few miles');
    }
    return normalize({ version: 1, demo: true, rangeStart: '2025-01-01', rangeEnd: '2025-12-31', complete: true, activities });
  }
  // Align calendar dates (including leap days), never day-of-year offsets.
  const calendarIndex = key => (date('2000-' + key.slice(5, 10)) - date('2000-01-01')) / DAY;
  function cumulative(data, today) {
    return years(data).slice().reverse().map(year => {
      const stats = analyze(data, year, today), points = [];
      let distance = 0;
      // A gap is unknown: cumulative comparisons stop at the first uncovered day.
      for (const day of stats.days) {
        if (!day.covered) break;
        distance += day.distance;
        points.push({ date: day.date, index: calendarIndex(day.date), distance });
      }
      return { year, points };
    }).filter(line => line.points.length);
  }
  function compareCumulative(lines, year) {
    const selected = lines.find(line => line.year === String(year));
    const other = lines.filter(line => line.year !== String(year)).sort((a, b) => Math.abs(Number(a.year) - Number(year)) - Math.abs(Number(b.year) - Number(year)))[0];
    if (!selected || !other) return null;
    const common = new Set(other.points.map(point => point.index));
    const current = selected.points.filter(point => common.has(point.index)).at(-1);
    if (!current) return null;
    const previous = other.points.find(point => point.index === current.index);
    return { year: selected.year, otherYear: other.year, through: current.date.slice(5), current: current.distance, previous: previous.distance,
      difference: current.distance - previous.distance, percent: previous.distance ? 100 * (current.distance - previous.distance) / previous.distance : null };
  }
  function monthlyPaces(activities) {
    return Array.from({ length: 12 }, (_, month) => {
      const values = activities.filter(row => Number(row.startLocal.slice(5, 7)) === month + 1)
        .map(row => row.movingSeconds / row.distanceMeters * 1000).sort((a, b) => a - b);
      const middle = Math.floor(values.length / 2);
      return { month, values, median: values.length ? values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2 : null };
    });
  }
  function density(values, samples, bandwidth = 12) {
    if (!(bandwidth > 0)) throw new Error('Density bandwidth must be positive.');
    return samples.map(x => values.length ? values.reduce((sum, value) => sum + Math.exp(-.5 * ((x - value) / bandwidth) ** 2), 0) / (values.length * bandwidth * Math.sqrt(2 * Math.PI)) : 0);
  }
  function matchingDetails(data, details) {
    const matched = new Map();
    if (data.demo || details?.version !== 1 || details.kind !== 'running-plot-details') return matched;
    for (const row of data.activities) {
      const detail = details.activities?.[row.id];
      if (detail && ['startLocal', 'distanceMeters', 'movingSeconds'].every(key => detail[key] === row[key])) matched.set(row.id, detail);
    }
    return matched;
  }
  const api = { MAX_BYTES, DAY, date, dateKey, normalize, parse, years, analyze, demo, calendarIndex, cumulative, compareCumulative, monthlyPaces, density, matchingDetails };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.RunningCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
