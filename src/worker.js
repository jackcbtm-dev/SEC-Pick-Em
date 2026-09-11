// SEC ATS Pick'em -- backend API.
//
// Replaces the old "self-publishing Claude artifact" model: state now lives
// in a D1 database instead of a republished HTML document, and PIN checks
// happen server-side (issuing a signed session token) instead of purely in
// the browser. Everything else -- the whole rendering layer, the game
// model, the historical-stats baseline -- carries over unchanged in
// public/app.js.
//
// Auth model: a player or the commissioner proves their PIN once against
// /api/player/:name/pin/verify or /api/commissioner/pin/verify and gets back
// a signed, expiring token (HMAC-SHA256, stateless -- no session table).
// That token travels with every subsequent write and is checked here before
// anything is saved.

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 180; // 180 days -- a casual friend pool, not a bank.

function jsonResponse(data, init) {
  return new Response(JSON.stringify(data), Object.assign({
    headers: { 'content-type': 'application/json' }
  }, init || {}));
}

function errorResponse(message, status) {
  return jsonResponse({ error: message }, { status: status || 400 });
}

function b64urlEncode(bytes) {
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  var bin = atob(str);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function utf8Bytes(str) { return new TextEncoder().encode(str); }

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', utf8Bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signToken(payload, secret) {
  const key = await hmacKey(secret);
  const body = b64urlEncode(utf8Bytes(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', key, utf8Bytes(body));
  return body + '.' + b64urlEncode(new Uint8Array(sig));
}

async function verifyToken(token, secret) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const key = await hmacKey(secret);
  let sigBytes;
  try { sigBytes = b64urlDecode(sig); } catch (e) { return null; }
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, utf8Bytes(body));
  if (!ok) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))); } catch (e) { return null; }
  if (!payload || typeof payload.exp !== 'number' || Date.now() / 1000 > payload.exp) return null;
  return payload;
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', utf8Bytes(str));
  return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
}

function pinHash(scope, pin, secret) {
  return sha256Hex('secpickem-v1:' + secret + ':' + scope + ':' + pin);
}

async function getState(env) {
  const row = await env.DB.prepare('SELECT json FROM state WHERE id = 1').first();
  if (!row) throw new Error('State not initialized -- run the seed script.');
  return JSON.parse(row.json);
}

async function saveState(env, state) {
  const json = JSON.stringify(state);
  await env.DB.prepare('INSERT INTO state (id, json, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at')
    .bind(json, state.updatedAt).run();
}

function cloneStateWith(state, patch, lastEditor) {
  const next = Object.assign({}, state, patch);
  next.updatedAt = new Date().toISOString();
  next.lastEditor = lastEditor || state.lastEditor;
  return next;
}

// Mirrors the client's weekOptions()/getViewedWeek() -- resolves a weekKey
// ('current' | 'history:<idx>' | 'upcoming:<idx>') to that week's games/
// picks/locks/winners, wherever it actually lives in the state blob.
function getViewedWeek(state, weekKey) {
  if (!weekKey || weekKey === 'current') {
    return { kind: 'current', idx: null, games: state.games, winners: state.winners, picks: state.picks, locks: state.locks };
  }
  const parts = String(weekKey).split(':');
  const kind = parts[0], idx = parseInt(parts[1], 10);
  if (kind === 'history' && state.history[idx]) {
    const h = state.history[idx];
    return { kind: 'history', idx: idx, games: h.games, winners: h.winners, picks: h.picks, locks: h.locks };
  }
  if (kind === 'upcoming' && state.upcoming && state.upcoming[idx]) {
    const u = state.upcoming[idx];
    return { kind: 'upcoming', idx: idx, games: u.games, winners: null, picks: null, locks: null };
  }
  return { kind: 'current', idx: null, games: state.games, winners: state.winners, picks: state.picks, locks: state.locks };
}

