const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

// Run the deployable bundle in workerd. Every upstream response and credential is synthetic.
const script = readFileSync(resolve(__dirname, '../.wrangler/dry-run/worker.js'), 'utf8');
const service = 'https://sync.example.workers.dev', site = 'https://example.com';
const ownerCode = 'synthetic-runtime-owner-'.repeat(2);
const verifier = Buffer.alloc(32, 9).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const resourcePath = '/.well-known/oauth-protected-resource';
const registrationPath = '/oauth/mcp/register_client';
const tokenPath = '/oauth/mcp/token';
const fixtureTool = { name: 'synthetic_runtime_runs', inputSchema: { type: 'object', properties: {}, additionalProperties: false } };
const mapping = { tool: fixtureTool.name, arguments: {}, activitiesPath: 'activities', athleteIdPath: 'athleteId', pagination: 'none', completePath: 'complete' };

function fixture(t, initialRedirect) {
  let redirectAt = initialRedirect;
  const calls = [], grants = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    workers: [{
      name: 'running-runtime-test', modules: true, script, compatibilityDate: '2026-09-08',
      bindings: { SITE_URL: site + '/fun/running/', SERVICE_URL: service, OWNER_CODE: ownerCode, ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'), MCP_ACTIVITY_MAPPING: JSON.stringify(mapping) },
      durableObjects: { RUNNING: { className: 'PersonalRunningSync', useSQLite: true } },
      outboundService: async request => {
        const url = new URL(request.url), path = url.pathname;
        calls.push({ origin: url.origin, path, method: request.method });
        assert.ok(['https://mcp.strava.com', 'https://www.strava.com'].includes(url.origin), 'Credentials must never follow an upstream redirect.');
        if (path === redirectAt) return new Response(null, { status: 302, headers: { Location: 'https://redirect-target.invalid/credentials' } });
        if (path === resourcePath) return Response.json({ resource: 'https://mcp.strava.com/mcp', authorization_servers: ['https://www.strava.com/mcp-issuer'] });
        if (path.includes('/.well-known/oauth-authorization-server/')) return Response.json({ authorization_endpoint: 'https://www.strava.com/oauth/mcp/authorize', token_endpoint: 'https://www.strava.com' + tokenPath, registration_endpoint: 'https://www.strava.com' + registrationPath, revocation_endpoint: 'https://www.strava.com/oauth/mcp/revoke' });
        if (path === registrationPath) {
          const input = await request.json();
          assert.deepEqual(input.redirect_uris, [service + '/oauth/callback']);
          return Response.json({ client_id: 'synthetic-runtime-client', token_endpoint_auth_method: 'none', redirect_uris: input.redirect_uris });
        }
        if (path === tokenPath) {
          const fields = new URLSearchParams(await request.text());
          grants.push(fields.get('grant_type'));
          assert.equal(fields.get('client_id'), 'synthetic-runtime-client');
          if (fields.get('grant_type') === 'authorization_code') assert.match(fields.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
          else assert.equal(fields.get('refresh_token'), 'synthetic-refresh-initial');
          return Response.json({ access_token: 'synthetic-strava-access', refresh_token: grants.length === 1 ? 'synthetic-refresh-initial' : 'synthetic-refresh-renewed', expires_in: grants.length === 1 ? 60 : 3600, token_type: 'Bearer' });
        }
        if (path === '/oauth/mcp/revoke') {
          const fields = new URLSearchParams(await request.text());
          assert.equal(fields.get('token'), 'synthetic-refresh-renewed');
          return new Response(null, { status: 200 });
        }
        if (path === '/mcp') {
          assert.equal(request.headers.get('Authorization'), 'Bearer synthetic-strava-access');
          if (request.method === 'DELETE') return new Response(null, { status: 204 });
          const input = await request.json();
          if (input.method === 'notifications/initialized') return new Response(null, { status: 202 });
          let result;
          if (input.method === 'initialize') result = { protocolVersion: input.params.protocolVersion, capabilities: {}, serverInfo: { name: 'synthetic', version: '1' } };
          else if (input.method === 'tools/list') result = { tools: [fixtureTool] };
          else if (input.method === 'tools/call') {
            assert.equal(input.params.name, fixtureTool.name);
            result = { structuredContent: { athleteId: '123', complete: true, activities: [{ id: '456', sport_type: 'Run', name: 'Synthetic runtime run', start_date_local: new Date().toISOString().slice(0, 10) + 'T06:00:00Z', distance: 10000, moving_time: 3000 }] } };
          } else throw new Error('Unexpected synthetic MCP operation.');
          return Response.json({ jsonrpc: '2.0', id: input.id, result }, { headers: { 'Mcp-Session-Id': 'synthetic-session' } });
        }
        throw new Error('Unexpected synthetic upstream path.');
      }
    }]
  }));
  t.after(() => mf.dispose());
  const send = (path, data, token) => mf.dispatchFetch(service + path, { method: data === undefined ? 'GET' : 'POST', redirect: 'manual', headers: { Origin: site, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const connect = () => send('/connect', { ownerCode, challenge });
  async function authorize() {
    const start = await connect();
    assert.equal(start.status, 200);
    const url = new URL((await start.json()).authorizeUrl);
    assert.equal(url.origin, 'https://www.strava.com');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const callback = '/oauth/callback?code=synthetic-code&state=' + url.searchParams.get('state');
    const response = await send(callback);
    assert.equal(response.status, 303);
    const target = new URL(response.headers.get('Location'));
    assert.equal(target.origin, site);
    const handoff = new URLSearchParams(target.hash.slice(1)).get('strava-handoff');
    const exchanged = await send('/exchange', { handoff, verifier });
    assert.equal(exchanged.status, 200);
    const session = await exchanged.json();
    assert.match(session.token, /^[A-Za-z0-9_-]{43}$/);
    assert.doesNotMatch(JSON.stringify(session), /synthetic-strava|synthetic-refresh/);
    return session;
  }
  return { send, connect, authorize, calls, grants, redirect: path => { redirectAt = path; } };
}

test('workerd supports authorization, encrypted storage, token renewal, MCP reads, and revocation', async t => {
  const app = fixture(t), session = await app.authorize();
  const tools = await app.send('/tools', undefined, session.token);
  assert.equal(tools.status, 200);
  assert.deepEqual((await tools.json()).tools, [fixtureTool]);
  assert.deepEqual(app.grants, ['authorization_code', 'refresh_token']);
  const sync = await app.send('/sync', { today: new Date().toISOString().slice(0, 10) }, session.token);
  assert.equal(sync.status, 200);
  const data = await sync.json();
  assert.equal(data.snapshot.activities[0].distanceMeters, 10000);
  assert.equal(data.snapshot.activities[0].movingSeconds, 3000);
  assert.equal(app.calls.filter(call => call.method === 'DELETE').length, 2);
  const disconnected = await app.send('/disconnect', {}, session.token);
  assert.equal((await disconnected.json()).revoked, true);
  assert.equal((await app.send('/status', undefined, session.token)).status, 401);
});

for (const path of [resourcePath, registrationPath]) test(`workerd rejects redirects from ${path}`, async t => {
  const app = fixture(t, path), response = await app.connect();
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'connector_error');
  assert.equal(app.calls.at(-1).path, path);
});

for (const path of [tokenPath, '/mcp']) test(`workerd does not forward credentials through redirects from ${path}`, async t => {
  const app = fixture(t), session = await app.authorize();
  app.redirect(path);
  const response = await app.send('/tools', undefined, session.token);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'connector_error');
  assert.equal(app.calls.at(-1).path, path);
});
