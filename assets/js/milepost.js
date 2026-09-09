(function () {
  'use strict';
  const C = window.MilepostCore;
  const A = window.MilepostActivitiesCore;
  const app = document.getElementById('milepost');
  if (!app || !C) return;
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'milepost.v1';
  let today = C.dateKey(new Date());
  let plan = C.samplePlan(), checkins = {}, brief = null, isDemo = true;
  let activityHistory = A.emptyHistory();
  let units = 'mi', view = 'training', activeDate = null, storageMessage = '', sampleUpdated = false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      if (raw.length > A.MAX_BYTES) throw new Error('Saved data is too large.');
      const saved = JSON.parse(raw);
      plan = C.validatePlan(saved.plan);
      checkins = C.validateCheckins(saved.checkins, plan);
      isDemo = saved.isDemo === true;
      units = ['mi', 'km'].includes(saved.units) ? saved.units : plan.units;
      brief = saved.brief && typeof saved.brief === 'object' ? saved.brief : null;
      activityHistory = A.validateHistory(saved.activityHistory);
      if (isDemo) {
        const updated = C.extendSample(plan, checkins, today);
        sampleUpdated = updated !== plan; plan = updated;
      }
      // Refresh untouched old demo data while preserving recorded training and imports.
      const hasLog = Object.values(checkins).some(row => row.completed || row.rpe || row.notes);
      if (isDemo && plan.sampleRevision !== C.SAMPLE_REVISION && !hasLog) { plan = C.samplePlan(); sampleUpdated = true; }
    }
  } catch {
    storageMessage = 'Saved data could not be loaded. Showing the sample; import an export to restore a plan.';
  }
  let groups = C.weeks(plan);
  let selectedWeek = C.dateKey(C.monday(today));
  let month = C.parseDate(today);
  month.setDate(1);
  let dateTimer;
  let analytics;
  let activities;
  let sync;
  const getState = () => ({ plan, checkins, activityHistory, brief, isDemo, today, units, selectedWeek });
  function renderAnalysis() { analytics?.render(getState()); }
  const workspaces = ['calendar', 'analysis', 'activities'];
  const hashWorkspace = () => workspaces.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'calendar';
  function setWorkspace(mode, updateHash = true) {
    workspaces.forEach(name => {
      const active = name === mode;
      $(`${name}-panel`).hidden = !active;
      $(`${name}-tab`).setAttribute('aria-selected', String(active));
      $(`${name}-tab`).tabIndex = active ? 0 : -1;
    });
    if (updateHash) history.replaceState(null, '', `#${mode}`);
  }
  workspaces.forEach(mode => {
    $(`${mode}-tab`).addEventListener('click', () => setWorkspace(mode));
    $(`${mode}-tab`).addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? workspaces[0] : event.key === 'End' ? workspaces.at(-1) : workspaces[(workspaces.indexOf(mode) + (event.key === 'ArrowRight' ? 1 : -1) + workspaces.length) % workspaces.length];
      setWorkspace(next); $(`${next}-tab`).focus();
    });
  });
  window.addEventListener('hashchange', () => setWorkspace(hashWorkspace(), false));
  $('open-analysis').addEventListener('click', () => {
    setWorkspace('analysis'); $('analysis-tab').focus(); $('analysis-tab').scrollIntoView({ block: 'start' });
  });

  function focusDate(date) {
    selectedWeek = C.dateKey(C.monday(date));
    month = C.parseDate(date); month.setDate(1);
  }
  function focusPlan() {
    today = C.dateKey(new Date());
    focusDate(plan.days.some(day => day.date === today) ? today : plan.days[0].date);
  }
  function scheduleDateRefresh() {
    clearTimeout(dateTimer);
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    dateTimer = setTimeout(refreshToday, midnight - now + 50);
  }
  function refreshToday() {
    const next = C.dateKey(new Date());
    if (next !== today) {
      const followingToday = selectedWeek === C.dateKey(C.monday(today)) && C.dateKey(month).slice(0, 7) === today.slice(0, 7);
      today = next;
      if (followingToday) focusDate(today);
      render();
      announce(`Local date updated to ${dateLabel(today, { month: 'long', day: 'numeric' })}.`);
    }
    scheduleDateRefresh();
  }
  window.addEventListener('focus', refreshToday);
  window.addEventListener('pageshow', refreshToday);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshToday(); });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(className, text, action) {
    const node = el('button', className, text);
    node.type = 'button'; node.addEventListener('click', action); return node;
  }
  function announce(message) { $('app-status').textContent = message; }
  function dateLabel(value, options) { return C.parseDate(value).toLocaleDateString('en-US', options); }
  function distance(value) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(C.convertDistance(value, plan.units, units)); }
  function time(value) { const m = Math.round(value); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`; }
  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ plan, checkins, brief, units, isDemo, activityHistory }));
      storageMessage = '';
    } catch {
      storageMessage = 'Browser storage is unavailable or full. Changes last for this visit; export your plan to keep them.';
    }
    $('storage-status').textContent = storageMessage || 'Your plan and imported activities stay in this browser. Export a backup to keep a copy.';
  }
  function openDialog(id) {
    const dialog = $(id);
    if (!dialog.open) dialog.showModal();
  }
  function switchDialog(from, to) { $(from).close(); openDialog(to); }
  app.querySelectorAll('[data-open]').forEach(node => node.addEventListener('click', () => openDialog(node.dataset.open)));
  app.querySelectorAll('[data-close]').forEach(node => node.addEventListener('click', () => node.closest('dialog').close()));
  app.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }));

  function renderSummary() {
    const week = groups.find(item => item.start === selectedWeek);
    $('plan-source').textContent = `${isDemo ? 'SAMPLE' : 'TRAINING PLAN'}${week?.days[0].phase ? ` · ${week.days[0].phase}` : ''}`;
    const totals = C.summarize(week ? week.days : [], checkins);
    $('stat-distance').textContent = week ? distance(totals.distance) : '—';
    $('stat-time').textContent = week ? time(totals.minutes) : '—';
    $('stat-easy').textContent = totals.easyPercent === null ? '—' : `${totals.easyPercent}%`;
    $('effort-method').textContent = totals.detailedEffort ? 'of minutes · planned segment totals' : 'of minutes · daily RPE ≤ 4 estimate';
    $('stat-done').textContent = week ? `${totals.completed} / ${totals.runs}` : '—';
    $('stat-week').textContent = `${dateLabel(selectedWeek, { month: 'short', day: 'numeric' })} – ${dateLabel(C.dateKey(C.addDays(selectedWeek, 6)), { month: 'short', day: 'numeric' })} · ${week ? 'planned' : 'no plan scheduled'}`;
  }
  function selectWeek(start, moveMonth) {
    const restoreFocus = document.activeElement?.matches('.mp-chart-week, .mp-week-total');
    selectedWeek = start;
    if (moveMonth) { month = C.parseDate(groups.find(group => group.start === start).days[0].date); month.setDate(1); }
    renderSummary(); renderCalendar(); renderChart(); renderAnalysis();
    if (restoreFocus) app.querySelector(`${moveMonth ? '.mp-chart-week' : '.mp-week-total'}[aria-pressed="true"]`)?.focus({ preventScroll: true });
    announce(`Showing weekly summary for ${dateLabel(start, { month: 'long', day: 'numeric' })}.`);
  }
  function renderCalendar() {
    const calendar = $('calendar'); calendar.replaceChildren();
    $('calendar-title').textContent = month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const localDate = dateLabel(today, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    $('calendar-date-note').textContent = `Today: ${localDate} · local date${plan.days.some(day => day.date === today) ? '' : ' · no workout scheduled today'}`;
    $('today').title = `Show ${localDate}`;
    const head = el('div', 'mp-calendar-head');
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', units + ' / wk'].forEach(day => head.append(el('span', '', day)));
    calendar.append(head);
    const start = C.monday(month);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12);
    const end = C.addDays(C.monday(last), 6);
    const byDate = new Map(plan.days.map(day => [day.date, day]));
    const actualByDate = A.daily(activityHistory, units, today);
    for (let cursor = start; cursor <= end; cursor = C.addDays(cursor, 7)) {
      const row = el('div', 'mp-calendar-week');
      const weekStart = C.dateKey(cursor);
      if (weekStart === selectedWeek) row.classList.add('mp-selected-week');
      const weekDays = [];
      for (let i = 0; i < 7; i++) {
        const date = C.addDays(cursor, i), key = C.dateKey(date), day = byDate.get(key);
        const cell = day ? button('mp-day', undefined, () => showDay(key)) : el('div', 'mp-day');
        if (date.getMonth() !== month.getMonth()) cell.classList.add('mp-outside');
        if (key === today) { cell.classList.add('mp-today'); cell.setAttribute('aria-current', 'date'); }
        const dateLine = el('span', 'mp-date');
        dateLine.append(el('span', 'mp-date-number', date.getDate()));
        if (checkins[key]?.completed) dateLine.append(el('span', 'mp-check', '✓'));
        cell.append(dateLine);
        if (day) {
          weekDays.push(day);
          cell.classList.add(`mp-${day.type}`);
          cell.dataset.date = key;
          cell.setAttribute('aria-label', `${dateLabel(key, { weekday: 'long', month: 'long', day: 'numeric' })}: ${day.title}, ${distance(day.distance)} ${units}${checkins[key]?.completed ? ', completed' : ''}. View details.`);
          const workout = el('span', 'mp-workout');
          workout.append(el('span', 'mp-workout-title', view === 'training' ? day.title : 'Fueling & recovery'));
          if (view === 'training') {
            workout.append(el('span', 'mp-workout-meta', day.distance ? `${distance(day.distance)} ${units}` : day.minutes ? `${day.minutes} min` : 'Day off'));
            workout.append(el('span', 'mp-workout-pace', day.pace || (day.rpe ? `RPE ${day.rpe} / 10` : 'Room to recover')));
          } else {
            workout.append(el('span', 'mp-workout-pace mp-fuel-preview', day.fueling.before || day.fueling.after || 'Add fueling in your next plan.'));
          }
          cell.append(workout);
        } else cell.classList.add('mp-empty');
        if (actualByDate[key]) {
          const actual = `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(actualByDate[key].distance)} ${units} imported · ${actualByDate[key].count} ${actualByDate[key].count === 1 ? 'run' : 'runs'}`;
          cell.append(el('span', 'mp-actual-day', actual));
          if (day) cell.setAttribute('aria-label', `${cell.getAttribute('aria-label')} ${actual}.`);
        }
        row.append(cell);
      }
      const total = button('mp-week-total', undefined, () => selectWeek(weekStart, false));
      total.append(el('strong', '', distance(C.summarize(weekDays).distance)), el('span', '', units));
      total.disabled = !weekDays.length;
      total.setAttribute('aria-pressed', String(weekStart === selectedWeek));
      total.setAttribute('aria-label', `Week of ${dateLabel(weekStart, { month: 'long', day: 'numeric' })}: ${distance(C.summarize(weekDays).distance)} ${units}. Show weekly summary.`);
      row.append(total); calendar.append(row);
    }
    $('previous-month').disabled = month.getFullYear() <= 2000 && month.getMonth() === 0;
    $('next-month').disabled = month.getFullYear() >= 2100 && month.getMonth() === 11;
  }
  function renderChart() {
    const chart = $('week-chart'); chart.replaceChildren();
    const totals = groups.map(week => C.summarize(week.days).distance);
    const max = Math.max(...totals, 1);
    groups.forEach((week, i) => {
      const bar = button('mp-chart-week', undefined, () => selectWeek(week.start, true));
      bar.setAttribute('aria-pressed', String(selectedWeek === week.start));
      bar.setAttribute('aria-label', `Week ${i + 1}, ${dateLabel(week.start, { month: 'short', day: 'numeric' })}, ${distance(totals[i])} ${units}. Show summary.`);
      const shape = el('span', 'mp-chart-bar'); shape.style.height = `${Math.max(3, totals[i] / max * 60)}px`;
      bar.title = `${week.days[0].phase || 'Training'} · ${dateLabel(week.start, { month: 'short', day: 'numeric' })}`;
      bar.append(el('span', 'mp-chart-number', distance(totals[i])), shape, el('span', '', dateLabel(week.start, { month: 'short', day: 'numeric' })));
      chart.append(bar);
    });
  }
  function render() {
    groups = C.weeks(plan);
    $('plan-title').textContent = plan.title;
    $('plan-source').textContent = isDemo ? 'SAMPLE TRAINING BLOCK' : 'YOUR TRAINING BLOCK';
    const notice = $('plan-notice').querySelector('p');
    notice.replaceChildren(el('strong', '', isDemo ? 'Sample plan. ' : 'Imported plan. '), document.createTextNode(isDemo ? (plan.sampleRevision === C.SAMPLE_REVISION ? 'CIM · Dec 6, 2026. Goal 2:35:00; peak 110 mi/week. Block assumes established high-volume training.' : 'An earlier sample with saved training logs. Select “Load sample” to view the updated CIM block.') : 'Stored on this device. Select a date to review prescribed training and record completion.'));
    $('nutrition-note').textContent = plan.nutritionNote || 'Your imported plan has no overall fueling note. Open a day to check its fueling details, or ask your AI coach to add them to your next export.';
    $('storage-status').textContent = storageMessage || 'Your plan and imported activities stay in this browser. Export a backup to keep a copy.';
    app.querySelectorAll('[data-unit]').forEach(node => { node.textContent = units; });
    ['mi', 'km'].forEach(unit => $(`unit-${unit}`).setAttribute('aria-pressed', String(unit === units)));
    $('pace-unit-note').hidden = units === plan.units;
    ['training', 'fueling'].forEach(mode => $(`view-${mode}`).setAttribute('aria-pressed', String(mode === view)));
    renderPaces(); renderSummary(); renderCalendar(); renderChart(); renderAnalysis(); activities?.render();
  }
  function renderPaces() {
    const grid = $('pace-grid'); grid.replaceChildren();
    if (!plan.paceReference) {
      $('pace-basis').textContent = 'No reference performance in this plan. Enter a goal or recent race result to calculate equivalent paces.';
      return;
    }
    const reference = plan.paceReference, result = C.equivalentPaces(reference);
    const seed = C.RACE_DISTANCES.find(race => race.meters === reference.distanceMeters);
    $('pace-basis').textContent = `${reference.basis === 'goal' ? 'Goal' : 'Recent result'}: ${seed.name} ${C.formatTime(reference.timeSeconds)} · VDOT ${result.score.toFixed(1)} · ${reference.basis === 'goal' ? 'Goal-based equivalents; current fitness is not established.' : 'Race equivalents; individual performance may differ.'}`;
    result.races.forEach(race => {
      const card = el('div', 'mp-pace-card');
      const exact = race.meters === reference.distanceMeters;
      const heading = el('div', 'mp-pace-card-heading');
      heading.append(el('span', 'mp-eyebrow', race.label), el('span', 'mp-pace-kind', exact ? (reference.basis === 'goal' ? 'Goal' : 'Result') : 'Estimate'));
      const value = el('div', 'mp-pace-value');
      value.append(el('strong', '', C.formatTime(units === 'mi' ? race.perMile : race.perKm)), el('span', '', `/${units}`));
      card.append(heading, value, el('span', 'mp-pace-secondary', `${C.formatTime(race.seconds)} · ${race.name}`), el('span', 'mp-pace-split', `${C.formatTime(race.per400, 1)} /400 m`));
      grid.append(card);
    });
  }
  $('edit-paces').addEventListener('click', () => {
    const reference = plan.paceReference;
    $('pace-distance').value = reference ? String(reference.distanceMeters) : '42195';
    $('pace-time').value = reference ? C.formatTime(reference.timeSeconds) : '';
    $('pace-reference-basis').value = reference?.basis || 'recent-race';
    $('pace-error').textContent = '';
    openDialog('pace-dialog');
  });
  $('pace-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      plan.paceReference = C.validatePaceReference({ distanceMeters: Number($('pace-distance').value), timeSeconds: C.parseTime($('pace-time').value), basis: $('pace-reference-basis').value });
      persist(); renderPaces(); $('pace-dialog').close();
      announce('Pace reference updated. Calendar workout prescriptions remain as written.');
    } catch (error) { $('pace-error').textContent = error.message; }
  });
  $('remove-paces').addEventListener('click', () => {
    delete plan.paceReference; persist(); renderPaces(); $('pace-dialog').close(); announce('Pace reference removed.');
  });
  function setView(mode) { view = mode; render(); announce(`Calendar showing ${mode}.`); }
  ['mi', 'km'].forEach(unit => $(`unit-${unit}`).addEventListener('click', () => { units = unit; persist(); render(); announce(`Distances shown in ${units}. Pace labels retain the plan’s original units.`); }));
  ['training', 'fueling'].forEach(mode => $(`view-${mode}`).addEventListener('click', () => setView(mode)));
  $('show-fueling').addEventListener('click', () => { setWorkspace('calendar'); setView('fueling'); $('calendar-title').scrollIntoView({ block: 'start' }); $('view-fueling').focus({ preventScroll: true }); });
  function changeMonth(delta) {
    month = new Date(month.getFullYear(), month.getMonth() + delta, 1, 12);
    const first = plan.days.find(day => day.date.slice(0, 7) === C.dateKey(month).slice(0, 7));
    selectedWeek = C.dateKey(C.monday(first ? first.date : month));
    render(); announce(`Calendar showing ${$('calendar-title').textContent}.`);
  }
  $('previous-month').addEventListener('click', () => changeMonth(-1));
  $('next-month').addEventListener('click', () => changeMonth(1));
  $('today').addEventListener('click', () => {
    today = C.dateKey(new Date()); focusDate(today); scheduleDateRefresh();
    const week = groups.find(item => item.start === selectedWeek);
    render(); announce(week ? 'Showing the current month and week.' : 'Showing the current month. Today is outside your training block.');
  });

  function showDay(key) {
    activeDate = key;
    const day = plan.days.find(item => item.date === key);
    $('day-date').textContent = `${dateLabel(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${day.phase ? ` · ${day.phase}` : ''}`;
    $('day-title').textContent = day.title;
    $('day-description').textContent = day.description || 'No additional workout notes in this plan.';
    const summary = $('day-summary'); summary.replaceChildren();
    [day.distance ? `${distance(day.distance)} ${units}` : '', day.minutes ? `~${Math.round(day.minutes)} min` : 'Rest day', day.rpe ? `Main-session RPE ${day.rpe}/10` : '', day.pace].filter(Boolean).forEach(item => summary.append(el('span', '', item)));
    const fueling = $('day-fueling'); fueling.replaceChildren();
    ['before', 'during', 'after'].forEach(phase => fueling.append(el('dt', '', phase[0].toUpperCase() + phase.slice(1)), el('dd', '', day.fueling[phase] || 'No note provided.')));
    const checkin = checkins[key] || {};
    $('day-completed').checked = checkin.completed === true;
    $('day-rpe').value = checkin.rpe || '';
    $('day-notes').value = checkin.notes || '';
    activities?.renderDay(key);
    openDialog('day-dialog');
  }
  $('checkin-form').addEventListener('submit', event => {
    event.preventDefault();
    checkins[activeDate] = { completed: $('day-completed').checked, rpe: $('day-rpe').value ? Number($('day-rpe').value) : null, notes: $('day-notes').value.trim() };
    selectedWeek = C.dateKey(C.monday(activeDate));
    persist(); $('day-dialog').close(); render();
    ($('analysis-panel').hidden ? app.querySelector(`[data-date="${activeDate}"]`) : $(`analysis-day-${activeDate}`))?.focus({ preventScroll: true });
    announce(storageMessage || 'Check-in saved in this browser.');
  });

  const form = $('brief-form');
  function restoreBrief() {
    form.reset();
    form.elements.startDate.value = C.dateKey(C.monday(new Date()));
    if (!brief) return;
    for (const field of form.elements) {
      if (!field.name || !Object.hasOwn(brief, field.name)) continue;
      if (field.name === 'days') field.checked = Array.isArray(brief.days) && brief.days.includes(field.value);
      else if (typeof brief[field.name] === 'string') field.value = brief[field.name];
    }
  }
  restoreBrief();
  $('start-setup').addEventListener('click', () => switchDialog('workflow-dialog', 'setup-dialog'));
  $('edit-brief').addEventListener('click', () => switchDialog('prompt-dialog', 'setup-dialog'));
  $('prompt-import').addEventListener('click', () => switchDialog('prompt-dialog', 'import-dialog'));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    const next = Object.fromEntries(data.entries()); next.days = data.getAll('days');
    $('brief-error').textContent = '';
    if (!next.days.length) { $('brief-error').textContent = 'Choose at least one available running day.'; return; }
    if (next.longDay !== 'Flexible' && !next.days.includes(next.longDay)) { $('brief-error').textContent = 'Choose an available day for your long run, or select Flexible.'; return; }
    try {
      C.parseDate(next.startDate);
      if (next.raceDate && C.parseDate(next.raceDate) < C.parseDate(next.startDate)) throw new Error('Your race date must be on or after the plan starts.');
      $('coaching-prompt').value = C.buildPrompt(next);
    } catch (error) { $('brief-error').textContent = error.message; return; }
    brief = next; persist();
    $('copy-status').textContent = '';
    switchDialog('setup-dialog', 'prompt-dialog');
  });
  $('copy-prompt').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('coaching-prompt').value); $('copy-status').textContent = 'Copied. Paste this into your AI chat, then import the finished plan here.'; }
    catch { $('coaching-prompt').focus(); $('coaching-prompt').select(); $('copy-status').textContent = 'Automatic copy is unavailable. The prompt is selected; use your device’s Copy command.'; }
  });
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    $('import-error').textContent = '';
    if (file.size > A.MAX_BYTES) { $('import-error').textContent = 'Choose a JSON file smaller than 4 MB.'; event.target.value = ''; return; }
    try { $('import-json').value = await file.text(); } catch { $('import-error').textContent = 'This file could not be read. Try pasting its JSON instead.'; }
  });
  $('import-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const input = A.readJSON($('import-json').value);
      const result = C.parseImport($('import-json').value, A.MAX_BYTES);
      const nextHistory = Object.hasOwn(input, 'activityHistory') ? A.validateHistory(input.activityHistory) : activityHistory;
      if (activityHistory.athleteId && nextHistory.athleteId && activityHistory.athleteId !== nextHistory.athleteId) throw new Error('This backup belongs to a different athlete. Export and clear current data before restoring another account.');
      plan = result.plan; checkins = result.checkins; isDemo = result.isDemo; units = plan.units;
      activityHistory = nextHistory;
      if (Object.hasOwn(input, 'brief')) { brief = input.brief && typeof input.brief === 'object' && !Array.isArray(input.brief) ? input.brief : null; restoreBrief(); }
      focusPlan();
      persist(); render(); $('import-dialog').close();
      $('import-json').value = ''; $('import-file').value = ''; $('import-error').textContent = '';
      announce(storageMessage || 'Plan imported and saved in this browser.');
    } catch (error) { $('import-error').textContent = error.message; }
  });

  function download(contents, mime, filename) {
    const url = URL.createObjectURL(new Blob([contents], { type: mime }));
    const link = el('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportBackup() {
    download(JSON.stringify({ ...plan, checkins, sample: isDemo, brief, activityHistory }, null, 2), 'application/json', `running-plan-${plan.days[0].date}.json`);
    announce('Backup exported, including plan, training inputs, check-ins, notes, and activity history. Restore it with Import plan.');
  }
  $('export-plan').addEventListener('click', exportBackup);
  $('export-calendar').addEventListener('click', () => download(C.toICS(plan), 'text/calendar;charset=utf-8', `running-plan-${plan.days[0].date}.ics`));
  $('clear-data').addEventListener('click', () => {
    try { localStorage.removeItem(STORAGE_KEY); storageMessage = ''; }
    catch { storageMessage = 'Browser storage could not be cleared. Use your browser’s site-data settings to remove previously saved data.'; }
    plan = C.samplePlan(); checkins = {}; brief = null; isDemo = true; units = 'mi'; view = 'training'; activeDate = null;
    activityHistory = A.emptyHistory(); activities.reset(); sync?.forget();
    today = C.dateKey(new Date()); focusDate(today);
    restoreBrief(); $('coaching-prompt').value = ''; $('import-form').reset(); $('checkin-form').reset();
    $('brief-error').textContent = ''; $('import-error').textContent = ''; $('copy-status').textContent = ''; $('pace-form').reset(); $('pace-error').textContent = '';
    $('clear-dialog').close(); render(); announce(storageMessage || 'Training data cleared. Showing the CIM sample plan.');
  });
  $('load-sample').addEventListener('click', () => {
    plan = C.samplePlan(); checkins = {}; isDemo = true; activeDate = null;
    focusPlan();
    persist(); $('sample-dialog').close(); render(); announce('CIM sample loaded. Weekly volume peaks at 110 miles.');
  });
  analytics = window.MilepostAnalytics.create({ onWeek: start => selectWeek(start, true), onDay: showDay, onExport: download });
  activities = window.MilepostActivities.create({ getState, onHistory: next => { activityHistory = next; persist(); render(); }, onPlan: next => { plan = next; isDemo = false; persist(); render(); }, onExport: download, onBackup: exportBackup, announce });
  setWorkspace(hashWorkspace(), false);
  if (sampleUpdated) persist();
  render();
  sync = window.MilepostSync.create({ getState, onHistory: next => { activityHistory = next; persist(); render(); }, onExport: download, announce });
  sync.start();
  scheduleDateRefresh();
})();
