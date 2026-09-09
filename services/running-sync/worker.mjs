import { RESOURCE, SyncError, discover, register, oauthPost, jsonResponse, tokens, StravaMcp, validateMapping, activitySnapshot } from './mcp.mjs';

const MINUTE = 60000, DAY = 86400000;
const encoder = new TextEncoder();
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
export const digest = async value => encode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
function errorResponse(error) {
  return json({ error: error instanceof SyncError ? error.message : 'The connection could not complete this request. Try again or check the service configuration.', code: error instanceof SyncError ? error.code : 'service_error' }, error instanceof SyncError ? error.status : 503);
}
export function settings(env) {
  let site, service;
  try { site = new URL(env.SITE_URL); service = new URL(env.SERVICE_URL); } catch { throw new SyncError('The running sync service needs its site and service URLs configured.', 503, 'not_configured'); }
  if (site.protocol !== 'https:' || service.protocol !== 'https:' || site.username || site.password || service.username || service.password || site.search || site.hash || service.search || service.hash || service.pathname !== '/' || service.hostname.includes('replace_with')) throw new SyncError('Configure exact HTTPS site and service URLs.', 503, 'not_configured');
  if (typeof env.OWNER_CODE !== 'string' || env.OWNER_CODE.length < 32 || typeof env.ENCRYPTION_KEY !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(env.ENCRYPTION_KEY)) throw new SyncError('The service needs its private owner code and encryption key configured.', 503, 'not_configured');
  return { site, service, callback: service.origin + '/oauth/callback' };
}
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json') || Number(request.headers.get('content-length')) > 16000) throw new SyncError('Use a small JSON request.', 400, 'invalid_request');
  const text = await request.text(); if (encoder.encode(text).length > 16000) throw new SyncError('Request is too large.', 413, 'invalid_request');
  try { return JSON.parse(text); } catch { throw new SyncError('Request is not valid JSON.', 400, 'invalid_request'); }
}
export async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', decode(secret), 'AES-GCM', false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('personal-running-sync.v1') }, key, encoder.encode(JSON.stringify(value)));
  return { iv: encode(iv), ciphertext: encode(new Uint8Array(encrypted)) };
}
export async function unseal(value, secret) {
  const key = await crypto.subtle.importKey('raw', decode(secret), 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(value.iv), additionalData: encoder.encode('personal-running-sync.v1') }, key, decode(value.ciphertext));
  return JSON.parse(new TextDecoder().decode(decrypted));
}
export default {
  async fetch(request, env) {
    let response;
    const origin = request.headers.get('Origin');
    try {
      const { site, service } = settings(env), url = new URL(request.url);
      if (url.origin !== service.origin) throw new SyncError('Unexpected service address.', 400, 'invalid_request');
      if (url.pathname === '/oauth/callback' && request.method === 'GET') {
        response = await env.RUNNING.get(env.RUNNING.idFromName('personal')).fetch(request);
      } else {
        if (origin !== site.origin) throw new SyncError('This request did not originate from the configured running page.', 403, 'origin_denied');
        if (request.method === 'OPTIONS') response = new Response(null, { status: 204 });
        else if (!['/connect', '/exchange', '/status', '/sync', '/tools', '/disconnect', '/logout'].includes(url.pathname)) response = json({ error: 'Not found.' }, 404);
        else response = await env.RUNNING.get(env.RUNNING.idFromName('personal')).fetch(request);
      }
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-store'); headers.set('Referrer-Policy', 'no-referrer'); headers.set('X-Content-Type-Options', 'nosniff');
      if (origin === site.origin) {
        headers.set('Access-Control-Allow-Origin', site.origin); headers.set('Vary', 'Origin');
        headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      }
      return new Response(response.body, { status: response.status, headers });
    } catch (error) { return errorResponse(error); }
  }
};

