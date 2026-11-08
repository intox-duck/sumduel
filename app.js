/* Sum Duel: client app. Vanilla JS, no build step. Works offline; syncs to /api when signed in. */
(function () {
  'use strict';

  // =====================================================================
  // Utilities
  // =====================================================================
  var $ = function (id) { return document.getElementById(id); };
  var qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function utcDay() { return new Date().toISOString().slice(0, 10); }
  function fmtS(s, d) { return (s == null || !isFinite(s)) ? '–' : Number(s).toFixed(d == null ? 2 : d) + ' s'; }
  function fmtDate(iso) {
    var d = new Date(iso), now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    var t = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (sameDay) return 'Today ' + t;
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday ' + t;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  var toastT = 0;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 2600);
  }
  var PENALTY = 3;
  var COL = [
    { c: 'var(--p1)', d: 'var(--p1-deep)', g: 'var(--p1-glow)' },
    { c: 'var(--p2)', d: 'var(--p2-deep)', g: 'var(--p2-glow)' }
  ];
  function paintPlayer(el, pi) { el.style.setProperty('--pc', COL[pi].c); el.style.setProperty('--pd', COL[pi].d); el.style.setProperty('--pg', COL[pi].g); }

  // =====================================================================
  // Settings
  // =====================================================================
  var DEFAULTS = { names: ['Player 1', 'Player 2'], mode: 'split', ops: ['+', '−', '×', '÷'], level: 'medium', n: 10, sound: true, haptics: true, theme: 'paper' };
  var S = Object.assign({}, DEFAULTS, store.get('sumduel', {}));
  if (!Array.isArray(S.ops) || !S.ops.length) S.ops = DEFAULTS.ops.slice();
  if (!Array.isArray(S.names)) S.names = DEFAULTS.names.slice();
  function save() { store.set('sumduel', S); }
  function applyTheme() {
    // v2.1 textbook redesign: 'paper' (default) or 'night' (blackboard). Old saved 'dark'/'light' values fall back to paper.
    var night = S.theme === 'night';
    document.documentElement.setAttribute('data-theme', night ? 'night' : 'paper');
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = night ? '#1E2A24' : '#F7F3E8';
  }
  applyTheme();

  // =====================================================================
  // Sound (WebAudio blips, zero assets) + haptics
  // =====================================================================
  var AC = null;
  function ac() {
    if (!S.sound) return null;
    try { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) { AC = null; }
    return AC;
  }
  function tone(freq, dur, type, vol, when) {
    var a = ac(); if (!a) return;
    var t0 = a.currentTime + (when || 0);
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  var sfx = {
    tick: function () { tone(660, 0.08, 'square', 0.05); },
    go: function () { tone(990, 0.18, 'square', 0.07); },
    good: function () { tone(880, 0.07, 'triangle', 0.09); tone(1320, 0.09, 'triangle', 0.07, 0.05); },
    bad: function () { tone(160, 0.22, 'sawtooth', 0.07); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.22, 'triangle', 0.09, i * 0.09); }); },
    done: function () { tone(740, 0.12, 'triangle', 0.08); tone(988, 0.16, 'triangle', 0.08, 0.1); }
  };
  function buzz(ms) { if (!S.haptics) return; try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }

  // Keep the screen awake during play (supported browsers only)
  var wake = null;
  function wakeOn() { try { if ('wakeLock' in navigator && !wake) navigator.wakeLock.request('screen').then(function (w) { wake = w; w.addEventListener('release', function () { wake = null; }); }).catch(function () {}); } catch (e) {} }
  function wakeOff() { try { wake && wake.release(); } catch (e) {} wake = null; }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && G && G.live) wakeOn(); });

  // =====================================================================
  // Confetti (canvas, ~2 s, neon)
  // =====================================================================
  function confetti(colors) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var cv = $('fx'), cx = cv.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
    cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    var P = [], N = innerWidth < 600 ? 90 : 160;
    for (var i = 0; i < N; i++) P.push({ x: W / 2 + (Math.random() - .5) * W * .3, y: H * .35, vx: (Math.random() - .5) * 18 * dpr, vy: (-Math.random() * 16 - 6) * dpr, s: (4 + Math.random() * 6) * dpr, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[i % colors.length] });
    var t0 = performance.now();
    (function step(t) {
      var k = (t - t0) / 2200; cx.clearRect(0, 0, W, H);
      if (k > 1) return;
      cx.globalAlpha = 1 - k * k;
      P.forEach(function (p) { p.vy += .55 * dpr; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c; cx.shadowColor = p.c; cx.shadowBlur = 8 * dpr; cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); cx.restore(); });
      requestAnimationFrame(step);
    })(t0);
  }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  // =====================================================================
  // API + auth + sync
  // =====================================================================
  var ME = store.get('sd_me', null);
  function api(path, body) {
    var opts = { credentials: 'same-origin', headers: {} };
    if (body !== undefined) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    var ctrl = window.AbortController ? new AbortController() : null;
    if (ctrl) { opts.signal = ctrl.signal; setTimeout(function () { ctrl.abort(); }, 12000); }
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('Error ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function setMe(u) {
    ME = u || null;
    if (ME) store.set('sd_me', ME); else store.del('sd_me');
    paintWho();
  }
  function paintWho() {
    var w = $('who');
    if (ME) { w.innerHTML = '<span class="av">' + esc((ME.name || '?')[0].toUpperCase()) + '</span><span>' + esc(ME.name) + '</span>'; }
    else { w.innerHTML = '<span class="av">?</span><span>Sign in</span>'; }
  }

  // Battles: local cache (all battles, newest first) + pending queue for the server.
  var LOCAL_MAX = 1000;
  function localBattles() { return store.get('sd_battles', []); }
  function setLocalBattles(list) { store.set('sd_battles', list.slice(0, LOCAL_MAX)); }
  function pending() { return store.get('sd_pending', []); }
  function recordBattle(b) {
    b.cid = b.cid || uid(); b.at = b.at || new Date().toISOString();
    var list = localBattles(); list.unshift(b); setLocalBattles(list);
    var p = pending(); p.push(b); store.set('sd_pending', p.slice(-LOCAL_MAX));
    return flush().then(function (ok) { return ok; });
  }
  var flushing = null;
  function flush() {
    if (!ME) return Promise.resolve(false);
    if (flushing) return flushing;
    var p = pending(); if (!p.length) return Promise.resolve(true);
    flushing = api('/api/battles', { battles: p.slice(0, 200) }).then(function () {
      var sent = {}; p.slice(0, 200).forEach(function (b) { sent[b.cid] = 1; });
      store.set('sd_pending', pending().filter(function (b) { return !sent[b.cid]; }));
      return true;
    }).catch(function (e) { if (e.status === 401) setMe(null); return false; })
      .then(function (r) { flushing = null; return r; });
    return flushing;
  }
  function pullBattles() {
    if (!ME) return Promise.resolve(localBattles());
    return flush().then(function () { return api('/api/battles?limit=1000'); }).then(function (j) {
      // Merge server + any local not yet acknowledged
      var seen = {}, merged = [];
      (j.battles || []).concat(pending()).forEach(function (b) { if (b && b.cid && !seen[b.cid]) { seen[b.cid] = 1; merged.push(b); } });
      merged.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      setLocalBattles(merged);
      return merged;
    }).catch(function () { return localBattles(); });
  }
  window.addEventListener('online', function () { flush(); });

  // =====================================================================
  // Question generation (seeded so both players / everyone get the same set)
  // =====================================================================
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }
  var RANGES = {
    easy: { add: [1, 10, 1, 10], mul: [2, 5, 1, 10] },
    medium: { add: [10, 99, 2, 99], mul: [2, 12, 2, 12] },
    hard: { add: [100, 999, 11, 999], mul: [6, 25, 3, 12] }
  };
  function makeQuestions(n, ops, level, seed) {
    var r = rng(seed), R = RANGES[level] || RANGES.medium;
    var ri = function (a, b) { return a + Math.floor(r() * (b - a + 1)); };
    var out = [], last = '';
    while (out.length < n) {
      var op = ops[Math.floor(r() * ops.length)], text, ans, a, b;
      if (op === '+' || op === '−') {
        a = ri(R.add[0], R.add[1]); b = ri(R.add[2], R.add[3]);
        if (op === '+') { text = a + ' + ' + b; ans = a + b; } else { text = (a + b) + ' − ' + b; ans = a; }
      } else {
        a = ri(R.mul[0], R.mul[1]); b = ri(R.mul[2], R.mul[3]);
        if (r() < .5) { var t = a; a = b; b = t; }
        if (op === '×') { text = a + ' × ' + b; ans = a * b; }
        else { if (a === 1 && b !== 1) { var u = a; a = b; b = u; } text = (a * b) + ' ÷ ' + a; ans = b; }
      }
      if (text === last) continue;
      last = text; out.push({ text: text, ans: String(ans), op: op });
    }
    return out;
  }
  // Truth or Lie: an equation that's right ~50% of the time; lies are near-misses.
  function makeTol(n, ops, level, seed) {
    var base = makeQuestions(n, ops, level, seed), r = rng(seed ^ 0x5bd1e995);
    return base.map(function (q) {
      var truth = r() < .5, shown = Number(q.ans);
      if (!truth) {
        var deltas = [1, 2, 10, -1, -2, -10];
        if (q.op === '×' || q.op === '÷') deltas = deltas.concat([Number(q.text.split(' ')[2]) || 3, -(Number(q.text.split(' ')[2]) || 3)]);
        var d = deltas[Math.floor(r() * deltas.length)];
        shown = shown + d; if (shown < 0) shown = Number(q.ans) + Math.abs(d);
      }
      return { text: q.text + ' = ' + shown, truth: truth };
    });
  }

  // =====================================================================
  // Router
  // =====================================================================
  var VIEWS = ['home', 'setup', 'record', 'boards', 'chat', 'account'];
  var GAMESCREENS = ['play', 'handoff', 'results'];
  var setupFor = 'duel';
  function showScreen(id) {
    VIEWS.forEach(function (v) { $('v-' + v).classList.toggle('hidden', v !== id); });
    GAMESCREENS.forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
    document.body.classList.toggle('ingame', GAMESCREENS.indexOf(id) >= 0);
    var tab = id === 'setup' ? 'home' : id;
    qsa('[data-tab]').forEach(function (a) { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (GAMESCREENS.indexOf(id) < 0) window.scrollTo(0, 0);
  }
  function route() {
    var h = (location.hash || '#/').replace(/^#\/?/, '');
    if (G) abortGame();
    chatStop();
    if (h === 'record') { showScreen('record'); renderRecord(); }
    else if (h === 'boards') { showScreen('boards'); renderBoards(); }
    else if (h === 'account') { showScreen('account'); renderAccount(); }
    else if (h === 'chat') { showScreen('chat'); renderChat(); }
    else if (h === 'duel' || h === 'tol') { setupFor = h; showScreen('setup'); renderSetup(); }
    else { showScreen('home'); renderHome(); }
  }
  window.addEventListener('hashchange', route);
  function go(h) { if (location.hash === '#/' + h) route(); else location.hash = '#/' + h; }

  // =====================================================================
  // Home
  // =====================================================================
  qsa('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () {
      var g = b.dataset.go; ac();
      if (g === 'duel' || g === 'tol') go(g);
      else if (g === 'sprint') startSoloGame('sprint');
      else if (g === 'daily') startSoloGame('daily');
    });
  });
  function renderHome() {
    var day = utcDay(), played = localBattles().some(function (b) { return b.game === 'daily' && b.day === day; });
    var tag = $('dailyTag'); tag.textContent = played ? 'DONE ✓' : 'TODAY'; tag.classList.toggle('live', !played);
    var st = computeStats(localBattles());
    var el = $('homeStats');
    if (!st.total) { el.innerHTML = ''; return; }
    el.innerHTML = '<p class="kicker"><b>§3</b> Your numbers</p>' + kpiRow(st) +
      (ME ? '' : '<p class="foot">These stats only live on this device for now. <a href="#/account">Sign in</a> to keep them for good.</p>');
  }
  function kpiRow(st) {
    return '<div class="kpis">' +
      '<div class="kpi c1"><div class="k">Battles</div><div class="v">' + st.total + '</div><div class="s">' + st.duels + ' head-to-head</div></div>' +
      '<div class="kpi c2"><div class="k">Win rate</div><div class="v">' + (st.duels ? Math.round(st.w / st.duels * 100) + '%' : '–') + '</div><div class="s">' + st.w + 'W · ' + st.l + 'L' + (st.d ? ' · ' + st.d + 'D' : '') + '</div></div>' +
      '<div class="kpi"><div class="k">Best Sprint</div><div class="v">' + (st.bestSprint == null ? '–' : st.bestSprint) + '</div><div class="s">correct in 60 s</div></div>' +
      '<div class="kpi"><div class="k">Win streak</div><div class="v">' + st.streak + '</div><div class="s">best ever ' + st.bestStreak + '</div></div>' +
      '</div>';
  }

  // =====================================================================
  // Setup (Duel + Truth or Lie)
  // =====================================================================
  function bindSeg(id, key, cast, after) {
    var el = $(id);
    var paint = function () { qsa('button', el).forEach(function (b) { b.setAttribute('aria-pressed', String(cast(b.dataset.v) === S[key])); }); };
    el.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; S[key] = cast(b.dataset.v); save(); paint(); after && after(); });
    paint();
  }
  bindSeg('mode', 'mode', String, modeHint);
  bindSeg('level', 'level', String);
  bindSeg('count', 'n', Number);
  function modeHint() {
    $('modeHint').textContent = S.mode === 'split'
      ? 'Lay the phone flat between you. The screen splits in two and you race at the same time.'
      : 'One player goes, then passes the phone. You get the same questions and the fastest total time wins.';
  }
  modeHint();
  var opsEl = $('ops');
  function paintOps() { qsa('button', opsEl).forEach(function (b) { b.setAttribute('aria-pressed', String(S.ops.indexOf(b.dataset.v) >= 0)); }); }
  opsEl.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return; var v = b.dataset.v;
    if (S.ops.indexOf(v) >= 0) { if (S.ops.length > 1) S.ops = S.ops.filter(function (o) { return o !== v; }); else toast('Keep at least one operation'); }
    else S.ops.push(v);
    save(); paintOps();
  });
  paintOps();
  $('n0').addEventListener('input', function (e) { S.names[0] = e.target.value; save(); });
  $('n1').addEventListener('input', function (e) { S.names[1] = e.target.value; save(); });
  qsa('[data-back]').forEach(function (b) { b.addEventListener('click', function () { go(''); }); });

  function renderSetup() {
    var tol = setupFor === 'tol';
    $('setupTitle').textContent = tol ? 'Truth or Lie' : 'The Duel';
    $('setupKicker').textContent = tol ? 'Set up the buzzer round' : 'Set up the duel';
    $('setupLede').textContent = tol
      ? 'One equation goes up for both of you. Hit TRUE or LIE first and get it right to score. Call it wrong and you’re locked out for that round. First to seven wins.'
      : 'Two players, one phone. You get the same questions on separate clocks, and every wrong answer adds three seconds.';
    $('f-mode').classList.toggle('hidden', tol);
    $('f-count').classList.toggle('hidden', tol);
    $('start').textContent = tol ? 'Start Truth or Lie' : 'Start duel';
    $('kbdNote').textContent = tol ? 'On a keyboard, P1 presses A (true) / S (lie) and P2 presses K (true) / L (lie).' : 'On a keyboard, P1 types on the number row and P2 on the numpad.';
    if (ME && (!S.names[0] || S.names[0] === 'Player 1')) { S.names[0] = ME.name; save(); }
    $('n0').value = S.names[0] || ''; $('n1').value = S.names[1] || '';
    $('n0').placeholder = ME ? ME.name : 'Player 1'; $('n1').placeholder = 'Player 2';
    // Rival quick-picks from history
    var st = computeStats(localBattles()), r = $('rivals');
    r.innerHTML = st.rivals.slice(0, 6).map(function (x) { return '<button type="button" data-n="' + esc(x.name) + '">vs ' + esc(x.name) + '</button>'; }).join('');
  }
  $('rivals').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; S.names[1] = b.dataset.n; $('n1').value = b.dataset.n; save(); });
  $('start').addEventListener('click', function () { ac(); if (setupFor === 'tol') startTol(); else startDuel(); });

  // =====================================================================
  // Pad-game engine (Duel split/turns, Sprint, Daily)
  // =====================================================================
  var G = null, token = 0, raf = 0, series = {};
  function playerNames() { return [0, 1].map(function (i) { return (S.names[i] || '').trim() || (i === 0 && ME ? ME.name : 'Player ' + (i + 1)); }); }

  function abortGame() { token++; if (G && G.timer) clearInterval(G.timer); G = null; cancelAnimationFrame(raf); wakeOff(); }

  function startDuel() {
    abortGame(); token++;
    var names = playerNames();
    G = { kind: 'duel', token: token, mode: S.mode, n: S.n, names: names, cfg: { ops: S.ops.slice(), level: S.level, n: S.n },
      qs: makeQuestions(S.n, S.ops.slice(), S.level, (Math.random() * 2147483647) | 0),
      p: [0, 1].map(newP), ui: [], live: true };
    if (G.mode === 'split') layoutSplit(); else handoff(0);
  }
  function startSoloGame(kind) {
    abortGame(); token++;
    var name = ME ? ME.name : ((S.names[0] || '').trim() || 'You');
    if (kind === 'daily') {
      var day = utcDay();
      var already = localBattles().some(function (b) { return b.game === 'daily' && b.day === day; });
      G = { kind: 'daily', token: token, mode: 'solo', n: 20, names: [name], day: day, practice: already,
        cfg: { ops: ['+', '−', '×', '÷'], level: 'medium', n: 20 },
        qs: makeQuestions(20, ['+', '−', '×', '÷'], 'medium', hashStr('sumduel-daily-' + day)), p: [newP()], ui: [], live: true };
      if (already) toast('You’ve played today’s Daily. This run is practice and won’t count.');
    } else {
      G = { kind: 'sprint', token: token, mode: 'solo', n: 400, names: [name], limit: 60,
        cfg: { ops: ['+', '−', '×', '÷'], level: 'medium' },
        qs: makeQuestions(400, ['+', '−', '×', '÷'], 'medium', (Math.random() * 2147483647) | 0), p: [newP()], ui: [], live: true };
    }
    layoutSolo(0);
  }
  function newP() { return { idx: 0, input: '', start: 0, end: 0, wrong: 0, running: false, done: false, splits: [], streak: 0, bestStreak: 0, wrongBy: {}, last: 0 }; }

  function makeHalf(pi, flip, solo) {
    var el = document.createElement('section');
    el.className = 'half' + (flip ? ' flip' : '') + (solo ? ' solo' : '');
    paintPlayer(el, pi);
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
    el.innerHTML =
      '<div class="hud"><span class="nm"></span><span class="prog"></span><span class="clock">0.0 s</span></div>' +
      '<div class="bar"><i></i></div>' +
      '<div class="stage"><div class="q"></div><div class="ans empty">?</div><div class="streak"></div><div class="pen">+' + PENALTY + ' s</div></div>' +
      '<div class="pad">' + keys.map(function (k) {
        return '<button data-k="' + k + '"' + (k === 'C' || k === '⌫' ? ' class="fn"' : '') + ' aria-label="' + (k === 'C' ? 'Clear' : k === '⌫' ? 'Delete' : k) + '">' + k + '</button>';
      }).join('') + '</div>' +
      '<div class="cover"><div class="big"></div><div class="sub"></div></div>';
    el.querySelector('.nm').textContent = G.names[pi];
    el.querySelector('.pad').addEventListener('pointerdown', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      e.preventDefault(); hit(b); press(pi, b.dataset.k);
    });
    var ui = { el: el, q: el.querySelector('.q'), ans: el.querySelector('.ans'), clock: el.querySelector('.clock'), prog: el.querySelector('.prog'),
      bar: el.querySelector('.bar i'), streak: el.querySelector('.streak'), cover: el.querySelector('.cover'), big: el.querySelector('.cover .big'), sub: el.querySelector('.cover .sub') };
    G.ui[pi] = ui; paintQ(pi);
    return el;
  }
  function hit(b) { b.classList.add('hit'); setTimeout(function () { b.classList.remove('hit'); }, 90); }
  function quitBtn() { var b = document.createElement('button'); b.className = 'chipbtn'; b.textContent = 'Quit'; b.addEventListener('click', function () { abortGame(); route(); }); return b; }

  function layoutSplit() {
    var play = $('play'); play.innerHTML = '';
    play.appendChild(makeHalf(1, true, false));
    var mid = document.createElement('div'); mid.className = 'mid'; mid.appendChild(quitBtn()); play.appendChild(mid);
    play.appendChild(makeHalf(0, false, false));
    showScreen('play'); wakeOn(); countdown([0, 1]);
  }
  function layoutSolo(pi) {
    var play = $('play'); play.innerHTML = '';
    var half = makeHalf(pi, false, true);
    var top = document.createElement('div'); top.className = 'solo-top'; top.appendChild(quitBtn()); half.appendChild(top);
    var kh = document.createElement('div'); kh.className = 'keyhint'; kh.textContent = 'TYPE ANSWERS · ⌫ DELETE · ESC CLEAR'; half.appendChild(kh);
    if (G.kind === 'sprint') { G.ui[pi].clock.textContent = '60'; }
    play.appendChild(half);
    showScreen('play'); wakeOn(); countdown([pi]);
  }
  function handoff(pi) {
    var h = $('handoff'); paintPlayer(h, pi);
    $('hoKick').textContent = pi === 0 ? 'Round one' : 'Round two';
    $('hoTitle').textContent = G.names[pi] + '’s turn';
    $('hoText').textContent = pi === 0
      ? 'Hand the phone to ' + G.names[0] + '. That’s ' + G.n + ' questions, and the clock starts after the countdown.'
      : 'Pass the phone to ' + G.names[1] + '. Same questions. No peeking at the other score until the end.';
    showScreen('handoff');
    $('hoGo').onclick = function () {
      var play = $('play'); play.innerHTML = '';
      var half = makeHalf(pi, false, true);
      var top = document.createElement('div'); top.className = 'solo-top'; top.appendChild(quitBtn()); half.appendChild(top);
      play.appendChild(half); showScreen('play'); wakeOn(); countdown([pi]);
    };
  }

  function countdown(list) {
    var my = G.token, steps = ['3', '2', '1', 'GO'], i = 0;
    (function tick() {
      if (!G || G.token !== my) return;
      if (i < steps.length) {
        list.forEach(function (pi) { var u = G.ui[pi]; u.cover.classList.remove('hidden'); u.big.textContent = steps[i]; u.sub.textContent = i === 0 ? G.names[pi] : (G.kind === 'sprint' ? '60 seconds' : G.kind === 'daily' ? 'Daily · ' + G.day : ''); });
        if (i < 3) sfx.tick(); else sfx.go();
        i++; setTimeout(tick, i === steps.length ? 450 : 700);
      } else {
        var now = performance.now();
        list.forEach(function (pi) { var p = G.p[pi]; p.start = now; p.last = now; p.running = true; G.ui[pi].cover.classList.add('hidden'); paintQ(pi); });
        loop();
      }
    })();
  }
  function elapsed(p) { return ((p.done ? p.end : performance.now()) - p.start) / 1000 + p.wrong * PENALTY; }
  function loop() {
    cancelAnimationFrame(raf);
    (function step() {
      if (!G || !G.p) return;
      var any = false;
      G.p.forEach(function (p, pi) {
        if (!p.running) return; any = true;
        if (G.kind === 'sprint') {
          var left = G.limit - (performance.now() - p.start) / 1000;
          G.ui[pi].clock.textContent = Math.max(0, left).toFixed(1);
          G.ui[pi].bar.style.width = Math.min(100, (1 - left / G.limit) * 100) + '%';
          if (left <= 0) finish(pi);
        } else G.ui[pi].clock.textContent = elapsed(p).toFixed(1) + ' s';
      });
      if (any) raf = requestAnimationFrame(step);
    })();
  }
  function paintQ(pi) {
    var p = G.p[pi], u = G.ui[pi]; if (!u) return;
    var q = G.qs[Math.min(p.idx, G.qs.length - 1)];
    u.q.textContent = q.text + ' =';
    u.ans.textContent = p.input || '?'; u.ans.classList.toggle('empty', !p.input);
    if (G.kind === 'sprint') { u.prog.textContent = p.idx + ' correct'; }
    else { u.prog.textContent = Math.min(p.idx + 1, G.n) + ' / ' + G.n; u.bar.style.width = (p.idx / G.n * 100) + '%'; }
    u.streak.textContent = p.streak >= 3 ? p.streak + ' IN A ROW' : '';
  }
  function press(pi, k) {
    if (!G || !G.p || !G.p[pi]) return;
    var p = G.p[pi]; if (!p.running) return;
    if (k === 'C') { p.input = ''; paintQ(pi); return; }
    if (k === '⌫') { p.input = p.input.slice(0, -1); paintQ(pi); return; }
    if (p.input.length >= 6) return;
    p.input += k;
    var q = G.qs[p.idx], ans = q.ans;
    if (p.input === ans) {
      var now = performance.now();
      p.splits.push(Math.round(now - p.last) / 1000); p.last = now;
      p.idx++; p.input = ''; p.streak++; if (p.streak > p.bestStreak) p.bestStreak = p.streak;
      sfx.good();
      var el = G.ui[pi].el; el.classList.add('good'); setTimeout(function () { el.classList.remove('good'); }, 120);
      if (G.kind !== 'sprint' && p.idx >= G.n) { finish(pi); return; }
      paintQ(pi);
    } else if (p.input.length >= ans.length) {
      p.wrong++; p.input = ''; p.streak = 0; p.wrongBy[q.op] = (p.wrongBy[q.op] || 0) + 1;
      var e2 = G.ui[pi].el; e2.classList.remove('wrong'); void e2.offsetWidth; e2.classList.add('wrong');
      setTimeout(function () { e2.classList.remove('wrong'); }, 350);
      sfx.bad(); buzz(70); paintQ(pi);
    } else paintQ(pi);
  }
  function finish(pi) {
    var p = G.p[pi], u = G.ui[pi];
    p.end = performance.now(); p.running = false; p.done = true;
    u.bar.style.width = '100%';
    u.cover.classList.remove('hidden'); u.big.style.fontSize = 'min(17vw,11vh)';
    var my = G.token;
    if (G.kind === 'sprint') {
      u.big.textContent = p.idx; u.sub.textContent = 'correct in 60 s'; sfx.done(); wakeOff();
      setTimeout(function () { if (G && G.token === my) resultsSolo(); }, 1300); return;
    }
    u.clock.textContent = elapsed(p).toFixed(1) + ' s'; u.big.textContent = elapsed(p).toFixed(1) + ' s';
    sfx.done();
    if (G.kind === 'daily') { u.sub.textContent = 'Finished'; wakeOff(); setTimeout(function () { if (G && G.token === my) resultsSolo(); }, 1300); return; }
    var other = G.p[1 - pi];
    if (G.mode === 'split') {
      u.sub.textContent = other.done ? '' : 'Done. Waiting for ' + G.names[1 - pi] + '…';
      if (G.p.every(function (x) { return x.done; })) { G.ui.forEach(function (x) { x.sub.textContent = ''; }); setTimeout(function () { if (G && G.token === my) resultsDuel(); }, 1100); }
    } else {
      u.sub.textContent = 'Finished';
      setTimeout(function () { if (!G || G.token !== my) return; if (pi === 0) handoff(1); else resultsDuel(); }, 1300);
    }
  }

  // ---------- keyboard (desktop) ----------
  document.addEventListener('keydown', function (e) {
    if (!G || e.metaKey || e.ctrlKey || e.altKey) return;
    if ($('play').classList.contains('hidden')) return;
    if (G.kind === 'tol') return tolKey(e);
    // Map on physical key (e.code) so the numpad works with NumLock on or off.
    var k = null, code = e.code || '', isPad = code.indexOf('Numpad') === 0;
    var m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
    if (m) k = m[1];
    else if (!code && /^[0-9]$/.test(e.key)) k = e.key;
    else if (e.key === 'Backspace' || code === 'NumpadDecimal' || code === 'NumpadSubtract') k = '⌫';
    else if (e.key === 'Escape' || e.key === 'Delete' || code === 'NumpadMultiply') k = 'C';
    if (!k) return;
    e.preventDefault();
    var pi = 0;
    if (G.mode === 'split') pi = isPad ? 1 : 0;
    else pi = G.p.findIndex ? G.p.findIndex(function (p) { return p.running; }) : 0;
    if (pi < 0) return;
    var btn = G.ui[pi] && G.ui[pi].el.querySelector('[data-k="' + k + '"]'); if (btn) hit(btn);
    press(pi, k);
  });

  // =====================================================================
  // Truth or Lie (split-screen buzzer)
  // =====================================================================
  var TOL_TARGET = 7;
  function startTol() {
    abortGame(); token++;
    var names = playerNames();
    G = { kind: 'tol', token: token, mode: 'split', names: names, cfg: { ops: S.ops.slice(), level: S.level },
      qs: makeTol(80, S.ops.slice(), S.level, (Math.random() * 2147483647) | 0), round: 0,
      sc: [0, 0], wrong: [0, 0], locked: [false, false], open: false, ui: [], live: true, rt: [[], []], t0: 0 };
    var play = $('play'); play.innerHTML = '';
    play.appendChild(tolHalf(1, true));
    var mid = document.createElement('div'); mid.className = 'mid'; mid.appendChild(quitBtn()); play.appendChild(mid);
    play.appendChild(tolHalf(0, false));
    showScreen('play'); wakeOn();
    var my = G.token, steps = ['3', '2', '1', 'GO'], i = 0;
    (function tick() {
      if (!G || G.token !== my) return;
      if (i < steps.length) { G.ui.forEach(function (u, pi) { u.cover.classList.remove('hidden'); u.big.textContent = steps[i]; u.sub.textContent = i === 0 ? G.names[pi] : ''; }); i < 3 ? sfx.tick() : sfx.go(); i++; setTimeout(tick, i === steps.length ? 450 : 700); }
      else { G.ui.forEach(function (u) { u.cover.classList.add('hidden'); }); tolNext(); }
    })();
  }
  function tolHalf(pi, flip) {
    var el = document.createElement('section');
    el.className = 'half' + (flip ? ' flip' : ''); paintPlayer(el, pi);
    el.innerHTML = '<div class="hud"><span class="nm"></span><span class="tol-score"></span><span class="clock">0</span></div>' +
      '<div class="tol-stage"><div class="tol-eq">…</div><div class="tol-flash"></div></div>' +
      '<div class="tol-btns"><button class="t" data-a="1">TRUE</button><button class="f" data-a="0">LIE</button></div>' +
      '<div class="keyhint">' + (pi === 0 ? 'A = TRUE · S = LIE' : 'K = TRUE · L = LIE') + '</div>' +
      '<div class="cover"><div class="big"></div><div class="sub"></div></div>';
    el.querySelector('.nm').textContent = G.names[pi];
    el.querySelector('.tol-score').innerHTML = new Array(TOL_TARGET + 1).join('<i></i>');
    el.querySelector('.tol-btns').addEventListener('pointerdown', function (e) {
      var b = e.target.closest('button'); if (!b) return; e.preventDefault(); hit(b); tolAnswer(pi, b.dataset.a === '1');
    });
    G.ui[pi] = { el: el, eq: el.querySelector('.tol-eq'), flash: el.querySelector('.tol-flash'), clock: el.querySelector('.clock'), pips: el.querySelector('.tol-score'),
      cover: el.querySelector('.cover'), big: el.querySelector('.cover .big'), sub: el.querySelector('.cover .sub') };
    return el;
  }
  function tolPaint() {
    G.ui.forEach(function (u, pi) {
      qsa('i', u.pips).forEach(function (pip, k) { pip.classList.toggle('on', k < G.sc[pi]); });
      u.clock.textContent = G.sc[pi];
      u.el.classList.toggle('locked', G.locked[pi]);
    });
  }
  function tolNext() {
    if (!G || G.kind !== 'tol') return;
    var q = G.qs[G.round % G.qs.length];
    G.locked = [false, false]; G.open = true; G.t0 = performance.now();
    G.ui.forEach(function (u) { u.eq.textContent = q.text; u.flash.textContent = ''; });
    tolPaint();
  }
  function tolAnswer(pi, said) {
    if (!G || G.kind !== 'tol' || !G.open || G.locked[pi]) return;
    var q = G.qs[G.round % G.qs.length], my = G.token;
    if (said === q.truth) {
      G.open = false; G.sc[pi]++; G.rt[pi].push((performance.now() - G.t0) / 1000);
      sfx.good();
      G.ui[pi].flash.textContent = '+1 ' + (q.truth ? 'TRUE' : 'LIE');
      G.ui[1 - pi].flash.textContent = G.names[pi] + ' got it · ' + (q.truth ? 'true' : 'a lie');
      tolPaint();
      if (G.sc[pi] >= TOL_TARGET) { setTimeout(function () { if (G && G.token === my) tolFinish(pi); }, 700); return; }
      G.round++; setTimeout(function () { if (G && G.token === my) tolNext(); }, 900);
    } else {
      G.locked[pi] = true; G.wrong[pi]++; sfx.bad(); buzz(80);
      var el = G.ui[pi].el; el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong'); setTimeout(function () { el.classList.remove('wrong'); }, 350);
      G.ui[pi].flash.textContent = 'Locked out';
      tolPaint();
      if (G.locked[0] && G.locked[1]) {
        G.open = false; G.ui.forEach(function (u) { u.flash.textContent = 'Both wrong · it was ' + (q.truth ? 'true' : 'a lie'); });
        G.round++; setTimeout(function () { if (G && G.token === my) tolNext(); }, 1100);
      }
    }
  }
  function tolKey(e) {
    var k = (e.key || '').toLowerCase(), map = { a: [0, true], s: [0, false], k: [1, true], l: [1, false] };
    if (!map[k]) return; e.preventDefault(); tolAnswer(map[k][0], map[k][1]);
  }
  function tolFinish(w) {
    G.live = false; wakeOff();
    var b = { game: 'tol', mode: 'split', cfg: G.cfg, winner: w,
      players: [0, 1].map(function (i) { return { name: G.names[i], score: G.sc[i], wrong: G.wrong[i], avgRt: G.rt[i].length ? +(G.rt[i].reduce(function (a, c) { return a + c; }, 0) / G.rt[i].length).toFixed(2) : null }; }) };
    var ser = bumpSeries('tol', G.names, w);
    renderResults(b, ser);
  }

  // =====================================================================
  // Results
  // =====================================================================
  function bumpSeries(kind, names, w) {
    var key = kind + '|' + names.join('|').toLowerCase();
    var s = series[key] || (series[key] = [0, 0, 0]);
    if (w === 0 || w === 1) s[w]++; else s[2]++;
    return s;
  }
  function resultsDuel() {
    G.live = false; wakeOff();
    var t = G.p.map(elapsed), diff = Math.abs(t[0] - t[1]);
    var w = diff >= 0.005 ? (t[0] < t[1] ? 0 : 1) : -1;
    var b = { game: 'duel', mode: G.mode, cfg: G.cfg, winner: w,
      players: [0, 1].map(function (i) { var p = G.p[i]; return { name: G.names[i], time: +t[i].toFixed(3), raw: +((p.end - p.start) / 1000).toFixed(3), wrong: p.wrong, splits: p.splits, bestStreak: p.bestStreak, wrongBy: p.wrongBy }; }) };
    renderResults(b, bumpSeries('duel', G.names, w));
  }
  function resultsSolo() {
    G.live = false;
    var p = G.p[0], b;
    if (G.kind === 'sprint') b = { game: 'sprint', cfg: G.cfg, players: [{ name: G.names[0], score: p.idx, wrong: p.wrong, bestStreak: p.bestStreak, splits: p.splits, wrongBy: p.wrongBy }] };
    else b = { game: 'daily', day: G.day, practice: !!G.practice, cfg: G.cfg, players: [{ name: G.names[0], time: +elapsed(p).toFixed(3), raw: +((p.end - p.start) / 1000).toFixed(3), wrong: p.wrong, splits: p.splits, bestStreak: p.bestStreak, wrongBy: p.wrongBy }] };
    renderResults(b, null);
  }

  function renderResults(b, ser) {
    var g = G; // snapshot for rematch
    var el = $('resBody'), html = '', winColor = null;
    var P = b.players;
    if (b.game === 'duel' || b.game === 'tol') {
      var w = b.winner;
      html += '<p class="kicker"><b>' + (b.game === 'duel' ? 'DUEL' : 'TRUTH OR LIE') + '</b> Final result</p>';
      html += '<div class="verdict" style="color:' + (w < 0 ? 'var(--ink)' : COL[w].c) + ';text-shadow:0 0 30px ' + (w < 0 ? 'none' : COL[w].g) + '">' + (w < 0 ? 'Dead <em>heat.</em>' : esc(P[w].name) + ' <em>wins.</em>') + '</div>';
      if (b.game === 'duel') html += '<p class="margin">' + (w < 0 ? 'Level to the hundredth of a second. Remarkable, or suspicious.' : 'By ' + Math.abs(P[0].time - P[1].time).toFixed(2) + ' seconds.') + '</p>';
      else html += '<p class="margin">' + P[w].score + '–' + P[1 - w].score + '.</p>';
      if (ser && (ser[0] + ser[1] + ser[2]) > 1) html += '<p class="series">Series · ' + esc(P[0].name) + ' ' + ser[0] + ' – ' + ser[1] + ' ' + esc(P[1].name) + (ser[2] ? ' · ' + ser[2] + ' drawn' : '') + '</p>';
      else html += '<p class="series">&nbsp;</p>';
      html += '<div class="cards">' + [0, 1].map(function (i) {
        var p = P[i], lose = w >= 0 && w !== i;
        var style = 'style="--pc:' + COL[i].c + ';--pd:' + COL[i].d + ';--pg:' + COL[i].g + '"';
        if (b.game === 'duel') return '<div class="card' + (lose ? ' lose' : '') + '" ' + style + '><div class="whoc">' + esc(p.name) + '</div><div class="t">' + p.time.toFixed(2) + ' s</div><dl>' +
          '<dt>Raw time</dt><dd>' + p.raw.toFixed(2) + ' s</dd><dt>Wrong</dt><dd>' + p.wrong + (p.wrong ? ' · +' + p.wrong * PENALTY + 's' : '') + '</dd><dt>Per Q</dt><dd>' + (p.time / b.cfg.n).toFixed(2) + ' s</dd><dt>Streak</dt><dd>' + p.bestStreak + '</dd></dl></div>';
        return '<div class="card' + (lose ? ' lose' : '') + '" ' + style + '><div class="whoc">' + esc(p.name) + '</div><div class="t">' + p.score + ' pts</div><dl>' +
          '<dt>Wrong calls</dt><dd>' + p.wrong + '</dd><dt>Avg reaction</dt><dd>' + (p.avgRt == null ? '–' : p.avgRt.toFixed(2) + ' s') + '</dd></dl></div>';
      }).join('') + '</div>';
      if (b.game === 'duel') html += exhibitSplits(P, 'Figure 1: seconds per question, penalties excluded');
      winColor = w < 0 ? null : (w === 0 ? cssVar('--p1') : cssVar('--p2'));
    } else if (b.game === 'sprint') {
      var p0 = P[0], best = computeStats(localBattles()).bestSprint, pb = best == null || p0.score > best;
      html += '<p class="kicker"><b>SPRINT</b> 60 seconds</p>';
      html += '<div class="verdict" style="color:var(--p1);text-shadow:0 0 30px var(--p1-glow)">' + p0.score + ' <em>correct.</em></div>';
      html += '<p class="margin">' + (pb && p0.score > 0 ? 'New personal best.' : 'Personal best: ' + best + '.') + ' ' + (p0.score ? (60 / p0.score).toFixed(2) + ' s per answer.' : '') + '</p><p class="series">&nbsp;</p>';
      html += '<div class="cards one"><div class="card" style="--pc:var(--p1);--pd:var(--p1-deep);--pg:var(--p1-glow)"><div class="whoc">' + esc(p0.name) + '</div><dl>' +
        '<dt>Correct</dt><dd>' + p0.score + '</dd><dt>Wrong</dt><dd>' + p0.wrong + '</dd><dt>Accuracy</dt><dd>' + (p0.score + p0.wrong ? Math.round(p0.score / (p0.score + p0.wrong) * 100) : 0) + '%</dd><dt>Best streak</dt><dd>' + p0.bestStreak + '</dd>' + weakSpot(p0.wrongBy) + '</dl></div></div>';
      html += exhibitSplits([p0], 'Figure 1: seconds per correct answer');
      if (pb && p0.score > 0) winColor = cssVar('--p1');
    } else {
      var d0 = P[0];
      html += '<p class="kicker"><b>DAILY</b> ' + esc(b.day) + (b.practice ? ' · practice' : '') + '</p>';
      html += '<div class="verdict" style="color:var(--p2);text-shadow:0 0 30px var(--p2-glow)">' + d0.time.toFixed(2) + ' <em>seconds.</em></div>';
      html += '<p class="margin">' + (b.practice ? 'Practice run. Only your first attempt counts on the board.' : 'That’s your time for today. See where it ranks.') + '</p><p class="series">&nbsp;</p>';
      html += '<div class="cards one"><div class="card" style="--pc:var(--p2);--pd:var(--p2-deep);--pg:var(--p2-glow)"><div class="whoc">' + esc(d0.name) + '</div><dl>' +
        '<dt>Answering</dt><dd>' + d0.raw.toFixed(2) + ' s</dd><dt>Wrong</dt><dd>' + d0.wrong + ' (+' + d0.wrong * PENALTY + ' s)</dd><dt>Best streak</dt><dd>' + d0.bestStreak + '</dd>' + weakSpot(d0.wrongBy) + '</dl></div></div>';
      html += exhibitSplits([d0], 'Figure 1: seconds per question');
      if (!b.practice) winColor = cssVar('--p2');
    }
    html += '<div class="savebar" id="saveBar"><span>Saving…</span></div>';
    html += '<div class="actions"><button class="btn primary lg" id="again">' + (b.game === 'daily' ? 'See the board' : b.game === 'sprint' ? 'Go again' : 'Rematch') + '</button>' +
      '<button class="btn" id="share">Share</button><button class="btn ghost" id="toArena">Arena</button></div>';
    el.innerHTML = html;
    showScreen('results');
    if (winColor) { sfx.win(); confetti([winColor, cssVar('--win'), cssVar('--ink'), b.winner === 1 ? cssVar('--p1') : cssVar('--p2')]); }

    // Persist + leaderboard
    var bar = $('saveBar');
    if (b.game === 'daily' && b.practice) { /* practice: still log it */ }
    recordBattle(b).then(function (ok) {
      if (!bar) return;
      if (ME && ok) { bar.className = 'savebar ok'; bar.innerHTML = '<span class="dot"></span><span>Saved to ' + esc(ME.name) + '’s record.</span><a href="#/record">View record</a>'; }
      else if (ME) { bar.innerHTML = '<span>Saved on this device. It’ll sync when you’re back online.</span>'; }
      else { bar.innerHTML = '<span>Saved on this device only.</span><a class="btn" href="#/account" style="padding:8px 12px">Sign in to keep it</a>'; }
    });
    if (ME && b.game === 'sprint' && P[0].score > 0) api('/api/board', { b: 'sprint', score: P[0].score }).catch(function () {});
    if (ME && b.game === 'daily' && !b.practice) api('/api/board', { b: 'daily', d: b.day, score: P[0].time }).catch(function () {});
    if (!ME && b.game === 'daily' && !b.practice) store.set('sd_daily_unsent', { d: b.day, score: P[0].time });

    $('again').onclick = function () {
      if (b.game === 'daily') { boardTab = 'daily'; go('boards'); return; }
      if (b.game === 'sprint') return startSoloGame('sprint');
      if (b.game === 'tol') return startTol();
      startDuel();
    };
    $('toArena').onclick = function () { abortGame(); go(''); };
    $('share').onclick = function () { shareResult(b); };
    void g;
  }
  function weakSpot(wb) {
    var k = Object.keys(wb || {}); if (!k.length) return '';
    k.sort(function (a, b) { return wb[b] - wb[a]; });
    return '<dt>Weak spot</dt><dd>' + esc(k[0]) + ' (' + wb[k[0]] + ' wrong)</dd>';
  }
  function exhibitSplits(players, caption) {
    var series2 = players.map(function (p) { return (p.splits || []).slice(0, 60); });
    var n = Math.max.apply(null, series2.map(function (s) { return s.length; }));
    if (!n) return '';
    var maxV = Math.max.apply(null, series2.map(function (s) { return Math.max.apply(null, s.concat([1])); }));
    maxV = Math.ceil(maxV);
    var W = 640, H = 200, L = 34, B = 22, T = 8, R = 6, cw = (W - L - R) / n, bw = Math.max(2, (cw - 2) / players.length);
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(caption) + '">';
    for (var gl = 0; gl <= 4; gl++) {
      var y = T + (H - T - B) * (1 - gl / 4), v = (maxV * gl / 4);
      svg += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" style="stroke:var(--line)" stroke-width="1"/>';
      svg += '<text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" style="fill:var(--faint);font-family:var(--mono)">' + (v % 1 ? v.toFixed(1) : v) + '</text>';
    }
    series2.forEach(function (s, pi) {
      s.forEach(function (v, i) {
        var h = (H - T - B) * Math.min(v, maxV) / maxV, x = L + i * cw + 1 + pi * bw;
        svg += '<rect x="' + x.toFixed(1) + '" y="' + (H - B - h).toFixed(1) + '" width="' + (bw - 1).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" style="fill:' + COL[pi].c + '"><title>Q' + (i + 1) + ': ' + v.toFixed(2) + ' s</title></rect>';
      });
    });
    var step = n > 20 ? 5 : n > 10 ? 2 : 1;
    for (var i = 0; i < n; i += step) svg += '<text x="' + (L + i * cw + cw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" style="fill:var(--faint);font-family:var(--mono)">' + (i + 1) + '</text>';
    svg += '</svg>';
    var legend = players.length > 1 ? '<div class="legend">' + players.map(function (p, i) { return '<span style="--c:' + COL[i].c + '">' + esc(p.name) + '</span>'; }).join('') + '</div>' : '';
    return '<div class="exhibit panel">' + legend + svg + '<div class="cap">' + esc(caption) + '</div></div>';
  }
  function shareResult(b) {
    var P = b.players, txt;
    if (b.game === 'duel') txt = b.winner < 0 ? 'Dead heat on Sum Duel. ' + P[0].name + ' and ' + P[1].name + ' both on ' + P[0].time.toFixed(2) + ' s.' : P[b.winner].name + ' beat ' + P[1 - b.winner].name + ' on Sum Duel by ' + Math.abs(P[0].time - P[1].time).toFixed(2) + ' s ⚔';
    else if (b.game === 'tol') txt = P[b.winner].name + ' won Truth or Lie ' + P[b.winner].score + '–' + P[1 - b.winner].score + ' on Sum Duel';
    else if (b.game === 'sprint') txt = 'I got ' + P[0].score + ' correct in 60 s on Sum Duel Sprint. Beat that.';
    else txt = 'Sum Duel Daily ' + b.day + ': ' + P[0].time.toFixed(2) + ' s with ' + P[0].wrong + ' wrong. Your move.';
    var url = location.origin + '/';
    if (navigator.share) navigator.share({ title: 'Sum Duel', text: txt, url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(txt + ' ' + url).then(function () { toast('Copied to clipboard'); }, function () { toast(txt); });
    else toast(txt);
  }

  // =====================================================================
  // Stats + Record
  // =====================================================================
  function computeStats(list) {
    var st = { total: list.length, duels: 0, w: 0, l: 0, d: 0, bestSprint: null, bestDaily: null, streak: 0, bestStreak: 0, rivals: [], byGame: { duel: 0, tol: 0, sprint: 0, daily: 0 }, sprintSeries: [] };
    var riv = {}, run = 0, streakOpen = true;
    list.forEach(function (b) { // newest first
      st.byGame[b.game] = (st.byGame[b.game] || 0) + 1;
      if (b.game === 'duel' || b.game === 'tol') {
        st.duels++;
        var res = b.winner === 0 ? 'W' : b.winner === 1 ? 'L' : 'D';
        if (res === 'W') st.w++; else if (res === 'L') st.l++; else st.d++;
        if (streakOpen) { if (res === 'W') st.streak++; else streakOpen = false; }
        var name = (b.players[1] && b.players[1].name) || 'Player 2', key = name.toLowerCase();
        var r = riv[key] || (riv[key] = { name: name, n: 0, w: 0, l: 0, d: 0, last: b.at });
        r.n++; r[res.toLowerCase()]++;
      }
      if (b.game === 'sprint') { var sc = b.players[0].score; if (st.bestSprint == null || sc > st.bestSprint) st.bestSprint = sc; st.sprintSeries.push(sc); }
      if (b.game === 'daily' && !b.practice) { var tm = b.players[0].time; if (st.bestDaily == null || tm < st.bestDaily) st.bestDaily = tm; }
    });
    // best streak needs chronological pass
    list.slice().reverse().forEach(function (b) {
      if (b.game !== 'duel' && b.game !== 'tol') return;
      if (b.winner === 0) { run++; if (run > st.bestStreak) st.bestStreak = run; } else run = 0;
    });
    st.rivals = Object.keys(riv).map(function (k) { return riv[k]; }).sort(function (a, b) { return b.n - a.n; });
    st.sprintSeries.reverse();
    return st;
  }
  var recFilter = 'all';
  function renderRecord() {
    var el = $('v-record');
    var paint = function (list) {
      var st = computeStats(list);
      var html = '<p class="kicker"><b>§3</b> ' + (ME ? esc(ME.name) + '’s record' : 'Your record · this device') + '</p><h2 class="title">Every battle, on the record</h2>';
      if (!ME) html += '<div class="savebar"><span>You’re not signed in, so this record only lives in this browser.</span><a class="btn" href="#/account" style="padding:8px 12px">Sign in</a></div>';
      if (!list.length) { el.innerHTML = html + '<div class="blank">No battles yet. <a href="#/">Go and pick a fight.</a></div>'; return; }
      html += '<div class="section" style="margin-top:18px">' + kpiRow(st) + '</div>';
      html += '<div class="grid2">';
      // Head to head
      html += '<div class="panel"><p class="kicker"><b>§3.1</b> Head to head</p>';
      if (st.rivals.length) {
        html += '<table class="tbl"><thead><tr><th>Rival</th><th class="n">P</th><th class="n">W–L</th><th></th></tr></thead><tbody>' +
          st.rivals.slice(0, 12).map(function (r) {
            var wp = r.n ? r.w / r.n * 100 : 0, lp = r.n ? r.l / r.n * 100 : 0;
            return '<tr><td>' + esc(r.name) + '</td><td class="n">' + r.n + '</td><td class="n">' + r.w + '–' + r.l + (r.d ? '–' + r.d : '') + '</td><td><span class="wl"><i style="width:' + wp + '%;background:var(--p1)"></i><i style="width:' + lp + '%;background:var(--p2)"></i></span></td></tr>';
          }).join('') + '</tbody></table>';
      } else html += '<p class="hint">Play a Duel or Truth or Lie to start a rivalry.</p>';
      html += '</div>';
      // Sprint trend
      html += '<div class="panel spark"><p class="kicker"><b>§3.2</b> Sprint trend</p>' + sparkline(st.sprintSeries) +
        '<p class="hint">' + (st.sprintSeries.length ? st.sprintSeries.length + (st.sprintSeries.length === 1 ? ' sprint' : ' sprints') + ' · best ' + st.bestSprint + (st.bestDaily != null ? ' · best Daily ' + st.bestDaily.toFixed(2) + ' s' : '') : 'No sprints yet.') + '</p></div>';
      html += '</div>';
      // History
      html += '<div class="section"><p class="kicker"><b>§3.3</b> History</p><div class="filters" id="recF">' +
        [['all', 'All'], ['duel', 'Duels'], ['tol', 'Truth or Lie'], ['sprint', 'Sprint'], ['daily', 'Daily']].map(function (f) { return '<button data-f="' + f[0] + '" aria-pressed="' + (recFilter === f[0]) + '">' + f[1] + (f[0] !== 'all' && st.byGame[f[0]] ? ' · ' + st.byGame[f[0]] : '') + '</button>'; }).join('') +
        '</div><div class="list">' + list.filter(function (b) { return recFilter === 'all' || b.game === recFilter; }).slice(0, 200).map(itemHtml).join('') + '</div></div>';
      el.innerHTML = html;
      $('recF').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; recFilter = b.dataset.f; paint(list); };
    };
    paint(localBattles());
    if (ME) pullBattles().then(function (l) { if (!$('v-record').classList.contains('hidden')) paint(l); });
  }
  function itemHtml(b) {
    var P = b.players || [], badge, main, right;
    if (b.game === 'duel' || b.game === 'tol') {
      var res = b.winner === 0 ? 'W' : b.winner === 1 ? 'L' : 'D';
      badge = '<span class="badge ' + res + '">' + res + ' · ' + (b.game === 'duel' ? 'Duel' : 'T/L') + '</span>';
      main = '<b>' + esc(P[0] && P[0].name) + ' vs ' + esc(P[1] && P[1].name) + '</b><small>' + fmtDate(b.at) + (b.cfg ? ' · ' + esc((b.cfg.ops || []).join(' ')) + ' · ' + esc(b.cfg.level || '') : '') + (b.mode === 'turns' ? ' · turns' : '') + '</small>';
      right = b.game === 'duel' ? (P[0].time.toFixed(2) + ' / ' + P[1].time.toFixed(2)) : (P[0].score + '–' + P[1].score);
    } else if (b.game === 'sprint') {
      badge = '<span class="badge">Sprint</span>'; main = '<b>' + P[0].score + ' correct</b><small>' + fmtDate(b.at) + ' · ' + P[0].wrong + ' wrong</small>'; right = P[0].score;
    } else {
      badge = '<span class="badge">Daily</span>'; main = '<b>' + esc(b.day) + (b.practice ? ' · practice' : '') + '</b><small>' + fmtDate(b.at) + ' · ' + P[0].wrong + ' wrong</small>'; right = P[0].time.toFixed(2) + ' s';
    }
    return '<div class="item">' + badge + '<div class="main">' + main + '</div><div class="r">' + right + '</div></div>';
  }
  function sparkline(arr) {
    if (arr.length < 2) return '<div class="blank" style="padding:18px">Play two or more sprints to see your trend.</div>';
    var a = arr.slice(-40), W = 600, H = 140, P = 10, mx = Math.max.apply(null, a), mn = Math.min.apply(null, a); if (mx === mn) { mx++; mn--; }
    var pts = a.map(function (v, i) { return [P + i * (W - 2 * P) / (a.length - 1), H - P - (v - mn) / (mx - mn) * (H - 2 * P)]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var last = pts[pts.length - 1];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Sprint scores over time">' +
      '<path d="' + d + ' L' + last[0].toFixed(1) + ' ' + (H - P) + ' L' + P + ' ' + (H - P) + 'Z" style="fill:var(--p1)" opacity=".08"/>' +
      '<path d="' + d + '" fill="none" stroke-width="2.5" stroke-linejoin="round" style="stroke:var(--p1);filter:drop-shadow(0 0 6px var(--p1-glow))"/>' +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="5" style="fill:var(--p1)"/>' +
      '<text x="' + (W - P) + '" y="16" text-anchor="end" font-size="12" style="fill:var(--faint);font-family:var(--mono)">max ' + mx + '</text></svg>';
  }

  // =====================================================================
  // Boards
  // =====================================================================
  var boardTab = 'daily';
  $('boardTabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; boardTab = b.dataset.b; renderBoards(); });
  function renderBoards() {
    qsa('#boardTabs button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.b === boardTab)); });
    var body = $('boardBody');
    body.innerHTML = '<div class="blank">Loading…</div>';
    var day = utcDay();
    api('/api/board?b=' + boardTab + (boardTab === 'daily' ? '&d=' + day : '')).then(function (j) {
      var daily = boardTab === 'daily';
      var html = '<p class="hint" style="margin:0 0 12px">' + (daily ? 'Daily ' + day + ' (UTC): 20 questions, everyone gets the same set, and only your first attempt counts. ' : 'Most correct answers in 60 seconds. Your best score stands. ') + j.total + ' player' + (j.total === 1 ? '' : 's') + '.</p>';
      if (!j.rows.length) html += '<div class="blank">Nobody on the board yet. ' + (daily ? '<a href="#/" data-play="daily">Be first today.</a>' : '<a href="#/" data-play="sprint">Set the bar.</a>') + '</div>';
      else html += '<div class="panel" style="padding:6px 8px"><table class="tbl"><thead><tr><th>#</th><th>Player</th><th class="n">' + (daily ? 'Time' : 'Correct') + '</th></tr></thead><tbody>' +
        j.rows.map(function (r) { return '<tr class="' + (r.me ? 'me' : '') + '"><td class="mono">' + (r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank) + '</td><td>' + esc(r.name) + (r.me ? ' <span class="badge">you</span>' : '') + '</td><td class="n">' + (daily ? Number(r.score).toFixed(2) + ' s' : r.score) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      if (j.mine && !j.rows.some(function (r) { return r.me; })) html += '<p class="hint">You’re #' + j.mine.rank + ' with ' + (daily ? Number(j.mine.score).toFixed(2) + ' s' : j.mine.score) + '.</p>';
      if (!ME) html += '<div class="savebar" style="margin-top:14px"><span>Sign in to get your name on the board.</span><a class="btn" href="#/account" style="padding:8px 12px">Sign in</a></div>';
      body.innerHTML = html;
      qsa('[data-play]', body).forEach(function (a) { a.onclick = function (e) { e.preventDefault(); startSoloGame(a.dataset.play); }; });
    }).catch(function () { body.innerHTML = '<div class="blank">The leaderboard is offline right now. Your games still save on this device.</div>'; });
  }

  // =====================================================================
  // Chat: mIRC-style window, polled every 3 s (8 s when quiet), paused when hidden
  // =====================================================================
  var CH = { c: 'lobby', last: 0, timer: null, quiet: 0, me: null, ids: {}, topic: '', online: [] };
  var CHANS = ['lobby', 'duels'];
  var NICKC = ['#00007F', '#009300', '#C00000', '#7F0000', '#9C009C', '#B35900', '#007F7F', '#0000FC', '#6B6B00', '#505050'];
  function nickColor(n) { var h = 0; n = String(n || ''); for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0; return NICKC[h % NICKC.length]; }
  function hhmm(iso) { var d = new Date(iso); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function chatStop() { if (CH.timer) { clearTimeout(CH.timer); CH.timer = null; } }
  function chatOpen() { return !$('v-chat').classList.contains('hidden'); }

  function renderChat() {
    chatStop();
    CH.last = 0; CH.ids = {}; CH.quiet = 0;
    var el = $('v-chat');
    el.innerHTML = '<p class="kicker"><b>§5</b> Chat</p><h2 class="title">#' + CH.c + '</h2>' +
      '<div class="irc" id="irc">' +
        '<div class="irc-title"><span id="ircTitle">mIRC - [#' + CH.c + ']</span><span aria-hidden="true"><i>_</i><i>□</i><i>×</i></span></div>' +
        '<div class="irc-menu" aria-hidden="true"><span><u>F</u>ile</span><span><u>V</u>iew</span><span>F<u>a</u>vorites</span><span><u>T</u>ools</span><span><u>C</u>ommands</span><span><u>W</u>indow</span><span><u>H</u>elp</span></div>' +
        '<div class="irc-switch">' + CHANS.map(function (c) { return '<button type="button" data-ch="' + c + '" aria-pressed="' + (c === CH.c) + '">#' + c + '</button>'; }).join('') +
          '<button type="button" class="nk" id="ircNk">Nicks</button></div>' +
        '<div class="irc-body"><div class="irc-log" id="ircLog" role="log" aria-live="polite"></div><ul class="irc-nicks" id="ircNicks" aria-label="Who’s here"></ul></div>' +
        '<form class="irc-input" id="ircF" autocomplete="off"><input id="ircIn" maxlength="300" placeholder="' + (ME ? 'Type a message, or /help' : 'Sign in to chat') + '" aria-label="Message"' + (ME ? '' : ' disabled') + '><button type="submit"' + (ME ? '' : ' disabled') + '>Send</button></form>' +
        '<div class="irc-status"><span id="ircStat">' + (ME ? 'Connecting…' : 'Not connected') + '</span><span>logged · moderated</span></div>' +
      '</div>' +
      (ME ? '' : '<div class="row" style="margin-top:14px"><a class="btn primary" href="#/account">Sign in to chat</a></div>') +
      '<p class="foot">Be kind, and keep personal details private: no surnames, schools, addresses, phone numbers, emails or links. Tap a message to report it. Every message is logged and checked by moderators.</p>';
    qsa('[data-ch]').forEach(function (b) { b.onclick = function () { if (CH.c !== b.dataset.ch) { CH.c = b.dataset.ch; renderChat(); } }; });
    $('ircNk').onclick = function () { $('irc').classList.toggle('shownicks'); };
    $('ircLog').onclick = onLogClick;
    $('ircNicks').onclick = onNickClick;
    $('ircF').onsubmit = function (e) { e.preventDefault(); chatSubmit(); };
    if (!ME) { sysLine('* You need to sign in to chat.', 'err'); return; }
    sysLine('* Connecting to #' + CH.c + '…');
    poll();
  }

  function logEl() { return $('ircLog'); }
  function nearBottom() { var l = logEl(); return !l || l.scrollHeight - l.scrollTop - l.clientHeight < 60; }
  function toBottom() { var l = logEl(); if (l) l.scrollTop = l.scrollHeight; }
  function sysLine(text, cls) {
    var l = logEl(); if (!l) return; var stick = nearBottom();
    var d = document.createElement('div'); d.className = cls || 'sys'; d.textContent = text; l.appendChild(d); if (stick) toBottom();
  }
  function lineHtml(m) {
    var ts = '<span class="ts">[' + hhmm(m.at) + ']</span> ';
    if (m.removed) return ts + '<span class="rm">&lt;' + esc(m.nick) + '&gt; [message removed by a moderator]</span>';
    if (m.kind === 'action') return ts + '<span class="act">* ' + esc(m.nick) + ' ' + esc(m.body) + '</span>';
    return ts + '&lt;<b style="color:' + nickColor(m.nick) + '">' + esc(m.nick) + '</b>&gt; ' + esc(m.body);
  }
  function addMsg(m) {
    var l = logEl(); if (!l) return;
    var ex = l.querySelector('.ln[data-id="' + m.id + '"]');
    if (ex) { if (m.removed && !ex.dataset.removed) { ex.innerHTML = lineHtml(m); ex.dataset.removed = '1'; } return; }
    var stick = nearBottom();
    var d = document.createElement('div');
    d.className = 'ln'; d.dataset.id = m.id; d.dataset.nick = m.nick;
    if (m.uid) d.dataset.uid = m.uid; if (m.mine) d.dataset.mine = '1'; if (m.removed) d.dataset.removed = '1';
    d.innerHTML = lineHtml(m);
    // keep id order even when our own sent message arrived before a poll
    var lines = l.querySelectorAll('.ln'), before = null;
    for (var i = lines.length - 1; i >= 0; i--) { if (Number(lines[i].dataset.id) > Number(m.id)) before = lines[i]; else break; }
    l.insertBefore(d, before ? before : null);
    CH.ids[m.id] = 1;
    if (stick) toBottom();
  }
  function markRemoved(id) {
    var ex = logEl() && logEl().querySelector('.ln[data-id="' + id + '"]');
    if (ex && !ex.dataset.removed) { ex.dataset.removed = '1'; var ts = ex.querySelector('.ts'); ex.innerHTML = (ts ? ts.outerHTML + ' ' : '') + '<span class="rm">&lt;' + esc(ex.dataset.nick) + '&gt; [message removed by a moderator]</span>'; }
  }
  function paintNicks(list) {
    CH.online = list;
    var ul = $('ircNicks'); if (!ul) return;
    var mod = CH.me && CH.me.mod;
    ul.innerHTML = list.map(function (o) {
      return '<li' + (mod && o.uid ? ' class="mod" data-uid="' + esc(o.uid) + '" data-nick="' + esc(o.nick) + '" tabindex="0"' : '') + '>' + (o.op ? '@' : '') + esc(o.nick) + '</li>';
    }).join('');
    $('ircNk').textContent = 'Nicks (' + list.length + ')';
    $('ircTitle').textContent = 'mIRC - [#' + CH.c + ' (' + list.length + ') [+nt]: ' + CH.topic + ']';
  }
  function setStatus(t) { var s = $('ircStat'); if (s) s.textContent = t; }

  function poll() {
    chatStop();
    if (!chatOpen() || !ME || document.hidden) return;
    var c = CH.c;
    api('/api/chat?c=' + c + '&after=' + CH.last).then(function (j) {
      if (c !== CH.c || !chatOpen()) return;
      CH.me = j.me; CH.topic = j.topic;
      if (!CH.last) {
        logEl().innerHTML = '';
        sysLine('* Now talking in #' + c);
        sysLine('* Topic is \'' + j.topic + '\'');
      }
      (j.removed || []).forEach(markRemoved);
      j.messages.forEach(function (m) { addMsg(m); if (Number(m.id) > CH.last) CH.last = Number(m.id); });
      if (!CH.last && !j.messages.length) CH.last = -1; // first load done, channel empty
      CH.quiet = j.messages.length ? 0 : CH.quiet + 1;
      paintNicks(j.online);
      var muted = j.me.muted_until;
      var inp = $('ircIn');
      inp.disabled = !!muted; inp.placeholder = muted ? 'You’re muted until ' + hhmm(muted) : 'Type a message, or /help';
      setStatus('Connected · ' + j.me.nick + (j.me.mod ? ' · moderator' : ''));
    }).catch(function (e) {
      if (e.status === 401) { setMe(null); renderChat(); return; }
      setStatus('Reconnecting…');
    }).then(function () {
      if (chatOpen() && ME && c === CH.c) CH.timer = setTimeout(poll, CH.quiet > 20 ? 8000 : 3000);
    });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && chatOpen() && ME) poll(); });

  function chatSubmit() {
    var inp = $('ircIn'), v = inp.value.trim();
    if (!v) return;
    if (v === '/help') {
      ['* Commands:', '*   /me <action>   e.g. /me is thinking', '*   /clear         clear this window', '*   /help          this list',
       '* Tap a message to report it. Moderators see every report.'].forEach(function (t) { sysLine(t); });
      inp.value = ''; return;
    }
    if (v === '/clear') { logEl().innerHTML = ''; inp.value = ''; return; }
    if (v[0] === '/' && !/^\/me\s+\S/i.test(v)) { sysLine('* Unknown command: ' + v.split(' ')[0] + ' (try /help)', 'err'); inp.value = ''; return; }
    inp.disabled = true;
    api('/api/chat', { action: 'send', c: CH.c, body: v }).then(function (j) {
      inp.value = ''; addMsg(j.message);
    }).catch(function (e) {
      sysLine('* ' + e.message, 'err');
    }).then(function () { if (!(CH.me && CH.me.muted_until)) { inp.disabled = false; inp.focus(); } });
  }

  function onLogClick(e) {
    var btn = e.target.closest('button');
    if (btn) {
      var ln = btn.closest('.irc-acts').previousElementSibling, id = ln.dataset.id, act = btn.dataset.a;
      if (act === 'report') {
        var why = window.prompt('Why are you reporting this message? (optional)', '');
        if (why === null) return;
        api('/api/chat', { action: 'report', id: id, reason: why }).then(function () { toast('Thanks. A moderator will check it.'); }).catch(function (er) { toast(er.message); });
      } else if (act === 'delete') {
        api('/api/chat', { action: 'delete', id: id }).then(function () { markRemoved(id); toast('Message removed'); }).catch(function (er) { toast(er.message); });
      } else if (act === 'mute10' || act === 'mute60') {
        api('/api/chat', { action: 'mute', userId: ln.dataset.uid, minutes: act === 'mute10' ? 10 : 60 }).then(function () { toast(ln.dataset.nick + ' muted'); }).catch(function (er) { toast(er.message); });
      }
      btn.closest('.irc-acts').remove(); return;
    }
    var line = e.target.closest('.ln'); if (!line) return;
    var open = logEl().querySelector('.irc-acts'); var was = open && open.previousElementSibling === line;
    if (open) { open.previousElementSibling.classList.remove('sel'); open.remove(); }
    if (was || line.dataset.removed) return;
    var mod = CH.me && CH.me.mod;
    var html = (line.dataset.mine ? '' : '<button type="button" data-a="report">Report</button>') +
      (mod ? '<button type="button" data-a="delete">Delete</button>' + (line.dataset.mine ? '' : '<button type="button" data-a="mute10">Mute 10m</button><button type="button" data-a="mute60">Mute 1h</button>') : '');
    if (!html) return;
    var box = document.createElement('div'); box.className = 'irc-acts'; box.innerHTML = html;
    line.classList.add('sel'); line.parentNode.insertBefore(box, line.nextSibling);
  }
  function onNickClick(e) {
    var b = e.target.closest('button');
    if (b) {
      var p = b.closest('.irc-pop'), li = p.previousElementSibling;
      api('/api/chat', { action: 'mute', userId: li.dataset.uid, minutes: Number(b.dataset.m) })
        .then(function () { toast(Number(b.dataset.m) ? li.dataset.nick + ' muted' : li.dataset.nick + ' unmuted'); })
        .catch(function (er) { toast(er.message); });
      p.remove(); return;
    }
    var li2 = e.target.closest('li.mod'); if (!li2) return;
    var open = $('ircNicks').querySelector('.irc-pop'); var was = open && open.previousElementSibling === li2;
    if (open) open.remove(); if (was) return;
    var pop = document.createElement('li'); pop.className = 'irc-pop';
    pop.innerHTML = '<button type="button" data-m="10">Mute 10 min</button><button type="button" data-m="60">Mute 1 hour</button><button type="button" data-m="1440">Mute 1 day</button><button type="button" data-m="0">Unmute</button>';
    li2.parentNode.insertBefore(pop, li2.nextSibling);
  }

  // =====================================================================
  // Account
  // =====================================================================
  function renderAccount() {
    var el = $('v-account');
    if (!ME) {
      el.innerHTML = '<div class="auth"><p class="kicker"><b>§6</b> Account</p><h2 class="title">Sign in or sign up.<br><span class="serif" style="font-style:italic;color:var(--p1)">Same box.</span></h2>' +
        '<p class="lede">Enter an email and a password. A new email creates your account on the spot, with no confirmation step. After that, every battle goes on your record.</p>' +
        '<form id="authF" novalidate><label class="sr" for="em">Email</label><input class="inp" id="em" type="email" autocomplete="username" inputmode="email" placeholder="you@example.com" required>' +
        '<label class="sr" for="pw">Password</label><input class="inp" id="pw" type="password" autocomplete="current-password" placeholder="Password (6+ characters)" minlength="6" required>' +
        '<div class="err" id="authErr" role="alert"></div><button class="btn primary block lg" id="authGo" type="submit">Continue</button></form>' +
        (localBattles().length ? '<p class="foot">' + localBattles().length + ' battle' + (localBattles().length === 1 ? '' : 's') + ' on this device will move to your account when you sign in.</p>' : '') +
        '</div>' + settingsHtml();
      $('authF').onsubmit = function (e) {
        e.preventDefault();
        var em = $('em').value.trim(), pw = $('pw').value, err = $('authErr'), btn = $('authGo');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) { err.textContent = 'That doesn’t look like an email.'; return; }
        if (pw.length < 6) { err.textContent = 'Password needs at least 6 characters.'; return; }
        err.textContent = ''; btn.disabled = true; btn.textContent = 'One moment…';
        api('/api/auth', { action: 'enter', email: em, password: pw }).then(function (j) {
          setMe(j.user);
          // Hand guest battles to the account
          var queued = {}; pending().forEach(function (b) { queued[b.cid] = 1; });
          var p = pending().concat(localBattles().filter(function (b) { return !queued[b.cid]; }));
          store.set('sd_pending', p);
          var unsent = store.get('sd_daily_unsent', null);
          if (unsent && unsent.d === utcDay()) api('/api/board', { b: 'daily', d: unsent.d, score: unsent.score }).catch(function () {});
          store.del('sd_daily_unsent');
          if (S.names[0] === 'Player 1' || !S.names[0]) { S.names[0] = j.user.name; save(); }
          toast(j.created ? 'Account created. Welcome, ' + j.user.name + '.' : 'Welcome back, ' + j.user.name + '.');
          return pullBattles();
        }).then(function () { renderAccount(); }).catch(function (e2) {
          err.textContent = e2.message === 'Failed to fetch' ? 'Can’t reach the server. Check your connection.' : e2.message;
          btn.disabled = false; btn.textContent = 'Continue';
        });
      };
    } else {
      var st = computeStats(localBattles());
      el.innerHTML = '<div class="auth"><p class="kicker"><b>§6</b> Account</p><h2 class="title">' + esc(ME.name) + '</h2><p class="lede" style="margin-bottom:14px">' + esc(ME.email) + ' · ' + st.total + ' battles on record</p>' +
        '<div class="panel"><label class="lab mono" for="dn" style="font-size:.72rem;letter-spacing:.12em;color:var(--muted)">DISPLAY NAME (SHOWN ON BOARDS)</label>' +
        '<div class="row" style="margin-top:8px"><input class="inp" id="dn" maxlength="20" value="' + esc(ME.name) + '" style="flex:1;margin:0;min-width:0"><button class="btn" id="dnSave">Save</button></div><div class="err" id="dnErr"></div></div>' +
        '<div class="row" style="margin-top:14px"><a class="btn" href="#/record">View record</a>' + (ME.admin ? '<a class="btn" href="/admin">Admin tools</a>' : '') + '<button class="btn ghost" id="logout">Sign out</button></div></div>' + settingsHtml();
      $('dnSave').onclick = function () {
        var v = $('dn').value.trim(); if (!v) { $('dnErr').textContent = 'Name can’t be empty.'; return; }
        api('/api/auth', { action: 'rename', name: v }).then(function (j) { var old = ME.name; setMe(j.user); if (S.names[0] === old) { S.names[0] = j.user.name; save(); } toast('Name updated'); renderAccount(); })
          .catch(function (e) { $('dnErr').textContent = e.message; });
      };
      $('logout').onclick = function () {
        api('/api/auth', { action: 'logout' }).catch(function () {}).then(function () {
          setMe(null); setLocalBattles([]); store.set('sd_pending', []); S.names[0] = 'Player 1'; save(); toast('Signed out'); renderAccount();
        });
      };
    }
    bindSettings();
  }
  function settingsHtml() {
    return '<div class="section auth"><p class="kicker"><b>§7</b> Preferences</p><div class="panel" style="padding:4px 18px">' +
      '<div class="setrow"><div>Sound<small>Blips, buzzers and fanfare</small></div><button class="toggle" data-s="sound" aria-pressed="' + !!S.sound + '" aria-label="Sound"></button></div>' +
      '<div class="setrow"><div>Haptics<small>Vibrate on wrong answers (Android)</small></div><button class="toggle" data-s="haptics" aria-pressed="' + !!S.haptics + '" aria-label="Haptics"></button></div>' +
      '<div class="setrow"><div>Blackboard mode<small>Chalk on slate. Paper is the default.</small></div><button class="toggle" data-s="theme" aria-pressed="' + (S.theme === 'night') + '" aria-label="Blackboard mode"></button></div>' +
      '</div><p class="foot">Tip: in Chrome or Safari, choose Add to Home Screen and it runs full-screen and offline.</p></div>';
  }
  function bindSettings() {
    qsa('[data-s]').forEach(function (t) {
      t.onclick = function () {
        var k = t.dataset.s;
        if (k === 'theme') { S.theme = S.theme === 'night' ? 'paper' : 'night'; applyTheme(); }
        else S[k] = !S[k];
        save(); t.setAttribute('aria-pressed', String(k === 'theme' ? S.theme === 'night' : S[k]));
        if (k === 'sound' && S.sound) sfx.good();
      };
    });
  }

  // =====================================================================
  // Boot
  // =====================================================================
  paintWho();
  route();
  api('/api/auth').then(function (j) {
    var was = !!ME; setMe(j.user);
    if (j.user) flush();
    if (was !== !!j.user && !G) route();
  }).catch(function () { /* offline: keep cached identity */ });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
})();
