const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const modules = Promise.all([import('../services/running-sync/worker.mjs'), import('../services/running-sync/mcp.mjs')]);
const fixtureMapping = { tool: 'fixture_list_runs', arguments: { start: '$start', end: '$end', page: '$page', count: 2 }, activitiesPath: 'activities', athleteIdPath: 'athleteId', pagination: 'page', pageSize: 2, completePath: 'complete' };
const fixtureTool = { name: fixtureMapping.tool, inputSchema: { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' }, page: { type: 'integer' }, count: { type: 'integer' } }, required: ['start', 'end', 'page', 'count'], additionalProperties: false } };
const fixtureRun = (id = 123) => ({ id, sport_type: 'Run', name: 'Synthetic test run', start_date_local: '2026-09-07T23:15:00Z', distance: 16093.44, moving_time: 4200, total_elevation_gain: 25 });
class Storage {
  constructor() { this.values = new Map(); this.alarm = null; }
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async deleteAll() { this.values.clear(); }
  async list({ prefix }) { return new Map([...this.values].filter(([key]) => key.startsWith(prefix))); }
  async setAlarm(date) { this.alarm = date; }
  async deleteAlarm() { this.alarm = null; }
}
async function setup() {
  const [W] = await modules;
  const storage = new Storage();
  const env = { SITE_URL: 'https://example.com/fun/running/', SERVICE_URL: 'https://sync.example.workers.dev', OWNER_CODE: 'owner-code-'.repeat(5), ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'), MCP_ACTIVITY_MAPPING: JSON.stringify(fixtureMapping) };
  const instance = new W.PersonalRunningSync({ storage }, env);
  const calls = []; let refreshes = 0, rejectRefresh = false;
  const tokenValue = () => ({ access_token: 'private-strava-access', refresh_token: 'private-strava-refresh-' + refreshes, token_type: 'Bearer', expires_in: 3600 });
  instance.fetcher = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/.well-known/oauth-protected-resource')) return Response.json({ resource: 'https://mcp.strava.com/mcp', authorization_servers: ['https://www.strava.com/mcp-issuer'] });
    if (url.includes('/.well-known/oauth-authorization-server/')) return Response.json({ authorization_endpoint: 'https://www.strava.com/oauth/mcp/authorize', token_endpoint: 'https://www.strava.com/oauth/mcp/token', registration_endpoint: 'https://www.strava.com/oauth/mcp/register_client', revocation_endpoint: 'https://www.strava.com/oauth/mcp/revoke' });
    if (url.endsWith('register_client')) return Response.json({ client_id: 'test-personal-client', token_endpoint_auth_method: 'none', redirect_uris: [env.SERVICE_URL + '/oauth/callback'] });
    if (url.endsWith('/token')) {
      if (options.body.get('grant_type') === 'refresh_token') { refreshes++; if (rejectRefresh) return Response.json({ error: 'invalid_grant' }, { status: 400 }); }
      return Response.json(tokenValue());
    }
    if (url.endsWith('/revoke')) return new Response(null, { status: 200 });
    if (url === 'https://mcp.strava.com/mcp') {
      if (options.method === 'DELETE') return new Response(null, { status: 204 });
      const input = JSON.parse(options.body);
      if (input.method === 'notifications/initialized') return new Response(null, { status: 202 });
      let result;
      if (input.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } };
      if (input.method === 'tools/list') result = { tools: [fixtureTool] };
      if (input.method === 'tools/call') result = { structuredContent: { athleteId: '456', activities: [fixtureRun()], complete: true } };
      return Response.json({ jsonrpc: '2.0', id: input.id, result }, { headers: { 'mcp-session-id': 'fixture-session' } });
    }
    throw new Error('Unexpected network destination: ' + url);
  };
  env.RUNNING = { idFromName: value => value, get: () => instance };
  const request = (path, data, token, origin = 'https://example.com') => new Request(env.SERVICE_URL + path, { method: data === undefined ? 'GET' : 'POST', headers: { Origin: origin, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const send = (path, data, token, origin) => W.default.fetch(request(path, data, token, origin), env);
  async function authorize() {
    const verifier = Buffer.alloc(32, 9).toString('base64url');
    const start = await (await send('/connect', { ownerCode: env.OWNER_CODE, challenge: await W.digest(verifier) })).json();
    const url = new URL(start.authorizeUrl);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256'); assert.equal(url.searchParams.get('resource'), 'https://mcp.strava.com/mcp');
    const callback = '/oauth/callback?code=fixture-code&state=' + url.searchParams.get('state');
    const response = await send(callback);
    assert.equal(response.status, 303);
    const target = new URL(response.headers.get('location'));
    const handoff = new URLSearchParams(target.hash.slice(1)).get('strava-handoff');
    const result = await (await send('/exchange', { handoff, verifier })).json();
    assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
    return { ...result, callback, handoff, verifier };
  }
  return { W, storage, env, instance, calls, send, authorize, refreshCount: () => refreshes, expireRefresh: () => { rejectRefresh = true; } };
}
test('official metadata allowlist rejects credentials, redirects, and unexpected hosts', async () => {
  const [, M] = await modules;
  for (const url of ['http://www.strava.com/oauth/token', 'https://attacker.example/oauth/token', 'https://user:pass@www.strava.com/oauth/token', 'https://www.strava.com:444/oauth/token']) assert.throws(() => M.endpoint(url));
  assert.equal(M.endpoint('https://www.strava.com/oauth/mcp/token'), 'https://www.strava.com/oauth/mcp/token');
});
test('OAuth binds callback state and browser proof, persists encrypted tokens, and returns only a site session', async () => {
  const app = await setup(), auth = await app.authorize();
  assert.equal((await app.send(auth.callback)).status, 400);
  assert.equal((await app.send('/exchange', { handoff: auth.handoff, verifier: auth.verifier })).status, 400);
  assert.doesNotMatch(JSON.stringify([...app.storage.values]), /private-strava|fixture-code/);
  assert.doesNotMatch(JSON.stringify(auth), /private-strava/);
  const status = await app.send('/status', undefined, auth.token);
  assert.equal(status.headers.get('Access-Control-Allow-Origin'), 'https://example.com');
  assert.equal(status.headers.get('Cache-Control'), 'no-store');
  assert.equal((await status.json()).authorized, true);
  assert.equal((await app.send('/status', undefined, auth.token, 'https://attacker.example')).status, 403);
  assert.equal((await app.send('/status')).status, 401);
  const exchange = app.calls.find(call => call.url.endsWith('/token'));
  assert.equal(exchange.options.body.get('code_verifier').length, 43);
  assert.equal(app.calls.some(call => call.url.includes('/api/v3/')), false);
});
test('wrong owner code and invalid browser proof cannot open or redeem a connection', async () => {
  const app = await setup();
  assert.equal((await app.send('/connect', { ownerCode: 'wrong', challenge: 'x'.repeat(43) })).status, 403);
  assert.equal(app.calls.length, 0);
  assert.equal((await app.send('/exchange', { handoff: 'x'.repeat(43), verifier: 'y'.repeat(43) })).status, 400);
  assert.equal((await app.send('/oauth/callback?state=arbitrary&code=fake')).status, 400);
});
test('token refreshes are serialized and the latest refresh token is persisted before reads', async () => {
  const app = await setup(), auth = await app.authorize();
  const connection = await app.instance.read('connection'); connection.tokens.expires_at = Date.now() / 1000 - 1; await app.instance.write('connection', connection);
  const responses = await Promise.all([app.send('/tools', undefined, auth.token), app.send('/tools', undefined, auth.token)]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]); assert.equal(app.refreshCount(), 1);
  assert.equal((await app.instance.read('connection')).tokens.refresh_token, 'private-strava-refresh-1');
  assert.equal(app.calls.filter(call => call.options.method === 'DELETE').length, 2);
});
test('revoked refresh grants stop access and expired browser sessions are rejected', async () => {
  const app = await setup(), auth = await app.authorize();
  const connection = await app.instance.read('connection'); connection.tokens.expires_at = 1; await app.instance.write('connection', connection); app.expireRefresh();
  const response = await app.send('/tools', undefined, auth.token); assert.equal(response.status, 401); assert.equal((await response.json()).code, 'strava_authorization_expired');
  assert.equal(await app.instance.read('connection'), null);
  await app.storage.put('session:' + await app.W.digest(auth.token), { expires: 1 });
  assert.equal((await app.send('/status', undefined, auth.token)).status, 401);
});
test('sync uses the configured official tool, rate limits requests, and never stores activity payloads', async () => {
  const app = await setup(), auth = await app.authorize(), today = new Date().toISOString().slice(0, 10);
  const response = await app.send('/sync', { today }, auth.token), data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.snapshot.source, 'strava-official-mcp'); assert.equal(data.snapshot.athleteId, '456');
  assert.doesNotMatch(JSON.stringify([...app.storage.values]), /Synthetic test run|16093|23:15/);
  assert.equal((await app.send('/sync', { today }, auth.token)).status, 429);
  assert.equal((await app.send('/sync', { today: '2026-99-99' }, auth.token)).status, 400);
});
test('unconfigured mappings stop before calling tools; failed imports do not claim success', async () => {
  const app = await setup(), auth = await app.authorize(); delete app.env.MCP_ACTIVITY_MAPPING;
  const response = await app.send('/sync', { today: new Date().toISOString().slice(0, 10) }, auth.token);
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'mapping_required');
  assert.equal(app.calls.some(call => typeof call.options.body === 'string' && call.options.body.includes('tools/call')), false);
  assert.equal(await app.storage.get('lastSync'), undefined);
});
test('disconnect revokes access and deletes backend credentials, sessions, and temporary proofs', async () => {
  const app = await setup(), auth = await app.authorize();
  const response = await app.send('/disconnect', {}, auth.token), result = await response.json();
  assert.equal(result.revoked, true); assert.equal(result.deleted, true); assert.equal(app.storage.values.size, 0); assert.equal(app.storage.alarm, null);
  assert.equal((await app.send('/status', undefined, auth.token)).status, 401);
});
test('credential ciphertext cannot be decrypted with another key or after tampering', async () => {
  const [W] = await modules, key = Buffer.alloc(32, 7).toString('base64url');
  const sealed = await W.seal({ refresh_token: 'sensitive' }, key);
  assert.deepEqual(await W.unseal(sealed, key), { refresh_token: 'sensitive' });
  await assert.rejects(W.unseal(sealed, Buffer.alloc(32, 8).toString('base64url')));
  await assert.rejects(W.unseal({ ...sealed, ciphertext: (sealed.ciphertext[0] === 'A' ? 'B' : 'A') + sealed.ciphertext.slice(1) }, key));
});
test('Streamable HTTP reads fragmented SSE and cancels after the matching response without waiting for closure', async () => {
  const [, M] = await modules; let canceled = false;
  const stream = new ReadableStream({ start(controller) { for (const part of ['event: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n', 'data: {"jsonrpc":"2.0","id":3,"res', 'ult":{"ok":true}}\r\n\r\n']) controller.enqueue(new TextEncoder().encode(part)); }, cancel() { canceled = true; } });
  assert.deepEqual(await M.rpcResponse(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }), 3), { jsonrpc: '2.0', id: 3, result: { ok: true } });
  assert.equal(canceled, true);
});
test('activity paging preserves local dates and doubles; missing completeness stays unknown', async () => {
  const [, M] = await modules; const calls = [];
  const client = { async send(method, params) { calls.push(params); return { structuredContent: { athleteId: '456', activities: params.arguments.page === 1 ? [fixtureRun(1), fixtureRun(2)] : [fixtureRun(3)], complete: true } }; } };
  const result = await M.activitySnapshot(client, fixtureMapping, '2026-09-01', '2026-09-08', new Date('2026-09-08T20:00:00Z'));
  assert.equal(result.activities.length, 3); assert.equal(result.activities[0].startLocal, '2026-09-07T23:15:00'); assert.equal(result.complete, true); assert.equal(calls.length, 2);
  const partial = await M.activitySnapshot(client, { ...fixtureMapping, completePath: '' }, '2026-09-01', '2026-09-08'); assert.equal(partial.complete, false);
  await assert.rejects(M.activitySnapshot({ send: async () => ({ structuredContent: { athleteId: '456', activities: [fixtureRun(1), fixtureRun(1)], complete: true } }) }, fixtureMapping, '2026-09-01', '2026-09-08'), /repeated an activity/);
});
test('unknown tool mappings and malformed recorded values fail without inventing measurements', async () => {
  const [, M] = await modules;
  assert.throws(() => M.validateMapping('{}', [fixtureTool]), /configuration/);
  assert.throws(() => M.validateMapping(JSON.stringify({ ...fixtureMapping, arguments: { page: '$page' } }), [fixtureTool]), /required argument/);
  assert.throws(() => M.structuredResult({ content: [{ type: 'text', text: 'You ran 10 miles yesterday.' }] }), /unstructured/);
  for (const fields of [{ id: Number.MAX_SAFE_INTEGER + 1 }, { moving_time: null }, { distance: '10' }, { start_date_local: '2026-02-30T10:00:00Z' }, { start_date_local: '2026-99-99T10:00:00Z' }]) assert.throws(() => M.normalizeActivity({ ...fixtureRun(), ...fields }));
  assert.equal(M.normalizeActivity({ ...fixtureRun(), sport_type: 'Ride' }), null);
  assert.equal(M.normalizeActivity(fixtureRun()).averageHeartRate, undefined);
});
