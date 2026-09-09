/* Personal connection to the official Strava MCP through the owner's backend. */
(function () {
  'use strict';
  const C = window.MilepostCore, A = window.MilepostActivitiesCore;
  const $ = id => document.getElementById(id);
  const KEY = 'milepost.sync.v1', PROOF = 'milepost.sync.proof';
  const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  function serviceUrl(value) {
    let url; try { url = new URL(value); } catch { throw new Error('Enter the HTTPS address of your deployed running sync service.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the service’s HTTPS origin only, with no path or credentials.');
    return url.origin;
  }
  function create({ getState, onHistory, onExport, announce }) {
    let saved = {}, timer, busy = false, nextRefresh = 0, lastAttempt = 0, generation = 0, mappingPaused = false;
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (value.service) saved = { service: serviceUrl(value.service), ...(typeof value.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.token) ? { token: value.token, expires: value.expires } : {}) };
    } catch { /* Invalid connection settings do not change the training plan. */ }
    const configuredService = $('sync-service').dataset.default;
    if (!saved.service && configuredService) { try { saved.service = serviceUrl(configuredService); } catch { /* Show the setup form. */ } }
    $('sync-service').value = saved.service || '';
    function persist() {
      try { localStorage.setItem(KEY, JSON.stringify(saved)); }
      catch { throw new Error('Browser storage is unavailable. Allow site storage to retain this connection. Your training data are unchanged.'); }
    }
    function message(value, error = false) { $('sync-status').textContent = value; $('sync-status').classList.toggle('mp-error', error); }
    function render() {
      const connected = !!saved.token && saved.expires > Date.now();
      $('sync-connect').hidden = connected; $('sync-owner-label').hidden = connected;
      $('sync-refresh').hidden = !connected; $('sync-disconnect').hidden = !connected; $('sync-diagnostics').hidden = !connected;
      $('sync-service').disabled = connected;
      $('sync-service-settings').open = !connected && !saved.service;
      $('sync-refresh').disabled = busy;
      $('sync-connection-label').textContent = connected ? 'Personal Strava authorization saved' : 'Automatic updates';
    }
    async function request(path, data, authorized = true) {
      const requestGeneration = generation;
      const headers = { 'Content-Type': 'application/json' };
      if (authorized) headers.Authorization = `Bearer ${saved.token}`;
      let response;
      try { response = await fetch(saved.service + path, { method: data === undefined ? 'GET' : 'POST', headers, ...(data === undefined ? {} : { body: JSON.stringify(data) }), credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(90000) }); }
      catch { throw new Error('The sync service could not be reached. Check its address and that it allows this website. Your imported data are unchanged.'); }
      let result; try { result = await response.json(); } catch { throw new Error('The sync service returned an unreadable response.'); }
      if (requestGeneration !== generation) throw new Error('The browser connection changed while the request was running.');
      if (!response.ok) {
        const error = new Error(result.error || 'The sync request failed.'); error.code = result.code; error.retryAfter = result.retryAfter;
        if (error.code === 'session_expired' || error.code === 'strava_authorization_expired') { delete saved.token; delete saved.expires; persist(); }
        throw error;
      }
      return result;
    }
    function schedule() {
      clearTimeout(timer);
      if (saved.token && !document.hidden) timer = setTimeout(() => refresh(), Math.max(15000, nextRefresh - Date.now()));
    }
    async function refresh(manual = false) {
      if (!saved.token || busy || document.hidden) return;
      if (mappingPaused && !manual) return;
      if (manual && mappingPaused) { mappingPaused = false; nextRefresh = 0; }
      if (Date.now() < nextRefresh) {
        if (manual) message(`Next Strava refresh is available at ${new Date(nextRefresh).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. Recent imports stay visible.`);
        schedule(); return;
      }
      const activeGeneration = generation;
      busy = true; lastAttempt = Date.now(); render(); message('Retrieving activities from Strava’s official MCP…');
      try {
        const baseline = getState().activityHistory;
        const expected = JSON.stringify(baseline);
        const result = await request('/sync', { today: C.dateKey(new Date()) });
        if (activeGeneration !== generation) return;
        if (JSON.stringify(getState().activityHistory) !== expected) throw new Error('Activity history changed while the request was running. Refresh again to review the latest data.');
        const snapshot = A.parseSnapshot(JSON.stringify(result.snapshot), C.dateKey(new Date()));
        const merged = A.merge(baseline, snapshot);
        // Importing a first account is explicit; later scheduled refreshes only use that athlete.
        onHistory(merged.history);
        nextRefresh = Math.max(Date.now() + 15 * 60000, Number(result.nextRefresh) || 0);
        const count = merged.counts;
        message(`Updated ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · ${count.added} new, ${count.updated} updated, ${count.removed} removed · ${snapshot.complete ? 'complete' : 'partial'} export. Refreshes every 15 minutes while this page is visible.`);
        announce('Strava activities updated. Scheduled workouts and check-ins were preserved.');
      } catch (error) {
        nextRefresh = Math.max(Date.now() + (error.code === 'rate_limited' ? 60 : 15) * 60000, Number(error.retryAfter) || 0);
        if (activeGeneration !== generation) return;
        if (error.code === 'mapping_required') { mappingPaused = true; message(error.message, true); }
        else message(error.message, true);
      } finally { if (activeGeneration === generation) { busy = false; render(); schedule(); } }
    }
    $('sync-connect-form').addEventListener('submit', async event => {
      event.preventDefault(); if (busy) return;
      busy = true; $('sync-connect').disabled = true;
      try {
        saved.service = serviceUrl($('sync-service').value.trim());
        const ownerCode = $('sync-owner-code').value;
        if (ownerCode.length < 32) throw new Error('Enter the site owner’s private access code. This is not your Strava password.');
        const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
        const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
        sessionStorage.setItem(PROOF, JSON.stringify({ verifier, service: saved.service, created: Date.now() }));
        persist();
        const result = await request('/connect', { ownerCode, challenge }, false);
        $('sync-owner-code').value = '';
        const target = new URL(result.authorizeUrl);
        if (target.origin !== 'https://www.strava.com' || target.pathname !== '/oauth/mcp/authorize') throw new Error('The service returned an unexpected authorization address.');
        location.assign(target.href);
      } catch (error) { message(error.message, true); busy = false; $('sync-connect').disabled = false; render(); }
    });
    $('sync-refresh').addEventListener('click', () => refresh(true));
    $('sync-diagnostics').addEventListener('click', async () => {
      if (busy) return;
      try {
        const data = await request('/tools');
        onExport(JSON.stringify(data, null, 2), 'application/json', 'strava-mcp-tool-definitions.json');
        message('Connection diagnostics downloaded. This file contains tool definitions, not activity data or credentials.');
      } catch (error) { message(error.message, true); render(); }
    });
    $('sync-disconnect').addEventListener('click', () => $('sync-disconnect-dialog').showModal());
    $('sync-confirm-disconnect').addEventListener('click', async () => {
      if (busy) return;
      busy = true; render();
      try {
        const result = await request('/disconnect', {});
        saved = { service: saved.service }; persist();
        onHistory(A.emptyHistory());
        clearTimeout(timer); $('sync-disconnect-dialog').close(); message(result.message || 'Disconnected. Server credentials and local activity history were deleted.');
      } catch (error) { $('sync-disconnect-error').textContent = error.message; }
      finally { busy = false; render(); }
    });
    async function start() {
      const fragment = new URLSearchParams(location.hash.slice(1));
      const handoff = fragment.get('strava-handoff');
      if (handoff || fragment.has('strava-error')) {
        history.replaceState(null, '', '#activities'); window.dispatchEvent(new HashChangeEvent('hashchange'));
        try {
          if (!handoff) throw new Error('Strava authorization was declined. Your existing imports are unchanged.');
          const proof = JSON.parse(sessionStorage.getItem(PROOF) || '{}'); sessionStorage.removeItem(PROOF);
          if (!proof.verifier || Date.now() - proof.created > 15 * 60000 || proof.service !== saved.service) throw new Error('The connection must finish in the same tab where it began. Connect again from this page.');
          const result = await request('/exchange', { handoff, verifier: proof.verifier }, false);
          if (typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.token) || !Number.isFinite(result.expires) || result.service !== saved.service) throw new Error('The service returned an invalid browser session.');
          saved = { service: saved.service, token: result.token, expires: result.expires }; persist();
          message('Strava authorization saved. Checking the activity connection…');
        } catch (error) { message(error.message, true); render(); return; }
      }
      render();
      if (saved.token && saved.expires > Date.now()) {
        try {
          const status = await request('/status');
          if (!status.authorized) { delete saved.token; persist(); message('Strava authorization is unavailable. Reconnect to continue.', true); render(); return; }
          if (!status.configured) { mappingPaused = true; message('Strava is authorized. Complete the activity-tool mapping in your backend before enabling automatic refresh. Download connection diagnostics for setup.', true); return; }
          // A successful prior refresh is available locally. Respect the service's request interval.
          if (getState().activityHistory.updatedAt && status.retryAfter > Date.now()) {
            nextRefresh = status.retryAfter; message(`Last server refresh: ${new Date(status.lastSync).toLocaleString('en-US')}. Automatic updates are enabled.`); schedule();
          } else await refresh();
        } catch (error) { message(error.message, true); render(); }
      } else message('The site owner can authorize Strava to refresh activities when this page is open. Manual imports are available below.');
    }
    function forget() {
      clearTimeout(timer); generation++; saved = {}; nextRefresh = 0; mappingPaused = false; busy = false;
      try { localStorage.removeItem(KEY); sessionStorage.removeItem(PROOF); } catch { /* The page's storage warning handles restricted storage. */ }
      $('sync-owner-code').value = ''; $('sync-service').value = ''; render();
      message('Browser connection removed. To revoke server access, remove the personal running app in Strava → Settings → My Apps.');
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) clearTimeout(timer); else if (Date.now() - lastAttempt > 60000) refresh(); });
    window.addEventListener('focus', () => { if (Date.now() - lastAttempt > 60000) refresh(); });
    return { start, forget };
  }
  window.MilepostSync = { create };
})();
