/* Sum Duel admin portal client. Google Identity Services sign-in, then player search + password reset. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  // Match the theme the player app saved on this device (localStorage "sumduel".theme): paper by default, 'night' = blackboard.
  try {
    var s = JSON.parse(localStorage.getItem('sumduel') || '{}');
    if (s && s.theme === 'night') document.documentElement.setAttribute('data-theme', 'night');
  } catch (e) { /* storage blocked: stay on paper */ }

  function api(body) {
    var opts = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' }
      : { credentials: 'same-origin' };
    return fetch('/api/admin', opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('Error ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  var toastT;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  function show(id) {
    ['loading', 'unconfigured', 'signin', 'dash'].forEach(function (s) { $(s).hidden = s !== id; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function when(iso) {
    if (!iso) return 'never';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  // 14 chars from an unambiguous alphabet (no 0/O/1/l/I), via crypto.getRandomValues.
  function genPassword() {
    var abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '', buf = new Uint32Array(14);
    crypto.getRandomValues(buf);
    for (var i = 0; i < buf.length; i++) out += abc[buf[i] % abc.length];
    return out;
  }

  // ---------------- sign-in ----------------
  function loadGis(clientId) {
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = function () {
      google.accounts.id.initialize({ client_id: clientId, callback: onCredential, ux_mode: 'popup', auto_select: false });
      google.accounts.id.renderButton($('gbtn'), {
        theme: document.documentElement.getAttribute('data-theme') === 'night' ? 'filled_black' : 'outline',
        size: 'large', shape: 'rectangular', text: 'signin_with', logo_alignment: 'left'
      });
    };
    s.onerror = function () { msg('Couldn’t load Google sign-in. Check your connection or ad blocker.', 'bad'); };
    document.head.appendChild(s);
  }
  function msg(text, cls) { var m = $('signinMsg'); m.textContent = text || ''; m.className = 'msg' + (cls ? ' ' + cls : ''); }

  function onCredential(resp) {
    msg('Checking…');
    api({ action: 'login', credential: resp.credential })
      .then(function (j) { msg(''); enter(j.admin); })
      .catch(function (e) { msg(e.message, 'bad'); });
  }

  function enter(email) {
    $('whoEmail').textContent = email; $('who').hidden = false;
    show('dash'); search(''); $('q').focus();
  }

  $('logout').onclick = function () {
    api({ action: 'logout' }).finally(function () {
      try { google.accounts.id.disableAutoSelect(); } catch (e) {}
      location.reload();
    });
  };

  // ---------------- players ----------------
  var searchT, seq = 0;
  $('q').addEventListener('input', function () {
    clearTimeout(searchT);
    var v = this.value;
    searchT = setTimeout(function () { search(v); }, 220);
  });

  function onAuthError(e) {
    if (e.status === 401) { $('who').hidden = true; show('signin'); msg('Your admin session ended. Sign in again.', 'bad'); return true; }
    toast(e.message); return false;
  }

  function search(q) {
    var my = ++seq;
    api({ action: 'users', q: q }).then(function (j) {
      if (my !== seq) return; // a newer search is in flight
      $('count').textContent = j.users.length + (q ? ' match' + (j.users.length === 1 ? '' : 'es') : '') + ' · ' + j.total + ' total';
      var ul = $('users');
      if (!j.users.length) { ul.innerHTML = '<li class="empty-state">' + (q ? 'No players match “' + esc(q) + '”.' : 'No players yet.') + '</li>'; return; }
      ul.innerHTML = j.users.map(function (u) {
        return '<li data-id="' + esc(u.id) + '" data-email="' + esc(u.email) + '">' +
          '<div class="row"><div><div class="em">' + esc(u.email) + '</div>' +
          '<div class="meta"><span><b>' + esc(u.name) + '</b></span><span>Joined ' + esc(when(u.created_at)) + '</span>' +
          '<span>Last sign-in ' + esc(when(u.last_sign_in)) + '</span><span>' + u.battles + ' battles</span>' +
          '<span>' + u.sessions + ' active session' + (u.sessions === 1 ? '' : 's') + '</span></div></div>' +
          '<button data-act="open">Set password</button></div></li>';
      }).join('');
    }).catch(onAuthError);
  }

  $('users').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var li = b.closest('li'); var act = b.getAttribute('data-act');
    if (act === 'open') return openReset(li, b);
    if (act === 'gen') { var inp = li.querySelector('input'); inp.value = genPassword(); inp.type = 'text'; inp.focus(); inp.select(); return; }
    if (act === 'copy') { copy(li.querySelector('input').value); return; }
    if (act === 'cancel') { closeReset(li); return; }
    if (act === 'save') return save(li, b);
  });

  function openReset(li, btn) {
    var open = document.querySelector('.reset'); if (open) closeReset(open.closest('li'));
    btn.hidden = true;
    var box = document.createElement('div'); box.className = 'reset';
    box.innerHTML =
      '<div class="line"><input class="mono" type="text" minlength="6" maxlength="200" autocomplete="new-password" spellcheck="false" ' +
      'placeholder="New password (6+ characters)" aria-label="New password for ' + esc(li.getAttribute('data-email')) + '">' +
      '<button data-act="gen" type="button">Generate</button><button data-act="copy" type="button">Copy</button></div>' +
      '<div class="line" style="margin-top:10px"><button class="primary" data-act="save" type="button">Save password</button>' +
      '<button class="ghost" data-act="cancel" type="button">Cancel</button></div>' +
      '<small>Saving signs this player out everywhere. Send them the new password yourself; nothing is emailed.</small>';
    li.appendChild(box);
    box.querySelector('input').focus();
  }
  function closeReset(li) {
    var box = li.querySelector('.reset'); if (box) box.remove();
    var b = li.querySelector('[data-act="open"]'); if (b) b.hidden = false;
  }

  function copy(text) {
    if (!text) return toast('Nothing to copy yet');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(function () { toast('Copied'); }, function () { toast('Copy failed: select and copy it by hand'); });
  }

  function save(li, btn) {
    var pw = li.querySelector('input').value;
    var email = li.getAttribute('data-email');
    if (pw.length < 6) return toast('Password needs at least 6 characters');
    if (!confirm('Set a new password for ' + email + '? They will be signed out on every device.')) return;
    btn.disabled = true;
    api({ action: 'setPassword', userId: li.getAttribute('data-id'), password: pw }).then(function (j) {
      toast('Password updated for ' + j.email + (j.sessionsEnded ? ' · signed out of ' + j.sessionsEnded + ' session' + (j.sessionsEnded === 1 ? '' : 's') : ''));
      closeReset(li);
      search($('q').value);
      if ($('auditBox').open) loadAudit();
    }).catch(function (e) { btn.disabled = false; onAuthError(e); });
  }

  // ---------------- audit ----------------
  $('auditBox').addEventListener('toggle', function () { if (this.open) loadAudit(); });
  var LABELS = { login: 'Signed in', login_denied: 'Sign-in refused', set_password: 'Set password' };
  function loadAudit() {
    api({ action: 'audit' }).then(function (j) {
      $('audit').innerHTML = j.rows.length ? j.rows.map(function (r) {
        return '<tr><td>' + esc(when(r.at)) + '</td><td>' + esc(r.admin_email) + '</td><td>' + esc(LABELS[r.action] || r.action) +
          '</td><td>' + esc(r.target_email || '') + '</td><td>' + esc(r.ip || '') + '</td></tr>';
      }).join('') : '<tr><td colspan="5">Nothing yet.</td></tr>';
    }).catch(onAuthError);
  }

  // ---------------- boot ----------------
  api().then(function (j) {
    if (!j.configured) return show('unconfigured');
    if (j.admin) return enter(j.admin);
    show('signin'); loadGis(j.clientId);
  }).catch(function (e) {
    show('signin'); msg('Couldn’t reach the server: ' + e.message, 'bad');
  });
})();
