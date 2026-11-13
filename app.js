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
  var DEFAULTS = { names: ['Player 1', 'Player 2'], mode: 'split', ops: ['+', '−', '×', '÷'], level: 'medium', n: 10, sound: true, haptics: true, theme: 'paper', palette: 'seaside' };
  var S = Object.assign({}, DEFAULTS, store.get('sumduel', {}));
  if (!Array.isArray(S.ops) || !S.ops.length) S.ops = DEFAULTS.ops.slice();
  if (!Array.isArray(S.names)) S.names = DEFAULTS.names.slice();
  function save() { store.set('sumduel', S); }
  // v2.8.1 palettes. Two settings make the look: S.theme ('paper' day or 'night') and S.palette. The <head> script in
  // index.html applies both before the first paint; keep its palette list in step with PALETTES.
  var PALETTES = [
    { id: 'seaside', name: 'Seaside', sub: 'Teal and raspberry, the classic look' },
    { id: 'blue', name: 'Shades of Blue', sub: 'Ocean blue and royal blue' },
    { id: 'pink', name: 'Shades of Pink', sub: 'Fuchsia and rose' },
    { id: 'ascii', name: 'ASCII Mode', sub: 'Plain text, like an old computer screen' }
  ];
  function palId() { return PALETTES.filter(function (p) { return p.id === S.palette; }).length ? S.palette : 'seaside'; }
  function applyTheme() {
    // 'paper' (day, the default) or 'night'. Old saved 'dark'/'light' values fall back to paper.
    var night = S.theme === 'night', pal = palId(), d = document.documentElement;
    d.setAttribute('data-theme', night ? 'night' : 'paper');
    if (pal === 'seaside') d.removeAttribute('data-palette'); else d.setAttribute('data-palette', pal);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = cssVar('--bg') || (night ? '#13203A' : '#FFF8EE');
    syncPal();
  }
  var TICK_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function palTiles() {
    var cur = palId();
    return '<div class="pal-grid" role="radiogroup" aria-label="Colour palette">' + PALETTES.map(function (p) {
      var on = p.id === cur;
      var sw = p.id === 'ascii' ? '<span class="pal-sw" aria-hidden="true"><span>&gt; 7 x 6 = <em>42</em><u>_</u></span></span>'
        : '<span class="pal-sw" aria-hidden="true"><i><b>7</b></i><i><b>6</b></i></span>';
      return '<button type="button" class="pal" data-pal="' + p.id + '" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '">' + sw +
        '<span class="pal-t"><span>' + p.name + '</span><span class="ck">' + TICK_SVG + '</span></span><span class="pal-s">' + p.sub + '</span></button>';
    }).join('') + '</div>';
  }
  function themeSeg() {
    return '<div class="seg pal-th" role="group" aria-label="Day or night">' +
      '<button type="button" data-th="paper" aria-pressed="' + (S.theme !== 'night') + '">Day</button>' +
      '<button type="button" data-th="night" aria-pressed="' + (S.theme === 'night') + '">Night</button></div>';
  }
  function renderPalPick() {
    var el = $('palPick'); if (!el) return;
    el.innerHTML = '<div class="pal-head"><p class="kicker">Your Colours</p>' + themeSeg() + '</div>' + palTiles();
    bindPal(el);
  }
  function bindPal(root) {
    root.addEventListener('click', function (e) {
      var t = e.target.closest('.pal'); if (t) { setPalette(t.dataset.pal); return; }
      var th = e.target.closest('[data-th]'); if (th) { S.theme = th.dataset.th === 'night' ? 'night' : 'paper'; save(); applyTheme(); }
    });
    root.addEventListener('keydown', function (e) {   // a radio group: arrow keys move the choice
      var t = e.target.closest && e.target.closest('.pal'); if (!t) return;
      var k = e.key, step = k === 'ArrowRight' || k === 'ArrowDown' ? 1 : k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 0; if (!step) return;
      e.preventDefault();
      var all = qsa('.pal', t.parentNode), nx = all[(all.indexOf(t) + step + all.length) % all.length];
      setPalette(nx.dataset.pal); nx.focus();
    });
  }
  function setPalette(id) { S.palette = id; save(); applyTheme(); sfx.tick(); }
  function syncPal() {
    var cur = palId(), night = S.theme === 'night';
    qsa('.pal').forEach(function (b) { var on = b.dataset.pal === cur; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    qsa('[data-th]').forEach(function (b) { b.setAttribute('aria-pressed', String((b.dataset.th === 'night') === night)); });
    qsa('[data-s="theme"]').forEach(function (b) { b.setAttribute('aria-pressed', String(night)); });
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
        if (!r.ok) { var e = new Error(j.error || ('Error ' + r.status)); e.status = r.status; e.code = j.code; throw e; }
        return j;
      });
    });
  }
  function setMe(u) {
    var was = ME ? ME.id : null;
    ME = u || null;
    if (ME) store.set('sd_me', ME); else { store.del('sd_me'); store.del('sd_wallet'); }
    paintWho();
    if ((ME ? ME.id : null) !== was && typeof loadWallet === 'function') { W = null; loadWallet(); }
  }
  function paintWho() {
    var w = $('who');
    if (ME) { w.innerHTML = '<span class="av">' + esc((ME.name || '?')[0].toUpperCase()) + '</span><span>' + esc(ME.name) + '</span>'; }
    else { w.innerHTML = '<span class="av"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></span><span>Sign in</span>'; }
  }

  // Battles: local cache (all battles, newest first) + pending queue for the server.
  var LOCAL_MAX = 1000;
  function localBattles() { return store.get('sd_battles', []); }
  function setLocalBattles(list) { store.set('sd_battles', list.slice(0, LOCAL_MAX)); }
  function pending() { return store.get('sd_pending', []); }
  function recordBattle(b) {
    b.cid = b.cid || uid(); b.at = b.at || new Date().toISOString();
    var list = localBattles();
    if (list.some(function (x) { return x.cid === b.cid; })) return flush(); // already recorded (e.g. live result re-opened)
    list.unshift(b); setLocalBattles(list);
    var p = pending(); p.push(b); store.set('sd_pending', p.slice(-LOCAL_MAX));
    return flush().then(function (ok) { return ok; });
  }
  var flushing = null;
  function flush() {
    if (!ME) return Promise.resolve(false);
    if (flushing) return flushing;
    var p = pending(); if (!p.length) return Promise.resolve(true);
    flushing = api('/api/battles', { battles: p.slice(0, 200) }).then(function (j) {
      var sent = {}; p.slice(0, 200).forEach(function (b) { sent[b.cid] = 1; });
      store.set('sd_pending', pending().filter(function (b) { return !sent[b.cid]; }));
      if (j && j.coins) loadWallet();
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
  // v2.8 Rewards: coins, hearts (lives) and the daily gift.
  // Signed in, the server (/api/rewards) is in charge. Guests get the same rules run here on a local
  // wallet. ECON, battleCoins, climbReward and botRun mirror api/_economy.js: keep the numbers in step.
  // =====================================================================
  var ECON = {
    START_COINS: 200, START_LIVES: 5, MAX_LIVES: 5, BONUS_CAP: 15, REGEN_MIN: 10,
    LIFE_COST: 20, REFILL_COST: 60, CONTINUE_COST: 25, MAX_CONTINUES: 3,
    GIFTS: [{ coins: 50 }, { coins: 75 }, { coins: 100, lives: 1 }, { coins: 125 }, { coins: 150, lives: 2 }, { coins: 200 }, { coins: 300, lives: 5 }],
    CHEST: { coins: 150, lives: 2 }, VS_FIRST_WIN: { coins: 100, lives: 2 }, VS_FIRST_LOSS: { coins: 40, lives: 1 }, VS_REMATCH_WIN: { coins: 10 }, EARN_CAP: 80
  };
  var AREA = 12;
  function dayOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function fmtN(n) { return Number(n || 0).toLocaleString('en-GB'); }
  function fmtClock(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function battleCoins(b) {
    var P = b.players || [];
    if (b.mode === 'ghost') return b.winner === 0 ? 10 : 5;
    if (b.mode === 'live') return 15 + (b.winner === 0 ? 15 : 0);
    if (b.game === 'duel' || b.game === 'tol') return 10 + (b.winner === 0 ? 10 : 0);
    if (b.game === 'sprint') return 5 + Math.min(25, Math.floor((Number(P[0] && P[0].score) || 0) / 2));
    if (b.game === 'daily') return b.practice ? 5 : 40;
    return 0;
  }
  function climbReward(level, stars, prev) {
    var out = { coins: 0, lives: 0, chest: false };
    if (!prev) out.coins = 20 + 10 * stars; else if (stars > prev) out.coins = 10 * (stars - prev); else out.coins = 5;
    if (!prev && level % AREA === 0) { out.chest = true; out.coins += ECON.CHEST.coins; out.lives += ECON.CHEST.lives; }
    return out;
  }
  function giftFor(streak) { return ECON.GIFTS[(Math.max(1, streak) - 1) % ECON.GIFTS.length]; }
  function prizeText(g) { return fmtN(g.coins) + ' coins' + (g.lives ? ' + ' + g.lives + (g.lives === 1 ? ' heart' : ' hearts') : ''); }

  // ---------- guest wallet: the server's rules, on this device ----------
  function lwFresh() { return { coins: ECON.START_COINS, lives: ECON.START_LIVES, lives_at: Date.now(), climb_level: 1, climb_stars: {}, gift_day: null, gift_streak: 0, run: null, earn_day: null, earn_n: 0, vs_day: null }; }
  function lwRegen(w, now) {
    var R = ECON.REGEN_MIN * 60000;
    if (w.lives >= ECON.MAX_LIVES) { w.lives_at = now; return w; }
    var at = Number(w.lives_at) || now; if (at > now) at = now;
    var n = Math.floor((now - at) / R);
    if (n > 0) { w.lives = Math.min(ECON.MAX_LIVES, w.lives + n); at += n * R; }
    w.lives_at = w.lives >= ECON.MAX_LIVES ? now : at;
    return w;
  }
  function lwLoad() {
    var w = store.get('sd_wallet_local', null);
    if (!w || typeof w !== 'object' || typeof w.coins !== 'number') w = lwFresh();
    w.climb_stars = w.climb_stars || {};
    return lwRegen(w, Date.now());
  }
  function pubOf(w, now) {
    var today = dayOf(now), yday = dayOf(now - 86400000), stars = w.climb_stars || {}, total = 0;
    Object.keys(stars).forEach(function (k) { total += Number(stars[k]) || 0; });
    return {
      coins: w.coins, lives: w.lives, maxLives: ECON.MAX_LIVES,
      nextLifeMs: w.lives >= ECON.MAX_LIVES ? null : Math.max(0, Number(w.lives_at) + ECON.REGEN_MIN * 60000 - now),
      climb: { level: w.climb_level, stars: stars, total: total },
      gift: { ready: w.gift_day !== today, day: w.gift_day === today ? w.gift_streak : (w.gift_day === yday ? (w.gift_streak % ECON.GIFTS.length) + 1 : 1), claimedToday: w.gift_day === today },
      run: w.run ? { id: w.run.id, level: w.run.level, cont: w.run.cont || 0 } : null
    };
  }
  function rerr(status, msg, code) { var e = new Error(msg); e.status = status; e.code = code; return e; }
  function localRewards(action, b) {
    var now = Date.now(), w = lwLoad(), out = {}, today = dayOf(now), yday = dayOf(now - 86400000);
    if (action === 'claimGift') {
      if (w.gift_day === today) throw rerr(409, 'You’ve opened today’s gift. Come back tomorrow!');
      var streak = w.gift_day === yday ? (w.gift_streak % ECON.GIFTS.length) + 1 : 1, g = giftFor(streak);
      w.coins += g.coins; w.lives += g.lives || 0; w.gift_day = today; w.gift_streak = streak;
      out.gift = { day: streak, coins: g.coins, lives: g.lives || 0 };
    } else if (action === 'buy') {
      if (b.what === 'refill') {
        if (w.lives >= ECON.MAX_LIVES) throw rerr(409, 'Your hearts are already full.');
        if (w.coins < ECON.REFILL_COST) throw rerr(402, 'Not enough coins yet.');
        w.coins -= ECON.REFILL_COST; w.lives = ECON.MAX_LIVES;
      } else {
        if (w.coins < ECON.LIFE_COST) throw rerr(402, 'Not enough coins yet.');
        if (w.lives >= ECON.BONUS_CAP) throw rerr(409, 'Your hearts are full.');
        w.coins -= ECON.LIFE_COST; w.lives += 1;
      }
    } else if (action === 'climbStart') {
      var L = parseInt(b.level, 10);
      if (!(L >= 1 && L <= w.climb_level)) throw rerr(403, 'That level is still locked.');
      if (w.lives < 1) throw rerr(409, 'No hearts left. Wait for the next one, or buy one with coins.', 'no_lives');
      w.lives -= 1; w.run = { id: uid(), level: L, at: now, cont: 0 }; out.run = { id: w.run.id, level: L };
    } else if (action === 'climbContinue') {
      if (!w.run || w.run.id !== b.id) throw rerr(409, 'That level isn’t running any more.');
      if ((w.run.cont || 0) >= ECON.MAX_CONTINUES) throw rerr(409, 'No more extra goes on this level.');
      if (w.coins < ECON.CONTINUE_COST) throw rerr(402, 'Not enough coins yet.');
      w.coins -= ECON.CONTINUE_COST; w.run.cont = (w.run.cont || 0) + 1;
    } else if (action === 'climbFinish') {
      var lv = parseInt(b.level, 10), st = Math.max(1, Math.min(3, parseInt(b.stars, 10) || 1));
      if (!w.run || w.run.id !== b.id || w.run.level !== lv) out.dup = true;
      else {
        w.run = null; out.won = !!b.won; out.level = lv;
        if (b.won) {
          var prev = Number(w.climb_stars[lv]) || 0, rw = climbReward(lv, st, prev);
          w.lives += 1 + rw.lives; w.coins += rw.coins;
          if (st > prev) w.climb_stars[lv] = st;
          if (lv + 1 > w.climb_level) w.climb_level = lv + 1;
          out.stars = st; out.prev = prev; out.coins = rw.coins; out.lives = rw.lives; out.chest = rw.chest;
        }
      }
    } else if (action === 'vsFinish') {
      var time = Math.round((Number(b.raw) + (parseInt(b.wrong, 10) || 0) * 3) * 1000) / 1000, won = time < Number(b.rivalTime);
      var first = w.vs_day !== b.d, prize = first ? (won ? ECON.VS_FIRST_WIN : ECON.VS_FIRST_LOSS) : (won ? ECON.VS_REMATCH_WIN : { coins: 0 });
      if (first) { w.vs_day = b.d; store.set('sd_vs_local', { day: b.d, time: time, won: won, rival: b.rivalName, raw: Number(b.raw), wrong: parseInt(b.wrong, 10) || 0 }); }
      w.coins += prize.coins; w.lives += prize.lives || 0;
      out.won = won; out.first = first; out.time = time; out.prize = prize; out.rival = { name: b.rivalName, time: Number(b.rivalTime) };
    } else if (action === 'earn') {
      if (w.earn_day !== today) { w.earn_day = today; w.earn_n = 0; }
      if (w.earn_n < ECON.EARN_CAP && b.coins > 0) { w.earn_n++; w.coins += b.coins; out.paid = b.coins; } else out.paid = 0;
    }
    w.coins = Math.max(0, Math.round(w.coins)); w.lives = Math.max(0, Math.min(ECON.BONUS_CAP, w.lives));
    store.set('sd_wallet_local', w);
    out.wallet = pubOf(w, now);
    return out;
  }

  // ---------- the current wallet, from the server or the device ----------
  var W = null, WT = 0, lifeTimer = 0;
  function rewards(action, body) {
    var p = ME ? api('/api/rewards', Object.assign({ action: action }, body || {}))
      : new Promise(function (ok) { ok(localRewards(action, body || {})); });
    return p.then(function (j) { if (j.wallet) setWallet(j.wallet); return j; });
  }
  function loadWallet() {
    if (!ME) { setWallet(pubOf(lwLoad(), Date.now())); return Promise.resolve(W); }
    if (!W) { var cached = store.get('sd_wallet', null); if (cached && cached.coins != null) setWallet(cached); }
    return api('/api/rewards').then(function (j) { setWallet(j.wallet); return W; })
      .catch(function (e) { if (e.status === 401) setMe(null); return W; });
  }
  function setWallet(w) {
    var prev = W; W = w; WT = Date.now();
    if (ME) store.set('sd_wallet', w);
    paintPurse(prev); paintGiftBar(); paintHomeTags(); if (climbOpen()) paintClimbBar();
    clearTimeout(lifeTimer);
    if (W && W.nextLifeMs != null) lifeTimer = setTimeout(loadWallet, Math.max(1000, W.nextLifeMs + 400));
  }
  function nextLifeIn() { return W && W.nextLifeMs != null ? Math.max(0, W.nextLifeMs - (Date.now() - WT)) : null; }
  // Move a guest's coins and Climb progress into a brand-new account (the server only accepts it once, into a fresh wallet).
  function adoptGuest() {
    var w = store.get('sd_wallet_local', null);
    if (!w || (w.climb_level <= 1 && w.coins === ECON.START_COINS)) return Promise.resolve();
    return api('/api/rewards', { action: 'adopt', coins: w.coins, lives: w.lives, climb: { level: w.climb_level, stars: w.climb_stars } })
      .then(function (j) { if (j.adopted) { store.del('sd_wallet_local'); toast('Your coins and Climb progress moved to your account.'); } }).catch(function () {});
  }

  var COIN_SVG = '<svg class="ic coin" viewBox="0 0 24 24" aria-hidden="true"><circle class="c1" cx="12" cy="12" r="10.5"/><circle class="c2" cx="12" cy="12" r="7"/><path class="c3" d="M12 8v8"/></svg>';
  var HEART_SVG = '<svg class="ic heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.2s-7.8-4.7-10-9.5C.5 8.2 2.7 4 6.6 4c2.3 0 3.8 1.3 5.4 3.2C13.6 5.3 15.1 4 17.4 4c3.9 0 6.1 4.2 4.6 7.7-2.2 4.8-10 9.5-10 9.5z"/></svg>';
  var STAR_SVG = '<svg class="ic star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.9l-6.4 3.5L7 14.3l-5.3-5 7.2-.9z"/></svg>';
  function chestSvg(cls) {
    return '<svg class="chest ' + (cls || '') + '" viewBox="0 0 120 100" aria-hidden="true">' +
      '<ellipse class="il-shade" cx="60" cy="92" rx="48" ry="6"/>' +
      '<rect class="ch-body" x="14" y="44" width="92" height="46" rx="8"/><rect class="ch-band" x="14" y="56" width="92" height="7"/>' +
      '<rect class="ch-band" x="26" y="44" width="8" height="46"/><rect class="ch-band" x="86" y="44" width="8" height="46"/>' +
      '<g class="ch-glow"><path class="il-sun" d="M60 6l4 12 12 4-12 4-4 12-4-12-12-4 12-4z"/><circle class="il-sun" cx="30" cy="24" r="3"/><circle class="il-sun" cx="92" cy="20" r="4"/></g>' +
      '<g class="ch-lid"><path class="ch-body" d="M14 46V36a22 22 0 0 1 22-22h48a22 22 0 0 1 22 22v10z"/><rect class="ch-band" x="26" y="16" width="8" height="30"/><rect class="ch-band" x="86" y="16" width="8" height="30"/></g>' +
      '<rect class="ch-lock" x="52" y="40" width="16" height="18" rx="4"/><circle class="il-ink" cx="60" cy="48" r="2.6"/></svg>';
  }
  function paintPurse(prev) {
    var el = $('purse'); if (!el) return;
    if (!W) { el.innerHTML = ''; return; }
    el.innerHTML = '<span class="pc">' + COIN_SVG + '<b>' + fmtN(W.coins) + '</b></span><span class="ph">' + HEART_SVG + '<b>' + W.lives + '</b></span>';
    el.setAttribute('aria-label', fmtN(W.coins) + ' coins and ' + W.lives + ' hearts. Open the Climb.');
    var bump = function (s) { if (!s) return; s.classList.remove('bump'); void s.offsetWidth; s.classList.add('bump'); };
    if (prev && prev.coins !== W.coins) bump(el.querySelector('.pc'));
    if (prev && prev.lives !== W.lives) bump(el.querySelector('.ph'));
  }
  // A "+20 coins" chip for results screens. Signed in, the server pays (on save, or in the live game);
  // guests are paid here.
  function payBattle(b) {
    var c = battleCoins(b); if (!c) return '';
    if (!ME && b.mode !== 'live') { try { localRewards('earn', { coins: c }); setWallet(pubOf(lwLoad(), Date.now())); } catch (e) {} }
    if (ME && b.mode === 'live') setTimeout(loadWallet, 600);
    return '<div class="gain">' + COIN_SVG + '<b>+' + c + '</b> coins</div>';
  }

  // ---------- sheets (modal cards) ----------
  function openSheet(html, cls) {
    closeSheet();
    var wrap = document.createElement('div'); wrap.className = 'sheet-wrap'; wrap.id = 'sheet';
    wrap.innerHTML = '<div class="sheet' + (cls ? ' ' + cls : '') + '" role="dialog" aria-modal="true"><button class="sheet-x" data-close aria-label="Close">×</button>' + html + '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target === wrap || (e.target.closest && e.target.closest('[data-close]'))) closeSheet(); });
    requestAnimationFrame(function () { wrap.classList.add('on'); });
    var f = wrap.querySelector('.btn.primary') || wrap.querySelector('.btn'); if (f) try { f.focus({ preventScroll: true }); } catch (e) {}
    return wrap;
  }
  function closeSheet() { var s = $('sheet'); if (s) s.remove(); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('sheet')) { e.preventDefault(); closeSheet(); } });

  // ---------- daily gift ----------
  function paintGiftBar() {
    var el = $('giftBar'); if (!el) return;
    if (!W || !W.gift || !W.gift.ready) { el.innerHTML = ''; el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = '<button class="giftbar" id="giftOpen">' + chestSvg('sm') + '<span class="gt"><b>Your daily gift is ready</b><small>Day ' + W.gift.day + ' of 7 · ' + prizeText(giftFor(W.gift.day)) + '</small></span><span class="btn primary">Open</span></button>';
    $('giftOpen').onclick = function () { ac(); openGift(); };
  }
  function openGift() {
    if (!W) return;
    var day = W.gift.day, ready = W.gift.ready;
    var cal = ECON.GIFTS.map(function (g, i) {
      var n = i + 1, cls = (n < day || (!ready && n === day)) ? 'got' : (n === day ? 'now' : '');
      return '<li class="' + cls + (n === 7 ? ' big' : '') + '"><span class="d">Day ' + n + '</span>' + (n === 7 ? chestSvg('xs') : COIN_SVG) + '<b>' + g.coins + '</b>' + (g.lives ? '<span class="lv">+' + g.lives + HEART_SVG + '</span>' : '<span class="lv">&nbsp;</span>') + '</li>';
    }).join('');
    openSheet('<p class="kicker">Daily Gift</p><h2 class="title">' + (ready ? 'Day ' + day + ' Gift' : 'See You Tomorrow') + '</h2>' +
      '<p class="lede">' + (ready ? 'Open a gift every day and they get bigger. Day 7 is a treasure chest. Miss a day and you start again at day 1.' : 'You’ve opened today’s gift. Tomorrow’s is day ' + ((day % 7) + 1) + ', as long as you come back.') + '</p>' +
      '<ol class="gcal">' + cal + '</ol>' +
      '<div class="chest-stage" id="giftStage">' + chestSvg('big') + '<div class="gain big" id="giftGain"></div></div>' +
      (ready ? '<button class="btn primary block lg" id="giftClaim">Open the chest</button>' : '<button class="btn block" data-close>Close</button>'), 'gift');
    if ($('giftClaim')) $('giftClaim').onclick = function () {
      var btn = this; btn.disabled = true;
      rewards('claimGift').then(function (j) {
        $('giftStage').classList.add('open'); sfx.win(); buzz(30);
        confetti([cssVar('--sun'), cssVar('--p1'), cssVar('--p2'), cssVar('--win')]);
        $('giftGain').innerHTML = COIN_SVG + '<b>+' + j.gift.coins + '</b>' + (j.gift.lives ? ' &nbsp;' + HEART_SVG + '<b>+' + j.gift.lives + '</b>' : '');
        qsa('.gcal li.now').forEach(function (li) { li.classList.remove('now'); li.classList.add('got'); });
        btn.textContent = 'Lovely, thanks!'; btn.disabled = false; btn.onclick = closeSheet;
      }).catch(function (e) { toast(e.status ? e.message : 'Can’t reach the server. Try again in a moment.'); btn.disabled = false; });
    };
  }

  // =====================================================================
  // Router
  // =====================================================================
  // Chat is switched off (2026-11-08, owner's request). Its code stays dormant; see api/_features.js to bring it back.
  var CHAT_ON = false;
  var VIEWS = ['home', 'setup', 'live', 'climb', 'vs', 'record', 'boards', 'players', 'chat', 'account'];
  var GAMESCREENS = ['play', 'handoff', 'results'];
  var setupFor = 'duel';
  function showScreen(id) {
    VIEWS.forEach(function (v) { $('v-' + v).classList.toggle('hidden', v !== id); });
    GAMESCREENS.forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
    document.body.classList.toggle('ingame', GAMESCREENS.indexOf(id) >= 0);
    var tab = (id === 'setup' || id === 'live' || id === 'climb' || id === 'vs') ? 'home' : id;
    qsa('[data-tab]').forEach(function (a) { if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (GAMESCREENS.indexOf(id) < 0) window.scrollTo(0, 0);
  }
  function route() {
    var h = (location.hash || '#/').replace(/^#\/?/, '');
    if (G) abortGame();
    chatStop(); liveStop(); climbStop(); closeSheet();
    // A starter or reset password must be replaced before anything else.
    if (ME && ME.mustChange && h !== 'account') { location.hash = '#/account'; return; }
    if (h === 'record') { showScreen('record'); renderRecord(); }
    else if (h === 'boards') { showScreen('boards'); renderBoards(); }
    else if (h === 'players') { showScreen('players'); renderPlayers(); }
    else if (h === 'account') { showScreen('account'); renderAccount(); }
    else if (h === 'chat' && CHAT_ON) { showScreen('chat'); renderChat(); }
    else if (h === 'climb') { showScreen('climb'); renderClimb(); }
    else if (h === 'vs') { showScreen('vs'); renderVs(); }
    else if (h === 'live' || h.indexOf('live/') === 0) { showScreen('live'); renderLive((h.split('/')[1] || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || null); }
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
      else if (g === 'live') go('live');
      else if (g === 'little') startLittle();
      else if (g === 'climb') go('climb');
      else if (g === 'vs') go('vs');
    });
  });
  // =====================================================================
  // v2.7 visuals shared by the home leaderboard and the players dashboard
  // =====================================================================
  var BLOB_CLS = ['il-p1', 'il-p2', 'il-sun', 'il-win'];
  function blobIdx(name) { var h = 0; name = String(name || ''); for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0; return Math.abs(h) % BLOB_CLS.length; }
  // A small round character as an avatar; the colour follows the player's name, never their rank.
  function avatar(name, size) {
    var c = BLOB_CLS[blobIdx(name)], s = size || 44;
    return '<svg class="ava" width="' + s + '" height="' + s + '" viewBox="0 0 60 60" aria-hidden="true">' +
      '<ellipse class="' + c + '" cx="30" cy="32" rx="26" ry="24"/>' +
      '<ellipse class="il-hi" cx="20" cy="20" rx="6" ry="3.5" transform="rotate(-30 20 20)"/>' +
      '<circle class="il-w" cx="22" cy="29" r="5.4"/><circle class="il-w" cx="38" cy="29" r="5.4"/>' +
      '<circle class="il-ink" cx="23" cy="29.5" r="2.6"/><circle class="il-ink" cx="39" cy="29.5" r="2.6"/>' +
      '<circle class="il-blush" cx="15" cy="37" r="3"/><circle class="il-blush" cx="45" cy="37" r="3"/>' +
      '<path class="il-line" style="stroke-width:2.2px" d="M26 38q4 4 8 0"/></svg>';
  }
  function ago(iso) {
    if (!iso) return 'not played yet';
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return 'played just now';
    if (s < 3600) return 'played ' + Math.round(s / 60) + ' min ago';
    if (s < 86400) return 'played ' + Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 30) return 'played ' + Math.round(s / 86400) + ' d ago';
    return 'played ' + fmtDate(iso);
  }
  // One shared tooltip for every [data-tip] mark (bars, W/L/D segments).
  var tipEl = null;
  function tipShow(e) {
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tipHide(); return; }
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
    tipEl.textContent = t.getAttribute('data-tip'); tipEl.classList.add('on');
    var x = e.clientX, y = e.clientY, w = tipEl.offsetWidth;
    tipEl.style.left = Math.max(8, Math.min(innerWidth - w - 8, x - w / 2)) + 'px';
    tipEl.style.top = Math.max(8, y - tipEl.offsetHeight - 14) + 'px';
    qsa('.hov').forEach(function (h) { if (h !== t) h.classList.remove('hov'); }); t.classList.add('hov');
  }
  function tipHide() { if (tipEl) tipEl.classList.remove('on'); qsa('.hov').forEach(function (h) { h.classList.remove('hov'); }); }
  document.addEventListener('pointermove', function (e) { if (e.target.closest && e.target.closest('.has-tips')) tipShow(e); else if (tipEl && tipEl.classList.contains('on')) tipHide(); });
  document.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('.has-tips [data-tip]')) tipShow(e); });
  document.addEventListener('scroll', tipHide, { passive: true });

  // =====================================================================
  // Home leaderboard (v2.7): today's Daily (fastest) and Sprint (most correct), top 5 each, public
  // =====================================================================
  var homeBoardSeq = 0;
  function renderHomeBoard() {
    var el = $('homeBoard'), my = ++homeBoardSeq, day = utcDay();
    el.innerHTML = '<div class="hb-head"><p class="kicker">Top Players</p><a class="more" href="#/boards">All boards →</a></div>' +
      '<div class="hb-grid"><div class="panel hb" id="hbDaily"><div class="skel"></div></div><div class="panel hb" id="hbSprint"><div class="skel"></div></div></div>';
    var paint = function (id, title, sub, j, daily) {
      if (my !== homeBoardSeq) return;
      var box = $(id); if (!box) return;
      var rows = (j && j.rows) || [];
      var fmt = function (r) { return daily ? Number(r.score).toFixed(2) + ' s' : r.score + ' correct'; };
      var html = '<div class="hb-title"><h3>' + title + '</h3><span>' + sub + '</span></div>';
      if (!rows.length) {
        html += '<div class="hb-empty">' + avatar('?', 56) + '<p>Nobody on this board yet.</p><button class="btn primary" data-play="' + (daily ? 'daily' : 'sprint') + '">' + (daily ? 'Play today’s Daily' : 'Set the first score') + '</button></div>';
      } else {
        var order = [1, 0, 2].filter(function (i) { return rows[i]; });
        html += '<ol class="podium" aria-label="Top three">' + order.map(function (i) {
          var r = rows[i];
          return '<li class="pod p' + r.rank + (r.me ? ' me' : '') + '"><span class="pav">' + avatar(r.name, i === 0 ? 58 : 46) + '</span>' +
            '<span class="pn">' + esc(r.name) + '</span><span class="ps">' + fmt(r) + '</span>' +
            '<span class="pb"><b>' + r.rank + '</b></span></li>';
        }).join('') + '</ol>';
        if (rows.length > 3) html += '<ol class="hb-rest" start="4">' + rows.slice(3, 5).map(function (r) {
          return '<li' + (r.me ? ' class="me"' : '') + '><span class="rk">' + r.rank + '</span>' + avatar(r.name, 28) + '<span class="nm">' + esc(r.name) + '</span><span class="sc">' + fmt(r) + '</span></li>';
        }).join('') + '</ol>';
        if (j.mine && j.mine.rank > 5) html += '<p class="hint">You’re #' + j.mine.rank + ' with ' + fmt(j.mine) + '.</p>';
      }
      box.innerHTML = html;
      qsa('[data-play]', box).forEach(function (b) { b.onclick = function () { ac(); startSoloGame(b.dataset.play); }; });
    };
    api('/api/board?b=daily&d=' + day).then(function (j) { paint('hbDaily', 'Today’s Daily', 'fastest time', j, true); })
      .catch(function () { paint('hbDaily', 'Today’s Daily', 'offline right now', null, true); });
    api('/api/board?b=sprint').then(function (j) { paint('hbSprint', 'Sprint', 'most correct in 60 s', j, false); })
      .catch(function () { paint('hbSprint', 'Sprint', 'offline right now', null, false); });
  }

  // =====================================================================
  // Players dashboard (v2.7): every player's report, visible to signed-in players only
  // =====================================================================
  var PL = { sort: 'battles', q: '', data: null };
  var GAME_NAMES = { duel: 'Duel', live: 'Live', tol: 'Truth or Lie', sprint: 'Sprint', daily: 'Daily', vs: 'Daily\u00A0VS' };
  function renderPlayers() {
    var el = $('v-players');
    var head = '<p class="kicker"><b>5</b> Players</p><h2 class="title">Everyone’s Reports</h2>';
    if (!ME) {
      el.innerHTML = head + '<div class="pl-locked panel">' + avatar('Sum', 72) + avatar('Duel', 72) +
        '<p>Sign in to see how every player is doing: games played, wins, best Sprint and fastest Daily.</p><a class="btn primary" href="#/account">Sign in</a></div>';
      return;
    }
    el.innerHTML = head + '<p class="lede">Every player’s games, wins and best scores. Only signed-in players can see this page, and it shows display names only.</p><div id="plBody"><div class="skel tall"></div></div>';
    api('/api/board?b=players').then(function (j) { PL.data = j; if (!$('v-players').classList.contains('hidden')) paintPlayers(); })
      .catch(function (e) {
        if (e.status === 401) { setMe(null); renderPlayers(); return; }
        $('plBody').innerHTML = '<div class="blank">The player reports are offline right now. Try again in a minute.</div>';
      });
  }
  // Drawn at the container's real width so axis text stays 12 px on phones (no viewBox shrink).
  function dayChart(days, width) {
    var W = Math.max(300, Math.min(1000, width || 700)), H = W < 500 ? 190 : 220, L = 30, R = 6, T = 14, B = 28;
    var every = W < 500 ? 3 : 2;
    var max = Math.max(4, Math.max.apply(null, days.map(function (d) { return d.n; })));
    var step = Math.ceil(max / 4); max = step * 4;
    var bw = (W - L - R) / days.length, gap = Math.max(4, bw * 0.28);
    var y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Battles per day for the last 14 days">';
    for (var g = 0; g <= 4; g++) {
      var gy = y(g * step);
      svg += '<line class="ch-grid' + (g === 0 ? ' base' : '') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '"/>' +
        '<text class="ch-ax" x="' + (L - 8) + '" y="' + (gy + 4) + '" text-anchor="end">' + g * step + '</text>';
    }
    days.forEach(function (d, i) {
      var x = L + i * bw + gap / 2, w = bw - gap, top = y(d.n), base = y(0), h = base - top, r = Math.min(4, w / 2, h);
      var dt = new Date(d.d + 'T12:00:00Z');
      var lab = dt.toLocaleDateString(undefined, W < 500 ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
      var tip = dt.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }) + ': ' + d.n + (d.n === 1 ? ' battle' : ' battles');
      svg += '<g class="ch-col" data-tip="' + esc(tip) + '"><rect class="ch-hit" x="' + (L + i * bw) + '" y="' + T + '" width="' + bw + '" height="' + (H - T - B + 6) + '"/>';
      if (d.n > 0) svg += '<path class="ch-bar" d="M' + x + ' ' + base + 'V' + (top + r) + 'q0 -' + r + ' ' + r + ' -' + r + 'h' + (w - 2 * r) + 'q' + r + ' 0 ' + r + ' ' + r + 'V' + base + 'z"/>';
      svg += '</g>';
      if ((days.length - 1 - i) % every === 0) svg += '<text class="ch-ax" x="' + (x + w / 2) + '" y="' + (H - 9) + '" text-anchor="middle">' + esc(lab) + '</text>';
    });
    return svg + '</svg>';
  }
  function paintPlayers() {
    var j = PL.data, body = $('plBody'); if (!j || !body) return;
    var t = j.totals, total14 = j.days.reduce(function (a, d) { return a + d.n; }, 0);
    var list = j.players.filter(function (p) { return !PL.q || p.name.toLowerCase().indexOf(PL.q) >= 0; });
    var key = { battles: function (p) { return -p.battles; }, wins: function (p) { return -p.w; },
      sprint: function (p) { return p.bestSprint == null ? 1e9 : -p.bestSprint; }, daily: function (p) { return p.bestDaily == null ? 1e9 : p.bestDaily; },
      recent: function (p) { return p.lastAt ? -new Date(p.lastAt).getTime() : 1e15; },
      climb: function (p) { return -((p.climb || 1) * 1000 + (p.stars || 0)); } }[PL.sort];
    list = list.slice().sort(function (a, b) { return key(a) - key(b) || a.name.localeCompare(b.name); });
    var tile = function (k, v, s) { return '<div class="stat"><span class="k">' + k + '</span><span class="v">' + v + '</span>' + (s ? '<span class="s">' + s + '</span>' : '') + '</div>'; };
    var html = '<div class="stats">' + tile('Players', t.players) + tile('Battles', t.battles, 'all time') + tile('This Week', t.week, 'battles') + tile('Played Today', t.today, t.today === 1 ? 'player' : 'players') + '</div>';
    html += '<div class="panel chart has-tips"><div class="ch-title"><h3>Battles per Day</h3><span>last 14 days · ' + total14 + ' in total</span></div>' + dayChart(j.days, body.clientWidth - 38) +
      '<details class="tview"><summary>Show as a table</summary><table class="tbl"><thead><tr><th>Day</th><th class="n">Battles</th></tr></thead><tbody>' +
      j.days.map(function (d) { return '<tr><td>' + esc(d.d) + '</td><td class="n">' + d.n + '</td></tr>'; }).join('') + '</tbody></table></details></div>';
    html += '<div class="pl-tools"><input class="inp" id="plQ" type="search" placeholder="Find a player" aria-label="Find a player" value="' + esc(PL.q) + '">' +
      '<div class="filters" id="plSort" role="group" aria-label="Sort players">' + [['battles', 'Most games'], ['wins', 'Most wins'], ['climb', 'Highest climb'], ['sprint', 'Best Sprint'], ['daily', 'Fastest Daily'], ['recent', 'Recent']].map(function (s) {
        return '<button data-s="' + s[0] + '" aria-pressed="' + (PL.sort === s[0]) + '">' + s[1] + '</button>';
      }).join('') + '</div></div>';
    html += '<div class="legend wld-legend" aria-hidden="true"><span style="--c:var(--c-win)">Wins</span><span style="--c:var(--c-loss)">Losses</span><span style="--c:var(--c-draw)">Draws</span><small>Duels, Live games, Truth or Lie and Daily\u00A0VS</small></div>';
    html += list.length ? '<div class="pl-grid has-tips">' + list.map(playerCard).join('') + '</div>' : '<div class="blank">No player called “' + esc(PL.q) + '”.</div>';
    body.innerHTML = html;
    $('plSort').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; PL.sort = b.dataset.s; paintPlayers(); };
    var q = $('plQ'); q.oninput = function () { PL.q = q.value.trim().toLowerCase(); var pos = q.selectionStart; paintPlayers(); var n = $('plQ'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) {} };
  }
  function playerCard(p) {
    var played = p.w + p.l + p.d;
    var seg = function (cls, n, word) { return n ? '<i class="' + cls + '" style="flex:' + n + '" data-tip="' + esc(p.name) + ': ' + n + ' ' + word + (n === 1 ? '' : (word === 'loss' ? 'es' : 's')) + '"></i>' : ''; };
    var games = Object.keys(GAME_NAMES).filter(function (k) { return p.games[k]; }).sort(function (a, b) { return p.games[b] - p.games[a]; });
    var since = new Date(p.since).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    return '<article class="pcard' + (p.me ? ' me' : '') + '">' +
      '<header>' + avatar(p.name, 52) + '<div><h3>' + esc(p.name) + (p.me ? ' <span class="badge">you</span>' : '') + '</h3><p>Joined ' + esc(since) + ' · ' + esc(ago(p.lastAt)) + '</p></div></header>' +
      ((p.climb || 1) > 1 || p.stars ? '<p class="pclimb">' + STAR_SVG + '<span>Climb level <b>' + (p.climb || 1) + '</b> · ' + (p.stars || 0) + ' stars</span></p>' : '') +
      '<dl class="pstats"><div><dt>Games</dt><dd>' + p.battles + '</dd></div><div><dt>Wins</dt><dd>' + p.w + '</dd></div>' +
      '<div><dt>Sprint</dt><dd>' + (p.bestSprint == null ? '–' : p.bestSprint) + '</dd></div><div><dt>Daily</dt><dd>' + (p.bestDaily == null ? '–' : p.bestDaily.toFixed(1) + ' s') + '</dd></div></dl>' +
      (played ? '<div class="wld" role="img" aria-label="' + p.w + ' wins, ' + p.l + ' losses, ' + p.d + ' draws">' + seg('w', p.w, 'win') + seg('l', p.l, 'loss') + seg('d', p.d, 'draw') + '</div>' +
        '<p class="wld-t">' + p.w + ' W · ' + p.l + ' L · ' + p.d + ' D' + ' <span>' + Math.round(p.w / played * 100) + '% won</span></p>'
        : '<p class="wld-t none">No duels yet</p>') +
      (games.length ? '<p class="gmix">' + games.map(function (k) { return '<span>' + GAME_NAMES[k] + ' <b>' + p.games[k] + '</b></span>'; }).join('') + '</p>' : '') +
      '</article>';
  }

  function renderHome() {
    var day = utcDay(), played = localBattles().some(function (b) { return b.game === 'daily' && b.day === day; });
    var tag = $('dailyTag'); tag.textContent = played ? 'DONE ✓' : 'TODAY'; tag.classList.toggle('live', !played);
    paintGiftBar(); paintHomeTags();
    var st = computeStats(localBattles());
    renderHomeBoard();
    var el = $('homeStats');
    if (!st.total) { el.innerHTML = ''; return; }
    el.innerHTML = '<p class="kicker">Your Numbers</p>' + kpiRow(st) +
      (ME ? '' : '<p class="foot">These stats only live on this device for now. <a href="#/account">Sign in</a> to keep them for good.</p>');
  }
  function paintHomeTags() {
    var ct = $('climbTag'); if (ct && W) ct.textContent = 'LEVEL ' + W.climb.level + ' · ' + W.climb.total + ' ★';
    var vt = $('vsTag'), raced = store.get('sd_vs_day', null) === utcDay();
    if (vt) { vt.textContent = raced ? 'RACED ✓' : 'TODAY'; vt.classList.toggle('live', !raced); }
  }
  function kpiRow(st) {
    return '<div class="kpis">' +
      '<div class="kpi c1"><div class="k">Battles</div><div class="v">' + st.total + '</div><div class="s">' + st.duels + ' head-to-head</div></div>' +
      '<div class="kpi c2"><div class="k">Win Rate</div><div class="v">' + (st.duels ? Math.round(st.w / st.duels * 100) + '%' : '–') + '</div><div class="s">' + st.w + 'W · ' + st.l + 'L' + (st.d ? ' · ' + st.d + 'D' : '') + '</div></div>' +
      '<div class="kpi"><div class="k">Best Sprint</div><div class="v">' + (st.bestSprint == null ? '–' : st.bestSprint) + '</div><div class="s">correct in 60 s</div></div>' +
      '<div class="kpi"><div class="k">Win Streak</div><div class="v">' + st.streak + '</div><div class="s">best ever ' + st.bestStreak + '</div></div>' +
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

  function abortGame() { token++; if (G && G.timer) clearInterval(G.timer); if (G && G.kind === 'little') hush(); G = null; cancelAnimationFrame(raf); wakeOff(); }
  // Sprint-style games end on the clock, not after N questions.
  function clockGame() { return G.kind === 'sprint' || G.sprint || (G.kind === 'climb' && G.lv.kind === 'target'); }

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
        list.forEach(function (pi) { var u = G.ui[pi]; u.cover.classList.remove('hidden'); u.big.textContent = steps[i];
          u.sub.textContent = i === 0 ? (G.kind === 'climb' ? 'Level ' + G.lv.L : G.kind === 'vs' ? G.names[pi] + ' vs ' + G.rival.name : G.names[pi])
            : (G.kind === 'sprint' ? '60 seconds' : G.kind === 'daily' ? 'Daily · ' + G.day : G.kind === 'climb' ? KIND[G.lv.kind].title : G.kind === 'vs' ? 'Daily\u00A0VS · ' + G.day : ''); });
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
        if (G.kind === 'climb') { climbFrame(pi); return; }
        if (G.kind === 'sprint' || G.sprint) {
          var left = G.limit - (performance.now() - p.start) / 1000;
          G.ui[pi].clock.textContent = Math.max(0, left).toFixed(1);
          G.ui[pi].bar.style.width = Math.min(100, (1 - left / G.limit) * 100) + '%';
          if (left <= 0) finish(pi);
        } else G.ui[pi].clock.textContent = elapsed(p).toFixed(1) + ' s';
        if (G.kind === 'vs') vsFrame();
      });
      if (any) raf = requestAnimationFrame(step);
    })();
  }
  function paintQ(pi) {
    var p = G.p[pi], u = G.ui[pi]; if (!u) return;
    if (G.kind === 'climb' && G.lv.kind === 'truth') return truthPaint();
    var q = G.qs[Math.min(p.idx, G.qs.length - 1)];
    u.q.textContent = q.full ? q.text : q.text + ' =';
    u.q.classList.toggle('long', !!q.full || q.text.length > 9);
    u.ans.textContent = p.input || '?'; u.ans.classList.toggle('empty', !p.input);
    if (G.kind === 'climb' && G.lv.kind === 'target') { u.prog.textContent = p.idx + ' / ' + G.lv.goal + (p.idx >= G.lv.goal ? ' ✓' : ''); }
    else if (G.kind === 'sprint' || G.sprint) { u.prog.textContent = p.idx + ' correct'; }
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
      if (!clockGame() && p.idx >= G.n) { finish(pi); return; }
      if (G.kind === 'climb' && G.lv.kind === 'target' && p.idx >= G.lv.goal + 6) { finish(pi); return; }
      if (G.kind === 'live') liveReport();
      paintQ(pi);
    } else if (p.input.length >= ans.length) {
      p.wrong++; p.input = ''; p.streak = 0; p.wrongBy[q.op] = (p.wrongBy[q.op] || 0) + 1;
      var e2 = G.ui[pi].el; e2.classList.remove('wrong'); void e2.offsetWidth; e2.classList.add('wrong');
      setTimeout(function () { e2.classList.remove('wrong'); }, 350);
      sfx.bad(); buzz(70); paintQ(pi);
      if (G.kind === 'live') liveReport();
    } else paintQ(pi);
  }
  function finish(pi) {
    var p = G.p[pi], u = G.ui[pi];
    p.end = performance.now(); p.running = false; p.done = true;
    u.bar.style.width = '100%';
    u.cover.classList.remove('hidden'); u.big.style.fontSize = 'min(17vw,11vh)';
    var my = G.token;
    if (G.kind === 'climb') { p.end = performance.now(); climbWin(); return; }
    if (G.kind === 'vs') {
      u.clock.textContent = elapsed(p).toFixed(1) + ' s'; u.big.textContent = elapsed(p).toFixed(1) + ' s'; u.sub.textContent = 'Finished'; sfx.done(); wakeOff();
      setTimeout(function () { if (G && G.token === my) vsResults(); }, 1100); return;
    }
    if (G.kind === 'live') {
      if (G.sprint) { u.big.textContent = p.idx; u.sub.textContent = 'Time! Waiting for ' + G.oppName + '…'; }
      else { u.clock.textContent = elapsed(p).toFixed(1) + ' s'; u.big.textContent = elapsed(p).toFixed(1) + ' s'; u.sub.textContent = 'Done. Waiting for ' + G.oppName + '…'; }
      sfx.done(); liveReport(true); return;
    }
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
    if (G.kind === 'little') return littleKey(e);
    if (G.kind === 'ltol' || (G.kind === 'climb' && G.lv.kind === 'truth')) {
      var kk = (e.key || '').toLowerCase(), said = (kk === 'a' || kk === 'arrowleft' || kk === 't') ? true : (kk === 's' || kk === 'arrowright' || kk === 'l') ? false : null;
      if (said === null) return; e.preventDefault();
      return G.kind === 'ltol' ? liveTolCall(said) : truthAnswer(said);
    }
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
  // =====================================================================
  // Little Ones (v2.5): a picture level for 4-year-olds. No clock, no
  // penalties, no record entry. Three kinds of round: count the pictures,
  // tap the group with more, and add two little groups. A spoken voice
  // (speechSynthesis, when available and sound is on) reads every prompt,
  // because the players can't read yet.
  // =====================================================================
  var LITTLE_N = 10;
  var LITTLE_THINGS = [
    ['🐟', 'fish', 'fish'], ['🐚', 'shell', 'shells'], ['🦀', 'crab', 'crabs'], ['🐙', 'octopus', 'octopuses'],
    ['🐳', 'whale', 'whales'], ['🦆', 'duck', 'ducks'], ['🍦', 'ice cream', 'ice creams'], ['🎈', 'balloon', 'balloons'],
    ['🍓', 'strawberry', 'strawberries'], ['⭐', 'star', 'stars'], ['🐢', 'turtle', 'turtles'], ['🌼', 'flower', 'flowers']
  ];
  var LITTLE_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  var LITTLE_CHEERS = ['Yes!', 'Well done!', 'Brilliant!', 'You got it!', 'Super!', 'Hooray!'];
  // Round plan: easy counting first, then a mix, ending on the biggest numbers.
  var LITTLE_PLAN = [['count', 1, 3], ['count', 2, 4], ['more'], ['count', 3, 5], ['add', 3], ['more'], ['count', 4, 6], ['add', 4], ['count', 5, 7], ['add', 5]];

  function littleRounds() {
    var ri = function (a, b) { return a + Math.floor(Math.random() * (b - a + 1)); };
    var pool = LITTLE_THINGS.slice().sort(function () { return Math.random() - .5; });
    return LITTLE_PLAN.map(function (p, i) {
      var thing = pool[i % pool.length], r = { kind: p[0], thing: thing };
      if (p[0] === 'count') { r.ans = ri(p[1], p[2]); r.groups = [r.ans]; }
      else if (p[0] === 'add') { r.a = ri(1, p[1] - 1); r.b = ri(1, p[1] - r.a); r.ans = r.a + r.b; r.groups = [r.a, r.b]; }
      else { var a = ri(1, 3), b = a + ri(2, 3); if (Math.random() < .5) { var t = a; a = b; b = t; } r.groups = [a, b]; r.ans = a > b ? 0 : 1; }
      if (p[0] !== 'more') {
        var near = [r.ans - 1, r.ans + 1, r.ans - 2, r.ans + 2].filter(function (v) { return v >= 1 && v <= 9; });
        near = near.slice(0, 3).sort(function () { return Math.random() - .5; }).slice(0, 2);
        r.choices = [r.ans].concat(near).sort(function (x, y) { return x - y; });
      }
      return r;
    });
  }

  // ---------- voice ----------
  var littleVoice = null;
  function pickVoice() {
    try {
      var vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
      littleVoice = vs.filter(function (v) { return /^en-GB/i.test(v.lang); })[0] || vs.filter(function (v) { return /^en/i.test(v.lang); })[0] || null;
    } catch (e) { littleVoice = null; }
  }
  try { if (window.speechSynthesis) { pickVoice(); speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', pickVoice); } } catch (e) {}
  function say(text, opts) {
    if (!S.sound || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    try {
      if (!opts || !opts.queue) speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = littleVoice ? littleVoice.lang : 'en-GB'; if (littleVoice) u.voice = littleVoice;
      u.rate = 0.9; u.pitch = 1.15;
      speechSynthesis.speak(u);
    } catch (e) {}
  }
  function hush() { try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) {} }

  function startLittle() {
    abortGame(); token++;
    G = { kind: 'little', token: token, live: true, rounds: littleRounds(), idx: 0, counted: 0, tries: 0, firstTry: 0, busy: false };
    var play = $('play');
    play.innerHTML =
      '<section class="lt">' +
        '<div class="lt-top"><button class="chipbtn" id="ltQuit">Stop</button>' +
          '<div class="lt-stars" aria-label="Progress">' + new Array(LITTLE_N + 1).join('<i></i>') + '</div>' +
          '<button class="lt-say" id="ltSay" aria-label="Say it again">🔊</button></div>' +
        '<p class="lt-prompt" id="ltPrompt" aria-live="polite"></p>' +
        '<div class="lt-scene" id="ltScene"></div>' +
        '<div class="lt-choices" id="ltChoices"></div>' +
        '<div class="lt-cover" id="ltCover"><div class="lt-wave" aria-hidden="true">🐟 🐚 🦀</div>' +
          '<h2>Little Ones</h2><p>Count, find more, add up.</p>' +
          '<button class="lt-go" id="ltGo" aria-label="Start">▶</button><p class="lt-small">Tap the big button to start</p></div>' +
      '</section>';
    $('ltQuit').onclick = function () { hush(); abortGame(); route(); };
    $('ltSay').onclick = function () { littleSayPrompt(); };
    $('ltGo').onclick = function () { ac(); $('ltCover').classList.add('hidden'); littleRound(); };
    $('ltScene').addEventListener('click', littleTapScene);
    $('ltChoices').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) littleAnswer(Number(b.dataset.v), b); });
    showScreen('play'); wakeOn();
  }

  function littleRows(n, big) {
    if (n <= 3) return [n];
    if (!big && n === 4) return [2, 2];
    return [Math.ceil(n / 2), Math.floor(n / 2)];
  }
  function littleGroupHtml(n, emoji, gi, startNo) {
    return '<div class="lt-group" data-g="' + gi + '">' + littleRows(n, false).map(function (cnt) {
      var row = '';
      for (var k = 0; k < cnt; k++) row += '<span class="lt-it" data-i="' + (startNo++) + '">' + emoji + '</span>';
      return '<div class="lt-row">' + row + '</div>';
    }).join('') + '</div>';
  }
  function littlePromptText(r) {
    if (r.kind === 'count') return 'How many ' + r.thing[2] + '?';
    if (r.kind === 'add') return 'How many ' + r.thing[2] + ' altogether?';
    return 'Which side has more ' + r.thing[2] + '?';
  }
  function littleSayPrompt() {
    if (!G || G.kind !== 'little') return;
    var r = G.rounds[G.idx]; if (!r) return;
    var t = littlePromptText(r);
    if (r.kind === 'add') t = LITTLE_WORDS[r.a] + ' ' + (r.a === 1 ? r.thing[1] : r.thing[2]) + ', and ' + LITTLE_WORDS[r.b] + ' more. ' + t;
    if (r.kind !== 'more') t += ' Tap them to count.';
    say(t);
  }
  function littleRound() {
    if (!G || G.kind !== 'little') return;
    var r = G.rounds[G.idx], em = r.thing[0];
    G.counted = 0; G.tries = 0; G.busy = false;
    $('ltPrompt').textContent = littlePromptText(r);
    var sc = $('ltScene'); sc.className = 'lt-scene ' + r.kind;
    if (r.kind === 'count') sc.innerHTML = '<div class="lt-group" data-g="0">' + littleRows(r.ans, true).map(function (cnt, ri) {
      var row = '', base = ri ? littleRows(r.ans, true)[0] : 0;
      for (var k = 0; k < cnt; k++) row += '<span class="lt-it" data-i="' + (base + k) + '">' + em + '</span>';
      return '<div class="lt-row">' + row + '</div>';
    }).join('') + '</div>';
    else if (r.kind === 'add') sc.innerHTML = littleGroupHtml(r.a, em, 0, 0) + '<span class="lt-op" aria-hidden="true">+</span>' + littleGroupHtml(r.b, em, 1, r.a);
    else sc.innerHTML = r.groups.map(function (n, gi) {
      return '<button class="lt-side" data-v="' + gi + '" aria-label="' + (gi ? 'Right side' : 'Left side') + ', ' + n + ' ' + (n === 1 ? r.thing[1] : r.thing[2]) + '">' + littleGroupHtml(n, em, gi, 0) + '</button>';
    }).join('<span class="lt-op lt-or" aria-hidden="true">or</span>');
    var ch = $('ltChoices');
    if (r.kind === 'more') { ch.innerHTML = ''; ch.classList.add('hidden'); }
    else {
      ch.classList.remove('hidden');
      ch.innerHTML = r.choices.map(function (v) {
        return '<button data-v="' + v + '" aria-label="' + v + '"><b>' + v + '</b><span class="lt-dots" aria-hidden="true">' + new Array(v + 1).join('<i></i>') + '</span></button>';
      }).join('');
    }
    littlePaintStars();
    setTimeout(littleSayPrompt, 250);
  }
  function littlePaintStars() {
    qsa('.lt-stars i').forEach(function (s, k) { s.classList.toggle('on', k < G.idx); s.classList.toggle('now', k === G.idx); });
  }
  function littleTapScene(e) {
    if (!G || G.kind !== 'little' || G.busy) return;
    var r = G.rounds[G.idx];
    if (r.kind === 'more') { var side = e.target.closest('.lt-side'); if (side) littleAnswer(Number(side.dataset.v), side); return; }
    var it = e.target.closest('.lt-it'); if (!it || it.dataset.no) return;
    G.counted++; it.dataset.no = G.counted;
    it.classList.add('counted');
    tone(440 + G.counted * 70, 0.12, 'triangle', 0.08);
    say(LITTLE_WORDS[G.counted] || String(G.counted));
  }
  function littleAnswer(v, btn) {
    if (!G || G.kind !== 'little' || G.busy) return;
    var r = G.rounds[G.idx], my = G.token;
    if (v === r.ans) {
      G.busy = true; if (!G.tries) G.firstTry++;
      btn.classList.add('right');
      sfx.good(); buzz(20);
      $('ltScene').classList.add('happy');
      var cheer = LITTLE_CHEERS[Math.floor(Math.random() * LITTLE_CHEERS.length)];
      if (r.kind === 'more') say(cheer + ' ' + LITTLE_WORDS[r.groups[r.ans]] + ' is more than ' + LITTLE_WORDS[r.groups[1 - r.ans]] + '.');
      else say(cheer + ' ' + LITTLE_WORDS[r.ans] + ' ' + (r.ans === 1 ? r.thing[1] : r.thing[2]) + '!');
      G.idx++; littlePaintStars();
      setTimeout(function () {
        if (!G || G.token !== my) return;
        if (G.idx >= LITTLE_N) littleDone(); else littleRound();
      }, 2300);
    } else {
      G.tries++;
      btn.classList.remove('nope'); void btn.offsetWidth; btn.classList.add('nope'); btn.disabled = true;
      tone(300, 0.14, 'triangle', 0.06); tone(250, 0.18, 'triangle', 0.05, 0.12);
      say(r.kind === 'more' ? 'Not that one. Look again!' : 'Nearly! Let’s count them together.');
      if (r.kind !== 'more') littleCountAlong(my);
    }
  }
  // After a wrong pick, number each picture one by one so the child can count along.
  function littleCountAlong(my) {
    var items = qsa('#ltScene .lt-it'); G.busy = true; G.counted = 0;
    items.forEach(function (it) { delete it.dataset.no; it.classList.remove('counted'); });
    var k = 0;
    setTimeout(function step() {
      if (!G || G.token !== my) return;
      if (k >= items.length) { G.busy = false; return; }
      var it = items[k++]; G.counted = k; it.dataset.no = k; it.classList.add('counted');
      tone(440 + k * 70, 0.12, 'triangle', 0.08); say(LITTLE_WORDS[k] || String(k));
      setTimeout(step, 750);
    }, 1900);
  }
  function littleDone() {
    var total = store.get('sd_little_stars', 0) + LITTLE_N; store.set('sd_little_stars', total);
    sfx.win(); confetti([cssVar('--p1'), cssVar('--p2'), cssVar('--sun'), cssVar('--win')]);
    var sec = qsa('#play .lt')[0]; if (!sec) return;
    sec.innerHTML =
      '<div class="lt-end">' +
        '<div class="lt-trophy" aria-hidden="true">🏆</div>' +
        '<h2>You Did It!</h2>' +
        '<p class="lt-earned">' + new Array(LITTLE_N + 1).join('<i>⭐</i>') + '</p>' +
        '<p class="lt-total">' + total + ' stars altogether</p>' +
        '<div class="lt-endbtns"><button class="btn primary lg" id="ltAgain">Play again</button><button class="btn ghost lg" id="ltHome">All done</button></div>' +
      '</div>';
    say('You did it! Ten more stars. You have ' + total + ' stars altogether!');
    $('ltAgain').onclick = function () { ac(); startLittle(); $('ltCover').classList.add('hidden'); littleRound(); };
    $('ltHome').onclick = function () { hush(); abortGame(); go(''); };
  }
  function littleKey(e) {
    if (!G.rounds || G.busy) return;
    var r = G.rounds[G.idx]; if (!r) return;
    var m = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || '');
    if (r.kind === 'more') {
      var side = e.key === 'ArrowLeft' ? 0 : e.key === 'ArrowRight' ? 1 : -1;
      if (side < 0) return; e.preventDefault();
      littleAnswer(side, qsa('#ltScene .lt-side')[side]); return;
    }
    if (!m) return;
    var btn = qsa('#ltChoices button').filter(function (b) { return b.dataset.v === m[1] && !b.disabled; })[0];
    if (btn) { e.preventDefault(); littleAnswer(Number(m[1]), btn); }
  }

  // =====================================================================
  // v2.8 The Climb: a trail of levels up the coast, 12 to an area. Each level is a short challenge
  // (beat the clock, truth or lie, missing number, target, mix-up, and a big one at the end of every
  // area that opens a treasure chest). Starting a level uses a heart; winning gives it back, plus coins.
  // Levels are generated from their number, so there's nothing to store but stars.
  // =====================================================================
  var AREAS = [
    { name: 'Rock Pools', level: 'easy', ops: ['+'], ops2: ['+', '−'], tpq: 6, t: 'pools' },
    { name: 'The Harbour', level: 'easy', ops: ['+', '−'], ops2: ['+', '−', '×'], tpq: 5.5, t: 'harbour' },
    { name: 'Sand Dunes', level: 'easy', ops: ['×', '÷'], ops2: ['+', '−', '×', '÷'], tpq: 5, t: 'dunes' },
    { name: 'The Pier', level: 'medium', ops: ['+', '−'], ops2: ['+', '−'], tpq: 8, t: 'pier' },
    { name: 'Cliff Path', level: 'medium', ops: ['×', '÷'], ops2: ['×', '÷'], tpq: 6.5, t: 'cliff' },
    { name: 'Lighthouse Point', level: 'medium', ops: ['+', '−', '×', '÷'], ops2: ['+', '−', '×', '÷'], tpq: 6, t: 'lighthouse' },
    { name: 'Starry Sky', level: 'hard', ops: ['+', '−'], ops2: ['+', '−'], tpq: 10, t: 'stars' },
    { name: 'Moon Beach', level: 'hard', ops: ['×', '÷'], ops2: ['+', '−', '×', '÷'], tpq: 9, t: 'moon' }
  ];
  var KINDS = ['race', 'truth', 'missing', 'race', 'target', 'mixed', 'race', 'truth', 'missing', 'target', 'race', 'boss'];
  var KIND = {
    race: { title: 'Beat the Clock', text: function (d) { return 'Answer ' + d.n + ' sums before the clock runs out. Every wrong answer costs 3 seconds.'; } },
    truth: { title: 'Truth or Lie', text: function (d) { return 'Call ' + d.n + ' sums true or a lie. You can make ' + d.allow + ' mistakes.'; } },
    missing: { title: 'Missing Number', text: function (d) { return 'Find the missing number in ' + d.n + ' sums, like 7 × ? = 42.'; } },
    target: { title: 'Target', text: function (d) { return 'Get ' + d.goal + ' right in ' + d.limit + ' seconds. Keep going for more stars.'; } },
    mixed: { title: 'Mix-Up', text: function (d) { return d.n + ' sums, and every other one has a missing number.'; } },
    boss: { title: 'The Big One', text: function (d) { return d.n + ' sums with everything from this area. Clear it to open the treasure chest!'; } }
  };
  function areaDef(a) {
    if (a < AREAS.length) return AREAS[a];
    var k = a - AREAS.length + 1, t = ['stars', 'moon', 'lighthouse'][(k - 1) % 3];
    return { name: 'Summit ' + k, level: 'hard', ops: ['+', '−', '×', '÷'], ops2: ['+', '−', '×', '÷'], tpq: Math.max(6, 9 - 0.3 * k), t: t };
  }
  function climbDef(L) {
    var a = Math.floor((L - 1) / AREA), p = (L - 1) % AREA, A = areaDef(a), kind = KINDS[p];
    var ops = kind === 'boss' ? A.ops.concat(A.ops2.filter(function (o) { return A.ops.indexOf(o) < 0; })) : (p < 6 ? A.ops : A.ops2);
    var n = kind === 'boss' ? 12 : kind === 'truth' ? 8 : 5 + Math.floor(p / 4);
    var tpq = A.tpq * (1 - 0.02 * p);
    var d = { L: L, area: a, p: p, kind: kind, ops: ops, level: A.level, n: n, areaName: A.name };
    if (kind === 'target') { d.limit = 45; d.goal = Math.max(5, Math.floor(45 / tpq * 0.85)); }
    else if (kind === 'truth') { d.limit = Math.round(n * Math.max(5, tpq * 0.9)); d.allow = 2; }
    else d.limit = Math.round(n * tpq * (kind === 'missing' ? 1.25 : kind === 'mixed' ? 1.15 : kind === 'boss' ? 1.1 : 1));
    return d;
  }
  function toMissing(q, first) {
    var t = q.text.split(' '), a = t[0], op = t[1], b = t[2];
    return first ? { text: '? ' + op + ' ' + b + ' = ' + q.ans, ans: a, op: op, full: true } : { text: a + ' ' + op + ' ? = ' + q.ans, ans: b, op: op, full: true };
  }
  function climbQuestions(d) {
    var seed = (Math.random() * 2147483647) | 0, r = rng(seed ^ 0x2545f491);
    if (d.kind === 'truth') return makeTol(d.n, d.ops, d.level, seed);
    if (d.kind === 'target') return makeQuestions(400, d.ops, d.level, seed);
    var qs = makeQuestions(d.n, d.ops, d.level, seed);
    if (d.kind === 'missing') return qs.map(function (q) { return toMissing(q, r() < 0.5); });
    if (d.kind === 'mixed') return qs.map(function (q, i) { return i % 2 ? toMissing(q, r() < 0.5) : q; });
    return qs;
  }
  function starsHtml(n, cls) { var s = ''; for (var i = 0; i < 3; i++) s += '<i class="' + (i < n ? 'on' : '') + '">' + STAR_SVG + '</i>'; return '<span class="stars ' + (cls || '') + '">' + s + '</span>'; }

  // ---------- scenery: small decorations at the edges of each area (inline SVG, coloured by .il-* classes) ----------
  var DECOR = {
    rock: '<ellipse class="il-rock" cx="50" cy="72" rx="46" ry="24"/><ellipse class="il-rock2" cx="70" cy="76" rx="22" ry="14"/><ellipse class="il-hi" cx="34" cy="62" rx="12" ry="5"/>',
    star: '<path class="il-p2" d="M50 10l10 27h28l-23 17 9 28-24-17-24 17 9-28-23-17h28z"/><circle class="il-hi" cx="44" cy="40" r="4"/>',
    crab: '<ellipse class="il-p2" cx="50" cy="62" rx="26" ry="18"/><path class="il-p2" d="M22 52l-12-14 4-6 8 8 2-10 6 4-4 14zM78 52l12-14-4-6-8 8-2-10-6 4 4 14z"/><circle class="il-w" cx="42" cy="46" r="6"/><circle class="il-w" cx="58" cy="46" r="6"/><circle class="il-ink" cx="43" cy="47" r="3"/><circle class="il-ink" cx="59" cy="47" r="3"/><path class="il-line" style="stroke-width:2.5px" d="M44 66q6 5 12 0"/>',
    shell: '<path class="il-sun" d="M50 20c-24 0-38 26-34 50h68c4-24-10-50-34-50z"/><path class="il-line" style="stroke-width:3px;opacity:.5" d="M50 24v44M34 30l8 38M66 30l-8 38M22 46l14 22M78 46l-14 22"/>',
    boat: '<path class="il-p2" d="M8 62h84l-14 22H22z"/><rect class="il-ink" x="48" y="12" width="4" height="50"/><path class="il-w il-edge" d="M53 14l32 44H53z"/><path class="il-p1" d="M47 22L22 56h25z"/><path class="il-sea2" d="M0 86q12-8 25 0t25 0 25 0 25 0V100H0z"/>',
    gull: '<path class="il-line" style="stroke-width:4px" d="M10 50q12-14 24 0q12-14 24 0M52 26q8-9 16 0q8-9 16 0"/>',
    buoy: '<path class="il-p2" d="M30 74l8-40h24l8 40z"/><rect class="il-w" x="33" y="50" width="34" height="8"/><circle class="il-sun" cx="50" cy="28" r="7"/><path class="il-sea2" d="M0 76q12-8 25 0t25 0 25 0 25 0V100H0z"/>',
    dune: '<path class="il-sand2" d="M0 100V70q22-26 50-12t50-8v50z"/><path class="il-sand" d="M0 100V82q30-22 60-6t40 0v24z"/>',
    brolly: '<rect class="il-ink" x="48" y="38" width="4" height="56"/><path class="il-p2" d="M8 42a42 28 0 0 1 84 0z"/><path class="il-w" d="M36 42a14 28 0 0 1 28 0z"/><path class="il-sand" d="M14 96q36-12 72 0z"/>',
    bucket: '<path class="il-p1" d="M26 44h48l-6 46H32z"/><path class="il-line" style="stroke-width:4px" d="M28 46q22-30 44 0"/><rect class="il-sun" x="62" y="14" width="6" height="56" rx="3" transform="rotate(24 65 42)"/>',
    pier: '<rect class="il-wood" x="0" y="34" width="100" height="10" rx="2"/><rect class="il-wood2" x="12" y="44" width="7" height="52"/><rect class="il-wood2" x="46" y="44" width="7" height="52"/><rect class="il-wood2" x="80" y="44" width="7" height="52"/><path class="il-sea2" d="M0 80q12-8 25 0t25 0 25 0 25 0V100H0z"/>',
    icecream: '<path class="il-sun" d="M34 50l16 44 16-44z"/><circle class="il-p2" cx="50" cy="40" r="17"/><circle class="il-w" cx="40" cy="26" r="10"/><circle class="il-hi" cx="44" cy="34" r="4"/>',
    wheel: '<circle class="il-edge" style="fill:none;stroke-width:6px" cx="50" cy="44" r="34"/><path class="il-line" style="stroke-width:3px" d="M50 10v68M16 44h68M26 20l48 48M74 20L26 68"/><circle class="il-p2" cx="50" cy="10" r="6"/><circle class="il-p1" cx="84" cy="44" r="6"/><circle class="il-sun" cx="16" cy="44" r="6"/><circle class="il-win" cx="50" cy="78" r="6"/><path class="il-wood2" d="M50 44l-22 52h8l14-34 14 34h8z"/>',
    cliff: '<path class="il-rock" d="M0 100V40q20-6 40 0l14 60z"/><path class="il-grass" d="M0 44V32q22-10 44 0l2 10q-22-8-46 2z"/>',
    flower: '<path class="il-grass" d="M48 96V50h4v46z"/><circle class="il-sun" cx="50" cy="40" r="7"/><circle class="il-p2" cx="50" cy="26" r="8"/><circle class="il-p2" cx="64" cy="40" r="8"/><circle class="il-p2" cx="50" cy="54" r="8"/><circle class="il-p2" cx="36" cy="40" r="8"/><circle class="il-sun" cx="50" cy="40" r="6"/>',
    sheep: '<circle class="il-w il-edge" cx="40" cy="50" r="16"/><circle class="il-w il-edge" cx="58" cy="46" r="16"/><circle class="il-w il-edge" cx="52" cy="60" r="16"/><ellipse class="il-ink" cx="74" cy="52" rx="9" ry="11"/><rect class="il-ink" x="40" y="72" width="5" height="16"/><rect class="il-ink" x="58" y="72" width="5" height="16"/>',
    lighthouse: '<path class="il-w il-edge" d="M34 94l8-62h16l8 62z"/><path class="il-p2" d="M37.3 70h25.4l1.5 12H35.8zM40 48h20l1.2 10H38.8z"/><rect class="il-sun" x="40" y="18" width="20" height="14" rx="3"/><path class="il-ink" d="M36 18l14-12 14 12z"/><path class="il-ray" d="M66 22l26-8M66 28l26 6"/><path class="il-rock" d="M14 100q10-14 36-12t38 12z"/>',
    moon: '<path class="il-moon" d="M62 10a40 40 0 1 0 28 66A32 32 0 1 1 62 10z"/>',
    bigmoon: '<circle class="il-moon" cx="50" cy="50" r="40"/><circle class="il-moon2" cx="36" cy="40" r="8"/><circle class="il-moon2" cx="62" cy="64" r="6"/><circle class="il-moon2" cx="60" cy="30" r="4"/>',
    stars: '<path class="il-sun" d="M24 14l4 10 10 4-10 4-4 10-4-10-10-4 10-4z"/><path class="il-sun" d="M70 40l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/><circle class="il-sun" cx="40" cy="70" r="3"/><circle class="il-sun" cx="84" cy="16" r="2.5"/><circle class="il-sun" cx="16" cy="88" r="2"/>',
    kite: '<path class="il-p2" d="M50 6l26 30-26 40-26-40z"/><path class="il-p1" d="M50 6v70L24 36z"/><path class="il-line" style="stroke-width:2.5px" d="M50 76q-10 10 0 16t-4 8"/>',
    wave: '<path class="il-sea" d="M0 60q12-12 25 0t25 0 25 0 25 0V100H0z"/><path class="il-sea2" d="M0 78q12-10 25 0t25 0 25 0 25 0V100H0z"/>'
  };
  var SCENE = {
    pools: [['rock', 'l', 8, 96], ['star', 'r', 22, 60], ['crab', 'l', 44, 78], ['shell', 'r', 60, 58], ['rock', 'r', 80, 90], ['star', 'l', 86, 46]],
    harbour: [['boat', 'l', 10, 110], ['gull', 'r', 18, 80], ['buoy', 'r', 46, 64], ['boat', 'r', 70, 96], ['gull', 'l', 64, 70], ['buoy', 'l', 88, 54]],
    dunes: [['dune', 'l', 6, 120], ['brolly', 'r', 24, 92], ['bucket', 'l', 46, 64], ['dune', 'r', 64, 120], ['shell', 'l', 80, 50], ['brolly', 'l', 90, 70]],
    pier: [['wheel', 'r', 6, 112], ['pier', 'l', 30, 120], ['icecream', 'r', 50, 60], ['gull', 'l', 64, 76], ['pier', 'r', 80, 120]],
    cliff: [['cliff', 'l', 8, 120], ['sheep', 'r', 26, 80], ['flower', 'l', 50, 54], ['flower', 'r', 60, 48], ['cliff', 'r', 78, 120], ['sheep', 'l', 86, 70]],
    lighthouse: [['lighthouse', 'r', 4, 130], ['gull', 'l', 22, 80], ['rock', 'l', 50, 90], ['boat', 'r', 64, 96], ['wave', 'l', 84, 120]],
    stars: [['moon', 'r', 6, 90], ['stars', 'l', 14, 100], ['kite', 'r', 40, 66], ['stars', 'r', 62, 100], ['stars', 'l', 76, 90]],
    moon: [['bigmoon', 'l', 6, 120], ['stars', 'r', 18, 100], ['stars', 'l', 50, 90], ['wave', 'r', 72, 120], ['crab', 'l', 86, 60]]
  };

  var STEP = 96, AREA_TOP = 120, AREA_BOT = 54;
  function nodeX(a, i) { return 50 + 28 * Math.sin(i * 0.95 + a * 1.9); }
  function areaH() { return AREA_TOP + (AREA - 1) * STEP + AREA_BOT; }
  function nodeY(i) { return AREA_TOP + (AREA - 1 - i) * STEP; }
  function trailPath(a) {
    var H = areaH(), pts = [];
    pts.push([a === 0 ? nodeX(0, 0) : (nodeX(a, 0) + nodeX(a - 1, AREA - 1)) / 2, H]);
    for (var i = 0; i < AREA; i++) pts.push([nodeX(a, i), nodeY(i)]);
    pts.push([(nodeX(a, AREA - 1) + nodeX(a + 1, 0)) / 2, 0]);
    // Catmull-Rom through the points, as cubic Béziers
    var d = 'M' + pts[0][0].toFixed(2) + ' ' + pts[0][1];
    for (var k = 0; k < pts.length - 1; k++) {
      var p0 = pts[Math.max(0, k - 1)], p1 = pts[k], p2 = pts[k + 1], p3 = pts[Math.min(pts.length - 1, k + 2)];
      d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(2) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' +
        (p2[0] - (p3[0] - p1[0]) / 6).toFixed(2) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' + p2[0].toFixed(2) + ' ' + p2[1];
    }
    return d;
  }
  function areaHtml(a, cur) {
    var A = areaDef(a), H = areaH(), first = a * AREA + 1, stars = W ? W.climb.stars : {}, got = 0;
    for (var l = first; l < first + AREA; l++) got += Number(stars[l]) || 0;
    var locked = cur < first, done = cur > first + AREA - 1;
    var html = '<section class="area t-' + A.t + (locked ? ' locked' : '') + '" style="height:' + H + 'px" aria-label="Area ' + (a + 1) + ': ' + esc(A.name) + '">';
    html += '<div class="decor" aria-hidden="true">' + (SCENE[A.t] || []).map(function (s) {
      return '<svg viewBox="0 0 100 100" style="' + (s[1] === 'l' ? 'left' : 'right') + ':-6px;top:' + s[2] + '%;width:' + s[3] + 'px;height:' + s[3] + 'px">' + DECOR[s[0]] + '</svg>';
    }).join('') + '</div>';
    html += '<svg class="path" viewBox="0 0 100 ' + H + '" preserveAspectRatio="none" aria-hidden="true"><path class="p-under" d="' + trailPath(a) + '"/><path class="p-top" d="' + trailPath(a) + '"/></svg>';
    html += '<header class="area-h"><span class="an">Area ' + (a + 1) + '</span><b>' + esc(A.name) + '</b><span class="as">' + STAR_SVG + got + '/' + AREA * 3 + '</span>' + (done ? '<span class="ad">✓</span>' : '') + '</header>';
    for (var i = 0; i < AREA; i++) {
      var L = first + i, st = Number(stars[L]) || 0, boss = (i === AREA - 1);
      var cls = L < cur ? 'done' : L === cur ? 'now' : 'lock';
      var lab = 'Level ' + L + (boss ? ', the big one' : '') + (cls === 'done' ? ', ' + st + (st === 1 ? ' star' : ' stars') : cls === 'lock' ? ', locked' : ', play next');
      html += '<button class="node ' + cls + (boss ? ' boss' : '') + '" data-l="' + L + '" style="left:' + nodeX(a, i).toFixed(2) + '%;top:' + nodeY(i) + 'px" aria-label="' + lab + '">' +
        (cls === 'now' ? '<span class="me-ava">' + avatar(ME ? ME.name : 'You', 40) + '</span>' : '') +
        (boss ? chestSvg('in-node' + (cls === 'done' ? ' open' : '')) : '') +
        '<span class="nb">' + L + '</span>' + (cls === 'done' ? starsHtml(st, 'ns') : '') + '</button>';
    }
    return html + '</section>';
  }

  var climbTick = 0;
  function climbOpen() { var v = $('v-climb'); return !!v && !v.classList.contains('hidden'); }
  function climbStop() { clearInterval(climbTick); climbTick = 0; }
  function renderClimb() {
    climbStop();
    var el = $('v-climb');
    var paint = function () {
      var cur = W ? W.climb.level : 1, curArea = Math.floor((cur - 1) / AREA), nAreas = Math.max(AREAS.length, curArea + 2), html = '';
      html += '<p class="kicker"><b>2.6</b> The Climb</p><h2 class="title">The Climb</h2>' +
        '<p class="lede">Climb the coast one level at a time. Win stars and coins, and open a treasure chest at the end of every area. A level costs a heart only if you don’t make it.</p>' +
        '<div class="climb-bar" id="climbBar"></div><div class="trail" id="trail">';
      for (var a = nAreas - 1; a >= 0; a--) html += areaHtml(a, cur);
      html += '<div class="trail-start">' + avatar('Start', 34) + '<span>Start here</span></div></div>';
      el.innerHTML = html;
      paintClimbBar();
      $('trail').onclick = function (e) {
        var b = e.target.closest('.node'); if (!b) return;
        ac();
        var L = Number(b.dataset.l);
        if (b.classList.contains('lock')) { toast('Finish level ' + cur + ' to get here.'); return; }
        openLevel(L);
      };
      var now = el.querySelector('.node.now');
      if (now) requestAnimationFrame(function () { var r = now.getBoundingClientRect(); window.scrollTo(0, Math.max(0, window.scrollY + r.top - innerHeight * 0.55)); });
    };
    paint();
    loadWallet().then(function () { if (climbOpen() && !$('sheet')) { var y = window.scrollY; paint(); if (y > 0 && !el.querySelector('.node.now')) window.scrollTo(0, y); } });
    climbTick = setInterval(function () { if (climbOpen()) paintClimbBar(true); else climbStop(); }, 1000);
  }
  function heartsRow(n, max) {
    var s = '', show = Math.max(max, Math.min(n, ECON.BONUS_CAP));
    for (var i = 0; i < show; i++) s += '<i class="' + (i < n ? 'on' : '') + (i >= max ? ' bonus' : '') + '">' + HEART_SVG + '</i>';
    return '<span class="hearts">' + s + '</span>';
  }
  function paintClimbBar(tickOnly) {
    var el = $('climbBar'); if (!el || !W) return;
    var next = nextLifeIn();
    if (tickOnly) { var t = $('cbNext'); if (t) t.textContent = next == null ? 'Hearts full' : 'Next heart in ' + fmtClock(next); return; }
    el.innerHTML = '<div class="cb-h">' + heartsRow(W.lives, W.maxLives) + '<small id="cbNext">' + (next == null ? 'Hearts full' : 'Next heart in ' + fmtClock(next)) + '</small></div>' +
      '<div class="cb-c">' + COIN_SVG + '<b>' + fmtN(W.coins) + '</b><small>coins</small></div>' +
      '<div class="cb-s">' + STAR_SVG + '<b>' + W.climb.total + '</b><small>stars</small></div>' +
      '<div class="cb-a">' + (W.gift && W.gift.ready ? '<button class="btn primary" id="cbGift">Daily gift</button>' : '') + '<button class="btn" id="cbShop">Get hearts</button></div>';
    if ($('cbGift')) $('cbGift').onclick = openGift;
    $('cbShop').onclick = function () { openShop(); };
  }
  function openShop(msg) {
    if (!W) { toast('Can’t load your hearts right now. Check your connection.'); loadWallet(); return; }
    var full = W.lives >= W.maxLives, next = nextLifeIn();
    openSheet('<p class="kicker">Hearts</p><h2 class="title">' + (W.lives ? 'You Have ' + W.lives + (W.lives === 1 ? ' Heart' : ' Hearts') : 'Out of Hearts') + '</h2>' +
      (msg ? '<p class="lede">' + esc(msg) + '</p>' : '<p class="lede">A level only costs a heart if you don’t make it. Hearts come back by themselves: one every ' + ECON.REGEN_MIN + ' minutes, up to ' + ECON.MAX_LIVES + '.</p>') +
      '<div class="shop-hearts">' + heartsRow(W.lives, W.maxLives) + '<small>' + (next == null ? 'Full up' : 'Next free heart in ' + fmtClock(next)) + '</small></div>' +
      '<div class="shop">' +
        '<button class="shop-i" id="buyOne"' + (W.coins < ECON.LIFE_COST || W.lives >= ECON.BONUS_CAP ? ' disabled' : '') + '>' + HEART_SVG + '<b>1 heart</b><span>' + COIN_SVG + ECON.LIFE_COST + '</span></button>' +
        '<button class="shop-i" id="buyAll"' + (W.coins < ECON.REFILL_COST || full ? ' disabled' : '') + '><i class="hs">' + HEART_SVG + HEART_SVG + HEART_SVG + '</i><b>Fill up</b><span>' + COIN_SVG + ECON.REFILL_COST + '</span></button>' +
      '</div><p class="foot">You have ' + fmtN(W.coins) + ' coins. Every game you play earns more, and so does the daily gift.</p>' +
      (W.gift && W.gift.ready ? '<button class="btn primary block" id="shopGift">Open today’s gift first</button>' : ''), 'shop-sheet');
    var buy = function (what) { rewards('buy', { what: what }).then(function () { sfx.good(); toast(what === 'refill' ? 'Hearts filled up!' : 'One more heart!'); openShop(); }).catch(function (e) { toast(e.message); }); };
    $('buyOne').onclick = function () { buy('life'); };
    $('buyAll').onclick = function () { buy('refill'); };
    if ($('shopGift')) $('shopGift').onclick = openGift;
  }
  function openLevel(L) {
    var d = climbDef(L), info = KIND[d.kind], prev = Number(W && W.climb.stars[L]) || 0, rw = climbReward(L, 3, prev);
    var rules = d.kind === 'target' ? starsHtml(1) + ' ' + d.goal + ' right &nbsp; ' + starsHtml(2) + ' ' + (d.goal + 3) + ' &nbsp; ' + starsHtml(3) + ' ' + (d.goal + 6)
      : d.kind === 'truth' ? starsHtml(3) + ' no mistakes &nbsp; ' + starsHtml(2) + ' one &nbsp; ' + starsHtml(1) + ' two'
      : 'Finish with lots of time left for ' + starsHtml(3);
    var noWallet = !W, noLives = !W || W.lives < 1;
    openSheet('<p class="kicker">Level ' + L + ' · ' + esc(d.areaName) + '</p>' +
      '<div class="lv-head">' + (d.kind === 'boss' ? chestSvg('lv') : '<span class="lv-badge k-' + d.kind + '">' + L + '</span>') + '<div><h2 class="title">' + info.title + '</h2>' + (prev ? starsHtml(prev, 'best') : '') + '</div></div>' +
      '<p class="lede">' + esc(info.text(d)) + '</p>' +
      '<div class="lv-chips"><span>' + esc(d.ops.join(' ')) + '</span><span>' + esc(d.level) + '</span><span>' + d.limit + ' s clock</span></div>' +
      '<p class="lv-rule">' + rules + '</p>' +
      '<p class="lv-prize">' + COIN_SVG + (prev ? (prev < 3 ? 'Up to +' + rw.coins + ' coins for more stars' : '+5 coins for playing again') : 'Up to +' + rw.coins + ' coins' + (rw.chest ? ', the chest and 2 hearts' : '')) + '</p>' +
      (noWallet ? '<div class="err" style="font-style:normal">Can’t load your hearts right now. Check your connection and try again.</div><button class="btn primary block lg" id="lvRetry">Try again</button>'
        : noLives ? '<div class="err" style="font-style:normal">You’re out of hearts. ' + (nextLifeIn() != null ? 'The next one comes in ' + fmtClock(nextLifeIn()) + '.' : '') + '</div><button class="btn primary block lg" id="lvShop">Get hearts</button>'
        : '<button class="btn primary block lg" id="lvPlay">Play ' + HEART_SVG + '</button><p class="foot" style="text-align:center">You have ' + W.lives + (W.lives === 1 ? ' heart' : ' hearts') + '. Win and you keep it.</p>'), 'level-sheet');
    if ($('lvShop')) $('lvShop').onclick = function () { openShop(); };
    if ($('lvRetry')) $('lvRetry').onclick = function () { closeSheet(); loadWallet().then(function () { if (W) openLevel(L); else toast('Still can’t reach the server.'); }); };
    if ($('lvPlay')) $('lvPlay').onclick = function () {
      var btn = this; btn.disabled = true; ac();
      rewards('climbStart', { level: L }).then(function (j) { closeSheet(); startClimb(d, j.run.id); })
        .catch(function (e) {
          btn.disabled = false;
          if (e.code === 'no_lives') openShop(e.message);
          else toast(e.status ? e.message : 'Can’t reach the server. Check your connection.');
        });
    };
  }

  // ---------- playing a level ----------
  function startClimb(d, runId) {
    abortGame(); token++;
    var name = ME ? ME.name : ((S.names[0] || '').trim() || 'You');
    G = { kind: 'climb', token: token, mode: 'solo', lv: d, run: runId, n: d.kind === 'target' ? 400 : d.n, names: [name], limit: d.limit, extra: 0, cont: 0,
      allow: d.allow || 0, mistakes: 0, cfg: { ops: d.ops, level: d.level }, qs: climbQuestions(d), p: [newP()], ui: [], live: true };
    var play = $('play'); play.innerHTML = '';
    var half = d.kind === 'truth' ? truthHalf() : makeHalf(0, false, true);
    half.classList.add('climbing');
    var top = document.createElement('div'); top.className = 'solo-top lv';
    var q = document.createElement('button'); q.className = 'chipbtn'; q.textContent = 'Stop';
    q.onclick = function () { if (!G || G.kind !== 'climb' || G.ending) return; if (!window.confirm('Stop this level? You’ll lose the heart.')) return; if (!G || G.ending) return; climbLose(); };
    G.stopBtn = q;
    var tag = document.createElement('span'); tag.className = 'lv-opp lv-tag'; tag.innerHTML = '<b>Level ' + d.L + '</b> · ' + esc(KIND[d.kind].title);
    top.appendChild(q); top.appendChild(tag); half.appendChild(top);
    if (d.kind !== 'truth') { var kh = document.createElement('div'); kh.className = 'keyhint'; kh.textContent = 'TYPE ANSWERS · ⌫ DELETE · ESC CLEAR'; half.appendChild(kh); }
    var ov = document.createElement('div'); ov.className = 'cover offer hidden'; half.appendChild(ov); G.offer = ov;
    play.appendChild(half);
    G.ui[0].clock.textContent = String(d.limit);
    showScreen('play'); wakeOn(); countdown([0]);
  }
  function truthHalf() {
    var el = document.createElement('section');
    el.className = 'half solo truth'; paintPlayer(el, 0);
    el.innerHTML = '<div class="hud"><span class="nm"></span><span class="t-hearts"></span><span class="clock">0</span></div><div class="bar"><i></i></div>' +
      '<div class="tol-stage"><div class="tol-eq">…</div><div class="tol-flash"></div></div>' +
      '<div class="tol-btns"><button class="t" data-a="1">TRUE</button><button class="f" data-a="0">LIE</button></div>' +
      '<div class="keyhint">A or ← = TRUE · S or → = LIE</div><div class="cover"><div class="big"></div><div class="sub"></div></div>';
    el.querySelector('.nm').textContent = G.names[0];
    el.querySelector('.tol-btns').addEventListener('pointerdown', function (e) {
      var b = e.target.closest('button'); if (!b) return; e.preventDefault(); hit(b); truthAnswer(b.dataset.a === '1');
    });
    G.ui[0] = { el: el, q: el.querySelector('.tol-eq'), eq: el.querySelector('.tol-eq'), flash: el.querySelector('.tol-flash'), clock: el.querySelector('.clock'),
      prog: el.querySelector('.t-hearts'), bar: el.querySelector('.bar i'), streak: el.querySelector('.tol-flash'), cover: el.querySelector('.cover'),
      big: el.querySelector('.cover .big'), sub: el.querySelector('.cover .sub') };
    return el;
  }
  function truthPaint() {
    var p = G.p[0], u = G.ui[0], d = G.lv, done = p.idx + G.mistakes;
    var q = G.qs[Math.min(done, G.qs.length - 1)];
    if (!G.lock) u.eq.textContent = q.text;
    var left = G.allow - G.mistakes, h = '';
    for (var i = 0; i < G.allow; i++) h += '<i class="' + (i < left ? 'on' : '') + '">' + HEART_SVG + '</i>';
    u.prog.innerHTML = '<span class="hearts sm" title="Mistakes left">' + h + '</span>';
    u.bar.style.width = (done / d.n * 100) + '%';
  }
  function truthAnswer(said) {
    if (!G || G.kind !== 'climb' || G.lv.kind !== 'truth' || G.lock) return;
    var p = G.p[0]; if (!p.running) return;
    var done = p.idx + G.mistakes, q = G.qs[done], my = G.token, u = G.ui[0];
    G.lock = true;
    if (said === q.truth) {
      p.idx++; p.streak++; if (p.streak > p.bestStreak) p.bestStreak = p.streak;
      sfx.good(); u.flash.textContent = 'Right! It was ' + (q.truth ? 'true.' : 'a lie.'); u.flash.className = 'tol-flash ok';
    } else {
      G.mistakes++; p.streak = 0; p.wrong++;
      sfx.bad(); buzz(70);
      var el = u.el; el.classList.remove('wrong'); void el.offsetWidth; el.classList.add('wrong'); setTimeout(function () { el.classList.remove('wrong'); }, 350);
      u.flash.textContent = 'Oops! It was ' + (q.truth ? 'true.' : 'a lie.'); u.flash.className = 'tol-flash no';
    }
    truthPaint();
    setTimeout(function () {
      if (!G || G.token !== my) return;
      G.lock = false; u.flash.textContent = ''; u.flash.className = 'tol-flash';
      if (G.mistakes > G.allow) { p.running = false; G.pausedAt = performance.now(); climbOffer('mistakes'); return; }
      if (p.idx + G.mistakes >= G.lv.n) { p.end = performance.now(); p.running = false; p.done = true; climbWin(); return; }
      truthPaint();
    }, said === q.truth ? 550 : 1100);
  }
  function climbLeft() {
    var p = G.p[0], lim = G.limit + G.extra;
    if (G.lv.kind === 'target' || G.lv.kind === 'truth') return lim - (performance.now() - p.start) / 1000;
    return lim - elapsed(p);
  }
  // Called every frame by loop() while a Climb level runs.
  function climbFrame(pi) {
    var p = G.p[pi], u = G.ui[pi], left = climbLeft(), d = G.lv;
    u.clock.textContent = Math.max(0, left).toFixed(1);
    u.clock.classList.toggle('low', left < 5);
    if (d.kind === 'target') u.bar.style.width = Math.min(100, p.idx / (d.goal + 6) * 100) + '%';
    if (d.kind === 'truth' && G.lock) return;       // an answer is being shown: it settles first (win, offer or next)
    if (left <= 0) {
      p.running = false; G.pausedAt = performance.now();
      if (d.kind === 'target' && p.idx >= d.goal) { p.end = performance.now(); p.done = true; climbWin(); return; }
      sfx.bad(); buzz(80); climbOffer('time');
    }
  }
  function climbOffer(why) {
    var ov = G.offer, p = G.p[0], d = G.lv, can = G.cont < ECON.MAX_CONTINUES, rich = W && W.coins >= ECON.CONTINUE_COST;
    var left = d.n - p.idx - (d.kind === 'truth' ? G.mistakes : 0);
    var togo = d.kind === 'target' ? (d.goal - p.idx) + ' more to reach the target' : left > 0 ? left + ' to go' : 'that was the last one';
    ov.innerHTML = '<div class="offer-card"><div class="big">' + (why === 'time' ? 'Time’s up!' : 'Too many mistakes!') + '</div>' +
      '<p class="sub">So close: ' + esc(togo) + '.</p>' +
      (can ? '<button class="btn primary block lg" id="ofKeep"' + (rich ? '' : ' disabled') + '>' + '<span>' + (why === 'time' ? 'Keep going: +' + (d.kind === 'target' ? 15 : 20) + ' seconds' : 'Keep going: one more mistake') + '</span><span class="cost">' + COIN_SVG + ECON.CONTINUE_COST + '</span></button>' +
        (rich ? '' : '<p class="hint">You need ' + ECON.CONTINUE_COST + ' coins. You have ' + fmtN(W ? W.coins : 0) + '.</p>') : '<p class="hint">No more extra goes on this level.</p>') +
      '<button class="btn block" id="ofStop">Stop here</button><p class="hint">Keep going and you can still clear the level (with 1 star).</p></div>';
    ov.classList.remove('hidden');
    var my = G.token;
    if ($('ofKeep')) $('ofKeep').onclick = function () {
      var btn = this; btn.disabled = true;
      rewards('climbContinue', { id: G.run }).then(function () {
        if (!G || G.token !== my) return;
        G.cont++;
        if (why === 'time') G.extra += d.kind === 'target' ? 15 : 20; else G.allow++;
        var now = performance.now(); p.start += now - G.pausedAt; p.last += now - G.pausedAt;
        ov.classList.add('hidden');
        if (d.kind === 'truth' && p.idx + G.mistakes >= d.n) { p.end = now; p.done = true; climbWin(); return; }
        p.running = true; sfx.go();
        if (d.kind === 'truth') truthPaint(); else paintQ(0);
        loop();
      }).catch(function (e) { btn.disabled = false; toast(e.status ? e.message : 'Can’t reach the server. Try again.'); });
    };
    $('ofStop').onclick = function () { climbLose(); };
  }
  function climbStars() {
    var d = G.lv, p = G.p[0];
    if (G.cont) return 1;
    if (d.kind === 'target') return p.idx >= d.goal + 6 ? 3 : p.idx >= d.goal + 3 ? 2 : 1;
    if (d.kind === 'truth') return G.mistakes === 0 ? 3 : G.mistakes === 1 ? 2 : 1;
    var frac = Math.max(0, (G.limit - elapsed(p))) / G.limit;
    return frac >= 0.4 ? 3 : frac >= 0.2 ? 2 : 1;
  }
  function climbWin() {
    if (G.ending) return;
    var g = G, stars = climbStars(), my = G.token; G.ending = true; G.live = false; wakeOff();
    if (G.stopBtn) G.stopBtn.disabled = true;
    var u = G.ui[0]; u.cover.classList.remove('hidden'); u.big.innerHTML = starsHtml(stars, 'cover-stars'); u.sub.textContent = 'Level ' + g.lv.L + ' clear!';
    sfx.done();
    var send = function () {
      rewards('climbFinish', { id: g.run, level: g.lv.L, won: true, stars: stars }).then(function (j) {
        if (G && G.token === my) climbResults(g, true, j);
      }).catch(function (e) {
        if (!G || G.token !== my) return;
        u.sub.innerHTML = 'Couldn’t save that. <button class="btn" id="cwRetry">Try again</button>';
        $('cwRetry').onclick = send; void e;
      });
    };
    setTimeout(send, 900);
  }
  function climbLose() {
    if (G.ending) return;
    var g = G, my = G.token; G.ending = true; G.live = false; wakeOff();
    if (G.stopBtn) G.stopBtn.disabled = true;
    if (G.p[0]) G.p[0].running = false;
    rewards('climbFinish', { id: g.run, level: g.lv.L, won: false }).catch(function () { return {}; })
      .then(function (j) { if (G && G.token === my) climbResults(g, false, j || {}); });
  }
  function climbResults(g, won, j) {
    var d = g.lv, el = $('resBody'), next = d.L + 1, html = '';
    html += '<p class="kicker"><b>LEVEL ' + d.L + '</b> ' + esc(d.areaName) + '</p>';
    if (won) {
      var st = j.stars || climbStars();
      html += '<div class="climb-win">' + starsHtml(st, 'big-stars') + '</div>';
      html += '<div class="verdict" style="text-align:center">' + (st === 3 ? 'Brilliant!' : st === 2 ? 'Great climbing!' : 'Level clear!') + '</div>';
      html += '<p class="margin" style="text-align:center">' + (j.prev && st > j.prev ? 'New best on this level.' : j.prev && st <= j.prev ? 'You’d already got ' + j.prev + (j.prev === 1 ? ' star' : ' stars') + ' here.' : 'Level ' + next + ' is open.') + '</p>';
      html += '<div class="gain-row"><div class="gain big">' + COIN_SVG + '<b>+' + (j.coins || 0) + '</b> coins</div><div class="gain big">' + HEART_SVG + 'heart kept</div></div>';
      if (j.chest) html += '<div class="chest-stage open win">' + chestSvg('big') + '<p><b>Treasure chest!</b> +' + ECON.CHEST.coins + ' coins and +' + ECON.CHEST.lives + ' hearts for finishing ' + esc(d.areaName) + '.</p></div>';
      html += '<div class="actions"><button class="btn primary lg" id="cNext">Next level</button><button class="btn" id="cAgain">Play again</button><button class="btn ghost" id="cTrail">The trail</button></div>';
    } else {
      html += '<div class="verdict" style="text-align:center">So close!</div>';
      html += '<p class="margin" style="text-align:center">That one cost a heart. You have ' + (W ? W.lives : 0) + (W && W.lives === 1 ? ' heart' : ' hearts') + ' left' + (nextLifeIn() != null ? '; the next free one comes in ' + fmtClock(nextLifeIn()) : '') + '.</p>';
      html += '<div class="actions"><button class="btn primary lg" id="cAgain">Try again ' + HEART_SVG + '</button><button class="btn" id="cShop">Get hearts</button><button class="btn ghost" id="cTrail">The trail</button></div>';
    }
    el.innerHTML = html;
    showScreen('results');
    if (won) { sfx.win(); confetti([cssVar('--sun'), cssVar('--p1'), cssVar('--p2'), cssVar('--win')]); }
    var play = function (L) {
      if (!W || W.lives < 1) { go('climb'); setTimeout(function () { openShop('You need a heart to play. Here’s how to get one.'); }, 50); return; }
      rewards('climbStart', { level: L }).then(function (r) { startClimb(climbDef(L), r.run.id); })
        .catch(function (e) { if (e.code === 'no_lives') { go('climb'); setTimeout(function () { openShop(e.message); }, 50); } else toast(e.status ? e.message : 'Can’t reach the server.'); });
    };
    if ($('cNext')) $('cNext').onclick = function () { ac(); play(next); };
    $('cAgain').onclick = function () { ac(); play(d.L); };
    if ($('cShop')) $('cShop').onclick = function () { abortGame(); go('climb'); setTimeout(function () { openShop(); }, 50); };
    $('cTrail').onclick = function () { abortGame(); go('climb'); };
  }

  // =====================================================================
  // v2.8 Daily VS: one 15-question set a day, the same for everyone. Pick a rival (anyone who has
  // already raced today, or one of three sea bots) and race their ghost: their progress moves along
  // the top of your screen at the pace they really went. Your first run of the day counts: it pays a
  // prize either way and becomes your ghost for everyone else. Rematches are for fun.
  // =====================================================================
  var VSN = 15, VS_OPS = ['+', '−', '×', '÷'];
  var VS_BOTS = [
    { id: 'wobble', name: 'Wobble the Jellyfish', pace: 5.2, wrong: 2, hint: 'Gentle' },
    { id: 'crab', name: 'Captain Crab', pace: 3.4, wrong: 1, hint: 'Speedy' },
    { id: 'shark', name: 'Sid the Shark', pace: 2.1, wrong: 0, hint: 'Super fast' }
  ];
  function botRun(bot, day) {
    var r = rng(hashStr('vsbot-' + bot.id + '-' + day)), splits = [];
    for (var i = 0; i < VSN; i++) splits.push(Math.round(bot.pace * (0.65 + r() * 0.7) * 100) / 100);
    var raw = Math.round(splits.reduce(function (a, s) { return a + s; }, 0) * 1000) / 1000;
    return { splits: splits, raw: raw, wrong: bot.wrong, time: Math.round((raw + bot.wrong * 3) * 1000) / 1000 };
  }
  var BOT_ART = {
    wobble: '<svg viewBox="0 0 60 60" aria-hidden="true"><path class="il-p1" d="M8 32a22 22 0 0 1 44 0z"/><path class="il-line" style="stroke-width:3px;stroke:var(--p1)" d="M14 34q-3 8 2 14M24 34q-3 10 2 18M36 34q3 10-2 18M46 34q3 8-2 14"/><circle class="il-w" cx="23" cy="24" r="4.5"/><circle class="il-w" cx="37" cy="24" r="4.5"/><circle class="il-ink" cx="24" cy="24.5" r="2.2"/><circle class="il-ink" cx="38" cy="24.5" r="2.2"/><circle class="il-blush" cx="17" cy="29" r="2.6"/><circle class="il-blush" cx="43" cy="29" r="2.6"/></svg>',
    crab: '<svg viewBox="0 0 60 60" aria-hidden="true"><path class="il-p2" d="M10 26l-6-10 3-4 5 5 1-7 5 3-2 9zM50 26l6-10-3-4-5 5-1-7-5 3 2 9z"/><ellipse class="il-p2" cx="30" cy="36" rx="18" ry="13"/><circle class="il-w" cx="24" cy="24" r="5"/><circle class="il-w" cx="36" cy="24" r="5"/><circle class="il-ink" cx="25" cy="24.5" r="2.4"/><circle class="il-ink" cx="37" cy="24.5" r="2.4"/><path class="il-ink" d="M18 18h24l-3-7H21z"/><rect class="il-sun" x="18" y="16" width="24" height="3"/><path class="il-line" style="stroke-width:2px" d="M26 40q4 3 8 0"/></svg>',
    shark: '<svg viewBox="0 0 60 60" aria-hidden="true"><path class="il-rock" d="M4 36q14-20 38-16l8-10 2 12q6 4 6 10-10 10-30 10-14 0-24-6z"/><path class="il-w" d="M18 40q12 4 30-2-14 10-30 2z"/><circle class="il-ink" cx="44" cy="30" r="2.6"/><path class="il-w" d="M36 38l2 3 2-3 2 3 2-3z"/></svg>'
  };
  function vsMineLocal(day) { var m = store.get('sd_vs_local', null); return m && m.day === day ? m : null; }
  function renderVs() {
    var el = $('v-vs'), day = utcDay();
    el.innerHTML = '<p class="kicker"><b>2.7</b> Daily\u00A0VS</p><h2 class="title">Daily\u00A0VS</h2>' +
      '<p class="lede">Fifteen sums, the same for everyone today. Pick a rival and race their ghost: you’ll see them moving along the top of your screen at the speed they really went.</p><div id="vsBody"><div class="skel"></div></div>';
    var bots = function () { return VS_BOTS.map(function (b) { var r = botRun(b, day); return { id: b.id, name: b.name, time: r.time, raw: r.raw, wrong: r.wrong, splits: r.splits }; }); };
    api('/api/rewards?vs=1&d=' + day).then(function (j) { paintVs(j); })
      .catch(function () { paintVs({ day: day, ghosts: [], mine: null, bots: bots(), offline: true }); });
  }
  function paintVs(j) {
    var body = $('vsBody'); if (!body) return;
    var day = j.day, mine = j.mine || (!ME ? vsMineLocal(day) : null), html = '';
    if (mine) html += '<div class="savebar ok vs-mine"><span class="dot"></span><span>Your run today: <b>' + Number(mine.time).toFixed(2) + ' s</b>' + (mine.wrong ? ' (' + mine.wrong + ' wrong)' : '') + '. Rematches are just for fun: win one for ' + ECON.VS_REMATCH_WIN.coins + ' coins.</span></div>';
    else html += '<div class="vs-prize">' + chestSvg('sm') + '<div><b>Your first race today counts.</b><span>Win: ' + prizeText(ECON.VS_FIRST_WIN) + '. Lose: still ' + prizeText(ECON.VS_FIRST_LOSS) + '.</span></div></div>';
    var card = function (r, type, extra) {
      var art = type === 'bot' ? '<span class="vs-art">' + BOT_ART[r.id] + '</span>' : avatar(r.name, 52);
      return '<div class="vs-card" data-type="' + type + '" data-id="' + esc(r.id) + '">' + art +
        '<div class="vs-who"><b>' + esc(r.name) + '</b><small>' + Number(r.time).toFixed(2) + ' s' + (r.wrong ? ' · ' + r.wrong + ' wrong' : ' · no mistakes') + (extra ? ' · ' + extra : '') + '</small></div>' +
        '<button class="btn primary" data-race>Race</button></div>';
    };
    html += '<div class="section" style="margin-top:22px"><p class="kicker">Players Today</p>';
    html += j.ghosts.length ? '<div class="vs-list">' + j.ghosts.map(function (g) { return card(g, 'player'); }).join('') + '</div>'
      : '<div class="blank">' + (j.offline ? 'Can’t see today’s players right now. You can still race the sea bots.' : 'Nobody’s raced today yet. Your run becomes the first ghost for everyone else to chase.') + '</div>';
    html += '</div><div class="section"><p class="kicker">Sea Bots</p><div class="vs-list">' + j.bots.map(function (b) {
      var meta = VS_BOTS.filter(function (x) { return x.id === b.id; })[0]; return card(b, 'bot', meta ? meta.hint : '');
    }).join('') + '</div></div>';
    if (!ME) html += '<p class="foot">Sign in and your first run each day becomes a ghost that other players can race.</p>';
    body.innerHTML = html;
    body.onclick = function (e) {
      var b = e.target.closest('[data-race]'); if (!b) return;
      var c = b.closest('.vs-card'), type = c.dataset.type, id = c.dataset.id;
      var r = (type === 'bot' ? j.bots : j.ghosts).filter(function (x) { return String(x.id) === id; })[0]; if (!r) return;
      ac(); startVs({ type: type, id: r.id, name: r.name, time: Number(r.time), raw: Number(r.raw), wrong: r.wrong, splits: r.splits || [], day: j.day });
    };
  }
  function startVs(rv) {
    abortGame(); token++;
    var day = rv.day || utcDay(), name = ME ? ME.name : ((S.names[0] || '').trim() || 'You');
    var cum = [], t = 0, sp = rv.splits && rv.splits.length >= VSN ? rv.splits : null;
    for (var i = 0; i < VSN; i++) { t += sp ? sp[i] : rv.raw / VSN; cum.push(t); }
    G = { kind: 'vs', token: token, mode: 'solo', n: VSN, names: [name], day: day, rival: rv, cum: cum, cfg: { ops: VS_OPS.slice(), level: 'medium', n: VSN },
      qs: makeQuestions(VSN, VS_OPS, 'medium', hashStr('sumduel-vs-' + day)), p: [newP()], ui: [], live: true };
    var play = $('play'); play.innerHTML = '';
    var half = makeHalf(0, false, true);
    var top = document.createElement('div'); top.className = 'solo-top lv';
    var q = document.createElement('button'); q.className = 'chipbtn'; q.textContent = 'Quit';
    q.onclick = function () { abortGame(); go('vs'); };
    var strip = document.createElement('div'); strip.className = 'lv-opp ghost'; strip.style.setProperty('--oc', COL[1].c);
    strip.innerHTML = '<span class="nm">' + esc(rv.name) + '</span><span class="lv-bar"><i></i></span><span class="lv-st">0 / ' + VSN + '</span>';
    top.appendChild(q); top.appendChild(strip); half.appendChild(top);
    var kh = document.createElement('div'); kh.className = 'keyhint'; kh.textContent = 'TYPE ANSWERS · ⌫ DELETE · ESC CLEAR'; half.appendChild(kh);
    G.strip = strip;
    play.appendChild(half); showScreen('play'); wakeOn(); countdown([0]);
  }
  // The ghost moves on raw time (its wrong-answer penalties are added at the end, like yours).
  function vsFrame() {
    var p = G.p[0]; if (!G.strip) return;
    var t = (performance.now() - p.start) / 1000, k = 0;
    while (k < VSN && G.cum[k] <= t) k++;
    if (k === G.lastGhost) return; G.lastGhost = k;
    G.strip.querySelector('.lv-bar i').style.width = (k / VSN * 100) + '%';
    G.strip.querySelector('.lv-st').textContent = k >= VSN ? 'done ✓' : k + ' / ' + VSN;
    if (k >= VSN) G.strip.classList.add('done');
  }
  function vsResults() {
    var g = G, p = G.p[0], rv = G.rival, my = G.token; G.live = false; wakeOff();
    var raw = +((p.end - p.start) / 1000).toFixed(3), time = +(raw + p.wrong * PENALTY).toFixed(3);
    var w = Math.abs(time - rv.time) < 0.005 ? -1 : time < rv.time ? 0 : 1;
    var b = { game: 'duel', mode: 'ghost', day: g.day, cfg: g.cfg, winner: w,
      players: [{ name: g.names[0], time: time, raw: raw, wrong: p.wrong, splits: p.splits, bestStreak: p.bestStreak, wrongBy: p.wrongBy },
        { name: rv.name, time: rv.time, raw: rv.raw, wrong: rv.wrong, splits: (rv.splits || []).slice(0, VSN), bestStreak: 0, wrongBy: {} }] };
    renderResults(b, null);
    var kick = document.querySelector('#resBody .kicker b'); if (kick) kick.textContent = 'DAILY\u00A0VS';
    var slot = document.createElement('div'); slot.className = 'vs-res'; slot.innerHTML = '<div class="blank">Checking your prize…</div>';
    var verdict = document.querySelector('#resBody .series'); if (verdict) verdict.parentNode.insertBefore(slot, verdict.nextSibling);
    rewards('vsFinish', { d: g.day, raw: raw, wrong: p.wrong, splits: p.splits, rival: { type: rv.type, id: rv.id }, rivalTime: rv.time, rivalName: rv.name })
      .then(function (j) {
        if (j.first) store.set('sd_vs_day', g.day);
        if (!G || G.token !== my) return;
        var pz = j.prize || { coins: 0 };
        slot.innerHTML = pz.coins ? '<div class="vs-prize won">' + chestSvg('sm open') + '<div><b>' + (j.first ? 'Daily\u00A0VS prize' : 'Rematch prize') + ': ' + prizeText(pz) + '</b><span>' +
          (j.first ? (j.won ? 'You won your first race of the day!' : 'Your first race of the day still pays.') + (ME ? ' Your run is now a ghost for everyone else.' : '') : 'Nice rematch win.') + '</span></div></div>'
          : '<div class="savebar"><span>Rematches are for fun. Win one for ' + ECON.VS_REMATCH_WIN.coins + ' coins.</span></div>';
      }).catch(function (e) { slot.innerHTML = '<div class="savebar"><span>' + esc(e.status ? e.message : 'Couldn’t reach the server, so no prize this time.') + '</span></div>'; });
    $('again').textContent = 'Race again';
    $('again').onclick = function () { startVs(rv); };
    $('toArena').textContent = 'Daily\u00A0VS';
    $('toArena').onclick = function () { abortGame(); go('vs'); };
  }

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
    if (isH2H(b)) {
      var w = b.winner, vsSprint = b.game === 'sprint';
      html += '<p class="kicker"><b>' + (b.game === 'duel' ? 'DUEL' : b.game === 'tol' ? 'TRUTH OR LIE' : 'SPRINT') + '</b> Final Result</p>';
      html += '<div class="verdict" style="color:' + (w < 0 ? 'var(--ink)' : COL[w].c) + ';text-shadow:0 0 30px ' + (w < 0 ? 'none' : COL[w].g) + '">' + (w < 0 ? (b.game === 'duel' ? 'Dead <em>heat.</em>' : 'A <em>draw.</em>') : esc(P[w].name) + ' <em>wins.</em>') + '</div>';
      if (b.game === 'duel') html += '<p class="margin">' + (w < 0 ? 'Level to the hundredth of a second. Remarkable, or suspicious.' : 'By ' + Math.abs(P[0].time - P[1].time).toFixed(2) + ' seconds.') + '</p>';
      else if (w < 0) html += '<p class="margin">Level at ' + P[0].score + '–' + P[1].score + (vsSprint ? ' correct' : '') + '.</p>';
      else html += '<p class="margin">' + P[w].score + '–' + P[1 - w].score + (vsSprint ? ' correct answers.' : '.') + '</p>';
      if (ser && (ser[0] + ser[1] + ser[2]) > 1) html += '<p class="series">Series · ' + esc(P[0].name) + ' ' + ser[0] + ' – ' + ser[1] + ' ' + esc(P[1].name) + (ser[2] ? ' · ' + ser[2] + ' drawn' : '') + '</p>';
      else html += '<p class="series">&nbsp;</p>';
      html += '<div class="cards">' + [0, 1].map(function (i) {
        var p = P[i], lose = w >= 0 && w !== i;
        var style = 'style="--pc:' + COL[i].c + ';--pd:' + COL[i].d + ';--pg:' + COL[i].g + '"';
        if (b.game === 'duel') return '<div class="card' + (lose ? ' lose' : '') + '" ' + style + '><div class="whoc">' + esc(p.name) + '</div><div class="t">' + (p.dnf ? 'DNF' : p.time.toFixed(2) + ' s') + '</div><dl>' +
          '<dt>Raw time</dt><dd>' + p.raw.toFixed(2) + ' s</dd><dt>Wrong</dt><dd>' + p.wrong + (p.wrong ? ' · +' + p.wrong * PENALTY + 's' : '') + '</dd><dt>Per Q</dt><dd>' + (p.time / b.cfg.n).toFixed(2) + ' s</dd><dt>Streak</dt><dd>' + (p.bestStreak || 0) + '</dd></dl></div>';
        if (vsSprint) return '<div class="card' + (lose ? ' lose' : '') + '" ' + style + '><div class="whoc">' + esc(p.name) + '</div><div class="t">' + p.score + ' correct</div><dl>' +
          '<dt>Wrong</dt><dd>' + p.wrong + '</dd><dt>Accuracy</dt><dd>' + (p.score + p.wrong ? Math.round(p.score / (p.score + p.wrong) * 100) : 0) + '%</dd><dt>Best streak</dt><dd>' + (p.bestStreak || 0) + '</dd></dl></div>';
        return '<div class="card' + (lose ? ' lose' : '') + '" ' + style + '><div class="whoc">' + esc(p.name) + '</div><div class="t">' + p.score + ' pts</div><dl>' +
          '<dt>Wrong calls</dt><dd>' + p.wrong + '</dd><dt>Reaction</dt><dd>' + (p.avgRt == null ? '–' : p.avgRt.toFixed(2) + ' s') + '</dd></dl></div>';
      }).join('') + '</div>';
      if (b.game === 'duel') html += exhibitSplits(P, 'Figure 1: seconds per question, penalties excluded');
      if (vsSprint) html += exhibitSplits(P, 'Figure 1: seconds per correct answer');
      winColor = w < 0 ? null : (w === 0 ? cssVar('--p1') : cssVar('--p2'));
    } else if (b.game === 'sprint') {
      var p0 = P[0], best = computeStats(localBattles()).bestSprint, pb = best == null || p0.score > best;
      html += '<p class="kicker"><b>SPRINT</b> 60 Seconds</p>';
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
    html += payBattle(b);
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
    if (ME && b.game === 'sprint' && b.mode !== 'live' && P[0].score > 0) api('/api/board', { b: 'sprint', score: P[0].score }).catch(function () {});
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
    else if (b.game === 'tol') txt = b.winner < 0 ? 'Truth or Lie ended level ' + P[0].score + '–' + P[1].score + ' on Sum Duel'
      : P[b.winner].name + ' won Truth or Lie ' + P[b.winner].score + '–' + P[1 - b.winner].score + ' on Sum Duel';
    else if (b.game === 'sprint' && P.length > 1) txt = b.winner < 0 ? 'A Sprint tie on Sum Duel: ' + P[0].score + ' each.'
      : P[b.winner].name + ' won a live Sprint ' + P[b.winner].score + '–' + P[1 - b.winner].score + ' on Sum Duel';
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
  // Head to head: duels, Truth or Lie, Daily VS ghost races, and live games of every kind (incl. Sprint).
  function isH2H(b) { return b.game === 'duel' || b.game === 'tol' || (b.game === 'sprint' && (b.players || []).length > 1); }
  function recKind(b) { return b.mode === 'live' ? 'live' : b.mode === 'ghost' ? 'vs' : b.game; }
  function computeStats(list) {
    var st = { total: list.length, duels: 0, w: 0, l: 0, d: 0, bestSprint: null, bestDaily: null, streak: 0, bestStreak: 0, rivals: [], byGame: { duel: 0, tol: 0, sprint: 0, daily: 0, live: 0, vs: 0 }, sprintSeries: [] };
    var riv = {}, run = 0, streakOpen = true;
    list.forEach(function (b) { // newest first
      var rk = recKind(b); st.byGame[rk] = (st.byGame[rk] || 0) + 1;
      if (isH2H(b)) {
        st.duels++;
        var res = b.winner === 0 ? 'W' : b.winner === 1 ? 'L' : 'D';
        if (res === 'W') st.w++; else if (res === 'L') st.l++; else st.d++;
        if (streakOpen) { if (res === 'W') st.streak++; else streakOpen = false; }
        var name = (b.players[1] && b.players[1].name) || 'Player 2', key = name.toLowerCase();
        var r = riv[key] || (riv[key] = { name: name, n: 0, w: 0, l: 0, d: 0, last: b.at });
        r.n++; r[res.toLowerCase()]++;
      }
      if (b.game === 'sprint' && b.mode !== 'live') { var sc = b.players[0].score; if (st.bestSprint == null || sc > st.bestSprint) st.bestSprint = sc; st.sprintSeries.push(sc); }
      if (b.game === 'daily' && !b.practice) { var tm = b.players[0].time; if (st.bestDaily == null || tm < st.bestDaily) st.bestDaily = tm; }
    });
    // best streak needs chronological pass
    list.slice().reverse().forEach(function (b) {
      if (!isH2H(b)) return;
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
      var html = '<p class="kicker"><b>3</b> ' + (ME ? esc(ME.name) + '’s Record' : 'Your Record · This Device') + '</p><h2 class="title">Every Battle, on the Record</h2>';
      if (!ME) html += '<div class="savebar"><span>You’re not signed in, so this record only lives in this browser.</span><a class="btn" href="#/account" style="padding:8px 12px">Sign in</a></div>';
      if (!list.length) { el.innerHTML = html + '<div class="blank">No battles yet. <a href="#/">Go and pick a fight.</a></div>'; return; }
      html += '<div class="section" style="margin-top:18px">' + kpiRow(st) + '</div>';
      html += '<div class="grid2">';
      // Head to head
      html += '<div class="panel"><p class="kicker"><b>3.1</b> Head to Head</p>';
      if (st.rivals.length) {
        html += '<table class="tbl"><thead><tr><th>Rival</th><th class="n">P</th><th class="n">W–L</th><th></th></tr></thead><tbody>' +
          st.rivals.slice(0, 12).map(function (r) {
            var wp = r.n ? r.w / r.n * 100 : 0, lp = r.n ? r.l / r.n * 100 : 0;
            return '<tr><td>' + esc(r.name) + '</td><td class="n">' + r.n + '</td><td class="n">' + r.w + '–' + r.l + (r.d ? '–' + r.d : '') + '</td><td><span class="wl"><i style="width:' + wp + '%;background:var(--p1)"></i><i style="width:' + lp + '%;background:var(--p2)"></i></span></td></tr>';
          }).join('') + '</tbody></table>';
      } else html += '<p class="hint">Play a Duel, a Live game or the Daily\u00A0VS to start a rivalry.</p>';
      html += '</div>';
      // Sprint trend
      html += '<div class="panel spark"><p class="kicker"><b>3.2</b> Sprint Trend</p>' + sparkline(st.sprintSeries) +
        '<p class="hint">' + (st.sprintSeries.length ? st.sprintSeries.length + (st.sprintSeries.length === 1 ? ' sprint' : ' sprints') + ' · best ' + st.bestSprint + (st.bestDaily != null ? ' · best Daily ' + st.bestDaily.toFixed(2) + ' s' : '') : 'No sprints yet.') + '</p></div>';
      html += '</div>';
      // History
      html += '<div class="section"><p class="kicker"><b>3.3</b> History</p><div class="filters" id="recF">' +
        [['all', 'All'], ['duel', 'Duels'], ['live', 'Live'], ['tol', 'Truth or Lie'], ['sprint', 'Sprint'], ['daily', 'Daily'], ['vs', 'Daily\u00A0VS']].filter(function (f) { return f[0] === 'all' || f[0] === 'duel' || st.byGame[f[0]]; }).map(function (f) { return '<button data-f="' + f[0] + '" aria-pressed="' + (recFilter === f[0]) + '">' + f[1] + (f[0] !== 'all' && st.byGame[f[0]] ? ' · ' + st.byGame[f[0]] : '') + '</button>'; }).join('') +
        '</div><div class="list">' + list.filter(function (b) { return recFilter === 'all' || recKind(b) === recFilter; }).slice(0, 200).map(itemHtml).join('') + '</div></div>';
      el.innerHTML = html;
      $('recF').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; recFilter = b.dataset.f; paint(list); };
    };
    paint(localBattles());
    if (ME) pullBattles().then(function (l) { if (!$('v-record').classList.contains('hidden')) paint(l); });
  }
  function itemHtml(b) {
    var P = b.players || [], badge, main, right;
    if (isH2H(b)) {
      var res = b.winner === 0 ? 'W' : b.winner === 1 ? 'L' : 'D';
      badge = '<span class="badge ' + res + '">' + res + ' · ' + (b.mode === 'ghost' ? 'VS' : b.game === 'duel' ? 'Duel' : b.game === 'tol' ? 'T/L' : 'Sprint') + '</span>';
      main = '<b>' + esc(P[0] && P[0].name) + ' vs ' + esc(P[1] && P[1].name) + '</b><small>' + fmtDate(b.at) + (b.mode === 'live' ? ' · live' : b.mode === 'ghost' ? ' · Daily\u00A0VS ' + esc(b.day || '') : '') + (b.cfg && b.mode !== 'ghost' ? ' · ' + esc((b.cfg.ops || []).join(' ')) + ' · ' + esc(b.cfg.level || '') : '') + (b.mode === 'turns' ? ' · turns' : '') + '</small>';
      var tm = function (p) { return p.dnf ? 'DNF' : Number(p.time).toFixed(2); };
      right = b.game === 'duel' ? (tm(P[0]) + ' / ' + tm(P[1])) : (P[0].score + '–' + P[1].score);
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
  // Live duel: two devices, server-timed, polled
  // =====================================================================
  var LV = { timer: null, offset: 0, rtt: 1e9, g: null, sending: false, again: false, finalSent: false };
  var LCFG = Object.assign({ game: 'duel', ops: ['+', '−', '×', '÷'], level: 'medium', n: 10, priv: false }, store.get('sd_live_cfg', {}));
  var GNAME = { duel: 'Duel', tol: 'Truth or Lie', sprint: 'Sprint' };
  var GHOW = {
    duel: 'Same questions, separate clocks. Fastest time wins; every wrong answer adds 3 seconds.',
    tol: 'The same sum pops up on both screens. Call it true or a lie: the quickest right call scores. First to 7 wins.',
    sprint: 'Sixty seconds, the same questions. Most right answers wins.'
  };
  function liveGame(c) { return (c && GNAME[c.game]) ? c.game : 'duel'; }
  function inLive(code) { return !!G && (G.kind === 'live' || G.kind === 'ltol') && (!code || G.code === code); }
  function serverNow() { return Date.now() + LV.offset; }
  function liveStop() { if (LV.timer) { clearTimeout(LV.timer); LV.timer = null; } }
  // Keep the clock offset from the lowest-latency sample: that's the most accurate one.
  function liveApi(path, body) {
    var t0 = Date.now();
    return api(path, body).then(function (j) {
      var t1 = Date.now();
      if (j && j.now && (t1 - t0) <= LV.rtt + 40) { LV.rtt = Math.min(LV.rtt, t1 - t0); LV.offset = new Date(j.now).getTime() - (t0 + t1) / 2; }
      return j;
    });
  }
  function cfgText(c) {
    var g = liveGame(c);
    return GNAME[g] + ' · ' + (c.ops || []).join(' ') + ' · ' + c.level + (g === 'duel' ? ' · ' + c.n + ' questions' : g === 'tol' ? ' · first to 7' : ' · 60 seconds');
  }
  function liveOther(r) { return r === 'host' ? 'guest' : 'host'; }
  function liveVisible(id) { return !$(id).classList.contains('hidden'); }

  function renderLive(code) {
    liveStop();
    var el = $('v-live');
    if (!ME) {
      el.innerHTML = '<p class="kicker"><b>2.5</b> Live Games</p><h2 class="title">Live Games</h2>' +
        '<p class="lede">Play a friend on their own device: a Duel, Truth or Lie, or a 60-second Sprint. You need an account so the game knows who’s who.</p><a class="btn primary" href="#/account">Sign in to play</a>';
      return;
    }
    if (code) return renderRoom(code);
    el.innerHTML = '<p class="kicker"><b>2.5</b> Live Games</p><h2 class="title">Live Games</h2>' +
      '<p class="lede">Two devices, one race. Pick a game, create it and share its code, or join an open game below. Private games need their password.</p>' +
      '<div id="lvActive"></div>' +
      '<div class="grid2">' +
        '<div class="panel"><p class="kicker"><b>A</b> Create a Game</p>' +
          '<div class="field"><span class="lab">Game</span><div class="lv-games" id="lvGame">' + ['duel', 'tol', 'sprint'].map(function (k) { return '<button type="button" data-v="' + k + '"><b>' + GNAME[k] + '</b></button>'; }).join('') + '</div><p class="hint" id="lvHow"></p></div>' +
          '<div class="field"><span class="lab">Name</span><input class="inp" id="lvName" maxlength="30" placeholder="' + esc(ME.name) + '’s game"></div>' +
          '<div class="field"><span class="lab">Operations</span><div class="ops" id="lvOps">' + ['+', '−', '×', '÷'].map(function (o) { return '<button type="button" data-v="' + o + '">' + o + '</button>'; }).join('') + '</div></div>' +
          '<div class="field"><span class="lab">Difficulty</span><div class="seg" id="lvLevel"><button data-v="easy">Easy</button><button data-v="medium">Medium</button><button data-v="hard">Hard</button></div></div>' +
          '<div class="field" id="lvNField"><span class="lab">Questions</span><div class="seg" id="lvN"><button data-v="5">5</button><button data-v="10">10</button><button data-v="15">15</button><button data-v="20">20</button></div></div>' +
          '<div class="setrow" style="border:0;padding-top:0"><div>Private game<small>Only people with the password can join</small></div><button class="toggle" id="lvPriv" aria-label="Private game"></button></div>' +
          '<input class="inp hidden" id="lvPw" maxlength="50" placeholder="Game password (3+ characters)" autocomplete="off">' +
          '<div class="err" id="lvErr" role="alert"></div><button class="btn primary block lg" id="lvCreateBtn">Create game</button></div>' +
        '<div><div class="panel"><p class="kicker"><b>B</b> Join With a Code</p>' +
          '<div class="row"><input class="inp" id="lvCode" maxlength="5" placeholder="ABCDE" style="flex:1;margin:0;min-width:0;text-transform:uppercase;font-family:var(--mono)" autocomplete="off"><button class="btn" id="lvCodeBtn">Join</button></div>' +
          '<input class="inp hidden" id="lvCodePw" maxlength="50" placeholder="Password (private games)" autocomplete="off" style="margin-top:10px">' +
          '<div class="err" id="lvCodeErr" role="alert"></div></div>' +
          '<div class="section" style="margin-top:22px"><p class="kicker"><b>C</b> Open Games</p><div class="list" id="lvList"><div class="blank">Looking for games…</div></div></div></div>' +
      '</div>';
    var paintCfg = function () {
      if (!GNAME[LCFG.game]) LCFG.game = 'duel';
      qsa('#lvGame button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === LCFG.game)); });
      $('lvHow').textContent = GHOW[LCFG.game]; $('lvNField').classList.toggle('hidden', LCFG.game !== 'duel');
      qsa('#lvOps button').forEach(function (b) { b.setAttribute('aria-pressed', String(LCFG.ops.indexOf(b.dataset.v) >= 0)); });
      qsa('#lvLevel button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === LCFG.level)); });
      qsa('#lvN button').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.dataset.v) === LCFG.n)); });
      $('lvPriv').setAttribute('aria-pressed', String(!!LCFG.priv)); $('lvPw').classList.toggle('hidden', !LCFG.priv);
      store.set('sd_live_cfg', { game: LCFG.game, ops: LCFG.ops, level: LCFG.level, n: LCFG.n, priv: LCFG.priv });
    };
    $('lvGame').onclick = function (e) { var b = e.target.closest('button'); if (b) { LCFG.game = b.dataset.v; paintCfg(); } };
    $('lvOps').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; var v = b.dataset.v;
      if (LCFG.ops.indexOf(v) >= 0) { if (LCFG.ops.length > 1) LCFG.ops = LCFG.ops.filter(function (o) { return o !== v; }); } else LCFG.ops = LCFG.ops.concat([v]); paintCfg(); };
    $('lvLevel').onclick = function (e) { var b = e.target.closest('button'); if (b) { LCFG.level = b.dataset.v; paintCfg(); } };
    $('lvN').onclick = function (e) { var b = e.target.closest('button'); if (b) { LCFG.n = Number(b.dataset.v); paintCfg(); } };
    $('lvPriv').onclick = function () { LCFG.priv = !LCFG.priv; paintCfg(); if (LCFG.priv) $('lvPw').focus(); };
    paintCfg();
    $('lvCreateBtn').onclick = function () {
      var btn = this; btn.disabled = true; $('lvErr').textContent = '';
      liveApi('/api/live', { action: 'create', name: $('lvName').value, cfg: { game: LCFG.game, ops: LCFG.ops, level: LCFG.level, n: LCFG.n }, private: !!LCFG.priv, password: $('lvPw').value })
        .then(function (j) { go('live/' + j.code); })
        .catch(function (e) { $('lvErr').textContent = e.message; btn.disabled = false; });
    };
    var joinCode = function (code, pw, errEl) {
      return liveApi('/api/live', { action: 'join', code: code, password: pw || '' }).then(function (j) { go('live/' + j.code); })
        .catch(function (e) { errEl.textContent = e.message; if (/password/i.test(e.message)) return 'pw'; });
    };
    $('lvCode').oninput = function () { this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
    $('lvCodeBtn').onclick = function () {
      var c = $('lvCode').value; if (c.length !== 5) { $('lvCodeErr').textContent = 'Codes are 5 characters.'; return; }
      joinCode(c, $('lvCodePw').value, $('lvCodeErr')).then(function (r) { if (r === 'pw') { $('lvCodePw').classList.remove('hidden'); $('lvCodePw').focus(); } });
    };
    $('lvList').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return; var it = b.closest('.item'), code = it.dataset.code;
      if (b.dataset.a === 'open') return go('live/' + code);
      var pwEl = it.querySelector('input');
      if (it.dataset.priv === '1' && !pwEl) {
        var box = document.createElement('div'); box.className = 'row'; box.style.gridColumn = '1/-1';
        box.innerHTML = '<input class="inp" maxlength="50" placeholder="Password" style="flex:1;margin:0;min-width:0" autocomplete="off"><button class="btn" data-a="join">Join</button><div class="err" style="width:100%"></div>';
        it.appendChild(box); box.querySelector('input').focus(); return;
      }
      joinCode(code, pwEl ? pwEl.value : '', it.querySelector('.err') || $('lvCodeErr'));
    };
    pollLobby();
  }
  function pollLobby() {
    liveStop();
    if (!liveVisible('v-live') || !$('lvList')) return;
    liveApi('/api/live?lobby=1').then(function (j) {
      if (!$('lvList')) return;
      $('lvActive').innerHTML = j.active ? '<div class="savebar ok" style="margin-bottom:18px"><span class="dot"></span><span>You’re in game <b class="mono">' + esc(j.active) + '</b>.</span><a class="btn" href="#/live/' + esc(j.active) + '">Back to the room</a></div>' : '';
      var open = document.activeElement && $('lvList').contains(document.activeElement);
      if (open) return; // don't wipe a password the player is typing
      $('lvList').innerHTML = j.games.length ? j.games.map(function (g) {
        return '<div class="item" data-code="' + esc(g.code) + '" data-priv="' + (g.private ? 1 : 0) + '"><span class="badge g-' + liveGame(g.cfg) + '">' + GNAME[liveGame(g.cfg)] + (g.private ? ' · private' : '') + '</span>' +
          '<div class="main"><b>' + esc(g.name) + '</b><small>' + esc(g.host) + ' · ' + esc(cfgText(g.cfg)) + ' · <span class="mono">' + esc(g.code) + '</span></small></div>' +
          (g.mine ? '<button class="btn" data-a="open">Your room</button>' : '<button class="btn primary" data-a="join">Join</button>') + '</div>';
      }).join('') : '<div class="blank">No open games right now. Create one and share the code.</div>';
    }).catch(function (e) { if (e.status === 401) { setMe(null); renderLive(); } })
      .then(function () { if (liveVisible('v-live') && $('lvList')) LV.timer = setTimeout(pollLobby, 3000); });
  }

  // ---------------- room ----------------
  function renderRoom(code) {
    var el = $('v-live');
    el.innerHTML = '<button class="back" id="lvBack">← Live lobby</button><p class="kicker"><b>2.5</b> Room <span class="mono" style="margin-left:.4em">' + esc(code) + '</span></p>' +
      '<h2 class="title" id="lvTitle">…</h2><p class="series" id="lvCfg">&nbsp;</p><div id="lvRoom"><div class="blank">Connecting…</div></div>';
    $('lvBack').onclick = function () {
      var g = LV.g;
      if (g && g.you && (g.status === 'open' || g.status === 'full')) liveApi('/api/live', { action: 'leave', code: code }).catch(function () {});
      go('live');
    };
    LV.g = null; pollRoom(code);
  }
  function pollRoom(code) {
    liveStop();
    var inGame = inLive(code);
    var onResults = inGame && liveVisible('results');
    if (!inGame && !liveVisible('v-live')) return;
    liveApi('/api/live?code=' + code).then(function (j) {
      var g = j.game; LV.g = g;
      if (inLive(code)) return liveTick(g);
      paintRoom(g);
      if (g.status === 'playing' && g.tol) liveTolStart(g);
      else if (g.status === 'playing' && g.questions) liveStartGame(g);
      else if (g.status === 'done' && g.result) liveResults(g);
    }).catch(function (e) {
      if (e.status === 401) { setMe(null); return renderLive(); }
      if (e.status === 404 || e.status === 400) { if ($('lvRoom')) $('lvRoom').innerHTML = '<div class="blank">No game with that code. <a href="#/live">Back to the lobby</a></div>'; LV.g = { status: 'gone' }; }
    }).then(function () {
      if (LV.g && LV.g.status === 'gone') return;
      var still = inLive(code) || ($('lvRoom') && liveVisible('v-live'));
      if (!still) return;
      var playing = LV.g && LV.g.status === 'playing', tol = LV.g && LV.g.cfg && LV.g.cfg.game === 'tol';
      LV.timer = setTimeout(function () { pollRoom(code); }, onResults ? 2500 : playing ? (tol ? 500 : 900) : 1300);
    });
  }
  function paintRoom(g) {
    var room = $('lvRoom'); if (!room) return;
    $('lvTitle').textContent = g.name; $('lvCfg').textContent = cfgText(g.cfg) + (g.private ? ' · private' : ' · public');
    if (g.status === 'cancelled' || g.status === 'abandoned') { room.innerHTML = '<div class="blank">This game was closed. <a href="#/live">Back to the lobby</a></div>'; return; }
    if (!g.you) {
      if (g.status === 'open' && $('lvJoin')) return; // keep the password the visitor is typing
      if (g.status !== 'open') { room.innerHTML = '<div class="blank">This game has already started or is full. <a href="#/live">Find another</a></div>'; return; }
      room.innerHTML = '<div class="panel" style="max-width:460px"><p style="margin-top:0">Hosted by <b>' + esc(g.host.name) + '</b>.</p>' +
        (g.private && !g.invited ? '<input class="inp" id="lvJoinPw" maxlength="50" placeholder="Password" autocomplete="off">' : '') +
        '<div class="err" id="lvJoinErr"></div><button class="btn primary block lg" id="lvJoin">Join game</button></div>';
      $('lvJoin').onclick = function () {
        liveApi('/api/live', { action: 'join', code: g.code, password: $('lvJoinPw') ? $('lvJoinPw').value : '' })
          .then(function () { pollRoom(g.code); }).catch(function (e) { $('lvJoinErr').textContent = e.message; });
      };
      return;
    }
    var me = g[g.you], opp = g[liveOther(g.you)];
    var card = function (s, i, label) {
      var st = 'style="--pc:' + COL[i].c + ';--pd:' + COL[i].d + ';--pg:' + COL[i].g + '"';
      if (!s) return '<div class="card" ' + st + '><div class="whoc">' + label + '</div><div class="t blink">waiting</div><dl><dt>Share the code</dt><dd class="mono">' + esc(g.code) + '</dd></dl></div>';
      return '<div class="card" ' + st + '><div class="whoc">' + label + (s.online ? '' : ' · offline') + '</div><div class="t">' + esc(s.name) + '</div><dl><dt>Status</dt><dd>' + (s.ready ? 'Ready ☒' : 'Not ready ☐') + '</dd></dl></div>';
    };
    // On every device: you are blue (P1), your opponent is pink (P2), matching the game and the results screen.
    var myLabel = g.you === 'host' ? 'You · host' : 'You · challenger', oppLabel = g.you === 'host' ? 'Challenger' : 'Host';
    var html = '<div class="cards">' + card(me, 0, myLabel) + card(opp, 1, oppLabel) + '</div>';
    if (g.status === 'playing') {
      var left = Math.max(0, Math.ceil((new Date(g.start_at).getTime() - serverNow()) / 1000));
      html += '<div class="verdict" style="text-align:center">' + (left > 0 ? left : 'Go!') + '</div>';
    } else if (g.status === 'open') {
      html += '<div class="savebar"><span>Waiting for someone to join. Share the code <b class="mono">' + esc(g.code) + '</b>' + (g.private ? ' and the password' : '') + '.</span><button class="btn" id="lvCopy">Copy link</button></div>';
    } else if (g.status === 'full') {
      html += '<p class="hint lv-how">' + esc(GHOW[liveGame(g.cfg)]) + '</p>';
      html += '<p class="lede" style="margin-bottom:14px">' + (me.ready && opp.ready ? 'Starting…' : me.ready ? 'Waiting for ' + esc(opp.name) + ' to get ready.' : 'Both players are here. Press ready when you are.') + '</p>' +
        '<button class="btn ' + (me.ready ? '' : 'primary ') + 'block lg" id="lvReady">' + (me.ready ? 'Not ready yet' : 'I’m ready') + '</button>';
    }
    if (g.status === 'open' || g.status === 'full') html += '<div class="row" style="margin-top:12px"><button class="btn ghost" id="lvLeave">Leave room</button></div>';
    room.innerHTML = html;
    if ($('lvCopy')) $('lvCopy').onclick = function () {
      var url = location.origin + '/#/live/' + g.code;
      (navigator.share ? navigator.share({ title: 'Sum Duel', text: 'Join my Sum Duel game: ' + g.code, url: url }) : navigator.clipboard.writeText(url).then(function () { toast('Link copied'); }))
        .catch(function () {});
    };
    if ($('lvReady')) $('lvReady').onclick = function () { ac(); liveApi('/api/live', { action: 'ready', code: g.code, ready: !me.ready }).then(function () { pollRoom(g.code); }).catch(function (e) { toast(e.message); }); };
    if ($('lvLeave')) $('lvLeave').onclick = function () { liveApi('/api/live', { action: 'leave', code: g.code }).catch(function () {}).then(function () { go('live'); }); };
  }

  // ---------------- in game ----------------
  function liveStartGame(g) {
    abortGame(); token++;
    var me = g[g.you], opp = g[liveOther(g.you)], ci = 0; // you are always P1 colours on your own device
    LV.finalSent = false; LV.finalPending = false; LV.sending = false; LV.again = false;
    var sprint = liveGame(g.cfg) === 'sprint';
    G = { kind: 'live', token: token, mode: 'solo', n: sprint ? g.questions.length : g.cfg.n, names: [me.name], cfg: g.cfg, qs: g.questions, p: [newP()], ui: [], live: true,
      code: g.code, id: g.id, role: g.you, oppName: opp.name, startAt: new Date(g.start_at).getTime(), started: false, sprint: sprint, limit: g.sprint || 60 };
    var p = G.p[0]; p.idx = me.idx || 0; p.wrong = me.wrong || 0;
    var play = $('play'); play.innerHTML = '';
    var half = makeHalf(0, false, true);
    paintPlayer(half, ci);
    var top = document.createElement('div'); top.className = 'solo-top lv';
    var q = document.createElement('button'); q.className = 'chipbtn'; q.textContent = 'Quit';
    q.onclick = function () {
      if (!window.confirm('Leave the game? That counts as a loss.')) return;
      var code = G.code; liveApi('/api/live', { action: 'leave', code: code }).catch(function () {});
      abortGame(); go('live');
    };
    var strip = document.createElement('div'); strip.className = 'lv-opp'; strip.style.setProperty('--oc', COL[1 - ci].c);
    strip.innerHTML = '<span class="nm">' + esc(opp.name) + '</span>' + (sprint ? '' : '<span class="lv-bar"><i></i></span>') + '<span class="lv-st">' + (sprint ? '0 correct' : '0 / ' + g.cfg.n) + '</span>';
    top.appendChild(q); top.appendChild(strip); half.appendChild(top);
    G.strip = strip;
    play.appendChild(half); showScreen('play'); wakeOn();
    if (sprint) G.ui[0].clock.textContent = String(G.limit);
    if (me.done) { p.done = true; var u = G.ui[0]; u.cover.classList.remove('hidden'); u.big.textContent = '✓'; u.sub.textContent = 'Finished · waiting for ' + opp.name; LV.finalSent = true; }
    else if (sprint && serverNow() > G.startAt + G.limit * 1000) { var u2 = G.ui[0]; p.done = true; u2.cover.classList.remove('hidden'); u2.big.textContent = p.idx; u2.sub.textContent = 'Time! Waiting for ' + opp.name + '…'; p.end = performance.now(); p.start = p.end - G.limit * 1000; liveReport(true); }
    else liveCountdown();
    liveTick(g);
  }
  function liveCountdown() {
    var my = G.token, lastShown = null;
    (function step() {
      if (!G || G.token !== my) return;
      var u = G.ui[0], left = G.startAt - serverNow();
      if (left > 0) {
        var shown = left > 3000 ? 'Ready' : String(Math.ceil(left / 1000));
        if (shown !== lastShown) { u.cover.classList.remove('hidden'); u.big.textContent = shown; u.sub.textContent = 'vs ' + G.oppName; if (shown !== 'Ready') sfx.tick(); lastShown = shown; }
        setTimeout(step, 50); return;
      }
      sfx.go();
      var p = G.p[0], now = performance.now();
      p.start = now + left; p.last = p.start; p.running = true; G.started = true; // left <= 0: count any lateness
      u.cover.classList.add('hidden'); paintQ(0); loop();
    })();
  }
  function liveTick(g) {
    if (G && G.kind === 'ltol') return liveTolTick(g);
    if (!G || G.kind !== 'live') return;
    var opp = g[liveOther(g.you)];
    if (G.strip && opp) {
      if (G.sprint) G.strip.querySelector('.lv-st').innerHTML = opp.idx + ' correct' + (opp.done ? ' ✓' : '');
      else {
        G.strip.querySelector('.lv-bar i').style.width = (opp.idx / g.cfg.n * 100) + '%';
        G.strip.querySelector('.lv-st').innerHTML = opp.done ? 'done ✓' : (opp.idx + ' / ' + g.cfg.n + (opp.wrong ? ' · ' + opp.wrong + ' wrong' : ''));
      }
      var claim = G.strip.querySelector('.lv-claim');
      if (g.opp_gone && !claim) {
        var b = document.createElement('button'); b.className = 'chipbtn lv-claim'; b.textContent = 'Opponent left · claim win';
        b.onclick = function () { liveApi('/api/live', { action: 'claim', code: g.code }).catch(function (e) { toast(e.message); }); };
        G.strip.appendChild(b);
      } else if (!g.opp_gone && claim) claim.remove();
    }
    if (g.status === 'done' && g.result) liveResults(g);
    else if (g.status === 'cancelled' || g.status === 'abandoned') { abortGame(); toast('The game was closed.'); go('live'); }
  }
  function liveReport(final) {
    if (!G || G.kind !== 'live') return;
    if (final) LV.finalPending = true;
    if (LV.sending) { LV.again = true; return; }
    var p = G.p[0], code = G.code, body = { action: 'progress', code: code, idx: p.idx, wrong: p.wrong };
    var isFinal = LV.finalPending && !LV.finalSent;
    if (isFinal) { body.final = true; body.raw = +((p.end - p.start) / 1000).toFixed(3); body.extra = { splits: p.splits, bestStreak: p.bestStreak, wrongBy: p.wrongBy }; }
    LV.sending = true;
    var tries = 0;
    (function send() {
      liveApi('/api/live', body).then(function () {
        if (isFinal) LV.finalSent = true;
        LV.sending = false;
        if (LV.again || (LV.finalPending && !LV.finalSent)) { LV.again = false; liveReport(); }
      }).catch(function () {
        if (++tries < 6 && G && G.code === code) setTimeout(send, 400 * tries); else LV.sending = false;
      });
    })();
  }
  function liveResults(g) {
    if (inLive(g.code) && G.resultFor === g.code) { liveRematchHint(g); return; }
    var me = g.you, op = liveOther(me), r = g.result, mine = r[me], theirs = r[op], game = liveGame(g.cfg);
    var p = (inLive(g.code) && G.p) ? G.p[0] : newP();
    if (!inLive(g.code)) { abortGame(); token++; G = { kind: 'live', token: token, code: g.code, live: false, p: [p], ui: [] }; }
    if (G.timer) { clearInterval(G.timer); G.timer = null; }
    G.resultFor = g.code; G.live = false; wakeOff();
    var b = { cid: 'live-' + g.id, game: game, mode: 'live', cfg: g.cfg, at: g.start_at, live: { code: g.code, reason: r.reason, role: me },
      winner: r.winner == null ? -1 : r.winner === me ? 0 : 1 };
    if (game === 'tol') b.players = [{ name: g[me].name, score: mine.score, wrong: mine.wrong, avgRt: mine.avgRt }, { name: g[op].name, score: theirs.score, wrong: theirs.wrong, avgRt: theirs.avgRt }];
    else if (game === 'sprint') b.players = [
      { name: g[me].name, score: mine.score, wrong: mine.wrong, splits: p.splits.length ? p.splits : mine.splits || [], bestStreak: p.bestStreak || mine.bestStreak || 0, wrongBy: p.wrongBy },
      { name: g[op].name, score: theirs.score, wrong: theirs.wrong, splits: theirs.splits || [], bestStreak: theirs.bestStreak || 0, wrongBy: {} }];
    else b.players = [
      { name: g[me].name, time: mine.time, raw: mine.raw, wrong: mine.wrong, dnf: mine.dnf || undefined, splits: p.splits, bestStreak: p.bestStreak, wrongBy: p.wrongBy },
      { name: g[op].name, time: theirs.time, raw: theirs.raw, wrong: theirs.wrong, dnf: theirs.dnf || undefined, splits: theirs.splits || [], bestStreak: theirs.bestStreak || 0, wrongBy: {} }];
    renderResults(b, null);
    var m = document.querySelector('#resBody .margin');
    if (m && r.reason !== 'finished') {
      var iWon = b.winner === 0;
      m.textContent = r.reason === 'forfeit' ? (iWon ? g[op].name + ' left the game, so you win by forfeit.' : 'You left the game, so ' + g[op].name + ' wins.')
        : 'Time ran out. ' + (b.winner < 0 ? 'Nobody finished.' : (iWon ? 'You got further.' : g[op].name + ' got further.'));
      if (r.reason === 'forfeit' && game !== 'duel') m.textContent += ' The score was ' + mine.score + '–' + theirs.score + '.';
    }
    var kick = document.querySelector('#resBody .kicker b'); if (kick) kick.textContent = 'LIVE ' + GNAME[game].toUpperCase();
    var hint = document.createElement('div'); hint.id = 'lvRe'; var bar = $('saveBar'); if (bar) bar.parentNode.insertBefore(hint, bar.nextSibling);
    $('again').onclick = function () {
      liveApi('/api/live', { action: 'rematch', code: g.code }).then(function (j) {
        return liveApi('/api/live', { action: 'join', code: j.code }).catch(function () {}).then(function () { abortGame(); go('live/' + j.code); });
      }).catch(function (e) { toast(e.message); });
    };
    liveRematchHint(g);
  }
  function liveRematchHint(g) {
    var h = $('lvRe'); if (!h || !g.rematch_code) return;
    if (h.dataset.code === g.rematch_code) return; h.dataset.code = g.rematch_code;
    h.innerHTML = '<div class="savebar ok"><span class="dot"></span><span>' + esc(g[liveOther(g.you)].name) + ' wants a rematch.</span><button class="btn primary" id="lvReJoin">Join</button></div>';
    $('lvReJoin').onclick = function () {
      liveApi('/api/live', { action: 'join', code: g.rematch_code }).then(function (j) { abortGame(); go('live/' + j.code); }).catch(function (e) { toast(e.message); });
    };
  }

  // ---------------- live Truth or Lie (v2.8): rounds judged by the server ----------------
  // Both devices reveal statement k at the same server time. Each player gets one call; the server
  // gives the point to the quickest right call (reaction times measured here, checked there).
  function liveTolStart(g) {
    abortGame(); token++;
    var me = g[g.you], opp = g[liveOther(g.you)], T = g.tol.target;
    G = { kind: 'ltol', token: token, live: true, code: g.code, id: g.id, role: g.you, oppName: opp.name, names: [me.name], cfg: g.cfg,
      startAt: new Date(g.start_at).getTime(), tol: g.tol, shownK: -1, lastK: -1, calls: {}, revealPerf: 0, ui: [], p: [newP()] };
    var play = $('play'); play.innerHTML = '';
    var el = document.createElement('section'); el.className = 'half solo ltol'; paintPlayer(el, 0);
    el.innerHTML = '<div class="hud"><span class="nm"></span><span class="tol-score mine"></span><span class="clock">–</span></div><div class="bar"><i></i></div>' +
      '<div class="tol-stage"><div class="tol-eq">Get ready…</div><div class="tol-flash"></div><div class="tol-note"></div></div>' +
      '<div class="tol-btns"><button class="t" data-a="1">TRUE</button><button class="f" data-a="0">LIE</button></div>' +
      '<div class="keyhint">A or ← = TRUE · S or → = LIE</div><div class="cover"><div class="big"></div><div class="sub"></div></div>';
    el.querySelector('.nm').textContent = me.name;
    el.querySelector('.tol-score').innerHTML = new Array(T + 1).join('<i></i>');
    el.querySelector('.tol-btns').addEventListener('pointerdown', function (e) { var b = e.target.closest('button'); if (!b) return; e.preventDefault(); hit(b); liveTolCall(b.dataset.a === '1'); });
    var top = document.createElement('div'); top.className = 'solo-top lv';
    var q = document.createElement('button'); q.className = 'chipbtn'; q.textContent = 'Quit';
    q.onclick = function () {
      if (!window.confirm('Leave the game? That counts as a loss.')) return;
      liveApi('/api/live', { action: 'leave', code: G.code }).catch(function () {}); abortGame(); go('live');
    };
    var strip = document.createElement('div'); strip.className = 'lv-opp'; strip.style.setProperty('--oc', COL[1].c);
    strip.innerHTML = '<span class="nm">' + esc(opp.name) + '</span><span class="tol-score opp">' + new Array(T + 1).join('<i></i>') + '</span><span class="lv-st"></span>';
    top.appendChild(q); top.appendChild(strip); el.appendChild(top);
    G.strip = strip;
    G.ui[0] = { el: el, eq: el.querySelector('.tol-eq'), flash: el.querySelector('.tol-flash'), note: el.querySelector('.tol-note'), clock: el.querySelector('.clock'),
      pips: el.querySelector('.tol-score.mine'), bar: el.querySelector('.bar i'), btns: el.querySelector('.tol-btns'), cover: el.querySelector('.cover'),
      big: el.querySelector('.cover .big'), sub: el.querySelector('.cover .sub') };
    play.appendChild(el); showScreen('play'); wakeOn();
    G.timer = setInterval(liveTolFrame, 50);
    liveTolTick(g);
  }
  function liveTolFrame() {
    if (!G || G.kind !== 'ltol' || !G.live) return;
    var u = G.ui[0], now = serverNow();
    if (now < G.startAt) {
      var left = G.startAt - now, shown = left > 3000 ? 'Ready' : String(Math.ceil(left / 1000));
      if (shown !== G.cd) { G.cd = shown; u.cover.classList.remove('hidden'); u.big.textContent = shown; u.sub.textContent = 'vs ' + G.oppName + ' · first to ' + G.tol.target; if (shown !== 'Ready') sfx.tick(); }
      return;
    }
    if (G.cd !== 'go') { G.cd = 'go'; u.cover.classList.add('hidden'); sfx.go(); }
    var r = G.tol && G.tol.round;
    if (r && r.text && G.shownK !== r.k && now >= new Date(r.at).getTime()) {
      var at = new Date(r.at).getTime();
      G.shownK = r.k; G.revealPerf = performance.now() - (now - at);
      u.eq.textContent = r.text; u.flash.textContent = ''; u.flash.className = 'tol-flash'; u.note.textContent = 'Round ' + (r.k + 1);
      qsa('button', u.btns).forEach(function (b) { b.classList.remove('picked'); });
      u.el.classList.toggle('locked', G.calls[r.k] != null || !!r.mine);
    }
    if (r && G.shownK === r.k && G.lastK < r.k) {
      var a2 = new Date(r.at).getTime(), cl = new Date(r.closes).getTime();
      u.bar.style.width = Math.max(0, Math.min(100, (cl - now) / (cl - a2) * 100)) + '%';
      u.clock.textContent = Math.max(0, (cl - now) / 1000).toFixed(1);
    } else { u.bar.style.width = '0%'; u.clock.textContent = '–'; }
  }
  function liveTolTick(g) {
    if (!G || G.kind !== 'ltol') return;
    if (g.status === 'done' && g.result) return liveResults(g);
    if (g.status === 'cancelled' || g.status === 'abandoned') { abortGame(); toast('The game was closed.'); go('live'); return; }
    if (!g.tol) return;
    G.tol = g.tol;
    var me = g.you, op = liveOther(me), u = G.ui[0], t = g.tol, r = t.round;
    qsa('i', u.pips).forEach(function (pip, k) { pip.classList.toggle('on', k < t.score[me]); });
    qsa('.tol-score i', G.strip).forEach(function (pip, k) { pip.classList.toggle('on', k < t.score[op]); });
    G.strip.querySelector('.lv-st').textContent = r && r.oppCalled && G.shownK === r.k && G.lastK < r.k ? 'called' : '';
    var claim = G.strip.querySelector('.lv-claim');
    if (g.opp_gone && !claim) {
      var cb = document.createElement('button'); cb.className = 'chipbtn lv-claim'; cb.textContent = 'Opponent left · claim win';
      cb.onclick = function () { liveApi('/api/live', { action: 'claim', code: g.code }).catch(function (e) { toast(e.message); }); };
      G.strip.appendChild(cb);
    } else if (!g.opp_gone && claim) claim.remove();
    if (r && r.mine && G.shownK === r.k) u.el.classList.add('locked');
    var L = t.last;
    if (L && L.k > G.lastK) {
      G.lastK = L.k;
      var mine = L[me], theirs = L[op], truth = L.truth ? 'true' : 'a lie', msg, cls = '';
      if (L.winner === me) { cls = 'ok'; msg = '+1 for you!' + (theirs && theirs.ok ? ' Quicker by ' + ((theirs.rt - mine.rt) / 1000).toFixed(2) + ' s' : ''); sfx.good(); }
      else if (L.winner === op) { cls = 'no'; msg = G.oppName + ' scores' + (mine && mine.ok ? ', quicker by ' + ((mine.rt - theirs.rt) / 1000).toFixed(2) + ' s' : ''); if (mine && !mine.ok) { sfx.bad(); buzz(60); } }
      else msg = 'Nobody scores';
      if (G.shownK !== L.k) { u.eq.textContent = L.text; G.shownK = L.k; }
      u.flash.textContent = msg; u.flash.className = 'tol-flash ' + cls;
      u.note.textContent = 'It was ' + truth + '. ' + (mine ? (mine.ok ? 'You were right.' : 'You said ' + (mine.s ? 'true.' : 'a lie.')) : 'You didn’t call it.');
      u.el.classList.add('locked');
    }
  }
  function liveTolCall(said) {
    if (!G || G.kind !== 'ltol' || !G.live) return;
    var r = G.tol && G.tol.round;
    if (!r || G.shownK !== r.k || G.lastK >= r.k || G.calls[r.k] != null || r.mine) return;
    var rt = Math.round(performance.now() - G.revealPerf), k = r.k, u = G.ui[0], my = G.token;
    G.calls[k] = said; u.el.classList.add('locked');
    var pb = u.btns.querySelector(said ? '.t' : '.f'); if (pb) pb.classList.add('picked');
    u.flash.textContent = (said ? 'TRUE' : 'LIE') + ' in ' + (rt / 1000).toFixed(2) + ' s'; u.flash.className = 'tol-flash';
    u.note.textContent = 'Waiting for ' + G.oppName + '…';
    liveApi('/api/live', { action: 'call', code: G.code, k: k, said: said, rt: rt }).then(function (j) {
      if (!G || G.token !== my) return;
      if (j.late) u.flash.textContent = 'Too late for that one!';
      if (j.game) { LV.g = j.game; liveTolTick(j.game); }
    }).catch(function (e) {
      if (!G || G.token !== my) return;
      delete G.calls[k]; u.el.classList.remove('locked'); if (pb) pb.classList.remove('picked'); toast(e.message);
    });
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
    el.innerHTML = '<p class="kicker"><b>5</b> Chat</p><h2 class="title">#' + CH.c + '</h2>' +
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
  function pwFormHtml(forced) {
    return '<form id="pwF" novalidate>' +
      '<label class="sr" for="pwCur">Current password</label><input class="inp" id="pwCur" type="password" autocomplete="current-password" placeholder="' + (forced ? 'Temporary password' : 'Current password') + '">' +
      '<label class="sr" for="pwNew">New password</label><input class="inp" id="pwNew" type="password" autocomplete="new-password" placeholder="New password (8+ characters)">' +
      '<label class="sr" for="pwNew2">New password again</label><input class="inp" id="pwNew2" type="password" autocomplete="new-password" placeholder="Type it again">' +
      '<div class="err" id="pwErr" role="alert"></div><button class="btn primary block' + (forced ? ' lg' : '') + '" id="pwGo" type="submit">Save my password</button></form>';
  }
  function bindPwForm(forced) {
    $('pwF').onsubmit = function (e) {
      e.preventDefault();
      var cur = $('pwCur').value, nw = $('pwNew').value, nw2 = $('pwNew2').value, err = $('pwErr'), btn = $('pwGo');
      if (nw.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
      if (nw !== nw2) { err.textContent = 'The two new passwords don’t match.'; return; }
      err.textContent = ''; btn.disabled = true;
      api('/api/auth', { action: 'changePassword', current: cur, password: nw }).then(function (j) {
        setMe(j.user); toast('Password saved. Only you know it now.');
        if (forced) { flush(); go(''); } else renderAccount();
      }).catch(function (e2) { err.textContent = e2.message; btn.disabled = false; });
    };
  }
  function renderAccount() {
    var el = $('v-account');
    if (ME && ME.mustChange) {
      el.innerHTML = '<div class="auth"><p class="kicker"><b>6</b> Account</p><h2 class="title">Hi ' + esc(ME.name) + '!</h2>' +
        '<p class="lede">Your account starts with a temporary password. Before you play, pick your own secret one that only you know. Use at least 8 characters. Tip: three random words, like <i>pebble-rocket-toast</i>.</p>' +
        pwFormHtml(true) + '</div>';
      bindPwForm(true); return;
    }
    if (!ME) {
      el.innerHTML = '<div class="auth"><p class="kicker"><b>6</b> Account</p><h2 class="title">Sign In or Sign Up.<br><span class="serif" style="font-style:italic;color:var(--p1)">Same Box.</span></h2>' +
        '<p class="lede">Type your email and a password. If you’re new, this makes your account straight away. After that, every game you play is saved to your record.</p>' +
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
          return (j.created ? adoptGuest() : Promise.resolve()).then(loadWallet).then(pullBattles);
        }).then(function () { renderAccount(); }).catch(function (e2) {
          err.textContent = e2.message === 'Failed to fetch' ? 'Can’t reach the server. Check your connection.' : e2.message;
          btn.disabled = false; btn.textContent = 'Continue';
        });
      };
    } else {
      var st = computeStats(localBattles());
      el.innerHTML = '<div class="auth"><p class="kicker"><b>6</b> Account</p><h2 class="title">' + esc(ME.name) + '</h2><p class="lede" style="margin-bottom:14px">' + esc(ME.email) + ' · ' + st.total + ' battles on record</p>' +
        '<div class="panel"><label class="flab" for="dn">Display name<small>shown on the boards</small></label>' +
        '<div class="row" style="margin-top:8px"><input class="inp" id="dn" maxlength="20" value="' + esc(ME.name) + '" style="flex:1;margin:0;min-width:0"><button class="btn" id="dnSave">Save</button></div><div class="err" id="dnErr"></div></div>' +
        '<details class="panel pwbox" style="margin-top:14px"><summary>Change password</summary>' + pwFormHtml(false) + '</details>' +
        '<div class="row acts-grid" style="margin-top:14px"><a class="btn" href="#/record">View record</a>' + (ME.admin ? '<a class="btn" href="/admin">Admin tools</a>' : '') + '<button class="btn ghost" id="logout">Sign out</button></div></div>' + settingsHtml();
      $('dnSave').onclick = function () {
        var v = $('dn').value.trim(); if (!v) { $('dnErr').textContent = 'Name can’t be empty.'; return; }
        api('/api/auth', { action: 'rename', name: v }).then(function (j) { var old = ME.name; setMe(j.user); if (S.names[0] === old) { S.names[0] = j.user.name; save(); } toast('Name updated'); renderAccount(); })
          .catch(function (e) { $('dnErr').textContent = e.message; });
      };
      bindPwForm(false);
      $('logout').onclick = function () {
        api('/api/auth', { action: 'logout' }).catch(function () {}).then(function () {
          setMe(null); setLocalBattles([]); store.set('sd_pending', []); S.names[0] = 'Player 1'; save(); toast('Signed out'); renderAccount();
        });
      };
    }
    bindSettings();
  }
  function settingsHtml() {
    return '<div class="section auth"><p class="kicker"><b>7</b> Preferences</p><div class="panel" style="padding:4px 18px">' +
      '<div class="setrow"><div>Sound<small>Blips, buzzers and fanfare</small></div><button class="toggle" data-s="sound" aria-pressed="' + !!S.sound + '" aria-label="Sound"></button></div>' +
      '<div class="setrow"><div>Haptics<small>Vibrate on wrong answers (Android)</small></div><button class="toggle" data-s="haptics" aria-pressed="' + !!S.haptics + '" aria-label="Haptics"></button></div>' +
      '<div class="setrow"><div>Night mode<small>Dark colours for the evening</small></div><button class="toggle" data-s="theme" aria-pressed="' + (S.theme === 'night') + '" aria-label="Night mode"></button></div>' +
      '</div><div class="pal-set"><p class="flab">Colours</p>' + palTiles() + '</div><p class="foot">Tip: in Chrome or Safari, choose Add to Home Screen and it runs full-screen and offline.</p></div>';
  }
  function bindSettings() {
    qsa('.pal-set').forEach(bindPal);
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
  renderPalPick();
  paintWho();
  loadWallet();
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
