(function () {
  "use strict";

  // ---- API + auth helpers -------------------------------------------------
  var API_BASE = '';

  function apiFetch(path, opts) {
    return fetch(API_BASE + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) { var e = new Error(body.error || ('Request failed (' + res.status + ')')); e.status = res.status; throw e; }
        return body;
      });
    });
  }
  function apiGet(path) { return apiFetch(path, { method: 'GET' }); }
  function apiPost(path, data) {
    return apiFetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data || {}) });
  }

  function getToken(sub) {
    try { return localStorage.getItem('secpickem_token_' + sub); } catch (e) { return null; }
  }
  function setToken(sub, token) {
    try { localStorage.setItem('secpickem_token_' + sub, token); } catch (e) {}
  }
  function clearToken(sub) {
    try { localStorage.removeItem('secpickem_token_' + sub); } catch (e) {}
  }

  var STATE = null;
  var PLAYERS = [];
  var currentPlayer = null;
  var draft = null;
  var draftLock = null;
  var draftWinners = [];
  var draftGames = null; // populated when games editor opens
  var editingGames = false;
  var pickerErr = '';
  var commErr = '';
  var commWeekKey = 'current'; // 'current' | 'history:<idx>' | 'upcoming:<idx>' — which week Commissioner is viewing

  var TABS = ['standings', 'picks', 'board', 'stats', 'commissioner', 'more'];
  var currentTab = 'standings';
  try {
    var storedTab = localStorage.getItem('secats_tab');
    if (storedTab && TABS.indexOf(storedTab) !== -1) currentTab = storedTab;
  } catch (e) {}

  var capState = 'loading'; // loading | ready | error

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // School color/abbreviation lookup, keyed by every label spelling that shows
  // up in the season sheet (a school can appear as "Bama", "Alabama", etc.).
  // Real logo artwork can't be used here — a published page can't load images
  // from outside a small CDN allowlist, and team marks are trademarked — so
  // "logo" means a colored monogram badge in the school's real colors instead
  // of the actual crest.
  var TEAM_COLORS = {
    'Alabama': { primary: '#9E1B32', secondary: '#FFFFFF', abbr: 'BAMA' },
    'Bama': { primary: '#9E1B32', secondary: '#FFFFFF', abbr: 'BAMA' },
    'Arkansas': { primary: '#9D2235', secondary: '#FFFFFF', abbr: 'ARK' },
    'Arky': { primary: '#9D2235', secondary: '#FFFFFF', abbr: 'ARK' },
    'Auburn': { primary: '#0C2340', secondary: '#E87722', abbr: 'AUB' },
    'Florida': { primary: '#0021A5', secondary: '#FA4616', abbr: 'UF' },
    'UF': { primary: '#0021A5', secondary: '#FA4616', abbr: 'UF' },
    'Georgia': { primary: '#BA0C2F', secondary: '#000000', abbr: 'UGA' },
    'UGA': { primary: '#BA0C2F', secondary: '#000000', abbr: 'UGA' },
    'Kentucky': { primary: '#0033A0', secondary: '#FFFFFF', abbr: 'UK' },
    'UK': { primary: '#0033A0', secondary: '#FFFFFF', abbr: 'UK' },
    'LSU': { primary: '#461D7C', secondary: '#FDD023', abbr: 'LSU' },
    'Miss State': { primary: '#660000', secondary: '#FFFFFF', abbr: 'MSU' },
    'MSU': { primary: '#660000', secondary: '#FFFFFF', abbr: 'MSU' },
    'Mizzou': { primary: '#F1B82D', secondary: '#000000', abbr: 'MIZ' },
    'Oklahoma': { primary: '#841617', secondary: '#FDF9D8', abbr: 'OU' },
    'OU': { primary: '#841617', secondary: '#FDF9D8', abbr: 'OU' },
    'Ole Miss': { primary: '#14213D', secondary: '#CE1126', abbr: 'MISS' },
    'SCAR': { primary: '#73000A', secondary: '#000000', abbr: 'SCAR' },
    'S. Carolina': { primary: '#73000A', secondary: '#000000', abbr: 'SCAR' },
    'Tennessee': { primary: '#FF8200', secondary: '#FFFFFF', abbr: 'UT' },
    'Tenn': { primary: '#FF8200', secondary: '#FFFFFF', abbr: 'UT' },
    'TENN': { primary: '#FF8200', secondary: '#FFFFFF', abbr: 'UT' },
    'Texas': { primary: '#BF5700', secondary: '#FFFFFF', abbr: 'TEX' },
    'TX': { primary: '#BF5700', secondary: '#FFFFFF', abbr: 'TEX' },
    'TEX': { primary: '#BF5700', secondary: '#FFFFFF', abbr: 'TEX' },
    'Texas A&M': { primary: '#500000', secondary: '#FFFFFF', abbr: 'TAMU' },
    'TAMU': { primary: '#500000', secondary: '#FFFFFF', abbr: 'TAMU' },
    'Vandy': { primary: '#866D4B', secondary: '#000000', abbr: 'VANDY' },
    'Vanderbilt': { primary: '#866D4B', secondary: '#000000', abbr: 'VANDY' },
    'Kansas': { primary: '#0051BA', secondary: '#E8000D', abbr: 'KU' },
    'Campbell': { primary: '#FF6600', secondary: '#000000', abbr: 'CAM' },
    'Arizona St': { primary: '#8C1D40', secondary: '#FFC627', abbr: 'ASU' },
    'Michigan': { primary: '#00274C', secondary: '#FFCB05', abbr: 'MICH' },
    'W. Kentucky': { primary: '#C8102E', secondary: '#FFFFFF', abbr: 'WKU' },
    'Minnesota': { primary: '#7A0019', secondary: '#FFCC33', abbr: 'MINN' },
    'Delaware': { primary: '#00539F', secondary: '#FFD200', abbr: 'DEL' },
    'GA Tech': { primary: '#B3A369', secondary: '#003057', abbr: 'GT' },
    'GT': { primary: '#B3A369', secondary: '#003057', abbr: 'GT' },
    'Towson': { primary: '#FFB81C', secondary: '#000000', abbr: 'TOW' },
    'LA Tech': { primary: '#002F8B', secondary: '#C41230', abbr: 'LAT' },
    'Charlotte': { primary: '#005035', secondary: '#A49665', abbr: 'CLT' },
    'Southern Miss': { primary: '#FFAB00', secondary: '#000000', abbr: 'USM' },
    'S. Miss': { primary: '#FFAB00', secondary: '#000000', abbr: 'USM' },
    'Utah': { primary: '#CC0000', secondary: '#000000', abbr: 'UTAH' },
    'FSU': { primary: '#782F40', secondary: '#CEB888', abbr: 'FSU' },
    'NC St': { primary: '#CC0000', secondary: '#000000', abbr: 'NCST' },
    'Troy': { primary: '#8A2432', secondary: '#FFFFFF', abbr: 'TROY' },
    'NMU': { primary: '#026937', secondary: '#FFFC00', abbr: 'NMU' },
    "Kenn St.": { primary: '#FFC629', secondary: '#231F20', abbr: 'KENN' },
    'UTSA': { primary: '#002A5C', secondary: '#F15A22', abbr: 'UTSA' },
    'McNeese': { primary: '#182B49', secondary: '#C41230', abbr: 'MCN' },
    'Citadel': { primary: '#003087', secondary: '#FFFFFF', abbr: 'CIT' },
    "L'ville": { primary: '#AD0000', secondary: '#000000', abbr: 'LOU' },
    'Louisville': { primary: '#AD0000', secondary: '#000000', abbr: 'LOU' },
    'Clemson': { primary: '#F56600', secondary: '#522D80', abbr: 'CLEM' },
    'Tulsa': { primary: '#002D72', secondary: '#C8102E', abbr: 'TLSA' },
    'USA': { primary: '#00205B', secondary: '#C41E3A', abbr: 'USA' },
    'Ohio St': { primary: '#BB0000', secondary: '#666666', abbr: 'OSU' },
    'Ohio State': { primary: '#BB0000', secondary: '#666666', abbr: 'OSU' },
    'OSU': { primary: '#BB0000', secondary: '#666666', abbr: 'OSU' }
  };

  function teamAbbr(label) {
    var words = String(label).replace(/[^A-Za-z0-9.' ]/g, '').split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
    return words.map(function (w) { return w.charAt(0); }).join('').slice(0, 4).toUpperCase();
  }

  function teamColor(label) {
    var c = TEAM_COLORS[label];
    if (c) return c;
    // Unknown team (a spreadsheet spelling we haven't seen) — derive a stable
    // color from the name itself so it's at least consistent every render,
    // rather than falling back to one generic gray for everything unmapped.
    var hash = 0;
    for (var i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
    var hue = hash % 360;
    return { primary: 'hsl(' + hue + ', 55%, 32%)', secondary: '#ffffff', abbr: teamAbbr(label) };
  }

  function contrastOn(color) {
    if (color.charAt(0) !== '#') return '#ffffff'; // hsl() fallback colors are always dark enough
    var r = parseInt(color.substr(1, 2), 16), g = parseInt(color.substr(3, 2), 16), b = parseInt(color.substr(5, 2), 16);
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? '#1c2b22' : '#ffffff';
  }

  function teamBadge(label, size) {
    var c = teamColor(label);
    var b = document.createElement('span');
    b.className = 'team-badge';
    b.style.background = c.primary;
    b.style.color = contrastOn(c.primary);
    b.style.boxShadow = 'inset 0 0 0 2px ' + c.secondary;
    if (size) {
      b.style.width = size + 'px';
      b.style.height = size + 'px';
      b.style.fontSize = Math.max(6, Math.round(size * 0.34)) + 'px';
    }
    b.textContent = c.abbr;
    return b;
  }

  function fmtPts(n) {
    return (Math.round(n * 2) / 2) % 1 === 0 ? String(Math.round(n)) : n.toFixed(1);
  }

  function fmtPct(made, total) {
    if (!total) return '&mdash;';
    return Math.round(100 * made / total) + '%';
  }

  // Canonical SEC school list + every alias spelling (mirrors TEAM_COLORS
  // keys) that maps to it, so games/picks can be classified as SEC-vs-SEC
  // or Non-Con and picks can be rolled up per school regardless of which
  // spelling was used when the game was entered.
  var SEC_SCHOOLS = ['Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky', 'LSU',
    'Miss State', 'Mizzou', 'Oklahoma', 'Ole Miss', 'S. Carolina', 'Tennessee', 'Texas', 'Texas A&M', 'Vandy'];
  var SCHOOL_ALIASES = {
    'Alabama': 'Alabama', 'Bama': 'Alabama',
    'Arkansas': 'Arkansas', 'Arky': 'Arkansas',
    'Auburn': 'Auburn',
    'Florida': 'Florida', 'UF': 'Florida',
    'Georgia': 'Georgia', 'UGA': 'Georgia',
    'Kentucky': 'Kentucky', 'UK': 'Kentucky',
    'LSU': 'LSU',
    'Miss State': 'Miss State', 'MSU': 'Miss State',
    'Mizzou': 'Mizzou',
    'Oklahoma': 'Oklahoma', 'OU': 'Oklahoma',
    'Ole Miss': 'Ole Miss',
    'SCAR': 'S. Carolina', 'S. Carolina': 'S. Carolina',
    'Tennessee': 'Tennessee', 'Tenn': 'Tennessee', 'TENN': 'Tennessee',
    'Texas': 'Texas', 'TX': 'Texas', 'TEX': 'Texas',
    'Texas A&M': 'Texas A&M', 'TAMU': 'Texas A&M',
    'Vandy': 'Vandy', 'Vanderbilt': 'Vandy'
  };
  function schoolFor(label) {
    return SCHOOL_ALIASES[label] || null;
  }
  function isSecGame(g) {
    return !!(schoolFor(g.teamA) && schoolFor(g.teamB));
  }

  // Static all-time baseline reconstructed game-by-game from the pool's
  // 2022-2025 season sheets (the years before this app tracked picks live).
  // Combined across those four years, NOT broken out by year, per the
  // commissioner's request. Lock-of-the-Week wasn't tracked before 2025,
  // so lockW/lockL only reflect the 2025 season. This baseline is added to
  // the live-computed current-season totals in computeAllTimeStatsData()
  // so the All-Time section keeps itself current as 2026 progresses.
  // Lock-of-the-Week records below are sourced directly from the "Season
  // Stats" tab of the group's 2025 Google Sheet (2025 season only -- lock
  // accuracy was not reliably tracked pre-2025, unlike the other columns,
  // which remain the 2022-2025 combined reconstruction). 14 lock picks per
  // player in 2025 reproduces the sheet's percentages exactly (e.g. Jack
  // 6/14 = 43%, Cameron 8/14 = 57%, Brian 4/14 = 29%).
  var HIST_STATS = {
    players: {
      'Jack':     { lockW: 6, lockL: 8, nonConW: 122, nonConL: 101, secW: 121, secL: 119, totalW: 243, totalL: 220 },
      'Jay':      { lockW: 7, lockL: 7, nonConW: 121, nonConL: 101, secW: 110, secL: 116, totalW: 231, totalL: 217 },
      'Andrew':   { lockW: 7, lockL: 7, nonConW: 103, nonConL: 92,  secW: 106, secL: 109, totalW: 209, totalL: 201 },
      'Cameron':  { lockW: 8, lockL: 6, nonConW: 98,  nonConL: 124, secW: 121, secL: 117, totalW: 219, totalL: 241 },
      'Brian':    { lockW: 4, lockL: 10, nonConW: 126, nonConL: 95,  secW: 115, secL: 119, totalW: 241, totalL: 214 },
      'Harrison': { lockW: 7, lockL: 7, nonConW: 86,  nonConL: 77,  secW: 96,  secL: 88,  totalW: 182, totalL: 165 },
      'Mike':     { lockW: 5, lockL: 9, nonConW: 89,  nonConL: 76,  secW: 94,  secL: 89,  totalW: 183, totalL: 165 }
    },
    schools: {
      'Alabama': { w: 108, l: 102 }, 'Arkansas': { w: 53, l: 72 }, 'Auburn': { w: 46, l: 72 },
      'Florida': { w: 90, l: 87 }, 'Georgia': { w: 78, l: 107 }, 'Kentucky': { w: 68, l: 56 },
      'LSU': { w: 79, l: 87 }, 'Miss State': { w: 64, l: 61 }, 'Mizzou': { w: 89, l: 66 },
      'Oklahoma': { w: 46, l: 24 }, 'Ole Miss': { w: 113, l: 83 }, 'S. Carolina': { w: 84, l: 58 },
      'Tennessee': { w: 104, l: 78 }, 'Texas': { w: 68, l: 51 }, 'Texas A&M': { w: 53, l: 89 },
      'Vandy': { w: 57, l: 62 }
    }
  };

  // Same 2022-2025 reconstruction as HIST_STATS, but broken out per player
  // per SEC school (rather than combined across all players), since the
  // All-Time Accuracy by Team view shows one row per school with a column
  // per player. Same aliasing/definition as HIST_STATS.schools: counts a
  // pick as a "hit" for a school whenever that player picked that school,
  // regardless of whether the game was SEC-vs-SEC or SEC-vs-NonCon.
  var HIST_PLAYER_SCHOOLS = {
    'Jack': { 'Alabama': { w: 18, l: 14 }, 'Arkansas': { w: 9, l: 5 }, 'Auburn': { w: 6, l: 12 }, 'Florida': { w: 7, l: 8 }, 'Georgia': { w: 11, l: 18 }, 'Kentucky': { w: 8, l: 7 }, 'LSU': { w: 13, l: 13 }, 'Miss State': { w: 12, l: 11 }, 'Mizzou': { w: 12, l: 14 }, 'Oklahoma': { w: 6, l: 3 }, 'Ole Miss': { w: 18, l: 12 }, 'S. Carolina': { w: 14, l: 7 }, 'Tennessee': { w: 19, l: 14 }, 'Texas': { w: 11, l: 6 }, 'Texas A&M': { w: 10, l: 17 }, 'Vandy': { w: 6, l: 7 } },
    'Jay': { 'Alabama': { w: 16, l: 15 }, 'Arkansas': { w: 12, l: 11 }, 'Auburn': { w: 6, l: 11 }, 'Florida': { w: 10, l: 13 }, 'Georgia': { w: 12, l: 17 }, 'Kentucky': { w: 12, l: 11 }, 'LSU': { w: 13, l: 16 }, 'Miss State': { w: 10, l: 9 }, 'Mizzou': { w: 15, l: 9 }, 'Oklahoma': { w: 5, l: 6 }, 'Ole Miss': { w: 18, l: 13 }, 'S. Carolina': { w: 15, l: 6 }, 'Tennessee': { w: 17, l: 14 }, 'Texas': { w: 9, l: 7 }, 'Texas A&M': { w: 9, l: 10 }, 'Vandy': { w: 7, l: 10 } },
    'Andrew': { 'Alabama': { w: 15, l: 18 }, 'Arkansas': { w: 8, l: 13 }, 'Auburn': { w: 7, l: 13 }, 'Florida': { w: 18, l: 16 }, 'Georgia': { w: 9, l: 13 }, 'Kentucky': { w: 12, l: 8 }, 'LSU': { w: 8, l: 9 }, 'Miss State': { w: 10, l: 6 }, 'Mizzou': { w: 14, l: 9 }, 'Oklahoma': { w: 6, l: 0 }, 'Ole Miss': { w: 14, l: 11 }, 'S. Carolina': { w: 11, l: 8 }, 'Tennessee': { w: 14, l: 10 }, 'Texas': { w: 11, l: 7 }, 'Texas A&M': { w: 4, l: 14 }, 'Vandy': { w: 7, l: 8 } },
    'Cameron': { 'Alabama': { w: 18, l: 11 }, 'Arkansas': { w: 11, l: 14 }, 'Auburn': { w: 7, l: 10 }, 'Florida': { w: 15, l: 13 }, 'Georgia': { w: 12, l: 15 }, 'Kentucky': { w: 8, l: 10 }, 'LSU': { w: 14, l: 16 }, 'Miss State': { w: 9, l: 12 }, 'Mizzou': { w: 14, l: 9 }, 'Oklahoma': { w: 7, l: 6 }, 'Ole Miss': { w: 15, l: 15 }, 'S. Carolina': { w: 11, l: 11 }, 'Tennessee': { w: 15, l: 14 }, 'Texas': { w: 12, l: 8 }, 'Texas A&M': { w: 8, l: 14 }, 'Vandy': { w: 7, l: 11 } },
    'Brian': { 'Alabama': { w: 19, l: 18 }, 'Arkansas': { w: 9, l: 11 }, 'Auburn': { w: 9, l: 12 }, 'Florida': { w: 16, l: 18 }, 'Georgia': { w: 14, l: 21 }, 'Kentucky': { w: 15, l: 10 }, 'LSU': { w: 14, l: 16 }, 'Miss State': { w: 10, l: 9 }, 'Mizzou': { w: 11, l: 7 }, 'Oklahoma': { w: 5, l: 3 }, 'Ole Miss': { w: 19, l: 14 }, 'S. Carolina': { w: 13, l: 11 }, 'Tennessee': { w: 19, l: 8 }, 'Texas': { w: 9, l: 9 }, 'Texas A&M': { w: 7, l: 15 }, 'Vandy': { w: 9, l: 6 } },
    'Harrison': { 'Alabama': { w: 13, l: 14 }, 'Arkansas': { w: 1, l: 11 }, 'Auburn': { w: 8, l: 7 }, 'Florida': { w: 11, l: 10 }, 'Georgia': { w: 9, l: 10 }, 'Kentucky': { w: 6, l: 4 }, 'LSU': { w: 7, l: 7 }, 'Miss State': { w: 9, l: 8 }, 'Mizzou': { w: 11, l: 9 }, 'Oklahoma': { w: 7, l: 1 }, 'Ole Miss': { w: 12, l: 8 }, 'S. Carolina': { w: 12, l: 7 }, 'Tennessee': { w: 9, l: 10 }, 'Texas': { w: 7, l: 7 }, 'Texas A&M': { w: 9, l: 9 }, 'Vandy': { w: 7, l: 8 } },
    'Mike': { 'Alabama': { w: 9, l: 12 }, 'Arkansas': { w: 3, l: 7 }, 'Auburn': { w: 3, l: 7 }, 'Florida': { w: 13, l: 9 }, 'Georgia': { w: 11, l: 13 }, 'Kentucky': { w: 7, l: 6 }, 'LSU': { w: 10, l: 10 }, 'Miss State': { w: 4, l: 6 }, 'Mizzou': { w: 12, l: 9 }, 'Oklahoma': { w: 10, l: 5 }, 'Ole Miss': { w: 17, l: 10 }, 'S. Carolina': { w: 8, l: 8 }, 'Tennessee': { w: 11, l: 8 }, 'Texas': { w: 9, l: 7 }, 'Texas A&M': { w: 6, l: 10 }, 'Vandy': { w: 14, l: 12 } }
  };

  // Short 2-letter tags for the per-player-per-team table, where a full
  // name column per player would not fit alongside 16 school rows on
  // mobile. Falls back to the first two letters of any player not listed
  // here (e.g. a new player added mid-season).
  var PLAYER_ABBR = {
    'Jack': 'JB', 'Cameron': 'CF', 'Mike': 'MO', 'Brian': 'BG', 'Jay': 'JH', 'Andrew': 'AK', 'Harrison': 'HG'
  };
  function playerAbbr(name) {
    return PLAYER_ABBR[name] || String(name).slice(0, 2).toUpperCase();
  }

  // Live per-player-per-school breakdown for the current season, mirroring
  // computeStatsData()'s walk over history + the live week but keyed by
  // player then school instead of collapsed into one combined tally.
  function computePlayerSchoolStats() {
    var weeks = STATE.history.concat([{ week: STATE.week, games: STATE.games, picks: STATE.picks, locks: STATE.locks, winners: STATE.winners }]);
    var out = {};
    PLAYERS.forEach(function (name) {
      out[name] = {};
      SEC_SCHOOLS.forEach(function (s) { out[name][s] = { w: 0, l: 0 }; });
    });
    weeks.forEach(function (wk) {
      (wk.games || []).forEach(function (g, idx) {
        var winner = (wk.winners || [])[idx];
        if (!winner || winner === 'PUSH') return;
        PLAYERS.forEach(function (name) {
          var pick = ((wk.picks || {})[name] || [])[idx];
          if (!pick) return;
          var school = schoolFor(pick);
          if (!school) return;
          var hit = pick === winner;
          if (hit) out[name][school].w++; else out[name][school].l++;
        });
      });
    });
    return out;
  }

  // Combines the static 2022-2025 per-player-per-school baseline with the
  // live current-season breakdown, so the All-Time Accuracy by Team table
  // stays accurate automatically as 2026 is graded week to week.
  function computeAllTimePlayerSchools() {
    var live = computePlayerSchoolStats();
    var out = {};
    PLAYERS.forEach(function (name) {
      out[name] = {};
      var base = HIST_PLAYER_SCHOOLS[name] || {};
      SEC_SCHOOLS.forEach(function (s) {
        var b = base[s] || { w: 0, l: 0 };
        var cur = live[name][s];
        out[name][s] = { w: b.w + cur.w, l: b.l + cur.l };
      });
    });
    return out;
  }

  // Combines the static 2022-2025 baseline above with the live-computed
  // current-season totals from computeStatsData(), so All-Time stays
  // accurate automatically as the current season is graded week to week.
  function computeAllTimeStatsData() {
    var live = computeStatsData();
    var players = {};
    PLAYERS.forEach(function (name) {
      var base = HIST_STATS.players[name] || { lockW: 0, lockL: 0, nonConW: 0, nonConL: 0, secW: 0, secL: 0, totalW: 0, totalL: 0 };
      var cur = live.players[name];
      players[name] = {
        lockW: base.lockW + cur.lockW, lockL: base.lockL + cur.lockL,
        nonConW: base.nonConW + cur.nonConW, nonConL: base.nonConL + cur.nonConL,
        secW: base.secW + cur.secW, secL: base.secL + cur.secL,
        totalW: base.totalW + cur.totalW, totalL: base.totalL + cur.totalL
      };
    });
    var schools = {};
    SEC_SCHOOLS.forEach(function (s) {
      var base = HIST_STATS.schools[s] || { w: 0, l: 0 };
      var cur = live.schools[s];
      schools[s] = { w: base.w + cur.w, l: base.l + cur.l };
    });
    return { players: players, schools: schools };
  }

  // Walks every graded game across season history plus the live week and
  // tallies, per player: Lock-of-the-Week record, Non-Con record, SEC-game
  // record and a season Total — the same four categories the commissioner's
  // season sheet tracks — plus a combined per-school pick-accuracy grid.
  // Computed live from the app's own picks/results rather than synced from
  // the sheet, since the sheet's own figures reset to blank each week until
  // games are graded there.
  function computeStatsData() {
    var weeks = STATE.history.concat([{ week: STATE.week, games: STATE.games, picks: STATE.picks, locks: STATE.locks, winners: STATE.winners }]);
    var players = {};
    PLAYERS.forEach(function (name) {
      players[name] = {
        lockW: 0, lockL: 0, nonConW: 0, nonConL: 0, secW: 0, secL: 0, totalW: 0, totalL: 0
      };
    });
    var schools = {};
    SEC_SCHOOLS.forEach(function (s) { schools[s] = { w: 0, l: 0 }; });

    weeks.forEach(function (wk) {
      (wk.games || []).forEach(function (g, idx) {
        var winner = (wk.winners || [])[idx];
        if (!winner || winner === 'PUSH') return;
        var secGame = isSecGame(g);
        PLAYERS.forEach(function (name) {
          var pick = ((wk.picks || {})[name] || [])[idx];
          if (!pick) return;
          var hit = pick === winner;
          var rec = players[name];
          if (hit) { rec.totalW++; } else { rec.totalL++; }
          if (secGame) { if (hit) rec.secW++; else rec.secL++; }
          else { if (hit) rec.nonConW++; else rec.nonConL++; }
          if ((wk.locks || {})[name] === idx) { if (hit) rec.lockW++; else rec.lockL++; }
          var school = schoolFor(pick);
          if (school) { if (hit) schools[school].w++; else schools[school].l++; }
        });
      });
    });

    return { players: players, schools: schools };
  }

  function switchTab(name) {
    if (TABS.indexOf(name) === -1) return;
    currentTab = name;
    try { localStorage.setItem('secats_tab', name); } catch (e) {}
    TABS.forEach(function (t) {
      var panel = document.getElementById('panel-' + t);
      if (panel) panel.hidden = (t !== name);
    });
    var buttons = document.querySelectorAll('#tab-dock .tab-btn');
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      btn.classList.toggle('active', btn.getAttribute('data-tab') === name);
    }
    window.scrollTo(0, 0);
  }

  function wireTabDock() {
    var buttons = document.querySelectorAll('#tab-dock .tab-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (e) {
        switchTab(e.currentTarget.getAttribute('data-tab'));
      });
    }
    switchTab(currentTab);
  }

  function renderTabDots() {
    var dPicks = document.getElementById('dot-picks');
    if (dPicks) {
      var needsPicks = !!currentPlayer && STATE.games.length > 0 && pickCount(currentPlayer) < STATE.games.length;
      dPicks.classList.toggle('show', needsPicks);
    }
    var dComm = document.getElementById('dot-commissioner');
    if (dComm) {
      var needsGrading = isCommUnlocked() && STATE.commissionerPinHash && STATE.games.length > 0 &&
        STATE.winners.filter(Boolean).length < STATE.games.length;
      dComm.classList.toggle('show', needsGrading);
    }
  }

  // A player or the commissioner "unlocks" by verifying their PIN once
  // against the server, which returns a signed token good for ~180 days —
  // stored in localStorage so it survives closing the browser (an upgrade
  // over the old per-tab sessionStorage unlock). isXUnlocked() only checks
  // whether a token is present; an expired/invalid one is caught the first
  // time it's actually used (a 401 from the server), which clears it and
  // falls back to the PIN gate.
  function isPlayerUnlocked(name) {
    return !!getToken(name);
  }
  function markPlayerUnlocked(name, token) {
    setToken(name, token);
  }
  function isCommUnlocked() {
    return !!getToken('commissioner');
  }
  function markCommUnlocked(token) {
    setToken('commissioner', token);
  }

  function pickCount(name) {
    var p = STATE.picks[name] || [];
    var n = 0;
    for (var i = 0; i < p.length; i++) if (p[i]) n++;
    return n;
  }

  function scoreWeek(games, picks, locks, winners) {
    var pts = {};
    PLAYERS.forEach(function (p) { pts[p] = 0; });
    games.forEach(function (g, idx) {
      var winner = winners[idx];
      if (!winner || winner === 'PUSH') return;
      PLAYERS.forEach(function (name) {
        var pick = (picks[name] || [])[idx];
        if (pick && pick === winner) {
          pts[name] += 1;
          if (locks[name] === idx) pts[name] += 0.5;
        }
      });
    });
    return pts;
  }

  function computeStandings() {
    var total = {};
    PLAYERS.forEach(function (p) { total[p] = 0; });
    STATE.history.forEach(function (w) {
      var pts = scoreWeek(w.games, w.picks, w.locks, w.winners);
      PLAYERS.forEach(function (p) { total[p] += pts[p] || 0; });
    });
    var live = scoreWeek(STATE.games, STATE.picks, STATE.locks, STATE.winners);
    PLAYERS.forEach(function (p) { total[p] += live[p] || 0; });
    return PLAYERS.map(function (name) { return { name: name, pts: total[name] }; })
      .sort(function (a, b) { return b.pts - a.pts; });
  }

  function renderCapBanner() {
    var section = document.getElementById('cap-banner-section');
    var banner = document.getElementById('cap-banner');
    if (capState === 'loading') {
      section.hidden = false;
      banner.className = 'banner info';
      banner.innerHTML = 'Loading the latest picks…';
    } else if (capState === 'error') {
      section.hidden = false;
      banner.className = 'banner err';
      banner.innerHTML = "<strong>Can't reach the server.</strong> Check your connection and reload.";
    } else {
      section.hidden = true;
    }
  }

  function renderStandings() {
    var wrap = document.getElementById('standings');
    wrap.innerHTML = '';
    var sorted = computeStandings();
    sorted.forEach(function (p, i) {
      var row = el('div', 'standings-row' + (i === 0 && p.pts > 0 ? ' lead' : ''));
      row.appendChild(el('span', 'rank', '#' + (i + 1)));
      row.appendChild(el('span', 'name', p.name));
      row.appendChild(el('span', 'pts', fmtPts(p.pts) + '<span class="unit">pts</span>'));
      wrap.appendChild(row);
    });
  }

  function renderStatsTable(wrap, data) {
    wrap.innerHTML = '';
    var table = el('div', 'stats-table');
    var head = el('div', 'stats-row stats-head');
    ['Player', 'Lock', 'Non-Con', 'SEC', 'Total'].forEach(function (h) {
      head.appendChild(el('span', 'stats-cell', h));
    });
    table.appendChild(head);
    PLAYERS.forEach(function (name) {
      var r = data.players[name];
      var row = el('div', 'stats-row');
      row.appendChild(el('span', 'stats-cell stats-name', name));
      row.appendChild(el('span', 'stats-cell mono', fmtPct(r.lockW, r.lockW + r.lockL)));
      row.appendChild(el('span', 'stats-cell mono', fmtPct(r.nonConW, r.nonConW + r.nonConL)));
      row.appendChild(el('span', 'stats-cell mono', fmtPct(r.secW, r.secW + r.secL)));
      row.appendChild(el('span', 'stats-cell mono strong', fmtPct(r.totalW, r.totalW + r.totalL)));
      table.appendChild(row);
    });
    wrap.appendChild(table);
  }

  function renderTeamGrid(wrap, data, emptyMsg) {
    wrap.innerHTML = '';
    var grid = el('div', 'team-stats-grid');
    var ranked = SEC_SCHOOLS.map(function (s) { return { school: s, rec: data.schools[s] }; })
      .filter(function (x) { return x.rec.w + x.rec.l > 0; })
      .sort(function (a, b) { return (b.rec.w + b.rec.l) - (a.rec.w + a.rec.l); });
    if (!ranked.length) {
      wrap.appendChild(el('div', 'empty-note', emptyMsg));
      return;
    }
    ranked.forEach(function (x) {
      var c = teamColor(x.school);
      var card = el('div', 'team-stat-card');
      card.style.borderColor = c.primary;
      var top = el('div', 'tsc-top');
      top.appendChild(teamBadge(x.school, 24));
      var info = el('div', 'tsc-info');
      info.appendChild(el('div', 'tsc-name', x.school));
      info.appendChild(el('div', 'tsc-record mono', (x.rec.w + x.rec.l) + ' picked'));
      top.appendChild(info);
      card.appendChild(top);
      var pctRow = el('div', 'tsc-pct', fmtPct(x.rec.w, x.rec.w + x.rec.l));
      pctRow.style.color = c.primary;
      card.appendChild(pctRow);
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
  }

  // Renders one row per SEC school with one column per player, so you can
  // see each player's own record picking that school rather than only the
  // group's combined accuracy (which renderTeamGrid shows for the current
  // season). Sorted by total picks across all players, most-picked first.
  function renderPlayerSchoolTable(wrap, data, emptyMsg) {
    wrap.innerHTML = '';
    var ranked = SEC_SCHOOLS.map(function (s) {
      var total = 0;
      PLAYERS.forEach(function (name) { var r = data[name][s]; total += r.w + r.l; });
      return { school: s, total: total };
    }).filter(function (x) { return x.total > 0; })
      .sort(function (a, b) { return b.total - a.total; });

    if (!ranked.length) {
      wrap.appendChild(el('div', 'empty-note', emptyMsg));
      return;
    }

    var table = el('div', 'pt-table');
    var head = el('div', 'pt-row pt-head');
    head.appendChild(el('span', 'pt-cell pt-team', 'Team'));
    PLAYERS.forEach(function (name) {
      head.appendChild(el('span', 'pt-cell', playerAbbr(name)));
    });
    table.appendChild(head);

    ranked.forEach(function (x) {
      var c = teamColor(x.school);
      var row = el('div', 'pt-row');
      var teamCell = el('span', 'pt-cell pt-team');
      var dot = document.createElement('span');
      dot.className = 'pt-dot';
      dot.style.background = c.primary;
      teamCell.appendChild(dot);
      teamCell.appendChild(document.createTextNode(c.abbr));
      row.appendChild(teamCell);
      PLAYERS.forEach(function (name) {
        var r = data[name][x.school];
        var total = r.w + r.l;
        var cell = el('span', 'pt-cell mono' + (total ? '' : ' pt-empty'), fmtPct(r.w, total));
        row.appendChild(cell);
      });
      table.appendChild(row);
    });
    wrap.appendChild(table);
  }

  function renderStats() {
    var summary = document.getElementById('stats-summary');
    var teamsWrap = document.getElementById('stats-teams');
    var atSummary = document.getElementById('stats-alltime-summary');
    var atTeamsWrap = document.getElementById('stats-alltime-teams');
    if (!summary || !teamsWrap) return;
    var data = computeStatsData();

    renderStatsTable(summary, data);
    if (!STATE.games.length && !STATE.history.length) {
      summary.appendChild(el('div', 'empty-note', 'No graded games yet this season — stats will fill in as weeks are scored.'));
    }
    renderTeamGrid(teamsWrap, data, 'No graded picks yet — team accuracy fills in once games are scored.');

    if (atSummary && atTeamsWrap) {
      var allTime = computeAllTimeStatsData();
      renderStatsTable(atSummary, allTime);
      renderPlayerSchoolTable(atTeamsWrap, computeAllTimePlayerSchools(), 'No graded picks yet.');
    }
  }

  function renderRoster() {
    var wrap = document.getElementById('roster');
    wrap.innerHTML = '';
    document.getElementById('picker-meta').textContent = STATE.week;
    PLAYERS.forEach(function (name) {
      var n = pickCount(name);
      var cls = 'player-chip';
      if (n === STATE.games.length && STATE.games.length > 0) cls += ' done';
      else if (n > 0) cls += ' partial';
      if (name === currentPlayer) cls += ' active';
      var lockmark = (STATE.locks[name] !== null && STATE.locks[name] !== undefined) ? ' <span class="lockmark">&#9733;</span>' : '';
      var chip = el('span', cls, '<span class="dot"></span>' + name + lockmark);
      chip.addEventListener('click', function () { selectPlayer(name); });
      wrap.appendChild(chip);
    });
  }

  function selectPlayer(name) {
    currentPlayer = name;
    pickerErr = '';
    try { localStorage.setItem('secats_player', name); } catch (e) {}
    var saved = STATE.picks[name] || [];
    draft = STATE.games.map(function (g, i) { return saved[i] || null; });
    draftLock = (STATE.locks[name] !== undefined) ? STATE.locks[name] : null;
    renderRoster();
    renderPickerGate();
    renderTabDots();
  }

  function renderPickerGate() {
    var gate = document.getElementById('picker-gate');
    var card = document.getElementById('picker-card');
    gate.innerHTML = '';
    if (!currentPlayer) { gate.hidden = true; card.hidden = true; return; }

    var hasPin = !!STATE.pins[currentPlayer];
    var unlocked = isPlayerUnlocked(currentPlayer);
    if (unlocked) {
      gate.hidden = true;
      card.hidden = false;
      renderPicker();
      return;
    }
    card.hidden = true;
    gate.hidden = false;

    if (!hasPin) {
      gate.appendChild(el('h3', '', 'Set a PIN for ' + currentPlayer));
      gate.appendChild(el('p', '', 'Protects your picks from being changed by anyone else. Pick 4+ digits — you\'ll stay signed in on this device for months.'));
      var row = el('div', 'auth-row');
      var p1 = document.createElement('input');
      p1.type = 'password'; p1.inputMode = 'numeric'; p1.placeholder = 'New PIN'; p1.className = 'auth-input'; p1.id = 'pin-new';
      var p2 = document.createElement('input');
      p2.type = 'password'; p2.inputMode = 'numeric'; p2.placeholder = 'Confirm PIN'; p2.className = 'auth-input'; p2.id = 'pin-confirm';
      var btn = el('button', 'auth-btn', 'Set PIN');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        var a = p1.value.trim(), b = p2.value.trim();
        if (a.length < 4) { pickerErr = 'PIN needs at least 4 characters.'; renderPickerGate(); return; }
        if (a !== b) { pickerErr = 'PINs don\'t match.'; renderPickerGate(); return; }
        btn.disabled = true; btn.textContent = 'Saving…';
        apiPost('/api/player/' + encodeURIComponent(currentPlayer) + '/pin/set', { pin: a, confirmPin: b })
          .then(function (res) {
            markPlayerUnlocked(currentPlayer, res.token);
            pickerErr = '';
            return refreshState();
          })
          .then(function () {
            showToast('PIN set for ' + currentPlayer + '.', 'ok');
            renderPickerGate();
          })
          .catch(function (err) {
            pickerErr = err.message || 'Could not set PIN.';
            renderPickerGate();
          });
      });
      row.appendChild(p1); row.appendChild(p2); row.appendChild(btn);
      gate.appendChild(row);
    } else {
      gate.appendChild(el('h3', '', 'Enter ' + currentPlayer + '’s PIN'));
      gate.appendChild(el('p', '', 'This unlocks picks for this device.'));
      var row2 = el('div', 'auth-row');
      var pin = document.createElement('input');
      pin.type = 'password'; pin.inputMode = 'numeric'; pin.placeholder = 'PIN'; pin.className = 'auth-input'; pin.id = 'pin-enter';
      var btn2 = el('button', 'auth-btn', 'Unlock');
      btn2.type = 'button';
      var tryUnlock = function () {
        var val = pin.value.trim();
        if (!val) return;
        btn2.disabled = true;
        apiPost('/api/player/' + encodeURIComponent(currentPlayer) + '/pin/verify', { pin: val })
          .then(function (res) {
            markPlayerUnlocked(currentPlayer, res.token);
            pickerErr = '';
            renderPickerGate();
          })
          .catch(function (err) {
            pickerErr = err.message || 'Wrong PIN.';
            btn2.disabled = false;
            renderPickerGate();
          });
      };
      pin.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryUnlock(); });
      btn2.addEventListener('click', tryUnlock);
      row2.appendChild(pin); row2.appendChild(btn2);
      gate.appendChild(row2);
    }
    gate.appendChild(el('div', 'auth-err', pickerErr || ''));
  }

  function renderPicker() {
    var rows = document.getElementById('picker-rows');
    rows.innerHTML = '';
    if (!STATE.games.length) {
      rows.appendChild(el('div', '', '<p style="padding:14px;color:var(--ink-faint);font-size:12.5px;">No games posted for ' + STATE.week + ' yet — check back once the commissioner sets the spreads.</p>'));
      document.getElementById('picker-progress').textContent = '';
      document.getElementById('save-btn').disabled = true;
      return;
    }
    var locked = picksAreLocked();
    STATE.games.forEach(function (g, i) {
      var row = el('div', 'picker-row');
      row.appendChild(el('div', 'pr-matchup', g.matchup));
      row.appendChild(el('div', 'pr-spread mono', g.spread));
      var controls = el('div', 'pr-controls');
      var choices = el('div', 'pr-choices');
      [g.teamA, g.teamB].forEach(function (opt) {
        var sel = draft[i] === opt;
        var c = teamColor(opt);
        var btn = el('button', 'pick-btn' + (sel ? ' sel' : ''));
        btn.type = 'button';
        btn.disabled = locked;
        btn.style.borderColor = c.primary;
        if (sel) {
          btn.style.background = c.primary;
          btn.style.color = contrastOn(c.primary);
        } else {
          btn.style.background = 'var(--paper)';
          btn.style.color = 'var(--ink-soft)';
        }
        btn.appendChild(teamBadge(opt));
        btn.appendChild(el('span', 'pb-label', opt));
        if (!locked) {
          btn.addEventListener('click', function () {
            draft[i] = (draft[i] === opt) ? null : opt;
            if (!draft[i] && draftLock === i) draftLock = null;
            renderPicker();
          });
        }
        choices.appendChild(btn);
      });
      controls.appendChild(choices);
      var lockBtn = el('button', 'lock-btn' + (draftLock === i ? ' on' : ''), '&#9733;');
      lockBtn.type = 'button';
      lockBtn.title = 'Set as this week\'s Lock (+0.5 pt if correct)';
      lockBtn.disabled = !draft[i] || locked;
      if (!locked) {
        lockBtn.addEventListener('click', function () {
          if (!draft[i]) return;
          draftLock = (draftLock === i) ? null : i;
          renderPicker();
        });
      }
      controls.appendChild(lockBtn);
      row.appendChild(controls);
      rows.appendChild(row);
    });
    var made = draft.filter(Boolean).length;
    var lockNote = draftLock === null ? 'no Lock set' : ('Lock: Game ' + (draftLock + 1));
    var deadlineBanner = document.getElementById('picker-deadline-banner');
    if (deadlineBanner) {
      if (locked) {
        deadlineBanner.hidden = false;
        deadlineBanner.className = 'banner err';
        deadlineBanner.textContent = 'Picks locked -- the deadline passed at ' + fmtDeadline(STATE.pickDeadline) + '. Ask the commissioner if something needs to change.';
      } else if (STATE.pickDeadline) {
        deadlineBanner.hidden = false;
        deadlineBanner.className = 'banner warn';
        deadlineBanner.textContent = 'Picks lock at ' + fmtDeadline(STATE.pickDeadline) + '.';
      } else {
        deadlineBanner.hidden = true;
      }
    }
    document.getElementById('picker-progress').textContent = made + ' of ' + STATE.games.length + ' games · ' + lockNote;
    var saveBtn = document.getElementById('save-btn');
    saveBtn.disabled = (capState !== 'ready') || locked;
    saveBtn.textContent = capState === 'loading' ? 'Loading…' : (locked ? 'Picks Locked' : (made === 0 ? 'Save Picks' : 'Save ' + made + ' Pick' + (made === 1 ? '' : 's')));
  }

  function renderRosterStatus() {
    var wrap = document.getElementById('roster-status');
    wrap.innerHTML = '';
    document.getElementById('roster-status-meta').textContent = STATE.week + ' roster status';
    PLAYERS.forEach(function (name) {
      var n = pickCount(name);
      var lockIdx = STATE.locks[name];
      var row = el('div', 'rs-row' + (n === STATE.games.length && STATE.games.length > 0 ? ' done' : ''));
      row.appendChild(el('span', 'rs-name', name));
      if (lockIdx !== null && lockIdx !== undefined && STATE.games[lockIdx]) {
        row.appendChild(el('span', 'rs-lock', '★ ' + ((STATE.picks[name] || [])[lockIdx] || '')));
      }
      row.appendChild(el('span', 'rs-count mono', n + '/' + STATE.games.length));
      wrap.appendChild(row);
    });
  }

  // Everything below lets the Commissioner tab operate on ANY week — a past
  // (history) week, the live (current) week, or a not-yet-started (upcoming,
  // queued) week — not just whatever is currently live. commWeekKey picks
  // which one; getViewedWeek() resolves it to the actual games/winners/etc.
  function currentWeekView() {
    return { kind: 'current', idx: null, label: STATE.week, games: STATE.games, winners: STATE.winners, picks: STATE.picks, locks: STATE.locks };
  }

  function weekOptions() {
    var opts = [];
    STATE.history.forEach(function (w, i) { opts.push({ key: 'history:' + i, label: w.week, kind: 'history' }); });
    opts.push({ key: 'current', label: STATE.week + ' (current)', kind: 'current' });
    (STATE.upcoming || []).forEach(function (w, i) { opts.push({ key: 'upcoming:' + i, label: w.label + ' (queued)', kind: 'upcoming' }); });
    return opts;
  }

  function getViewedWeek() {
    if (commWeekKey === 'current') return currentWeekView();
    var parts = commWeekKey.split(':');
    var kind = parts[0], idx = parseInt(parts[1], 10);
    if (kind === 'history' && STATE.history[idx]) {
      var h = STATE.history[idx];
      return { kind: 'history', idx: idx, label: h.week, games: h.games, winners: h.winners, picks: h.picks, locks: h.locks };
    }
    if (kind === 'upcoming' && STATE.upcoming && STATE.upcoming[idx]) {
      var u = STATE.upcoming[idx];
      return { kind: 'upcoming', idx: idx, label: u.label, games: u.games, winners: null, picks: null, locks: null };
    }
    // Selection no longer resolves (e.g. the queue shifted) — fall back to current.
    commWeekKey = 'current';
    return currentWeekView();
  }

  // Builds a tab-separated block mirroring the season sheet's per-week tab:
  // a Game row, a Spread row, a Winner row, then one row per player with
  // their pick in each game's column — ready to paste directly into Sheets.
  function buildSheetExport(viewed) {
    function tsvRow(cells) {
      return cells.map(function (c) {
        return String(c == null ? '' : c).replace(/\t/g, ' ').replace(/\n/g, ' ');
      }).join('\t');
    }
    var lines = [];
    lines.push(tsvRow(['Game'].concat(viewed.games.map(function (g) { return g.matchup; }))));
    lines.push(tsvRow(['Spread'].concat(viewed.games.map(function (g) { return g.spread; }))));
    lines.push(tsvRow(['Winner'].concat(viewed.games.map(function (g, i) {
      var w = (viewed.winners || [])[i];
      return w === 'PUSH' ? 'Push' : (w || '');
    }))));
    PLAYERS.forEach(function (name) {
      var picks = (viewed.picks && viewed.picks[name]) || [];
      var lockIdx = viewed.locks ? viewed.locks[name] : null;
      lines.push(tsvRow([name].concat(viewed.games.map(function (g, i) {
        var p = picks[i] || '';
        return (p && lockIdx === i) ? p + ' (LOCK)' : p;
      }))));
    });
    return lines.join('\n');
  }

  function renderCommGate() {
    var gate = document.getElementById('comm-gate');
    var tools = document.getElementById('comm-tools');
    gate.innerHTML = '';

    if (isCommUnlocked() && STATE.commissionerPinHash) {
      gate.hidden = true;
      tools.hidden = false;
      renderCommTools();
      return;
    }
    tools.hidden = true;
    gate.hidden = false;

    if (!STATE.commissionerPinHash) {
      gate.appendChild(el('h3', '', 'Claim commissioner access'));
      gate.appendChild(el('p', '', 'Whoever sets this PIN first controls results and spreads. Set it before sharing the link with the group.'));
      var row = el('div', 'auth-row');
      var p1 = document.createElement('input');
      p1.type = 'password'; p1.inputMode = 'numeric'; p1.placeholder = 'New PIN'; p1.className = 'auth-input';
      var p2 = document.createElement('input');
      p2.type = 'password'; p2.inputMode = 'numeric'; p2.placeholder = 'Confirm PIN'; p2.className = 'auth-input';
      var btn = el('button', 'auth-btn', 'Claim');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        var a = p1.value.trim(), b = p2.value.trim();
        if (a.length < 4) { commErr = 'PIN needs at least 4 characters.'; renderCommGate(); return; }
        if (a !== b) { commErr = 'PINs don\'t match.'; renderCommGate(); return; }
        btn.disabled = true; btn.textContent = 'Saving…';
        apiPost('/api/commissioner/pin/set', { pin: a, confirmPin: b })
          .then(function (res) {
            markCommUnlocked(res.token);
            commErr = '';
            return refreshState();
          })
          .then(function () {
            showToast('Commissioner PIN set.', 'ok');
            renderCommGate();
          })
          .catch(function (err) {
            commErr = err.message || 'Could not set PIN.';
            renderCommGate();
          });
      });
      row.appendChild(p1); row.appendChild(p2); row.appendChild(btn);
      gate.appendChild(row);
    } else {
      gate.appendChild(el('h3', '', 'Commissioner PIN'));
      gate.appendChild(el('p', '', 'Enter the PIN to edit spreads and results.'));
      var row2 = el('div', 'auth-row');
      var pin = document.createElement('input');
      pin.type = 'password'; pin.inputMode = 'numeric'; pin.placeholder = 'PIN'; pin.className = 'auth-input';
      var btn2 = el('button', 'auth-btn', 'Unlock');
      btn2.type = 'button';
      var tryUnlock = function () {
        var val = pin.value.trim();
        if (!val) return;
        btn2.disabled = true;
        apiPost('/api/commissioner/pin/verify', { pin: val })
          .then(function (res) {
            markCommUnlocked(res.token);
            commErr = '';
            renderCommGate();
          })
          .catch(function (err) {
            commErr = err.message || 'Wrong PIN.';
            btn2.disabled = false;
            renderCommGate();
          });
      };
      pin.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryUnlock(); });
      btn2.addEventListener('click', tryUnlock);
      row2.appendChild(pin); row2.appendChild(btn2);
      gate.appendChild(row2);
    }
    gate.appendChild(el('div', 'auth-err', commErr || ''));
  }

  function renderCommTools() {
    var wrap = document.getElementById('comm-tools');
    wrap.innerHTML = '';

    // Week block — pick any week (past, current, or queued) to manage
    var viewed = getViewedWeek();
    var weekBlock = el('div', 'comm-block');
    weekBlock.appendChild(el('h3', '', 'Manage Week'));
    var selRow = el('div', 'auth-row');
    var weekSel = document.createElement('select');
    weekOptions().forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.key; opt.textContent = o.label;
      if (o.key === commWeekKey) opt.selected = true;
      weekSel.appendChild(opt);
    });
    weekSel.addEventListener('change', function () {
      commWeekKey = weekSel.value;
      editingGames = false;
      draftGames = null;
      var v = getViewedWeek();
      draftWinners = v.winners ? v.winners.slice() : [];
      renderCommTools();
    });
    selRow.appendChild(weekSel);
    weekBlock.appendChild(selRow);

    if (viewed.kind === 'current') {
      var nextQueued = STATE.upcoming && STATE.upcoming.length ? STATE.upcoming[0] : null;
      weekBlock.appendChild(el('p', '', nextQueued
        ? ('Next up: ' + nextQueued.label + ' — ' + nextQueued.games.length + ' matchups queued. Grade every game below and save to advance to it automatically.')
        : 'No more weeks queued — grading every game won\'t auto-advance until you queue one, so use "Start New Week" to name the next one manually.'));

      var deadlineRow = el('div', 'auth-row deadline-row');
      var deadlineIn = mkDateTimeInput(STATE.pickDeadline, 'eg-deadline');
      var deadlineBtn = el('button', 'ghost-btn', 'Set Deadline');
      deadlineBtn.type = 'button';
      deadlineBtn.addEventListener('click', function () {
        commAction('/api/commissioner/deadline', { deadline: localInputToIso(deadlineIn.value) }, function () {
          showToast(deadlineIn.value ? ('Picks lock at ' + fmtDeadline(STATE.pickDeadline) + '.') : 'Deadline cleared -- picks are open.', 'ok');
        });
      });
      deadlineRow.appendChild(deadlineIn);
      deadlineRow.appendChild(deadlineBtn);
      if (STATE.pickDeadline) {
        var clearBtn = el('button', 'ghost-btn', picksAreLocked() ? 'Unlock (clear deadline)' : 'Clear');
        clearBtn.type = 'button';
        clearBtn.addEventListener('click', function () {
          commAction('/api/commissioner/deadline', { deadline: null }, function () {
            showToast('Deadline cleared -- picks are open.', 'ok');
          });
        });
        deadlineRow.appendChild(clearBtn);
      }
      weekBlock.appendChild(deadlineRow);
      weekBlock.appendChild(el('p', 'auth-err', ''));
      weekBlock.appendChild(el('p', '',
        STATE.pickDeadline
          ? (picksAreLocked() ? ('Picks locked since ' + fmtDeadline(STATE.pickDeadline) + ' -- no player can change picks for ' + STATE.week + '.') : ('Picks lock automatically at ' + fmtDeadline(STATE.pickDeadline) + '.'))
          : 'No deadline set -- players can change picks any time until you grade the games.'));
    } else if (viewed.kind === 'history') {
      weekBlock.appendChild(el('p', '', 'Editing a completed week — changes to spreads or results here update the season standings right away.'));
    } else {
      weekBlock.appendChild(el('p', '', 'This week is queued but not started — you can set its spreads now so it\'s ready to go.'));
    }

    var weekRow = el('div', 'auth-row');
    var editBtn = el('button', 'ghost-btn', editingGames ? 'Close Editor' : 'Edit Games & Spreads');
    editBtn.type = 'button';
    editBtn.addEventListener('click', function () {
      editingGames = !editingGames;
      if (editingGames) draftGames = viewed.games.map(function (g) { return { matchup: g.matchup, teamA: g.teamA, teamB: g.teamB, spread: g.spread }; });
      renderCommTools();
    });
    weekRow.appendChild(editBtn);
    if (viewed.kind === 'current') {
      var newWeekBtn = el('button', 'danger-btn', 'Start New Week Early');
      newWeekBtn.type = 'button';
      newWeekBtn.title = 'Manual override — jump to the next week even if this one isn\'t fully graded yet.';
      newWeekBtn.addEventListener('click', startNewWeek);
      weekRow.appendChild(newWeekBtn);
    }
    weekBlock.appendChild(weekRow);
    wrap.appendChild(weekBlock);

    if (editingGames) {
      var editBlock = el('div', 'comm-block');
      editBlock.appendChild(el('h3', '', 'Edit ' + viewed.label + ' games'));
      editBlock.appendChild(el('p', 'auth-err', ''));
      var warn = el('div', 'banner warn');
      warn.style.marginBottom = '8px';
      warn.textContent = 'Best to finish this before anyone picks — changing a game after picks are in can misalign existing picks for that slot.';
      editBlock.appendChild(warn);
      var rowsWrap = el('div', '', '');
      draftGames.forEach(function (g, i) {
        var row = el('div', 'editgame-row');
        var mIn = mkInput(g.matchup, 'Matchup (Away @ Home)', 'eg-matchup');
        var aIn = mkInput(g.teamA, 'Team A (pick label)', '');
        var bIn = mkInput(g.teamB, 'Team B (pick label)', '');
        var sIn = mkInput(g.spread, 'Spread text', 'eg-spread');
        mIn.addEventListener('input', function () { draftGames[i].matchup = mIn.value; });
        aIn.addEventListener('input', function () { draftGames[i].teamA = aIn.value; });
        bIn.addEventListener('input', function () { draftGames[i].teamB = bIn.value; });
        sIn.addEventListener('input', function () { draftGames[i].spread = sIn.value; });
        row.appendChild(mIn); row.appendChild(sIn); row.appendChild(aIn); row.appendChild(bIn);
        var rm = el('button', 'editgame-remove', 'Remove game');
        rm.type = 'button';
        rm.addEventListener('click', function () { draftGames.splice(i, 1); renderCommTools(); });
        row.appendChild(rm);
        rowsWrap.appendChild(row);
      });
      editBlock.appendChild(rowsWrap);
      var addBtn = el('button', 'ghost-btn', '+ Add Game');
      addBtn.type = 'button';
      addBtn.style.marginTop = '8px';
      addBtn.addEventListener('click', function () {
        draftGames.push({ matchup: '', teamA: '', teamB: '', spread: '' });
        renderCommTools();
      });
      editBlock.appendChild(addBtn);
      var saveRow = el('div', 'save-bar');
      saveRow.style.marginTop = '10px';
      saveRow.style.borderRadius = '10px';
      var savePr = el('span', 'progress', draftGames.filter(function (g) { return g.teamA && g.teamB; }).length + ' valid games');
      var saveGamesBtn = el('button', 'save-btn', 'Save Week Setup');
      saveGamesBtn.type = 'button';
      saveGamesBtn.addEventListener('click', saveGames);
      saveRow.appendChild(savePr);
      saveRow.appendChild(saveGamesBtn);
      editBlock.appendChild(saveRow);
      wrap.appendChild(editBlock);
    }

    // Results block
    var resultsBlock = el('div', 'comm-block');
    resultsBlock.appendChild(el('h3', '', viewed.kind === 'history' ? 'Edit Results — ' + viewed.label : 'Enter Results'));
    if (viewed.kind === 'upcoming') {
      resultsBlock.appendChild(el('p', '', 'This week hasn\'t started yet — results open up once it becomes the current week.'));
    } else if (!viewed.games.length) {
      resultsBlock.appendChild(el('p', '', 'No games posted yet.'));
    } else {
      var rrows = el('div', '');
      viewed.games.forEach(function (g, i) {
        var row = el('div', 'comm-row');
        row.appendChild(el('div', 'pr-matchup', 'Game ' + (i + 1) + ' &middot; ' + g.matchup));
        row.appendChild(el('div', 'pr-spread mono', g.spread));
        var choices = el('div', 'comm-choices');
        [g.teamA, g.teamB, 'Push'].forEach(function (opt) {
          var isPush = opt === 'Push';
          var val = isPush ? 'PUSH' : opt;
          var sel = draftWinners[i] === val;
          var btn = el('button', 'comm-btn' + (isPush ? ' push' : '') + (sel ? ' sel' : ''));
          btn.type = 'button';
          if (!isPush) {
            var c = teamColor(opt);
            btn.style.borderColor = c.primary;
            if (sel) { btn.style.background = c.primary; btn.style.color = contrastOn(c.primary); }
            btn.appendChild(teamBadge(opt));
          }
          btn.appendChild(el('span', 'pb-label', opt));
          btn.addEventListener('click', function () {
            draftWinners[i] = (draftWinners[i] === val) ? null : val;
            renderCommTools();
          });
          choices.appendChild(btn);
        });
        row.appendChild(choices);
        rrows.appendChild(row);
      });
      resultsBlock.appendChild(rrows);
      var graded = draftWinners.filter(Boolean).length;
      var willAutoAdvance = viewed.kind === 'current' && graded === viewed.games.length &&
        STATE.upcoming && STATE.upcoming.length > 0;
      if (willAutoAdvance) {
        var advanceNote = el('div', 'banner ok');
        advanceNote.style.marginTop = '8px';
        advanceNote.innerHTML = '<strong>All games graded.</strong> Saving will archive ' + viewed.label + ' and make ' + STATE.upcoming[0].label + ' the current week.';
        resultsBlock.appendChild(advanceNote);
      }
      var saveRow2 = el('div', 'save-bar');
      saveRow2.style.marginTop = '4px';
      saveRow2.style.borderRadius = '10px';
      saveRow2.appendChild(el('span', 'progress', graded + ' of ' + viewed.games.length + ' games graded'));
      var saveResBtn = el('button', 'save-btn', willAutoAdvance ? 'Save & Start ' + STATE.upcoming[0].label : 'Save Results');
      saveResBtn.type = 'button';
      saveResBtn.addEventListener('click', saveResults);
      saveRow2.appendChild(saveResBtn);
      resultsBlock.appendChild(saveRow2);
    }
    wrap.appendChild(resultsBlock);

    // Export block — the app has no way to write into Google Sheets itself
    // (a published page can't call the Sheets API, and there's no shared
    // login that would let it act on everyone's behalf), so this builds a
    // paste-ready block matching the per-week tab layout in the season
    // sheet: a Game row, a Spread row, a Winner row, then one row per player.
    var exportBlock = el('div', 'comm-block');
    exportBlock.appendChild(el('h3', '', 'Export to Sheet — ' + viewed.label));
    exportBlock.appendChild(el('p', '', 'Copies this week as tab-separated rows matching the season sheet\'s per-week tab layout. Paste into the top-left cell of that week\'s tab — spreadsheets split tabs into columns automatically.'));
    if (!viewed.games || !viewed.games.length) {
      exportBlock.appendChild(el('div', 'empty-note', 'No games to export for this week yet.'));
    } else {
      var tsv = buildSheetExport(viewed);
      var exportArea = document.createElement('textarea');
      exportArea.className = 'export-area mono';
      exportArea.readOnly = true;
      exportArea.value = tsv;
      exportArea.rows = Math.min(10, (viewed.games ? 3 : 0) + PLAYERS.length + 1);
      exportArea.addEventListener('click', function () { exportArea.select(); });
      exportBlock.appendChild(exportArea);
      var exportRow = el('div', 'auth-row');
      exportRow.style.marginTop = '8px';
      var copyBtn = el('button', 'ghost-btn', 'Copy to Clipboard');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', function () {
        var done = function () { showToast(viewed.label + ' copied — paste into the sheet.', 'ok'); };
        var fail = function () {
          exportArea.select();
          showToast('Couldn\'t auto-copy — text is selected, use your device\'s copy shortcut.', 'warn');
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(tsv).then(done, fail);
        } else {
          fail();
        }
      });
      exportRow.appendChild(copyBtn);
      exportBlock.appendChild(exportRow);
    }
    wrap.appendChild(exportBlock);

    // PIN reset block
    var pinBlock = el('div', 'comm-block');
    pinBlock.appendChild(el('h3', '', 'Reset a Player’s PIN'));
    pinBlock.appendChild(el('p', '', 'If someone forgets their PIN, reset it here — they’ll set a new one next time they select their name.'));
    var pinRow = el('div', 'pin-reset-row');
    var sel = document.createElement('select');
    PLAYERS.forEach(function (name) {
      var o = document.createElement('option');
      o.value = name; o.textContent = name + (STATE.pins[name] ? ' (PIN set)' : ' (no PIN)');
      sel.appendChild(o);
    });
    var resetBtn = el('button', 'danger-btn', 'Reset PIN');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', function () {
      var name = sel.value;
      if (!window.confirm('Reset ' + name + '’s PIN? They will need to set a new one.')) return;
      commAction('/api/commissioner/reset-pin', { player: name }, function () {
        showToast(name + '’s PIN was reset.', 'ok');
      });
    });
    pinRow.appendChild(sel); pinRow.appendChild(resetBtn);
    pinBlock.appendChild(pinRow);
    wrap.appendChild(pinBlock);
  }

  function mkInput(value, placeholder, cls) {
    var i = document.createElement('input');
    i.type = 'text';
    i.value = value || '';
    i.placeholder = placeholder;
    if (cls) i.className = cls;
    return i;
  }

  // Kickoff times are edited as the commissioner's own local wall-clock time
  // (an HTML datetime-local input has no timezone of its own) and stored as
  // a UTC ISO string, so comparisons against "now" on both client and server
  // are unambiguous. Assumes the commissioner is in the same timezone as the
  // games (true for this group) -- if that ever changes, this is the one
  // spot to revisit.
  function isoToLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function localInputToIso(val) {
    if (!val) return null;
    var d = new Date(val);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  function mkDateTimeInput(value, cls) {
    var i = document.createElement('input');
    i.type = 'datetime-local';
    if (cls) i.className = cls;
    i.value = isoToLocalInput(value);
    return i;
  }
  function picksAreLocked() {
    return !!(STATE.pickDeadline && new Date(STATE.pickDeadline).getTime() <= Date.now());
  }
  function fmtDeadline(iso) {
    return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function saveGames() {
    var viewed = getViewedWeek();
    var cleaned = draftGames.filter(function (g) { return (g.teamA || '').trim() && (g.teamB || '').trim(); })
      .map(function (g) { return { matchup: (g.matchup || '').trim(), teamA: g.teamA.trim(), teamB: g.teamB.trim(), spread: (g.spread || '').trim() }; });
    commAction('/api/commissioner/games', { weekKey: commWeekKey, games: cleaned }, function () {
      editingGames = false;
      showToast(viewed.kind === 'current' ? 'Week setup saved.' : viewed.label + ' updated.', 'ok');
    });
  }

  function startNewWeek() {
    var queued = STATE.upcoming && STATE.upcoming.length ? STATE.upcoming[0] : null;
    var label, useQueued;
    if (queued) {
      useQueued = true;
      label = queued.label;
      if (!window.confirm('Archive ' + STATE.week + ' into history and start "' + label + '" with its ' + queued.games.length + ' queued matchups? You\'ll still need to enter the spreads.')) return;
    } else {
      useQueued = false;
      label = window.prompt('Name for the new week (e.g. "Week 3"):', '');
      if (!label) return;
      if (!window.confirm('Archive ' + STATE.week + ' into history and start "' + label + '" fresh? This clears current picks and games.')) return;
    }
    commAction('/api/commissioner/new-week', { useQueued: useQueued, label: label }, function (res) {
      editingGames = false;
      showToast(res.week + ' started.', 'ok');
    });
  }

  function renderWeekNav() {
    document.getElementById('board-title').textContent = STATE.week + ' Board';
    var submitted = PLAYERS.filter(function (n) { return pickCount(n) > 0; }).length;
    var graded = STATE.winners.filter(Boolean).length;
    document.getElementById('week-meta').textContent = STATE.games.length + ' games · ' + submitted + '/' + PLAYERS.length + ' players in · ' + graded + '/' + STATE.games.length + ' graded';
  }

  function renderGames() {
    var wrap = document.getElementById('games');
    wrap.innerHTML = '';
    if (!STATE.games.length) {
      wrap.appendChild(el('div', 'empty-note', 'No games posted for ' + STATE.week + ' yet.'));
      return;
    }
    STATE.games.forEach(function (g, idx) {
      var winner = STATE.winners[idx];
      var card = el('div', 'game-card');
      var stripe = el('div', 'gc-stripe');
      var stripeA = document.createElement('span');
      stripeA.style.background = teamColor(g.teamA).primary;
      var stripeB = document.createElement('span');
      stripeB.style.background = teamColor(g.teamB).primary;
      stripe.appendChild(stripeA);
      stripe.appendChild(stripeB);
      card.appendChild(stripe);
      var head = el('div', 'gc-head');
      var left = el('div');
      left.appendChild(el('div', 'gc-index', 'GAME ' + (idx + 1)));
      left.appendChild(el('div', 'gc-matchup', g.matchup));
      head.appendChild(left);
      var right = el('div', 'gc-side');
      right.appendChild(el('span', 'gc-spread', g.spread));
      var statusText = winner ? (winner === 'PUSH' ? 'Push' : 'Final') : 'Pending';
      right.appendChild(el('span', 'gc-status' + (winner ? ' final' : ''), statusText));
      head.appendChild(right);
      card.appendChild(head);

      var picksWrap = el('div', 'picks');
      var tally = {};
      PLAYERS.forEach(function (name) {
        var pick = (STATE.picks[name] || [])[idx];
        var isLock = STATE.locks[name] === idx;
        var cls = 'pick';
        if (!pick) cls += ' empty';
        else if (winner && winner !== 'PUSH') cls += (pick === winner ? ' win' : ' loss');
        var row = el('div', cls);
        row.appendChild(el('span', 'who', name));
        var whatEl = document.createElement('span');
        whatEl.className = 'what';
        if (pick) {
          whatEl.appendChild(teamBadge(pick, 15));
          whatEl.appendChild(el('span', '', pick));
          if (isLock) whatEl.appendChild(el('span', 'star', '&#9733;'));
        } else {
          whatEl.textContent = 'No pick';
        }
        row.appendChild(whatEl);
        picksWrap.appendChild(row);
        if (pick) tally[pick] = (tally[pick] || 0) + 1;
      });
      card.appendChild(picksWrap);

      var sides = Object.keys(tally);
      if (sides.length) {
        var total = sides.reduce(function (s, k) { return s + tally[k]; }, 0);
        var cons = el('div', 'consensus');
        var bar = el('div', 'bar');
        sides.forEach(function (side) {
          var seg = document.createElement('span');
          seg.style.width = (100 * tally[side] / total) + '%';
          seg.style.background = teamColor(side).primary;
          bar.appendChild(seg);
        });
        cons.appendChild(bar);
        cons.appendChild(el('span', 'label', sides.map(function (s) { return tally[s] + ' ' + s; }).join(' · ')));
        card.appendChild(cons);
      }
      wrap.appendChild(card);
    });
  }

  function renderHistory() {
    var wrap = document.getElementById('history');
    wrap.innerHTML = '';
    if (!STATE.history.length) {
      wrap.appendChild(el('div', 'empty-note', 'No completed weeks yet — they’ll show up here once the commissioner starts a new week.'));
      return;
    }
    var list = el('div', 'history');
    STATE.history.slice().reverse().forEach(function (w) {
      var pts = scoreWeek(w.games, w.picks, w.locks, w.winners);
      var top = PLAYERS.map(function (n) { return { name: n, pts: pts[n] || 0 }; }).sort(function (a, b) { return b.pts - a.pts; })[0];
      var graded = w.winners.filter(Boolean).length;
      var row = el('div', 'history-row');
      row.appendChild(el('span', 'h-week', w.week));
      row.appendChild(el('span', 'h-detail', graded + '/' + w.games.length + ' graded &middot; top: ' + (top ? top.name + ' (' + fmtPts(top.pts) + ')' : '—')));
      list.appendChild(row);
    });
    wrap.appendChild(list);
  }

  function renderUpcoming() {
    var wrap = document.getElementById('upcoming');
    wrap.innerHTML = '';
    var list = STATE.upcoming || [];
    if (!list.length) {
      wrap.appendChild(el('div', 'empty-note', 'Nothing queued beyond the current week.'));
      return;
    }
    var box = el('div', 'upcoming-list');
    list.forEach(function (w) {
      var row = el('div', 'up-row');
      row.appendChild(el('span', 'u-label', w.label));
      row.appendChild(el('span', 'u-detail', w.games.length + ' matchups'));
      box.appendChild(row);
    });
    wrap.appendChild(box);
  }

  function renderFooter() {
    var f = document.getElementById('footer-note');
    var extra = '';
    if (STATE.updatedAt) {
      var when = new Date(STATE.updatedAt);
      extra = '<br>Last update: ' + (STATE.lastEditor ? STATE.lastEditor + ' · ' : '') + when.toLocaleString();
    }
    f.innerHTML = 'Straight against the spread &middot; ties on a pushed line go to no one' + extra;
  }

  // Runs each render step in isolation so that if one panel's render throws
  // for any reason, it doesn't take every panel *after* it down with it —
  // each tab section renders independently.
  function safeRender(name, fn) {
    try {
      fn();
    } catch (e) {
      try { console.error('render failed: ' + name, e); } catch (e2) {}
    }
  }

  function renderAll() {
    safeRender('capBanner', renderCapBanner);
    safeRender('standings', renderStandings);
    safeRender('roster', renderRoster);
    safeRender('pickerGate', renderPickerGate);
    safeRender('rosterStatus', renderRosterStatus);
    safeRender('commGate', renderCommGate);
    safeRender('weekNav', renderWeekNav);
    safeRender('games', renderGames);
    safeRender('stats', renderStats);
    safeRender('history', renderHistory);
    safeRender('upcoming', renderUpcoming);
    safeRender('footer', renderFooter);
    safeRender('tabDots', renderTabDots);
  }

  var toastTimer = null;
  function showToast(msg, kind) {
    var section = document.getElementById('cap-banner-section');
    var banner = document.getElementById('cap-banner');
    section.hidden = false;
    banner.className = 'banner ' + (kind || 'warn');
    banner.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(renderCapBanner, 4500);
  }

  // Runs a commissioner-only mutation: attaches the stored commissioner
  // token, POSTs it, refreshes STATE from the server on success, and
  // surfaces a 401 (expired/invalid token) by bouncing back to the PIN gate
  // instead of silently failing.
  function commAction(path, body, onOk) {
    var payload = Object.assign({ token: getToken('commissioner') }, body || {});
    apiPost(path, payload).then(function (res) {
      return refreshState().then(function () { onOk(res); });
    }).catch(function (err) {
      if (err.status === 401) {
        clearToken('commissioner');
        commErr = 'Your commissioner session expired — enter the PIN again.';
        renderCommGate();
      } else {
        showToast(err.message || 'Could not save just now — try again in a moment.', 'err');
      }
    });
  }

  function savePicks() {
    if (!currentPlayer || !draft) return;
    var token = getToken(currentPlayer);
    if (!token) { showToast('Enter your PIN again to save.', 'err'); renderPickerGate(); return; }
    var saveBtn = document.getElementById('save-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    apiPost('/api/picks', { token: token, picks: draft.slice(), lock: draftLock })
      .then(function () { return refreshState(); })
      .then(function () {
        showToast('Picks saved for ' + currentPlayer + '.', 'ok');
        renderAll();
      })
      .catch(function (err) {
        if (err.status === 401) {
          clearToken(currentPlayer);
          pickerErr = 'Your session expired — enter your PIN again.';
          renderPickerGate();
        } else {
          showToast(err.message || 'Could not save just now — try again in a moment.', 'err');
          renderPicker();
        }
      });
  }

  function saveResults() {
    var viewed = getViewedWeek();
    if (viewed.kind === 'upcoming') { showToast('This week hasn\'t been played yet.', 'err'); return; }
    commAction('/api/commissioner/results', { weekKey: commWeekKey, winners: draftWinners.slice() }, function (res) {
      if (res.advanced) {
        showToast('All games graded — ' + res.archivedWeek + ' archived, ' + res.newWeek + ' is now current. Set its spreads when ready.', 'ok');
        commWeekKey = 'current';
      } else if (viewed.kind === 'history') {
        showToast(viewed.label + ' results updated — standings recalculated.', 'ok');
      } else {
        showToast(res.allGraded
          ? 'Results saved — standings updated. Queue next week\'s matchups to auto-advance next time.'
          : 'Results saved — standings updated.', 'ok');
      }
    });
  }

  // ---- Bootstrap ------------------------------------------------------

  // Pulls the latest state from the server and updates every dependent bit
  // of local UI state that used to come from the embedded state-data blob
  // (PLAYERS, the draft winners the Commissioner tab edits, etc.).
  function refreshState() {
    return apiGet('/api/state').then(function (data) {
      STATE = data;
      PLAYERS = STATE.players;
      var v = getViewedWeek();
      draftWinners = v.winners ? v.winners.slice() : [];
      capState = 'ready';
    });
  }

  function boot() {
    refreshState().then(function () {
      try { currentPlayer = localStorage.getItem('secats_player'); } catch (e) {}
      if (PLAYERS.indexOf(currentPlayer) === -1) currentPlayer = null;

      try { document.getElementById('save-btn').addEventListener('click', savePicks); } catch (e) {}
      safeRender('wireTabDock', wireTabDock);
      renderAll();
      if (currentPlayer) safeRender('selectPlayer', function () { selectPlayer(currentPlayer); });

      // Light polling so the Board/Standings/roster status stay roughly live
      // for anyone with the page open while others are picking or the
      // commissioner is grading — skipped while someone is actively editing
      // picks or the commissioner tools, so a poll never clobbers a form
      // mid-edit.
      setInterval(function () {
        if (editingGames) return;
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
        refreshState().then(renderAll).catch(function () {});
      }, 20000);
    }).catch(function () {
      capState = 'error';
      renderCapBanner();
      setTimeout(boot, 4000);
    });
  }

  boot();
})();
