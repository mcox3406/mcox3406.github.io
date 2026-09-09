(function () {
  'use strict';
  const C = window.MilepostCore, A = window.MilepostActivitiesCore;
  const $ = id => document.getElementById(id);
  const number = value => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
  const dateLabel = date => C.parseDate(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function create({ getState, onHistory, onPlan, onExport, onBackup, announce }) {
    let pendingSnapshot = null, pendingAdjustment = null, limit = 20;
    const initial = getState();
    if (initial.activityHistory.updatedAt) $('strava-instructions').open = false;
    $('activity-range-start').value = C.dateKey(C.addDays(initial.today, -42));
    $('activity-range-end').value = C.dateKey(C.addDays(initial.today, -1));
    function state() { return { ...getState(), today: C.dateKey(new Date()) }; }
    function distance(value, units) { return `${number(value)} ${units}`; }
    function showPrompt(prompt, review = false) {
      $('activity-prompt-title').textContent = review ? 'Training review prompt' : 'Activity export prompt';
      $('activity-prompt-label').textContent = review ? 'PLAN + OBSERVED TRAINING' : 'OFFICIAL STRAVA CONNECTION';
      $('activity-prompt-text').value = prompt; $('activity-copy-status').textContent = '';
      $('activity-prompt-dialog').showModal();
    }
    $('prepare-activity-prompt').addEventListener('click', () => {
      try {
        const start = $('activity-range-start').value, end = $('activity-range-end').value;
        C.parseDate(start); C.parseDate(end);
        if (start > end || end > state().today || end > C.dateKey(C.addDays(start, 183))) throw new Error('Choose up to 184 days, ending no later than today.');
        showPrompt(A.exportPrompt(start, end)); $('activity-range-error').textContent = '';
      } catch (error) { $('activity-range-error').textContent = error.message; }
    });
    $('prepare-review-prompt').addEventListener('click', () => {
      try {
        const current = state();
        if (!current.activityHistory.updatedAt) throw new Error('Import an activity snapshot first so the review has recorded training to assess.');
        showPrompt(A.reviewPrompt(current, $('review-observations').value), true); $('review-prepare-error').textContent = '';
      } catch (error) { $('review-prepare-error').textContent = error.message; }
    });
    $('copy-activity-prompt').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('activity-prompt-text').value); $('activity-copy-status').textContent = 'Copied. Paste into your connected Claude chat.'; }
      catch { $('activity-prompt-text').focus(); $('activity-prompt-text').select(); $('activity-copy-status').textContent = 'Copy the selected prompt with your keyboard.'; }
    });
    $('download-activity-prompt').addEventListener('click', () => onExport($('activity-prompt-text').value, 'text/plain', 'running-strava-prompt.txt'));
    function invalidate(kind) {
      if (kind === 'activity-import') pendingSnapshot = null; else pendingAdjustment = null;
      $(`${kind}-preview`).hidden = true; $(`${kind}-error`).textContent = '';
    }
    for (const kind of ['activity-import', 'adjustment']) {
      $(`${kind}-json`).addEventListener('input', () => invalidate(kind));
      $(`${kind}-file`).addEventListener('change', async event => {
        invalidate(kind);
        const file = event.target.files[0];
        if (!file) return;
        try {
          if (file.size > A.MAX_BYTES) throw new Error('Choose a file smaller than 4 MB.');
          $(`${kind}-json`).value = await file.text();
        } catch (error) { $(`${kind}-error`).textContent = error.message; }
        event.target.value = '';
      });
    }
    $('activity-import-form').addEventListener('submit', event => {
      event.preventDefault(); invalidate('activity-import');
      try {
        const current = state(), snapshot = A.parseSnapshot($('activity-import-json').value, current.today);
        const merged = A.merge(current.activityHistory, snapshot), counts = merged.counts;
        const total = snapshot.activities.reduce((sum, row) => sum + row.distanceMeters, 0);
        $('activity-import-summary').textContent = `Athlete ${snapshot.athleteId} · ${snapshot.rangeStart} – ${snapshot.rangeEnd} · ${snapshot.activities.length} runs · ${distance(A.meters(total, current.units), current.units)}. Export reports ${snapshot.complete ? 'complete' : 'partial'} coverage.`;
        $('activity-import-counts').textContent = `${counts.added} new · ${counts.updated} updated · ${counts.unchanged} unchanged · ${counts.removed} removed. Exported ${new Date(snapshot.exportedAt).toLocaleString('en-US')}.`;
        pendingSnapshot = { snapshot, historyKey: A.contextKey(current) };
        $('activity-import-preview').hidden = false;
      } catch (error) { $('activity-import-error').textContent = error.message; }
    });
    $('save-activity-import').addEventListener('click', () => {
      if (!pendingSnapshot) return;
      try {
        const current = state();
        if (pendingSnapshot.historyKey !== A.contextKey(current)) throw new Error('Saved data or the date changed. Preview this import again before saving.');
        const snapshot = A.parseSnapshot(JSON.stringify(pendingSnapshot.snapshot), current.today);
        onHistory(A.merge(current.activityHistory, snapshot).history);
        invalidate('activity-import'); $('activity-import-dialog').close(); $('strava-instructions').open = false;
        announce('Activity snapshot saved. Planned workouts and check-ins are unchanged.');
      } catch (error) { $('activity-import-error').textContent = error.message; }
    });
    function workoutDetails(day, units) {
      const container = el('div', 'mp-proposal-workout');
      container.append(el('strong', '', day.title), el('p', 'mp-chart-hint', `${day.type} · ${distance(day.distance, units)} · ${number(day.minutes)} min · RPE ${day.rpe}${day.easyMinutes === undefined ? '' : ` · ${number(day.easyMinutes)} easy min`}`), el('p', '', day.pace), el('p', 'mp-preserve-lines', day.description));
      const fueling = el('details'); fueling.append(el('summary', '', 'Fueling details'));
      for (const key of ['before', 'during', 'after']) fueling.append(el('p', 'mp-chart-hint', `${key[0].toUpperCase() + key.slice(1)}: ${day.fueling[key] || 'Not specified'}`));
      container.append(fueling); return container;
    }
    $('adjustment-form').addEventListener('submit', event => {
      event.preventDefault(); invalidate('adjustment');
      try {
        const current = state(), raw = $('adjustment-json').value, result = A.parseAdjustment(raw, current);
        $('adjustment-summary').textContent = result.summary;
        const weeks = $('adjustment-weeks'); weeks.replaceChildren();
        for (const week of result.weeks) weeks.append(el('p', 'mp-proposal-total', `Week of ${dateLabel(week.start)}: ${distance(week.before, current.plan.units)} → ${distance(week.after, current.plan.units)} (${week.after >= week.before ? '+' : ''}${number(week.after - week.before)} ${current.plan.units})`));
        const changes = $('adjustment-changes'); changes.replaceChildren();
        for (const change of result.changes) {
          const item = el('section', 'mp-proposal-change'); item.append(el('h3', '', dateLabel(change.date)), el('p', 'mp-preserve-lines', change.reason));
          const pair = el('div', 'mp-proposal-pair');
          for (const [title, day] of [['Current', change.before], ['Proposed', change.workout]]) { const side = el('div'); side.append(el('span', 'mp-eyebrow', title), workoutDetails(day, current.plan.units)); pair.append(side); }
          item.append(pair); changes.append(item);
        }
        if (!result.changes.length) changes.append(el('p', '', 'No changes proposed. Your scheduled plan stays as it is.'));
        $('apply-adjustment').hidden = !result.changes.length;
        $('apply-adjustment').textContent = `Apply ${result.changes.length} ${result.changes.length === 1 ? 'change' : 'changes'}`;
        pendingAdjustment = raw; $('adjustment-preview').hidden = false;
      } catch (error) { $('adjustment-error').textContent = error.message; }
    });
    $('apply-adjustment').addEventListener('click', () => {
      if (!pendingAdjustment) return;
      try {
        const result = A.parseAdjustment(pendingAdjustment, state());
        if (!result.changes.length) return;
        onPlan(result.plan); invalidate('adjustment'); $('adjustment-dialog').close();
        announce(`${result.changes.length} future workouts updated. Activity history and training logs retained.`);
      } catch (error) { $('adjustment-error').textContent = error.message; }
    });
    $('export-activities').addEventListener('click', onBackup);
    $('activity-show-more').addEventListener('click', () => { limit += 20; render(); });
    function stat(parent, label, value, note) {
      const item = el('div', 'mp-analysis-stat'); item.append(el('span', 'mp-eyebrow', label), el('strong', '', value), el('span', 'mp-chart-hint', note)); parent.append(item);
    }
    function render() {
      const current = getState(), history = current.activityHistory, { today, units, plan } = current;
      const end = C.dateKey(C.addDays(today, -1)), start = C.dateKey(C.addDays(today, -28));
      const runs = history.activities.filter(row => A.dayKey(row) >= start && A.dayKey(row) <= end);
      const totals = runs.reduce((sum, row) => ({ distance: sum.distance + row.distanceMeters, seconds: sum.seconds + row.movingSeconds }), { distance: 0, seconds: 0 });
      let covered = 0; for (let date = start; date <= end; date = C.dateKey(C.addDays(date, 1))) if (history.coverage[date] === true) covered++;
      const dates = new Map(); for (const run of runs) dates.set(A.dayKey(run), (dates.get(A.dayKey(run)) || 0) + 1);
      $('activity-status').textContent = history.updatedAt ? `Athlete ${history.athleteId} · ${history.activities.length} saved runs · snapshot exported ${new Date(history.updatedAt).toLocaleString('en-US')} · latest activity snapshot` : 'No activity snapshot imported. The calendar currently shows prescribed training.';
      const stats = $('activity-stats'); stats.replaceChildren();
      stat(stats, 'Imported distance', distance(A.meters(totals.distance, units), units), 'Last 28 days, through yesterday');
      stat(stats, 'Moving time', `${number(totals.seconds / 3600)} h`, `${runs.length} individual runs`);
      stat(stats, 'Longest single run', runs.length ? distance(A.meters(Math.max(...runs.map(row => row.distanceMeters)), units), units) : '—', 'Last 28 days');
      stat(stats, 'Days with doubles', String([...dates.values()].filter(count => count >= 2).length), `${dates.size} days with imported runs`);
      $('activity-coverage').textContent = `${start} – ${end}: ${covered} / 28 dates reported complete. ${covered < 28 ? 'Totals may be incomplete; missing data do not establish missed training.' : 'Totals reflect recorded Strava runs in the imported snapshot.'} These numbers do not establish race readiness.`;
      const daily = A.daily(history, units, today), planned = new Map(plan.days.map(day => [day.date, day]));
      const table = $('activity-weekly-table'); table.replaceChildren();
      const lastMonday = C.dateKey(C.monday(end));
      for (let index = 5; index >= 0; index--) {
        const week = C.dateKey(C.addDays(lastMonday, -index * 7));
        let actual = 0, minutes = 0, target = 0, coveredDays = 0, days = 0, scheduled = 0;
        for (let date = week; date <= end && date <= C.dateKey(C.addDays(week, 6)); date = C.dateKey(C.addDays(date, 1))) {
          days++; if (history.coverage[date] === true) coveredDays++;
          actual += daily[date]?.distance || 0; minutes += daily[date]?.minutes || 0;
          if (planned.has(date)) { scheduled++; target += C.convertDistance(planned.get(date).distance, plan.units, units); }
        }
        const comparable = coveredDays === days && scheduled === days;
        const row = el('tr'); row.append(el('th', '', `${dateLabel(week)}${days < 7 ? ` (${days}d)` : ''}`)); row.firstChild.scope = 'row';
        for (const value of [scheduled ? `${distance(target, units)}${scheduled < days ? ' *' : ''}` : '—', distance(actual, units), comparable ? `${actual >= target ? '+' : ''}${distance(actual - target, units)}` : '—', `${number(minutes / 60)} h`, `${coveredDays} / ${days} dates`]) row.append(el('td', '', value));
        table.append(row);
      }
      const activityTable = $('activity-table'); activityTable.replaceChildren();
      const ordered = [...history.activities].reverse();
      for (const run of ordered.slice(0, limit)) {
        const row = el('tr'), heading = el('th'), link = el('a', '', run.name); heading.scope = 'row';
        link.href = `https://www.strava.com/activities/${run.id}`; link.target = '_blank'; link.rel = 'noopener noreferrer';
        heading.append(el('span', 'mp-activity-start', `${dateLabel(A.dayKey(run))}, ${run.startLocal.slice(0, 4)} · ${run.startLocal.slice(11, 16)} · ${run.sport}`), link); row.append(heading);
        const length = A.meters(run.distanceMeters, units);
        for (const value of [distance(length, units), C.formatTime(run.movingSeconds), `${C.formatTime(run.movingSeconds / length)}/${units}`, run.elevationMeters === undefined ? '—' : `${number(units === 'mi' ? run.elevationMeters * 3.280839895 : run.elevationMeters)} ${units === 'mi' ? 'ft' : 'm'}`, run.averageHeartRate === undefined ? '—' : `${number(run.averageHeartRate)} bpm`]) row.append(el('td', '', value));
        activityTable.append(row);
      }
      $('activity-empty').hidden = ordered.length > 0;
      $('activity-table-note').textContent = ordered.length ? `Showing ${Math.min(limit, ordered.length)} of ${ordered.length} runs, newest first. Missing optional measurements remain blank (—).` : '';
      $('activity-show-more').hidden = ordered.length <= limit;
      $('export-activities').disabled = !history.updatedAt;
    }
    function renderDay(date) {
      const current = getState(), runs = current.activityHistory.activities.filter(row => A.dayKey(row) === date);
      const container = $('day-activities'); container.replaceChildren(); container.hidden = !runs.length;
      if (!runs.length) return;
      container.append(el('h3', '', 'Imported activities'));
      for (const run of runs) {
        const length = A.meters(run.distanceMeters, current.units);
        container.append(el('p', '', `${run.startLocal.slice(11, 16)} · ${run.name} · ${distance(length, current.units)} · ${C.formatTime(run.movingSeconds)} moving · ${C.formatTime(run.movingSeconds / length)}/${current.units}`));
      }
      container.append(el('p', 'mp-chart-hint', 'Activity totals do not automatically confirm completion of the prescribed workout.'));
    }
    function reset() {
      invalidate('activity-import'); invalidate('adjustment'); limit = 20;
      for (const id of ['activity-import-json', 'adjustment-json', 'activity-prompt-text', 'review-observations', 'activity-import-file', 'adjustment-file']) $(id).value = '';
      $('activity-copy-status').textContent = ''; $('review-prepare-error').textContent = '';
      for (const id of ['activity-import-summary', 'activity-import-counts', 'adjustment-summary', 'adjustment-weeks', 'adjustment-changes']) $(id).replaceChildren();
      $('strava-instructions').open = true;
    }
    return { render, renderDay, reset };
  }
  window.MilepostActivities = { create };
})();