async function readJson(request) {
  try { return await request.json(); } catch (e) { return {}; }
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  const secret = env.AUTH_SECRET;

  if (path === '/api/state' && method === 'GET') {
    const state = await getState(env);
    return jsonResponse(state);
  }

  // ---- Player PIN set / verify ----
  const playerPinSet = path.match(/^\/api\/player\/([^/]+)\/pin\/set$/);
  if (playerPinSet && method === 'POST') {
    const player = decodeURIComponent(playerPinSet[1]);
    const body = await readJson(request);
    const state = await getState(env);
    if (state.players.indexOf(player) === -1) return errorResponse('Unknown player.', 404);
    if (state.pins[player]) return errorResponse('PIN already set -- ask the commissioner to reset it.', 409);
    const pin = String(body.pin || '').trim();
    const confirm = String(body.confirmPin || '').trim();
    if (pin.length < 4) return errorResponse('PIN needs at least 4 characters.', 422);
    if (pin !== confirm) return errorResponse("PINs don't match.", 422);
    const hash = await pinHash(player, pin, secret);
    const nextPins = Object.assign({}, state.pins, { [player]: hash });
    await saveState(env, cloneStateWith(state, { pins: nextPins }, player));
    const token = await signToken({ sub: player, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }, secret);
    return jsonResponse({ ok: true, token: token });
  }

  const playerPinVerify = path.match(/^\/api\/player\/([^/]+)\/pin\/verify$/);
  if (playerPinVerify && method === 'POST') {
    const player = decodeURIComponent(playerPinVerify[1]);
    const body = await readJson(request);
    const state = await getState(env);
    if (state.players.indexOf(player) === -1) return errorResponse('Unknown player.', 404);
    if (!state.pins[player]) return errorResponse('No PIN set yet for this player.', 409);
    const hash = await pinHash(player, String(body.pin || '').trim(), secret);
    if (hash !== state.pins[player]) return errorResponse('Wrong PIN.', 401);
    const token = await signToken({ sub: player, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }, secret);
    return jsonResponse({ ok: true, token: token });
  }

  // ---- Player picks ----
  if (path === '/api/picks' && method === 'POST') {
    const body = await readJson(request);
    const payload = await verifyToken(body.token, secret);
    if (!payload || !payload.sub) return errorResponse('Not signed in -- enter your PIN again.', 401);
    const state = await getState(env);
    const player = payload.sub;
    if (state.players.indexOf(player) === -1) return errorResponse('Unknown player.', 404);
    const len = state.games.length;
    if (!Array.isArray(body.picks) || body.picks.length !== len) return errorResponse('Picks do not match the current game list -- reload and try again.', 422);
    const valid = body.picks.every(function (p, i) {
      if (p === null) return true;
      const g = state.games[i];
      return p === g.teamA || p === g.teamB;
    });
    if (!valid) return errorResponse('Invalid pick value.', 422);
    let lock = (body.lock === null || body.lock === undefined) ? null : Number(body.lock);
    if (lock !== null && (!Number.isInteger(lock) || lock < 0 || lock >= len || !body.picks[lock])) lock = null;
    const nextPicks = Object.assign({}, state.picks, { [player]: body.picks });
    const nextLocks = Object.assign({}, state.locks, { [player]: lock });
    await saveState(env, cloneStateWith(state, { picks: nextPicks, locks: nextLocks }, player));
    return jsonResponse({ ok: true });
  }

  // ---- Commissioner PIN set / verify ----
  if (path === '/api/commissioner/pin/set' && method === 'POST') {
    const body = await readJson(request);
    const state = await getState(env);
    if (state.commissionerPinHash) return errorResponse('Commissioner PIN already claimed.', 409);
    const pin = String(body.pin || '').trim();
    const confirm = String(body.confirmPin || '').trim();
    if (pin.length < 4) return errorResponse('PIN needs at least 4 characters.', 422);
    if (pin !== confirm) return errorResponse("PINs don't match.", 422);
    const hash = await pinHash('commissioner', pin, secret);
    await saveState(env, cloneStateWith(state, { commissionerPinHash: hash }, 'Commissioner'));
    const token = await signToken({ sub: 'commissioner', exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }, secret);
    return jsonResponse({ ok: true, token: token });
  }

  if (path === '/api/commissioner/pin/verify' && method === 'POST') {
    const body = await readJson(request);
    const state = await getState(env);
    if (!state.commissionerPinHash) return errorResponse('No commissioner PIN set yet.', 409);
    const hash = await pinHash('commissioner', String(body.pin || '').trim(), secret);
    if (hash !== state.commissionerPinHash) return errorResponse('Wrong PIN.', 401);
    const token = await signToken({ sub: 'commissioner', exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }, secret);
    return jsonResponse({ ok: true, token: token });
  }

  // Every route from here down is commissioner-only.
  if (path.indexOf('/api/commissioner/') === 0) {
    const body = await readJson(request);
    const payload = await verifyToken(body.token, secret);
    if (!payload || payload.sub !== 'commissioner') return errorResponse('Not signed in as commissioner.', 401);
    const state = await getState(env);

    if (path === '/api/commissioner/reset-pin' && method === 'POST') {
      const player = body.player;
      if (state.players.indexOf(player) === -1) return errorResponse('Unknown player.', 404);
      const nextPins = Object.assign({}, state.pins, { [player]: null });
      await saveState(env, cloneStateWith(state, { pins: nextPins }, 'Commissioner'));
      return jsonResponse({ ok: true });
    }

    if (path === '/api/commissioner/games' && method === 'POST') {
      const viewed = getViewedWeek(state, body.weekKey);
      const cleaned = (body.games || [])
        .filter(function (g) { return (g.teamA || '').trim() && (g.teamB || '').trim(); })
        .map(function (g) { return { matchup: (g.matchup || '').trim(), teamA: g.teamA.trim(), teamB: g.teamB.trim(), spread: (g.spread || '').trim() }; });
      const len = cleaned.length;

      if (viewed.kind === 'upcoming') {
        const nextUpcoming = state.upcoming.map(function (w, i) { return i === viewed.idx ? { label: w.label, games: cleaned } : w; });
        await saveState(env, cloneStateWith(state, { upcoming: nextUpcoming }, 'Commissioner'));
        return jsonResponse({ ok: true });
      }

      const nextPicks = {};
      state.players.forEach(function (name) {
        const old = (viewed.picks && viewed.picks[name]) || [];
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(old[i] || null);
        nextPicks[name] = arr;
      });
      const nextLocks = {};
      state.players.forEach(function (name) {
        const l = viewed.locks ? viewed.locks[name] : null;
        nextLocks[name] = (l !== null && l !== undefined && l < len) ? l : null;
      });
      const nextWinners = [];
      for (let j = 0; j < len; j++) nextWinners.push((viewed.winners && viewed.winners[j]) || null);

      if (viewed.kind === 'current') {
        await saveState(env, cloneStateWith(state, { games: cleaned, picks: nextPicks, locks: nextLocks, winners: nextWinners }, 'Commissioner'));
      } else { // history
        const nextHistory = state.history.map(function (w, i) {
          return i !== viewed.idx ? w : { week: w.week, games: cleaned, picks: nextPicks, locks: nextLocks, winners: nextWinners };
        });
        await saveState(env, cloneStateWith(state, { history: nextHistory }, 'Commissioner'));
      }
      return jsonResponse({ ok: true });
    }

    if (path === '/api/commissioner/results' && method === 'POST') {
      const viewed = getViewedWeek(state, body.weekKey);
      const winners = Array.isArray(body.winners) ? body.winners.slice(0, viewed.games.length) : [];
      while (winners.length < viewed.games.length) winners.push(null);

      if (viewed.kind === 'upcoming') return errorResponse("This week hasn't been played yet.", 422);

      if (viewed.kind === 'history') {
        const nextHistory = state.history.map(function (w, i) {
          return i !== viewed.idx ? w : { week: w.week, games: w.games, picks: w.picks, locks: w.locks, winners: winners };
        });
        await saveState(env, cloneStateWith(state, { history: nextHistory }, 'Commissioner'));
        return jsonResponse({ ok: true, advanced: false });
      }

      // Current week -- auto-advance into a queued week if every game just graded.
      const allGraded = state.games.length > 0 && winners.slice(0, state.games.length).every(Boolean);
      const queued = state.upcoming && state.upcoming.length ? state.upcoming[0] : null;

      if (allGraded && queued) {
        const archived = { week: state.week, games: state.games, picks: state.picks, locks: state.locks, winners: winners };
        const nextHistory = state.history.concat([archived]);
        const nextGames = queued.games.map(function (g) { return { matchup: g.matchup, teamA: g.teamA, teamB: g.teamB, spread: g.spread || '' }; });
        const nextUpcoming = state.upcoming.slice(1);
        const emptyPicks = {}, emptyLocks = {};
        state.players.forEach(function (name) {
          emptyPicks[name] = nextGames.map(function () { return null; });
          emptyLocks[name] = null;
        });
        await saveState(env, cloneStateWith(state, {
          week: queued.label, games: nextGames, picks: emptyPicks, locks: emptyLocks,
          winners: nextGames.map(function () { return null; }), history: nextHistory, upcoming: nextUpcoming
        }, 'Commissioner'));
        return jsonResponse({ ok: true, advanced: true, archivedWeek: state.week, newWeek: queued.label });
      }

      await saveState(env, cloneStateWith(state, { winners: winners }, 'Commissioner'));
      return jsonResponse({ ok: true, advanced: false, allGraded: allGraded });
    }

    if (path === '/api/commissioner/new-week' && method === 'POST') {
      const queued = state.upcoming && state.upcoming.length ? state.upcoming[0] : null;
      let label, nextGames, nextUpcoming;
      if (body.useQueued && queued) {
        label = queued.label;
        nextGames = queued.games.map(function (g) { return { matchup: g.matchup, teamA: g.teamA, teamB: g.teamB, spread: g.spread || '' }; });
        nextUpcoming = state.upcoming.slice(1);
      } else {
        label = String(body.label || '').trim();
        if (!label) return errorResponse('Week label is required.', 422);
        nextGames = [];
        nextUpcoming = state.upcoming || [];
      }
      const archived = { week: state.week, games: state.games, picks: state.picks, locks: state.locks, winners: state.winners };
      const nextHistory = state.history.concat([archived]);
      const emptyPicks = {}, emptyLocks = {};
      state.players.forEach(function (name) {
        emptyPicks[name] = nextGames.map(function () { return null; });
        emptyLocks[name] = null;
      });
      await saveState(env, cloneStateWith(state, {
        week: label, games: nextGames, picks: emptyPicks, locks: emptyLocks,
        winners: nextGames.map(function () { return null; }), history: nextHistory, upcoming: nextUpcoming
      }, 'Commissioner'));
      return jsonResponse({ ok: true, week: label });
    }
  }

  return errorResponse('Not found.', 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.indexOf('/api/') === 0) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return errorResponse((err && err.message) || 'Server error.', 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
