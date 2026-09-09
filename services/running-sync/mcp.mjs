/* Official Strava MCP client. No REST API fallback or AI-provider calls. */
export const RESOURCE = 'https://mcp.strava.com/mcp';
const METADATA = 'https://mcp.strava.com/.well-known/oauth-protected-resource';
const ISSUER_METADATA = 'https://www.strava.com/.well-known/oauth-authorization-server/mcp-issuer';
const MAX_RESPONSE = 2000000;
export class SyncError extends Error {
  constructor(message, status = 502, code = 'connector_error') { super(message); this.status = status; this.code = code; }
}
export async function boundedText(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE) throw new SyncError('The connector response is too large.');
  const reader = response.body?.getReader();
  if (!reader) return '';
  let size = 0, result = ''; const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE) throw new SyncError('The connector response is too large.');
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}
export async function jsonResponse(response) {
  if (response.status === 429) throw new SyncError('Strava’s request limit was reached. Automatic refresh will wait before trying again.', 429, 'rate_limited');
  if (!response.ok) throw new SyncError(`Strava returned HTTP ${response.status}.`, response.status === 401 ? 401 : 502, response.status === 401 ? 'strava_authorization_expired' : 'connector_error');
  try { return JSON.parse(await boundedText(response)); }
  catch (error) { if (error instanceof SyncError) throw error; throw new SyncError('Strava returned an unreadable response.'); }
}
export async function rpcResponse(response, id) {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const decoded = JSON.parse(await boundedText(response));
    return (Array.isArray(decoded) ? decoded : [decoded]).find(row => row.id === id);
  }
  const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > MAX_RESPONSE) throw new SyncError('The connector response is too large.');
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const decoded = JSON.parse(data), match = (Array.isArray(decoded) ? decoded : [decoded]).find(row => row.id === id);
        if (match) return match;
      }
    }
    throw new SyncError('The connector stream ended without a response.');
  } finally { await reader.cancel().catch(() => {}); }
}
export function endpoint(value) {
  let url; try { url = new URL(value); } catch { throw new SyncError('Strava authorization metadata is invalid.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'www.strava.com' || url.username || url.password || url.port || url.hash) throw new SyncError('Strava advertised an unexpected authorization endpoint.');
  return url.href;
}
export async function discover(fetcher = fetch) {
  const resource = await jsonResponse(await fetcher(METADATA, { redirect: 'error', signal: AbortSignal.timeout(15000) }));
  if (resource.resource !== RESOURCE || !resource.authorization_servers?.includes('https://www.strava.com/mcp-issuer')) throw new SyncError('Strava’s authorization discovery changed. Review the official metadata before connecting.');
  const metadata = await jsonResponse(await fetcher(ISSUER_METADATA, { redirect: 'error', signal: AbortSignal.timeout(15000) }));
  for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'revocation_endpoint']) metadata[key] = endpoint(metadata[key]);
  return metadata;
}
export async function register(metadata, callback, fetcher = fetch) {
  const client = await jsonResponse(await fetcher(endpoint(metadata.registration_endpoint), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Personal running planner', redirect_uris: [callback], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) }));
  if (typeof client.client_id !== 'string' || !client.client_id || !['none', 'client_secret_post', 'client_secret_basic'].includes(client.token_endpoint_auth_method || 'none')) throw new SyncError('Strava did not register a supported personal OAuth client.');
  if (client.redirect_uris && !client.redirect_uris.includes(callback)) throw new SyncError('Strava did not accept this callback address.');
  if (client.token_endpoint_auth_method && client.token_endpoint_auth_method !== 'none' && typeof client.client_secret !== 'string') throw new SyncError('Strava did not return the registered client credentials.');
  return client;
}
export async function oauthPost(url, client, fields, fetcher = fetch) {
  const body = new URLSearchParams({ client_id: client.client_id, ...fields });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (client.token_endpoint_auth_method === 'client_secret_post') body.set('client_secret', client.client_secret);
  if (client.token_endpoint_auth_method === 'client_secret_basic') headers.Authorization = `Basic ${btoa(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(client.client_secret)}`)}`;
  return fetcher(endpoint(url), { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(15000) });
}
export function tokens(value) {
  if (typeof value.access_token !== 'string' || !value.access_token || typeof value.refresh_token !== 'string' || !value.refresh_token || (value.token_type && value.token_type.toLowerCase() !== 'bearer')) throw new SyncError('Strava did not issue renewable credentials. Automatic updates cannot start.');
  const expires = Number(value.expires_at) || Date.now() / 1000 + Number(value.expires_in);
  if (!Number.isFinite(expires) || expires <= Date.now() / 1000) throw new SyncError('Strava returned an invalid credential expiration.');
  return { access_token: value.access_token, refresh_token: value.refresh_token, expires_at: expires, scope: value.scope };
}
export class StravaMcp {
  constructor(accessToken, fetcher = fetch) { this.token = accessToken; this.fetcher = fetcher; this.nextId = 0; this.protocol = '2025-03-26'; }
  async send(method, params, notification = false) {
    const id = ++this.nextId;
    const headers = { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': this.protocol };
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    const response = await this.fetcher(RESOURCE, { method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(20000), body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params }) });
    if (response.status === 401) throw new SyncError('Strava authorization expired. Reconnect to continue.', 401, 'strava_authorization_expired');
    if (response.status === 429) throw new SyncError('Strava’s request limit was reached. Try again later.', 429, 'rate_limited');
    if (!response.ok) throw new SyncError(`The official MCP connector returned HTTP ${response.status}.`);
    const session = response.headers.get('mcp-session-id');
    if (session) this.session = session;
    if (notification) { await response.body?.cancel(); return; }
    let message;
    try {
      message = await rpcResponse(response, id);
    } catch { throw new SyncError('The official connector response could not be decoded.'); }
    if (!message || message.error || !Object.hasOwn(message, 'result')) throw new SyncError('The official connector could not complete this request.');
    return message.result;
  }
  async initialize() {
    const result = await this.send('initialize', { protocolVersion: this.protocol, capabilities: {}, clientInfo: { name: 'personal-running-planner', version: '1.0.0' } });
    if (typeof result.protocolVersion !== 'string') throw new SyncError('The official connector did not negotiate a protocol version.');
    this.protocol = result.protocolVersion;
    await this.send('notifications/initialized', {}, true);
  }
  async listTools() {
    const result = []; let cursor;
    for (let page = 0; page < 10; page++) {
      const data = await this.send('tools/list', cursor ? { cursor } : {});
      if (!Array.isArray(data.tools)) throw new SyncError('The connector’s tool list is invalid.');
      result.push(...data.tools);
      if (!data.nextCursor) return result;
      if (cursor === data.nextCursor) throw new SyncError('The connector repeated a tool-list cursor.');
      cursor = data.nextCursor;
    }
    throw new SyncError('The connector’s tool list exceeded the supported limit.');
  }
  async close() {
    if (!this.session) return;
    try {
      const response = await this.fetcher(RESOURCE, { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${this.token}`, 'Mcp-Session-Id': this.session, 'MCP-Protocol-Version': this.protocol } });
      await response.body?.cancel();
    } catch { /* Session cleanup cannot invalidate a successfully retrieved result. */ }
  }
}
function atPath(value, path) {
  if (!path) return value;
  for (const key of path.split('.')) { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new SyncError('Invalid activity mapping path.'); value = value?.[key]; }
  return value;
}
export function structuredResult(result) {
  if (result.isError) throw new SyncError('Strava could not retrieve the requested activities.');
  if (result.structuredContent) return result.structuredContent;
  const blocks = result.content?.filter(block => block.type === 'text') || [];
  for (const block of blocks) {
    try { return JSON.parse(block.text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1')); } catch { /* Only verified JSON can be imported automatically. */ }
  }
  throw new SyncError('Strava returned unstructured activity text. The activity mapping needs review before automatic imports can start.', 409, 'mapping_required');
}
export function validateMapping(raw, tools) {
  let config; try { config = JSON.parse(raw || '{}'); } catch { throw new SyncError('The activity mapping configuration is not valid JSON.', 409, 'mapping_required'); }
  const tool = tools.find(item => item.name === config.tool);
  if (!tool || !config.arguments || typeof config.arguments !== 'object' || Array.isArray(config.arguments) || !['none', 'page'].includes(config.pagination) || typeof config.activitiesPath !== 'string' || typeof config.athleteIdPath !== 'string') throw new SyncError('Strava is authorized. Its activity tool needs configuration before automatic updates can start. Download connection diagnostics for setup.', 409, 'mapping_required');
  if (config.pagination === 'page' && (!Number.isInteger(config.pageSize) || config.pageSize < 1 || config.pageSize > 200 || !Object.values(config.arguments).includes('$page'))) throw new SyncError('The activity pagination mapping needs a page size and $page argument.', 409, 'mapping_required');
  if (typeof config.completePath !== 'string') throw new SyncError('The activity mapping must identify the connector’s completeness field, or use an empty path for partial coverage.', 409, 'mapping_required');
  const properties = tool.inputSchema?.properties || {};
  for (const key of tool.inputSchema?.required || []) if (!Object.hasOwn(config.arguments, key)) throw new SyncError(`Activity mapping is missing the required argument ${key}.`, 409, 'mapping_required');
  for (const key of Object.keys(config.arguments)) if (tool.inputSchema?.additionalProperties === false && !Object.hasOwn(properties, key)) throw new SyncError('The activity mapping contains an unsupported argument.', 409, 'mapping_required');
  return config;
}
export function normalizeActivity(row) {
  if (!row || typeof row !== 'object') throw new SyncError('An activity is missing its recorded fields.');
  const sport = row.sport ?? row.sport_type ?? row.type;
  if (!['Run', 'TrailRun', 'VirtualRun'].includes(sport)) return null;
  const numericId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value) ? value : Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  const id = numericId(row.id);
  const startLocal = row.startLocal ?? row.start_date_local?.replace(/Z$/, '');
  const distanceMeters = row.distanceMeters ?? row.distance;
  const movingSeconds = row.movingSeconds ?? row.moving_time;
  if (!id || typeof startLocal !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(startLocal) || !Number.isFinite(Date.parse(startLocal + 'Z')) || new Date(startLocal + 'Z').toISOString().slice(0, 10) !== startLocal.slice(0, 10) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200 || !Number.isFinite(distanceMeters) || distanceMeters <= 0 || distanceMeters > 500000 || !Number.isFinite(movingSeconds) || movingSeconds < 1 || movingSeconds > 604800) throw new SyncError('A running activity has missing or unsupported fields. No partial update was saved.', 409, 'mapping_required');
  const result = { id, startLocal, sport, name: row.name, distanceMeters, movingSeconds };
  for (const [to, from, min, max] of [['elapsedSeconds', 'elapsed_time', movingSeconds, 604800], ['elevationMeters', 'total_elevation_gain', 0, 50000], ['averageHeartRate', 'average_heartrate', 20, 260]]) {
    const value = row[to] ?? row[from];
    if (value !== undefined && value !== null) {
      if (!Number.isFinite(value) || value < min || value > max) throw new SyncError('An optional activity measurement has an unexpected format.', 409, 'mapping_required');
      result[to] = value;
    }
  }
  return result;
}
export async function activitySnapshot(client, config, rangeStart, rangeEnd, now = new Date()) {
  const activities = [], ids = new Set(); let athleteId, complete = false;
  // Query a wider UTC interval; inclusion is checked against each activity's own local date.
  const values = { '$start': rangeStart, '$end': rangeEnd, '$after': Math.floor(Date.parse(rangeStart + 'T00:00:00Z') / 1000) - 86400, '$before': Math.floor(Date.parse(rangeEnd + 'T00:00:00Z') / 1000) + 2 * 86400 };
  for (let page = 1; page <= 10; page++) {
    const args = Object.fromEntries(Object.entries(config.arguments).map(([key, value]) => [key, value === '$page' ? page : Object.hasOwn(values, value) ? values[value] : value]));
    const data = structuredResult(await client.send('tools/call', { name: config.tool, arguments: args }));
    const rows = atPath(data, config.activitiesPath), rawAthleteId = atPath(data, config.athleteIdPath);
    const currentAthleteId = typeof rawAthleteId === 'string' ? rawAthleteId : Number.isSafeInteger(rawAthleteId) ? String(rawAthleteId) : '';
    if (!Array.isArray(rows) || !/^[1-9]\d{0,19}$/.test(currentAthleteId) || (athleteId && athleteId !== currentAthleteId)) throw new SyncError('The connector’s activity list or athlete ID does not match the configured format.', 409, 'mapping_required');
    athleteId = currentAthleteId;
    for (const raw of rows) {
      const row = normalizeActivity(raw); if (!row) continue;
      if (ids.has(row.id)) throw new SyncError('Strava repeated an activity across pages. No partial update was saved.');
      ids.add(row.id);
      if (row.startLocal.slice(0, 10) >= rangeStart && row.startLocal.slice(0, 10) <= rangeEnd) activities.push(row);
    }
    const exhausted = config.pagination === 'none' || rows.length < config.pageSize;
    if (exhausted) {
      // A short page proves termination only for a verified mapping; missing completeness stays unknown.
      complete = !!config.completePath && atPath(data, config.completePath) === true;
      return { version: 1, kind: 'strava-activities', source: 'strava-official-mcp', athleteId, exportedAt: now.toISOString(), rangeStart, rangeEnd, complete, activities };
    }
  }
  throw new SyncError('Strava activity pagination did not finish within ten pages. No partial update was saved.');
}
