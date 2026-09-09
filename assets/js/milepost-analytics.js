/* Training analysis uses local prescriptions, logs, and activity snapshots. */
(function () {
  'use strict';
  const C = window.MilepostCore;
  const A = window.MilepostActivitiesCore;
  const $ = id => document.getElementById(id);
  const numeric = (value, digits = 1) => value === null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
  const label = date => C.parseDate(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function svg(tag, attrs = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function create({ onWeek, onDay, onExport }) {
    let state, data, metric = 'distance', cursorDate = null, selected;
    const converted = value => C.convertDistance(value, state.plan.units, state.units);
    const unit = () => metric === 'distance' ? state.units : metric === 'minutes' ? 'h' : 'AU';
    const value = row => metric === 'distance' ? converted(row.distance) : metric === 'minutes' ? row.minutes / 60 : row.effort;
    const formatted = row => `${numeric(value(row), metric === 'effort' ? 0 : 1)} ${unit()}`;
    const distance = number => `${numeric(converted(number))} ${state.units}`;
    const percent = number => number === null ? '—' : `${numeric(number)}%`;
    const hasActual = () => metric !== 'effort' && !!state.activityHistory.updatedAt;
    function chooseWeek(start) {
      const focusId = document.activeElement?.id;
      onWeek(start);
      if (focusId) $(focusId)?.focus({ preventScroll: true });
    }
    document.querySelectorAll('[data-analysis-metric]').forEach(button => button.addEventListener('click', () => {
      metric = button.dataset.analysisMetric; renderCharts();
    }));
    $('analysis-date').addEventListener('input', event => {
      cursorDate = data.daily[Number(event.target.value)].date; renderCumulative();
    });
    $('cumulative-chart').addEventListener('pointermove', event => {
      const box = $('cumulative-chart').getBoundingClientRect();
      const position = (event.clientX - box.left) / box.width * 560;
      const index = Math.max(0, Math.min(data.daily.length - 1, Math.round((position - 48) / 498 * data.daily.length) - 1));
      if (cursorDate !== data.daily[index].date) { cursorDate = data.daily[index].date; renderCumulative(); }
    });
    $('analysis-week-select').addEventListener('change', event => chooseWeek(event.target.value));
    $('export-analysis').addEventListener('click', () => {
      const header = ['week_start', 'included_days', `planned_distance_${state.units}`, 'change_percent', 'planned_hours', 'planned_easy_percent', 'planned_effort_index_AU', `completed_plan_distance_${state.units}`, 'completed_plan_hours', 'completed_plan_effort_index_AU', 'completed_days', 'mean_reported_RPE', 'RPE_count'];
      const rows = data.weekly.map(week => [week.start, week.days.length, converted(week.distance), week.distanceChange, week.minutes / 60, week.easyPercent, week.effort, converted(week.completed.distance), week.completed.minutes / 60, week.completed.effort, week.completedDays, week.reportedRpe, week.reportedDays]);
      header.push(`imported_distance_${state.units}`, 'imported_moving_hours', 'imported_runs', 'complete_export_days_before_today');
      rows.forEach((row, i) => { const week = data.weekly[i]; row.push(state.activityHistory.updatedAt ? converted(week.actual.distance) : null, state.activityHistory.updatedAt ? week.actual.minutes / 60 : null, week.actual.count, week.coveredDays); });
      const csv = [header, ...rows].map(row => row.map(item => item === null ? '' : typeof item === 'number' ? String(Math.round(item * 1000) / 1000) : item).join(',')).join('\r\n') + '\r\n';
      onExport(csv, 'text/csv;charset=utf-8', `running-weekly-statistics-${state.plan.days[0].date}.csv`);
    });
    function stat(container, title, number, note) {
      const card = el('div', 'mp-analysis-stat');
      card.append(el('span', 'mp-eyebrow', title), el('strong', '', number), el('span', 'mp-chart-hint', note));
      container.append(card);
    }
    function renderStats() {
      const total = data.total, stats = $('analysis-stats'); stats.replaceChildren();
      const firstDate = C.parseDate(state.plan.days[0].date), lastDate = C.parseDate(state.plan.days.at(-1).date);
      const firstLabel = firstDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(firstDate.getFullYear() !== lastDate.getFullYear() ? { year: 'numeric' } : {}) });
      $('analysis-range').textContent = `${firstLabel} – ${lastDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${state.plan.days.length} days`;
      stat(stats, 'Total distance', distance(total.distance), 'Full plan');
      stat(stats, 'Running time', `${numeric(total.minutes / 60)} h`, 'Planned duration');
      stat(stats, 'Mean full week', total.averageWeek === null ? '—' : distance(total.averageWeek), 'Monday–Sunday');
      stat(stats, 'Peak full week', total.peakWeek === null ? '—' : distance(total.peakWeek), 'Planned volume');
      stat(stats, 'Longest run day', distance(total.longestRun), 'Planned daily distance');
      stat(stats, 'Easy time', percent(total.easyPercent), total.detailedEffort ? 'Planned segment estimates' : 'Includes daily-RPE estimates');
      const facts = $('analysis-facts'); facts.replaceChildren();
      stat(facts, 'Running days', numeric(total.runs, 0), `${total.qualityDays} quality · ${total.longDays} long`);
      stat(facts, 'Long-run share', percent(total.longPercent), `${distance(total.longDistance)} on long-run days`);
      stat(facts, 'Peak 7 days', total.peakRollingDistance === null ? '—' : distance(total.peakRollingDistance), 'Rolling calendar window');
      stat(facts, 'Completed plan', distance(total.completed.distance), `${total.completedDays} days marked complete`);
      stat(facts, 'Days checked off', percent(total.completionPercent), `${total.completedPastDays} / ${total.scheduledPastDays} scheduled before today`);
    }
    function axes(maximum, yMaximum = null) {
      const max = yMaximum || (maximum > 0 ? Math.ceil(maximum / 10 ** Math.floor(Math.log10(maximum))) * 10 ** Math.floor(Math.log10(maximum)) : 1);
      const chart = svg('svg', { viewBox: '0 0 560 230', role: 'img' });
      const x = index => 48 + (index + 1) / data.daily.length * 498;
      const y = number => 195 - number / max * 175;
      for (let i = 0; i <= 4; i++) {
        const tick = max * i / 4;
        chart.append(svg('line', { x1: 48, y1: y(tick), x2: 546, y2: y(tick), class: 'mp-plot-grid' }));
        chart.append(svg('text', { x: 42, y: y(tick) + 3, 'text-anchor': 'end', class: 'mp-plot-label' }, new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(tick)));
      }
      const ticks = [...new Set([0, Math.floor((data.daily.length - 1) / 2), data.daily.length - 1])];
      for (const index of ticks) chart.append(svg('text', { x: x(index), y: 219, 'text-anchor': ticks.length === 1 || index === ticks.at(-1) ? 'end' : index === ticks[0] ? 'start' : 'middle', class: 'mp-plot-label' }, label(data.daily[index].date)));
      return { chart, x, y };
    }
    function renderCumulative() {
      const { chart, x, y } = axes(Math.max(value(data.daily.at(-1).cumulative), hasActual() ? value(data.total.actual) : 0));
      chart.setAttribute('aria-label', `Cumulative ${metric === 'minutes' ? 'running duration' : metric}. Use the date slider for exact planned, completed-plan, and available imported totals.`);
      const path = rows => `M48 ${y(0)} ` + rows.map((row, i) => `L${x(i)} ${y(value(row))}`).join(' ');
      const plannedPath = path(data.daily.map(day => day.cumulative));
      chart.append(svg('path', { d: `${plannedPath} L546 ${y(0)} Z`, class: 'mp-plot-area' }));
      chart.append(svg('path', { d: plannedPath, class: 'mp-plot-line' }));
      const recorded = data.daily.filter(day => day.date <= state.today);
      if (recorded.length) chart.append(svg('path', { d: path(recorded.map(day => day.completedCumulative)), class: 'mp-plot-line mp-plot-completed' }));
      if (hasActual()) {
        const imported = data.daily.map((day, i) => ({ ...day, index: i })).filter(day => day.date <= state.today && (Object.hasOwn(state.activityHistory.coverage, day.date) || day.actual.count));
        if (imported.length) {
          const importedPath = imported.map((day, i) => `${i ? 'L' : 'M'}${x(day.index)} ${y(value(day.actualCumulative))}`).join(' ');
          chart.append(svg('path', { d: importedPath, class: 'mp-plot-line mp-plot-actual' }));
          const last = imported.at(-1); chart.append(svg('circle', { cx: x(last.index), cy: y(value(last.actualCumulative)), r: 3, class: 'mp-plot-actual-point' }));
        }
      }
      const todayIndex = data.daily.findIndex(day => day.date === state.today);
      if (todayIndex >= 0) {
        chart.append(svg('line', { x1: x(todayIndex), x2: x(todayIndex), y1: 10, y2: 195, class: 'mp-plot-today' }));
        chart.append(svg('text', { x: x(todayIndex) + (todayIndex > data.daily.length / 2 ? -5 : 5), y: 10, 'text-anchor': todayIndex > data.daily.length / 2 ? 'end' : 'start', class: 'mp-plot-label' }, 'Today'));
      }
      const index = Math.max(0, data.daily.findIndex(day => day.date === cursorDate));
      const day = data.daily[index];
      chart.append(svg('line', { x1: x(index), x2: x(index), y1: 20, y2: 195, class: 'mp-plot-cursor' }));
      chart.append(svg('circle', { cx: x(index), cy: y(value(day.cumulative)), r: 4, class: 'mp-plot-point' }));
      $('cumulative-chart').replaceChildren(chart);
      const readout = $('cumulative-readout'); readout.replaceChildren();
      readout.append(el('strong', '', label(day.date)), el('span', '', `Planned ${formatted(day.cumulative)}`), el('span', 'mp-completed-text', `Completed plan ${day.date <= state.today ? formatted(day.completedCumulative) : '—'}`));
      const actualText = hasActual() ? `Imported ${day.date <= state.today ? formatted(day.actualCumulative) : '—'}${day.date <= state.today ? ' · snapshot totals' : ''}` : '';
      if (actualText) readout.append(el('span', 'mp-actual-text', actualText));
      const slider = $('analysis-date'); slider.max = String(data.daily.length - 1); slider.value = String(index);
      slider.setAttribute('aria-valuetext', `${label(day.date)}: planned ${formatted(day.cumulative)}; completed plan ${day.date <= state.today ? formatted(day.completedCumulative) : 'not yet scheduled'}${actualText ? `; ${actualText}` : ''}`);
    }
    function weeklyReadout(week) {
      $('weekly-readout').textContent = `${label(week.start)}${week.partial ? ' · partial week' : ''}: ${formatted(week)} planned · ${formatted(week.completed)} completed plan${hasActual() ? ` · ${formatted(week.actual)} imported (${week.actual.count} runs; ${week.coveredDays}/${week.days.length} dates reported complete before today)` : ''}`;
    }
    function renderWeekly() {
      const plot = $('analysis-weekly-chart'); plot.replaceChildren();
      const max = Math.max(...data.weekly.map(value), ...(hasActual() ? data.weekly.map(week => value(week.actual)) : []), 1);
      const bars = el('div', 'mp-weekly-bars'); bars.style.gridTemplateColumns = `repeat(${data.weekly.length}, minmax(38px, 1fr))`;
      data.weekly.forEach(week => {
        const button = el('button', 'mp-analysis-week'); button.type = 'button'; button.id = `analysis-bar-${week.start}`;
        button.setAttribute('aria-pressed', String(week.start === selected.start));
        button.setAttribute('aria-label', `Week of ${label(week.start)}: ${formatted(week)} planned, ${formatted(week.completed)} completed plan${hasActual() ? `, ${formatted(week.actual)} imported, ${week.coveredDays} dates reported complete before today` : ''}. Inspect week.`);
        button.addEventListener('click', () => chooseWeek(week.start));
        button.addEventListener('pointerenter', () => weeklyReadout(week)); button.addEventListener('focus', () => weeklyReadout(week));
        const track = el('span', 'mp-weekly-bar-track');
        const planned = el('span', 'mp-weekly-planned'); planned.style.height = `${value(week) / max * 100}%`;
        const completed = el('span', 'mp-weekly-completed'); completed.style.height = `${value(week.completed) / max * 100}%`;
        track.append(planned, completed);
        if (hasActual()) {
          track.classList.add('mp-has-actual');
          const actual = el('span', 'mp-weekly-actual'); actual.style.height = `${value(week.actual) / max * 100}%`; track.append(actual);
        }
        button.append(el('span', 'mp-weekly-value', numeric(value(week), metric === 'effort' ? 0 : 1)), track, el('span', 'mp-weekly-label', label(week.start)));
        bars.append(button);
      });
      bars.addEventListener('pointerleave', () => weeklyReadout(selected));
      plot.append(bars); weeklyReadout(selected);
    }
    function renderCharts() {
      document.querySelectorAll('[data-analysis-metric]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.analysisMetric === metric)));
      const title = metric === 'distance' ? 'distance' : metric === 'minutes' ? 'running duration' : 'effort index';
      $('cumulative-title').textContent = `Cumulative ${title}`; $('analysis-weekly-title').textContent = `Weekly ${title}`;
      $('cumulative-unit').textContent = unit(); $('weekly-unit').textContent = unit();
      $('analysis-actual-legend').hidden = !hasActual();
      $('analysis-definition').textContent = metric === 'effort'
        ? 'Effort index = planned running minutes × prescribed main-session RPE (AU). A descriptive estimate; completed-plan values use the same prescription, not your reported RPE.'
        : `Completed plan = prescribed values for days marked complete through today. ${hasActual() ? 'Imported = recorded running distance or moving time, within plan dates. Snapshot totals may be incomplete; missing dates do not establish no running. Today may be unfinished. See Activities for coverage and comparisons through yesterday.' : 'Import a Strava snapshot in Activities to add recorded distance and moving time.'}`;
      renderCumulative(); renderWeekly();
    }
    function renderComposition() {
      const container = $('analysis-composition'); container.replaceChildren();
      $('composition-unit').textContent = state.units;
      const max = Math.max(...data.weekly.map(week => week.distance), 1);
      data.weekly.forEach(week => {
        const row = el('button', 'mp-composition-row'); row.type = 'button'; row.id = `composition-${week.start}`;
        row.setAttribute('aria-label', `Week of ${label(week.start)}: ${week.composition.map(item => `${item.type} ${distance(item.distance)}`).join(', ')}. Inspect week.`);
        row.setAttribute('aria-pressed', String(week.start === selected.start)); row.addEventListener('click', () => chooseWeek(week.start));
        const track = el('span', 'mp-composition-track');
        week.composition.forEach(item => { const segment = el('span', `mp-composition-${item.type}`); segment.style.width = `${item.distance / max * 100}%`; track.append(segment); });
        row.append(el('span', '', label(week.start)), track, el('span', '', numeric(converted(week.distance)))); container.append(row);
      });
    }
    function renderInspector() {
      const picker = $('analysis-week-select'); picker.replaceChildren();
      data.weekly.forEach(week => { const option = el('option', '', `${label(week.start)} · ${distance(week.distance)}`); option.value = week.start; picker.append(option); });
      picker.value = selected.start;
      const stats = $('analysis-week-stats'); stats.replaceChildren();
      stat(stats, 'Planned distance', distance(selected.distance), selected.distanceChange === null ? 'No comparable prior full week' : `${selected.distanceChange >= 0 ? '+' : ''}${percent(selected.distanceChange)} from prior week`);
      stat(stats, 'Reported RPE', numeric(selected.reportedRpe), `${selected.reportedDays} saved main-session ratings`);
      if (state.activityHistory.updatedAt) stat(stats, 'Imported distance', distance(selected.actual.distance), `${selected.actual.count} runs · ${numeric(selected.actual.minutes / 60)} moving hours`);
      const agenda = $('analysis-week-days'); agenda.replaceChildren();
      selected.days.forEach(day => {
        const item = el('li'); const button = el('button', `mp-agenda-day mp-agenda-${day.type}`); button.type = 'button'; button.id = `analysis-day-${day.date}`;
        const text = el('span', 'mp-agenda-copy'); text.append(el('strong', '', day.title), el('span', '', day.pace || 'No running pace'));
        const date = C.parseDate(day.date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
        button.append(el('span', 'mp-agenda-date', date), text, el('span', 'mp-agenda-distance', day.distance ? distance(day.distance) : day.type === 'rest' ? 'Rest' : `${numeric(day.minutes)} min`));
        button.setAttribute('aria-label', `${label(day.date)}: ${day.title}. Open workout and training log.`);
        button.addEventListener('click', () => onDay(day.date)); item.append(button); agenda.append(item);
      });
    }
    function renderRpe() {
      const reported = data.daily.filter(day => day.reportedRpe !== null);
      const container = $('analysis-rpe-chart');
      if (!reported.length) {
        const empty = el('div', 'mp-chart-empty'); empty.append(el('strong', '', 'No effort ratings recorded yet.'), el('span', '', 'Save a main-session RPE in a workout’s training log to start this chart.'));
        container.replaceChildren(empty);
      } else {
        const { chart, x, y } = axes(10, 10); chart.setAttribute('aria-label', `${reported.length} reported main-session RPE ratings, from 1 to 10. Missing ratings have no point.`);
        data.daily.forEach((day, i) => {
          if (day.reportedRpe === null) return;
          const dot = svg('circle', { cx: x(i), cy: y(day.reportedRpe), r: 4, class: 'mp-rpe-point' });
          dot.append(svg('title', {}, `${label(day.date)}: RPE ${day.reportedRpe}`)); chart.append(dot);
        });
        container.replaceChildren(chart);
      }
      $('analysis-rpe-note').textContent = `${reported.length} ratings recorded through ${label(state.today)}. Each point is a saved main-session rating; missing dates are not treated as zero. Weekly means and counts appear in the data table.`;
    }
    function renderTable() {
      const body = $('analysis-table-body'); body.replaceChildren();
      $('table-distance-heading').textContent = `Planned ${state.units}`; $('table-completed-heading').textContent = `Completed plan ${state.units}`;
      $('table-actual-heading').textContent = `Imported ${state.units}`;
      data.weekly.forEach(week => {
        const row = el('tr'); const heading = el('th'); heading.scope = 'row';
        const button = el('button', 'mp-text-button', `${label(week.start)}${week.partial ? ' (partial)' : ''}`); button.type = 'button'; button.id = `analysis-row-${week.start}`;
        button.addEventListener('click', () => chooseWeek(week.start)); heading.append(button); row.append(heading);
        [numeric(converted(week.distance)), week.distanceChange === null ? '—' : `${week.distanceChange >= 0 ? '+' : ''}${percent(week.distanceChange)}`, numeric(week.minutes / 60), percent(week.easyPercent), numeric(week.effort, 0), numeric(converted(week.completed.distance)), week.reportedRpe === null ? '—' : `${numeric(week.reportedRpe)} (n=${week.reportedDays})`].forEach(text => row.append(el('td', '', text)));
        [state.activityHistory.updatedAt ? numeric(converted(week.actual.distance)) : '—', state.activityHistory.updatedAt ? numeric(week.actual.minutes / 60) : '—', `${week.coveredDays}/${week.days.length}`].forEach(text => row.append(el('td', '', text)));
        body.append(row);
      });
    }
    function render(next) {
      if (cursorDate === state?.today && next.today !== state.today) cursorDate = null;
      state = next; data = A.analyze(C.analyzePlan(state.plan, state.checkins, state.today), state.activityHistory, state.plan.units, state.today);
      selected = data.weekly.find(week => week.start === state.selectedWeek) || data.weekly[0];
      if (!cursorDate || !data.daily.some(day => day.date === cursorDate)) cursorDate = state.today < data.daily[0].date ? data.daily[0].date : state.today > data.daily.at(-1).date ? data.daily.at(-1).date : state.today;
      renderStats(); renderCharts(); renderComposition(); renderInspector(); renderRpe(); renderTable();
    }
    return { render };
  }
  window.MilepostAnalytics = { create };
})();
