// Minimal backend for BROCKER.TV
// - Node + Express
// - SQLite (better-sqlite3)
// - Twitch OAuth token exchange

require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const PORT = process.env.PORT || 3000;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || '';
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`; // public URL for OAuth redirect
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || '';
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// We'll initialize sql.js and the DB in async init below
let db = null; // will be SQL.Database instance
let SQL = null;
const dbFile = path.join(__dirname, 'data.sqlite');

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ ok: true, now: Date.now() }));

// Return an OAuth URL for Twitch. Front-end may redirect user here.
app.get('/auth/twitch/url', (req, res) => {
  const localUser = req.query.user || 'guest';
  const intent = req.query.intent || null; // 'register' or 'link'
  let state = '';
  if (intent === 'register') state = 'register';
  else if (intent === 'link' && req.query.user) state = `link:${encodeURIComponent(req.query.user)}`;
  else state = encodeURIComponent(localUser);
  const redirect = `${BASE_URL}/auth/twitch/callback`;
  const url = `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${TWITCH_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirect)}&scope=user:read:email+openid&state=${state}`;
  res.json({ url });
});

// YouTube OAuth URL
app.get('/auth/youtube/url', (req, res) => {
  const localUser = req.query.user || 'guest';
  const intent = req.query.intent || null;
  let state = '';
  if (intent === 'register') state = 'register';
  else if (intent === 'link' && req.query.user) state = `link:${encodeURIComponent(req.query.user)}`;
  else state = encodeURIComponent(localUser);
  const redirect = `${BASE_URL}/auth/youtube/callback`;
  // request 'openid email profile' and YouTube scope if needed
  const scope = encodeURIComponent('openid email profile https://www.googleapis.com/auth/youtube.readonly');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${YOUTUBE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirect)}&scope=${scope}&access_type=offline&state=${state}&prompt=consent`;
  res.json({ url });
});

// YouTube/Google OAuth callback handler (shared for /auth/youtube/callback and /auth/google/callback)
async function handleYouTubeCallback(req, res) {
  const code = req.query.code;
  const state = req.query.state || 'guest';
  const callbackPath = req.path; // for logging
  if (!code) return res.status(400).send('Missing code');
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        redirect_uri: `${BASE_URL}${callbackPath}`,
        grant_type: 'authorization_code'
      })
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) return res.status(500).send('Failed to obtain access token: ' + JSON.stringify(tokenJson));

    // fetch userinfo
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { 'Authorization': `Bearer ${tokenJson.access_token}` } });
    const userJson = await userRes.json();
    const platform_userid = userJson && (userJson.email || userJson.id) ? (userJson.email || userJson.id) : 'unknown';

    // handle intents: register, link:<id>, or default local user
    let targetLocal = state;
    if (state === 'register') {
      const uname = (userJson && (userJson.email || userJson.id)) ? (userJson.email || userJson.id) : `yt_${Math.floor(Math.random()*10000)}`;
      const newUser = createUser(uname, userJson && userJson.email ? userJson.email : null, null);
      if (newUser && newUser.id) targetLocal = String(newUser.id);
    } else if (state && state.startsWith('link:')) {
      targetLocal = state.split(':')[1] || state;
    }

    db.run(`INSERT INTO accounts (local_user, platform, platform_userid, client_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?);`, [targetLocal, 'youtube', platform_userid, YOUTUBE_CLIENT_ID, tokenJson.access_token || null, tokenJson.refresh_token || null, tokenJson.expires_in ? (Math.floor(Date.now()/1000) + parseInt(tokenJson.expires_in,10)) : null]);
    persistDb();

    res.send(`<html><body><h3>Conexão YouTube/Google realizada com sucesso para usuário ${targetLocal}</h3><p>Feche esta aba e volte ao BROCKER.TV.</p></body></html>`);
  } catch (err) {
    console.error('YouTube/Google OAuth callback error', err);
    res.status(500).send('OAuth error');
  }
}

app.get('/auth/youtube/callback', handleYouTubeCallback);
app.get('/auth/google/callback', handleYouTubeCallback);

