/* Additional retrospective figures: local SVG, no map service or chart runtime. */
(function () {
  'use strict';
  const C = window.RunningCore, NS = 'http://www.w3.org/2000/svg';
  const $ = name => document.getElementById('rn-' + name);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let state, regionId;
  const number = (value, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const distance = meters => meters / (state.units === 'mi' ? 1609.344 : 1000);
  const pace = seconds => { const value = Math.round(seconds); return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`; };
  const paceUnit = () => state.units === 'mi' ? 1.609344 : 1;
  function node(tag, attrs = {}, text) {
    const result = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, value);
    if (text != null) result.textContent = text;
    return result;
  }
  function figure(id, width, height, title, description) {
    const svg = node('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': `${id}-svg-title ${id}-svg-desc` });
    svg.append(node('title', { id: `${id}-svg-title` }, title), node('desc', { id: `${id}-svg-desc` }, description));
    $(id).replaceChildren(svg); return svg;
  }
  function empty(id, message, height = 280) {
    const svg = figure(id, 500, height, message, message);
    svg.append(node('text', { x: 250, y: height / 2, 'text-anchor': 'middle' }, message));
  }
  function renderCumulative() {
    const lines = C.cumulative(state.data, state.today), selected = C.compareCumulative(lines, state.year);
    if (!lines.length) {
      empty('cumulative-plot', 'Complete coverage from January 1 needed');
      $('comparison').textContent = 'Cumulative comparisons stop at the first date without complete coverage.';
      $('cumulative-legend').replaceChildren(); return;
    }
    const width = Math.max(330, Math.min(920, $('cumulative-plot').clientWidth)), height = 270, left = 49, right = width - 13, bottom = 233;
    const max = Math.ceil(Math.max(...lines.map(line => distance(line.points.at(-1).distance))) / 500) * 500 || 500;
    const x = index => left + index / 365 * (right - left), y = value => bottom - distance(value) / max * 207;
    const svg = figure('cumulative-plot', width, height, 'Cumulative distance by calendar date', 'Years align by month and day. Each line stops at the first date without complete coverage. No extrapolation.');
    for (let i = 0; i <= 4; i++) {
      const cy = bottom - i / 4 * 207;
      svg.append(node('line', { x1: left, x2: right, y1: cy, y2: cy, class: 'rn-grid' }), node('text', { x: left - 9, y: cy + 3, 'text-anchor': 'end' }, number(max * i / 4)));
    }
    svg.append(node('text', { x: left, y: 12 }, `cumulative ${state.units}`));
    months.forEach((month, i) => {
      if (width < 520 && i % 2) return;
      svg.append(node('text', { x: x(C.calendarIndex(`2000-${String(i + 1).padStart(2, '0')}-01`)), y: 257, 'text-anchor': 'start' }, month));
    });
    const legend = $('cumulative-legend'); legend.replaceChildren();
    for (const line of lines) {
      const active = line.year === state.year, last = line.points.at(-1);
      const path = line.points.map((point, i) => `${i ? 'L' : 'M'}${x(point.index).toFixed(1)},${y(point.distance).toFixed(1)}`).join(' ');
      svg.append(node('path', { d: path, class: active ? 'rn-line' : 'rn-line rn-comparison-line' }), node('circle', { cx: x(last.index), cy: y(last.distance), r: 3, class: active ? 'rn-endpoint' : 'rn-endpoint rn-other-endpoint' }));
      const label = document.createElement('span'); label.className = active ? 'rn-series' : 'rn-series rn-series-other';
      label.textContent = `${line.year} · ${number(distance(last.distance))} ${state.units} through ${months[Number(last.date.slice(5, 7)) - 1]} ${Number(last.date.slice(8))}`;
      legend.append(label);
    }
    if (selected) {
      const sign = selected.difference >= 0 ? '+' : '−', date = `${months[Number(selected.through.slice(0, 2)) - 1]} ${Number(selected.through.slice(3))}`;
      $('comparison').textContent = `Through ${date}: ${number(distance(selected.current), 1)} ${state.units} in ${selected.year}; ${number(distance(selected.previous), 1)} in ${selected.otherYear}. Difference: ${sign}${number(Math.abs(distance(selected.difference)), 1)} ${state.units}${selected.percent == null ? '' : ` (${sign}${number(Math.abs(selected.percent), 1)}%)`}.`;
    } else $('comparison').textContent = 'A second year with complete coverage from January 1 is needed for a comparison.';
  }
  function renderPaces() {
    const monthsData = C.monthlyPaces(state.analysis.activities), values = monthsData.flatMap(month => month.values);
    if (!values.length) { empty('pace-plot', 'No recorded runs in this year', 450); return; }
    const unit = paceUnit();
    const min = Math.floor((Math.min(...values) - 24) * unit / 30) * 30 / unit, max = Math.ceil((Math.max(...values) + 24) * unit / 30) * 30 / unit;
    const samples = Array.from({ length: 161 }, (_, i) => min + i / 160 * (max - min));
    const curves = monthsData.map(month => C.density(month.values, samples));
    const peak = Math.max(...curves.flat()) || 1, x = p => 45 + (p - min) / (max - min) * 342;
    const svg = figure('pace-plot', 440, 453, 'Monthly distributions of average moving pace', 'One value per activity. Gaussian density with a 12 seconds per kilometer bandwidth and a shared vertical scale. Dots indicate monthly medians; n indicates activity counts.');
    const tickStep = (max - min) * unit > 240 ? 60 : 30;
    for (let value = Math.ceil(min * unit / tickStep) * tickStep; value <= max * unit + .001; value += tickStep) {
      const cx = x(value / unit);
      svg.append(node('line', { x1: cx, x2: cx, y1: 24, y2: 417, class: 'rn-grid' }), node('text', { x: cx, y: 438, 'text-anchor': 'middle' }, pace(value)));
    }
    svg.append(node('text', { x: 45, y: 11 }, `moving pace / ${state.units} · faster ←`), node('text', { x: 419, y: 11, 'text-anchor': 'end' }, 'n'));
    monthsData.forEach((month, i) => {
      const base = 49 + i * 33;
      svg.append(node('text', { x: 0, y: base }, months[i]), node('text', { x: 419, y: base, 'text-anchor': 'end' }, month.values.length || '—'));
      if (!month.values.length) return;
      const points = samples.map((p, j) => `${x(p).toFixed(1)},${(base - curves[i][j] / peak * 29).toFixed(1)}`);
      const path = node('path', { d: `M${x(min)},${base} L${points.join(' L')} L${x(max)},${base} Z`, class: 'rn-ridge' });
      path.append(node('title', {}, `${months[i]}: ${month.values.length} runs, median ${pace(month.median * paceUnit())}/${state.units}`));
      const medianDensity = C.density(month.values, [month.median])[0];
      svg.append(path, node('circle', { cx: x(month.median), cy: base - medianDensity / peak * 29, r: 2.5, class: 'rn-endpoint' }));
    });
  }
  function renderHeartRate() {
    const rows = state.analysis.activities.map(row => ({ row, hr: state.matched.get(row.id)?.averageHeartRate })).filter(({ hr }) => Number.isFinite(hr));
    $('hr-note').textContent = `${rows.length} of ${state.analysis.activities.length} runs have recorded average heart rate. Each point uses one activity's average heart rate and moving pace; it does not represent time in a heart-rate zone.`;
    if (!rows.length) { empty('hr-plot', 'No matched heart-rate data', 450); return; }
    const paces = rows.map(({ row }) => row.movingSeconds / row.distanceMeters * 1000 * paceUnit());
    const lo = Math.floor(Math.min(...rows.map(row => row.hr)) / 10) * 10, hi = Math.max(lo + 20, Math.ceil(Math.max(...rows.map(row => row.hr)) / 10) * 10);
    const min = Math.floor(Math.min(...paces) / 60) * 60, max = Math.max(min + 60, Math.ceil(Math.max(...paces) / 60) * 60);
    const x = hr => 48 + (hr - lo) / (hi - lo) * 373, y = p => 28 + (p - min) / (max - min) * 361;
    const svg = figure('hr-plot', 440, 453, 'Average heart rate and moving pace', `${rows.length} activities with recorded average heart rate. Faster paces are higher. Colors indicate the quarter of the year.`);
    for (let i = 0; i <= 4; i++) {
      const p = min + i / 4 * (max - min), hr = lo + i / 4 * (hi - lo);
      svg.append(node('line', { x1: 48, x2: 421, y1: y(p), y2: y(p), class: 'rn-grid' }), node('text', { x: 40, y: y(p) + 3, 'text-anchor': 'end' }, pace(p)), node('text', { x: x(hr), y: 414, 'text-anchor': 'middle' }, number(hr)));
    }
    svg.append(node('text', { x: 48, y: 12 }, `moving pace / ${state.units} · faster ↑`), node('text', { x: 421, y: 436, 'text-anchor': 'end' }, 'average heart rate (bpm)'));
    rows.forEach(({ row, hr }, i) => {
      const quarter = Math.floor((Number(row.startLocal.slice(5, 7)) - 1) / 3);
      const dot = node('circle', { cx: x(hr), cy: y(paces[i]), r: 3.3, class: `rn-hr-dot rn-quarter-${quarter}` });
      dot.append(node('title', {}, `${row.startLocal.slice(0, 10)}: ${number(hr)} bpm, ${pace(paces[i])}/${state.units}, ${number(distance(row.distanceMeters), 1)} ${state.units}`)); svg.append(dot);
    });
  }
  function renderRoutes() {
    const rows = state.analysis.activities.map(row => state.matched.get(row.id)).filter(row => row?.paths?.length);
    const groups = (state.details?.regions || []).map(region => ({ ...region, runs: rows.filter(row => row.region === region.id) })).filter(region => region.runs.length).sort((a, b) => b.runs.length - a.runs.length);
    $('route-coverage').textContent = `${rows.length} / ${state.analysis.activities.length} runs with usable GPX tracks`;
    const select = $('region'); select.replaceChildren(); select.disabled = !groups.length;
    if (!groups.length) {
      empty('route-plot', 'No matched route data', 360);
      $('route-note').textContent = 'Routes require GPX data matched to the site activity summary.'; return;
    }
    if (!groups.some(group => group.id === regionId)) regionId = groups[0].id;
    for (const group of groups) {
      const option = document.createElement('option'); option.value = group.id; option.textContent = `${group.label} (${group.runs.length})`; select.append(option);
    }
    select.value = regionId;
    const region = groups.find(group => group.id === regionId), paths = region.runs.flatMap(row => row.paths), points = paths.flat();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const width = Math.max(330, Math.min(920, $('route-plot').clientWidth)), height = width < 520 ? 390 : 445;
    const scale = Math.min((width - 48) / (maxX - minX || 1), (height - 58) / (maxY - minY || 1));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, x = p => width / 2 + (p - cx) * scale, y = p => (height - 16) / 2 - (p - cy) * scale;
    const svg = figure('route-plot', width, height, `Recorded routes around ${region.label}`, `${region.runs.length} runs in ${state.year}, overlaid in their geographic positions. North is up. Line intensity increases with overlapping tracks. Map extent adjusts to the selected region and year.`);
    // Geographic grid, with equal meter scales on both axes.
    const gridPower = Math.pow(10, Math.floor(Math.log10(80 / scale)));
    const spacing = [1, 2, 5, 10].map(n => n * gridPower).find(n => n >= 80 / scale);
    for (let p = Math.ceil(minX / spacing) * spacing; p <= maxX; p += spacing) svg.append(node('line', { x1: x(p), x2: x(p), y1: 10, y2: height - 28, class: 'rn-map-grid' }));
    for (let p = Math.ceil(minY / spacing) * spacing; p <= maxY; p += spacing) svg.append(node('line', { x1: 12, x2: width - 12, y1: y(p), y2: y(p), class: 'rn-map-grid' }));
    const opacity = Math.max(.10, Math.min(.48, 1.8 / Math.sqrt(region.runs.length)));
    for (const path of paths) svg.append(node('path', { d: path.map(([px, py], i) => `${i ? 'L' : 'M'}${x(px).toFixed(1)},${y(py).toFixed(1)}`).join(' '), class: 'rn-route', 'stroke-opacity': opacity }));
    const target = distance(95 / scale), power = Math.pow(10, Math.floor(Math.log10(target)));
    const bar = [1, 2, 5].map(n => n * power).filter(n => n <= target).at(-1) || power;
    const pixels = bar * (state.units === 'mi' ? 1609.344 : 1000) * scale;
    svg.append(node('path', { d: `M20,${height - 24} v5 h${pixels} v-5`, class: 'rn-map-scale' }), node('text', { x: 20, y: height - 4 }, `${number(bar, bar < 1 ? 1 : 0)} ${state.units}`), node('text', { x: width - 20, y: 24, 'text-anchor': 'end' }, 'N ↑'));
    $('route-note').textContent = `${region.label} · ${region.runs.length} runs in ${state.year}. Line intensity increases with overlapping tracks. North is up; each view has its own scale. Track geometry is simplified to approximately 20 m.`;
  }
  $('region').addEventListener('change', () => { regionId = $('region').value; if (state) renderRoutes(); });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (state) { renderCumulative(); renderRoutes(); } }, 120); });
  window.RunningPlots = {
    render(next) {
      state = { ...next, matched: C.matchingDetails(next.data, next.details) };
      renderCumulative(); renderRoutes(); renderPaces(); renderHeartRate();
    }
  };
})();
