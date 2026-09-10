(function () {
  'use strict';
  const C = window.RunningCore, app = document.getElementById('running');
  if (!C || !app) return;
  const $ = id => document.getElementById('rn-' + id);
  const STORE = 'running.retrospective.v1', UNIT = 'running.retrospective.units';
  const NS = 'http://www.w3.org/2000/svg';
  let data, publicData, analysis, pending, legacy, year, units = 'mi', rhythm = 'all', selectedDate = null, origin = 'site', persistent = true, clockWidth = 650;
  const localToday = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
  let today = localToday();
  const dist = meters => meters / (units === 'mi' ? 1609.344 : 1000);
  const num = (n, decimals = 0) => n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  const clock = bin => `${String(Math.floor(bin / 4)).padStart(2, '0')}:${String(bin % 4 * 15).padStart(2, '0')}`;
  const pace = seconds => { const rounded = Math.round(seconds); return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`; };
  const dayLabel = key => new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
  function svgNode(tag, attrs = {}, text) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text != null) node.textContent = text;
    return node;
  }
  function figure(target, width, height, title, description) {
    const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': `${target}-title ${target}-desc` });
    svg.append(svgNode('title', { id: `${target}-title` }, title), svgNode('desc', { id: `${target}-desc` }, description));
    $(target).replaceChildren(svg); return svg;
  }
  function emptyPlot(target, message) {
    const svg = figure(target, 440, 225, message, message);
    svg.append(svgNode('text', { x: 220, y: 110, 'text-anchor': 'middle' }, message));
  }
  function grid(svg, max, width, height, left = 42, top = 22, bottom = 30, ticks = 4) {
    const y = value => height - bottom - value / max * (height - bottom - top);
    for (let i = 0; i <= ticks; i++) {
      const value = max * i / ticks;
      svg.append(svgNode('line', { x1: left, x2: width - 12, y1: y(value), y2: y(value), class: 'rn-grid' }), svgNode('text', { x: left - 9, y: y(value) + 3, 'text-anchor': 'end' }, num(value, Number.isInteger(value) ? 0 : 1)));
    }
    return y;
  }
  function niceMax(value) { const power = Math.pow(10, Math.floor(Math.log10(value || 1))); return Math.ceil(value / power / .5) * power * .5 || 1; }
  function renderStats() {
    const rows = [
      ['TOTAL DISTANCE', num(dist(analysis.totalDistance)), units, `${num(analysis.activities.length)} recorded runs`],
      ['MOVING TIME', num(analysis.totalSeconds / 3600, 1), 'h', 'recorded moving duration'],
      ['DAYS WITH A RUN', num(analysis.runDays), '', `${analysis.doubles} days with multiple runs`],
      ['LONGEST RUN', analysis.longest ? num(dist(analysis.longest), 1) : '—', analysis.longest ? units : '', 'maximum activity distance']
    ];
    $('stats').replaceChildren(...rows.map(([label, value, unit, note]) => {
      const node = el('div', null, 'rn-stat'), strong = el('strong', value);
      if (unit) strong.append(el('small', unit));
      node.append(el('span', label), strong, el('small', note)); return node;
    }));
  }
  function renderClock() {
    const group = analysis.groups[rhythm], selected = Number($('time').value);
    clockWidth = Math.max(320, Math.min(650, $('clock-plot').clientWidth));
    const svg = figure('clock-plot', clockWidth, 228, 'Estimated probability of running by local time', group.days ? `Based on ${group.days} fully covered dates. Each point is a 15-minute average, including days without a run.` : 'No fully covered dates are available; probability cannot be estimated.');
    const max = Math.max(5, Math.ceil(Math.max(0, ...group.bins) / 5) * 5), y = grid(svg, max, clockWidth, 228, 42, 24, 30, 5);
    const x = bin => 42 + bin / 96 * (clockWidth - 54);
    svg.append(svgNode('text', { x: 42, y: 12 }, 'estimated probability (%)'));
    for (let bin = 0; bin <= 96; bin += clockWidth < 500 ? 24 : 12) svg.append(svgNode('text', { x: x(bin), y: 219, 'text-anchor': bin === 0 ? 'start' : bin === 96 ? 'end' : 'middle' }, clock(bin)));
    if (group.days) {
      const path = group.bins.map((value, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(value).toFixed(2)} H${x(i + 1).toFixed(2)}`).join(' ');
      svg.append(svgNode('path', { d: `${path} L${x(96)},${y(0)} L${x(0)},${y(0)} Z`, class: 'rn-area' }), svgNode('path', { d: path, class: 'rn-line' }));
      svg.append(svgNode('line', { id: 'rn-clock-marker', x1: x(selected + .5), x2: x(selected + .5), y1: 24, y2: y(0), class: 'rn-marker' }), svgNode('circle', { id: 'rn-clock-dot', cx: x(selected + .5), cy: y(group.bins[selected]), r: 4.5, class: 'rn-point' }));
    } else svg.append(svgNode('text', { x: clockWidth / 2 + 15, y: 112, 'text-anchor': 'middle' }, 'Complete date coverage needed'));
    svg.addEventListener('pointermove', event => {
      const bounds = svg.getBoundingClientRect(), position = (event.clientX - bounds.left) / bounds.width * clockWidth;
      if (position < 42 || position > clockWidth - 12) return;
      $('time').value = Math.min(95, Math.max(0, Math.floor((position - 42) / (clockWidth - 54) * 96)));
      updateClockReading(max);
    });
    updateClockReading(max);
  }
  function updateClockReading(max) {
    const group = analysis.groups[rhythm], bin = Number($('time').value), value = group.bins[bin];
    $('clock-time').textContent = `${clock(bin)}–${clock(bin + 1)}`;
    $('time').setAttribute('aria-valuetext', `${clock(bin)} to ${clock(bin + 1)}; ${value == null ? 'probability unavailable' : num(value, 1) + ' percent estimated probability'}`);
    $('clock-value').textContent = value == null ? '—' : `${num(value, 1)}%`;
    $('clock-note').textContent = group.days ? `Across ${num(group.days)} covered ${rhythm === 'all' ? 'dates' : rhythm}.` : 'Import complete date coverage to estimate probability.';
    const peak = Math.max(0, ...group.bins), peakBin = group.bins.indexOf(peak);
    $('clock-peak').textContent = group.days && peak > 0 ? `Peak: ${clock(peakBin)}–${clock(peakBin + 1)} · ${num(peak, 1)}%` : group.days ? 'No estimated running intervals on these dates.' : 'No complete date coverage.';
    $('probability-method').textContent = `Each 15-minute bin averages estimated running time over fully covered dates, including rest days. Start + moving duration approximates the interval; exact pauses are unknown. ${analysis.coveredDays ? 'Today and incomplete dates are excluded.' : 'No fully covered past dates are available in this year.'}`;
    if ($('clock-marker')) {
      const ceiling = max || Math.max(5, Math.ceil(Math.max(0, ...group.bins) / 5) * 5);
      const x = 42 + (bin + .5) / 96 * (clockWidth - 54);
      $('clock-marker').setAttribute('x1', x); $('clock-marker').setAttribute('x2', x);
      $('clock-dot').setAttribute('cx', x); $('clock-dot').setAttribute('cy', 198 - value / ceiling * 174);
    }
  }
  function renderCalendar() {
    const container = $('calendar'), offset = analysis.days[0].weekday, columns = Math.ceil((analysis.days.length + offset) / 7);
    container.replaceChildren(); container.style.gridTemplateColumns = `25px repeat(${columns}, minmax(0, 1fr))`;
    const max = Math.max(1, ...analysis.days.map(day => day.distance));
    ['M', '', 'W', '', 'F', '', 'S'].forEach((label, i) => { const node = el('span', label, 'rn-day-label'); node.style.gridRow = i + 2; node.style.gridColumn = 1; container.append(node); });
    let previousMonth = '';
    for (const [i, day] of analysis.days.entries()) {
      const column = Math.floor((i + offset) / 7) + 2, month = day.date.slice(5, 7);
      if (month !== previousMonth) {
        const label = el('span', new Date(day.date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), 'rn-month');
        label.style.gridColumn = `${column} / span ${Math.min(3, columns + 2 - column)}`; label.style.gridRow = 1;
        container.append(label); previousMonth = month;
      }
      const level = day.distance ? Math.min(4, Math.ceil(day.distance / max * 4)) : 0;
      const node = el('button', null, day.distance ? `rn-heat-${level}${day.covered ? '' : ' rn-partial'}` : day.covered ? 'rn-heat-0' : 'rn-unknown');
      node.style.gridRow = day.weekday + 2; node.style.gridColumn = column;
      const description = `${day.date}: ${day.distance ? `${num(dist(day.distance), 1)} ${units}, ${day.activities.length} run${day.activities.length === 1 ? '' : 's'}` : day.covered ? 'no recorded run' : 'no data'}${!day.covered && day.distance ? ', incomplete coverage' : ''}`;
      node.title = description; node.setAttribute('aria-label', description); node.setAttribute('aria-pressed', String(selectedDate === day.date)); node.dataset.date = day.date;
      // One calendar tab stop; arrows navigate dates, Home/End navigate the year.
      node.tabIndex = day.date === (selectedDate || analysis.activities.at(-1)?.startLocal.slice(0, 10) || analysis.days[0].date) ? 0 : -1;
      node.addEventListener('click', () => {
        selectedDate = day.date;
        container.querySelectorAll('button').forEach(button => { button.setAttribute('aria-pressed', String(button === node)); button.tabIndex = button === node ? 0 : -1; });
        $('day-reading').textContent = description;
      });
      node.addEventListener('keydown', event => {
        const offsets = { ArrowRight: 7, ArrowLeft: -7, ArrowDown: 1, ArrowUp: -1, Home: -i, End: analysis.days.length - 1 - i };
        if (!(event.key in offsets)) return;
        event.preventDefault();
        const target = analysis.days[Math.max(0, Math.min(analysis.days.length - 1, i + offsets[event.key]))];
        node.tabIndex = -1;
        const next = container.querySelector(`[data-date="${target.date}"]`); next.tabIndex = 0; next.focus();
      });
      container.append(node);
    }
    $('heat-max').textContent = `${num(dist(max), 0)} ${units}`;
    $('calendar-summary').textContent = `${analysis.coveredDays} / ${analysis.days.length} dates fully covered`;
    $('day-reading').textContent = selectedDate ? container.querySelector(`[data-date="${selectedDate}"]`).title : 'Select a date to view its total distance.';
  }
  function renderWeekly() {
    const width = 900, height = 125, max = niceMax(Math.max(1, ...analysis.weeks.map(week => dist(week.distance))));
    const svg = figure('weekly-plot', width, height, `Weekly recorded distance in ${units}`, 'Monday–Sunday totals. Faded bars indicate incomplete coverage; edge weeks can be partial.');
    const y = grid(svg, max, width, height, 42, 22, 25, 2), step = 846 / analysis.weeks.length;
    svg.append(svgNode('text', { x: 42, y: 11 }, `weekly ${units}`));
    analysis.weeks.forEach((week, i) => {
      const bar = svgNode('rect', { x: 42 + i * step + 2, y: y(dist(week.distance)), width: Math.max(1, step - 4), height: y(0) - y(dist(week.distance)), class: `rn-bar${week.covered < 7 || week.days < 7 ? ' rn-incomplete' : ''}` });
      bar.append(svgNode('title', {}, `Week of ${week.start}: ${num(dist(week.distance), 1)} ${units}; ${week.covered} of ${week.days} included dates covered`)); svg.append(bar);
      if (i % 9 === 0) svg.append(svgNode('text', { x: 42 + i * step, y: 120 }, dayLabel(week.start)));
    });
  }
  function renderWeekdays() {
    if (!analysis.coveredDays) { emptyPlot('weekday-plot', 'Complete date coverage needed'); $('weekday-note').textContent = 'Weekday averages need fully covered dates, including days without runs.'; return; }
    const values = analysis.weekdays.map(day => day.days ? dist(day.distance / day.days) : 0), max = niceMax(Math.max(1, ...values));
    const svg = figure('weekday-plot', 440, 235, `Mean distance per weekday in ${units}`, 'Includes zero-distance fully covered dates. Days with no coverage have no estimate.');
    const y = grid(svg, max, 440, 235, 42, 23, 28);
    svg.append(svgNode('text', { x: 42, y: 11 }, `${units} / covered day`));
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    analysis.weekdays.forEach((day, i) => {
      const x = 53 + i * 54;
      const bar = svgNode('rect', { x, y: y(values[i]), width: 29, height: y(0) - y(values[i]), rx: 1, class: 'rn-bar' });
      bar.append(svgNode('title', {}, `${labels[i]}: ${day.days ? num(values[i], 1) + ' ' + units + ' per day across ' + day.days + ' covered dates' : 'no covered dates'}`));
      svg.append(bar, svgNode('text', { x: x + 14.5, y: 228, 'text-anchor': 'middle' }, labels[i]));
      if (!day.days) svg.append(svgNode('text', { x: x + 14.5, y: y(0) - 10, 'text-anchor': 'middle' }, '—'));
    });
    const peak = values.indexOf(Math.max(...values));
    $('weekday-note').textContent = `${labels[peak]} averages ${num(values[peak], 1)} ${units} across ${analysis.weekdays[peak].days} covered dates. Rest days count; unknown dates do not.`;
  }
  function renderScatter() {
    if (!analysis.activities.length) { emptyPlot('scatter-plot', 'No recorded runs in this year'); return; }
    const rows = analysis.activities, xmax = niceMax(Math.max(...rows.map(row => dist(row.distanceMeters))));
    const paces = rows.map(row => row.movingSeconds / dist(row.distanceMeters)), min = Math.max(0, Math.floor(Math.min(...paces) / 60) * 60 - 30), max = Math.max(min + 120, Math.ceil(Math.max(...paces) / 60) * 60 + 30);
    const svg = figure('scatter-plot', 440, 235, 'Individual run distance versus moving pace', `${rows.length} runs. Distance increases to the right. Faster paces are higher. Pace ranges from ${pace(min)} to ${pace(max)} per ${units}.`);
    const x = meters => 48 + dist(meters) / xmax * 376, y = value => 23 + (value - min) / (max - min) * 175;
    for (let i = 0; i <= 3; i++) {
      const value = min + (max - min) * i / 3;
      svg.append(svgNode('line', { x1: 48, x2: 424, y1: y(value), y2: y(value), class: 'rn-grid' }), svgNode('text', { x: 40, y: y(value) + 3, 'text-anchor': 'end' }, pace(value)));
    }
    for (let i = 0; i <= 4; i++) svg.append(svgNode('text', { x: 48 + i / 4 * 376, y: 218, 'text-anchor': 'middle' }, num(xmax * i / 4, Number.isInteger(xmax * i / 4) ? 0 : 1)));
    svg.append(svgNode('text', { x: 48, y: 11 }, `moving pace / ${units} · faster ↑`), svgNode('text', { x: 424, y: 234, 'text-anchor': 'end' }, `distance (${units})`));
    rows.forEach((row, i) => {
      const dot = svgNode('circle', { cx: x(row.distanceMeters), cy: y(paces[i]), r: 3, class: 'rn-scatter-dot' });
      dot.append(svgNode('title', {}, `${row.startLocal.slice(0, 10)}: ${num(dist(row.distanceMeters), 1)} ${units}, ${pace(paces[i])}/${units}`)); svg.append(dot);
    });
  }
  function render() {
    if (!data) return;
    analysis = C.analyze(data, year, today);
    $('mi').setAttribute('aria-pressed', String(units === 'mi')); $('km').setAttribute('aria-pressed', String(units === 'km'));
    $('source').replaceChildren();
    if (data.demo) $('source').append(el('strong', 'EXAMPLE DATA'), document.createTextNode(' · Synthetic activities, not Matthew’s history. '));
    else $('source').append(el('strong', origin === 'browser' ? 'LOCAL IMPORT' : 'ACTIVITY HISTORY'), document.createTextNode(' · '));
    const dates = [...new Set([...Object.keys(data.coverage), ...analysis.activities.map(row => row.startLocal.slice(0, 10))])].filter(key => key.startsWith(year) && key <= today).sort();
    const range = dates.length ? ` · ${dayLabel(dates[0])}–${dayLabel(dates.at(-1))}` : '';
    $('source').append(document.createTextNode(`${year}${range} · ${num(analysis.activities.length)} runs · ${analysis.coveredDays} fully covered dates.${origin === 'browser' ? persistent ? ' Saved in this browser.' : ' Storage unavailable; export to keep a copy.' : ''}`));
    $('demo-note').hidden = !data.demo;
    $('export').disabled = false;
    renderStats(); renderClock(); renderCalendar(); renderWeekly(); renderWeekdays(); renderScatter();
  }
  function useData(next, source) {
    data = next; origin = source; selectedDate = null;
    const available = C.years(data); if (!available.length) available.push(today.slice(0, 4));
    if (!available.includes(year)) year = available[0];
    $('year').replaceChildren(...available.map(value => { const option = el('option', value); option.value = value; return option; }));
    $('year').value = year; $('year').disabled = false;
    render();
  }
  function preview(next) {
    pending = next;
    const dates = C.years(next), covered = Object.values(next.coverage).filter(Boolean).length;
    $('preview-description').textContent = `${num(next.activities.length)} runs across ${dates.join(', ') || 'no dates'}; ${num(covered)} dates declared complete.${next.athleteId ? ' Athlete: ' + next.athleteId + '.' : ''}${next.demo ? ' This file is marked as synthetic example data.' : ''} ${!covered ? 'Probability and weekday averages will be unavailable until coverage is supplied.' : ''}`;
    $('import-preview').hidden = false;
  }
  function download(value, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = el('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('open-data').addEventListener('click', () => $('data-dialog').showModal());
  $('year').addEventListener('change', () => { year = $('year').value; selectedDate = null; render(); });
  for (const unit of ['mi', 'km']) $(unit).addEventListener('click', () => { units = unit; try { localStorage.setItem(UNIT, unit); } catch { /* Preference can remain in memory. */ } render(); });
  document.querySelectorAll('[data-rhythm]').forEach(button => button.addEventListener('click', () => {
    rhythm = button.dataset.rhythm; document.querySelectorAll('[data-rhythm]').forEach(node => node.setAttribute('aria-pressed', String(node === button))); if (analysis) renderClock();
  }));
  $('time').addEventListener('input', () => { if (analysis) updateClockReading(); });
  $('export').addEventListener('click', () => { if (data) download(data, 'running-history.json'); });
  let previewRequest = 0;
  $('file').addEventListener('change', () => { previewRequest++; pending = null; $('import-preview').hidden = true; $('import-error').textContent = ''; });
  $('import-form').addEventListener('submit', async event => {
    event.preventDefault(); const request = ++previewRequest; pending = null; $('import-preview').hidden = true; $('import-error').textContent = '';
    try {
      const file = $('file').files[0]; if (!file) throw new Error('Choose a JSON or CSV file first.');
      if (file.size > C.MAX_BYTES) throw new Error('Choose a file smaller than 12 MB.');
      const raw = await file.text(); if (request !== previewRequest) return;
      preview(C.parse(raw, file.name.toLowerCase().endsWith('.csv')));
    } catch (error) { if (request === previewRequest) $('import-error').textContent = error.message; }
  });
  $('confirm-import').addEventListener('click', () => {
    if (!pending) return;
    previewRequest++;
    persistent = true;
    try { localStorage.setItem(STORE, JSON.stringify(pending)); } catch { persistent = false; }
    useData(pending, 'browser'); pending = null; $('import-preview').hidden = true; $('data-dialog').close();
  });
  $('restore').addEventListener('click', () => {
    if (!publicData) { $('import-error').textContent = 'The site snapshot is unavailable. Reload the page to try again.'; return; }
    previewRequest++;
    // Preserve an imported history before returning to the site's snapshot.
    if (origin === 'browser') download(data, 'running-history-backup.json');
    try { localStorage.removeItem(STORE); } catch { $('import-error').textContent = 'Could not clear saved history. Browser storage is unavailable.'; return; }
    pending = null; $('import-preview').hidden = true; useData(publicData, 'site'); $('data-dialog').close();
  });
  $('legacy').addEventListener('click', () => { previewRequest++; if (legacy) { $('import-error').textContent = ''; preview(legacy); } });
  $('mcp-prompt').value = `Export my recorded running history for the date range I specify, using the activity connection available in this chat. Ask for the date range if I have not supplied it. Retrieve every page. Include Run, TrailRun, and VirtualRun activities; keep doubles separate and original IDs as strings. Use the recorded local start time without converting it to UTC. Distances are meters; moving and elapsed durations are seconds. Do not invent missing values or substitute elapsed time for moving time. Exclude GPS coordinates and credentials. Explain any unavailable required fields instead of fabricating them.\n\nReturn a JSON file in this custom format, mapping only verified source fields:\n{"version":1,"kind":"running-activities","athleteId":"original ID","rangeStart":"YYYY-MM-DD","rangeEnd":"YYYY-MM-DD","complete":true,"activities":[{"id":"original activity ID","startLocal":"YYYY-MM-DDTHH:mm:ss","sport":"Run","name":"activity name","distanceMeters":10000,"movingSeconds":3600}]}\n\nThe activity above only illustrates the schema: replace it with actual records. Optional fields: elapsedSeconds and elevationMeters (elevation gain). Only set complete=true if all pages of running activities for every date in the range were retrieved. Otherwise set false and explain the gaps outside the JSON. Include dates without runs in the covered range. Omit invalid zero-distance or zero-moving-time records and mark coverage incomplete if any are omitted. This is a retrospective export; no training recommendations or future workouts.`;
  $('copy-prompt').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('mcp-prompt').value); $('copy-status').textContent = 'Export request copied.'; }
    catch { $('mcp-prompt').focus(); $('mcp-prompt').select(); $('copy-status').textContent = 'Select and copy the request above.'; }
  });
  function refreshDate() { const next = localToday(); if (next !== today) { today = next; render(); } }
  window.addEventListener('focus', refreshDate); document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDate(); });
  setInterval(refreshDate, 60000);
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (analysis) renderClock(); }, 120); });
  async function init() {
    let saved;
    try {
      units = localStorage.getItem(UNIT) === 'km' ? 'km' : 'mi';
      const raw = localStorage.getItem(STORE); if (raw) saved = C.parse(raw);
    } catch { $('error').hidden = false; $('error').textContent = 'Saved activity history could not be loaded. You can import a backup from Data and import.'; }
    try {
      const old = localStorage.getItem('milepost.v1');
      if (old) { const parsed = JSON.parse(old); if (parsed.activityHistory?.activities?.length) legacy = C.normalize(parsed.activityHistory); }
    } catch { /* Old planner data is untouched, including unreadable records. */ }
    $('legacy').hidden = !legacy;
    if (saved) useData(saved, 'browser');
    try {
      const response = await fetch(app.dataset.source, { credentials: 'omit', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('The site activity snapshot could not be loaded.');
      publicData = C.parse(await response.text()); if (!saved) useData(publicData, 'site');
    } catch {
      if (!saved) { $('source').textContent = 'Activity history unavailable.'; $('error').hidden = false; $('error').textContent = 'Could not load the site snapshot. Reload to try again, or import a history from Data and import.'; }
    }
  }
  init();
})();