// Provide alias for Google OAuth URL endpoint (maps to YouTube flow)
app.get('/auth/google/url', (req, res) => {
  // build same URL as /auth/youtube/url but use /auth/google/callback as redirect
  const localUser = req.query.user || 'guest';
  const intent = req.query.intent || null;
  let state = '';
  if (intent === 'register') state = 'register';
  else if (intent === 'link' && req.query.user) state = `link:${encodeURIComponent(req.query.user)}`;
  else state = encodeURIComponent(localUser);
  const redirect = `${BASE_URL}/auth/google/callback`;
  const scope = encodeURIComponent('openid email profile https://www.googleapis.com/auth/youtube.readonly');
  const url = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${YOUTUBE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirect)}&scope=${scope}&access_type=offline&state=${state}&prompt=consent`;
  res.json({ url });
});

// Steam OpenID start (redirect URL)
app.get('/auth/steam/url', (req, res) => {
  const localUser = req.query.user || 'guest';
  const intent = req.query.intent || null;
  // include state in return_to
  let state = '';
  if (intent === 'register') state = 'register';
  else if (intent === 'link' && req.query.user) state = `link:${encodeURIComponent(req.query.user)}`;
  else state = encodeURIComponent(localUser);
  const redirect = `${BASE_URL}/auth/steam/callback`;
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': redirect + `?state=${state}`,
    'openid.realm': BASE_URL,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
  });
  const url = `https://steamcommunity.com/openid/login?${params.toString()}`;
  res.json({ url });
});

// Steam OpenID callback (simple parse of claimed_id)
app.get('/auth/steam/callback', (req, res) => {
  try {
    const claimed = req.query['openid.claimed_id'] || req.query['openid.claimedid'] || null;
    const state = req.query.state || 'guest';
    let steamId = null;
    if (claimed) {
      // claimed_id looks like https://steamcommunity.com/openid/id/76561197960287930
      const m = claimed.match(/openid\/id\/(\d+)$/);
      if (m) steamId = m[1];
    }
    // handle intents in state
    let targetLocal = state;
    if (state === 'register') {
      const newUser = createUser(`steam_${steamId || Math.floor(Math.random()*10000)}`, null, null);
      if (newUser && newUser.id) targetLocal = String(newUser.id);
    } else if (state && state.startsWith('link:')) {
      targetLocal = state.split(':')[1] || state;
    }
    db.run(`INSERT INTO accounts (local_user, platform, platform_userid, client_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?);`, [targetLocal, 'steam', steamId || 'unknown', '', null, null, null]);
    persistDb();
    res.send(`<html><body><h3>Conexão Steam realizada com sucesso para usuário ${targetLocal}</h3><p>SteamID: ${steamId || 'unknown'}. Feche esta aba e volte ao BROCKER.TV.</p></body></html>`);
  } catch (err) {
    console.error('Steam callback parse error', err);
    res.status(500).send('Steam connect error');
  }
});

// OAuth callback - exchange code for tokens and store.
app.get('/auth/twitch/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state || 'guest';
  if (!code) return res.status(400).send('Missing code');
  try {
    const tokenUrl = `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&code=${encodeURIComponent(code)}&grant_type=authorization_code&redirect_uri=${encodeURIComponent(BASE_URL + '/auth/twitch/callback')}`;
    const tokenRes = await fetch(tokenUrl, { method: 'POST' });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) return res.status(500).send('Failed to obtain access token: ' + JSON.stringify(tokenJson));

    // Get user info from Helix
    const userRes = await fetch('https://api.twitch.tv/helix/users', {
      headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Authorization': `Bearer ${tokenJson.access_token}` }
    });
    const userJson = await userRes.json();
    const user = (userJson && userJson.data && userJson.data[0]) ? userJson.data[0] : null;
    const platform_userid = user ? (user.login || user.id) : 'unknown';

    // handle intents: register, link:<id>, or default local user
    let targetLocal = state;
    if (state === 'register') {
      // create a new user with the twitch login as username (best-effort)
      const uname = platform_userid || `twitch_${Math.floor(Math.random()*10000)}`;
      const user = createUser(uname, null, null);
      if (user && user.id) targetLocal = String(user.id);
    } else if (state && state.startsWith('link:')) {
      targetLocal = state.split(':')[1] || state;
    }

    db.run(`INSERT INTO accounts (local_user, platform, platform_userid, client_id, access_token, refresh_token, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?);`, [targetLocal, 'twitch', platform_userid, TWITCH_CLIENT_ID, tokenJson.access_token || null, tokenJson.refresh_token || null, tokenJson.expires_in ? (Math.floor(Date.now()/1000) + parseInt(tokenJson.expires_in,10)) : null]);
    persistDb();

    res.send(`<html><body><h3>Conexão Twitch realizada com sucesso para usuário ${targetLocal}</h3><p>Feche esta aba e volte ao BROCKER.TV.</p></body></html>`);
  } catch (err) {
    console.error('OAuth callback error', err);
    res.status(500).send('OAuth error');
  }
});

