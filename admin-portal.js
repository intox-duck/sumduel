/* Sum Duel admin portal. Access comes from the player session + users.role (admin | super_admin).
   Anyone else sees a plain 404 page. Tabs: Players, Chat (admin+); Flags, Activity, Audits (super_admin). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  try {
    var st = JSON.parse(localStorage.getItem('sumduel') || '{}');
    if (st && st.theme === 'night') document.documentElement.setAttribute('data-theme', 'night');
  } catch (e) { /* storage blocked: paper */ }

  var ROLE = null, TAB = 'players';

  function api(body) {
    var o = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin' };
    return fetch('/api/admin', o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('Error ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function chat(body) {
    return fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ('Error ' + r.status)); return j; }); });
  }
  var toastT;
  function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 3200); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function when(iso) {
    if (!iso) return 'never';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  function fail(e) { if (e.status === 404) return show404(); toast(e.message); }
  function show404() { $('loading').hidden = true; $('dash').hidden = true; $('who').hidden = true; $('nf').hidden = false; }
  var SUPER = function () { return ROLE === 'super_admin'; };
  function genPassword() {
    var abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '', b = new Uint32Array(14);
    crypto.getRandomValues(b); for (var i = 0; i < b.length; i++) out += abc[b[i] % abc.length]; return out;
  }
  function csv(rows, cols) {
    var q = function (v) { v = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); return '"' + v.replace(/"/g, '""') + '"'; };
    return [cols.join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c]); }).join(','); })).join('\n');
  }
  function download(name, text) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  // ---------------- tabs ----------------
  function tabs() {
    var list = [['players', 'Players'], ['chat', 'Chat']];
    if (SUPER()) list.push(['flags', 'Flags'], ['activity', 'Activity'], ['audits', 'Audits']);
    $('tabs').innerHTML = list.map(function (t) {
      return '<button role="tab" data-t="' + t[0] + '" aria-selected="' + (t[0] === TAB) + '">' + t[1] + (t[0] === 'flags' ? '<b id="flagN"></b>' : '') + '</button>';
    }).join('');
    $('tabs').onclick = function (e) { var b = e.target.closest('[data-t]'); if (b) { TAB = b.dataset.t; tabs(); render(); } };
    if (SUPER()) api({ action: 'flags' }).then(function (j) { var n = $('flagN'); if (n) n.textContent = j.rows.length ? j.rows.length : ''; }).catch(function () {});
  }
  function render() {
    var p = $('pane'); p.innerHTML = '<p class="muted">Loading…</p>';
    ({ players: players, chat: chatPane, flags: flags, activity: activity, audits: audits })[TAB](p);
  }

  // ---------------- players ----------------
  function players(p) {
    p.innerHTML = '<div class="kicker">§1 Players</div><h1>players <i>:</i> List User</h1>' +
      '<p class="lede">Search for a player. ' + (SUPER() ? 'You can reset anyone’s password, make players admins, mute them, and open their full history.' : 'You can reset a player’s password or mute them in chat.') + '</p>' +
      '<div class="bar"><input id="q" type="search" placeholder="Search email or name" aria-label="Search players"><span class="count" id="count"></span></div><ul class="users" id="users"></ul>';
    var t; $('q').oninput = function () { clearTimeout(t); var v = this.value; t = setTimeout(function () { loadUsers(v); }, 220); };
    $('users').onclick = onUserClick; $('users').onchange = onUserChange;
    loadUsers('');
  }
  var seq = 0;
  function loadUsers(q) {
    var my = ++seq;
    api({ action: 'users', q: q }).then(function (j) {
      if (my !== seq) return;
      $('count').textContent = j.users.length + ' shown · ' + j.total + ' total';
      $('users').innerHTML = j.users.length ? j.users.map(userRow).join('') : '<li class="empty-state">No players' + (q ? ' match “' + esc(q) + '”' : ' yet') + '.</li>';
    }).catch(fail);
  }
  function userRow(u) {
    var muted = u.muted_until && new Date(u.muted_until) > new Date();
    var canPw = SUPER() || u.role === 'player' || u.self;
    return '<li data-id="' + esc(u.id) + '" data-email="' + esc(u.email) + '" data-name="' + esc(u.name) + '">' +
      '<div class="row"><div><div class="em">' + esc(u.email) + ' ' + (u.role !== 'player' ? '<span class="pill ' + esc(u.role) + '">' + esc(u.role.replace('_', ' ')) + '</span>' : '') +
      (muted ? ' <span class="pill bad">muted until ' + esc(when(u.muted_until)) + '</span>' : '') + '</div>' +
      '<div class="meta"><span><b>' + esc(u.name) + '</b></span><span>Joined ' + esc(when(u.created_at)) + '</span><span>Last sign-in ' + esc(when(u.last_sign_in)) + '</span>' +
      '<span>' + u.battles + ' battles</span><span>' + u.messages + ' chat messages</span><span>' + u.sessions + ' active session' + (u.sessions === 1 ? '' : 's') + '</span></div></div>' +
      '<div class="acts">' +
        (canPw ? '<button data-act="pw">Set password</button>' : '') +
        (!u.self && (SUPER() || u.role === 'player') ? '<select data-act="mute" aria-label="Mute ' + esc(u.name) + '"><option value="">Mute…</option><option value="10">10 min</option><option value="60">1 hour</option><option value="1440">1 day</option><option value="10080">1 week</option><option value="0">Unmute</option></select>' : '') +
        (SUPER() && u.role !== 'super_admin' ? '<select data-act="role" aria-label="Role for ' + esc(u.name) + '"><option value="player"' + (u.role === 'player' ? ' selected' : '') + '>Player</option><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option></select>' : '') +
        (SUPER() ? '<button data-act="detail">Details</button>' : '') +
      '</div></div></li>';
  }
  function onUserChange(e) {
    var sel = e.target.closest('select'); if (!sel) return;
    var li = sel.closest('li'), act = sel.dataset.act, v = sel.value;
    if (act === 'mute' && v !== '') {
      chat({ action: 'mute', userId: li.dataset.id, minutes: Number(v) })
        .then(function () { toast(Number(v) ? li.dataset.name + ' muted' : li.dataset.name + ' unmuted'); loadUsers($('q').value); })
        .catch(function (er) { toast(er.message); sel.value = ''; });
    }
    if (act === 'role') {
      if (!confirm('Make ' + li.dataset.email + ' ' + (v === 'admin' ? 'an admin' : 'a regular player') + '?')) { loadUsers($('q').value); return; }
      api({ action: 'setRole', userId: li.dataset.id, role: v }).then(function () { toast('Role updated'); loadUsers($('q').value); }).catch(fail);
    }
  }
  function onUserClick(e) {
    var b = e.target.closest('button'); if (!b) return;
    var li = b.closest('li'), act = b.dataset.act;
    if (act === 'pw') {
      var open = document.querySelector('.reset'); if (open) open.remove();
      var box = document.createElement('div'); box.className = 'reset';
      box.innerHTML = '<div class="line"><input class="mono" type="text" maxlength="200" spellcheck="false" autocomplete="new-password" placeholder="New password (6+ characters)" aria-label="New password">' +
        '<button data-act="gen">Generate</button><button data-act="copy">Copy</button></div>' +
        '<div class="line" style="margin-top:10px"><button class="primary" data-act="save">Save password</button><button class="ghost" data-act="cancel">Cancel</button></div>' +
        '<small>Saving signs this player out everywhere and clears any lockout. Tell them the new password yourself; nothing is emailed.</small>';
      li.appendChild(box); box.querySelector('input').focus(); return;
    }
    if (act === 'gen') { var i = li.querySelector('.reset input'); i.value = genPassword(); i.select(); return; }
    if (act === 'copy') { var v = li.querySelector('.reset input').value; if (!v) return toast('Nothing to copy'); navigator.clipboard.writeText(v).then(function () { toast('Copied'); }, function () { toast('Copy failed: select it by hand'); }); return; }
    if (act === 'cancel') { li.querySelector('.reset').remove(); return; }
    if (act === 'save') {
      var pw = li.querySelector('.reset input').value;
      if (pw.length < 6) return toast('Password needs at least 6 characters');
      if (!confirm('Set a new password for ' + li.dataset.email + '? They’ll be signed out everywhere.')) return;
      b.disabled = true;
      api({ action: 'setPassword', userId: li.dataset.id, password: pw }).then(function (j) {
        toast('Password updated for ' + j.email); loadUsers($('q').value);
      }).catch(function (er) { b.disabled = false; fail(er); });
      return;
    }
    if (act === 'detail') {
      var ex = li.querySelector('.detail'); if (ex) { ex.remove(); return; }
      var d = document.createElement('div'); d.className = 'detail'; d.innerHTML = '<p class="muted">Loading…</p>'; li.appendChild(d);
      api({ action: 'player', userId: li.dataset.id }).then(function (j) { d.innerHTML = detailHtml(j); }).catch(fail);
    }
  }
  function battleText(b) {
    var P = b.players || [], p0 = P[0] || {}, p1 = P[1] || {};
    var res = b.winner === 0 ? 'won' : b.winner === 1 ? 'lost' : b.winner === -1 ? 'draw' : '';
    if (b.game === 'duel') return 'Duel vs ' + esc(p1.name) + ' · ' + res + ' · ' + (p0.time != null ? p0.time.toFixed(2) : '?') + ' s vs ' + (p1.time != null ? p1.time.toFixed(2) : '?') + ' s';
    if (b.game === 'tol') return 'Truth or Lie vs ' + esc(p1.name) + ' · ' + res + ' · ' + p0.score + '–' + p1.score;
    if (b.game === 'sprint') return 'Sprint · ' + p0.score + ' correct, ' + p0.wrong + ' wrong';
    if (b.game === 'daily') return 'Daily ' + esc(b.day) + ' · ' + (p0.time != null ? p0.time.toFixed(2) : '?') + ' s' + (b.practice ? ' (practice)' : '');
    return esc(b.game);
  }
  function detailHtml(j) {
    var p = j.player;
    return '<h3>-- ' + esc(p.name) + ' · ' + esc(p.email) + '</h3><p class="muted">Joined ' + esc(when(p.created_at)) + ' · role ' + esc(p.role) + '</p>' +
      '<h3>-- Scores</h3>' + (j.scores.length ? '<div class="tbl"><table><thead><tr><th>Board</th><th>Score</th><th>When</th></tr></thead><tbody>' +
        j.scores.map(function (s) { return '<tr><td>' + esc(s.board) + '</td><td>' + esc(s.score) + '</td><td>' + esc(when(s.created_at)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="faint">None yet.</p>') +
      '<h3>-- Battles (' + j.battles.length + ')</h3>' + (j.battles.length ? '<div class="tbl"><table><thead><tr><th>When</th><th>Game</th></tr></thead><tbody>' +
        j.battles.map(function (b) { return '<tr><td>' + esc(when(b.at)) + '</td><td>' + battleText(b) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="faint">None yet.</p>') +
      '<h3>-- Chat messages (' + j.messages.length + ')</h3>' + (j.messages.length ? '<div class="tbl"><table><thead><tr><th>When</th><th>Channel</th><th>Message</th><th>Flags</th></tr></thead><tbody>' +
        j.messages.map(function (m) { return '<tr><td>' + esc(when(m.at)) + '</td><td>#' + esc(m.channel) + '</td><td class="' + (m.deleted_at ? 'rm' : '') + '">' + esc(m.body) + '</td><td>' + esc(m.flag_reason || '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="faint">None yet.</p>') +
      '<h3>-- Activity</h3><div class="tbl"><table><thead><tr><th>When</th><th>Action</th><th>Details</th><th>IP</th></tr></thead><tbody>' +
        j.activity.map(function (a) { return '<tr><td>' + esc(when(a.at)) + '</td><td>' + esc(LABEL[a.action] || a.action) + '</td><td>' + describe(a) + '</td><td>' + esc(a.ip || '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }

  // ---------------- chat moderation ----------------
  var CHAN = 'lobby';
  function chatPane(p) {
    p.innerHTML = '<div class="kicker">§2 Chat</div><h1>chat <i>:</i> Moderate</h1>' +
      '<p class="lede">Recent messages, newest first. Delete anything unkind or unsafe, and mute players who need a break. Players can also report messages.</p>' +
      '<div class="filters"><select id="chan"></select><button id="reload">Refresh</button></div>' +
      '<h3 class="kicker" style="margin-top:6px">Muted now</h3><div id="mutes" class="muted" style="margin-bottom:18px">…</div>' +
      '<div class="tbl"><table><thead><tr><th>When</th><th>Nick</th><th>Message</th>' + (SUPER() ? '<th>Flags</th>' : '') + '<th></th></tr></thead><tbody id="msgs"></tbody></table></div>';
    $('reload').onclick = function () { loadChat(); };
    $('chan').onchange = function () { CHAN = this.value; loadChat(); };
    $('msgs').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return; var tr = b.closest('tr');
      if (b.dataset.a === 'del') chat({ action: 'delete', id: tr.dataset.id }).then(function () { toast('Removed'); loadChat(); }).catch(function (er) { toast(er.message); });
      if (b.dataset.a === 'mute') chat({ action: 'mute', userId: tr.dataset.uid, minutes: 60 }).then(function () { toast(tr.dataset.nick + ' muted for 1 hour'); loadChat(); }).catch(function (er) { toast(er.message); });
    };
    $('mutes').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      chat({ action: 'mute', userId: b.dataset.uid, minutes: 0 }).then(function () { toast('Unmuted'); loadChat(); }).catch(function (er) { toast(er.message); });
    };
    loadChat();
  }
  function loadChat() {
    api({ action: 'chat', c: CHAN }).then(function (j) {
      $('chan').innerHTML = j.channels.map(function (c) { return '<option value="' + c + '"' + (c === CHAN ? ' selected' : '') + '>#' + c + '</option>'; }).join('');
      $('msgs').innerHTML = j.messages.length ? j.messages.map(function (m) {
        var canMute = SUPER() || m.role === 'player';
        return '<tr data-id="' + m.id + '" data-uid="' + m.uid + '" data-nick="' + esc(m.nick) + '"><td>' + esc(when(m.at)) + '</td><td>' + esc(m.nick) + '</td>' +
          '<td class="' + (m.removed ? 'rm' : '') + '">' + (m.removed && m.body == null ? '(removed)' : (m.kind === 'action' ? '* ' : '') + esc(m.body)) + '</td>' +
          (SUPER() ? '<td>' + (m.flagged ? '<span class="pill ' + (m.reviewed ? 'ok' : 'bad') + '">' + esc(m.flag_reason || 'flagged') + '</span>' : '') + '</td>' : '') +
          '<td><div class="acts">' + (m.removed ? '' : '<button data-a="del">Delete</button>') + (canMute ? '<button data-a="mute">Mute 1h</button>' : '') + '</div></td></tr>';
      }).join('') : '<tr><td colspan="5" class="faint">No messages yet.</td></tr>';
    }).catch(fail);
    api({ action: 'mutes' }).then(function (j) {
      $('mutes').innerHTML = j.mutes.length ? j.mutes.map(function (m) { return '<span style="margin-right:14px">' + esc(m.name) + ' (until ' + esc(when(m.muted_until)) + ') <button data-uid="' + m.id + '">Unmute</button></span>'; }).join('') : 'Nobody.';
    }).catch(function () {});
  }

  // ---------------- flags (super) ----------------
  function flags(p) {
    p.innerHTML = '<div class="kicker">§3 Flags</div><h1>flags <i>:</i> Review Queue</h1>' +
      '<p class="lede">Messages the safeguarding filter flagged, plus anything a player reported. Wellbeing and personal-info flags come first. Mark each one reviewed once you’ve dealt with it.</p><div id="flagList"><p class="muted">Loading…</p></div>';
    $('flagList').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return; var c = b.closest('.card'), id = c.dataset.id, a = b.dataset.a;
      var after = function (msg) { toast(msg); flags(p); tabs(); };
      if (a === 'ok') api({ action: 'review', id: id }).then(function () { after('Marked reviewed'); }).catch(fail);
      if (a === 'del') chat({ action: 'delete', id: id }).then(function () { return api({ action: 'review', id: id }); }).then(function () { after('Removed and reviewed'); }).catch(function (er) { toast(er.message); });
      if (a === 'm1' || a === 'm24') chat({ action: 'mute', userId: c.dataset.uid, minutes: a === 'm1' ? 60 : 1440 }).then(function () { toast('Muted'); }).catch(function (er) { toast(er.message); });
    };
    api({ action: 'flags' }).then(function (j) {
      $('flagList').innerHTML = j.rows.length ? j.rows.map(function (r) {
        var reasons = String(r.flag_reason || 'flagged').split(',');
        return '<div class="card" data-id="' + r.id + '" data-uid="' + r.uid + '"><div class="hd"><div>' +
          reasons.map(function (x) { return '<span class="pill ' + (x === 'wellbeing' || x === 'personal_info' ? 'bad' : 'warn') + '">' + esc(x.replace(/_/g, ' ')) + '</span> '; }).join('') +
          '<b>' + esc(r.nick) + '</b> <span class="faint">' + esc(r.email) + '</span></div><span class="faint">#' + esc(r.channel) + ' · ' + esc(when(r.at)) + '</span></div>' +
          '<div class="ctx">' + r.context.map(function (c) { return '<div class="' + (c.id === r.id ? 'hit' : '') + '">&lt;' + esc(c.nick) + '&gt; ' + esc(c.body) + '</div>'; }).join('') + '</div>' +
          (r.reports.length ? '<p class="muted">Reported by ' + r.reports.map(function (x) { return esc(x.by) + (x.reason ? ' (“' + esc(x.reason) + '”)' : ''); }).join(', ') + '</p>' : '') +
          (r.deleted_at ? '<p class="faint">Already removed from chat.</p>' : '') +
          '<div class="acts" style="justify-content:flex-start"><button class="primary" data-a="ok">Mark reviewed</button>' + (r.deleted_at ? '' : '<button data-a="del">Remove + reviewed</button>') +
          '<button data-a="m1">Mute 1h</button><button data-a="m24">Mute 1 day</button></div></div>';
      }).join('') : '<p class="muted">Nothing waiting. ∎</p>';
    }).catch(fail);
  }

  // ---------------- activity (super) ----------------
  var LABEL = {
    sign_up: 'Signed up', sign_in: 'Signed in', sign_out: 'Signed out', sign_in_failed: 'Wrong password', sign_in_locked: 'Locked out', rename: 'Renamed',
    battle_saved: 'Battle', score_posted: 'Score', live_create: 'Live game created', live_join: 'Joined live game', live_join_failed: 'Wrong game password',
    live_start: 'Live game started', live_finish: 'Live game finished', live_leave: 'Left live game', chat_message: 'Chat', chat_blocked: 'Chat blocked', chat_report: 'Reported a message',
    chat_delete: 'Removed a message', chat_mute: 'Muted', chat_unmute: 'Unmuted', admin_open: 'Opened admin', admin_password_reset: 'Reset password',
    admin_role_change: 'Changed role', admin_review: 'Reviewed flag', audit_run: 'Audit ran', audit_reviewed: 'Audit reviewed', role_set_cli: 'Role set (CLI)'
  };
  function describe(r) {
    var d = r.detail || {};
    switch (r.action) {
      case 'battle_saved': return battleText({ game: d.game, winner: d.winner, day: d.day, practice: d.practice, players: [{ time: d.times ? d.times[0] : d.time, score: d.score && d.score.length ? d.score[0] : d.score, wrong: d.wrong && d.wrong.length ? d.wrong[0] : d.wrong }, { name: d.vs, time: d.times ? d.times[1] : null, score: d.score && d.score.length ? d.score[1] : null }] });
      case 'live_create': return esc(d.code) + (d.name ? ' · ' + esc(d.name) : '') + (d.private ? ' · private' : '') + (d.rematch_of ? ' · rematch of ' + esc(d.rematch_of) : '');
      case 'live_join': return esc(d.code) + ' · ' + esc(d.name) + (d.private ? ' · private' : '');
      case 'live_join_failed': case 'live_leave': return esc(d.code) + (d.during ? ' · during ' + esc(d.during) : '');
      case 'live_start': return esc(d.code) + ' · ' + esc(d.host) + ' vs ' + esc(d.guest);
      case 'live_finish': return esc(d.code) + ' · ' + esc(d.host && d.host.name) + ' ' + (d.host && d.host.dnf ? 'DNF' : esc(d.host && d.host.time) + ' s') + ' vs ' + esc(d.guest && d.guest.name) + ' ' + (d.guest && d.guest.dnf ? 'DNF' : esc(d.guest && d.guest.time) + ' s') + ' · winner ' + esc(d.winner) + (d.reason !== 'finished' ? ' (' + esc(d.reason) + ')' : '');
      case 'score_posted': return esc(d.board) + ' · ' + esc(d.score) + (d.counted === false ? ' (not counted)' : '');
      case 'chat_message': return '#' + esc(d.channel) + ': ' + (d.kind === 'action' ? '* ' : '') + esc(d.text) + (d.flags ? ' <span class="pill bad">' + esc(d.flags.join(', ').replace(/_/g, ' ')) + '</span>' : '');
      case 'chat_blocked': return '#' + esc(d.channel) + ' <span class="pill bad">' + esc(d.reason) + '</span> ' + esc(d.text);
      case 'chat_report': return 'about &lt;' + esc(d.nick) + '&gt; ' + esc(d.text) + (d.reason ? ' · “' + esc(d.reason) + '”' : '');
      case 'chat_delete': return '&lt;' + esc(d.nick) + '&gt; ' + esc(d.text);
      case 'chat_mute': return esc(d.nick) + ' for ' + esc(d.minutes) + ' min';
      case 'chat_unmute': return esc(d.nick);
      case 'rename': return esc(d.from) + ' → ' + esc(d.to);
      case 'admin_role_change': return esc(d.from) + ' → ' + esc(d.to);
      case 'admin_password_reset': return 'signed out of ' + esc(d.sessionsEnded) + ' session(s)';
      case 'admin_review': return '&lt;' + esc(d.nick) + '&gt; ' + esc(d.text) + ' (' + esc(d.flags) + ')';
      case 'audit_run': return 'report #' + esc(d.id) + ' · ' + esc(d.trigger) + (d.attention ? ' · ' + d.attention + ' item(s) need attention' : '');
      default: return d && Object.keys(d).length ? esc(JSON.stringify(d)) : '';
    }
  }
  var ACT = { rows: [], kind: '', q: '' };
  function activity(p) {
    p.innerHTML = '<div class="kicker">§4 Activity</div><h1>activity <i>:</i> Log</h1>' +
      '<p class="lede">Everything that happens on the site: accounts, sign-ins, games, scores, chat (including blocked messages) and every admin action.</p>' +
      '<div class="filters"><select id="kind"><option value="">Everything</option><option value="auth">Accounts &amp; sign-ins</option><option value="games">Games &amp; scores</option><option value="chat">Chat</option><option value="admin">Admin &amp; audits</option></select>' +
      '<input id="aq" type="search" placeholder="Search email, text or IP" aria-label="Search activity"><button id="csv">Export CSV</button></div>' +
      '<div class="tbl"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th><th>IP</th></tr></thead><tbody id="act"></tbody></table></div>' +
      '<button class="more" id="more">Load older</button>';
    $('kind').value = ACT.kind; $('aq').value = ACT.q;
    $('kind').onchange = function () { ACT.kind = this.value; loadAct(false); };
    var t; $('aq').oninput = function () { clearTimeout(t); var v = this.value; t = setTimeout(function () { ACT.q = v; loadAct(false); }, 250); };
    $('more').onclick = function () { loadAct(true); };
    $('csv').onclick = function () { download('sumduel-activity-' + new Date().toISOString().slice(0, 10) + '.csv', csv(ACT.rows, ['at', 'actor_email', 'actor_role', 'action', 'target_email', 'detail', 'ip', 'ua'])); };
    loadAct(false);
  }
  function loadAct(more) {
    var before = more && ACT.rows.length ? ACT.rows[ACT.rows.length - 1].id : null;
    api({ action: 'activity', kind: ACT.kind, q: ACT.q, before: before }).then(function (j) {
      ACT.rows = more ? ACT.rows.concat(j.rows) : j.rows;
      $('act').innerHTML = ACT.rows.length ? ACT.rows.map(function (r) {
        return '<tr><td>' + esc(when(r.at)) + '</td><td>' + esc(r.actor_email || '—') + (r.actor_role && r.actor_role !== 'player' ? ' <span class="pill ' + esc(r.actor_role) + '">' + esc(r.actor_role.replace('_', ' ')) + '</span>' : '') +
          (r.target_email ? '<br><span class="faint">→ ' + esc(r.target_email) + '</span>' : '') + '</td><td>' + esc(LABEL[r.action] || r.action) + '</td><td>' + describe(r) + '</td><td>' + esc(r.ip || '') + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="faint">Nothing yet.</td></tr>';
      $('more').hidden = j.rows.length < 100;
    }).catch(fail);
  }

  // ---------------- audits (super) ----------------
  var TOT = [['new_users', 'new players'], ['sign_ins', 'sign-ins'], ['failed_sign_ins', 'wrong passwords'], ['lockouts', 'lockouts'], ['battles', 'battles'], ['scores', 'scores'],
    ['chat_messages', 'chat messages'], ['chat_blocked', 'blocked messages'], ['chat_flagged', 'flagged messages'], ['chat_reports', 'reports'], ['chat_deletes', 'removed'],
    ['chat_mutes', 'mutes'], ['live_games', 'live games'], ['password_resets', 'password resets'], ['role_changes', 'role changes'], ['unreviewed_flags_total', 'flags waiting (all time)'], ['open_reports_total', 'open reports (all time)']];
  function audits(p) {
    p.innerHTML = '<div class="kicker">§5 Audits</div><h1>audits <i>:</i> Safeguarding</h1>' +
      '<p class="lede">An audit runs automatically every morning (07:00 UTC) and covers everything since the previous one. It lists what needs attention, totals, blocked attempts to share personal details, and every action taken by admins. Run one now whenever you like.</p>' +
      '<div class="filters"><button class="primary" id="run">Run audit now</button></div><div id="auditList"><p class="muted">Loading…</p></div>';
    $('run').onclick = function () { this.disabled = true; api({ action: 'runAudit' }).then(function () { toast('Audit complete'); audits(p); }).catch(fail); };
    $('auditList').onclick = function (e) {
      var b = e.target.closest('[data-rev]'); if (!b) return;
      api({ action: 'auditReviewed', id: b.dataset.rev }).then(function () { toast('Marked reviewed'); audits(p); }).catch(fail);
    };
    api({ action: 'audits' }).then(function (j) {
      $('auditList').innerHTML = j.rows.length ? j.rows.map(auditCard).join('') : '<p class="muted">No audits yet. The first one runs tomorrow at 07:00 UTC, or press “Run audit now”.</p>';
    }).catch(fail);
  }
  function auditCard(r) {
    var d = r.data, t = d.totals || {};
    return '<div class="card"><div class="hd"><h3 style="margin:0">-- Audit #' + esc(r.id) + ' · ' + esc(when(r.period_start)) + ' → ' + esc(when(r.period_end)) + '</h3>' +
      '<span>' + '<span class="pill">' + esc(r.trigger) + '</span> ' + (r.reviewed_at ? '<span class="pill ok">reviewed</span>' : '<button data-rev="' + esc(r.id) + '">Mark reviewed</button>') + '</span></div>' +
      (d.attention && d.attention.length ? '<ul class="attention">' + d.attention.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' : '<p class="muted">Nothing needs attention. ∎</p>') +
      '<div class="metrics">' + TOT.map(function (k) { return '<div><b>' + esc(t[k[0]] != null ? t[k[0]] : 0) + '</b><span>' + k[1] + '</span></div>'; }).join('') + '</div>' +
      (d.admin_actions && d.admin_actions.length ? '<h3>-- Admin actions</h3><div class="tbl"><table><thead><tr><th>When</th><th>Admin</th><th>What</th><th>Target</th></tr></thead><tbody>' +
        d.admin_actions.map(function (a) { return '<tr><td>' + esc(when(a.at)) + '</td><td>' + esc(a.actor_email) + '</td><td>' + esc(LABEL[a.action] || a.action) + '</td><td>' + esc(a.target_email || (a.detail && a.detail.nick) || '') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
      (d.blocked && d.blocked.length ? '<h3>-- Blocked messages</h3><div class="tbl"><table><thead><tr><th>When</th><th>Player</th><th>Why</th><th>Text</th></tr></thead><tbody>' +
        d.blocked.map(function (b) { return '<tr><td>' + esc(when(b.at)) + '</td><td>' + esc(b.actor_email) + '</td><td>' + esc(b.reason) + '</td><td>' + esc(b.text) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
      (d.flag_reasons && d.flag_reasons.length ? '<p class="muted">Flags: ' + d.flag_reasons.map(function (f) { return esc(String(f.reason).replace(/_/g, ' ')) + ' ×' + f.n; }).join(', ') + '</p>' : '') +
      (d.top_chatters && d.top_chatters.length ? '<p class="muted">Most active in chat: ' + d.top_chatters.map(function (c) { return esc(c.nick) + ' (' + c.n + ')'; }).join(', ') + '</p>' : '') +
      (d.muted && d.muted.length ? '<p class="muted">Muted at audit time: ' + d.muted.map(function (m) { return esc(m.name); }).join(', ') + '</p>' : '') +
      '</div>';
  }

  // ---------------- boot ----------------
  api().then(function (j) {
    ROLE = j.role;
    $('loading').hidden = true; $('dash').hidden = false;
    $('whoName').textContent = j.me.name + (SUPER() ? ' · super admin' : ' · admin'); $('who').hidden = false;
    tabs(); render();
  }).catch(function () { show404(); });
})();