export class PersonalRunningSync {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.queue = Promise.resolve(); this.fetcher = fetch; }
  serial(operation) { const next = this.queue.then(operation); this.queue = next.catch(() => {}); return next; }
  async read(key) { const value = await this.ctx.storage.get(key); return value ? unseal(value, this.env.ENCRYPTION_KEY) : null; }
  async write(key, value) { await this.ctx.storage.put(key, await seal(value, this.env.ENCRYPTION_KEY)); }
  async cleanup() {
    for (const prefix of ['pending:', 'handoff:', 'session:']) {
      const items = await this.ctx.storage.list({ prefix });
      for (const [key, item] of items) if (item.expires <= Date.now()) await this.ctx.storage.delete(key);
    }
    await this.ctx.storage.setAlarm(Date.now() + DAY);
  }
  async alarm() { return this.serial(() => this.cleanup()); }
  async fetch(request) {
    return this.serial(async () => {
      try { await this.cleanup(); return await this.route(request); }
      catch (error) { return errorResponse(error); }
    });
  }
  async client() {
    let registered = await this.read('client');
    if (!registered) {
      const metadata = await discover(this.fetcher);
      const client = await register(metadata, settings(this.env).callback, this.fetcher);
      registered = { metadata, client }; await this.write('client', registered);
    }
    return registered;
  }
  async authenticate(request) {
    const header = request.headers.get('Authorization') || '';
    if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) throw new SyncError('Connect this browser to Strava first.', 401, 'session_expired');
    const key = 'session:' + await digest(header.slice(7));
    const session = await this.ctx.storage.get(key);
    if (!session || session.expires <= Date.now()) throw new SyncError('This browser’s session expired. Reconnect to continue.', 401, 'session_expired');
    return { key, ...session };
  }
  async connection() {
    let connection = await this.read('connection');
    if (!connection) throw new SyncError('Strava authorization is unavailable. Reconnect to continue.', 401, 'strava_authorization_expired');
    if (connection.tokens.expires_at <= Date.now() / 1000 + 120) {
      const { metadata, client } = await this.client();
      const response = await oauthPost(metadata.token_endpoint, client, { grant_type: 'refresh_token', refresh_token: connection.tokens.refresh_token, resource: RESOURCE }, this.fetcher);
      if (response.status === 400 || response.status === 401) {
        await this.ctx.storage.delete('connection');
        throw new SyncError('Strava authorization was revoked or expired. Reconnect to continue.', 401, 'strava_authorization_expired');
      }
      const updated = await jsonResponse(response);
      connection.tokens = tokens({ ...updated, refresh_token: updated.refresh_token || connection.tokens.refresh_token });
      await this.write('connection', connection); // Persist rotation before making any other call.
    }
    return connection;
  }
  async mcp() {
    const connection = await this.connection();
    const client = new StravaMcp(connection.tokens.access_token, this.fetcher); await client.initialize(); return client;
  }
  async route(request) {
    const path = new URL(request.url).pathname;
    const { site, service, callback } = settings(this.env);
    if (path === '/connect' && request.method === 'POST') {
      const input = await body(request);
      if (typeof input.ownerCode !== 'string' || await digest(input.ownerCode) !== await digest(this.env.OWNER_CODE)) throw new SyncError('The private access code is incorrect.', 403, 'access_denied');
      if (typeof input.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.challenge)) throw new SyncError('The browser authorization challenge is invalid.', 400, 'invalid_request');
      const pending = await this.ctx.storage.list({ prefix: 'pending:' });
      if (pending.size >= 5) throw new SyncError('Several connections are already pending. Finish one or wait ten minutes.', 429, 'rate_limited');
      const { metadata, client } = await this.client();
      const state = random(), verifier = random(), challenge = await digest(verifier);
      await this.ctx.storage.put('pending:' + await digest(state), { expires: Date.now() + 10 * MINUTE, browserChallenge: input.challenge, secret: await seal(verifier, this.env.ENCRYPTION_KEY) });
      const url = new URL(metadata.authorization_endpoint);
      url.search = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: callback, scope: this.env.MCP_SCOPES || 'read activity:read_all', state, code_challenge: challenge, code_challenge_method: 'S256', resource: RESOURCE }).toString();
      return json({ authorizeUrl: url.href });
    }
    if (path === '/oauth/callback' && request.method === 'GET') {
      const url = new URL(request.url), state = url.searchParams.get('state');
      if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new SyncError('The authorization state is invalid. Start again from the running page.', 400, 'invalid_state');
      const key = 'pending:' + await digest(state), pending = await this.ctx.storage.get(key);
      await this.ctx.storage.delete(key);
      if (!pending || pending.expires <= Date.now()) throw new SyncError('This authorization link expired or was already used.', 400, 'invalid_state');
      if (url.searchParams.has('error')) return Response.redirect(site.href + '#strava-error=authorization_declined', 303);
      const code = url.searchParams.get('code');
      if (!code || code.length > 4096) throw new SyncError('Strava did not provide an authorization code.', 400, 'invalid_request');
      const { client, metadata } = await this.client();
      const result = tokens(await jsonResponse(await oauthPost(metadata.token_endpoint, client, { grant_type: 'authorization_code', code, redirect_uri: callback, code_verifier: await unseal(pending.secret, this.env.ENCRYPTION_KEY), resource: RESOURCE }, this.fetcher)));
      const handoff = random();
      await this.ctx.storage.put('handoff:' + await digest(handoff), { expires: Date.now() + 5 * MINUTE, browserChallenge: pending.browserChallenge, secret: await seal({ tokens: result, authorizedAt: new Date().toISOString() }, this.env.ENCRYPTION_KEY) });
      return Response.redirect(site.href + '#strava-handoff=' + handoff, 303);
    }
    if (path === '/exchange' && request.method === 'POST') {
      const input = await body(request);
      if (![input.handoff, input.verifier].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value))) throw new SyncError('The browser connection proof is invalid.', 400, 'invalid_request');
      const key = 'handoff:' + await digest(input.handoff), handoff = await this.ctx.storage.get(key);
      if (!handoff || handoff.expires <= Date.now() || handoff.browserChallenge !== await digest(input.verifier)) throw new SyncError('This connection was started in another browser, expired, or was already used. Reconnect from this page.', 400, 'invalid_state');
      await this.ctx.storage.delete(key);
      await this.write('connection', await unseal(handoff.secret, this.env.ENCRYPTION_KEY));
      // A newly authorized account invalidates older browser sessions.
      const sessions = await this.ctx.storage.list({ prefix: 'session:' });
      for (const oldKey of sessions.keys()) await this.ctx.storage.delete(oldKey);
      const token = random(), expires = Date.now() + 30 * DAY;
      await this.ctx.storage.put('session:' + await digest(token), { expires });
      await this.ctx.storage.delete('lastSync'); await this.ctx.storage.delete('retryAfter');
      return json({ token, expires, service: service.origin });
    }
    const session = await this.authenticate(request);
    if (path === '/status' && request.method === 'GET') {
      const connection = await this.read('connection');
      return json({ authorized: !!connection, authorizedAt: connection?.authorizedAt || null, sessionExpires: session.expires, configured: !!this.env.MCP_ACTIVITY_MAPPING, lastSync: await this.ctx.storage.get('lastSync') || null, retryAfter: await this.ctx.storage.get('retryAfter') || null });
    }
    if (path === '/logout' && request.method === 'POST') { await this.ctx.storage.delete(session.key); return json({ loggedOut: true }); }
    if (path === '/disconnect' && request.method === 'POST') {
      const connection = await this.read('connection'); let revoked = false;
      try {
        if (connection) {
          const { metadata, client } = await this.client();
          const response = await oauthPost(metadata.revocation_endpoint, client, { token: connection.tokens.refresh_token, token_type_hint: 'refresh_token' }, this.fetcher);
          revoked = response.ok; await response.body?.cancel();
        } else revoked = true;
      } catch { /* Always delete locally, even if Strava cannot be reached. */ }
      await this.ctx.storage.deleteAll(); await this.ctx.storage.deleteAlarm();
      return json({ disconnected: true, deleted: true, revoked, message: revoked ? 'Connection and server credentials deleted.' : 'Server credentials deleted. Strava could not confirm revocation; remove this app in Strava → Settings → My Apps.' });
    }
    if (path === '/tools' && request.method === 'GET') {
      const client = await this.mcp();
      try { return json({ source: RESOURCE, tools: await client.listTools(), note: 'Tool definitions only; no activity data or credentials.' }); }
      finally { await client.close(); }
    }
    if (path === '/sync' && request.method === 'POST') {
      const input = await body(request), today = input.today;
      const utcToday = new Date().toISOString().slice(0, 10);
      if (typeof today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(today) || !Number.isFinite(Date.parse(today + 'T12:00:00Z')) || Math.abs(Date.parse(today + 'T12:00:00Z') - Date.parse(utcToday + 'T12:00:00Z')) > DAY) throw new SyncError('The device date is invalid or differs from the server date.', 400, 'invalid_request');
      const retryAfter = await this.ctx.storage.get('retryAfter');
      if (retryAfter > Date.now()) return json({ error: 'Waiting before another Strava request.', code: 'rate_limited', retryAfter }, 429);
      const start = new Date(today + 'T12:00:00Z'); start.setUTCDate(start.getUTCDate() - 42);
      let client;
      try {
        client = await this.mcp();
        const mapping = validateMapping(this.env.MCP_ACTIVITY_MAPPING, await client.listTools());
        const snapshot = await activitySnapshot(client, mapping, start.toISOString().slice(0, 10), today);
        await this.ctx.storage.put('lastSync', snapshot.exportedAt);
        await this.ctx.storage.put('retryAfter', Date.now() + 15 * MINUTE);
        // Activity responses are returned directly and never persisted in backend storage.
        return json({ snapshot, nextRefresh: Date.now() + 15 * MINUTE });
      } catch (error) {
        if (error.code === 'rate_limited') await this.ctx.storage.put('retryAfter', Date.now() + 60 * MINUTE);
        throw error;
      } finally { await client?.close(); }
    }
    return json({ error: 'Unsupported request.' }, 405);
  }
}