// return accounts for a local user
app.get('/api/user/:localUser/accounts', (req, res) => {
  try {
    const localUser = req.params.localUser;
    const rows = dbAll('SELECT id, platform, platform_userid, client_id, created_at FROM accounts WHERE local_user = ?;', [localUser]);
    res.json({ accounts: rows });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// delete account for local user (by platform)
app.delete('/api/user/:localUser/accounts/:platform', (req, res) => {
  try {
    const { localUser, platform } = req.params;
    db.run('DELETE FROM accounts WHERE local_user = ? AND platform = ?;', [localUser, platform]);
    persistDb();
    res.json({ deleted: 1 });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// In-memory pollers for sessions: { sessionId: { intervalId, localUser, platform, platform_userid } }
const sessionPollers = {};

// Start a stream session: begins polling viewer counts every 15s and stores metrics
app.post('/api/stream/start', async (req, res) => {
  const { localUser, platform } = req.body || {};
  if (!localUser || !platform) return res.status(400).json({ error: 'localUser and platform required' });
  try {
    const started_at = Math.floor(Date.now()/1000);
    db.run('INSERT INTO sessions (local_user, platform, started_at) VALUES (?, ?, ?);', [localUser, platform, started_at]);
    const idRow = dbAll('SELECT last_insert_rowid() as id;')[0];
    const sessionId = idRow ? idRow.id : null;

    // find account for platform
    const acc = dbGet('SELECT * FROM accounts WHERE local_user = ? AND platform = ? LIMIT 1;', [localUser, platform]);
    if (!acc) {
      // still return session id but no polling
      return res.json({ sessionId, warning: 'No account found for platform; polling not started' });
    }

    // polling function (supports Twitch and YouTube)
    const poll = async () => {
      try {
        // re-fetch account each poll to get fresh tokens if updated
        let a = dbGet('SELECT * FROM accounts WHERE local_user = ? AND platform = ? LIMIT 1;', [localUser, platform]);
        if (!a) return;
        // try to ensure token is valid (may refresh)
        try { a = await ensureAccessToken(a); } catch (e) { /* ignore */ }

        if (platform === 'twitch') {
          const userId = a.platform_userid;
          const url = `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(userId)}`;
          const r = await fetch(url, { headers: { 'Client-ID': a.client_id || TWITCH_CLIENT_ID, 'Authorization': `Bearer ${a.access_token}` } });
          const j = await r.json();
          let viewers = 0;
          if (j && j.data && j.data.length) viewers = j.data[0].viewer_count || 0;
          const ts = Math.floor(Date.now()/1000);
          db.run('INSERT INTO metrics (session_id, ts, viewer_count) VALUES (?, ?, ?);', [sessionId, ts, viewers]);
          const cur = dbGet('SELECT peak_viewers FROM sessions WHERE id = ?;', [sessionId]);
          const curPeak = cur ? (cur.peak_viewers || 0) : 0;
          if (viewers > curPeak) db.run('UPDATE sessions SET peak_viewers = ? WHERE id = ?;', [viewers, sessionId]);
          persistDb();
        } else if (platform === 'youtube') {
          // try to find a live broadcast for the channel (platform_userid should be channel id)
          const channelId = a.platform_userid;
          if (channelId && a.access_token) {
            try {
              const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video`;
              const sr = await fetch(searchUrl, { headers: { 'Authorization': `Bearer ${a.access_token}` } });
              const sj = await sr.json();
              let viewers = 0;
              if (sj && sj.items && sj.items.length) {
                const vid = sj.items[0].id.videoId;
                if (vid) {
                  const vinfo = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(vid)}`, { headers: { 'Authorization': `Bearer ${a.access_token}` } });
                  const vj = await vinfo.json();
                  if (vj && vj.items && vj.items.length && vj.items[0].liveStreamingDetails) {
                    viewers = parseInt(vj.items[0].liveStreamingDetails.concurrentViewers || 0, 10) || 0;
                  }
                }
              }
              const ts = Math.floor(Date.now()/1000);
              db.run('INSERT INTO metrics (session_id, ts, viewer_count) VALUES (?, ?, ?);', [sessionId, ts, viewers]);
              const cur = dbGet('SELECT peak_viewers FROM sessions WHERE id = ?;', [sessionId]);
              const curPeak = cur ? (cur.peak_viewers || 0) : 0;
              if (viewers > curPeak) db.run('UPDATE sessions SET peak_viewers = ? WHERE id = ?;', [viewers, sessionId]);
              persistDb();
            } catch (e) { console.warn('youtube poll error', e); }
          }
        }
      } catch (e) { console.warn('poll error', e); }
    };

    // start immediate poll and interval
    await poll();
    const intervalId = setInterval(poll, 15000);
    sessionPollers[sessionId] = { intervalId, localUser, platform };

    res.json({ sessionId, polling: true });
  } catch (err) { console.error('start session error', err); res.status(500).json({ error: String(err) }); }
});

// Stop a session: stops polling, computes summary (peak, avg) and returns it
app.post('/api/stream/stop', async (req, res) => {
  const { localUser, sessionId } = req.body || {};
  if (!localUser || !sessionId) return res.status(400).json({ error: 'localUser and sessionId required' });
  try {
    // stop poller
    const poller = sessionPollers[sessionId];
    if (poller) { clearInterval(poller.intervalId); delete sessionPollers[sessionId]; }

    const stopped_at = Math.floor(Date.now()/1000);
    // compute metrics
    const rows = dbAll('SELECT viewer_count FROM metrics WHERE session_id = ?;', [sessionId]);
    const counts = rows.map(r => r.viewer_count || 0);
    const peak = counts.length ? Math.max(...counts) : 0;
    const avg = counts.length ? Math.round((counts.reduce((a,b)=>a+b,0)/counts.length) * 100) / 100 : 0;

    db.run('UPDATE sessions SET stopped_at = ?, peak_viewers = ?, avg_viewers = ? WHERE id = ?;', [stopped_at, peak, avg, sessionId]);
    persistDb();

    // attempt to fetch final VOD views for Twitch (optional)
    const sess = dbGet('SELECT * FROM sessions WHERE id = ?;', [sessionId]);
    let finalViews = null;
    if (sess && sess.platform === 'twitch') {
      const acc = dbGet('SELECT * FROM accounts WHERE local_user = ? AND platform = ? LIMIT 1;', [localUser, 'twitch']);
      if (acc) {
        try {
          // fetch channel info for total views
          const userInfoRes = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(acc.platform_userid)}`, { headers: { 'Client-ID': acc.client_id || TWITCH_CLIENT_ID, 'Authorization': `Bearer ${acc.access_token}` } });
          const userInfo = await userInfoRes.json();
          const user = userInfo && userInfo.data && userInfo.data[0] ? userInfo.data[0] : null;
          finalViews = user ? user.view_count || null : null;
        } catch (e) { console.warn('failed to fetch final views', e); }
      }
    }

    const summary = { sessionId, peak, avg, finalViews };
    res.json({ summary });
  } catch (err) { console.error('stop session error', err); res.status(500).json({ error: String(err) }); }
});

// (duplicate minimal stream stop stub removed — detailed handler exists above)

// --- SQL.js initialization and helpers ---
function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function dbGet(sql, params = []) {
  const rows = dbAll(sql, params);
  return rows.length ? rows[0] : null;
}

function persistDb() {
  try {
    const data = db.export();
    fs.writeFileSync(dbFile, Buffer.from(data));
  } catch (e) { console.warn('persistDb error', e); }
}

async function init() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();
  if (fs.existsSync(dbFile)) {
    const filebuffer = fs.readFileSync(dbFile);
    db = new SQL.Database(new Uint8Array(filebuffer));
  } else {
    db = new SQL.Database();
  }

  // Init schema if necessary
  const schema = `
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_user TEXT,
    platform TEXT,
    platform_userid TEXT,
    client_id TEXT,
    access_token TEXT,
    refresh_token TEXT,
    expires_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT,
    password_salt TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_accounts_local ON accounts(local_user);
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    local_user TEXT,
    platform TEXT,
    started_at INTEGER,
    stopped_at INTEGER,
    peak_viewers INTEGER DEFAULT 0,
    avg_viewers REAL DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    ts INTEGER,
    viewer_count INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_metrics_session ON metrics(session_id);
  CREATE TABLE IF NOT EXISTS states (
    local_user TEXT PRIMARY KEY,
    state_json TEXT
  );
`;
  db.exec(schema);
  persistDb();

  app.listen(PORT, () => console.log(`BROCKER.TV backend listening on ${PORT}, BASE_URL=${BASE_URL}`));
}

init().catch(err => { console.error('Failed to initialize DB', err); process.exit(1); });

// --- Token refresh helpers ---
async function refreshTwitchToken(acc) {
  if (!acc || !acc.refresh_token) return acc;
  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: acc.refresh_token,
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET
    });
    const r = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: params });
    const j = await r.json();
    if (j && j.access_token) {
      const expires_at = j.expires_in ? Math.floor(Date.now()/1000) + parseInt(j.expires_in,10) : null;
      db.run('UPDATE accounts SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = ?;', [j.access_token, j.refresh_token || acc.refresh_token, expires_at, acc.id]);
      persistDb();
      acc.access_token = j.access_token;
      acc.refresh_token = j.refresh_token || acc.refresh_token;
      acc.expires_at = expires_at;
    }
  } catch (e) { console.warn('refreshTwitchToken failed', e); }
  return acc;
}

async function refreshYouTubeToken(acc) {
  if (!acc || !acc.refresh_token) return acc;
  try {
    const params = new URLSearchParams({
      client_id: YOUTUBE_CLIENT_ID,
      client_secret: YOUTUBE_CLIENT_SECRET,
      refresh_token: acc.refresh_token,
      grant_type: 'refresh_token'
    });
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type':'application/x-www-form-urlencoded' }, body: params });
    const j = await r.json();
    if (j && j.access_token) {
      const expires_at = j.expires_in ? Math.floor(Date.now()/1000) + parseInt(j.expires_in,10) : null;
      db.run('UPDATE accounts SET access_token = ?, expires_at = ? WHERE id = ?;', [j.access_token, expires_at, acc.id]);
      persistDb();
      acc.access_token = j.access_token;
      acc.expires_at = expires_at;
    }
  } catch (e) { console.warn('refreshYouTubeToken failed', e); }
  return acc;
}

async function ensureAccessToken(acc) {
  if (!acc) return acc;
  const now = Math.floor(Date.now()/1000);
  if (acc.expires_at && acc.expires_at > now + 30) return acc; // still valid
  try {
    if (acc.platform === 'twitch') return await refreshTwitchToken(acc);
    if (acc.platform === 'youtube') return await refreshYouTubeToken(acc);
  } catch (e) { console.warn('ensureAccessToken failed', e); }
  return acc;
}

// --- User state endpoints (XP, level etc.) ---
app.get('/api/user/:localUser/state', (req, res) => {
  try {
    const localUser = req.params.localUser;
    const row = dbGet('SELECT state_json FROM states WHERE local_user = ?;', [localUser]);
    if (!row || !row.state_json) return res.json({ state: null });
    let state = null;
    try { state = JSON.parse(row.state_json); } catch (e) { state = null; }
    res.json({ state });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/user/:localUser/state', (req, res) => {
  try {
    const localUser = req.params.localUser;
    const state = req.body || {};
    const sjson = JSON.stringify(state);
    // upsert
    const exists = dbGet('SELECT 1 as v FROM states WHERE local_user = ?;', [localUser]);
    if (exists) db.run('UPDATE states SET state_json = ? WHERE local_user = ?;', [sjson, localUser]);
    else db.run('INSERT INTO states (local_user, state_json) VALUES (?, ?);', [localUser, sjson]);
    persistDb();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// --- Simple user helpers (local accounts) ---
const crypto = require('crypto');

function makePasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!password || !salt || !hash) return false;
  const h = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return h === hash;
}

function createUser(username, email, password) {
  try {
    let password_hash = null, password_salt = null;
    if (password) {
      const p = makePasswordHash(password);
      password_hash = p.hash; password_salt = p.salt;
    }
    db.run('INSERT INTO users (username, email, password_hash, password_salt) VALUES (?, ?, ?, ?);', [username, email || null, password_hash, password_salt]);
    persistDb();
    const r = dbGet('SELECT id, username, email, created_at FROM users WHERE username = ? LIMIT 1;', [username]);
    return r;
  } catch (e) { console.warn('createUser failed', e); return null; }
}

app.post('/api/users', (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!username) return res.status(400).json({ error: 'username required' });
    const exists = dbGet('SELECT 1 as v FROM users WHERE username = ? OR email = ?;', [username, email]);
    if (exists) return res.status(409).json({ error: 'User already exists' });
    const user = createUser(username, email, password);
    if (!user) return res.status(500).json({ error: 'Failed to create user' });
    // create JWT and set cookie
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('brocker_token', token, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 7 * 24 * 3600 * 1000 });
    res.json({ user, token: token });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/users/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const u = dbGet('SELECT * FROM users WHERE username = ? LIMIT 1;', [username]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (!verifyPassword(password, u.password_salt, u.password_hash)) return res.status(401).json({ error: 'Invalid password' });
    // create JWT and set cookie
    const token = jwt.sign({ id: u.id, username: u.username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('brocker_token', token, { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 7 * 24 * 3600 * 1000 });
    res.json({ user: { id: u.id, username: u.username, email: u.email }, token });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// logout: clear cookie
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('brocker_token');
  res.json({ ok: true });
});

// auth middleware
function authMiddleware(req, res, next) {
  try {
    let token = null;
    // try cookie
    if (req.cookies && req.cookies.brocker_token) token = req.cookies.brocker_token;
    // try Authorization header
    if (!token && req.headers && req.headers.authorization) {
      const m = String(req.headers.authorization).match(/^Bearer\s+(.*)$/i);
      if (m) token = m[1];
    }
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) { return res.status(401).json({ error: 'Invalid token' }); }
}

// current user endpoint
app.get('/api/me', (req, res) => {
  try {
    let token = null;
    if (req.cookies && req.cookies.brocker_token) token = req.cookies.brocker_token;
    if (!token && req.headers && req.headers.authorization) {
      const m = String(req.headers.authorization).match(/^Bearer\s+(.*)$/i);
      if (m) token = m[1];
    }
    if (!token) return res.status(204).end();
    const payload = jwt.verify(token, JWT_SECRET);
    const u = dbGet('SELECT id, username, email, created_at FROM users WHERE id = ? LIMIT 1;', [payload.id]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    res.json({ user: u });
  } catch (e) { res.status(401).json({ error: 'Invalid token' }); }
});

app.get('/api/users/:id', (req, res) => {
  try {
    const id = req.params.id;
    const u = dbGet('SELECT id, username, email, created_at FROM users WHERE id = ? LIMIT 1;', [id]);
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.json({ user: u });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});
