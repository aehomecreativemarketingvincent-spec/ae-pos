/* =============================================
   AE HOME POS SYSTEM - app.js
   ============================================= */

// ─── CONFIG ───────────────────────────────────
const GAS_URL = "https://script.google.com/macros/s/AKfycbyV3mAGgpQxiKDFmm5Jq7FGs4ah42r2Yb0c_StXQsftuwp5QmcjTacELHFoB_LIYXM8/exec";

// ─── SAFE LOCALSTORAGE HELPERS ───────────────
function lsGet(key, fallback) {
  if (fallback === undefined) fallback = null;
  try {
    var v = localStorage.getItem(key);
    if (v === null || v === undefined) return fallback;
    return JSON.parse(v);
  } catch (e) { return fallback; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { console.warn('[POS] localStorage full, cannot save key:', key); return false; }
}

function lsDel(key) {
  try { localStorage.removeItem(key); } catch (e) {}
}



// ─── GLOBAL ERROR HANDLERS ───────────────────
window.onerror = function(msg, src, line, col, err) {
  // Silently log — don't alert users in production
  console.error('[POS Error]', msg, 'at', src + ':' + line + ':' + col, err || '');
  return false; // allow default browser handling
};

window.addEventListener('unhandledrejection', function(e) {
  console.error('[POS UnhandledPromise]', e.reason);
  // Prevent silent failures from crashing the app
  e.preventDefault();
});

// ─── STATE ────────────────────────────────────
let currentUser = null; // { id, name, role, username }
let currentPage = 'dashboard';
let cart = [];
let activeUsers = {};   // { sessionId: { name, role, loginTime } }
let mySessionId = null;
let authToken = null;      // server-issued session token (sent with every request)
let _authErrorShown = false;

// ─── ROLE CONFIG ──────────────────────────────
const ROLE_NAV = {
  admin: [
    { id: 'dashboard',   icon: '', label: 'Dashboard' },
    { id: 'pos',         icon: '', label: 'Point of Sale' },
    { id: 'inventory',   icon: '', label: 'Inventory' },
    { id: 'finance',     icon: '', label: 'Finance' },
    { id: 'cashiers',    icon: '', label: 'Users' },
    { id: 'receipts',    icon: '', label: 'Receipts' },
    { id: 'summary',     icon: '', label: 'Sales Summary' },
    { id: 'logs',        icon: '', label: 'Analytics' },
    { id: 'salesExport',    icon: '', label: 'Sales Export' },
    { id: 'wholesalers',    icon: '', label: 'Wholesalers' },
    { id: 'inventoryAudit', icon: '', label: 'Inventory Audit' },
    { id: 'priceChecker',   icon: '', label: 'Price Checker' },
    { id: 'ihAdmin',        icon: '', label: 'In-House Installment' },
    { id: 'attAdmin',       icon: '', label: 'Attendance' },
    { id: 'incentives',     icon: '', label: 'Incentives' },
  ],
  cashier: [
    { id: 'pos',         icon: '', label: 'Point of Sale' },
    { id: 'summary',     icon: '', label: 'Sales Summary' },
    { id: 'receipts',    icon: '', label: 'Receipts' },
    { id: 'wholesalers', icon: '', label: 'Wholesalers' },
    { id: 'incentives',  icon: '', label: 'Incentives' },
  ],
  clerk: [
    { id: 'inventory',   icon: '', label: 'Inventory' },
    { id: 'summary',     icon: '', label: 'Sales Summary' },
    { id: 'pos',         icon: '', label: 'Point of Sale' },
    { id: 'logs',        icon: '', label: 'Analytics' },
    { id: 'salesExport',    icon: '', label: 'Sales Export' },
    { id: 'wholesalers',    icon: '', label: 'Wholesalers' },
    { id: 'inventoryAudit', icon: '', label: 'Inventory Audit' },
    { id: 'priceChecker',   icon: '', label: 'Price Checker' },
    { id: 'incentives',     icon: '', label: 'Incentives' },
    { id: 'ihAdmin',    icon: '', label: 'In-House Installment' },
  ],
  agent: [
    { id: 'incentives', icon: '', label: 'Incentives' },
  ],
  verifier: [
    { id: 'incentives', icon: '', label: 'Incentives' },
  ],
  employee: [
    { id: 'ihMy',       icon: '', label: 'Installment Application' },
  ],
  attstaff: [
    { id: 'attMy',      icon: '', label: 'Bundy Clock' },
  ],
  viewer: [
    { id: 'dashboard', icon: '', label: 'Dashboard' },
    { id: 'receipts',  icon: '', label: 'Receipts' },
  ]
};


// ─── DATE HELPERS ────────────────────────────
function parseDate(val, fallbackTxId) {
  if (!val && !fallbackTxId) return null;
  const s = String(val || '').trim();

  if (s) {
    // ISO string — most common from GAS
    let d = new Date(s);
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d;

    // M/D/YYYY or M/D/YYYY H:MM:SS (Sheets locale format)
    const parts = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (parts) {
      return new Date(
        parseInt(parts[3]), parseInt(parts[1]) - 1, parseInt(parts[2]),
        parseInt(parts[4] || 0), parseInt(parts[5] || 0), parseInt(parts[6] || 0)
      );
    }

    // "Thu Jun 19 2026 09:23:45 GMT+0800 (PST)" — GAS locale string fallback
    d = new Date(s.replace(/\s*\(.*\)$/, ''));
    if (!isNaN(d.getTime()) && d.getFullYear() > 2000) return d;
  }

  // Last resort: extract timestamp from TX/SI number (e.g. TX1781944845247)
  // These are Date.now() values embedded in the ID
  if (fallbackTxId) {
    const m = String(fallbackTxId).match(/(\d{13,})/);
    if (m) {
      const ts = parseInt(m[1]);
      if (ts > 1000000000000) {
        const d2 = new Date(ts);
        if (!isNaN(d2.getTime()) && d2.getFullYear() > 2000) return d2;
      }
    }
  }

  return null;
}

function localDateStr(d) {
  const dt = (d instanceof Date) ? d : parseDate(d);
  if (!dt || isNaN(dt.getTime())) return '';
  // Use LOCAL time methods — correct for PH (UTC+8) regardless of how date was parsed
  const y  = dt.getFullYear();
  const m  = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Safe date formatter — never returns "Invalid Date".
 * Uses parseDate() for robustness, returns fallback string if date is invalid.
 */
function safeFormatDate(val, options, fallback = 'N/A') {
  if (!val) return fallback;
  const d = val instanceof Date ? val : parseDate(val);
  if (!d || isNaN(d.getTime())) return fallback;
  try {
    return d.toLocaleString('en-PH', options);
  } catch(e) {
    return fallback;
  }
}

function safeFormatDateOnly(val, fallback = 'N/A') {
  return safeFormatDate(val, { dateStyle: 'medium' }, fallback);
}

function safeFormatDateTime(val, fallback = 'N/A') {
  return safeFormatDate(val, { dateStyle: 'short', timeStyle: 'short' }, fallback);
}

function safeFormatDateLong(val, fallback = 'N/A') {
  return safeFormatDate(val, { dateStyle: 'long', timeStyle: 'short' }, fallback);
}

/** Returns start (00:00:00) and end (23:59:59.999) of a local calendar day */
function dayRange(date) {
  const d   = date instanceof Date ? date : new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { start, end };
}

function formatPHP(amount) {
  return '₱' + parseFloat(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 });
}

// ─── INIT ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  loadCartFromStorage();
  const saved = lsGet('ae_session', null);
  const savedToken = lsGet('ae_token', null);
  if (saved && savedToken) {
    try {
      currentUser = saved;
      // Restore the server-issued token so requests stay authorised after refresh
      authToken   = savedToken;
      mySessionId = savedToken;
      // Show the app screen (previously only initApp() ran, leaving the login screen visible)
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('loginScreen').classList.remove('active');
      document.getElementById('appScreen').classList.remove('hidden');
      initApp();
      startSessionPoller();
    } catch(e) { currentUser = null; showLogin(); }
  } else {
    lsDel('ae_session'); lsDel('ae_session_id'); lsDel('ae_token');
    showLogin();
  }
  registerSW();
});

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(reg => {
      // Check for SW updates on page focus (catches deployments)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      }, { once: false });
    })
    .catch(e => console.warn('[POS] SW registration failed:', e.message));
}

let _clockInterval = null;
function startClock() {
  if (_clockInterval) return; // prevent duplicate intervals on re-init
  const tick = () => {
    const el = document.getElementById('liveClock');
    if (el) el.textContent = new Date().toLocaleString('en-PH', {
      hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short', month: 'short', day: 'numeric'
    });
  };
  tick();
  _clockInterval = setInterval(tick, 1000);
}

// ─── LOGIN ────────────────────────────────────
function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginScreen').classList.add('active');
  document.getElementById('appScreen').classList.add('hidden');
}

async function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value.trim();
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');
  if (!u || !p) { showLoginErr('Please enter username and password.'); return; }

  showLoginErr('Checking credentials...');
  try {
    const res = await gasRequest({ action: 'login', username: u, password: p, device: navigator.userAgent.substring(0, 80) });
    if (res.success && res.token) {
      currentUser = { id: res.id, name: res.name, role: res.role, username: u, branch: res.branch || '' };
      finishLogin(res.token);
    } else {
      showLoginErr(res.message || 'Invalid username or password.');
    }
  } catch(e) {
    showLoginErr('Connection error. Check GAS URL or network.');
  }
}

// ── SALES AGENT SELF-REGISTRATION ────────────────────────
function showRegisterPanel() {
  const lc = document.querySelector('.login-card');
  const rp = document.getElementById('registerPanel');
  if (lc) lc.style.display = 'none';
  if (rp) rp.style.display = 'block';
  document.getElementById('regName')?.focus();
  // Clear fields and message
  ['regName','regUser','regPass','regPass2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  setRegMsg('','');
}

function showLoginPanel() {
  const lc = document.querySelector('.login-card');
  const rp = document.getElementById('registerPanel');
  if (lc) lc.style.display = 'block';
  if (rp) rp.style.display = 'none';
  setRegMsg('','');
}

function setRegMsg(msg, type) {
  const el = document.getElementById('regMsg');
  if (!el) return;
  el.textContent = msg;
  el.style.color = type === 'error' ? 'var(--red,#ef4444)'
                 : type === 'ok'    ? 'var(--green,#059669)'
                 : 'var(--text3,#6b7280)';
}

async function doRegister() {
  const name  = document.getElementById('regName')?.value.trim();
  const user  = document.getElementById('regUser')?.value.trim().toLowerCase();
  const pass  = document.getElementById('regPass')?.value;
  const pass2 = document.getElementById('regPass2')?.value;

  // Validation
  if (!name)              { setRegMsg('Full name is required.','error'); return; }
  if (!user)              { setRegMsg('Username is required.','error'); return; }
  if (user.length < 3)    { setRegMsg('Username must be at least 3 characters.','error'); return; }
  if (!/^[a-z0-9._]+$/.test(user)) { setRegMsg('Username: letters, numbers, dots, underscores only.','error'); return; }
  if (!pass)              { setRegMsg('Password is required.','error'); return; }
  if (pass.length < 6)    { setRegMsg('Password must be at least 6 characters.','error'); return; }
  if (pass !== pass2)     { setRegMsg('Passwords do not match.','error'); return; }
  const branchSel = document.getElementById('regBranch')?.value || '';
  if (!branchSel)         { setRegMsg('Please select your branch.','error'); return; }

  setRegMsg('Creating account...','');
  const btn = document.querySelector('#registerPanel .btn-login');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

  try {
    const branch = branchSel;
    const res = await gasPost({
      action:   'registerAgent',
      name:     name,
      username: user,
      password: pass,
      branch:   branch,
    });

    if (res.success) {
      setRegMsg('Account created! You can now sign in.', 'ok');
      if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
      // Auto-fill login and switch back after 1.5s
      setTimeout(() => {
        showLoginPanel();
        const lu = document.getElementById('loginUser');
        if (lu) lu.value = user;
        document.getElementById('loginPass')?.focus();
      }, 1500);
    } else {
      setRegMsg(res.message || 'Error creating account.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
    }
  } catch(e) {
    setRegMsg('Network error. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
  }
}

function showLoginErr(msg) {
  const el = document.getElementById('loginError');
  el.removeAttribute('style'); // clear amber "kicked" styling from a previous message
 el.textContent = msg;
  el.classList.remove('hidden');
}

async function enterViewerMode() {
  showLoginErr('Opening viewer mode...');
  try {
    const res = await gasRequest({ action: 'loginViewer' });
    if (res.success && res.token) {
      currentUser = { id: 'viewer', name: 'Viewer', role: 'viewer', username: 'viewer' };
      finishLogin(res.token);
    } else {
      showLoginErr(res.message || 'Could not open viewer mode.');
    }
  } catch(e) {
    showLoginErr('Connection error. Check GAS URL or network.');
  }
}

function finishLogin(token) {
  authToken   = token;
  mySessionId = token;
  _authErrorShown = false;
  lsSet('ae_session', currentUser);
  lsSet('ae_token', token);
  lsDel('ae_session_id');
  trackActiveUser(true);
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('active');
  document.getElementById('appScreen').classList.remove('hidden');
  initApp();
  // Start session polling — check every 15 seconds if session is still valid
  startSessionPoller();
}

function doLogout(showConfirm = true) {
  if (showConfirm && !confirm('Are you sure you want to logout?')) return;
  stopSessionPoller();
  trackActiveUser(false);
  // Unregister session from GAS
  if (authToken) {
    gasPost({ action: 'logout' }).catch(() => {});
  }
  currentUser = null;
  mySessionId = null;
  authToken = null;
  lsDel('ae_session'); lsDel('ae_session_id'); lsDel('ae_token');
  cart = [];
  saveCartToStorage();
  document.getElementById('appScreen').classList.add('hidden');
  showLogin();
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginError').classList.add('hidden');
}

// ── SESSION POLLER ─────────────────────────────
let sessionPollInterval = null;

function startSessionPoller() {
  stopSessionPoller();
  if (!currentUser || currentUser.role === 'viewer') return;
  inc_notifyStart();
  sessionPollInterval = setInterval(async () => {
    if (!currentUser || !mySessionId) return;
    if (document.hidden) return;            // background tab: no need to ask the server
    try {
      const res = await gasRequest({
        action: 'checkSession',
        userId: currentUser.id || currentUser.username,
        sessionId: authToken
      });
      if (res.valid === false) {
        // Session was invalidated — another device logged in!
        stopSessionPoller();
        showSessionKicked();
      }
    } catch(e) {} // silent fail — don't logout on network error
  }, 90000 + Math.floor(Math.random() * 20000)); // every ~90s (was 15s: too many requests when many users are online)
}


// ── NEW-ACTIVITY SOUND (incentive claims) ─────────────────────
// While the app is open, it checks today's claims every ~45s (existing read-only
// inc_getClaims, no server change):
//   admin / clerk / verifier -> chime when a NEW Pending claim arrives
//   agent / cashier          -> chime when one of THEIR claims is Verified / Rejected / Voided
// The sound is generated by the browser (no audio file). Each user can switch it off with the
// "Sound" button in the top bar (remembered on that device). It cannot ring while the app is
// closed - that would need a push server.
let inc_notifyTimer = null;
let inc_notifyState = null;      // { user, date, pending:Set, status:{} } - first check only sets the baseline
let inc_notifyCtx   = null;
const INC_NOTIFY_STAFF = ['admin', 'clerk', 'verifier'];
const INC_NOTIFY_AGENT = ['cashier', 'agent'];

function inc_notifySoundOn() { return lsGet('ae_notify_sound', true) !== false; }

function inc_notifyUnlock() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!inc_notifyCtx) inc_notifyCtx = new AC();
    if (inc_notifyCtx.state === 'suspended') inc_notifyCtx.resume();
  } catch(e) {}
}

function inc_notifyPlay() {
  if (!inc_notifySoundOn()) return;
  try {
    inc_notifyUnlock();
    const ctx = inc_notifyCtx;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;
    [[880, 0], [1175, 0.18], [1568, 0.36]].forEach(function(n) {   // three rising notes
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = n[0];
      g.gain.setValueAtTime(0.0001, t0 + n[1]);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + n[1] + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1] + 0.32);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0 + n[1]); o.stop(t0 + n[1] + 0.35);
    });
  } catch(e) {}
}

// Phone-style banner that slides down from the top: who sent it, what it is, tap to open Incentives
function inc_banner(title, body, kind, ms, page) {
  try {
    let host = document.getElementById('incBannerHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'incBannerHost';
      host.style.cssText = 'position:fixed;top:8px;left:0;right:0;z-index:100000;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;padding:0 10px';
      document.body.appendChild(host);
    }
    while (host.children.length >= 3) host.removeChild(host.firstChild);
    const color = kind === 'success' ? '#2e7d32' : kind === 'warning' ? '#ef6c00' : '#1565c0';
    const el = document.createElement('div');
    el.style.cssText = 'pointer-events:auto;cursor:pointer;width:100%;max-width:420px;background:#fff;color:#222;border-left:5px solid ' + color +
      ';border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.28);padding:12px 14px;transform:translateY(-130%);opacity:0;transition:transform .3s ease,opacity .3s ease;font-family:inherit';
    const t = document.createElement('div');
    t.style.cssText = 'font-weight:700;font-size:14px;margin-bottom:2px';
    t.textContent = title;
    const b = document.createElement('div');
    b.style.cssText = 'font-size:13px;line-height:1.35;word-break:break-word';
    b.textContent = body;
    el.appendChild(t); el.appendChild(b);
    const close = function() {
      el.style.transform = 'translateY(-130%)'; el.style.opacity = '0';
      setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 350);
    };
    el.onclick = function() {
      close();
      try { if (typeof navigateTo === 'function') navigateTo(page || 'incentives'); } catch (e) {}
    };
    host.appendChild(el);
    requestAnimationFrame(function() { requestAnimationFrame(function() { el.style.transform = 'translateY(0)'; el.style.opacity = '1'; }); });
    setTimeout(close, ms || 8000);
  } catch (e) {}
}

async function inc_notifyCheck() {
  if (!currentUser) return;
  const role  = currentUser.role;
  const staff = INC_NOTIFY_STAFF.indexOf(role) >= 0;
  const agent = INC_NOTIFY_AGENT.indexOf(role) >= 0;
  if (!staff && !agent) return;
  if (document.hidden && !staff) return;          // agents only check while the app is in view
  const today = localDateStr(new Date());
  const uid   = String(currentUser.id || currentUser.username || '');
  const params = { action: 'inc_getClaims', date: today };
  if (agent) params.employeeId = uid;
  let res;
  try { res = await gasRequest(params); } catch(e) { return; }
  if (!res || !res.success || !currentUser) return;
  const claims = res.data || [];
  let st = inc_notifyState;
  const baseline = !st || st.date !== today || st.user !== uid;
  if (baseline) st = inc_notifyState = { user: uid, date: today, pending: new Set(), status: {} };

  if (staff) {
    const pending = claims.filter(function(c) { return c.status === 'Pending'; });
    const fresh   = baseline ? [] : pending.filter(function(c) { return !st.pending.has(c.id); });
    st.pending = new Set(pending.map(function(c) { return c.id; }));
    if (fresh.length) {
      inc_notifyPlay();
      if (fresh.length === 1) {
        inc_banner(fresh[0].employeeName || 'An agent', 'New incentive claim (OR ' + (fresh[0].invoiceNo || '') + ') waiting for verification', 'info', 9000);
      } else {
        fresh.slice(0, 3).forEach(function(c) {
          inc_banner(c.employeeName || 'An agent', 'New incentive claim (OR ' + (c.invoiceNo || '') + ')', 'info', 9000);
        });
        if (fresh.length > 3) inc_banner('Incentive Tracker', (fresh.length - 3) + ' more new claims waiting for verification', 'info', 9000);
      }
    }
  } else {
    const changed = [];
    claims.forEach(function(c) {
      const prev = st.status[c.id];
      if (!baseline && prev !== undefined && prev !== c.status && c.status !== 'Pending') changed.push(c);
      st.status[c.id] = c.status;
    });
    if (changed.length) {
      inc_notifyPlay();
      if (changed.length === 1) {
        const c = changed[0];
        const why = c.status === 'Rejected' ? c.rejectionReason : c.status === 'Voided' ? c.voidReason : '';
        const by = c.status === 'Verified' ? (c.verifiedBy || c.verifier) : c.status === 'Rejected' ? (c.rejectedBy || c.verifiedBy || c.verifier) : (c.voidedBy || '');
        inc_banner(by || 'Incentive Tracker', 'Your claim (OR ' + (c.invoiceNo || '') + ') was ' + c.status + (why ? ': ' + why : ''),
              c.status === 'Verified' ? 'success' : 'warning', 10000);
      } else {
        inc_banner('Incentive Tracker', changed.length + ' of your claims were updated. Tap to open Incentives.', 'info', 9000);
      }
    }
  }
}

function inc_notifyRefreshToggle() {
  const b = document.getElementById('notifyToggle');
  if (!b) return;
  b.textContent = inc_notifySoundOn() ? 'Sound: On' : 'Sound: Off';
  b.title = 'Play a sound when there is a new incentive claim / update';
}
function inc_notifyToggle() {
  lsSet('ae_notify_sound', !inc_notifySoundOn());
  inc_notifyRefreshToggle();
  if (inc_notifySoundOn()) { inc_notifyUnlock(); inc_notifyPlay(); }   // test chime + unlocks audio
}
function inc_notifyMountToggle() {
  if (document.getElementById('notifyToggle')) { inc_notifyRefreshToggle(); return; }
  const right = document.querySelector('.topbar-right');
  if (!right) return;
  const b = document.createElement('button');
  b.id = 'notifyToggle'; b.type = 'button'; b.className = 'btn btn-ghost btn-sm'; b.style.marginRight = '8px';
  b.onclick = inc_notifyToggle;
  right.insertBefore(b, right.firstChild);
  inc_notifyRefreshToggle();
}

function inc_notifyStart() {
  inc_notifyStop();
  if (!currentUser) return;
  const role = currentUser.role;
  if (INC_NOTIFY_STAFF.indexOf(role) < 0 && INC_NOTIFY_AGENT.indexOf(role) < 0) return;
  inc_notifyMountToggle();
  document.addEventListener('pointerdown', inc_notifyUnlock, { once: true });   // browsers allow sound only after a tap/click
  inc_notifyCheck();                                                            // sets the baseline right away
  inc_notifyTimer = setInterval(inc_notifyCheck, 45000 + Math.floor(Math.random() * 5000));
}
function inc_notifyStop() {
  if (inc_notifyTimer) { clearInterval(inc_notifyTimer); inc_notifyTimer = null; }
  inc_notifyState = null;
  const b = document.getElementById('notifyToggle');
  if (b) b.remove();
}
document.addEventListener('visibilitychange', function() {
  if (!document.hidden && inc_notifyTimer) inc_notifyCheck();    // check as soon as the app comes back into view
});

function stopSessionPoller() {
  inc_notifyStop();
  if (sessionPollInterval) {
    clearInterval(sessionPollInterval);
    sessionPollInterval = null;
  }
}

function showSessionKicked(message) {
  // Force logout with notification
  stopSessionPoller();
  trackActiveUser(false);
  currentUser = null;
  mySessionId = null;
  authToken = null;
  lsDel('ae_session'); lsDel('ae_session_id'); lsDel('ae_token');
  cart = [];
  saveCartToStorage();
  document.getElementById('appScreen').classList.add('hidden');
  showLogin();
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  // Show kicked message
  const errEl = document.getElementById('loginError');
  if (errEl) {
    errEl.textContent = message || 'You were logged out because this account was used on another device.';
    errEl.classList.remove('hidden');
    errEl.style.background = '#fff7e0';
    errEl.style.borderColor = '#f59e0b';
    errEl.style.color = '#92400e';
  }
}

// ─── ACTIVE USER TRACKING ─────────────────────
function trackActiveUser(add) {
  var users = lsGet('ae_active_users', {});
  if (add && currentUser) {
    users[mySessionId] = {
      name: currentUser.name,
      role: currentUser.role,
      loginTime: new Date().toISOString()
    };
  } else if (mySessionId) {
    delete users[mySessionId];
  }
  lsSet('ae_active_users', users);
}

function showActiveUsers() {
  const users = lsGet('ae_active_users', {});
  const panel = document.getElementById('activeUsersPanel');
  const list  = document.getElementById('activeUsersList');
  if (!panel || !list) return;
  list.innerHTML = '';
  const entries = Object.entries(users);
  if (!entries.length) {
    const p = document.createElement('p');
    p.className   = 'text-muted text-center mt-10';
    p.textContent = 'No active users tracked.';
    list.appendChild(p);
  } else {
    entries.forEach(([, u]) => {
      const item = document.createElement('div');
      item.className = 'aup-item';
      const dot  = document.createElement('div');
      dot.className = 'aup-dot';
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className   = 'aup-name';
      name.textContent = u.name || 'Unknown';
      const role = document.createElement('div');
      role.className   = 'aup-role';
      role.textContent = u.role || '';
      info.appendChild(name);
      info.appendChild(role);
      const time = document.createElement('div');
      time.className   = 'aup-time';
      time.textContent = u.loginTime ? new Date(u.loginTime).toLocaleTimeString('en-PH', { hour12: true }) : '';
      item.appendChild(dot);
      item.appendChild(info);
      item.appendChild(time);
      list.appendChild(item);
    });
  }
  panel.classList.remove('hidden');
}

function hideActiveUsers() {
  document.getElementById('activeUsersPanel').classList.add('hidden');
}

// ─── APP INIT ─────────────────────────────────
function initApp() {
  const role = currentUser.role;

  // User badge
 document.getElementById('userAvatar').textContent = currentUser.name.charAt(0).toUpperCase();
 document.getElementById('userNameDisplay').textContent = currentUser.name;
 document.getElementById('userRoleDisplay').textContent = role;

  // Build nav
  buildNav(role);

  // Default page
  const defaultPages = { admin: 'dashboard', cashier: 'pos', clerk: 'inventory', viewer: 'dashboard', agent: 'incentives', verifier: 'incentives', employee: 'ihMy', attstaff: 'attMy' };
  navigateTo(defaultPages[role] || 'dashboard');
}

function buildNav(role) {
  const items = ROLE_NAV[role] || ROLE_NAV.viewer;
  const nav = document.getElementById('navMenu');
 nav.innerHTML = items.map(it =>`
    <button class="nav-item" id="nav_${it.id}" onclick="navigateTo('${it.id}')">
      
      <span>${it.label}</span>
    </button>
  `).join('');
}

function navigateTo(page) {
  currentPage = page;
  // highlight nav
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const ni = document.getElementById('nav_' + page);
  if (ni) ni.classList.add('active');
  // title
  const titles = {
    dashboard: 'Dashboard', pos: 'Point of Sale',
    inventory: 'Inventory Management', finance: 'Finance',
    cashiers: 'User Management', receipts: 'Receipts',
    summary: 'Sales Summary', logs: 'Analytics & Insights',
    salesExport: 'Sales Export',
    wholesalers: 'Wholesalers Information',
    inventoryAudit: 'Inventory Audit',
    priceChecker:   'Price Checker',
    ihAdmin:        'In-House Installment',
    attAdmin:       'Attendance',
    attMy:          'Bundy Clock',
    ihMy:           'Installment Application',
    incentives:     'Incentive Tracker'
  };
 document.getElementById('topbarTitle').textContent = titles[page] || page;
  // render
  const pc = document.getElementById('pageContent');
 pc.innerHTML = `<div class="loading-spinner"><div class="spinner"></div> Loading...</div>`;
  setTimeout(() => renderPage(page), 150);
  // close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sideOverlay')?.classList.remove('show');
}

function toggleSidebar() {
  const s = document.getElementById('sidebar');
  s.classList.toggle('open');
  let ov = document.getElementById('sideOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'sideOverlay';
    ov.className = 'sidebar-overlay';
    ov.onclick = () => { s.classList.remove('open'); ov.classList.remove('show'); };
    document.body.appendChild(ov);
  }
  ov.classList.toggle('show');
}

// ─── PAGE RENDERER ────────────────────────────
function renderPage(page) {
  const pages = {
    dashboard: renderDashboard,
    pos: renderPOS,
    inventory: renderInventory,
    finance: renderFinance,
    cashiers: renderCashiers,
    receipts: renderReceipts,
    summary: renderSummary,
    logs: renderLogs,
    salesExport: renderSalesExport,
    wholesalers: renderWholesalers,
    inventoryAudit: audit_renderPage,
    priceChecker:   pcx_renderPage,
    ihAdmin:        ih_renderAdmin,
    attAdmin:       att_renderAdmin,
    attMy:          att_renderMy,
    ihMy:           ih_renderMy,
    incentives:     inc_renderPage,
  };
  if (pages[page]) pages[page]();
  else {
    const pc = document.getElementById('pageContent');
    if (pc) pc.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Page not available.</div></div>';
  }
}

// ─── AUTH ERROR HANDLING ─────────────────────
// Server says the token is missing / expired: return to the login screen once.
function handleAuthError(res) {
  if (res && res.authError && currentUser && !_authErrorShown) {
    _authErrorShown = true;
    setTimeout(() => showSessionKicked(res.message || 'Session expired. Please log in again.'), 0);
  }
  return res;
}

// ─── GAS REQUEST ─────────────────────────────
// Read-only actions are safe to retry automatically when the server is busy / the network blips.
// Writes (gasPost) are never auto-retried, to avoid saving twice.
const GAS_READ_RE = /^(get|inc_get|inc_check|audit_get|pc_get|ih_get|att_get)/;   // not the session poller: it must never add load
async function gasRequest(params, timeoutMs = 30000) {
  const canRetry = GAS_READ_RE.test(String((params && params.action) || ''));
  let lastErr;
  for (let attempt = 0; attempt < (canRetry ? 2 : 1); attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1200 + Math.random() * 1800));   // random wait so many users do not retry at the same moment
    try {
      return await gasRequestOnce(params, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (!canRetry || (e && /timed out/i.test(e.message || ''))) break;   // timeouts are not retried
    }
  }
  throw lastErr;
}

async function gasRequestOnce(params, timeoutMs) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const full = Object.assign({}, params);
    if (authToken && full.token === undefined) full.token = authToken;
    const url  = GAS_URL + '?' + new URLSearchParams(full);
    const res  = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    const text = await res.text();
    clearTimeout(timer);
    let out;
    try { out = JSON.parse(text); }
    catch (e) { throw new Error('Invalid server response'); }
    return handleAuthError(out);
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Request timed out. Check your connection.');
    throw e;
  }
}

async function gasPost(payload, timeoutMs = 45000) {
  // GAS CORS rule: only GET with no custom headers works cross-origin.
  // POST is blocked by CORS. Solution: GET + base64 payload in URL param.
  // We check for e.parameter.data (not e.parameter.method) in doGet
  // so it works even if params survive the redirect.
  if (authToken && payload.token === undefined) payload = Object.assign({}, payload, { token: authToken });
  const json = JSON.stringify(payload);
  let encoded;
  try {
    encoded = btoa(unescape(encodeURIComponent(json)));
  } catch (e) {
    const bytes  = new TextEncoder().encode(json);
    const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
    encoded = btoa(binary);
  }
  const url   = GAS_URL + '?data=' + encodeURIComponent(encoded);
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    if (!text || !text.trim()) return { success: true };
    let out;
    try { out = JSON.parse(text); }
    catch (e) {
      // Google returns an HTML page when it is overloaded: that is NOT a successful save
      if (/^\s*</.test(text)) return { success: false, message: 'Server is busy right now. Please wait a few seconds and try again.' };
      return { success: true };
    }
    return handleAuthError(out);
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Save timed out. Please try again.');
    throw new Error('Network error: ' + e.message);
  }
}

// gasPostWithResult removed (unused)

// Safe string for use inside inline onclick='...' handlers (handles apostrophes/quotes)
function jsq(str) {
  return String(str == null ? '' : str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, ' ');
}

// ─── TOAST ────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const icons = { success: '✓', error: '✕', warning: '!', info: 'i' };
  const el    = document.createElement('div');
  el.className = 'toast ' + type;
  const iconSpan = document.createElement('span');
  iconSpan.className   = 'toast-icon';
  iconSpan.textContent = icons[type] || 'i';
  const msgSpan = document.createElement('span');
  // Decode HTML entities (e.g. &#8369;) since textContent shows them literally
  msgSpan.textContent  = String(msg || '').replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(parseInt(n, 10)); });
  el.appendChild(iconSpan);
  el.appendChild(msgSpan);
  const container = document.getElementById('toastContainer');
  if (!container) return;
  container.appendChild(el);
  // Limit toasts to prevent DOM flooding
  const allToasts = container.querySelectorAll('.toast');
  if (allToasts.length > 5) allToasts[0].remove();
  setTimeout(() => {
    el.style.opacity   = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function showLoading(msg = 'Processing...') {
  let el = document.getElementById('loadingOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'loadingOverlay';
    el.className = 'loading-overlay';
    document.body.appendChild(el);
  }
  el.innerHTML = `
    <div class="loading-overlay-box">
      <div class="loading-ring"><div></div><div></div><div></div><div></div></div>
      <div class="loading-overlay-msg">${msg}</div>
    </div>`;
  el.style.display = 'flex';
  el.style.opacity = '0';
  setTimeout(() => { el.style.opacity = '1'; el.style.transition = 'opacity 0.2s'; }, 10);
}

function hideLoading() {
  const el = document.getElementById('loadingOverlay');
  if (el) {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s';
    setTimeout(() => { el.style.display = 'none'; }, 200);
  }
}

// ─── MODAL ────────────────────────────────────
function openModal(html) {
 document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
function closeModal(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModalDirect();
}
function closeModalDirect() {
  document.getElementById('modalOverlay').classList.add('hidden');
}

// ─── RESET TEST DATA ──────────────────────────
function resetTestData() {
  if (!confirm('⚠️ This will clear your cart and cached data. Google Sheets data will NOT be deleted. Continue?')) return;
  cart = [];
  saveCartToStorage();
  lsDel('ae_receipt_gallery');
  lsDel('ae_active_users');
 toast('Test data cleared! Cart and local cache reset.', 'success');
  navigateTo('dashboard');
}

// ─── CART STORAGE ─────────────────────────────
function saveCartToStorage() {
  lsSet('ae_cart', cart);
}
function loadCartFromStorage() {
  try { cart = lsGet('ae_cart', []); } catch(e) { cart = []; }
}

// ═══════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════
async function renderDashboard() {
 document.getElementById('pageContent').innerHTML = `
    ${currentUser.role === 'admin' ? `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
<button class="btn btn-danger btn-sm" onclick="resetTestData()">️ Reset Test Data</button>
    </div>` : ''}
<div class="kpi-grid" id="kpiGrid">
      ${['Today Sales','Weekly Sales','Monthly Sales','Total Products','Total Transactions','Low Stock'].map((k,i) => `
<div class="kpi-card ${['kpi-blue','kpi-green','kpi-grad','kpi-blue','kpi-green','kpi-orange'][i]}">
<div class="kpi-label">${k}</div>
<div class="kpi-value" id="kpi_${i}">—</div>
        </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
<div class="card">
<div class="card-title">Recent Transactions</div>
 <div id="recentTx"><div class="loading-spinner"><div class="spinner"></div></div></div>
      </div>
<div class="card">
<div class="card-title">️ Low Stock Items</div>
 <div id="lowStockList"><div class="loading-spinner"><div class="spinner"></div></div></div>
      </div>
    </div>`;

  try {
    const [salesRes, productsRes] = await Promise.all([
      gasRequest({ action: 'getSales' }),
      gasRequest({ action: 'getProducts' })
    ]);
    const sales = salesRes.data || [];
    const products = productsRes.data || [];

    const now = new Date();
    const { start: dashTodayStart, end: dashTodayEnd } = dayRange(now);
    const weekAgo  = new Date(now - 7  * 86400000);
    const monthAgo = new Date(now - 30 * 86400000);

    const todaySales = sales.filter(s => { const d = parseDate(s.date, s.transactionId || s.siNumber); return d && d >= dashTodayStart && d <= dashTodayEnd; });
    const weekSales  = sales.filter(s => { const d = parseDate(s.date, s.transactionId || s.siNumber); return d && d >= weekAgo; });
    const monthSales = sales.filter(s => { const d = parseDate(s.date); return d && d >= monthAgo; });

    const sumSales = arr => arr.reduce((a, s) => a + parseFloat(s.total || 0), 0);
    const lowStock = products.filter(p => parseInt(p.qtyPcs || 0) <= 5);

 document.getElementById('kpi_0').textContent = '₱' + sumSales(todaySales).toLocaleString('en-PH', {minimumFractionDigits:2});
 document.getElementById('kpi_1').textContent = '₱' + sumSales(weekSales).toLocaleString('en-PH', {minimumFractionDigits:2});
 document.getElementById('kpi_2').textContent = '₱' + sumSales(monthSales).toLocaleString('en-PH', {minimumFractionDigits:2});
 document.getElementById('kpi_3').textContent = products.length;
 document.getElementById('kpi_4').textContent = sales.length;
 document.getElementById('kpi_5').textContent = lowStock.length;

    // Recent Tx
    const recentEl = document.getElementById('recentTx');
    if (!recentEl) return;
    const recent = [...sales].reverse().slice(0, 8);
 recentEl.innerHTML = recent.length ? `
 <div class="tbl-wrap"><table>
        <thead><tr><th>Tx#</th><th>Cashier</th><th>Total</th><th>Date</th></tr></thead>
        <tbody>${recent.map(s => `<tr>
          <td><span style="font-family:var(--font-mono);font-size:0.8rem">${s.transactionId || ''}</span></td>
          <td>${s.cashierName || ''}</td>
          <td class="text-green fw-700">₱${parseFloat(s.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
          <td class="text-muted" style="font-size:0.8rem">${safeFormatDateOnly(s.date)}</td>
        </tr>`).join('')}</tbody>
 </table></div>` : '<div class="no-data"><div class="no-data-icon"></div><div class="no-data-text">No transactions yet.</div></div>';

    const lsEl = document.getElementById('lowStockList');
    if (lsEl) lsEl.innerHTML = lowStock.length ? `
 <div class="tbl-wrap"><table>
        <thead><tr><th>Product</th><th>Qty</th></tr></thead>
        <tbody>${lowStock.map(p => `<tr>
          <td>${p.name}</td>
          <td><span class="${parseInt(p.qtyPcs||0)===0?'badge-out':'badge-low'}">${p.qtyPcs} pcs</span></td>
        </tr>`).join('')}</tbody>
 </table></div>` : '<div class="no-data"><div class="no-data-icon"></div><div class="no-data-text">All items well-stocked.</div></div>';

  } catch(e) {
 toast('Failed to load dashboard data.', 'error');
  }
}

// ═══════════════════════════════════════════════
// POS
// ═══════════════════════════════════════════════
let allProducts = [];
let searchTimeout = null;

async function renderPOS() {
 document.getElementById('pageContent').innerHTML = `
<div class="pos-layout">
<div class="pos-left">
<div class="barcode-scanner-bar" id="barcodeBar" onclick="document.getElementById('barcodeInput').focus()">
          <span class="bc-label">BARCODE</span>
          <input type="text" id="barcodeInput"
            placeholder="Scan or type barcode..."
            autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
            onkeydown="handleBarcodeKey(event,this)"
            onfocus="document.getElementById('barcodeBar').style.borderLeftColor='var(--blue)'"
            onblur="document.getElementById('barcodeBar').style.borderLeftColor=''">
          <span class="bc-status" id="bcStatus">●</span>
          <button class="bc-cam-btn" onclick="openCameraScanner()" title="Use Camera">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>
        </div>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
<div class="search-wrap" style="flex:1;margin-bottom:0">
            <span class="search-icon">🔍</span>
<input type="text" id="posSearch" placeholder="Search product name..." oninput="onPosSearch(this.value)" autocomplete="off">
 <div class="search-dropdown hidden" id="searchDropdown"></div>
          </div>
 ${currentUser.role === 'admin' ? `<button class="btn btn-ghost btn-sm" onclick="openReceiptSettings()" title="Receipt Settings">️ Receipt</button>` : ''}
        </div>
<div class="product-grid" id="productGrid">
 <div class="loading-spinner" style="grid-column:1/-1"><div class="spinner"></div> Loading products...</div>
        </div>
      </div>
<div class="pos-right">
<div class="cart-header">
          <span>🛒 Cart</span>
<button class="btn btn-ghost btn-sm" onclick="clearCart()">Clear</button>
        </div>
 <div class="cart-items" id="cartItems"></div>
<div class="cart-footer">
 <div class="cart-total-row"><span class="ct-label">Items</span><span class="ct-value" id="cartItemCount">0</span></div>
 <div class="cart-total-row"><span class="ct-label">Subtotal</span><span class="ct-value" id="cartSubtotal">₱0.00</span></div>
 <div class="cart-total-row"><span class="ct-label fw-700">TOTAL</span><span class="ct-value ct-grand" id="cartTotal">₱0.00</span></div>
          <button class="btn-checkout" id="checkoutBtn" onclick="openCheckout()" disabled>💳 CHECKOUT</button>
        </div>
      </div>
    </div>`;

  try {
    await loadProducts();
  } catch(e) {
    const grid = document.getElementById('productGrid');
    if (grid) grid.innerHTML = '<div class="no-data" style="grid-column:1/-1"><div class="no-data-icon"></div><div>Failed to load products. Check connection.</div></div>';
    toast('Could not load products. Pull to refresh.', 'error');
  }
  renderCart();
  focusBarcodeInput();
}

async function loadProducts() {
  try {
    const res = await gasRequest({ action: 'getProducts' });
    allProducts = res.data || [];
    // Build barcode lookup map for fast scanning
    buildBarcodeMap();
    renderProductGrid(allProducts);
  } catch(e) {
 document.getElementById('productGrid').innerHTML = '<div class="no-data" style="grid-column:1/-1"><div class="no-data-icon"></div><div>Failed to load products. Check GAS URL.</div></div>';
  }
}

function renderProductGrid(products) {
  const grid = document.getElementById('productGrid');
  if (!grid) return;
  if (!products.length) {
 grid.innerHTML = '<div class="no-data" style="grid-column:1/-1"><div class="no-data-icon"></div><div class="no-data-text">No products found.</div></div>';
    return;
  }
 grid.innerHTML = products.map(p =>{
    const qty = parseInt(p.qtyPcs || 0);
    const qtyPk = parseInt(p.qtyPacks || 0);
    const hasPack = parseFloat(p.pricePack || 0) > 0;
    const oos = qty <= 0 && (!hasPack || qtyPk <= 0);
    const pcImg = getProductImage(p.id);
    return `
<div class="product-card ${oos ? 'out-of-stock' : ''}">
${pcImg ? `<img src="${pcImg}" class="pc-img">` : ''}
<div class="pc-name">${p.name}</div>
 ${p.barcode ? `<div class="pc-barcode">${p.barcode}</div>` : ''}
<div class="pc-stock ${oos ? 'text-red' : qty<= 5 ? 'text-orange' : 'text-muted'}" style="margin-bottom:6px">
        ${oos ? '❌ Out of stock' : `📦 ${qty} pcs${qtyPk ? ' | '+qtyPk+' pks':''}`}
      </div>
      ${oos ? '' : `
<div class="pc-unit-btns">
 ${qty >0 ? `<button class="pc-unit-btn btn-piece" onclick="addToCart('${p.id}','piece')">
          <span class="pc-unit-label">Per Piece</span>
          <span class="pc-unit-price">₱${parseFloat(p.pricePer||0).toFixed(2)}</span>
        </button>` : ''}
 ${hasPack && qtyPk >0 ? `<button class="pc-unit-btn btn-pack" onclick="addToCart('${p.id}','pack')">
          <span class="pc-unit-label">Per Pack</span>
          <span class="pc-unit-price">₱${parseFloat(p.pricePack||0).toFixed(2)}</span>
        </button>` : ''}
      </div>`}
    </div>`;
  }).join('');
}

function handleBarcodeKey(e, input) {
  if (e.key === 'Enter') {
    e.preventDefault();
    const val = (input.value || '').trim();
    input.value = '';
    input.focus();
    if (val) processBarcodeValue(val);
  }
}

// Global keypress listener — auto-route to barcode input on POS page
document.addEventListener('keydown', function(e) {
  // Login: Enter submits (no extra listener needed at bottom)
  if (e.key === 'Enter' && document.getElementById('loginScreen')?.classList.contains('active')) {
    doLogin(); return;
  }
  // POS: any key focuses barcode input
  if (currentPage !== 'pos') return;
  const active  = document.activeElement;
  const bcInput = document.getElementById('barcodeInput');
  if (!bcInput) return;
  if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) {
    if (e.key.length === 1 || e.key === 'Enter') bcInput.focus();
  }
});


function focusBarcodeInput() {
  setTimeout(() => {
    const el = document.getElementById('barcodeInput');
    if (el) el.focus();
  }, 300);
}

// ── CAMERA BARCODE SCANNER (BarcodeDetector + ZXing fallback) ──
let cameraStream = null;
let cameraFacingMode = 'environment';
let isScanning = false;
let scanRafId = null;

async function openCameraScanner() {
  const modal = document.getElementById('cameraScannerModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  startCamera();
}

async function startCamera() {
  const video = document.getElementById('cameraFeed');
  const status = document.getElementById('cameraStatus');
  if (!video) return;
  stopCamera();

  try {
    if (status) status.textContent = 'Starting camera...';

    // Request camera — optimized for barcode scanning
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: cameraFacingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });

    video.srcObject = cameraStream;
    video.setAttribute('playsinline', true);
    await video.play();

    if (status) status.textContent = 'Point camera at barcode...';
    isScanning = true;

    // Use native BarcodeDetector if available (Android Chrome 83+, fast!)
    if ('BarcodeDetector' in window) {
      if (status) status.textContent = 'Ready (Native Scanner)';
      startNativeScanner(video, status);
    } else {
      // Load ZXing as fallback
      if (typeof ZXing === 'undefined') {
        if (status) status.textContent = 'Loading scanner...';
        try {
          await loadScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.19.1/umd/index.min.js');
        } catch(e) {
          await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
        }
      }
      if (typeof ZXing !== 'undefined') {
        if (status) status.textContent = 'Ready (ZXing Scanner)';
        startZXingStream(video, status);
      } else {
        if (status) status.textContent = 'Ready (jsQR Scanner)';
        startJsQRStream(video, status);
      }
    }
  } catch(e) {
    if (!status) return;
    if (e.name === 'NotAllowedError') status.textContent = 'Camera denied. Allow camera access in browser settings.';
    else if (e.name === 'NotFoundError') status.textContent = 'No camera found.';
    else if (e.name === 'OverconstrainedError') {
      // Retry with simpler constraints
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: cameraFacingMode } });
      video.srcObject = cameraStream;
      await video.play();
      isScanning = true;
      startNativeScanner(video, status);
    } else status.textContent = 'Camera error: ' + e.message;
  }
}

// ── NATIVE BarcodeDetector (fastest on Android Chrome) ──
async function startNativeScanner(video, status) {
  const detector = new BarcodeDetector({
    formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code','data_matrix','itf','codabar']
  });

  async function detect() {
    if (!isScanning) return;
    try {
      const barcodes = await detector.detect(video);
      if (barcodes.length > 0) {
        const val = barcodes[0].rawValue.trim();
        if (status) {
          status.textContent = 'Found: ' + val;
          status.style.color = 'var(--green)';
        }
        showScanConfirm(val);
        return;
      }
    } catch(e) {}
    scanRafId = requestAnimationFrame(detect);
  }
  detect();
}

// ── ZXing stream scanner ──
function startZXingStream(video, status) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let reader;
  try {
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
      ZXing.BarcodeFormat.QR_CODE,
    ]);
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    reader = new ZXing.BrowserMultiFormatReader(hints);
  } catch(e) { startJsQRStream(video, status); return; }

  function scan() {
    if (!isScanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      try {
        const lum = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
        const result = reader.decodeBitmap(bmp);
        if (result) {
          const val = result.getText().trim();
          if (status) {
            status.textContent = 'Found: ' + val;
            status.style.color = 'var(--green)';
          }
          showScanConfirm(val);
          return;
        }
      } catch(e) {} // NotFoundException is normal
    }
    scanRafId = requestAnimationFrame(scan);
  }
  scan();
}

// ── jsQR fallback ──
function startJsQRStream(video, status) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function scan() {
    if (!isScanning) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (typeof jsQR !== 'undefined') {
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth'
        });
        if (code && code.data) {
          const val = code.data.trim();
          if (status) {
            status.textContent = 'Found: ' + val;
            status.style.color = 'var(--green)';
          }
          showScanConfirm(val);
          return;
        }
      }
    }
    scanRafId = requestAnimationFrame(scan);
  }
  scan();
}

function stopCamera() {
  isScanning = false;
  if (scanRafId) { cancelAnimationFrame(scanRafId); scanRafId = null; }
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
  const video = document.getElementById('cameraFeed');
  if (video) video.srcObject = null;
}

function switchCamera() {
  cameraFacingMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
  startCamera();
}

function closeCameraScanner() {
  const modal = document.getElementById('cameraScannerModal');
  if (modal) modal.classList.add('hidden');
  stopCamera();
}

function showScanConfirm(val) {
  // Pause scanning while confirming
  isScanning = false;
  if (scanRafId) { cancelAnimationFrame(scanRafId); scanRafId = null; }

  const status = document.getElementById('cameraStatus');
  const confirmDiv = document.getElementById('scanConfirmDiv');

  // Find product match
  // Fast barcode lookup using prebuilt map
  const productId = barcodeMap[val] || barcodeMap[val.toLowerCase()] ||
    barcodeMap[val.replace(/^0+/, '')] || barcodeMap['name:' + val.toLowerCase()];
  const match = productId ? allProducts.find(p => p.id === productId) : null;

  if (confirmDiv) {
    if (match) {
      confirmDiv.innerHTML = `
        <div style="background:rgba(0,200,83,0.15);border:1px solid var(--green);border-radius:8px;padding:10px;margin:8px 16px;text-align:center">
          <div style="color:white;font-weight:700;font-size:0.9rem">${match.name}</div>
          <div style="color:rgba(255,255,255,0.7);font-size:0.78rem">₱${parseFloat(match.pricePer||0).toFixed(2)} • ${match.qtyPcs||0} pcs</div>
          <div style="display:flex;gap:8px;margin-top:8px;justify-content:center">
            <button class="btn btn-success btn-sm" onclick="confirmScan('${val}')"> Add to Cart</button>
            <button class="btn btn-ghost btn-sm" style="color:white;border-color:rgba(255,255,255,0.3)" onclick="resumeScanning()"> Rescan</button>
          </div>
        </div>`;
    } else {
      confirmDiv.innerHTML = `
        <div style="background:rgba(239,68,68,0.15);border:1px solid #ef4444;border-radius:8px;padding:10px;margin:8px 16px;text-align:center">
          <div style="color:#fca5a5;font-size:0.82rem">No product found for:</div>
          <div style="color:white;font-weight:700;font-family:var(--font-mono);font-size:0.85rem">${val}</div>
          <button class="btn btn-ghost btn-sm" style="color:white;border-color:rgba(255,255,255,0.3);margin-top:8px" onclick="resumeScanning()"> Try Again</button>
        </div>`;
    }
    confirmDiv.style.display = 'block';
  }
}

function confirmScan(val) {
  const confirmDiv = document.getElementById('scanConfirmDiv');
  if (confirmDiv) { confirmDiv.innerHTML = ''; confirmDiv.style.display = 'none'; }
  closeCameraScanner();
  processBarcodeValue(val);
}

function resumeScanning() {
  const confirmDiv = document.getElementById('scanConfirmDiv');
  if (confirmDiv) { confirmDiv.innerHTML = ''; confirmDiv.style.display = 'none'; }
  const status = document.getElementById('cameraStatus');
  if (status) { status.textContent = 'Point camera at barcode...'; status.style.color = ''; }
  isScanning = true;
  // Restart scan loop
  const video = document.getElementById('cameraFeed');
  if (video && video.srcObject) {
    if ('BarcodeDetector' in window) {
      startNativeScanner(video, status);
    } else if (typeof ZXing !== 'undefined') {
      startZXingStream(video, status);
    } else {
      startJsQRStream(video, status);
    }
  }
}

// Barcode lookup map for fast O(1) scanning
let barcodeMap = {};
function buildBarcodeMap() {
  barcodeMap = {};
  allProducts.forEach(p => {
    const codes = (p.barcode || '').split(',').map(b => b.trim()).filter(Boolean);
    codes.forEach(c => {
      barcodeMap[c] = p.id;
      barcodeMap[c.toLowerCase()] = p.id;
      barcodeMap[c.replace(/^0+/, '')] = p.id;
    });
    // Also map by name
    if (p.name) barcodeMap['name:' + p.name.toLowerCase()] = p.id;
  });
}

function processBarcodeValue(val) {
  if (!val || val.length < 1) return;
  const bcStatus = document.getElementById('bcStatus');
  const bar = document.getElementById('barcodeBar');

  // Normalize: trim only, preserve leading zeros
  // Try exact match first, then case-insensitive, then strip leading zeros as last resort
  // Fast barcode lookup using prebuilt map
  const productId = barcodeMap[val] || barcodeMap[val.toLowerCase()] ||
    barcodeMap[val.replace(/^0+/, '')] || barcodeMap['name:' + val.toLowerCase()];
  const match = productId ? allProducts.find(p => p.id === productId) : null;

  if (match) {
    const qty = parseInt(match.qtyPcs || 0);
    if (qty <= 0) {
      toast(match.name + ' — Out of stock!', 'error');
      if (bcStatus) { bcStatus.style.color = '#ef4444'; setTimeout(() => { bcStatus.style.color = 'var(--green)'; }, 1000); }
      return;
    }
    addToCart(match.id, 'piece');
    toast(match.name + ' added!', 'success');
    if (bcStatus) { bcStatus.style.color = 'var(--green)'; }
    if (bar) {
      bar.style.background = 'rgba(0,200,83,0.06)';
      setTimeout(() => { bar.style.background = ''; }, 500);
    }
  } else {
    toast('No product: ' + val, 'error');
    if (bcStatus) { bcStatus.style.color = '#ef4444'; setTimeout(() => { bcStatus.style.color = 'var(--green)'; }, 1200); }
  }
}


function onPosSearch(val) {
  clearTimeout(searchTimeout);
  const dd = document.getElementById('searchDropdown');
  if (!val || val.length < 2) { dd.classList.add('hidden'); renderProductGrid(allProducts); return; }
  searchTimeout = setTimeout(() => {
    const q = val.toLowerCase();
    const matched = allProducts.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q)
    );
    renderProductGrid(matched);
    if (matched.length > 0) {
 dd.innerHTML = matched.slice(0, 8).map(p =>{
        const hasPack = parseFloat(p.pricePack||0) > 0 && parseInt(p.qtyPacks||0) > 0;
 return `<div class="search-item">
          <div style="flex:1">
<div class="search-item-name">${p.name}</div>
<div class="search-item-stock">${p.qtyPcs||0} pcs${p.qtyPacks ? ' | '+p.qtyPacks+' pks' : ''}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
<button class="pc-unit-btn btn-piece" style="padding:4px 8px;font-size:0.75rem" onclick="addToCart('${p.id}','piece');document.getElementById('searchDropdown').classList.add('hidden')">
              Piece<br><b>₱${parseFloat(p.pricePer||0).toFixed(2)}</b>
            </button>
 ${hasPack ? `<button class="pc-unit-btn btn-pack" style="padding:4px 8px;font-size:0.75rem" onclick="addToCart('${p.id}','pack');document.getElementById('searchDropdown').classList.add('hidden')">
              Pack<br><b>₱${parseFloat(p.pricePack||0).toFixed(2)}</b>
            </button>` : ''}
          </div>
        </div>`;
      }).join('');
      dd.classList.remove('hidden');
    } else {
      dd.classList.add('hidden');
    }
  }, 200);
}

document.addEventListener('click', (e) => {
  const dd = document.getElementById('searchDropdown');
  if (dd && !dd.contains(e.target) && e.target.id !== 'posSearch') dd.classList.add('hidden');
});

function addToCart(productId, unit) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;
  const existing = cart.find(c => c.productId === productId && c.unit === unit);
  if (existing) {
    // Guard: never exceed available stock
    const maxQ = existing.maxQty || 9999;
    if (existing.qty >= maxQ) {
      toast(existing.name + ' — max stock reached (' + maxQ + ' available)', 'warning');
      return;
    }
    existing.qty++;
    existing.total = existing.qty * existing.price;
  } else {
    const price  = unit === 'pack' ? parseFloat(p.pricePack || 0) : parseFloat(p.pricePer || 0);
    const maxQty = unit === 'pack' ? parseInt(p.qtyPacks || 0) : parseInt(p.qtyPcs || 0);
    if (maxQty <= 0) {
      toast(p.name + ' is out of stock.', 'error');
      return;
    }
    cart.push({
      productId, unit,
      name:    p.name,
      barcode: p.barcode || '',
      price,
      qty:     1,
      total:   price,
      maxQty,
    });
  }
  saveCartToStorage();
  renderCart();
 toast(`${p.name} added to cart`, 'success');
}

function renderCart() {
  const itemsEl = document.getElementById('cartItems');
  const countEl = document.getElementById('cartItemCount');
  const subtEl = document.getElementById('cartSubtotal');
  const totalEl = document.getElementById('cartTotal');
  if (!itemsEl) return;

  if (cart.length === 0) {
 itemsEl.innerHTML = `<div class="empty-cart"><div class="empty-cart-icon"></div><div class="empty-cart-text">Cart is empty.<br>Tap a product to add.</div></div>`;
  } else {
 itemsEl.innerHTML = cart.map((item, idx) =>{
      const prod = allProducts.find(p => p.id === item.productId);
      const hasPack = prod && parseFloat(prod.pricePack||0) > 0;
      return `
<div class="cart-item">
<div class="ci-info">
<div class="ci-name">${item.name}</div>
<div class="ci-price">₱${parseFloat(item.price||0).toFixed(2)} / ${item.unit}</div>
 ${hasPack ? `<div class="ci-unit-toggle">
            <button class="${item.unit==='piece'?'active-piece':''}" onclick="switchCartUnit(${idx},'piece')">Piece ₱${parseFloat(prod.pricePer||0).toFixed(2)}</button>
            <button class="${item.unit==='pack'?'active-pack':''}" onclick="switchCartUnit(${idx},'pack')">Pack ₱${parseFloat(prod.pricePack||0).toFixed(2)}</button>
</div>` : `<div class="ci-unit">${item.unit === 'pack' ? '️ Pack' : ' Piece'}</div>`}
        </div>
<div class="ci-controls">
          <button class="ci-qty-btn" onclick="changeCartQty(${idx}, -1)">−</button>
          <input class="ci-qty-input" type="number" name="qty_${idx}" min="1" value="${item.qty}" onchange="setCartQty(${idx}, this.value)">
          <button class="ci-qty-btn" onclick="changeCartQty(${idx}, 1)">+</button>
        </div>
<div class="ci-total">₱${parseFloat(item.total||0).toFixed(2)}</div>
        <button class="ci-remove" onclick="removeFromCart(${idx})">✕</button>
      </div>`;
    }).join('');
  }

  const total = cart.reduce((s, c) => s + c.total, 0);
  const itemCount = cart.reduce((s, c) => s + c.qty, 0);
 if (countEl) countEl.textContent = itemCount;
 if (subtEl) subtEl.textContent = '₱' + total.toLocaleString('en-PH', { minimumFractionDigits: 2 });
 if (totalEl) totalEl.textContent = '₱' + total.toLocaleString('en-PH', { minimumFractionDigits: 2 });
 const btn = document.getElementById('checkoutBtn');
  if (btn) btn.disabled = cart.length === 0;
}

function switchCartUnit(idx, unit) {
  const prod = allProducts.find(p => p.id === cart[idx].productId);
  if (!prod) return;
  cart[idx].unit = unit;
  cart[idx].price = unit === 'pack' ? parseFloat(prod.pricePack||0) : parseFloat(prod.pricePer||0);
  cart[idx].total = cart[idx].qty * cart[idx].price;
  saveCartToStorage();
  renderCart();
}

function changeCartQty(idx, delta) {
  cart[idx].qty = Math.max(1, cart[idx].qty + delta);
  cart[idx].total = cart[idx].qty * cart[idx].price;
  saveCartToStorage();
  renderCart();
}

function setCartQty(idx, val) {
  const q = Math.max(1, parseInt(val) || 1);
  cart[idx].qty = q;
  cart[idx].total = q * cart[idx].price;
  saveCartToStorage();
  renderCart();
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  saveCartToStorage();
  renderCart();
}

function clearCart() {
  if (cart.length === 0) return;
  if (!confirm('Clear all items from cart?')) return;
  cart = [];
  saveCartToStorage();
  renderCart();
}

// ─── CHECKOUT ─────────────────────────────────
// ── Retail / Wholesale pricing at checkout ───────────────
// The cart itself always holds RETAIL prices (unchanged behaviour). The mode picked
// in the checkout modal only re-prices a copy of the cart at the moment of payment,
// so cancelling the modal can never leave the cart in a half-changed state.
let _checkoutPriceType = 'retail';

function ws_priceFor(item, mode) {
  if (mode !== 'wholesale') return parseFloat(item.price || 0);
  const prod = allProducts.find(p => p.id === item.productId);
  if (!prod) return 0;
  return parseFloat((item.unit === 'pack' ? prod.priceWholesalePack : prod.priceWholesale) || 0) || 0;
}

function ws_repriceCart(mode) {
  return cart.map(c => {
    if (mode !== 'wholesale') return Object.assign({}, c, { priceType: 'retail' });   // retail = exactly as in cart
    const price = ws_priceFor(c, mode);
    return Object.assign({}, c, {
      price,
      total: Math.round(price * c.qty * 100) / 100,
      priceType: mode === 'wholesale' ? 'wholesale' : 'retail',
    });
  });
}

function ws_missingItems(mode) {
  if (mode !== 'wholesale') return [];
  return cart.filter(c => ws_priceFor(c, 'wholesale') <= 0);
}

function ws_currentTotal() {
  return ws_repriceCart(_checkoutPriceType).reduce((s, c) => s + c.total, 0);
}

function ws_renderCheckoutSummary() {
  const el = document.getElementById('checkoutSummaryBox');
  if (!el) return;
  const mode  = _checkoutPriceType;
  const lines = ws_repriceCart(mode);
  const total = lines.reduce((s, c) => s + c.total, 0);
  const missing = ws_missingItems(mode);
  el.innerHTML =
    lines.map(c => `<div class="checkout-item-line"><span>${c.name} (${c.unit}) x${c.qty}</span><span>₱${parseFloat(c.total||0).toFixed(2)}</span></div>`).join('') +
    `<div class="checkout-total-line"><span>TOTAL</span><span>₱${total.toFixed(2)}</span></div>`;
  const warn = document.getElementById('wsMissingWarn');
  if (warn) {
    warn.style.display = missing.length ? 'block' : 'none';
    warn.innerHTML = missing.length
      ? '<b>No wholesale price set for:</b><br>' + missing.map(c => esc(c.name) + ' (' + c.unit + ')').join('<br>') +
        '<br><span style="font-size:0.75rem">Set it in Inventory (Admin/Clerk), or remove the item, or switch back to Retail.</span>'
      : '';
  }
  const btn = document.getElementById('checkoutConfirmBtn');
  if (btn) btn.disabled = missing.length > 0;
  updateChange(total);
}

function setCheckoutPriceType(mode) {
  _checkoutPriceType = mode === 'wholesale' ? 'wholesale' : 'retail';
  const r = document.getElementById('wsBtnRetail'), w = document.getElementById('wsBtnWholesale');
  if (r) r.className = 'btn btn-sm ' + (_checkoutPriceType === 'retail'    ? 'btn-primary' : 'btn-ghost');
  if (w) w.className = 'btn btn-sm ' + (_checkoutPriceType === 'wholesale' ? 'btn-primary' : 'btn-ghost');
  ws_renderCheckoutSummary();
}

function openCheckout() {
 if (cart.length === 0) { toast('Cart is empty!', 'warning'); return; }
  _checkoutPriceType = 'retail';
  const total = cart.reduce((s, c) => s + c.total, 0);
  openModal(`
<div class="modal-title">Checkout</div>
<div class="checkout-form">
<div class="field">
  <label>Price Type</label>
  <div style="display:flex;gap:8px">
    <button type="button" id="wsBtnRetail" class="btn btn-sm btn-primary" style="flex:1" onclick="setCheckoutPriceType('retail')">Retail</button>
    <button type="button" id="wsBtnWholesale" class="btn btn-sm btn-ghost" style="flex:1" onclick="setCheckoutPriceType('wholesale')">Wholesale</button>
  </div>
</div>
<div class="checkout-summary" id="checkoutSummaryBox">
 ${cart.map(c => `<div class="checkout-item-line"><span>${c.name} (${c.unit}) x${c.qty}</span><span>₱${parseFloat(c.total||0).toFixed(2)}</span></div>`).join('')}
 <div class="checkout-total-line"><span>TOTAL</span><span>₱${total.toFixed(2)}</span></div>
      </div>
<div id="wsMissingWarn" style="display:none;background:#fff7ed;border:1px solid #fdba74;color:#9a3412;border-radius:8px;padding:10px 12px;font-size:0.8rem;margin-bottom:10px"></div>
<div class="field">
<label for="paymentMethod">Payment Method</label>
<select id="paymentMethod" name="paymentMethod" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-family:var(--font-main);font-size:0.9rem;background:white">
  <option value="Cash Sale">Cash Sale</option>
  <option value="GCash">GCash</option>
  <option value="Card">Card</option>
  <option value="Charge Sale">Charge Sale</option>
  <option value="Receivable">Receivable</option>
</select>
</div>
<div class="field">
<label for="cashInput">Cash Received (₱)</label>
<input type="number" id="cashInput" name="cashInput" placeholder="0.00" min="0" step="0.01" oninput="updateChange(ws_currentTotal())">
</div>
<div class="change-display" id="changeDisplay">
<div class="change-label">Change</div>
<div class="change-amount" id="changeAmt">₱0.00</div>
</div>
<button class="btn btn-primary btn-lg" id="checkoutConfirmBtn" style="width:100%" onclick="processCheckout(ws_currentTotal())">Confirm & Save Transaction</button>
    </div>`);
  setTimeout(() => document.getElementById('cashInput')?.focus(), 200);
}

function updateChange(total) {
  const cash = parseFloat(document.getElementById('cashInput')?.value || 0);
  const change = cash - total;
  const cd = document.getElementById('changeDisplay');
  const ca = document.getElementById('changeAmt');
 if (ca) ca.textContent = '₱' + Math.abs(change).toLocaleString('en-PH', { minimumFractionDigits: 2 });
  if (cd) { cd.classList.toggle('negative', change < 0); }
}

let _checkoutInProgress = false;
async function processCheckout(total) {
  // ── Guard: prevent duplicate submissions (button + flag)
  if (_checkoutInProgress) return;
  _checkoutInProgress = true;
  const confirmBtn = document.getElementById('checkoutConfirmBtn') || document.querySelector('#modalBox .btn-primary');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Saving...'; }

  // Wholesale guard: never save a wholesale sale with a missing (zero) wholesale price
  const _wsMissing = ws_missingItems(_checkoutPriceType);
  if (_wsMissing.length) {
    toast('No wholesale price for: ' + _wsMissing.map(c => c.name).join(', '), 'error');
    _checkoutInProgress = false;
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm & Save Transaction'; }
    return;
  }

  const paymentMethod = document.getElementById('paymentMethod')?.value || 'Cash Sale';
  const isNonCash     = ['GCash','Card','Charge Sale','Receivable'].includes(paymentMethod);
  const cash          = parseFloat(document.getElementById('cashInput')?.value || 0);
  const change        = isNonCash ? 0 : cash - total;

  // Validate cash for cash payments
  if (!isNonCash && (!cash || cash < total)) {
    toast('Cash received is insufficient!', 'error');
    _checkoutInProgress = false;
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm & Save Transaction'; }
    return;
  }

  // BUG 1 FIX: snapshot cart HERE before anything else —
  // was declared inside try block AFTER payload was already built, causing ReferenceError
  const cartSnapshot = ws_repriceCart(_checkoutPriceType);
  const _priceType   = _checkoutPriceType === 'wholesale' ? 'wholesale' : 'retail';
  total = cartSnapshot.reduce((s, c) => s + c.total, 0);
  if (!cartSnapshot.length) {
    toast('Cart is empty!', 'warning');
    _checkoutInProgress = false;
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm & Save Transaction'; }
    return;
  }

  const txId  = 'TX' + Date.now();
  const siNum = 'SI' + Date.now();
  const now   = new Date();

  const payload = {
    action:        'saveSale',
    transactionId: txId,
    siNumber:      siNum,
    cashierName:   currentUser.name || currentUser.username || 'Unknown',
    cashierId:     currentUser.id   || currentUser.username || '',
    date:          now.toISOString(),
    items:         JSON.stringify(cartSnapshot),
    priceType:     _priceType,
    total,
    cash:   isNonCash ? total : cash,
    change,
  };

  // Close modal ONLY after validation passes
  closeModalDirect();
  showLoading('Saving transaction...');

  try {
    const res = await gasPost(payload);

    if (res.success) {
      // Clear cart immediately after confirmed save
      cart = [];
      saveCartToStorage();

      // Save receipt data locally for reprint
      saveReceiptToLocal({
        txId, siNum,
        cashier: currentUser.name || currentUser.username,
        date:    now.toISOString(),
        total,
      });
      saveFullReceiptToLocal({
        txId, siNum,
        cashier: currentUser.name || currentUser.username,
        date:    now,
        items:   cartSnapshot,
        total,
        cash:    isNonCash ? total : cash,
        change,
      });

      // Save export rows locally + push to GAS (non-blocking)
      saveSalesExportLocal({
        txId,
        cashier: currentUser.name || currentUser.username,
        date:    now,
        items:   cartSnapshot,
        paymentMethod,
      });
      pushSalesExportToGAS({
        txId,
        cashier: currentUser.name || currentUser.username,
        date:    now,
        items:   cartSnapshot,
        paymentMethod,
      }).catch(() => {});

      _checkoutInProgress = false;
      hideLoading();
      toast('Transaction saved!', 'success');

      // Show receipt immediately after successful save
      generateAndShowReceipt({
        txId, siNum,
        cashier: currentUser.name || currentUser.username,
        date:    now,
        items:   cartSnapshot,
        total,
        cash:    isNonCash ? total : cash,
        change,
        paymentMethod,
      });

    } else {
      _checkoutInProgress = false;
      hideLoading();
      toast('Save failed: ' + (res.message || 'Unknown error. Try again.'), 'error');
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm & Save Transaction'; }
    }

  } catch(e) {
    _checkoutInProgress = false;
    hideLoading();
    toast('Network error. Check connection and try again.', 'error');
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm & Save Transaction'; }
  }
}

// ─── SALES EXPORT ────────────────────────────
function buildExportRows({ txId, cashier, date, items, paymentMethod }) {
  const txDate   = date instanceof Date ? date : new Date(date);
  const dateStr  = localDateStr(txDate);
  const timeStr  = txDate.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  return items.map((item, i) => ({
    transactionId:   txId,
    transactionDate: dateStr,
    transactionTime: timeStr,
    cashier:         cashier,
    paymentMethod:   paymentMethod || 'Cash Sale',
    barcode:         item.barcode  || '',
    stockNo:         String(i + 1).padStart(4, '0'),
    productName:     item.name     || '',
    quantity:        item.qty,
    uomCode:         item.unit === 'pack' ? 'PK' : 'PC',
    discount1:       '',
    discount2:       '',
    discount3:       '',
    discount4:       '',
    price:           parseFloat(item.price  || 0).toFixed(2),
    amount:          parseFloat(item.total  || 0).toFixed(2),
    remarks:         paymentMethod || 'Cash Sale',
  }));
}

function saveSalesExportLocal(data) {
  try {
    const rows     = buildExportRows(data);
    const existing = lsGet('ae_sales_export', []);
    const updated  = [...rows, ...existing];
    if (updated.length > 5000) updated.length = 5000;
    // If storage full, trim to 500 recent rows and retry once
    if (!lsSet('ae_sales_export', updated)) {
      const trimmed = updated.slice(0, 500);
      lsSet('ae_sales_export', trimmed);
      console.warn('[POS] Sales export trimmed to 500 rows — storage limit reached');
    }
  } catch(e) {
    console.warn('[POS] saveSalesExportLocal failed:', e.message);
  }
}

async function pushSalesExportToGAS(data) {
  try {
    const rows = buildExportRows(data);
    return await gasPost({ action: 'saveSalesExport', rows: JSON.stringify(rows) });
  } catch(e) {
    console.warn('[POS] Sales export push failed (non-critical):', e.message);
    return { success: false };
  }
}

function getSalesExportLocal(filters) {
  let rows = lsGet('ae_sales_export', []);
  if (!filters) return rows;

  const { from, to } = filters;
  return rows.filter(r => {
    if (!r.transactionDate) return false;
    const d = parseDate(r.transactionDate);
    if (!d) return false;
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  });
}

// ─── RECEIPT ──────────────────────────────────
let currentReceiptData = null;

function generateAndShowReceipt(data) {
  currentReceiptData = data;
  const { txId, siNum, cashier, date, items, total, cash, change } = data;
  const dateStr = safeFormatDateLong(date);
  const vatRate = 0.12;
  const vatAmount = total * vatRate / (1 + vatRate);
  const netAmount = total - vatAmount;

  const itemRows = items.map(it => {
    const lineTotal = parseFloat(it.total || 0);
    const linePrice = parseFloat(it.price || 0);
    // Recalculate if total is missing or zero but price+qty exist
    const displayTotal = lineTotal || (linePrice * parseInt(it.qty || 1));
    return `<div class="receipt-item-row">
      <span class="desc">${it.name || 'Item'} (${it.unit || 'pc'})</span>
      <span class="qty">${it.qty || 1}</span>
      <span class="amt">₱${displayTotal.toFixed(2)}</span>
    </div>`;
  }).join('');

  const totalQty = items.reduce((s, i) => s + i.qty, 0);

  const rs = getReceiptSettings();
  const receiptContent = document.getElementById('receiptContent');
  if (!receiptContent) { console.error('receiptContent element missing'); return; }
  receiptContent.innerHTML = `
<div class="receipt-head">
<div class="receipt-store">${rs.storeName}</div>
 ${rs.ownedBy ? `<div class="receipt-owned">Owned by: ${rs.ownedBy}</div>` : ''}
 ${rs.vatTin ? `<div class="receipt-vat">VAT Reg TIN: ${rs.vatTin}</div>` : ''}
 ${rs.address ? `<div class="receipt-addr">${rs.address}</div>` : ''}
    </div>
<div class="receipt-body">
<div class="receipt-meta">
        <div><b>SI #:</b> ${siNum}</div>
        <div><b>Transaction #:</b> ${txId}</div>
        <div><b>Cashier:</b> ${cashier}</div>
        <div><b>Date & Time:</b> ${dateStr}</div>
        ${items.some(i => i.priceType === 'wholesale') ? '<div><b>Price Type:</b> WHOLESALE</div>' : ''}
      </div>
      <hr class="receipt-divider">
<div class="receipt-items-header">
        <span>DESCRIPTION</span><span>QTY</span><span style="text-align:right">AMOUNT</span>
      </div>
      ${itemRows}
      <hr class="receipt-divider">
 <div class="receipt-meta" style="text-align:right"><b>Total Qty:</b> ${totalQty}</div>
<div class="receipt-totals">
 <div class="receipt-total-row"><span>Amount Due</span><span>₱${parseFloat(total||0).toFixed(2)}</span></div>
 <div class="receipt-total-row"><span>Cash</span><span>₱${parseFloat(cash||0).toFixed(2)}</span></div>
 <div class="receipt-total-row grand"><span>CHANGE</span><span>₱${parseFloat(change||0).toFixed(2)}</span></div>
 <div class="receipt-total-row vat-row"><span>VAT (12% incl.)</span><span>₱${vatAmount.toFixed(2)}</span></div>
      </div>
    </div>
<div class="receipt-footer">
      ${rs.footer || 'This serves as Sales Invoice for Inventory Only'}<br>
      Thank you for shopping at ${rs.storeName}!
    </div>`;

  const receiptModal = document.getElementById('receiptModal');
  if (!receiptModal) {
    console.error('receiptModal element not found in DOM');
    toast('Receipt could not be displayed. Check index.html for #receiptModal.', 'error');
    return;
  }
  receiptModal.classList.remove('hidden');
  // Scroll receipt into view on mobile
  receiptModal.scrollTop = 0;
}

function closeReceiptModal() {
  const receiptModal = document.getElementById('receiptModal');
  if (receiptModal) receiptModal.classList.add('hidden');
  currentReceiptData = null;
  navigateTo('pos');
}

async function downloadReceipt() {
  if (!currentReceiptData) return;
  try {
    const el = document.getElementById('receiptContent');
    if (typeof html2canvas === 'undefined') {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = `receipt_${currentReceiptData.txId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch(e) {
 toast('Download failed. Try again.', 'error');
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function saveReceiptToLocal(meta) {
  let gallery = lsGet('ae_receipt_gallery', []);
  gallery.unshift(meta);
  if (gallery.length > 200) gallery = gallery.slice(0, 200);
  lsSet('ae_receipt_gallery', gallery);
}

function saveFullReceiptToLocal(data) {
  // Save full receipt data for reprinting
  try {
    let full = lsGet('ae_receipt_full', {});
    full[data.txId] = {
      txId: data.txId,
      siNum: data.siNum,
      cashier: data.cashier,
      date: data.date instanceof Date ? data.date.toISOString() : data.date,
      items: data.items,
      total: data.total,
      cash: data.cash,
      change: data.change
    };
    // Keep only last 100 full receipts
    const keys = Object.keys(full);
    if (keys.length > 100) {
      keys.slice(0, keys.length - 100).forEach(k => delete full[k]);
    }
    lsSet('ae_receipt_full', full);
  } catch(e) {}
}

// ═══════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════
let invProducts = [];

async function renderInventory() {
  const isReadOnly = currentUser.role === 'viewer';
 document.getElementById('pageContent').innerHTML = `
<div class="inv-toolbar">
<div class="search-wrap" style="flex:1;min-width:200px;margin-bottom:0">
        <span class="search-icon">🔍</span>
<input type="text" id="invSearch" placeholder="Search products..." oninput="filterInventory(this.value)">
      </div>
      ${!isReadOnly ? `
<button class="btn btn-primary" onclick="openAddProductModal()">Add Product</button>
<button class="btn btn-ghost" onclick="openImportModal()">Import CSV/Excel</button>
      ` : ''}
    </div>
<div class="card">
 <div id="inventoryTable"><div class="loading-spinner"><div class="spinner"></div> Loading...</div></div>
    </div>`;
  await loadInventory();
}

async function loadInventory() {
  try {
    const res = await gasRequest({ action: 'getProducts' });
    invProducts = res.data || [];
    renderInventoryTable(invProducts);
  } catch(e) {
    const el = document.getElementById('inventoryTable');
 if (el) el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Failed to load inventory.</div></div>';
  }
}


// ── PRODUCT IMAGES (base64 in localStorage) ──
// Product image cache — avoid repeated localStorage reads
let _imgCache = null;
function _getImgStore() {
  if (!_imgCache) {
    try { _imgCache = lsGet('ae_product_images', {}); }
    catch(e) { _imgCache = {}; }
  }
  return _imgCache;
}
function _saveImgStore(imgs) {
  _imgCache = imgs;
  try { lsSet('ae_product_images', imgs); }
  catch(e) { toast('Image too large or storage full.', 'error'); }
}

function getProductImage(productId) {
  return _getImgStore()[productId] || null;
}
function saveProductImage(productId, base64) {
  const imgs = _getImgStore();
  imgs[productId] = base64;
  _saveImgStore(imgs);
}
function deleteProductImage(productId) {
  const imgs = _getImgStore();
  delete imgs[productId];
  _saveImgStore(imgs);
}

function openImageUpload(productId, productName) {
  openModal(`
    <div class="modal-title">Product Image — ${productName}</div>
    <p style="color:var(--text3);font-size:0.82rem;margin-bottom:16px">
      Images are stored on this device only. Max recommended size: 1MB.
    </p>
    <div class="img-upload-area" id="imgUploadArea" onclick="document.getElementById('imgFileInput').click()">
      <div id="imgPreviewWrap">
        ${getProductImage(productId)
          ? `<img src="${getProductImage(productId)}" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:contain">`
          : `<div style="text-align:center;color:var(--text3);padding:32px">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 10px;display:block"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              <div style="font-size:0.85rem">Click to upload image</div>
              <div style="font-size:0.75rem;margin-top:4px">JPG, PNG, WEBP</div>
            </div>`
        }
      </div>
    </div>
    <input type="file" id="imgFileInput" accept="image/*" style="display:none" onchange="handleImageUpload(this,'${productId}')">
    <div style="display:flex;gap:10px;margin-top:14px">
      ${getProductImage(productId) ? `<button class="btn btn-danger btn-sm" onclick="deleteProductImage('${productId}');closeModalDirect();loadInventory()">Remove Image</button>` : ''}
      <button class="btn btn-ghost" style="flex:1" onclick="closeModalDirect()">Cancel</button>
    </div>`);
}

function handleImageUpload(input, productId) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    toast('Image too large! Max 2MB.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    const base64 = e.target.result;
    // Resize image before saving
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const MAX = 300;
      let w = img.width, h = img.height;
      if (w > h) { if (w > MAX) { h = h * MAX / w; w = MAX; } }
      else { if (h > MAX) { w = w * MAX / h; h = MAX; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const resized = canvas.toDataURL('image/jpeg', 0.75);
      saveProductImage(productId, resized);
      toast('Image saved!', 'success');
      closeModalDirect();
      loadInventory();
    };
    img.src = base64;
  };
  reader.readAsDataURL(file);
}

function viewProductImage(productId, productName) {
  const img = getProductImage(productId);
  if (!img) { openImageUpload(productId, productName); return; }
  openModal(`
    <div class="modal-title">${productName}</div>
    <div style="text-align:center">
      <img src="${img}" style="max-width:100%;max-height:360px;border-radius:10px;object-fit:contain;box-shadow:var(--shadow)">
    </div>
    <div style="display:flex;gap:10px;margin-top:16px">
      <button class="btn btn-ghost btn-sm" onclick="openImageUpload('${productId}','${jsq(productName)}');closeModalDirect()">Change Image</button>
      <button class="btn btn-danger btn-sm" onclick="deleteProductImage('${productId}');closeModalDirect();loadInventory()">Remove</button>
      <button class="btn btn-primary" style="flex:1" onclick="closeModalDirect()">Close</button>
    </div>`);
}

function renderInventoryTable(products) {
  const el = document.getElementById('inventoryTable');
  if (!el) return;
  const isReadOnly = currentUser.role === 'viewer';
  const canDelete = ['admin','clerk'].includes(currentUser.role);
  const canEdit = ['admin','clerk'].includes(currentUser.role);
  const adminOnly = currentUser.role === 'admin';

  if (!products.length) {
    el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div class="no-data-text">No products yet.</div></div>';
    return;
  }

  const chkCol = canDelete ? '<th style="width:36px"><input type="checkbox" id="selectAll" name="selectAll" onchange="toggleSelectAll(this)"></th>' : '';
  const actCol = canEdit ? '<th>Actions</th>' : '';
  const imgCol = '<th style="width:52px">Image</th>';

  let rows = products.map(p => {
    const qty = parseInt(p.qtyPcs || 0);
    const badge = qty === 0 ? '<span class="badge-out">Out</span>' : qty <= 5 ? '<span class="badge-low">Low</span>' : '<span class="badge-in-stock">In Stock</span>';
    const chk = canDelete ? `<td><input type="checkbox" class="row-select" name="row_select_${p.id}" value="${p.id}" onchange="updateBulkBar()"></td>` : '';
    const img = getProductImage(p.id);
    const thumb = img ? `<img src="${img}" class="prod-thumb" onclick="viewProductImage('${p.id}','${jsq(p.name)}')">` : `<div class="prod-thumb-empty" onclick="openImageUpload('${p.id}','${jsq(p.name)}')">+</div>`;
    const acts = canEdit ? `<td><div class="inv-btn-group">
      <button class="inv-btn inv-btn-edit" onclick="openEditProductModal('${p.id}')" title="Edit"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Edit</button>
      <button class="inv-btn inv-btn-in" onclick="openStockModal('${p.id}','in')" title="Stock In"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg> In</button>
      <button class="inv-btn inv-btn-out" onclick="openStockModal('${p.id}','out')" title="Stock Out"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="8 8 12 12 16 8"/><line x1="12" y1="12" x2="12" y2="3"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg> Out</button>
      <button class="inv-btn inv-btn-del" onclick="deleteProduct('${p.id}')" title="Delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
    </div></td>` : '';
    return `<tr>${chk}
      <td>${thumb}</td>
      <td style="font-family:var(--font-mono);font-size:0.8rem">${p.barcode||'—'}</td>
      <td><b>${p.name}</b></td>
      <td>${p.qtyPcs||0}</td><td>${p.qtyPacks||0}</td>
      <td>₱${parseFloat(p.pricePer||0).toFixed(2)}</td>
      <td>₱${parseFloat(p.pricePack||0).toFixed(2)}</td>
      ${canEdit ? `<td>${parseFloat(p.priceWholesale||0) > 0 ? '₱' + parseFloat(p.priceWholesale).toFixed(2) : '—'}</td><td>${parseFloat(p.priceWholesalePack||0) > 0 ? '₱' + parseFloat(p.priceWholesalePack).toFixed(2) : '—'}</td>` : ''}
      <td>${badge}</td>${acts}
    </tr>`;
  }).join('');

  el.innerHTML = `
    ${canDelete ? '<div class="bulk-action-bar" id="bulkActionBar" style="display:none"><span id="selectedCount">0 selected</span><button class="btn btn-danger btn-sm" onclick="bulkDeleteSelected()">Delete Selected</button><button class="btn btn-ghost btn-sm" onclick="clearSelection()">Clear</button></div>' : ''}
    <div class="tbl-wrap"><table>
      <thead><tr>${chkCol}${imgCol}<th>Barcode</th><th>Name</th><th>Qty Pcs</th><th>Qty Packs</th><th>Price/Pc</th><th>Price/Pack</th>${canEdit ? '<th>WS Price/Pc</th><th>WS Price/Pack</th>' : ''}<th>Status</th>${actCol}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function toggleSelectAll(cb) {
  document.querySelectorAll('.row-select').forEach(c => c.checked = cb.checked);
  updateBulkBar();
}

function updateBulkBar() {
  const selected = document.querySelectorAll('.row-select:checked');
  const bar = document.getElementById('bulkActionBar');
  const count = document.getElementById('selectedCount');
  if (bar) bar.style.display = selected.length > 0 ? 'flex' : 'none';
  if (count) count.textContent = selected.length + ' selected';
  const selAll = document.getElementById('selectAll');
  const all = document.querySelectorAll('.row-select');
  if (selAll) selAll.checked = all.length > 0 && selected.length === all.length;
}

function clearSelection() {
  document.querySelectorAll('.row-select').forEach(c => c.checked = false);
  const selAll = document.getElementById('selectAll');
  if (selAll) selAll.checked = false;
  updateBulkBar();
}

async function bulkDeleteSelected() {
  const selected = [...document.querySelectorAll('.row-select:checked')].map(c => c.value);
  if (!selected.length) return;
  if (!confirm('Delete ' + selected.length + ' product(s)? Cannot be undone.')) return;
  toast('Deleting ' + selected.length + ' products...', 'info');
  let done = 0;
  for (const id of selected) {
    try { const res = await gasPost({ action: 'deleteProduct', id }); if (res.success) done++; } catch(e) {}
  }
  toast('Deleted ' + done + ' of ' + selected.length + ' products.', 'success');
  loadInventory();
}

function filterInventory(val) {
  const q = val.toLowerCase();
  const filtered = invProducts.filter(p =>
    (p.name || '').toLowerCase().includes(q) ||
    (p.barcode || '').toLowerCase().includes(q)
  );
  renderInventoryTable(filtered);
}

// ── PRODUCT BARCODES STATE ──
let productBarcodes = []; // up to 3 barcodes
let productPhotoData = null; // base64 photo
let productScannerActive = false;

function openAddProductModal() {
  productBarcodes = [];
  productPhotoData = null;
  productScannerActive = false;
  openModal(buildProductModal(null));
  setTimeout(() => initProductModalListeners(), 200);
}

function openEditProductModal(id) {
  const p = invProducts.find(x => x.id === id);
  if (!p) return;
  // Parse existing barcodes (comma separated)
  productBarcodes = (p.barcode || '').split(',').map(b => b.trim()).filter(Boolean).slice(0, 3);
  productPhotoData = getProductImage(id) || null;
  productScannerActive = false;
  openModal(buildProductModal(p));
  setTimeout(() => initProductModalListeners(), 200);
}

function buildProductModal(p) {
  const isEdit = !!p;
  const existingPhoto = p ? getProductImage(p.id) : null;
  return `
    <div class="modal-title">${isEdit ? 'Edit Product' : 'Add New Product'}</div>

    <!-- PHOTO SECTION -->
    <div class="prod-modal-section">
      <div class="prod-modal-label">Product Photo</div>
      <div class="prod-photo-area">
        <div class="prod-photo-preview" id="prodPhotoPreview">
          ${existingPhoto
            ? `<img src="${existingPhoto}" id="prodPhotoImg" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`
            : `<div class="prod-photo-placeholder" id="prodPhotoPlaceholder">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                <span>No photo</span>
              </div>`}
        </div>
        <div class="prod-photo-btns">
          <button class="inv-btn inv-btn-edit" onclick="openProductCamera()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            Take Photo
          </button>
          <button class="inv-btn inv-btn-in" onclick="document.getElementById('prodPhotoFile').click()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload
          </button>
          ${existingPhoto || productPhotoData ? `<button class="inv-btn inv-btn-del" onclick="removeProductPhoto()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>` : ''}
        </div>
        <input type="file" id="prodPhotoFile" accept="image/*" style="display:none" onchange="handleProductPhoto(this)">
      </div>
      <!-- Camera for photo -->
      <div id="prodPhotoCameraWrap" style="display:none;margin-top:10px">
        <video id="prodPhotoVideo" autoplay playsinline muted style="width:100%;border-radius:8px;max-height:200px;object-fit:cover;background:#000"></video>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-primary btn-sm" style="flex:1" onclick="captureProductPhoto()">Capture</button>
          <button class="btn btn-ghost btn-sm" onclick="closeProductCamera()">Cancel</button>
        </div>
      </div>
    </div>

    <!-- BARCODES SECTION -->
    <div class="prod-modal-section">
      <div class="prod-modal-label">Barcodes <span style="color:var(--text3);font-weight:400">(up to 3)</span></div>
      <div id="barcodeList" class="barcode-list"></div>
      ${productBarcodes.length < 3 ? `
      <div class="barcode-add-row">
        <input type="text" id="barcodeManualInput" name="barcodeManualInput" placeholder="Type barcode + Enter or scan..."
          autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();addBarcodeManual()}">
        <button class="inv-btn inv-btn-edit" onclick="openProductBarcodeScanner()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          Scan
        </button>
        <button class="inv-btn inv-btn-in" onclick="addBarcodeManual()">Add</button>
      </div>` : `<p style="color:var(--text3);font-size:0.78rem">Maximum 3 barcodes reached.</p>`}
      <!-- Inline barcode scanner -->
      <div id="prodBarcodeScannerWrap" style="display:none;margin-top:10px">
        <video id="prodBarcodeVideo" autoplay playsinline muted style="width:100%;border-radius:8px;max-height:180px;object-fit:cover;background:#000"></video>
        <div class="camera-status" id="prodBarcodeScanStatus" style="color:var(--text2);background:var(--bg);border-radius:6px;margin-top:4px">Point at barcode...</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:6px;width:100%" onclick="closeProductBarcodeScanner()">Cancel</button>
      </div>
    </div>

    <!-- PRODUCT DETAILS -->
    <div class="prod-modal-section">
      <div class="prod-modal-label">Product Details</div>
      <div class="input-row">
        <div class="field" style="grid-column:1/-1">
          <label for="f_name">Product Name *</label>
          <input id="f_name" value="${p?.name || ''}" placeholder="e.g. Coca-Cola 1.5L">
        </div>
      </div>
      <div class="input-row">
        <div class="field" style="grid-column:1/-1">
          <label for="f_desc">Description</label>
          <input id="f_desc" value="${p?.description || ''}" placeholder="Optional description">
        </div>
      </div>
      <div class="input-row">
        <div class="field">
          <label for="f_variants">Variants</label>
          <input id="f_variants" value="${p?.variants || ''}" placeholder="e.g. Red, Blue, Large">
        </div>
        <div class="field">
          <label for="f_category">Category</label>
          <input id="f_category" value="${p?.category || ''}" placeholder="e.g. Beverages">
        </div>
      </div>
    </div>

    <!-- STOCK & PRICE -->
    <div class="prod-modal-section">
      <div class="prod-modal-label">Stock & Pricing</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field">
          <label for="f_qtyPcs">Qty (Pcs)</label>
          <input id="f_qtyPcs" type="number" min="0" value="${p?.qtyPcs || 0}">
        </div>
        <div class="field">
          <label for="f_qtyPacks">Qty (Packs)</label>
          <input id="f_qtyPacks" type="number" min="0" value="${p?.qtyPacks || 0}">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field">
          <label for="f_pricePer">Retail Price per Piece (₱)</label>
          <input id="f_pricePer" type="number" min="0" step="0.01" value="${p?.pricePer || 0}" placeholder="0.00">
        </div>
        <div class="field">
          <label for="f_pricePack">Retail Price per Pack (₱)</label>
          <input id="f_pricePack" type="number" min="0" step="0.01" value="${p?.pricePack || 0}" placeholder="0.00">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="field">
          <label for="f_priceWholesale">Wholesale Price per Piece (₱)</label>
          <input id="f_priceWholesale" type="number" min="0" step="0.01" value="${p?.priceWholesale || 0}" placeholder="0.00">
        </div>
        <div class="field">
          <label for="f_priceWholesalePack">Wholesale Price per Pack (₱)</label>
          <input id="f_priceWholesalePack" type="number" min="0" step="0.01" value="${p?.priceWholesalePack || 0}" placeholder="0.00">
        </div>
      </div>
    </div>

    <button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveProduct(${p ? "'"+p.id+"'" : ''})">
      ${isEdit ? 'Update Product' : 'Save Product'}
    </button>`;
}

function initProductModalListeners() {
  renderBarcodeList();
  if (productPhotoData) {
    const img = document.getElementById('prodPhotoImg');
    if (!img) {
      const preview = document.getElementById('prodPhotoPreview');
      if (preview) preview.innerHTML = `<img src="${productPhotoData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
    }
  }
}

function renderBarcodeList() {
  const el = document.getElementById('barcodeList');
  if (!el) return;
  if (!productBarcodes.length) {
    el.innerHTML = '<p style="color:var(--text3);font-size:0.78rem;margin-bottom:6px">No barcodes added yet.</p>';
    return;
  }
  el.innerHTML = productBarcodes.map((b, i) => `
    <div class="barcode-pill">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="2" height="16"/><rect x="5" y="4" width="1" height="16"/><rect x="8" y="4" width="2" height="16"/><rect x="12" y="4" width="1" height="16"/><rect x="15" y="4" width="2" height="16"/><rect x="19" y="4" width="1" height="16"/><rect x="22" y="4" width="1" height="16"/></svg>
      <span style="font-family:var(--font-mono);font-size:0.82rem">${b}</span>
      <span style="font-size:0.7rem;color:var(--text3)">BC${i+1}</span>
      <button onclick="removeBarcode(${i})" style="background:none;border:none;cursor:pointer;color:#ef4444;font-size:0.85rem;padding:0 2px">✕</button>
    </div>`).join('');
}

function addBarcodeManual() {
  const input = document.getElementById('barcodeManualInput');
  if (!input) return;
  const val = input.value.trim();
  if (!val) { toast('Enter a barcode value.', 'warning'); return; }
  addBarcodeToList(val);
  input.value = '';
  input.focus();
}

function addBarcodeToList(val) {
  if (productBarcodes.length >= 3) { toast('Maximum 3 barcodes only.', 'warning'); return; }
  if (productBarcodes.includes(val)) { toast('Barcode already added.', 'warning'); return; }
  productBarcodes.push(val);
  renderBarcodeList();
  toast('Barcode added: ' + val, 'success');
  // Hide scanner if open
  closeProductBarcodeScanner();
}

function removeBarcode(idx) {
  productBarcodes.splice(idx, 1);
  renderBarcodeList();
}

// ── PRODUCT BARCODE SCANNER (inline) ──
let prodBarcodeStream = null;
let prodBarcodeScanId = null;
let prodBarcodeScanning = false;

async function openProductBarcodeScanner() {
  const wrap = document.getElementById('prodBarcodeScannerWrap');
  const video = document.getElementById('prodBarcodeVideo');
  const status = document.getElementById('prodBarcodeScanStatus');
  if (!wrap || !video) return;
  wrap.style.display = 'block';
  prodBarcodeScanning = true;

  try {
    prodBarcodeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = prodBarcodeStream;
    await video.play();
    if (status) status.textContent = 'Point at barcode...';

    if ('BarcodeDetector' in window) {
      const detector = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code'] });
      const prodDetect = async () => {
        if (!prodBarcodeScanning) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0) {
            const val = codes[0].rawValue.trim();
            if (status) status.textContent = 'Found: ' + val;
            addBarcodeToList(val);
            return;
          }
        } catch(e) {}
        prodBarcodeScanId = requestAnimationFrame(prodDetect);
      };
      prodDetect();
    } else {
      if (typeof ZXing === 'undefined' && typeof jsQR === 'undefined') {
        await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
      }
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const prodScan = () => {
        if (!prodBarcodeScanning) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          if (typeof jsQR !== 'undefined') {
            const code = jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data, canvas.width, canvas.height);
            if (code && code.data) {
              if (status) status.textContent = 'Found: ' + code.data;
              addBarcodeToList(code.data.trim());
              return;
            }
          }
        }
        prodBarcodeScanId = requestAnimationFrame(prodScan);
      };
      prodScan();
    }
  } catch(e) {
    if (status) status.textContent = e.name === 'NotAllowedError' ? 'Camera denied.' : 'Camera error.';
  }
}

function closeProductBarcodeScanner() {
  prodBarcodeScanning = false;
  if (prodBarcodeScanId) { cancelAnimationFrame(prodBarcodeScanId); prodBarcodeScanId = null; }
  if (prodBarcodeStream) { prodBarcodeStream.getTracks().forEach(t => t.stop()); prodBarcodeStream = null; }
  const wrap = document.getElementById('prodBarcodeScannerWrap');
  const video = document.getElementById('prodBarcodeVideo');
  if (wrap) wrap.style.display = 'none';
  if (video) video.srcObject = null;
}

// ── PRODUCT PHOTO CAMERA ──
let prodPhotoStream = null;

async function openProductCamera() {
  const wrap = document.getElementById('prodPhotoCameraWrap');
  const video = document.getElementById('prodPhotoVideo');
  if (!wrap || !video) return;
  wrap.style.display = 'block';
  try {
    prodPhotoStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    video.srcObject = prodPhotoStream;
    await video.play();
  } catch(e) {
    toast(e.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Camera error.', 'error');
    wrap.style.display = 'none';
  }
}

function captureProductPhoto() {
  const video = document.getElementById('prodPhotoVideo');
  if (!video) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  // Resize to max 400px
  const MAX = 400;
  const resizeCanvas = document.createElement('canvas');
  let w = canvas.width, h = canvas.height;
  if (w > h) { if (w > MAX) { h = h * MAX / w; w = MAX; } }
  else { if (h > MAX) { w = w * MAX / h; h = MAX; } }
  resizeCanvas.width = w; resizeCanvas.height = h;
  resizeCanvas.getContext('2d').drawImage(canvas, 0, 0, w, h);
  productPhotoData = resizeCanvas.toDataURL('image/jpeg', 0.8);
  // Update preview
  const preview = document.getElementById('prodPhotoPreview');
  if (preview) preview.innerHTML = `<img src="${productPhotoData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
  closeProductCamera();
  toast('Photo captured!', 'success');
}

function closeProductCamera() {
  if (prodPhotoStream) { prodPhotoStream.getTracks().forEach(t => t.stop()); prodPhotoStream = null; }
  const wrap = document.getElementById('prodPhotoCameraWrap');
  const video = document.getElementById('prodPhotoVideo');
  if (wrap) wrap.style.display = 'none';
  if (video) video.srcObject = null;
}

function handleProductPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('Image too large! Max 5MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const MAX = 400;
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > h) { if (w > MAX) { h = h * MAX / w; w = MAX; } }
      else { if (h > MAX) { w = w * MAX / h; h = MAX; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      productPhotoData = canvas.toDataURL('image/jpeg', 0.8);
      const preview = document.getElementById('prodPhotoPreview');
      if (preview) preview.innerHTML = `<img src="${productPhotoData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
      toast('Photo uploaded!', 'success');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function removeProductPhoto() {
  productPhotoData = null;
  const preview = document.getElementById('prodPhotoPreview');
  if (preview) preview.innerHTML = `<div class="prod-photo-placeholder" id="prodPhotoPlaceholder">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    <span>No photo</span>
  </div>`;
}

async function saveProduct(id = null) {
  const name = document.getElementById('f_name')?.value.trim();
  if (!name) { toast('Product name is required.', 'error'); return; }
  if (!productBarcodes.length) {
    if (!confirm('No barcode added. Save product without barcode?')) return;
  }
  // Stop any open cameras
  closeProductCamera();
  closeProductBarcodeScanner();

  const payload = {
    action: id ? 'updateProduct' : 'addProduct',
    id, name,
    barcode: productBarcodes.join(','),
    description: document.getElementById('f_desc')?.value.trim() || '',
    variants: document.getElementById('f_variants')?.value.trim() || '',
    category: document.getElementById('f_category')?.value.trim() || '',
    qtyPcs: parseInt(document.getElementById('f_qtyPcs')?.value || 0),
    qtyPacks: parseInt(document.getElementById('f_qtyPacks')?.value || 0),
    pricePer: parseFloat(document.getElementById('f_pricePer')?.value || 0),
    pricePack: parseFloat(document.getElementById('f_pricePack')?.value || 0),
    priceWholesale:     parseFloat(document.getElementById('f_priceWholesale')?.value || 0),
    priceWholesalePack: parseFloat(document.getElementById('f_priceWholesalePack')?.value || 0),
  };

  showLoading(id ? 'Updating product...' : 'Saving product...');
  try {
    const res = await gasPost(payload);
    hideLoading();
    if (res.success) {
      const productId = id || res.id;
      if (productPhotoData && productId) {
        saveProductImage(productId, productPhotoData);
      } else if (!productPhotoData && productId && id) {
        deleteProductImage(productId);
      }
      toast(id ? 'Product updated!' : 'Product added!', 'success');
      closeModalDirect();
      loadInventory();
    } else {
      toast(res.message || 'Error saving product.', 'error');
    }
  } catch(e) { hideLoading(); toast('Network error.', 'error'); }
}

async function deleteProduct(id) {
  if (!confirm('Delete this product? This cannot be undone.')) return;
  try {
    const res = await gasPost({ action: 'deleteProduct', id });
 if (res.success) { toast('Product deleted.', 'success'); loadInventory(); }
 else toast(res.message || 'Error deleting.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

function openStockModal(id, direction) {
  const p = invProducts.find(x => x.id === id);
  if (!p) return;
  openModal(`
<div class="modal-title">${direction === 'in' ? ' Stock In' : ' Stock Out'} — ${p.name}</div>
<div class="input-row">
 <div class="field"><label for="stockQty">Quantity</label><input id="stockQty" name="stockQty" type="number" min="1" value="1" placeholder="Enter qty"></div>
 <div class="field"><label for="stockUnit">Unit</label>
        <select id="stockUnit" name="stockUnit">
          <option value="pcs">Pieces (pcs)</option>
          <option value="packs">Packs</option>
        </select>
      </div>
    </div>
 <div class="field"><label for="stockNote">Notes / Reason</label><input id="stockNote" name="stockNote" placeholder="Optional notes"></div>
<button class="btn btn-primary" style="width:100%;margin-top:10px" onclick="saveStock('${id}','${direction}')">Save</button>`);
}

async function saveStock(id, direction) {
  const qty = parseInt(document.getElementById('stockQty')?.value || 0);
  const unit = document.getElementById('stockUnit')?.value;
  const note = document.getElementById('stockNote')?.value.trim();
 if (!qty || qty< 1) { toast('Enter a valid quantity.', 'error'); return; }
  try {
    const res = await gasPost({
      action: 'stockAdjust', id, direction, qty, unit, note,
      adjustedBy: currentUser.name, date: new Date().toISOString()
    });
 if (res.success) { toast(`Stock ${direction} saved!`, 'success'); closeModalDirect(); loadInventory(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

// ── RECEIPT SETTINGS ─────────────────────────
function getReceiptSettings() {
  const defaults = {
    storeName: 'AE HOME',
    ownedBy: 'AE Home Trade Corp.',
    vatTin: '010-948-69500000',
    address: 'Alcantara Street, Brgy VIII, City of Vigan',
    footer: 'This serves as Sales Invoice for Inventory Only'
  };
  try {
    const saved = lsGet('ae_receipt_settings', {});
    return { ...defaults, ...saved };
  } catch(e) { return defaults; }
}

function saveReceiptSettings() {
  const s = {
    storeName: document.getElementById('rs_storeName')?.value.trim() || 'AE HOME',
    ownedBy: document.getElementById('rs_ownedBy')?.value.trim() || '',
    vatTin: document.getElementById('rs_vatTin')?.value.trim() || '',
    address: document.getElementById('rs_address')?.value.trim() || '',
    footer: document.getElementById('rs_footer')?.value.trim() || '',
  };
  lsSet('ae_receipt_settings', s);
 toast('Receipt settings saved!', 'success');
  closeModalDirect();
}

function openReceiptSettings() {
  const s = getReceiptSettings();
  openModal(`
<div class="modal-title">Receipt / Company Settings</div>
    <p style="color:var(--text3);font-size:0.82rem;margin-bottom:16px">These details will appear on every receipt.</p>
<div class="input-row">
 <div class="field" style="grid-column:1/-1"><label for="rs_storeName">Store Name</label>
 <input id="rs_storeName" value="${s.storeName}" placeholder="AE HOME"></div>
    </div>
<div class="input-row">
 <div class="field" style="grid-column:1/-1"><label for="rs_ownedBy">Owned By</label>
 <input id="rs_ownedBy" value="${s.ownedBy}" placeholder="AE Home Trade Corp."></div>
    </div>
<div class="input-row">
 <div class="field"><label for="rs_vatTin">VAT Reg TIN</label>
 <input id="rs_vatTin" value="${s.vatTin}" placeholder="000-000-000-000"></div>
    </div>
<div class="input-row">
 <div class="field" style="grid-column:1/-1"><label for="rs_address">Address</label>
 <input id="rs_address" value="${s.address}" placeholder="Street, Barangay, City"></div>
    </div>
<div class="input-row">
 <div class="field" style="grid-column:1/-1"><label for="rs_footer">Receipt Footer Note</label>
 <input id="rs_footer" value="${s.footer}" placeholder="e.g. This serves as Sales Invoice..."></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:8px">
<button class="btn btn-ghost" style="flex:1" onclick="closeModalDirect()">Cancel</button>
<button class="btn btn-primary" style="flex:2" onclick="saveReceiptSettings()">Save Settings</button>
    </div>`);
}

// Store parsed rows globally for import confirmation
let pendingImportRows = [];

function openImportModal() {
  pendingImportRows = [];
  openModal(`
<div class="modal-title">Import Products from CSV/Excel</div>
    <p style="color:var(--text2);font-size:0.88rem;margin-bottom:12px">
      Required column: <b>name</b>. Optional: barcode, qtyPcs, qtyPacks, pricePer, pricePack.<br>
      <span style="color:var(--text3);font-size:0.8rem">Tip: Use comma-separated CSV or Excel (.xlsx/.xls)</span>
    </p>
<div class="import-area" id="importArea" onclick="document.getElementById('importFile').click()">
 <div class="import-icon"></div>
<div class="import-text">Click to select file</div>
<div class="import-sub">.csv, .xlsx, .xls accepted</div>
    </div>
    <input type="file" id="importFile" accept=".csv,.xlsx,.xls" style="display:none" onchange="handleImportFile(this)">
    <div id="importPreview" style="margin-top:16px"></div>`);
}

async function handleImportFile(input) {
  const file = input.files[0];
  if (!file) return;

  // Show parsing indicator
  const preview = document.getElementById('importPreview');
 if (preview) preview.innerHTML = `
    <div style="text-align:center;padding:20px;color:var(--text2)">
 <div class="spinner" style="margin:0 auto 10px"></div>
      <div>Reading file: <b>${file.name}</b>...</div>
    </div>`;

  const importArea = document.getElementById('importArea');
  if (importArea) importArea.style.opacity = '0.5';

  const ext = file.name.split('.').pop().toLowerCase();
  try {
    if (ext === 'csv') {
      const text = await file.text();
      processImportCSV(text, file.name);
    } else {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const csv = XLSX.utils.sheet_to_csv(ws);
      processImportCSV(csv, file.name);
    }
  } catch(e) {
 if (preview) preview.innerHTML = `<div class="no-data"><div class="no-data-icon"></div><div>Failed to read file. Make sure it's a valid CSV or Excel file.</div></div>`;
    if (importArea) importArea.style.opacity = '1';
  }
}

function processImportCSV(csvText, filename) {
  const preview = document.getElementById('importPreview');
  const importArea = document.getElementById('importArea');
  if (importArea) importArea.style.opacity = '1';

  const lines = csvText.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) {
 if (preview) preview.innerHTML = '<div class="no-data"><div class="no-data-icon">️</div><div>File is empty or has no data rows.</div></div>';
 toast('File has no data rows!', 'error');
    return;
  }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, '').replace(/\r/g, '').replace(/\s+/g, ''));
  const rows = lines.slice(1).map(line => {
    // Handle quoted values with commas inside
    const vals = [];
    let cur = '', inQuote = false;
    for (let ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { vals.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur.trim().replace(/\r/g, ''));
    const obj = {};
    headers.forEach((h, i) => obj[h] = (vals[i] || '').replace(/"/g, ''));
    return obj;
  }).filter(r => r.name && r.name.trim());

  if (!rows.length) {
 if (preview) preview.innerHTML = '<div class="no-data"><div class="no-data-icon">️</div><div>No valid products found. Make sure you have a "name" column.</div></div>';
 toast('No valid products found in file!', 'error');
    return;
  }

  // Validate rows — check for issues
  const issues = [];
  rows.forEach((r, i) => {
    if (!r.name.trim()) issues.push(`Row ${i+2}: Missing name`);
    const price = parseFloat(r.priceper || r.pricePer || 0);
    if (isNaN(price)) issues.push(`Row ${i+2}: Invalid price`);
  });

  // Store globally
  pendingImportRows = rows;

  if (!preview) return;
 preview.innerHTML = `
    <div style="background:var(--bg2);border-radius:10px;padding:12px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-weight:700;font-size:0.9rem">📄 ${filename}</span>
        <span style="background:var(--green);color:white;padding:3px 10px;border-radius:20px;font-size:0.78rem;font-weight:700">${rows.length} products found</span>
      </div>
      ${issues.length ? `<div style="color:#f59e0b;font-size:0.78rem;margin-top:4px">⚠️ ${issues.length} row(s) may have issues — will still be imported if name is present.</div>` : '<div style="color:var(--green);font-size:0.78rem">✅ All rows look valid!</div>'}
    </div>

    <div style="font-size:0.82rem;font-weight:700;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Preview (first 10 rows)</div>
<div class="tbl-wrap" style="max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:10px">
      <table>
        <thead><tr><th>#</th><th>Name</th><th>Barcode</th><th>Qty Pcs</th><th>Qty Packs</th><th>Price/Pc</th><th>Price/Pack</th></tr></thead>
        <tbody>
          ${rows.slice(0, 10).map((r, i) => `<tr>
            <td class="text-muted">${i+1}</td>
            <td><b>${r.name}</b></td>
            <td>${r.barcode || '—'}</td>
            <td>${r.qtypcs || r.qtyPcs || r['qty(pcs)'] || 0}</td>
            <td>${r.qtypacks || r.qtyPacks || r['qty(packs)'] || 0}</td>
            <td>₱${parseFloat(r.priceper || r.pricePer || r['price/pc'] || 0).toFixed(2)}</td>
            <td>₱${parseFloat(r.pricepack || r.pricePack || r['price/pack'] || 0).toFixed(2)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${rows.length > 10 ? `<p style="color:var(--text3);font-size:0.78rem;margin-top:6px;text-align:center">...and <b>${rows.length - 10}</b> more rows</p>` : ''}

    <div style="display:flex;gap:10px;margin-top:14px">
<button class="btn btn-ghost" style="flex:1" onclick="openImportModal()">↩ Choose Different File</button>
<button class="btn btn-primary" style="flex:2" id="confirmImportBtn" onclick="confirmImport()">
        ✅ Confirm & Import ${rows.length} Products
      </button>
    </div>`;
}

// Special bulk import via GET — splits product data into URL-safe chunks
async function gasBulkImport(batch) {
  // Normalize column name variants from Excel/CSV headers
  const products = batch.map(p => ({
    name:      String(p.name      || p.Name      || p.NAME      || '').trim(),
    barcode:   String(p.barcode   || p.Barcode   || p.BARCODE   || p['Barcode']    || '').trim(),
    qtyPcs:    String(p.qtypcs    || p.qtyPcs    || p['qty(pcs)']   || p['Qty Pcs']   || p['QTY PCS']   || '0'),
    qtyPacks:  String(p.qtypacks  || p.qtyPacks  || p['qty(packs)'] || p['Qty Packs'] || p['QTY PACKS'] || '0'),
    pricePer:  String(p.priceper  || p.pricePer  || p['price/pc']   || p['Price/Pc']  || p['PRICE/PC']  || '0'),
    pricePack: String(p.pricepack || p.pricePack || p['price/pack'] || p['Price/Pack']|| p['PRICE/PACK']|| '0'),
  })).filter(p => p.name);

  // Use GET + base64 payload (same as gasPost) — avoids CORS block
  const payload = { action: 'bulkAddProducts', products: JSON.stringify(products), token: authToken || '' };
  const json    = JSON.stringify(payload);
  let encoded;
  try {
    encoded = btoa(unescape(encodeURIComponent(json)));
  } catch (e) {
    const bytes  = new TextEncoder().encode(json);
    const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
    encoded = btoa(binary);
  }
  const url   = GAS_URL + '?data=' + encodeURIComponent(encoded);
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res  = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal });
    clearTimeout(timer);
    const text = await res.text();
    if (!text || !text.trim()) return { success: true, count: products.length };
    try { return handleAuthError(JSON.parse(text)); }
    catch(e) { return { success: true, count: products.length }; }
  } catch(e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Import timed out. Try a smaller batch.');
    throw new Error('Import error: ' + e.message);
  }
}

async function confirmImport() {
  const rows = pendingImportRows;
 if (!rows || !rows.length) { toast('No data to import.', 'warning'); return; }

 const btn = document.getElementById('confirmImportBtn');
  if (btn) {
    btn.disabled = true;
 btn.innerHTML = '<div class="spinner" style="display:inline-block;width:16px;height:16px;margin-right:8px;vertical-align:middle"></div> Starting import...';
  }

  // Show status element
  const preview = document.getElementById('importPreview');
  let statusEl = document.getElementById('importStatus');
  if (!statusEl && preview) {
    statusEl = document.createElement('div');
    statusEl.id = 'importStatus';
    statusEl.style.cssText = 'margin-top:12px;padding:14px;background:var(--bg2);border-radius:10px;font-size:0.85rem;text-align:center;color:var(--text2)';
    preview.appendChild(statusEl);
  }

  // ── BATCH IMPORT (15 per batch — URL-safe size) ──
  const BATCH_SIZE = 15;
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }

  let totalImported = 0;
  let failed = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const batchNum = b + 1;
    const progress = Math.round((b / batches.length) * 100);

    // Update status
    if (statusEl) {
 statusEl.innerHTML = `
 <div class="spinner" style="margin:0 auto 10px"></div>
        <div style="font-weight:600;margin-bottom:6px">Importing batch ${batchNum} of ${batches.length}...</div>
        <div style="background:var(--border);border-radius:20px;height:8px;overflow:hidden;margin:8px 0">
          <div style="background:var(--grad);height:100%;width:${progress}%;border-radius:20px;transition:width 0.3s"></div>
        </div>
        <div style="font-size:0.78rem;color:var(--text3)">${totalImported} of ${rows.length} products saved so far...</div>`;
    }
 if (btn) btn.innerHTML = `⏳ ${progress}% (${batchNum}/${batches.length} batches)`;

    try {
      const res = await gasBulkImport(batch);
      if (res.success) {
        totalImported += res.count || batch.length;
      } else {
        failed += batch.length;
        console.warn('Batch ' + batchNum + ' failed:', res.message);
      }
    } catch(e) {
      // Retry once after 2s
      await new Promise(r => setTimeout(r, 2000));
      try {
        const res2 = await gasBulkImport(batch);
        if (res2.success) totalImported += res2.count || batch.length;
        else failed += batch.length;
      } catch(e2) {
        failed += batch.length;
        console.warn('Batch ' + batchNum + ' retry also failed:', e2.message);
      }
    }

    // Small pause between batches to avoid GAS rate limit
    if (b < batches.length - 1) await new Promise(r => setTimeout(r, 800));
  }

  // ── FINAL RESULT ─────────────────────────────
  if (failed === 0) {
 if (statusEl) statusEl.innerHTML = `<div style="color:var(--green);font-size:1rem;font-weight:700">All ${totalImported} products imported successfully!</div>`;
 toast(` Imported ${totalImported} products!`, 'success');
    pendingImportRows = [];
    setTimeout(() => { closeModalDirect(); loadInventory(); }, 1500);
  } else if (totalImported > 0) {
 if (statusEl) statusEl.innerHTML = `<div style="color:#f59e0b;font-weight:700">️ Imported ${totalImported} products. ${failed} failed — try importing the rest again.</div>`;
 toast(`Partial import: ${totalImported} saved, ${failed} failed.`, 'warning');
 if (btn) { btn.disabled = false; btn.innerHTML = ' Retry Failed'; }
  } else {
 if (statusEl) statusEl.innerHTML = '<div style="color:#ef4444;font-weight:700">Import failed. Check your connection and try again.</div>';
 toast('Import failed. Try again.', 'error');
 if (btn) { btn.disabled = false; btn.innerHTML = ' Retry Import'; }
  }
}

// ═══════════════════════════════════════════════
// FINANCE
// ═══════════════════════════════════════════════
async function renderFinance() {
 document.getElementById('pageContent').innerHTML = `
<div class="finance-tabs">
      <button class="finance-tab active" onclick="switchFinanceTab('expenses',this)">💸 Expenses</button>
      <button class="finance-tab" onclick="switchFinanceTab('allowance',this)">💰 Allowance</button>
    </div>
    <div id="financeContent"></div>`;
  loadExpenses();
}

function switchFinanceTab(tab, btn) {
  document.querySelectorAll('.finance-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (tab === 'expenses') loadExpenses();
  else loadAllowance();
}

async function loadExpenses() {
  const el = document.getElementById('financeContent');
 el.innerHTML = `
<div class="card" style="margin-bottom:16px">
<div class="card-title">Add Expense</div>
<div class="input-row">
 <div class="field"><label for="exp_desc">Description</label><input id="exp_desc" name="exp_desc" placeholder="Expense description"></div>
 <div class="field"><label for="exp_amount">Amount (₱)</label><input id="exp_amount" name="exp_amount" type="number" min="0" step="0.01" placeholder="0.00"></div>
 <div class="field"><label for="exp_date">Date</label><input id="exp_date" name="exp_date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      </div>
<button class="btn btn-primary" onclick="saveExpense()">Add Expense</button>
    </div>
<div class="card">
<div class="card-title">Expense Records</div>
 <div id="expenseList"><div class="loading-spinner"><div class="spinner"></div></div></div>
    </div>`;
  try {
    const res = await gasRequest({ action: 'getExpenses' });
    const data = res.data || [];
    const total = data.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const el2 = document.getElementById('expenseList');
    if (!el2) return;
 if (!data.length) { el2.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No expenses recorded.</div></div>'; return; }
 el2.innerHTML = `
      <div style="background:var(--bg2);padding:12px;border-radius:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700">Total Expenses</span>
        <span style="font-family:var(--font-head);font-size:1.2rem;font-weight:800;color:#ef4444">₱${total.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
      </div>
 <div class="tbl-wrap"><table>
        <thead><tr><th>Description</th><th>Amount</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${data.map(e => `<tr>
          <td>${e.description}</td>
          <td class="text-red fw-700">₱${parseFloat(e.amount||0).toFixed(2)}</td>
          <td class="text-muted">${safeFormatDateOnly(e.date)}</td>
 <td><button class="btn btn-danger btn-sm" onclick="deleteExpense('${e.id}')">️</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
 } catch(e) { const el3 = document.getElementById('expenseList'); if (el3) el3.innerHTML = '<div class="no-data">Failed to load expenses.</div>'; }
}

async function saveExpense() {
  const desc = document.getElementById('exp_desc')?.value.trim();
  const amount = parseFloat(document.getElementById('exp_amount')?.value || 0);
  const date = document.getElementById('exp_date')?.value;
 if (!desc || !amount) { toast('Fill in description and amount.', 'error'); return; }
  try {
    const res = await gasPost({ action: 'addExpense', description: desc, amount, date, addedBy: currentUser.name });
 if (res.success) { toast('Expense saved!', 'success'); loadExpenses(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  try {
    const res = await gasPost({ action: 'deleteExpense', id });
 if (res.success) { toast('Deleted.', 'success'); loadExpenses(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

async function loadAllowance() {
  const el = document.getElementById('financeContent');
 el.innerHTML = `
<div class="card" style="margin-bottom:16px">
<div class="card-title">Add Allowance Record</div>
<div class="input-row">
 <div class="field"><label for="alw_for">For</label><input id="alw_for" name="alw_for" placeholder="Person / purpose"></div>
 <div class="field"><label for="alw_amount">Amount (₱)</label><input id="alw_amount" name="alw_amount" type="number" min="0" step="0.01"></div>
 <div class="field"><label for="alw_date">Date</label><input id="alw_date" name="alw_date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      </div>
<button class="btn btn-primary" onclick="saveAllowance()">Save</button>
    </div>
<div class="card">
<div class="card-title">Allowance Records</div>
 <div id="allowanceList"><div class="loading-spinner"><div class="spinner"></div></div></div>
    </div>`;
  try {
    const res = await gasRequest({ action: 'getAllowances' });
    const data = res.data || [];
    const total = data.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
    const el2 = document.getElementById('allowanceList');
    if (!el2) return;
 if (!data.length) { el2.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No allowance records.</div></div>'; return; }
 el2.innerHTML = `
      <div style="background:var(--bg2);padding:12px;border-radius:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700">Total Allowance</span>
        <span style="font-family:var(--font-head);font-size:1.2rem;font-weight:800;color:var(--green)">₱${total.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
      </div>
 <div class="tbl-wrap"><table>
        <thead><tr><th>For</th><th>Amount</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${data.map(e => `<tr>
          <td>${e.forPerson || e.for || ''}</td>
          <td class="text-green fw-700">₱${parseFloat(e.amount||0).toFixed(2)}</td>
          <td class="text-muted">${safeFormatDateOnly(e.date)}</td>
 <td><button class="btn btn-danger btn-sm" onclick="deleteAllowance('${e.id}')">️</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
 } catch(e) { const el3 = document.getElementById('allowanceList'); if (el3) el3.innerHTML = '<div class="no-data">Failed to load.</div>'; }
}

async function saveAllowance() {
  const forP = document.getElementById('alw_for')?.value.trim();
  const amount = parseFloat(document.getElementById('alw_amount')?.value || 0);
  const date = document.getElementById('alw_date')?.value;
 if (!forP || !amount) { toast('Fill all fields.', 'error'); return; }
  try {
    const res = await gasPost({ action: 'addAllowance', forPerson: forP, amount, date, addedBy: currentUser.name });
 if (res.success) { toast('Saved!', 'success'); loadAllowance(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

async function deleteAllowance(id) {
  if (!confirm('Delete this record?')) return;
  try {
    const res = await gasPost({ action: 'deleteAllowance', id });
 if (res.success) { toast('Deleted.', 'success'); loadAllowance(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

// ═══════════════════════════════════════════════
// CASHIERS
// ═══════════════════════════════════════════════
async function renderCashiers() {
 document.getElementById('pageContent').innerHTML = `
<div class="card" style="margin-bottom:16px">
<div class="card-title">Manage System Users</div>
<button class="btn btn-primary" onclick="openAddCashierModal()">Add User</button>
    </div>
<div class="card">
 <div id="cashierList"><div class="loading-spinner"><div class="spinner"></div></div></div>
    </div>`;
  loadCashiers();
}

async function loadCashiers() {
  try {
    const res = await gasRequest({ action: 'getCashiers' });
    const data = res.data || [];
    const el = document.getElementById('cashierList');
    if (!el) return;
 if (!data.length) { el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No users yet. Add your first cashier!</div></div>'; return; }
 el.innerHTML = `<div class="tbl-wrap"><table>
      <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${data.map(c => `<tr>
        <td><b>${c.name}</b></td>
        <td><span style="font-family:var(--font-mono);font-size:0.85rem">${c.username}</span></td>
        <td><span class="role-badge role-${c.role}">${c.role}</span></td>
        <td><span class="${c.active !== 'false' ? 'badge-in-stock' : 'badge-out'}">${c.active !== 'false' ? 'Active' : 'Inactive'}</span></td>
        <td>
<div class="gap-10">
<button class="btn btn-ghost btn-sm" onclick="openEditCashierModal('${c.id}')">️ Edit</button>
<button class="btn btn-danger btn-sm" onclick="deleteCashier('${c.id}')">️</button>
          </div>
        </td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch(e) {
    const el2 = document.getElementById('cashierList'); if (el2) el2.innerHTML = '<div class="no-data">Failed to load users.</div>';
  }
}

function openAddCashierModal() {
  openModal(`
<div class="modal-title">Add New User</div>
<div class="input-row">
 <div class="field"><label for="c_name">Full Name *</label><input id="c_name" placeholder="Full name"></div>
 <div class="field"><label for="c_username">Username *</label><input id="c_username" placeholder="Login username"></div>
    </div>
<div class="input-row">
 <div class="field"><label for="c_password">Password *</label><input id="c_password" type="password" placeholder="Password"></div>
 <div class="field"><label for="c_role">Role *</label>
        <select id="c_role" name="c_role">
          <option value="cashier">Cashier</option>
          <option value="clerk">Inventory Clerk</option>
          <option value="agent">Sales Agent (Incentives only)</option>
          <option value="verifier">Incentive Verifier (Verify/Reject only)</option>
          <option value="admin">Admin</option>
        </select>
      </div></div>
      <div class="input-row">
        <div class="field" style="grid-column:1/-1">
          <label for="c_branch">Branch <span style="color:var(--text3);font-weight:400">(required for Sales Agent)</span></label>
          <select id="c_branch" name="c_branch"><option value=''>-- No Branch --</option><option value='Vigan'>Vigan</option><option value='SDO'>SDO</option><option value='San Juan'>San Juan</option><option value='Cabugao1'>Cabugao 1</option><option value='Cabugao2'>Cabugao 2</option><option value='Laoag'>Laoag</option><option value='Candon'>Candon</option><option value='Tagudin'>Tagudin</option><option value='Elyu'>Elyu</option></select>
        </div>
      </div>
    </div>
<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveCashier()">Save User</button>`);
}

function openEditCashierModal(id) {
  gasRequest({ action: 'getCashiers' }).then(res => {
    const c = (res.data || []).find(x => x.id === id);
    if (!c) return;
    openModal(`
<div class="modal-title">️ Edit User — ${c.name}</div>
<div class="input-row">
 <div class="field"><label for="c_name">Full Name</label><input id="c_name" name="c_name" value="${c.name}"></div>
 <div class="field"><label for="c_username">Username</label><input id="c_username" name="c_username" value="${c.username}"></div>
      </div>
<div class="input-row">
 <div class="field"><label for="c_password">New Password (leave blank to keep)</label><input id="c_password" name="c_password" type="password" placeholder="New password"></div>
 <div class="field"><label for="c_role">Role</label>
          <select id="c_role">
            <option value="cashier" ${c.role==='cashier'?'selected':''}>Cashier</option>
            <option value="clerk" ${c.role==='clerk'?'selected':''}>Inventory Clerk</option>
            <option value="agent" ${c.role==='agent'?'selected':''}>Sales Agent (Incentives only)</option>
            <option value="verifier" ${c.role==='verifier'?'selected':''}>Incentive Verifier (Verify/Reject only)</option>
            <option value="employee" ${c.role==='employee'?'selected':''}>Employee (Installment only)</option>
            <option value="attstaff" ${c.role==='attstaff'?'selected':''}>Attendance Staff (Bundy only)</option>
            <option value="admin" ${c.role==='admin'?'selected':''}>Admin</option>
          </select>
        </div>
      </div>
      <div class="input-row">
        <div class="field" style="grid-column:1/-1">
          <label for="c_branch">Branch <span style="color:var(--text3);font-weight:400">(required for Sales Agent)</span></label>
          <select id="c_branch" name="c_branch"><option value=''>-- No Branch --</option><option value='Vigan' ${c.branch==='Vigan'?'selected':''}>Vigan</option><option value='SDO' ${c.branch==='SDO'?'selected':''}>SDO</option><option value='San Juan' ${c.branch==='San Juan'?'selected':''}>San Juan</option><option value='Cabugao1' ${c.branch==='Cabugao1'?'selected':''}>Cabugao 1</option><option value='Cabugao2' ${c.branch==='Cabugao2'?'selected':''}>Cabugao 2</option><option value='Laoag' ${c.branch==='Laoag'?'selected':''}>Laoag</option><option value='Candon' ${c.branch==='Candon'?'selected':''}>Candon</option><option value='Tagudin' ${c.branch==='Tagudin'?'selected':''}>Tagudin</option><option value='Elyu' ${c.branch==='Elyu'?'selected':''}>Elyu</option></select>
        </div>
      </div>
<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveCashier('${id}')">Update User</button>`);
  });
}

async function saveCashier(id = null) {
  const name = document.getElementById('c_name')?.value.trim();
  const username = document.getElementById('c_username')?.value.trim();
  const password = document.getElementById('c_password')?.value.trim();
  const role = document.getElementById('c_role')?.value;
 if (!name || !username) { toast('Name and username are required.', 'error'); return; }
 if (!id && !password) { toast('Password is required for new users.', 'error'); return; }
  try {
    const branch = document.getElementById('c_branch')?.value || '';
    const res = await gasPost({ action: id ? 'updateCashier' : 'addCashier', id, name, username, password, role, branch });
 if (res.success) { toast(id ? 'User updated!' : 'User added!', 'success'); closeModalDirect(); loadCashiers(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

async function deleteCashier(id) {
  if (!confirm('Delete this user? This cannot be undone.')) return;
  try {
    const res = await gasPost({ action: 'deleteCashier', id });
 if (res.success) { toast('User deleted.', 'success'); loadCashiers(); }
 else toast(res.message || 'Error.', 'error');
 } catch(e) { toast('Network error.', 'error'); }
}

// ═══════════════════════════════════════════════
// RECEIPTS
// ═══════════════════════════════════════════════
async function renderReceipts() {
  document.getElementById('pageContent').innerHTML = `
    <div class="tab-bar">
      <button class="tab-btn active" onclick="showLocalReceipts(this)">This Device</button>
      <button class="tab-btn" onclick="showGASReceipts(this)">All Receipts (Sheets)</button>
    </div>
    <div id="receiptsContent"><div class="loading-spinner"><div class="spinner"></div></div></div>`;
  showLocalReceipts(document.querySelector('.tab-btn'));
}

function showLocalReceipts(btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  let gallery = [], fullData = {};
  try { gallery = lsGet('ae_receipt_gallery', []); } catch(e) {}
  try { fullData = lsGet('ae_receipt_full', {}); } catch(e) {}
  const el = document.getElementById('receiptsContent');
  if (!el) return;
  if (!gallery.length) {
    el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No receipts on this device yet.</div></div>';
    return;
  }
  el.innerHTML = `
    <div class="card">
      <div class="card-title">Receipts — This Device</div>
      <p style="color:var(--text3);font-size:0.82rem;margin-bottom:14px">Click View to reprint any receipt.</p>
      <div class="tbl-wrap"><table>
        <thead><tr><th>SI #</th><th>TX #</th><th>Cashier</th><th>Total</th><th>Date</th><th>Action</th></tr></thead>
        <tbody>${gallery.map(r => {
          const hasFullData = !!fullData[r.txId];
          return `<tr>
            <td style="font-family:var(--font-mono);font-size:0.78rem">${r.siNum||'—'}</td>
            <td style="font-family:var(--font-mono);font-size:0.78rem">${r.txId}</td>
            <td>${r.cashier}</td>
            <td class="text-green fw-700">₱${parseFloat(r.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
            <td style="font-size:0.78rem">${safeFormatDateTime(r.date)}</td>
            <td>${hasFullData
              ? `<button class="btn btn-primary btn-sm" onclick="reprintReceipt('${r.txId}')">View / Print</button>`
              : `<span style="color:var(--text3);font-size:0.78rem">No data</span>`}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
}

async function showGASReceipts(btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const el = document.getElementById('receiptsContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div> Loading from Google Sheets...</div>';
  try {
    const res = await gasRequest({ action: 'getSales' });
    const sales = (res.data || []).reverse();
    if (!sales.length) {
      el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No sales records yet.</div></div>';
      return;
    }
    const fullData = lsGet('ae_receipt_full', {});
    el.innerHTML = `
      <div class="card">
        <div class="card-title">All Receipts — Google Sheets (${sales.length} total)</div>
        <div class="tbl-wrap"><table>
          <thead><tr><th>SI #</th><th>TX #</th><th>Cashier</th><th>Total</th><th>Date</th><th>Action</th></tr></thead>
          <tbody>${sales.map(s => {
            const hasLocal = !!fullData[s.transactionId];
            return `<tr>
              <td style="font-family:var(--font-mono);font-size:0.78rem">${s.siNumber||'—'}</td>
              <td style="font-family:var(--font-mono);font-size:0.78rem">${s.transactionId||''}</td>
              <td>${s.cashierName||''}</td>
              <td class="text-green fw-700">₱${parseFloat(s.total||0).toLocaleString('en-PH',{minimumFractionDigits:2})}</td>
              <td style="font-size:0.78rem">${safeFormatDateTime(s.date)}</td>
              <td>${hasLocal
                ? `<button class="btn btn-primary btn-sm" onclick="reprintReceipt('${s.transactionId}')">View / Print</button>`
                : `<button class="btn btn-ghost btn-sm" onclick="reprintFromSheets('${s.transactionId}')">Reprint</button>`}
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>`;
  } catch(e) {
    el.innerHTML = '<div class="no-data">Failed to load. Check connection.</div>';
  }
}

function reprintReceipt(txId) {
  const fullData = lsGet('ae_receipt_full', {});
  const data = fullData[txId];
  if (!data) { toast('Receipt data not available on this device.', 'warning'); return; }
  const reprintDate = parseDate(data.date) || new Date();
  generateAndShowReceipt({
    txId: data.txId, siNum: data.siNum, cashier: data.cashier,
    date: reprintDate, items: data.items,
    total: data.total, cash: data.cash, change: data.change
  });
}

async function reprintFromSheets(txId) {
  toast('Loading receipt from Sheets...', 'info');
  try {
    const res = await gasRequest({ action: 'getSales' });
    const sale = (res.data || []).find(s => s.transactionId === txId);
    if (!sale) { toast('Receipt not found.', 'error'); return; }
    const items = JSON.parse(sale.items || '[]');
    // Use parseDate() with TX fallback — safe against corrupted date values
    const saleDate = parseDate(sale.date, sale.transactionId || sale.siNumber) || new Date();
    generateAndShowReceipt({
      txId: sale.transactionId, siNum: sale.siNumber || '',
      cashier: sale.cashierName, date: saleDate,
      items, total: parseFloat(sale.total||0),
      cash: parseFloat(sale.cash||0), change: parseFloat(sale.change||0)
    });
  } catch(e) { toast('Failed to load receipt.', 'error'); }
}

// ═══════════════════════════════════════════════
// SALES SUMMARY
// ═══════════════════════════════════════════════
async function renderSummary() {
  document.getElementById('pageContent').innerHTML = `
    <div class="tab-bar" id="summaryTabBar">
      <button class="tab-btn active" id="sumTab_today"  onclick="loadSummary('today',this)">Today</button>
      <button class="tab-btn"        id="sumTab_week"   onclick="loadSummary('week',this)">This Week</button>
      <button class="tab-btn"        id="sumTab_month"  onclick="loadSummary('month',this)">This Month</button>
      <button class="tab-btn"        id="sumTab_all"    onclick="loadSummary('all',this)">All Time</button>
    </div>
    <div id="summaryContent"><div class="loading-spinner"><div class="spinner"></div></div></div>`;
  // Use the specific element ID to avoid querySelector finding wrong tab-btn
  loadSummary('today', document.getElementById('sumTab_today'));
}

async function loadSummary(period, btn) {
  const _stb = document.getElementById('summaryTabBar');
  if (_stb) _stb.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const el = document.getElementById('summaryContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    const res = await gasRequest({ action: 'getSales' });
    const all = res.data || [];
    const now = new Date();

    const { start: todayStart, end: todayEnd } = dayRange(now);
    const weekAgo2  = new Date(now - 7  * 86400000);
    const monthAgo2 = new Date(now - 30 * 86400000);
    const periodFilters = {
      today: s => {
        const d = parseDate(s.date, s.transactionId || s.siNumber);
        return d && d >= todayStart && d <= todayEnd;
      },
      week:  s => { const d = parseDate(s.date, s.transactionId || s.siNumber); return d && d >= weekAgo2; },
      month: s => { const d = parseDate(s.date, s.transactionId || s.siNumber); return d && d >= monthAgo2; },
      all:   () => true,
    };
    const filtered = all.filter(periodFilters[period] || (() => true));
    // Store for export buttons
    window.summaryExportData = { filtered, validTx: filtered.filter(t => t.status !== 'VOID'), period, periodLabel: '' };
    const voidTx   = filtered.filter(t => t.status === 'VOID');
    const validTx  = filtered.filter(t => t.status !== 'VOID');

    if (!filtered.length) {
      el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No transactions for this period.</div></div>';
      return;
    }

    const grandTotal    = validTx.reduce((s, t) => s + parseFloat(t.total || 0), 0);
    const vatAmount     = grandTotal * 0.12 / 1.12;
    const netAmount     = grandTotal - vatAmount;
    const cashierTotals = {};
    const allItemTotals = {};
    let   totalQty      = 0;

    validTx.forEach(t => {
      cashierTotals[t.cashierName] = (cashierTotals[t.cashierName] || 0) + parseFloat(t.total || 0);
      try {
        JSON.parse(t.items || '[]').forEach(it => {
          if (!allItemTotals[it.name]) allItemTotals[it.name] = { qty: 0, total: 0 };
          allItemTotals[it.name].qty   += it.qty;
          allItemTotals[it.name].total += it.total;
          totalQty += it.qty;
        });
      } catch(e) {}
    });

    const periodLabel = { today: "Today's", week: "This Week's", month: "This Month's", all: "All-Time" }[period];

    // ── 24hr reset tracking
    const resetKey  = 'ae_summary_reset_' + period;
    let   lastReset = null;
    try { lastReset = localStorage.getItem(resetKey); } catch(e) {}
    const lastResetStr = lastReset
      ? 'Last reset: ' + safeFormatDateTime(lastReset)
      : 'Not yet reset today';

    el.innerHTML = `
      <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary" onclick="generateAndDownloadSummary('${period}')">
          📄 Image Receipt
        </button>
        <button class="btn btn-success" onclick="downloadSummaryExcel('${period}', summaryExportData)">
          📊 Download Excel
        </button>
        <button class="btn btn-ghost" onclick="downloadSummaryCSV('${period}', summaryExportData)">
          📋 Download CSV
        </button>
        <button class="btn btn-ghost btn-sm" onclick="markSummaryReset('${period}')">
          ✅ Mark Reset
        </button>
        <button class="btn btn-ghost btn-sm" onclick="loadSummary('${period}',document.getElementById('sumTab_${period}'))">↺ Refresh</button>
        <span style="font-size:0.78rem;color:var(--text3);margin-left:auto">${lastResetStr}</span>
      </div>

      <div class="summary-receipt" id="summaryReceiptEl">
        <div class="summary-header">
          <div style="font-size:1.5rem">🏪</div>
          <h2>AE HOME — ${periodLabel} Sales Summary</h2>
          <div style="font-size:0.8rem;color:var(--text3)">Generated: ${new Date().toLocaleString('en-PH')}</div>
          <div style="font-size:0.8rem;color:var(--text3)">${validTx.length} transactions${voidTx.length > 0 ? ' <span style="color:#ef4444">(' + voidTx.length + ' voided)</span>' : ''}</div>
          ${lastReset ? '<div style="font-size:0.78rem;color:var(--green);margin-top:4px">✅ ' + lastResetStr + '</div>' : ''}
        </div>

        <div class="summary-section-title">Items Sold</div>
        ${Object.entries(allItemTotals).length
          ? Object.entries(allItemTotals).sort((a,b) => b[1].qty - a[1].qty).map(([name, d]) => `
            <div class="summary-row">
              <span>${name}</span>
              <span>${d.qty} pcs — ${formatPHP(d.total)}</span>
            </div>`).join('')
          : '<div style="color:var(--text3);font-size:0.82rem;padding:8px 0">No items data.</div>'
        }
        <div class="summary-row" style="font-weight:700;border-top:2px solid var(--border);margin-top:4px">
          <span>Total Qty Sold</span><span>${totalQty} pcs</span>
        </div>

        <div class="summary-section-title">Cashier Performance</div>
        ${Object.entries(cashierTotals).map(([name, total]) => `
          <div class="summary-row">
            <span>${name}</span>
            <span class="text-green fw-700">${formatPHP(total)}</span>
          </div>`).join('')}

        <div class="summary-section-title">Financials</div>
        <div class="summary-row"><span>Gross Sales</span><span>${formatPHP(grandTotal)}</span></div>
        <div class="summary-row"><span>VAT (12% incl.)</span><span>${formatPHP(vatAmount)}</span></div>
        <div class="summary-grand">
          <span>NET AMOUNT DUE</span>
          <span>${formatPHP(netAmount)}</span>
        </div>

        <div class="summary-section-title" style="margin-top:20px">Transaction Details</div>
        <div class="tbl-wrap" style="max-height:360px;overflow-y:auto">
          <table>
            <thead><tr><th>TX#</th><th>Cashier</th><th>Total</th><th>Date</th></tr></thead>
            <tbody>${filtered.map(t => {
              const isVoid = t.status === 'VOID';
              return `<tr style="${isVoid ? 'opacity:0.5;background:#fff5f5' : ''}">
                <td style="font-family:var(--font-mono);font-size:0.78rem">${t.transactionId || ''}${isVoid ? ' <span style="background:#ef4444;color:white;padding:1px 6px;border-radius:4px;font-size:0.65rem;font-weight:700">VOID</span>' : ''}</td>
                <td>${t.cashierName || ''}</td>
                <td class="${isVoid ? 'text-red' : 'text-green fw-700'}" style="${isVoid ? 'text-decoration:line-through' : ''}">${formatPHP(t.total)}</td>
                <td style="font-size:0.78rem">${safeFormatDateTime(t.date)}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>`;

  } catch(e) {
    const el2 = document.getElementById('summaryContent');
    if (el2) el2.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Failed to load summary. Check connection.</div></div>';
  }
}

// ─── SUMMARY EXPORT ──────────────────────────
function buildSummaryRows(exportData) {
  const { validTx } = exportData || {};
  if (!validTx || !validTx.length) return [];

  // Aggregate sold items keyed by productId+unit so each variant is its own row
  const itemMap = {};
  validTx.forEach(t => {
    try {
      JSON.parse(t.items || '[]').forEach(it => {
        const key = (it.productId || it.name) + '|' + (it.unit || 'piece');
        if (!itemMap[key]) {
          itemMap[key] = {
            barcode: it.barcode || '',
            name:    it.name    || '',
            unit:    it.unit    || 'piece',
            qty:     0,
            price:   parseFloat(it.price || 0),
            total:   0,
          };
        }
        itemMap[key].qty   += parseInt(it.qty   || 0);
        itemMap[key].total += parseFloat(it.total || 0);
        // Fill barcode if it was missing on earlier sales but found now
        if (!itemMap[key].barcode && it.barcode) itemMap[key].barcode = it.barcode;
      });
    } catch(e) {}
  });

  // Sort by qty sold descending, then name ascending
  const rows = Object.values(itemMap).sort((a, b) =>
    b.qty !== a.qty ? b.qty - a.qty : a.name.localeCompare(b.name)
  );

  return rows.map((r, i) => ({
    stockNo:   String(i + 1).padStart(4, '0'),
    barcode:   r.barcode,
    name:      r.name,
    qty:       r.qty,
    uom:       r.unit === 'pack' ? 'PK' : 'PC',
    price:     parseFloat(r.price||0).toFixed(2),
    amount:    parseFloat(r.total||0).toFixed(2),
    discount1: '',
    discount2: '',
    discount3: '',
    discount4: '',
    remarks:   '',
  }));
}

async function downloadSummaryExcel(period, exportData) {
  if (!exportData || !exportData.validTx || !exportData.validTx.length) {
    toast('No data to export.', 'warning'); return;
  }
  toast('Preparing Excel file...', 'info');
  try {

    const rows  = buildSummaryRows(exportData);
    const now   = new Date();
    const label = { today: 'Today', week: 'This-Week', month: 'This-Month', all: 'All-Time' }[period] || period;
    const grandTotal = exportData.validTx.reduce((s, t) => s + parseFloat(t.total || 0), 0);
    const vatAmount  = grandTotal * 0.12 / 1.12;

    // ── Header columns (matches your screenshot exactly + added Name & Amount)
    const HEADER = [
      'Stock No.', 'Barcode', 'Product Name', 'Quantity', 'UOM Code',
      'Price', 'Amount', 'Discount 1', 'Discount 2', 'Discount 3', 'Discount 4', 'Remarks'
    ];

    const dataRows = rows.map(r => [
      r.stockNo, r.barcode, r.name, r.qty, r.uom,
      r.price, r.amount, r.discount1, r.discount2, r.discount3, r.discount4, r.remarks
    ]);

    // ── Totals row
    const totalRow = [
      '', '', 'TOTAL', rows.reduce((s, r) => s + r.qty, 0), '',
      '', grandTotal.toFixed(2), '', '', '', '', ''
    ];

    // ── Build sheet: info block + blank + header + data + blank + totals
    const sheetData = [
      ['AE HOME — Sales Summary Report'],
      ['Period:',       label],
      ['Generated:',    now.toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })],
      ['Transactions:', exportData.validTx.length],
      ['Total Items:',  rows.length],
      [],
      HEADER,
      ...dataRows,
      [],
      totalRow,
      [],
      ['', '', 'Gross Sales',    '', '', '', grandTotal.toFixed(2)],
      ['', '', 'VAT (12% incl.)', '', '', '', vatAmount.toFixed(2)],
      ['', '', 'Net Sales',      '', '', '', (grandTotal - vatAmount).toFixed(2)],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // ── Apply bold + yellow background to header row (row index 6)
    const HEADER_ROW_IDX = 6;
    for (let c = 0; c < HEADER.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: HEADER_ROW_IDX, c });
      if (!ws[addr]) ws[addr] = { v: HEADER[c] };
      ws[addr].s = {
        font:      { bold: true, color: { rgb: '000000' } },
        fill:      { patternType: 'solid', fgColor: { rgb: 'FFD966' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
          bottom: { style: 'medium', color: { rgb: '000000' } },
          top:    { style: 'thin',   color: { rgb: '888888' } },
        }
      };
    }

    // ── Style title row bold
    const titleAddr = XLSX.utils.encode_cell({ r: 0, c: 0 });
    if (ws[titleAddr]) ws[titleAddr].s = { font: { bold: true, sz: 14 } };

    // ── Style totals row bold + yellow
    const totalRowIdx = HEADER_ROW_IDX + dataRows.length + 2;
    for (let c = 0; c < HEADER.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: totalRowIdx, c });
      if (ws[addr]) ws[addr].s = { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'FFF2CC' } } };
    }

    // ── Column widths
    ws['!cols'] = [
      { wch: 10 }, // Stock No.
      { wch: 18 }, // Barcode
      { wch: 32 }, // Product Name
      { wch: 10 }, // Quantity
      { wch: 10 }, // UOM Code
      { wch: 12 }, // Price
      { wch: 14 }, // Amount
      { wch: 12 }, // Discount 1
      { wch: 12 }, // Discount 2
      { wch: 12 }, // Discount 3
      { wch: 12 }, // Discount 4
      { wch: 20 }, // Remarks
    ];

    // ── Freeze header row
    ws['!freeze'] = { xSplit: 0, ySplit: HEADER_ROW_IDX + 1 };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sales Summary');

    // ── Second sheet: raw transactions
    const txHeader = ['TX#', 'SI#', 'Cashier', 'Total', 'Cash', 'Change', 'Date', 'Status'];
    const txRows   = exportData.validTx.map(t => [
      t.transactionId || '', t.siNumber || '',
      t.cashierName   || '', parseFloat(t.total  || 0),
      parseFloat(t.cash   || 0), parseFloat(t.change || 0),
      safeFormatDateTime(t.date, ''),
      t.status || 'ACTIVE'
    ]);
    const txSheet = XLSX.utils.aoa_to_sheet([txHeader, ...txRows]);
    txSheet['!cols'] = [{ wch: 20 },{ wch: 14 },{ wch: 18 },{ wch: 14 },{ wch: 14 },{ wch: 14 },{ wch: 22 },{ wch: 10 }];
    XLSX.utils.book_append_sheet(wb, txSheet, 'Transactions');

    const filename = `AE-HOME-Sales-${label}-${now.toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast('Excel downloaded!', 'success');
  } catch(e) {
    toast('Excel export failed: ' + e.message, 'error');
  }
}

function downloadSummaryCSV(period, exportData) {
  if (!exportData || !exportData.validTx || !exportData.validTx.length) {
    toast('No data to export.', 'warning'); return;
  }
  const rows  = buildSummaryRows(exportData);
  const label = { today: 'Today', week: 'This-Week', month: 'This-Month', all: 'All-Time' }[period] || period;
  const now   = new Date();
  const grandTotal = exportData.validTx.reduce((s, t) => s + parseFloat(t.total || 0), 0);
  const vatAmount  = grandTotal * 0.12 / 1.12;

  const esc = v => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('\"') || s.indexOf('\n') >= 0)
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const row = cols => cols.map(esc).join(',');

  const lines = [
    row(['AE HOME — Sales Summary Report']),
    row(['Period:', label]),
    row(['Generated:', now.toLocaleString('en-PH')]),
    row(['Transactions:', exportData.validTx.length]),
    row(['Total Items:', rows.length]),
    '',
    row(['Stock No.','Barcode','Product Name','Quantity','UOM Code','Price','Amount','Discount 1','Discount 2','Discount 3','Discount 4','Remarks']),
    ...rows.map(r => row([r.stockNo, r.barcode, r.name, r.qty, r.uom, r.price, r.amount, r.discount1, r.discount2, r.discount3, r.discount4, r.remarks])),
    '',
    row(['','','TOTAL', rows.reduce((s,r) => s + r.qty, 0), '', '', grandTotal.toFixed(2)]),
    '',
    row(['','','Gross Sales','','','', grandTotal.toFixed(2)]),
    row(['','','VAT (12% incl.)','','','', vatAmount.toFixed(2)]),
    row(['','','Net Sales','','','', (grandTotal - vatAmount).toFixed(2)]),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href     = URL.createObjectURL(blob);
  link.download = `AE-HOME-Sales-${label}-${now.toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast('CSV downloaded!', 'success');
}


function markSummaryReset(period) {
  if (!confirm('Mark this summary as reset? This records the current time as the last reset.')) return;
  lsSet('ae_summary_reset_' + period, new Date().toISOString());
  toast('Reset timestamp saved!', 'success');
  loadSummary(period, null);
}

async function generateAndDownloadSummary(period) {
  const el = document.getElementById('summaryReceiptEl');
  if (!el) { toast('No summary to generate.', 'warning'); return; }
  toast('Generating summary image...', 'info');
  try {
    if (typeof html2canvas === 'undefined') {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const link   = document.createElement('a');
    link.download = 'AE-HOME-Summary-' + period + '-' + new Date().toISOString().slice(0,10) + '.png';
    link.href     = canvas.toDataURL('image/png');
    link.click();
    toast('Summary downloaded!', 'success');
  } catch(e) {
    toast('Failed to generate image. Try again.', 'error');
  }
}

async function generateSummaryReceipt(period) {
  return generateAndDownloadSummary(period);
}



// ═══════════════════════════════════════════════
// ANALYTICS & INSIGHTS (replaces Inv. Logs)
// ═══════════════════════════════════════════════
async function renderLogs() {
 document.getElementById('pageContent').innerHTML = `
<div class="analytics-grid" id="analyticsCards">
      ${['Gross Revenue Today','This Week Revenue','Total SKUs','Low Stock Items','Transactions Today','All-Time Revenue'].map((l,i) =>
 `<div class="analytics-card ${['','green','','orange','green','purple'][i]}">
<div class="ac-label">${l}</div>
<div class="ac-value" id="ac_${i}">—</div>
 <div class="ac-sub" id="ac_sub_${i}"></div>
        </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
<div class="card">
<div class="card-title">Top Products</div>
 <div id="topProducts"><div class="loading-spinner"><div class="spinner"></div></div></div>
      </div>
<div class="card">
<div class="card-title">Recent Stock Movements</div>
 <div id="recentLogs"><div class="loading-spinner"><div class="spinner"></div></div></div>
      </div>
    </div>`;

  try {
    const [salesRes, productsRes, logsRes] = await Promise.all([
      gasRequest({ action: 'getSales' }),
      gasRequest({ action: 'getProducts' }),
      gasRequest({ action: 'getInventoryLogs' }),
    ]);
    const sales = salesRes.data || [];
    const products = productsRes.data || [];
    const logs = (logsRes.data || []).reverse();
    const now = new Date();
    const { start: logStart, end: logEnd } = dayRange(now);
    const weekAgo  = new Date(now - 7 * 86400000);

    const todaySales = sales.filter(s => { const d = parseDate(s.date); return d && d >= logStart && d <= logEnd; });
    const weekSales  = sales.filter(s => { const d = parseDate(s.date); return d && d >= weekAgo; });
    const lowStock = products.filter(p => parseInt(p.qtyPcs||0) <= 5);
    const sum = arr => arr.reduce((a,s) => a + parseFloat(s.total||0), 0);
    const allTotal = sum(sales);

 document.getElementById('ac_0').textContent = '₱' + sum(todaySales).toLocaleString('en-PH',{minimumFractionDigits:2});
 document.getElementById('ac_sub_0').textContent = todaySales.length + ' transactions';
 document.getElementById('ac_1').textContent = '₱' + sum(weekSales).toLocaleString('en-PH',{minimumFractionDigits:2});
 document.getElementById('ac_sub_1').textContent = weekSales.length + ' transactions';
 document.getElementById('ac_2').textContent = products.length;
 document.getElementById('ac_sub_2').textContent = 'products in system';
 document.getElementById('ac_3').textContent = lowStock.length;
 document.getElementById('ac_sub_3').textContent = 'items need restocking';
 document.getElementById('ac_4').textContent = todaySales.length;
 document.getElementById('ac_sub_4').textContent = 'completed today';
 document.getElementById('ac_5').textContent = '₱' + allTotal.toLocaleString('en-PH',{minimumFractionDigits:2});
 document.getElementById('ac_sub_5').textContent = sales.length + ' total transactions';

    // Top products from sales
    const itemTotals = {};
    sales.forEach(s => {
      try {
        JSON.parse(s.items||'[]').forEach(it => {
          itemTotals[it.name] = (itemTotals[it.name]||0) + it.qty;
        });
      } catch(e) {}
    });
    const topItems = Object.entries(itemTotals).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const tpEl = document.getElementById('topProducts');
 if (tpEl) tpEl.innerHTML = topItems.length ? topItems.map(([name,qty],i) =>`
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.85rem">
        <span>${['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣'][i]} ${name}</span>
        <span class="text-green fw-700">${qty} sold</span>
      </div>`).join('') :
 '<div class="no-data"><div class="no-data-icon"></div><div>No sales data yet.</div></div>';

    // Recent logs
    const rlEl = document.getElementById('recentLogs');
 if (rlEl) rlEl.innerHTML = logs.length ? `<div class="tbl-wrap"><table>
      <thead><tr><th>Product</th><th>Type</th><th>Qty</th><th>By</th></tr></thead>
      <tbody>${logs.slice(0,8).map(l=>`<tr>
        <td style="font-size:0.82rem">${l.productName||''}</td>
        <td><span class="${l.type==='in'?'log-in':l.type==='sale'?'log-sale':'log-out'}">${(l.type||'').toUpperCase()}</span></td>
        <td>${l.qty}</td>
        <td style="font-size:0.78rem">${l.adjustedBy||''}</td>
      </tr>`).join('')}</tbody>
    </table></div>` :
 '<div class="no-data"><div class="no-data-icon"></div><div>No logs yet.</div></div>';

  } catch(e) {
 toast('Failed to load analytics.', 'error');
  }
}





// ═══════════════════════════════════════════════
// SALES EXPORT PAGE
// ═══════════════════════════════════════════════
async function renderSalesExport() {
  const todayStr = localDateStr(new Date());
  const pc = document.getElementById('pageContent');
  if (!pc) return;
  pc.innerHTML =
    '<div class="inv-toolbar" style="flex-wrap:wrap;gap:10px">' +
      '<div class="field" style="margin-bottom:0">' +
        '<label style="font-size:0.75rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">From</label>' +
        '<input type="date" id="seFrom" value="' + todayStr + '" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-family:var(--font-main);background:white">' +
      '</div>' +
      '<div class="field" style="margin-bottom:0">' +
        '<label style="font-size:0.75rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">To</label>' +
        '<input type="date" id="seTo" value="' + todayStr + '" style="padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-family:var(--font-main);background:white">' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
        '<button class="btn btn-ghost btn-sm" onclick="setSEPeriod(\'today\')">Today</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="setSEPeriod(\'yesterday\')">Yesterday</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="setSEPeriod(\'week\')">This Week</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="setSEPeriod(\'month\')">This Month</button>' +
        '<button class="btn btn-primary btn-sm" onclick="loadSalesExport()">Filter</button>' +
      '</div>' +
      '<div style="margin-left:auto;display:flex;gap:8px">' +
        '<button class="btn btn-success btn-sm" id="seExcelBtn" onclick="exportSalesExcelFromPage()" disabled>Export Excel</button>' +
        '<button class="btn btn-ghost btn-sm" id="seCSVBtn" onclick="exportSalesCSVFromPage()" disabled>Export CSV</button>' +
        '<button class="btn btn-danger btn-sm" onclick="clearSalesExportData()" title="Clear all local export records">Clear Data</button>' +
      '</div>' +
    '</div>' +
    '<div class="card" style="margin-top:0">' +
      '<div id="seTable"><div class="loading-spinner"><div class="spinner"></div></div></div>' +
    '</div>';

  loadSalesExport().catch(e => {
    console.error('[POS] renderSalesExport error:', e);
    const el = document.getElementById('seTable');
    if (el) el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Failed to load export data.</div></div>';
  });
}

function setSEPeriod(period) {
  var now = new Date();
  var todayStr = localDateStr(now);
  var from = todayStr, to = todayStr;
  if (period === 'yesterday') {
    var y = new Date(now - 86400000);
    from = to = localDateStr(y);
  } else if (period === 'week') {
    from = localDateStr(new Date(now - 6 * 86400000));
    to   = todayStr;
  } else if (period === 'month') {
    from = localDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
    to   = todayStr;
  }
  var fe = document.getElementById('seFrom');
  var te = document.getElementById('seTo');
  if (fe) fe.value = from;
  if (te) te.value = to;
  loadSalesExport();
}

var _seCurrentData = [];

async function loadSalesExport() {
  var fromVal = document.getElementById('seFrom') ? document.getElementById('seFrom').value : '';
  var toVal   = document.getElementById('seTo')   ? document.getElementById('seTo').value   : '';
  var el      = document.getElementById('seTable');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  var from = fromVal ? new Date(fromVal + 'T00:00:00') : null;
  var to   = toVal   ? new Date(toVal   + 'T23:59:59') : null;

  // Try local storage first
  var rows = getSalesExportLocal((from && to) ? { from: from, to: to } : null);

  // If empty, try GAS
  if (!rows.length) {
    try {
      var params = { action: 'getSalesExport' };
      if (fromVal) params.from = fromVal + 'T00:00:00';
      if (toVal)   params.to   = toVal   + 'T23:59:59';
      var res = await gasRequest(params);
      if (res.success) rows = res.data || [];
    } catch(e) {}
  }

  _seCurrentData = rows;

  var eb = document.getElementById('seExcelBtn');
  var cb = document.getElementById('seCSVBtn');
  if (eb) eb.disabled = !rows.length;
  if (cb) cb.disabled = !rows.length;

  if (!rows.length) {
    el.innerHTML =
      '<div class="no-data">' +
        '<div class="no-data-icon"></div>' +
        '<div class="no-data-text">No export records for this period.<br>' +
          '<span style="font-size:0.8rem;color:var(--text3)">Records are auto-generated after each checkout.</span>' +
        '</div>' +
      '</div>';
    return;
  }

  var totalAmt = rows.reduce(function(s, r) { return s + parseFloat(r.amount || 0); }, 0);
  var totalQty = rows.reduce(function(s, r) { return s + parseInt(r.quantity || 0); }, 0);

  var rowsHtml = rows.map(function(r, i) {
    return '<tr>' +
      '<td class="text-muted" style="font-size:0.75rem">' + (i + 1) + '</td>' +
      '<td style="font-family:var(--font-mono);font-size:0.72rem">' + (r.transactionId || '') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.transactionDate || '') + '</td>' +
      '<td style="font-size:0.78rem">' + (r.transactionTime || '') + '</td>' +
      '<td style="font-size:0.8rem">' + (r.cashier || '') + '</td>' +
      '<td style="font-family:var(--font-mono);font-size:0.75rem">' + (r.barcode || '—') + '</td>' +
      '<td style="font-size:0.82rem"><b>' + (r.productName || '') + '</b></td>' +
      '<td class="fw-700">' + (r.quantity || 0) + '</td>' +
      '<td><span class="badge-in-stock" style="font-size:0.7rem">' + (r.uomCode || 'PC') + '</span></td>' +
      '<td class="fw-700">\u20b1' + parseFloat(r.price || 0).toFixed(2) + '</td>' +
      '<td class="text-green fw-700">\u20b1' + parseFloat(r.amount || 0).toFixed(2) + '</td>' +
      '<td>' + (r.discount1 || '') + '</td>' +
      '<td>' + (r.discount2 || '') + '</td>' +
      '<td>' + (r.discount3 || '') + '</td>' +
      '<td>' + (r.discount4 || '') + '</td>' +
      '<td><span class="role-badge role-cashier" style="font-size:0.7rem">' + (r.paymentMethod || r.remarks || 'Cash Sale') + '</span></td>' +
    '</tr>';
  }).join('');

  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">' +
      '<span style="font-size:0.85rem;font-weight:700;color:var(--text2)">' + rows.length + ' record' + (rows.length !== 1 ? 's' : '') + ' found</span>' +
      '<span style="font-size:0.85rem;color:var(--text2)">Total Qty: <b>' + totalQty + '</b> &nbsp;|&nbsp; Total Amount: <b class=\'text-green\'>\u20b1' + totalAmt.toFixed(2) + '</b></span>' +
    '</div>' +
    '<div class="tbl-wrap" style="max-height:60vh;overflow-y:auto">' +
      '<table>' +
        '<thead><tr>' +
          '<th>#</th><th>TX ID</th><th>Date</th><th>Time</th><th>Cashier</th>' +
          '<th>Barcode</th><th>Product Name</th><th>Qty</th><th>UOM</th>' +
          '<th>Price</th><th>Amount</th><th>Disc 1</th><th>Disc 2</th>' +
          '<th>Disc 3</th><th>Disc 4</th><th>Payment</th>' +
        '</tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>' +
    '</div>';
}

function clearSalesExportData() {
  if (!confirm('Clear all local Sales Export records from this device?\nThis only removes the local copy — Google Sheets data is not affected.')) return;
  lsDel('ae_sales_export');
  _seCurrentData = [];
  toast('Sales Export data cleared.', 'success');
  loadSalesExport();
}

async function exportSalesExcelFromPage() {
  if (!_seCurrentData.length) { toast('No data to export.', 'warning'); return; }
  var fromVal = document.getElementById('seFrom') ? document.getElementById('seFrom').value : localDateStr(new Date());
  var toVal   = document.getElementById('seTo')   ? document.getElementById('seTo').value   : fromVal;
  var label   = fromVal === toVal ? fromVal : (fromVal + '_to_' + toVal);
  await exportSalesExcel(_seCurrentData, label);
}

function exportSalesCSVFromPage() {
  if (!_seCurrentData.length) { toast('No data to export.', 'warning'); return; }
  var fromVal = document.getElementById('seFrom') ? document.getElementById('seFrom').value : localDateStr(new Date());
  var toVal   = document.getElementById('seTo')   ? document.getElementById('seTo').value   : fromVal;
  var label   = fromVal === toVal ? fromVal : (fromVal + '_to_' + toVal);
  exportSalesCSV(_seCurrentData, label);
}

async function exportSalesExcel(rows, label) {
  toast('Preparing Excel...', 'info');
  try {
    var HEADER = [
      '#', 'Transaction ID', 'Date', 'Time', 'Cashier',
      'Barcode', 'Stock No.', 'Product Name',
      'Quantity', 'UOM Code',
      'Discount 1', 'Discount 2', 'Discount 3', 'Discount 4',
      'Price', 'Amount', 'Payment Method'
    ];
    var data = [HEADER].concat(rows.map(function(r, i) {
      return [
        i + 1, r.transactionId, r.transactionDate, r.transactionTime,
        r.cashier, r.barcode, r.stockNo, r.productName,
        parseInt(r.quantity || 0), r.uomCode,
        r.discount1, r.discount2, r.discount3, r.discount4,
        parseFloat(r.price || 0), parseFloat(r.amount || 0),
        r.paymentMethod || r.remarks || 'Cash Sale'
      ];
    }));
    var ws = XLSX.utils.aoa_to_sheet(data);
    for (var c = 0; c < HEADER.length; c++) {
      var addr = XLSX.utils.encode_cell({ r: 0, c: c });
      if (ws[addr]) ws[addr].s = { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'FFD966' } } };
    }
    ws['!cols'] = [
      {wch:5},{wch:20},{wch:12},{wch:10},{wch:16},
      {wch:18},{wch:10},{wch:32},
      {wch:10},{wch:10},
      {wch:12},{wch:12},{wch:12},{wch:12},
      {wch:12},{wch:14},{wch:16}
    ];
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sales Export');
    XLSX.writeFile(wb, 'SalesExport_' + label + '.xlsx');
    toast('Excel downloaded!', 'success');
  } catch(e) {
    toast('Export failed: ' + e.message, 'error');
  }
}

function exportSalesCSV(rows, label) {
  var esc = function(v) {
    var s = String(v != null ? v : '');
    return (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0)
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  var r1 = function(cols) { return cols.map(esc).join(','); };
  var lines = [
    r1(['#','Transaction ID','Date','Time','Cashier',
        'Barcode','Stock No.','Product Name',
        'Quantity','UOM Code',
        'Discount 1','Discount 2','Discount 3','Discount 4',
        'Price','Amount','Payment Method'])
  ].concat(rows.map(function(r, i) {
    return r1([
      i + 1, r.transactionId, r.transactionDate, r.transactionTime,
      r.cashier, r.barcode, r.stockNo, r.productName,
      r.quantity, r.uomCode,
      r.discount1, r.discount2, r.discount3, r.discount4,
      r.price, r.amount, r.paymentMethod || r.remarks || 'Cash Sale'
    ]);
  }));
  var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement('a');
  link.href     = URL.createObjectURL(blob);
  link.download = 'SalesExport_' + label + '.csv';
  link.click();
  URL.revokeObjectURL(link.href);
  toast('CSV downloaded!', 'success');
}


// Enter key for login handled in the global keydown listener above

// ═══════════════════════════════════════════════
// WHOLESALERS INFORMATION MODULE
// Permissions: Admin=full, Cashier=view+add, Clerk=view+search
// ═══════════════════════════════════════════════

let _wholesalersCache = []; // in-memory cache for search
let _wsSearchTimeout  = null;

// ── RENDER PAGE ───────────────────────────────
async function renderWholesalers() {
  const role    = currentUser.role;
  const canAdd  = ['admin', 'cashier'].includes(role);
  const canEdit = role === 'admin';
  const canDel  = role === 'admin';

  document.getElementById('pageContent').innerHTML =
    '<div class="inv-toolbar" style="flex-wrap:wrap;gap:10px;margin-bottom:16px">' +
      '<div class="search-wrap" style="flex:1;min-width:220px;margin-bottom:0">' +
        '<span class="search-icon">🔍</span>' +
        '<input type="text" id="wsSearch" placeholder="Search by name, store, contact, category..." ' +
               'oninput="onWsSearch(this.value)" autocomplete="off">' +
      '</div>' +
      (canAdd ? '<button class="btn btn-primary" onclick="openAddWholesalerModal()">+ Add Wholesaler</button>' : '') +
    '</div>' +
    '<div class="card">' +
      '<div id="wholesalerTable"><div class="loading-spinner"><div class="spinner"></div> Loading...</div>' + ih_barHtml() + '</div>' +
    '</div>';

  await loadWholesalers();
}

// ── LOAD & RENDER TABLE ───────────────────────
async function loadWholesalers() {
  try {
    const res = await gasRequest({ action: 'getWholesalers' });
    _wholesalersCache = res.data || [];
    renderWholesalerTable(_wholesalersCache);
  } catch(e) {
    const el = document.getElementById('wholesalerTable');
    if (el) el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Failed to load wholesalers. Check connection.</div></div>';
    toast('Could not load wholesalers.', 'error');
  }
}

function renderWholesalerTable(data) {
  const el = document.getElementById('wholesalerTable');
  if (!el) return;

  const role    = currentUser.role;
  const canEdit = role === 'admin';
  const canDel  = role === 'admin';
  const showAct = canEdit || canDel;

  if (!data.length) {
    el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div class="no-data-text">No wholesalers found.<br><span style="font-size:0.8rem;color:var(--text3)">Add your first wholesaler to get started.</span></div></div>';
    return;
  }

  const rows = data.map(w => {
    const phone    = (w.contact_number || '').replace(/[^0-9+]/g, '');
    const phoneNum = w.contact_number || '—';
    const createdAt = safeFormatDateTime(w.created_at, '—');

    const phoneCell =
      '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
        '<span style="font-family:var(--font-mono);font-size:0.82rem">' + phoneNum + '</span>' +
        (phone ? (
          '<a href="tel:' + phone + '" class="ws-call-btn" title="Call" aria-label="Call ' + phoneNum + '">📞</a>' +
          '<button class="ws-copy-btn" onclick="wsClipboard(\'' + (w.contact_number||'').replace(/'/g,"\\'") + '\')" title="Copy number">Copy</button>'
        ) : '') +
      '</div>';

    const actCell = showAct
      ? '<td><div style="display:flex;gap:5px;flex-wrap:wrap">' +
          (canEdit ? '<button class="inv-btn inv-btn-edit" onclick="openEditWholesalerModal(\'' + w.id + '\')">Edit</button>' : '') +
          (canDel  ? '<button class="inv-btn inv-btn-del"  onclick="deleteWholesaler(\'' + w.id + '\')">Del</button>' : '') +
        '</div></td>'
      : '';

    return '<tr>' +
      '<td><b>' + esc(w.wholesaler_name || '') + '</b></td>' +
      '<td>' + esc(w.store_name || '—') + '</td>' +
      '<td>' + esc(w.contact_person || '—') + '</td>' +
      '<td>' + (w.product_category ? '<span class="badge-in-stock" style="font-size:0.72rem">' + esc(w.product_category) + '</span>' : '—') + '</td>' +
      '<td style="font-size:0.8rem;max-width:160px">' + esc(w.address || '—') + '</td>' +
      '<td>' + phoneCell + '</td>' +
      '<td style="font-size:0.78rem;color:var(--text3)">' + esc(w.created_by || '—') + '</td>' +
      '<td style="font-size:0.78rem;color:var(--text3)">' + createdAt + '</td>' +
      actCell +
    '</tr>';
  }).join('');

  const actHeader = showAct ? '<th>Actions</th>' : '';
  el.innerHTML =
    '<div class="tbl-wrap"><table>' +
      '<thead><tr>' +
        '<th>Wholesaler Name</th><th>Store Name</th><th>Contact Person</th>' +
        '<th>Category</th><th>Address</th><th>Contact Number</th>' +
        '<th>Created By</th><th>Date Created</th>' + actHeader +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>';
}

// ── SEARCH ────────────────────────────────────
function onWsSearch(val) {
  clearTimeout(_wsSearchTimeout);
  _wsSearchTimeout = setTimeout(() => {
    const q = (val || '').toLowerCase().trim();
    if (!q) { renderWholesalerTable(_wholesalersCache); return; }
    const filtered = _wholesalersCache.filter(w =>
      (w.wholesaler_name  || '').toLowerCase().includes(q) ||
      (w.store_name       || '').toLowerCase().includes(q) ||
      (w.contact_number   || '').toLowerCase().includes(q) ||
      (w.contact_person   || '').toLowerCase().includes(q) ||
      (w.product_category || '').toLowerCase().includes(q)
    );
    renderWholesalerTable(filtered);
  }, 200);
}

// ── UTILITY ───────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wsClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => toast('Number copied!', 'success'))
      .catch(() => wsFallbackCopy(text));
  } else {
    wsFallbackCopy(text);
  }
}
function wsFallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Number copied!', 'success'); }
  catch(e) { toast('Could not copy.', 'warning'); }
  document.body.removeChild(ta);
}

// ── ADD MODAL ─────────────────────────────────
function openAddWholesalerModal() {
  openModal(
    '<div class="modal-title">Add Wholesaler</div>' +
    '<div class="input-row">' +
      '<div class="field" style="grid-column:1/-1">' +
        '<label for="ws_name">Wholesaler Name *</label>' +
        '<input id="ws_name" name="ws_name" placeholder="e.g. Juan Santos Trading">' +
      '</div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field">' +
        '<label for="ws_store">Store Name *</label>' +
        '<input id="ws_store" name="ws_store" placeholder="e.g. Santos General Merchandise">' +
      '</div>' +
      '<div class="field">' +
        '<label for="ws_contact">Contact Number *</label>' +
        '<input id="ws_contact" name="ws_contact" type="tel" placeholder="e.g. 09171234567">' +
      '</div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field">' +
        '<label for="ws_person">Contact Person</label>' +
        '<input id="ws_person" name="ws_person" placeholder="e.g. Juan Santos">' +
      '</div>' +
      '<div class="field">' +
        '<label for="ws_category">Product Category</label>' +
        '<input id="ws_category" name="ws_category" placeholder="e.g. Beverages, Snacks">' +
      '</div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field" style="grid-column:1/-1">' +
        '<label for="ws_address">Complete Address</label>' +
        '<input id="ws_address" name="ws_address" placeholder="e.g. 123 Rizal St., Brgy. 1, Vigan City">' +
      '</div>' +
    '</div>' +
    '<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveWholesaler()">Save Wholesaler</button>'
  );
  setTimeout(() => document.getElementById('ws_name')?.focus(), 200);
}

// ── EDIT MODAL ────────────────────────────────
function openEditWholesalerModal(id) {
  const w = _wholesalersCache.find(x => x.id === id);
  if (!w) { toast('Wholesaler not found.', 'error'); return; }
  openModal(
    '<div class="modal-title">Edit Wholesaler</div>' +
    '<div class="input-row">' +
      '<div class="field" style="grid-column:1/-1">' +
        '<label for="ws_name">Wholesaler Name *</label>' +
        '<input id="ws_name" name="ws_name" value="' + esc(w.wholesaler_name) + '">' +
      '</div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field">' +
        '<label for="ws_store">Store Name *</label>' +
        '<input id="ws_store" name="ws_store" value="' + esc(w.store_name) + '">' +
      '</div>' +
      '<div class="field">' +
        '<label for="ws_contact">Contact Number *</label>' +
        '<input id="ws_contact" name="ws_contact" type="tel" value="' + esc(w.contact_number) + '">' +
      '</div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field">' +
        '<label for="ws_person">Contact Person</label>' +
        '<input id="ws_person" name="ws_person" value="' + esc(w.contact_person) + '">' +
      '</div>' +
      '<div class="field">' +
        '<label for="ws_category">Product Category</label>' +
        '<input id="ws_category" name="ws_category" value="' + esc(w.product_category) + '">' +
      '</div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field" style="grid-column:1/-1">' +
        '<label for="ws_address">Complete Address</label>' +
        '<input id="ws_address" name="ws_address" value="' + esc(w.address) + '">' +
      '</div>' +
    '</div>' +
    '<button class="btn btn-primary" style="width:100%;margin-top:8px" onclick="saveWholesaler(\'' + id + '\')">Update Wholesaler</button>'
  );
}

// ── SAVE (ADD / EDIT) ─────────────────────────
// ── Contact number validator ──────────────────
function wsValidateContact(val) {
  if (!val) return { ok: false, msg: 'Contact Number is required.' };
  // Allow: digits, spaces, +, -, (, )
  if (/[^0-9\s+\-()]/.test(val)) {
    return { ok: false, msg: 'Contact Number contains invalid characters. Only digits, spaces, +, -, and () are allowed.' };
  }
  const digits = val.replace(/\D/g, '');
  if (digits.length < 7) {
    return { ok: false, msg: 'Contact Number must have at least 7 digits.' };
  }
  return { ok: true };
}

// ── Normalize spaces in a string ──────────────
function wsNormalize(str) {
  return (str || '').trim().replace(/\s{2,}/g, ' ');
}

async function saveWholesaler(id = null) {
  // ── Sanitize inputs ──────────────────────────
  const name    = wsNormalize(document.getElementById('ws_name')?.value);
  const store   = wsNormalize(document.getElementById('ws_store')?.value);
  const contact = wsNormalize(document.getElementById('ws_contact')?.value);
  const person  = wsNormalize(document.getElementById('ws_person')?.value);
  const cat     = wsNormalize(document.getElementById('ws_category')?.value);
  const addr    = wsNormalize(document.getElementById('ws_address')?.value);

  // ── Required field validation ──────────────────
  if (!name) {
    toast('Wholesaler Name is required.', 'error');
    document.getElementById('ws_name')?.focus(); return;
  }
  if (!store) {
    toast('Store Name is required.', 'error');
    document.getElementById('ws_store')?.focus(); return;
  }

  // ── Contact number validation ──────────────────
  const contactCheck = wsValidateContact(contact);
  if (!contactCheck.ok) {
    toast(contactCheck.msg, 'error');
    document.getElementById('ws_contact')?.focus(); return;
  }

  // ── Duplicate prevention (store name + contact number) ──
  if (!id) {
    const storeLower   = store.toLowerCase();
    const contactDigits = contact.replace(/\D/g, '');
    const duplicate = _wholesalersCache.find(w =>
      w.store_name.toLowerCase() === storeLower &&
      w.contact_number.replace(/\D/g, '') === contactDigits
    );
    if (duplicate) {
      toast(
        'Duplicate record: "' + duplicate.store_name + '" with this contact number already exists.',
        'error', 5000
      );
      return;
    }
  }

  // ── Build payload with full audit trail ────────
  const now = new Date().toISOString();
  const payload = {
    action:           id ? 'updateWholesaler' : 'addWholesaler',
    id,
    wholesaler_name:  name,
    store_name:       store,
    contact_number:   contact,
    contact_person:   person,
    product_category: cat,
    address:          addr,
    caller_role:      currentUser.role,
    created_by:       currentUser.name || currentUser.username,
    updated_at:       now,
  };
  if (!id) payload.created_at = now;

  // ── Disable button to prevent double submit ────
  const btn = document.querySelector('#modalBox .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const res = await gasPost(payload);
    if (res.success) {
      toast(id ? 'Wholesaler updated!' : 'Wholesaler added!', 'success');
      closeModalDirect();
      await loadWholesalers();
    } else {
      toast(res.message || 'Error saving wholesaler.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = id ? 'Update Wholesaler' : 'Save Wholesaler'; }
    }
  } catch(e) {
    toast('Network error. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = id ? 'Update Wholesaler' : 'Save Wholesaler'; }
  }
}

// ── DELETE ────────────────────────────────────
async function deleteWholesaler(id) {
  const w = _wholesalersCache.find(x => x.id === id);
  const name = w ? w.wholesaler_name : 'this wholesaler';
  if (!confirm('Delete "' + name + '"?\nThis cannot be undone.')) return;
  try {
    const res = await gasPost({ action: 'deleteWholesaler', id, caller_role: currentUser.role });
    if (res.success) { toast('Wholesaler deleted.', 'success'); await loadWholesalers(); }
    else toast(res.message || 'Error deleting.', 'error');
  } catch(e) { toast('Network error.', 'error'); }
}


// ═══════════════════════════════════════════════════════════
// INVENTORY AUDIT MODULE
// All functions prefixed with audit_
// Does NOT modify live inventory stock — compare only
// ═══════════════════════════════════════════════════════════

let audit_sessions  = [];
let audit_current   = null;
let audit_sessionId = null;
let audit_closing       = null;  // Closing Inventory phase: [{productId, productName, category, openingActual, soldQty, expectedClosing, remarks}]
let audit_closingSaved  = false;

async function audit_renderPage() {
  const pc = document.getElementById('pageContent');
  if (!pc) return;
  pc.innerHTML =
    '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px">' +
      '<button class="btn btn-primary" onclick="audit_startNew()">Generate Inventory Count Sheet</button>' +
      '<button class="btn btn-ghost" onclick="audit_loadHistory()">View Past Audits</button>' +
    '</div>' +
    '<div id="auditContent">' +
      '<div class="no-data">' +
        '<div class="no-data-icon"></div>' +
        '<div class="no-data-text">Click <b>Generate Inventory Count Sheet</b> to start a new physical count.<br>' +
          '<span style="font-size:0.8rem;color:var(--text3)">This module does NOT modify your live inventory.</span>' +
        '</div>' +
      '</div>' +
    '</div>';
}

async function audit_startNew() {
  const el = document.getElementById('auditContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div> Loading products...</div>';
  try {
    const res = await gasRequest({ action: 'getProducts' });
    const products = (res.data || []).filter(p => p.name && p.name.trim());
    if (!products.length) {
      el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No products found.</div></div>';
      return;
    }
    audit_current = products.map(p => ({
      productId:     p.id,
      productName:   p.name || '',
      category:      p.category || '\u2014',
      posStockPcs:   parseInt(p.qtyPcs   || 0),
      posStockPacks: parseInt(p.qtyPacks || 0),
      actualCount:   '',
      variance:      '',
      actualPacks:   '',
      variancePacks: '',
      remarks:       '',
      dateCounted:   '',
      countedBy:     '',
    }));
    audit_sessionId = null;
    audit_renderTable(el);
  } catch(e) {
    el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Failed to load products.</div></div>';
    toast('Could not load products for audit.', 'error');
  }
}

function audit_renderTable(container) {
  if (!audit_current || !audit_current.length) return;
  const el  = container || document.getElementById('auditContent');
  if (!el) return;
  const now     = new Date();
  const dateStr = localDateStr(now);

  const rows = audit_current.map(function(r, i) {
    const actualVal = r.actualCount !== '' ? parseInt(r.actualCount) : '';
    const variance  = actualVal !== '' ? actualVal - r.posStockPcs : '';
    const varClass  = variance === '' ? '' : variance > 0 ? 'text-green' : variance < 0 ? 'text-red' : 'text-muted';
    const varDisp   = variance === '' ? '\u2014' : (variance > 0 ? '+' : '') + variance;
    const actualPk  = (r.actualPacks !== undefined && r.actualPacks !== '') ? parseInt(r.actualPacks) : '';
    const varPk     = actualPk !== '' ? actualPk - (r.posStockPacks || 0) : '';
    const varPkCls  = varPk === '' ? '' : varPk > 0 ? 'text-green' : varPk < 0 ? 'text-red' : 'text-muted';
    const varPkDisp = varPk === '' ? '\u2014' : (varPk > 0 ? '+' : '') + varPk;
    return '<tr>' +
      '<td style="font-size:0.85rem"><b>' + esc(r.productName) + '</b></td>' +
      '<td style="font-size:0.8rem">' + esc(r.category) + '</td>' +
      '<td class="fw-700" style="text-align:center">' + r.posStockPcs + '</td>' +
      '<td class="fw-700" style="text-align:center">' + (r.posStockPacks || 0) + '</td>' +
      '<td style="text-align:center">' +
        '<input type="number" min="0" ' +
          'data-idx="' + i + '" ' +
          'value="' + (r.actualCount !== '' ? r.actualCount : '') + '" ' +
          'placeholder="0" ' +
          'oninput="audit_onCount(this,' + i + ')" ' +
          'style="width:72px;padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;text-align:center;font-family:var(--font-main);font-size:0.9rem">' +
      '</td>' +
      '<td style="text-align:center">' +
        '<input type="number" min="0" ' +
          'value="' + (actualPk !== '' ? actualPk : '') + '" ' +
          'placeholder="0" ' +
          'oninput="audit_onCountPacks(this,' + i + ')" ' +
          'style="width:72px;padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;text-align:center;font-family:var(--font-main);font-size:0.9rem">' +
      '</td>' +
      '<td class="fw-700 ' + varClass + '" style="text-align:center" id="audit_var_' + i + '">' + varDisp + '</td>' +
      '<td class="fw-700 ' + varPkCls + '" style="text-align:center" id="audit_varp_' + i + '">' + varPkDisp + '</td>' +
      '<td>' +
        '<input type="text" ' +
          'value="' + esc(r.remarks || '') + '" ' +
          'placeholder="Remarks..." ' +
          'oninput="audit_onRemark(this,' + i + ')" ' +
          'style="width:130px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-family:var(--font-main);font-size:0.8rem">' +
      '</td>' +
      '<td style="font-size:0.78rem;white-space:nowrap">' + (r.dateCounted || dateStr) + '</td>' +
      '<td style="font-size:0.78rem">' + esc(r.countedBy || (currentUser ? currentUser.name : '') || '') + '</td>' +
    '</tr>';
  }).join('');

  el.innerHTML =
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">' +
      '<button class="btn btn-success" onclick="audit_saveSession()">Save Audit Session</button>' +
      '<button class="btn btn-primary" onclick="audit_exportExcel()">Export Excel</button>' +
      '<button class="btn btn-ghost" onclick="audit_printAudit()">Print</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="audit_renderPage()">Cancel</button>' +
      '<span style="font-size:0.78rem;color:var(--text3);margin-left:auto">Variance = Actual Count \u2212 POS Stock (per piece and per pack)</span>' +
    '</div>' +
    '<div class="tbl-wrap" style="max-height:65vh;overflow-y:auto">' +
      '<table>' +
        '<thead><tr>' +
          '<th>Product Name</th><th>Category</th><th>POS Stock (Pcs)</th><th>POS Stock (Packs)</th>' +
          '<th>Actual Count (Pcs)</th><th>Actual Count (Packs)</th><th>Variance (Pcs)</th><th>Variance (Packs)</th><th>Remarks</th>' +
          '<th>Date Counted</th><th>Counted By</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
}

function audit_onCount(input, idx) {
  if (!audit_current || !audit_current[idx]) return;
  const val = input.value.trim();
  audit_current[idx].actualCount = val !== '' ? parseInt(val) : '';
  audit_current[idx].dateCounted = localDateStr(new Date());
  audit_current[idx].countedBy   = currentUser ? (currentUser.name || currentUser.username || '') : '';
  const varEl = document.getElementById('audit_var_' + idx);
  if (!varEl) return;
  const actual = val !== '' ? parseInt(val) : null;
  const pos    = audit_current[idx].posStockPcs;
  if (actual === null) {
    varEl.textContent = '\u2014';
    varEl.className   = 'fw-700 text-muted';
  } else {
    const v = actual - pos;
    varEl.textContent = (v > 0 ? '+' : '') + v;
    varEl.className   = 'fw-700 ' + (v > 0 ? 'text-green' : v < 0 ? 'text-red' : 'text-muted');
  }
}

function audit_onCountPacks(input, idx) {
  if (!audit_current || !audit_current[idx]) return;
  const val = input.value.trim();
  const r   = audit_current[idx];
  r.actualPacks   = val !== '' ? parseInt(val) : '';
  r.variancePacks = val !== '' ? r.actualPacks - (r.posStockPacks || 0) : '';
  r.dateCounted   = localDateStr(new Date());
  r.countedBy     = currentUser ? (currentUser.name || currentUser.username || '') : '';
  const varEl = document.getElementById('audit_varp_' + idx);
  if (!varEl) return;
  if (val === '') {
    varEl.textContent = '\u2014';
    varEl.className   = 'fw-700 text-muted';
  } else {
    const v = r.variancePacks;
    varEl.textContent = (v > 0 ? '+' : '') + v;
    varEl.className   = 'fw-700 ' + (v > 0 ? 'text-green' : v < 0 ? 'text-red' : 'text-muted');
  }
}

function audit_onRemark(input, idx) {
  if (!audit_current || !audit_current[idx]) return;
  audit_current[idx].remarks = input.value;
}

async function audit_saveSession() {
  if (!audit_current || !audit_current.length) { toast('Nothing to save.', 'warning'); return; }
  const counted = audit_current.filter(function(r) { return r.actualCount !== '' || (r.actualPacks !== undefined && r.actualPacks !== ''); });
  if (!counted.length) { toast('Enter at least one Actual Count before saving.', 'warning'); return; }
  // keep the pack variance in sync with the typed pack count before it is sent
  audit_current.forEach(function(r) {
    r.variancePacks = (r.actualPacks !== undefined && r.actualPacks !== '') ? parseInt(r.actualPacks) - (r.posStockPacks || 0) : '';
  });
  const now       = new Date();
  const sessionId = audit_sessionId || ('AUD-' + Date.now());
  const auditedBy = currentUser ? (currentUser.name || currentUser.username || '') : '';
  const auditDate = now.toISOString();

  const btn = document.querySelector('#auditContent .btn-success');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  // ── BATCHED SAVE (same GET+base64 URL-safe pattern as confirmImport/gasBulkImport) ──
  // Sending all audited rows in a single request can exceed the browser's safe URL
  // length once base64-encoded, which fails client-side with net::ERR_FAILED before
  // it ever reaches the server. Splitting into small batches keeps each request well
  // under that limit. Only the FIRST batch tells the backend to clear old rows for
  // this session; every batch after that only appends (see Code.gs audit_saveSession).
  const BATCH_SIZE = 15;
  const batches = [];
  for (let i = 0; i < audit_current.length; i += BATCH_SIZE) {
    batches.push(audit_current.slice(i, i + BATCH_SIZE));
  }

  let savedCount = 0;
  let failed = false;
  let failMsg = '';

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const payload = {
      action:       'audit_saveSession',
      sessionId:    sessionId,
      auditedBy:    auditedBy,
      auditDate:    auditDate,
      rows:         JSON.stringify(batch),
      isFirstBatch: b === 0,
    };
    if (btn && batches.length > 1) {
      btn.textContent = 'Saving... (' + (b + 1) + '/' + batches.length + ')';
    }

    let res;
    try {
      res = await gasPost(payload);
    } catch (e) {
      // Retry once after 2s, same as confirmImport's batch retry
      await new Promise(r => setTimeout(r, 2000));
      try {
        res = await gasPost(payload);
      } catch (e2) {
        failed = true;
        failMsg = e2.message || 'Network error saving audit.';
        break;
      }
    }

    if (!res || !res.success) {
      failed = true;
      failMsg = (res && res.message) || 'Error saving audit.';
      break;
    }

    savedCount += batch.length;
    if (b < batches.length - 1) await new Promise(r => setTimeout(r, 800));
  }

  if (!failed) {
    audit_sessionId = sessionId;
    toast('Audit session saved!', 'success');
    audit_renderLockedTable();
  } else {
    toast(failMsg + (savedCount ? ' (' + savedCount + ' of ' + audit_current.length + ' items saved before the error)' : ''), 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Save Audit Session'; }
}

// Read-only view of a saved Opening Inventory session — shown right after
// Save Audit Session succeeds, and whenever a past session is opened from
// History. Saved = locked: no more editing, only Closing Inventory / Export /
// Print / Back. (Does not touch audit_renderTable, which still does the live,
// editable count sheet before the first save.)
function audit_renderLockedTable(container) {
  if (!audit_current || !audit_current.length) return;
  const el = container || document.getElementById('auditContent');
  if (!el) return;
  const now     = new Date();
  const dateStr = localDateStr(now);

  const rows = audit_current.map(function(r) {
    const actualVal = r.actualCount !== '' ? parseInt(r.actualCount) : '';
    const variance  = actualVal !== '' ? actualVal - r.posStockPcs : '';
    const varClass  = variance === '' ? '' : variance > 0 ? 'text-green' : variance < 0 ? 'text-red' : 'text-muted';
    const varDisp   = variance === '' ? '—' : (variance > 0 ? '+' : '') + variance;
    const actualPk  = (r.actualPacks !== undefined && r.actualPacks !== '') ? parseInt(r.actualPacks) : '';
    const varPk     = actualPk !== '' ? actualPk - (r.posStockPacks || 0) : '';
    const varPkCls  = varPk === '' ? '' : varPk > 0 ? 'text-green' : varPk < 0 ? 'text-red' : 'text-muted';
    const varPkDisp = varPk === '' ? '—' : (varPk > 0 ? '+' : '') + varPk;
    return '<tr>' +
      '<td style="font-size:0.85rem"><b>' + esc(r.productName) + '</b></td>' +
      '<td style="font-size:0.8rem">' + esc(r.category) + '</td>' +
      '<td class="fw-700" style="text-align:center">' + r.posStockPcs + '</td>' +
      '<td class="fw-700" style="text-align:center">' + (r.posStockPacks || 0) + '</td>' +
      '<td class="fw-700" style="text-align:center">' + (r.actualCount !== '' ? r.actualCount : '—') + '</td>' +
      '<td class="fw-700" style="text-align:center">' + (actualPk !== '' ? actualPk : '—') + '</td>' +
      '<td class="fw-700 ' + varClass + '" style="text-align:center">' + varDisp + '</td>' +
      '<td class="fw-700 ' + varPkCls + '" style="text-align:center">' + varPkDisp + '</td>' +
      '<td style="font-size:0.8rem">' + esc(r.remarks || '') + '</td>' +
      '<td style="font-size:0.78rem;white-space:nowrap">' + (r.dateCounted || dateStr) + '</td>' +
      '<td style="font-size:0.78rem">' + esc(r.countedBy || '') + '</td>' +
    '</tr>';
  }).join('');

  el.innerHTML =
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">' +
      '<span style="font-size:0.78rem;color:var(--text3);background:var(--bg2);padding:5px 10px;border-radius:6px">Opening Inventory saved — locked</span>' +
      '<button class="btn btn-primary" onclick="audit_startClosing()">Closing Inventory</button>' +
      '<button class="btn btn-primary" onclick="audit_exportExcel()">Export Excel</button>' +
      '<button class="btn btn-ghost" onclick="audit_printAudit()">Print</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="audit_renderPage()">Back</button>' +
    '</div>' +
    '<div class="tbl-wrap" style="max-height:65vh;overflow-y:auto">' +
      '<table>' +
        '<thead><tr>' +
          '<th>Product Name</th><th>Category</th><th>POS Stock (Pcs)</th><th>POS Stock (Packs)</th>' +
          '<th>Actual Count (Pcs)</th><th>Actual Count (Packs)</th><th>Variance (Pcs)</th><th>Variance (Packs)</th><th>Remarks</th>' +
          '<th>Date Counted</th><th>Counted By</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
}

// ── CLOSING INVENTORY (phase 2) ──────────────────────────────
// Starts from the Opening session's counted items (audit_current), lets the
// clerk type Sold Qty per item, and auto-computes Expected Closing =
// Opening Actual − Sold Qty. Saved separately (audit_saveClosingSession),
// under the same sessionId, to its own "Inventory Closing" sheet.
function audit_startClosing() {
  if (!audit_current || !audit_current.length) { toast('No opening session loaded.', 'warning'); return; }
  audit_closing = audit_current
    .filter(function(r) { return r.actualCount !== ''; })
    .map(function(r) {
      return {
        productId:       r.productId,
        productName:     r.productName,
        category:        r.category,
        openingActual:   r.actualCount,
        soldQty:         '',
        expectedClosing: r.actualCount,
        remarks:         '',
      };
    });
  audit_closingSaved = false;
  audit_renderClosingTable();
}

function audit_renderClosingTable(container) {
  if (!audit_closing || !audit_closing.length) return;
  const el = container || document.getElementById('auditContent');
  if (!el) return;

  const rows = audit_closing.map(function(r, i) {
    return '<tr>' +
      '<td style="font-size:0.85rem"><b>' + esc(r.productName) + '</b></td>' +
      '<td style="font-size:0.8rem">' + esc(r.category) + '</td>' +
      '<td class="fw-700" style="text-align:center">' + r.openingActual + '</td>' +
      '<td style="text-align:center">' +
        '<input type="number" min="0" ' +
          'data-idx="' + i + '" ' +
          'value="' + (r.soldQty !== '' ? r.soldQty : '') + '" ' +
          'placeholder="0" ' +
          'oninput="audit_onSoldQty(this,' + i + ')" ' +
          'style="width:72px;padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;text-align:center;font-family:var(--font-main);font-size:0.9rem">' +
      '</td>' +
      '<td class="fw-700" style="text-align:center" id="audit_closing_exp_' + i + '">' + r.expectedClosing + '</td>' +
      '<td>' +
        '<input type="text" ' +
          'value="' + esc(r.remarks || '') + '" ' +
          'placeholder="Remarks..." ' +
          'oninput="audit_onClosingRemark(this,' + i + ')" ' +
          'style="width:130px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-family:var(--font-main);font-size:0.8rem">' +
      '</td>' +
    '</tr>';
  }).join('');

  el.innerHTML =
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">' +
      '<button class="btn btn-success" onclick="audit_saveClosingSession()">Save Closing Inventory</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="audit_renderLockedTable()">Back</button>' +
      '<span style="font-size:0.78rem;color:var(--text3);margin-left:auto">Expected Closing = Opening Actual − Sold Qty</span>' +
    '</div>' +
    '<div class="tbl-wrap" style="max-height:65vh;overflow-y:auto">' +
      '<table>' +
        '<thead><tr>' +
          '<th>Product Name</th><th>Category</th><th>Opening Actual</th>' +
          '<th>Sold Qty</th><th>Expected Closing</th><th>Remarks</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
}

function audit_onSoldQty(input, idx) {
  if (!audit_closing || !audit_closing[idx]) return;
  const val  = input.value.trim();
  const sold = val !== '' ? parseInt(val) : 0;
  audit_closing[idx].soldQty = val !== '' ? sold : '';
  const opening  = parseInt(audit_closing[idx].openingActual) || 0;
  const expected = opening - sold;
  audit_closing[idx].expectedClosing = expected;
  const expEl = document.getElementById('audit_closing_exp_' + idx);
  if (expEl) expEl.textContent = expected;
}

function audit_onClosingRemark(input, idx) {
  if (!audit_closing || !audit_closing[idx]) return;
  audit_closing[idx].remarks = input.value;
}

async function audit_saveClosingSession() {
  if (!audit_closing || !audit_closing.length) { toast('Nothing to save.', 'warning'); return; }
  if (!audit_sessionId) { toast('Missing opening session. Please reload.', 'error'); return; }
  const now         = new Date();
  const closedBy    = currentUser ? (currentUser.name || currentUser.username || '') : '';
  const closingDate = now.toISOString();

  const btn = document.querySelector('#auditContent .btn-success');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  // Same batched GET+base64 pattern as audit_saveSession — keeps each
  // request well under the browser's safe URL length.
  const BATCH_SIZE = 15;
  const batches = [];
  for (let i = 0; i < audit_closing.length; i += BATCH_SIZE) {
    batches.push(audit_closing.slice(i, i + BATCH_SIZE));
  }

  let savedCount = 0;
  let failed = false;
  let failMsg = '';

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const payload = {
      action:       'audit_saveClosingSession',
      sessionId:    audit_sessionId,
      closedBy:     closedBy,
      closingDate:  closingDate,
      rows:         JSON.stringify(batch),
      isFirstBatch: b === 0,
    };
    if (btn && batches.length > 1) {
      btn.textContent = 'Saving... (' + (b + 1) + '/' + batches.length + ')';
    }

    let res;
    try {
      res = await gasPost(payload);
    } catch (e) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        res = await gasPost(payload);
      } catch (e2) {
        failed = true;
        failMsg = e2.message || 'Network error saving closing inventory.';
        break;
      }
    }

    if (!res || !res.success) {
      failed = true;
      failMsg = (res && res.message) || 'Error saving closing inventory.';
      break;
    }

    savedCount += batch.length;
    if (b < batches.length - 1) await new Promise(r => setTimeout(r, 800));
  }

  if (!failed) {
    audit_closingSaved = true;
    toast('Closing inventory saved!', 'success');
    audit_renderClosingLockedTable();
  } else {
    toast(failMsg + (savedCount ? ' (' + savedCount + ' of ' + audit_closing.length + ' items saved before the error)' : ''), 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Save Closing Inventory'; }
}

function audit_renderClosingLockedTable(container) {
  if (!audit_closing || !audit_closing.length) return;
  const el = container || document.getElementById('auditContent');
  if (!el) return;

  const rows = audit_closing.map(function(r) {
    return '<tr>' +
      '<td style="font-size:0.85rem"><b>' + esc(r.productName) + '</b></td>' +
      '<td style="font-size:0.8rem">' + esc(r.category) + '</td>' +
      '<td class="fw-700" style="text-align:center">' + r.openingActual + '</td>' +
      '<td class="fw-700" style="text-align:center">' + (r.soldQty !== '' ? r.soldQty : 0) + '</td>' +
      '<td class="fw-700" style="text-align:center">' + r.expectedClosing + '</td>' +
      '<td style="font-size:0.8rem">' + esc(r.remarks || '') + '</td>' +
    '</tr>';
  }).join('');

  el.innerHTML =
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">' +
      '<span style="font-size:0.78rem;color:var(--text3);background:var(--bg2);padding:5px 10px;border-radius:6px">Closing Inventory saved — locked</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="audit_renderLockedTable()">Back to Opening</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="audit_renderPage()">Done</button>' +
    '</div>' +
    '<div class="tbl-wrap" style="max-height:65vh;overflow-y:auto">' +
      '<table>' +
        '<thead><tr>' +
          '<th>Product Name</th><th>Category</th><th>Opening Actual</th>' +
          '<th>Sold Qty</th><th>Expected Closing</th><th>Remarks</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
}

async function audit_loadHistory() {
  const el = document.getElementById('auditContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div> Loading...</div>';
  try {
    const res      = await gasRequest({ action: 'audit_getSessions' });
    const sessions = res.data || [];
    if (!sessions.length) {
      el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>No audit sessions saved yet.</div></div>';
      return;
    }
    const grouped = {};
    sessions.forEach(function(s) {
      if (!grouped[s.sessionId]) {
        grouped[s.sessionId] = { sessionId: s.sessionId, auditedBy: s.auditedBy, auditDate: s.auditDate, count: 0 };
      }
      grouped[s.sessionId].count++;
    });
    const list = Object.values(grouped).sort(function(a, b) { return b.auditDate.localeCompare(a.auditDate); });
    const rows  = list.map(function(s) {
      return '<tr>' +
        '<td style="font-family:var(--font-mono);font-size:0.78rem">' + esc(s.sessionId) + '</td>' +
        '<td>' + safeFormatDateTime(s.auditDate) + '</td>' +
        '<td>' + esc(s.auditedBy) + '</td>' +
        '<td>' + s.count + ' items</td>' +
        '<td><div style="display:flex;gap:5px">' +
          '<button class="inv-btn inv-btn-edit" onclick="audit_viewSession(\'' + esc(s.sessionId) + '\')">View</button>' +
          '<button class="inv-btn inv-btn-del"  onclick="audit_deleteSession(\'' + esc(s.sessionId) + '\')">Del</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');
    el.innerHTML =
      '<div style="margin-bottom:12px;display:flex;gap:8px">' +
        '<span style="font-size:0.9rem;font-weight:600">' + list.length + ' audit session(s)</span>' +
        '<button class="btn btn-ghost btn-sm" onclick="audit_renderPage()" style="margin-left:auto">Back</button>' +
      '</div>' +
      '<div class="tbl-wrap"><table>' +
        '<thead><tr><th>Session ID</th><th>Date</th><th>Audited By</th><th>Items</th><th>Actions</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div>';
  } catch(e) {
    el.innerHTML = '<div class="no-data"><div class="no-data-icon"></div><div>Failed to load history.</div></div>';
    toast('Could not load audit history.', 'error');
  }
}

async function audit_viewSession(sessionId) {
  const el = document.getElementById('auditContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  try {
    const res  = await gasRequest({ action: 'audit_getSessions', sessionId: sessionId });
    const rows = (res.data || []).filter(function(r) { return r.sessionId === sessionId; });
    if (!rows.length) { toast('Session not found.', 'error'); return; }
    audit_current = rows.map(function(r) {
      return {
        productId:     r.productId,
        productName:   r.productName,
        category:      r.category,
        posStockPcs:   parseInt(r.posStockPcs   || 0),
        posStockPacks: parseInt(r.posStockPacks  || 0),
        actualCount:   r.actualCount !== '' ? parseInt(r.actualCount) : '',
        actualPacks:   (r.actualPacks !== undefined && r.actualPacks !== '') ? parseInt(r.actualPacks) : '',
        variancePacks: r.variancePacks !== undefined ? r.variancePacks : '',
        variance:      r.variance,
        remarks:       r.remarks,
        dateCounted:   r.dateCounted,
        countedBy:     r.countedBy,
      };
    });
    audit_sessionId = sessionId;
    // A session opened from History was already saved, so show it locked
    // (read-only) just like right after Save Audit Session succeeds.
    audit_renderLockedTable(el);
  } catch(e) {
    toast('Could not load session.', 'error');
  }
}

async function audit_deleteSession(sessionId) {
  if (!confirm('Delete audit session "' + sessionId + '"?\nThis cannot be undone.')) return;
  try {
    const res = await gasPost({
      action:      'audit_deleteSession',
      sessionId:   sessionId,
      caller_role: currentUser ? currentUser.role : '',
    });
    if (res.success) { toast('Audit session deleted.', 'success'); audit_loadHistory(); }
    else toast(res.message || 'Error deleting.', 'error');
  } catch(e) { toast('Network error.', 'error'); }
}

async function audit_exportExcel() {
  if (!audit_current || !audit_current.length) { toast('No data to export.', 'warning'); return; }
  toast('Preparing Excel...', 'info');
  try {
    if (typeof XLSX === 'undefined') { toast('Excel library failed to load.','error'); return; }
    const now    = new Date();
    const HEADER = ['Product Name','Category','POS Stock (Pcs)','POS Stock (Packs)','Actual Count (Pcs)','Actual Count (Packs)','Variance (Pcs)','Variance (Packs)','Remarks','Date Counted','Counted By'];
    const data   = audit_current.map(function(r) {
      const actual   = r.actualCount !== '' ? parseInt(r.actualCount) : '';
      const variance = actual !== '' ? actual - r.posStockPcs : '';
      const actualPk = (r.actualPacks !== undefined && r.actualPacks !== '') ? parseInt(r.actualPacks) : '';
      const varPk    = actualPk !== '' ? actualPk - (r.posStockPacks || 0) : '';
      return [r.productName, r.category, r.posStockPcs, r.posStockPacks || 0,
              actual !== '' ? actual : '', actualPk !== '' ? actualPk : '',
              variance !== '' ? variance : '', varPk !== '' ? varPk : '', r.remarks || '',
              r.dateCounted || localDateStr(now),
              r.countedBy || (currentUser ? currentUser.name : '') || ''];
    });
    const ws = XLSX.utils.aoa_to_sheet([
      ['AE HOME POS \u2014 Inventory Physical Count Audit'],
      ['Date Generated:', now.toLocaleString('en-PH')],
      ['Audited By:', currentUser ? currentUser.name || '' : ''],
      [],
      HEADER,
      ...data,
    ]);
    for (var c = 0; c < HEADER.length; c++) {
      var addr = XLSX.utils.encode_cell({ r: 4, c: c });
      if (ws[addr]) ws[addr].s = { font: { bold: true }, fill: { patternType: 'solid', fgColor: { rgb: 'FFD966' } } };
    }
    ws['!cols'] = [{wch:30},{wch:16},{wch:14},{wch:14},{wch:16},{wch:16},{wch:14},{wch:14},{wch:24},{wch:14},{wch:18}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory Audit');
    XLSX.writeFile(wb, 'InventoryAudit_' + localDateStr(now) + '.xlsx');
    toast('Excel downloaded!', 'success');
  } catch(e) {
    toast('Export failed: ' + e.message, 'error');
  }
}

function audit_printAudit() {
  if (!audit_current || !audit_current.length) { toast('Nothing to print.', 'warning'); return; }
  const now  = new Date();
  const rows = audit_current.map(function(r) {
    const actual   = r.actualCount !== '' ? parseInt(r.actualCount) : '\u2014';
    const variance = r.actualCount !== '' ? (parseInt(r.actualCount) - r.posStockPcs) : '\u2014';
    const vStr     = variance === '\u2014' ? '\u2014' : (variance > 0 ? '+' + variance : String(variance));
    const actualPk = (r.actualPacks !== undefined && r.actualPacks !== '') ? parseInt(r.actualPacks) : '\u2014';
    const varPk    = actualPk === '\u2014' ? '\u2014' : (actualPk - (r.posStockPacks || 0));
    const vPkStr   = varPk === '\u2014' ? '\u2014' : (varPk > 0 ? '+' + varPk : String(varPk));
    return '<tr>' +
      '<td>' + esc(r.productName) + '</td><td>' + esc(r.category) + '</td>' +
      '<td>' + r.posStockPcs + '</td><td>' + (r.posStockPacks || 0) + '</td>' +
      '<td>' + actual + '</td><td>' + actualPk + '</td>' +
      '<td>' + vStr + '</td><td>' + vPkStr + '</td><td>' + esc(r.remarks || '') + '</td>' +
      '<td>' + (r.dateCounted || localDateStr(now)) + '</td>' +
      '<td>' + esc(r.countedBy || (currentUser ? currentUser.name : '') || '') + '</td>' +
    '</tr>';
  }).join('');
  const win = window.open('', '_blank');
  if (!win) { toast('Pop-up blocked. Allow pop-ups and try again.', 'warning'); return; }
  win.document.write(
    '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<title>Inventory Audit</title>' +
    '<style>body{font-family:Arial,sans-serif;font-size:12px;margin:20px}' +
    'h2{margin-bottom:4px}p{margin:2px 0 12px}' +
    'table{border-collapse:collapse;width:100%}' +
    'th,td{border:1px solid #ccc;padding:6px 8px}' +
    'th{background:#FFD966;font-weight:bold}' +
    '@media print{button{display:none}}</style></head><body>' +
    '<h2>AE HOME POS \u2014 Inventory Physical Count Audit</h2>' +
    '<p>Generated: ' + now.toLocaleString('en-PH') + ' | Audited By: ' + esc(currentUser ? currentUser.name || '' : '') + '</p>' +
    '<table><thead><tr>' +
    '<th>Product Name</th><th>Category</th><th>POS Stock (Pcs)</th><th>POS Stock (Packs)</th><th>Actual Count (Pcs)</th><th>Actual Count (Packs)</th>' +
    '<th>Variance (Pcs)</th><th>Variance (Packs)</th><th>Remarks</th><th>Date Counted</th><th>Counted By</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<br><button onclick="window.print()">Print</button>' +
    '</body></html>'
  );
  win.document.close();
}


// ═══════════════════════════════════════════════════════════
// INCENTIVE TRACKER MODULE
// All functions prefixed with inc_
// Roles: admin/clerk = full mgmt; cashier = submit claims only
// ═══════════════════════════════════════════════════════════

// ── BRANCHES ──────────────────────────────────────────────
const INC_BRANCHES      = ['Vigan','SDO','San Juan','Cabugao1','Cabugao2','Laoag','Candon','Tagudin','Elyu'];
const INC_BRANCHES_DISP = ['Vigan', 'SDO', 'San Juan', 'Cabugao 1', 'Cabugao 2', 'Laoag', 'Candon', 'Tagudin', 'Elyu'];

// ── STATE ─────────────────────────────────────────────────
let inc_masterCache = [];   // Incentive Master List
let inc_claimState  = { invoiceNo:'', saleType:'retail', items:[], cats:[], prods:[], orTaken:false, orItems:[], orTimer:null };
function inc_normItem(v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

// 0..1 similarity between two item names (Levenshtein on normalised text)
function inc_similarity(a, b) {
  a = inc_normItem(a); b = inc_normItem(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a))) return 0.9;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

// per item (normalised name) totals for the lines already claimed under the OR being typed
const INC_API_VERSION_NEEDED = 5;
// The GAS script must be the latest one. If not, claims would not see other agents' items.
function inc_checkApiVersion(res) {
  if ((parseInt(res && res.apiVersion) || 0) >= INC_API_VERSION_NEEDED) return true;
  inc_claimState.apiOutdated = true;
  inc_showValbox('error', '<b>The server script (Code.gs) is outdated.</b> Claims cannot be checked against other agents. Ask your Admin to deploy the latest Code.gs (Deploy &gt; Manage deployments &gt; Edit &gt; New version).');
  const btn = document.getElementById('inc_submit_btn');
  if (btn) btn.disabled = true;
  return false;
}

function inc_orAggregate() {
  const agg = {};
  (inc_claimState.orItems || []).forEach(function(x) {
    const k = inc_normItem(x.description);
    const e = agg[k] || (agg[k] = { name: x.description, claimed: 0, total: 0, who: [] });
    e.claimed += parseInt(x.qty) || 1;
    e.total = Math.max(e.total, parseInt(x.qtyOnOR) || 0);
    if (e.who.indexOf(x.employeeName) < 0) e.who.push(x.employeeName);
  });
  Object.keys(agg).forEach(k => { agg[k].total = Math.max(agg[k].total, agg[k].claimed); agg[k].remaining = agg[k].total - agg[k].claimed; });
  return agg;
}
let inc_rejectId    = null;

// ── MAIN PAGE ROUTER ──────────────────────────────────────
async function inc_renderPage() {
  const role = currentUser.role;
  if (role === 'admin' || role === 'clerk' || role === 'verifier') {
    await inc_renderAdminPage();
  } else {
    await inc_renderAgentPage();
  }
}

// ══════════════════════════════════════════════════════════
// ADMIN / CLERK VIEW
// ══════════════════════════════════════════════════════════
async function inc_renderAdminPage() {
  const pc = document.getElementById('pageContent');
  if (!pc) return;
  pc.innerHTML =
    '<div id="incTabBar" class="tab-bar" style="margin-bottom:16px">' +
      '<button class="tab-btn active" onclick="inc_showTab(\'daily\',this)">Daily Report</button>' +
      '<button class="tab-btn" onclick="inc_showTab(\'all\',this)">All Claims</button>' +
      '<button class="tab-btn" onclick="inc_showTab(\'orcheck\',this)">OR Check</button>' +
      (currentUser.role === 'verifier' ? '' : '<button class="tab-btn" onclick="inc_showTab(\'catalog\',this)">Categories &amp; Amounts</button>') +
    '</div>' +
    '<div id="incContent"></div>';
  inc_showTab('daily', document.querySelector('#incTabBar .tab-btn'));
}

function inc_showTab(tab, btn) {
  const tabBar = document.getElementById('incTabBar');
  if (tabBar) tabBar.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (tab === 'daily')      inc_loadDailyReport();
  inc_view = tab;
  if (tab === 'all')        inc_loadAllClaims();
  if (tab === 'orcheck')    inc_loadOrCheck();
  if (tab === 'catalog')    inc_loadCatalog();
  if (tab === 'master')     inc_loadMasterList();
  if (tab === 'setamounts') inc_renderSetAmounts();
}

// ── SET BRANCH AMOUNTS (simple panel) ─────────────────────
async function inc_renderSetAmounts() {
  const el = document.getElementById('incContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  let categories = [];
  try {
    const cr = await gasRequest({ action:'inc_getCategories' });
    categories = cr.data || [];
  } catch(e) { categories = []; }

  const branchOpts = INC_BRANCHES.map(function(b,i){
    return '<option value="' + b + '">' + INC_BRANCHES_DISP[i] + '</option>';
  }).join('');

  const catOpts = '<option value="">-- All Categories (apply to all active items) --</option>' +
    categories.map(function(c){ return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');

  el.innerHTML =
    '<div style="background:var(--surface,white);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:560px">' +
      '<div style="font-size:1rem;font-weight:700;margin-bottom:6px">Set Incentive Amount by Branch</div>' +
      '<div style="font-size:0.82rem;color:var(--text3);margin-bottom:20px">Select branch and category, enter the amount, then click Apply.</div>' +
      '<div class="form-row"><label>Branch *</label>' +
        '<select id="sa_branch" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:var(--font-main)">' +
          '<option value="">-- Select Branch --</option>' + branchOpts +
        '</select></div>' +
      '<div class="form-row"><label>Category <span style="font-weight:400;color:var(--text3)">(blank = all active items)</span></label>' +
        '<select id="sa_category" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:var(--font-main)">' +
          catOpts +
        '</select></div>' +
      '<div class="form-row"><label>Incentive Amount (&#8369;) *</label>' +
        '<input id="sa_amount" type="number" min="0" placeholder="e.g. 250" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:var(--font-main)"></div>' +
      '<div id="sa_preview" style="display:none;margin-bottom:14px;border-radius:8px;padding:10px 14px;font-size:0.82rem"></div>' +
      '<button class="btn btn-primary" style="width:100%" onclick="inc_applyBranchAmount()">Apply to Matching Items</button>' +
      '<button class="btn btn-ghost" style="width:100%;margin-top:8px" onclick="inc_previewBranchAmount()">Preview Matching Items</button>' +
    '</div>';
}

async function inc_previewBranchAmount() {
  const branch   = document.getElementById('sa_branch')?.value;
  const category = (document.getElementById('sa_category')?.value || '').trim();
  const el       = document.getElementById('sa_preview');
  if (!branch) { toast('Please select a branch.', 'warning'); return; }
  try {
    const r = await gasRequest({ action:'inc_getMaster' });
    inc_masterCache = r.data || [];
    window._incCacheTime = Date.now();
  } catch(e) {}
  const filterCat = category.toLowerCase().trim();
  const matching  = inc_masterCache.filter(function(m) {
    if ((m.status||'').toLowerCase() === 'inactive') return false;
    if (!filterCat) return true;
    return (m.category||'').toLowerCase().trim() === filterCat;
  });
  if (!el) return;
  if (!matching.length) {
    el.style.cssText = 'display:block;background:#fee2e2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#991b1b';
    el.innerHTML = '<b>No active items found</b>' + (category ? ' with category <b>' + esc(category) + '</b>.' : '.');
    return;
  }
  el.style.cssText = 'display:block;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 14px;font-size:0.82rem;color:#0369a1';
  el.innerHTML = '<b>' + matching.length + ' item(s) will be updated</b>' +
    (category ? ' — Category: <b>' + esc(category) + '</b>' : ' — All categories') +
    '<div style="margin-top:8px;max-height:150px;overflow-y:auto">' +
    matching.slice(0,20).map(function(m){ return '<div style="padding:2px 0;font-size:0.78rem">• ' + esc(m.description) + '</div>'; }).join('') +
    (matching.length > 20 ? '<div style="font-size:0.75rem;color:#0369a1">...and ' + (matching.length-20) + ' more</div>' : '') +
    '</div>';
}

async function inc_applyBranchAmount() {
  const branch   = document.getElementById('sa_branch')?.value;
  const category = (document.getElementById('sa_category')?.value || '').trim();
  const amount   = document.getElementById('sa_amount')?.value;
  if (!branch)  { toast('Please select a branch.', 'warning'); return; }
  if (!amount || isNaN(parseFloat(amount))) { toast('Please enter a valid amount.', 'warning'); return; }
  const btn = document.querySelector('#incContent .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Applying...'; }
  try {
    const res = await gasPost({ action:'inc_setBranchAmounts', branch, category, amount: parseFloat(amount) });
    if (res.success) {
      toast('Done! Updated ' + res.updated + ' item(s) for ' + (INC_BRANCHES_DISP[INC_BRANCHES.indexOf(branch)] || branch) + '.', 'success');
      inc_masterCache = []; window._incCacheTime = 0;
      if (document.getElementById('sa_amount')) document.getElementById('sa_amount').value = '';
      const prevEl = document.getElementById('sa_preview');
      if (prevEl) prevEl.style.display = 'none';
    } else { toast(res.message || 'Error.', 'error'); }
  } catch(e) { toast('Network error: ' + e.message, 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = 'Apply to Matching Items'; }
}

// ── DAILY REPORT ──────────────────────────────────────────
// ── BRANCH FILTER (admin / clerk incentive screens) ─────────
let inc_branchFilter = '';   // '' = all branches

function inc_branchDisp(b) {
  const i = INC_BRANCHES.indexOf(b);
  return i >= 0 ? INC_BRANCHES_DISP[i] : (b || '-');
}

function inc_filterByBranch(list) {
  return inc_branchFilter ? (list || []).filter(c => String(c.branch || '') === inc_branchFilter) : (list || []);
}

function inc_branchSelectHtml(onchangeJs) {
  return '<select id="incBranchFilter" onchange="' + onchangeJs + '" ' +
    'style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font-main);background:#fff">' +
    '<option value="">All Branches</option>' +
    INC_BRANCHES.map(function(b, i) {
      return '<option value="' + b + '"' + (b === inc_branchFilter ? ' selected' : '') + '>' + INC_BRANCHES_DISP[i] + '</option>';
    }).join('') + '</select>';
}

function inc_setBranchFilter(val, reloadFn) {
  inc_branchFilter = val || '';
  reloadFn();
}

// group (already filtered) claims into per-employee rows
// Rejected claims are never paid, so they are left out of every total
function inc_isLive(c) { var s = String(c.status || '').toLowerCase(); return s !== 'rejected' && s !== 'voided'; }

function inc_summarize(claims) {
  const byEmp = {};
  claims.filter(inc_isLive).forEach(function(c) {
    const k = c.employeeId;
    if (!byEmp[k]) byEmp[k] = { employeeId: c.employeeId, employeeName: c.employeeName, branch: c.branch || '', total: 0, count: 0 };
    byEmp[k].total += parseFloat(c.totalIncentive || 0);
    byEmp[k].count++;
  });
  return Object.keys(byEmp).map(k => byEmp[k]);
}

async function inc_loadDailyReport(dateVal) {
  const el = document.getElementById('incContent');
  if (!el) return;
  const today = localDateStr(new Date());
  const d     = dateVal || today;
  el.innerHTML =
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">' +
      '<input type="date" id="incDatePicker" value="' + d + '" ' +
        'onchange="inc_loadDailyReport(this.value)" ' +
        'style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font-main)">' +
      '<button class="btn btn-ghost btn-sm" onclick="inc_loadDailyReport(\'' + today + '\')">Today</button>' +
      inc_branchSelectHtml("inc_setBranchFilter(this.value, function(){ inc_loadDailyReport(document.getElementById('incDatePicker').value); })") +
    '</div>' +
    '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    const res = await gasRequest({ action:'inc_getDailySummary', date:d });
    if (!res.success) { toast(res.message || 'Error loading report.','error'); return; }
    const claims     = inc_filterByBranch(res.claims || []);
    const summary    = inc_summarize(claims);
    const grandTotal = claims.filter(inc_isLive).reduce((t, c) => t + parseFloat(c.totalIncentive || 0), 0);

    if (!summary.length) {
      el.innerHTML += '<div class="no-data"><div class="no-data-icon"></div><div class="no-data-text">No incentive claims for ' + d + '</div></div>';
      // Re-render the date picker
      el.innerHTML =
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">' +
          '<input type="date" id="incDatePicker" value="' + d + '" onchange="inc_loadDailyReport(this.value)" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font-main)">' +
          '<button class="btn btn-ghost btn-sm" onclick="inc_loadDailyReport(\'' + today + '\')">Today</button>' +
          inc_branchSelectHtml("inc_setBranchFilter(this.value, function(){ inc_loadDailyReport(document.getElementById('incDatePicker').value); })") +
        '</div>' +
        '<div class="no-data"><div class="no-data-icon"></div><div class="no-data-text">No incentive claims for ' + d + (inc_branchFilter ? ' in ' + esc(inc_branchDisp(inc_branchFilter)) : '') + '</div></div>';
      return;
    }

    // per-branch totals (only when viewing all branches)
    let branchChips = '';
    if (!inc_branchFilter) {
      const bt = {};
      claims.filter(inc_isLive).forEach(c => { const b = c.branch || ''; bt[b] = (bt[b] || 0) + parseFloat(c.totalIncentive || 0); });
      branchChips = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
        Object.keys(bt).sort().map(b =>
          '<div style="background:var(--surface,#fff);border:1px solid var(--border);border-radius:10px;padding:8px 14px;min-width:110px">' +
            '<div style="font-size:0.7rem;color:var(--text3);text-transform:uppercase">' + esc(b ? inc_branchDisp(b) : 'No branch') + '</div>' +
            '<div style="font-weight:700;font-family:var(--font-mono)">&#8369;' + bt[b].toFixed(2) + '</div></div>'
        ).join('') + '</div>';
    }

    const empRows = summary.map(s =>
      '<tr>' +
        '<td><b>' + esc(s.employeeName) + '</b></td>' +
        '<td>' + esc(inc_branchDisp(s.branch)) + '</td>' +
        '<td style="text-align:center">' + s.count + '</td>' +
        '<td class="fw-700 text-green" style="font-size:1rem">&#8369;' + parseFloat(s.total).toFixed(2) + '</td>' +
        '<td><button class="btn btn-ghost btn-sm" onclick="inc_viewEmployeeDay(\'' + esc(s.employeeId) + '\',\'' + d + '\')">View Items</button></td>' +
      '</tr>'
    ).join('');

    el.innerHTML =
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">' +
        '<input type="date" id="incDatePicker" value="' + d + '" onchange="inc_loadDailyReport(this.value)" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font-main)">' +
        '<button class="btn btn-ghost btn-sm" onclick="inc_loadDailyReport(\'' + today + '\')">Today</button>' +
        inc_branchSelectHtml("inc_setBranchFilter(this.value, function(){ inc_loadDailyReport(document.getElementById('incDatePicker').value); })") +
        '<button class="btn btn-ghost btn-sm" onclick="inc_viewAllItemsDay(\'' + d + '\')">View All Items</button>' +
        '<button class="btn btn-success btn-sm" onclick="inc_exportDailyExcel(\'' + d + '\')">Export Excel</button>' +
      '</div>' +
      branchChips +
      '<div class="card">' +
        '<div class="card-hdr" style="padding:14px 18px;border-bottom:1px solid var(--border)">' +
          '<span style="font-weight:700">Employee Incentive Summary' + (inc_branchFilter ? ' &mdash; ' + esc(inc_branchDisp(inc_branchFilter)) : '') + '</span>' +
          '<span style="font-size:0.8rem;color:var(--text3)">' + safeFormatDateOnly(d) + '</span>' +
        '</div>' +
        '<div class="tbl-wrap"><table>' +
          '<thead><tr><th>Employee</th><th>Branch</th><th>Claims</th><th>Total Incentive</th><th></th></tr></thead>' +
          '<tbody>' + empRows + '</tbody>' +
        '</table></div>' +
      '</div>' +
      '<div style="background:var(--text1,#111);color:white;border-radius:10px;padding:16px 22px;display:flex;justify-content:space-between;align-items:center;margin-top:4px">' +
        '<div>' +
          '<div style="font-size:0.75rem;opacity:.6">GRAND TOTAL INCENTIVE RECEIVABLE</div>' +
          '<div style="font-size:0.72rem;opacity:.45">' + safeFormatDateOnly(d) + ' &bull; ' + summary.length + ' employee(s)' + (inc_branchFilter ? ' &bull; ' + esc(inc_branchDisp(inc_branchFilter)) : '') + '</div>' +
        '</div>' +
        '<div style="font-size:1.8rem;font-weight:700;font-family:var(--font-mono)">&#8369;' + parseFloat(grandTotal).toFixed(2) + '</div>' +
      '</div>';

  } catch(e) {
    toast('Network error loading daily report.', 'error');
  }
}

// ── VIEW EMPLOYEE ITEMS FOR A DAY ─────────────────────────
async function inc_viewEmployeeDay(employeeId, date) {
  const el = document.getElementById('incContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  try {
    const res    = await gasRequest({ action:'inc_getClaims', employeeId:employeeId, date:date });
    const claims = res.data || [];
    const total  = claims.filter(inc_isLive).reduce((s,c) => s + parseFloat(c.totalIncentive||0), 0);
    const empName = claims.length ? claims[0].employeeName : '';

    const rows = claims.map(c =>
      '<tr>' +
        '<td style="font-family:var(--font-mono);font-size:0.78rem">' + esc(c.invoiceNo) + '</td>' +
        '<td style="font-family:var(--font-mono);font-size:0.78rem">' + esc(c.barcode) + '</td>' +
        '<td><b>' + esc(c.description) + '</b>' + (c.category ? '<div style="font-size:0.72rem;color:var(--text3)">' + esc(c.category) + '</div>' : '') + '</td>' +
        '<td style="text-align:center">' + (c.qty||1) + '</td>' +
        '<td>&#8369;' + parseFloat(c.incentivePerUnit||0).toFixed(2) + '</td>' +
        '<td class="fw-700 text-green">&#8369;' + parseFloat(c.totalIncentive||0).toFixed(2) + '</td>' +
        '<td>' + inc_statusBadge(c.status) + '</td>' +
        '<td>' + inc_actionBtns(c) + '</td>' +
      '</tr>'
    ).join('') || '<tr><td colspan="8"><div class="no-data"><div class="no-data-text">No claims.</div></div></td></tr>';

    el.innerHTML =
      '<div class="back-link" onclick="inc_loadDailyReport(\'' + date + '\')" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:var(--text3);font-size:0.82rem;margin-bottom:16px">' +
        '&#8592; Back to Daily Report' +
      '</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">' +
        '<div><div style="font-size:1rem;font-weight:700">' + esc(empName) + '</div><div style="font-size:0.78rem;color:var(--text3)">' + safeFormatDateOnly(date) + '</div></div>' +
        '<div style="font-size:1.4rem;font-weight:700;color:var(--green)">&#8369;' + total.toFixed(2) + '</div>' +
      '</div>' +
      '<div class="card"><div class="tbl-wrap"><table>' +
        '<thead><tr><th>Invoice</th><th>Barcode</th><th>Item</th><th>Qty</th><th>&#8369;/Unit</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div></div>';
  } catch(e) {
    toast('Error loading employee claims.', 'error');
  }
}

// ── VIEW ALL ITEMS FOR A DAY ──────────────────────────────
async function inc_viewAllItemsDay(date) {
  const el = document.getElementById('incContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  try {
    const res    = await gasRequest({ action:'inc_getDailySummary', date:date });
    const claims = inc_filterByBranch(res.claims || []);
    const grand  = claims.filter(inc_isLive).reduce((t, c) => t + parseFloat(c.totalIncentive || 0), 0);

    const rows = claims.map(c =>
      '<tr>' +
        '<td><b>' + esc(c.employeeName) + '</b></td>' +
        '<td>' + esc(inc_branchDisp(c.branch)) + '</td>' +
        '<td style="font-family:var(--font-mono);font-size:0.78rem">' + esc(c.invoiceNo) + '</td>' +
        '<td>' + esc(c.description) + '</td>' +
        '<td style="text-align:center">' + (c.qty||1) + '</td>' +
        '<td class="fw-700 text-green">&#8369;' + parseFloat(c.totalIncentive||0).toFixed(2) + '</td>' +
        '<td>' + inc_statusBadge(c.status) + '</td>' +
      '</tr>'
    ).join('') || '<tr><td colspan="7"><div class="no-data"><div class="no-data-text">No items.</div></div></td></tr>';

    el.innerHTML =
      '<div class="back-link" onclick="inc_loadDailyReport(\'' + date + '\')" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;color:var(--text3);font-size:0.82rem;margin-bottom:16px">' +
        '&#8592; Back to Daily Report' +
      '</div>' +
      '<div style="font-size:0.95rem;font-weight:700;margin-bottom:12px">All Items &mdash; ' + safeFormatDateOnly(date) + (inc_branchFilter ? ' &mdash; ' + esc(inc_branchDisp(inc_branchFilter)) : '') + '</div>' +
      '<div class="card"><div class="tbl-wrap"><table>' +
        '<thead><tr><th>Employee</th><th>Branch</th><th>OR No.</th><th>Item</th><th>Qty</th><th>Incentive</th><th>Status</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div></div>' +
      '<div style="background:var(--text1,#111);color:white;border-radius:10px;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;margin-top:8px">' +
        '<span style="opacity:.6;font-size:0.8rem">GRAND TOTAL</span>' +
        '<span style="font-size:1.4rem;font-weight:700">&#8369;' + parseFloat(grand).toFixed(2) + '</span>' +
      '</div>';
  } catch(e) {
    toast('Error loading items.', 'error');
  }
}

// ── ALL CLAIMS (date range + branch + category + status) ───
let inc_allFilter = { from: '', to: '', category: '', status: '' };
let inc_allClaimsCache = [];
let inc_allCatNames = [];
let inc_allGroup = false;   // group claims by OR number
let inc_view = 'daily';     // which admin tab is open

function inc_toggleGroup() { inc_allGroup = !inc_allGroup; inc_renderAllClaims(); }

function inc_normOR(v) { return String(v || '').toUpperCase().replace(/[\s\-_.#]/g, ''); }

// rows grouped under one header per OR number; flags look-alike item names claimed by different agents
function inc_groupedRowsHtml(claims) {
  const groups = {}, order = [];
  claims.forEach(function(c) {
    const k = inc_normOR(c.invoiceNo);
    if (!groups[k]) { groups[k] = { or: c.invoiceNo, lines: [] }; order.push(k); }
    groups[k].lines.push(c);
  });
  return order.map(function(k) {
    const g = groups[k];
    const lines = g.lines.slice().sort((a, b) => String(a.claimDate).localeCompare(String(b.claimDate)));
    const total = lines.filter(inc_isLive).reduce((t, c) => t + parseFloat(c.totalIncentive || 0), 0);
    const agents = Array.from(new Set(lines.filter(inc_isLive).map(c => c.employeeName)));
    // possible duplicates: different names that look alike, claimed by different agents
    const flagged = {};
    for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      if (a.employeeName === b.employeeName) continue;
      if (String(a.status).toLowerCase() === 'rejected' || String(b.status).toLowerCase() === 'rejected') continue;
      const na = inc_normItem(a.description), nb = inc_normItem(b.description);
      if (na !== nb && inc_similarity(a.description, b.description) >= 0.8) { flagged[a.id] = true; flagged[b.id] = true; }
    }
    const head = '<tr style="background:var(--bg2,#f1f5f9)"><td colspan="9" style="padding:10px 14px">' +
      '<b style="font-family:var(--font-mono)">OR ' + esc(g.or) + '</b>' +
      ' &nbsp;&bull;&nbsp; ' + lines.length + ' item(s) &nbsp;&bull;&nbsp; ' + agents.length + ' agent(s): ' + esc(agents.join(', ')) +
      ' &nbsp;&bull;&nbsp; <b class="text-green">&#8369;' + total.toFixed(2) + '</b></td></tr>';
    const body = lines.map(function(c) {
      const q = parseInt(c.qty || 1), oq = parseInt(c.qtyOnOR) || q;
      return '<tr>' +
        '<td style="font-size:0.78rem">' + safeFormatDateTime(c.claimDate) + '</td>' +
        '<td><b>' + esc(c.employeeName) + '</b></td>' +
        '<td>' + esc(inc_branchDisp(c.branch)) + '</td>' +
        '<td style="font-family:var(--font-mono);font-size:0.75rem;color:var(--text3)">' + esc(c.invoiceNo) + '</td>' +
        '<td>' + esc(c.description) + (c.category ? '<div style="font-size:0.72rem;color:var(--text3)">' + esc(c.category) + '</div>' : '') +
          (flagged[c.id] ? '<div style="font-size:0.72rem;color:var(--amber,#d97706);font-weight:700">&#9888; Possible duplicate</div>' : '') + '</td>' +
        '<td style="text-align:center">' + q + (oq > q ? '<div style="font-size:0.7rem;color:var(--text3)">of ' + oq + '</div>' : '') + '</td>' +
        '<td class="fw-700">&#8369;' + parseFloat(c.totalIncentive || 0).toFixed(2) + '</td>' +
        '<td>' + inc_statusBadge(c.status) + '</td>' +
        '<td>' + inc_actionBtns(c) + '</td>' +
      '</tr>';
    }).join('');
    return head + body;
  }).join('') || '<tr><td colspan="9"><div class="no-data"><div class="no-data-text">No claims match these filters.</div></div></td></tr>';
}

let _incCatCache = null;   // short-lived copy of the category list for the claim form
async function inc_loadAllClaims() {
  const el = document.getElementById('incContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  try {
    const [res, cres] = await Promise.all([
      gasRequest({ action:'inc_getClaims' }),
      gasRequest({ action:'inc_getClaimCategories' }).catch(() => ({ data: [] })),
    ]);
    inc_allClaimsCache = res.data || [];
    // categories from the catalog, so the dropdown is never empty
    inc_allCatNames = ((cres && cres.data) || []).map(c => c.category).filter(Boolean);
    inc_renderAllClaims();
  } catch(e) {
    toast('Error loading claims.', 'error');
  }
}

function inc_claimDay(c) {
  const d = new Date(c.claimDate);
  return isNaN(d) ? String(c.claimDate || '').slice(0, 10) : localDateStr(d);
}

function inc_applyAllFilters() {
  const f = inc_allFilter;
  return inc_filterByBranch(inc_allClaimsCache).filter(function(c) {
    const day = inc_claimDay(c);
    if (f.from && day < f.from) return false;
    if (f.to   && day > f.to)   return false;
    if (f.category) {
      const cat = String(c.category || '');
      if (f.category === '__none__' ? cat !== '' : cat !== f.category) return false;
    }
    if (f.status && String(c.status || '').toLowerCase() !== f.status.toLowerCase()) return false;
    return true;
  });
}

function inc_allSet(field, val) {
  inc_allFilter[field] = val;
  inc_renderAllClaims();
}

// quick ranges: '1-15' / '16-end' of the current month, whole month, today, all
function inc_allPreset(kind) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const pad = n => String(n).padStart(2, '0');
  const ym = y + '-' + pad(m + 1);
  const last = new Date(y, m + 1, 0).getDate();
  if (kind === 'first')      { inc_allFilter.from = ym + '-01'; inc_allFilter.to = ym + '-15'; }
  else if (kind === 'second'){ inc_allFilter.from = ym + '-16'; inc_allFilter.to = ym + '-' + pad(last); }
  else if (kind === 'month') { inc_allFilter.from = ym + '-01'; inc_allFilter.to = ym + '-' + pad(last); }
  else if (kind === 'today') { inc_allFilter.from = inc_allFilter.to = localDateStr(now); }
  else                       { inc_allFilter.from = ''; inc_allFilter.to = ''; }
  inc_renderAllClaims();
}

function inc_renderAllClaims() {
  const el = document.getElementById('incContent');
  if (!el) return;
  const f = inc_allFilter;
  const claims = inc_applyAllFilters().slice().sort((a, b) => String(b.claimDate).localeCompare(String(a.claimDate)));
  const total  = claims.filter(inc_isLive).reduce((t, c) => t + parseFloat(c.totalIncentive || 0), 0);

  // categories that appear in the data
  const catSet = {};
  let hasNone = false;
  inc_allCatNames.forEach(n => { catSet[n] = true; });
  inc_allClaimsCache.forEach(c => { if (c.category) catSet[c.category] = true; else hasNone = true; });
  const catOpts = '<option value="">All Categories</option>' +
    Object.keys(catSet).sort().map(c => '<option value="' + esc(c) + '"' + (c === f.category ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
    (hasNone ? '<option value="__none__"' + (f.category === '__none__' ? ' selected' : '') + '>(No category - old claims)</option>' : '');
  const stOpts = ['', 'Pending', 'Verified', 'Rejected'].map(v =>
    '<option value="' + v + '"' + (v === f.status ? ' selected' : '') + '>' + (v || 'All Status') + '</option>').join('');
  const inStyle = 'padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font-main);background:#fff';

  // totals per category for the filtered view
  const byCat = {};
  claims.filter(inc_isLive).forEach(c => { const k = c.category || '(No category)'; if (!byCat[k]) byCat[k] = { qty: 0, total: 0 }; byCat[k].qty += parseInt(c.qty || 1); byCat[k].total += parseFloat(c.totalIncentive || 0); });
  const catChips = Object.keys(byCat).sort().map(k =>
    '<div style="background:var(--surface,#fff);border:1px solid var(--border);border-radius:10px;padding:8px 14px;min-width:120px">' +
      '<div style="font-size:0.7rem;color:var(--text3);text-transform:uppercase">' + esc(k) + ' &bull; ' + byCat[k].qty + ' pc</div>' +
      '<div style="font-weight:700;font-family:var(--font-mono)">&#8369;' + byCat[k].total.toFixed(2) + '</div></div>'
  ).join('');

  const rows = claims.map(c =>
    '<tr>' +
      '<td style="font-size:0.78rem">' + safeFormatDateTime(c.claimDate) + '</td>' +
      '<td><b>' + esc(c.employeeName) + '</b></td>' +
      '<td>' + esc(inc_branchDisp(c.branch)) + '</td>' +
      '<td style="font-family:var(--font-mono);font-size:0.78rem">' + esc(c.invoiceNo) + '</td>' +
      '<td>' + esc(c.description) + (c.category ? '<div style="font-size:0.72rem;color:var(--text3)">' + esc(c.category) + '</div>' : '') + '</td>' +
      '<td style="text-align:center">' + (c.qty||1) + ((parseInt(c.qtyOnOR) || 0) > (parseInt(c.qty) || 1) ? '<div style="font-size:0.7rem;color:var(--text3)">of ' + c.qtyOnOR + '</div>' : '') + '</td>' +
      '<td class="fw-700">&#8369;' + parseFloat(c.totalIncentive||0).toFixed(2) + '</td>' +
      '<td>' + inc_statusBadge(c.status) + '</td>' +
      '<td>' + inc_actionBtns(c) + '</td>' +
    '</tr>'
  ).join('') || '<tr><td colspan="9"><div class="no-data"><div class="no-data-text">No claims match these filters.</div></div></td></tr>';

  el.innerHTML =
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">' +
      '<label style="font-size:0.78rem;color:var(--text3)">From</label>' +
      '<input type="date" value="' + esc(f.from) + '" onchange="inc_allSet(\'from\', this.value)" style="' + inStyle + '">' +
      '<label style="font-size:0.78rem;color:var(--text3)">To</label>' +
      '<input type="date" value="' + esc(f.to) + '" onchange="inc_allSet(\'to\', this.value)" style="' + inStyle + '">' +
      inc_branchSelectHtml("inc_setBranchFilter(this.value, inc_renderAllClaims)") +
      '<select onchange="inc_allSet(\'category\', this.value)" style="' + inStyle + '">' + catOpts + '</select>' +
      '<select onchange="inc_allSet(\'status\', this.value)" style="' + inStyle + '">' + stOpts + '</select>' +
    '</div>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
      '<button class="btn btn-ghost btn-sm" onclick="inc_allPreset(\'first\')">1-15 (this month)</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="inc_allPreset(\'second\')">16-end (this month)</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="inc_allPreset(\'month\')">This month</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="inc_allPreset(\'today\')">Today</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="inc_allPreset(\'all\')">All dates</button>' +
      '<button class="btn ' + (inc_allGroup ? 'btn-primary' : 'btn-ghost') + ' btn-sm" onclick="inc_toggleGroup()">' + (inc_allGroup ? 'Grouped by OR' : 'Group by OR') + '</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="inc_loadAllClaims()" title="Reload">&#8635; Refresh</button>' +
      '<button class="btn btn-success btn-sm" onclick="inc_exportFilteredClaims()">Export Excel</button>' +
    '</div>' +
    '<div style="background:var(--text1,#111);color:white;border-radius:10px;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:6px">' +
      '<span style="font-size:0.8rem;opacity:.7">' + claims.length + ' claim(s)' + (f.from || f.to ? ' &bull; ' + esc(f.from || '...') + ' to ' + esc(f.to || '...') : '') + '</span>' +
      '<span style="font-size:1.3rem;font-weight:700;font-family:var(--font-mono)">&#8369;' + total.toFixed(2) + '</span>' +
    '</div>' +
    (catChips ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' + catChips + '</div>' : '') +
    '<div class="card"><div class="tbl-wrap" style="max-height:60vh;overflow-y:auto"><table>' +
      '<thead><tr><th>Date</th><th>Employee</th><th>Branch</th><th>OR No.</th><th>Item</th><th>Qty</th><th>Total</th><th>Status</th><th>Action</th></tr></thead>' +
      '<tbody>' + (inc_allGroup ? inc_groupedRowsHtml(claims) : rows) + '</tbody>' +
    '</table></div></div>';
}

function inc_exportFilteredClaims() {
  const claims = inc_applyAllFilters().slice().sort((a, b) => String(a.claimDate).localeCompare(String(b.claimDate)));
  if (!claims.length) { toast('No data to export.', 'warning'); return; }
  const f = inc_allFilter;
  const total = claims.filter(inc_isLive).reduce((t, c) => t + parseFloat(c.totalIncentive || 0), 0);
  const HEADER = ['Date','Employee','Branch','OR No.','Category','Description','Qty','Incentive/Unit','Total Incentive','Status'];
  const data = claims.map(c => [
    safeFormatDateTime(c.claimDate), c.employeeName, inc_branchDisp(c.branch), c.invoiceNo, c.category || '', c.description,
    parseInt(c.qty || 1), parseFloat(c.incentivePerUnit || 0), parseFloat(c.totalIncentive || 0), c.status
  ]);
  const byCat = {};
  claims.forEach(c => { const k = c.category || '(No category)'; byCat[k] = (byCat[k] || 0) + parseFloat(c.totalIncentive || 0); });
  const sheet = [
    ['AE HOME POS — Incentive Claims'],
    ['Period:', (f.from || 'start') + ' to ' + (f.to || 'latest')],
    ['Branch:', inc_branchFilter ? inc_branchDisp(inc_branchFilter) : 'All Branches'],
    ['Category:', f.category === '__none__' ? '(No category)' : (f.category || 'All')],
    ['Status:', f.status || 'All'],
    [],
    HEADER, ...data, [],
    ['TOTAL PER CATEGORY'],
    ...Object.keys(byCat).sort().map(k => [k, byCat[k]]),
    [],
    ['Grand Total:', total],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sheet);
  ws['!cols'] = [{wch:20},{wch:22},{wch:12},{wch:16},{wch:16},{wch:30},{wch:6},{wch:14},{wch:16},{wch:10}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Claims');
  XLSX.writeFile(wb, 'IncentiveClaims_' + (f.from || 'all') + '_to_' + (f.to || 'latest') + '.xlsx');
  toast('Excel downloaded!', 'success');
}

// ══════════════════════════════════════════════════════════
// OR CHECK — one card per OR: who claimed what, how many agents, flags
// ══════════════════════════════════════════════════════════
let inc_orFilter = { q: '', from: '', to: '', status: '', flagged: false, multi: false };

async function inc_loadOrCheck() {
  const el = document.getElementById('incContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  try {
    const res = await gasRequest({ action:'inc_getClaims' });
    inc_allClaimsCache = res.data || [];
    inc_renderOrCheck();
  } catch(e) { toast('Error loading claims.', 'error'); }
}

function inc_orSet(field, val) { inc_orFilter[field] = val; inc_renderOrCheck(); }

// build the OR groups (after filters) with their flags and counts
function inc_buildOrGroups() {
  const f = inc_orFilter;
  const q = f.q.toLowerCase().trim();
  const groups = {}, order = [];
  inc_filterByBranch(inc_allClaimsCache).forEach(function(c) {
    const day = inc_claimDay(c);
    if (f.from && day < f.from) return;
    if (f.to   && day > f.to)   return;
    const k = inc_normOR(c.invoiceNo);
    if (!groups[k]) { groups[k] = { key: k, or: c.invoiceNo, lines: [] }; order.push(k); }
    groups[k].lines.push(c);
  });
  let list = order.map(function(k) {
    const g = groups[k];
    g.lines.sort((a, b) => String(a.claimDate).localeCompare(String(b.claimDate)));
    const live = g.lines.filter(c => String(c.status).toLowerCase() !== 'rejected');
    g.live = live;
    g.agents = Array.from(new Set(live.map(c => c.employeeName)));
    g.pcs    = live.reduce((t, c) => t + (parseInt(c.qty) || 1), 0);
    g.total  = live.reduce((t, c) => t + parseFloat(c.totalIncentive || 0), 0);
    g.pending = g.lines.filter(c => String(c.status).toLowerCase() === 'pending');
    g.firstDate = g.lines[0] ? g.lines[0].claimDate : '';
    // flags
    g.flags = [];
    const byItem = {};
    live.forEach(function(c) {
      const n = inc_normItem(c.description);
      const e = byItem[n] || (byItem[n] = { name: c.description, claimed: 0, total: 0, cats: {} });
      e.claimed += parseInt(c.qty) || 1; e.total = Math.max(e.total, parseInt(c.qtyOnOR) || 0); e.cats[c.category || ''] = true;
    });
    const over = [], unclaimed = [], catDiff = [];
    Object.keys(byItem).forEach(function(n) {
      const e = byItem[n];
      if (e.total && e.claimed > e.total) over.push(e.name + ' (' + e.claimed + ' of ' + e.total + ')');
      else if (e.total && e.claimed < e.total) unclaimed.push(e.name + ' (' + (e.total - e.claimed) + ' pc not claimed)');
      if (Object.keys(e.cats).length > 1) catDiff.push(e.name);
    });
    g.dupIds = {};
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (a.employeeName === b.employeeName) continue;
      if (inc_normItem(a.description) !== inc_normItem(b.description) && inc_similarity(a.description, b.description) >= 0.8) { g.dupIds[a.id] = true; g.dupIds[b.id] = true; }
    }
    if (Object.keys(g.dupIds).length) g.flags.push({ t: 'Possible duplicate', c: 'warn' });
    if (over.length)      g.flags.push({ t: 'Over-claimed: ' + over.join(', '), c: 'bad' });
    if (catDiff.length)   g.flags.push({ t: 'Different categories for: ' + catDiff.join(', '), c: 'warn' });
    if (unclaimed.length) g.flags.push({ t: 'Not fully claimed: ' + unclaimed.join(', '), c: 'info' });
    g.hasProblem = g.flags.some(x => x.c !== 'info');
    return g;
  });
  list = list.filter(function(g) {
    if (f.status && !g.lines.some(c => String(c.status).toLowerCase() === f.status.toLowerCase())) return false;
    if (f.multi && g.agents.length < 2) return false;
    if (f.flagged && !g.hasProblem) return false;
    if (q) {
      const hay = (g.or + ' ' + g.lines.map(c => c.employeeName + ' ' + c.description + ' ' + c.category).join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  list.sort((a, b) => String(b.firstDate).localeCompare(String(a.firstDate)));
  return list;
}

function inc_renderOrCheck() {
  const el = document.getElementById('incContent');
  if (!el) return;
  const keepY = window.scrollY, pc = document.getElementById('pageContent'), keepPc = pc ? pc.scrollTop : 0;
  const f = inc_orFilter;
  const groups = inc_buildOrGroups();
  const inStyle = 'padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font-main);background:#fff';
  const stOpts = ['', 'Pending', 'Verified', 'Rejected'].map(v => '<option value="' + v + '"' + (v === f.status ? ' selected' : '') + '>' + (v || 'All Status') + '</option>').join('');
  const flagStyle = { warn: 'background:#fffbeb;color:#92400e', bad: 'background:#fee2e2;color:#991b1b', info: 'background:#e0f2fe;color:#075985' };

  const multiCount = groups.filter(g => g.agents.length > 1).length;
  const probCount  = groups.filter(g => g.hasProblem).length;
  const pendCount  = groups.reduce((t, g) => t + g.pending.length, 0);

  const cards = groups.map(function(g) {
    const flags = g.flags.map(x => '<span style="' + flagStyle[x.c] + ';padding:2px 9px;border-radius:20px;font-size:0.72rem;font-weight:700;margin-right:6px;display:inline-block;margin-top:4px">' + (x.c === 'bad' || x.c === 'warn' ? '&#9888; ' : '') + esc(x.t) + '</span>').join('');
    const rows = g.lines.map(function(c) {
      const rej = String(c.status).toLowerCase() === 'rejected';
      const q = parseInt(c.qty) || 1, oq = parseInt(c.qtyOnOR) || q;
      return '<tr' + (rej ? ' style="opacity:.55"' : '') + '>' +
        '<td><b>' + esc(c.employeeName) + '</b></td>' +
        '<td>' + esc(inc_branchDisp(c.branch)) + '</td>' +
        '<td>' + esc(c.description) + (c.category ? '<div style="font-size:0.72rem;color:var(--text3)">' + esc(c.category) + '</div>' : '') +
          (g.dupIds[c.id] ? '<div style="font-size:0.72rem;color:var(--amber,#d97706);font-weight:700">&#9888; Possible duplicate</div>' : '') + '</td>' +
        '<td style="text-align:center">' + q + (oq > q ? '<div style="font-size:0.7rem;color:var(--text3)">of ' + oq + '</div>' : '') + '</td>' +
        '<td class="fw-700">&#8369;' + parseFloat(c.totalIncentive || 0).toFixed(2) + '</td>' +
        '<td>' + inc_statusBadge(c.status) + '</td>' +
        '<td>' + inc_actionBtns(c) + '</td>' +
      '</tr>';
    }).join('');
    const byAgent = g.agents.map(a => {
      const mine = g.live.filter(c => c.employeeName === a);
      return esc(a) + ' (' + mine.length + ' item' + (mine.length === 1 ? '' : 's') + ', &#8369;' + mine.reduce((t, c) => t + parseFloat(c.totalIncentive || 0), 0).toFixed(2) + ')';
    }).join(' &nbsp;&bull;&nbsp; ');
    return '<div class="card" style="margin-bottom:14px;' + (g.hasProblem ? 'border:1.5px solid #fcd34d' : '') + '">' +
      '<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">' +
        '<div>' +
          '<div><b style="font-family:var(--font-mono);font-size:1rem">OR ' + esc(g.or) + '</b>' +
            ' <span style="font-size:0.78rem;color:var(--text3)">' + safeFormatDateTime(g.firstDate) + '</span></div>' +
          '<div style="font-size:0.82rem;margin-top:4px"><b>' + g.agents.length + '</b> agent(s) &bull; <b>' + g.live.length + '</b> item line(s) &bull; <b>' + g.pcs + '</b> pc &bull; <b class="text-green">&#8369;' + g.total.toFixed(2) + '</b></div>' +
          '<div style="font-size:0.78rem;color:var(--text2);margin-top:3px">' + (byAgent || '<i>All lines rejected</i>') + '</div>' +
          '<div>' + flags + '</div>' +
        '</div>' +
        (g.pending.length ? '<button class="btn btn-success btn-sm" onclick="inc_verifyAllInOr(\'' + esc(g.key) + '\', this)">Verify all pending (' + g.pending.length + ')</button>' : '<span style="font-size:0.78rem;color:var(--green,#059669);font-weight:700">&#10003; Nothing pending</span>') +
      '</div>' +
      '<div class="tbl-wrap"><table><thead><tr><th>Agent</th><th>Branch</th><th>Item</th><th>Qty</th><th>Incentive</th><th>Status</th><th>Action</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '</div>';
  }).join('') || '<div class="no-data"><div class="no-data-text">No ORs match these filters.</div></div>';

  el.innerHTML =
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">' +
      '<input type="text" id="inc_or_q" placeholder="Search OR, agent or item..." value="' + esc(f.q) + '" oninput="inc_orSearchInput(this.value)" style="' + inStyle + ';min-width:230px">' +
      '<label style="font-size:0.78rem;color:var(--text3)">From</label><input type="date" value="' + esc(f.from) + '" onchange="inc_orSet(\'from\', this.value)" style="' + inStyle + '">' +
      '<label style="font-size:0.78rem;color:var(--text3)">To</label><input type="date" value="' + esc(f.to) + '" onchange="inc_orSet(\'to\', this.value)" style="' + inStyle + '">' +
      inc_branchSelectHtml("inc_setBranchFilter(this.value, inc_renderOrCheck)") +
      '<select onchange="inc_orSet(\'status\', this.value)" style="' + inStyle + '">' + stOpts + '</select>' +
    '</div>' +
    '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:12px;font-size:0.82rem">' +
      '<label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox"' + (f.multi ? ' checked' : '') + ' onchange="inc_orSet(\'multi\', this.checked)"> Shared by 2+ agents</label>' +
      '<label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox"' + (f.flagged ? ' checked' : '') + ' onchange="inc_orSet(\'flagged\', this.checked)"> With warnings only</label>' +
      '<button class="btn btn-ghost btn-sm" onclick="inc_orReset()">Reset</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="inc_loadOrCheck()">&#8635; Refresh</button>' +
      '<button class="btn btn-success btn-sm" onclick="inc_exportOrCheck()">Export Excel</button>' +
    '</div>' +
    '<div style="background:var(--text1,#111);color:white;border-radius:10px;padding:12px 20px;display:flex;gap:22px;flex-wrap:wrap;margin-bottom:14px;font-size:0.82rem">' +
      '<span><b>' + groups.length + '</b> OR(s)</span><span><b>' + multiCount + '</b> shared by 2+ agents</span>' +
      '<span><b>' + probCount + '</b> with warnings</span><span><b>' + pendCount + '</b> pending to verify</span>' +
    '</div>' + cards;
  window.scrollTo(0, keepY); if (pc) pc.scrollTop = keepPc;
}

let _orSearchTimer = null;
function inc_orSearchInput(v) {
  inc_orFilter.q = v;
  clearTimeout(_orSearchTimer);
  _orSearchTimer = setTimeout(function() {
    inc_renderOrCheck();
    const i = document.getElementById('inc_or_q');
    if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }, 300);
}

function inc_orReset() { inc_orFilter = { q: '', from: '', to: '', status: '', flagged: false, multi: false }; inc_branchFilter = ''; inc_renderOrCheck(); }

// verify every pending line of one OR (one call per line, same API as the single Verify button)
async function inc_verifyAllInOr(key, btn) {
  const g = inc_buildOrGroups().find(x => x.key === key);
  if (!g || !g.pending.length) return;
  if (!confirm('Verify ' + g.pending.length + ' pending item(s) under OR ' + g.or + '?')) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }
  let done = 0, failed = 0;
  for (const c of g.pending) {
    try {
      const res = await gasPost({ action:'inc_verifyClaim', id: c.id, verifiedBy: currentUser.name || currentUser.username });
      if (res.success) { done++; const x = inc_allClaimsCache.find(z => z.id === c.id); if (x) x.status = 'Verified'; } else failed++;
    } catch(e) { failed++; }
  }
  toast(done + ' verified' + (failed ? ', ' + failed + ' failed' : '') + '.', failed ? 'warning' : 'success');
  inc_renderOrCheck();
}

function inc_exportOrCheck() {
  const groups = inc_buildOrGroups();
  if (!groups.length) { toast('No data to export.', 'warning'); return; }
  const HEADER = ['OR No.','Date','Agent','Branch','Item','Category','Qty','Qty on OR','Incentive','Status','OR Agents','OR Warnings'];
  const data = [];
  groups.forEach(function(g) {
    g.lines.forEach(function(c) {
      data.push([g.or, safeFormatDateTime(c.claimDate), c.employeeName, inc_branchDisp(c.branch), c.description, c.category || '',
        parseInt(c.qty || 1), parseInt(c.qtyOnOR) || parseInt(c.qty || 1), parseFloat(c.totalIncentive || 0), c.status,
        g.agents.length, g.flags.filter(x => x.c !== 'info').map(x => x.t).join(' | ')]);
    });
  });
  const f = inc_orFilter;
  const sheet = [['AE HOME POS — OR Check'], ['Period:', (f.from || 'start') + ' to ' + (f.to || 'latest')], ['Branch:', inc_branchFilter ? inc_branchDisp(inc_branchFilter) : 'All Branches'], [], HEADER, ...data];
  const ws = XLSX.utils.aoa_to_sheet(sheet);
  ws['!cols'] = [{wch:16},{wch:20},{wch:22},{wch:12},{wch:30},{wch:16},{wch:6},{wch:10},{wch:12},{wch:10},{wch:10},{wch:40}];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'OR Check');
  XLSX.writeFile(wb, 'IncentiveORCheck_' + (f.from || 'all') + '_to_' + (f.to || 'latest') + '.xlsx');
  toast('Excel downloaded!', 'success');
}

// ══════════════════════════════════════════════════════════
// CATEGORIES & AMOUNTS (one amount per category, all branches)
// ══════════════════════════════════════════════════════════
let inc_catData  = [];
let inc_prodData = [];
let inc_catImportRows = [];

async function inc_loadCatalog() {
  const el = document.getElementById('incContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  try {
    const res = await gasRequest({ action: 'inc_getClaimCategories' });
    if (!res.success) { el.innerHTML = '<div class="no-data"><div class="no-data-text">' + esc(res.message || 'Error loading.') + '</div></div>'; return; }
    inc_catData  = res.data || [];
    inc_prodData = res.products || [];
    inc_renderCatalog();
  } catch(e) {
    el.innerHTML = '<div class="no-data"><div class="no-data-text">Error loading. Check connection.</div></div>';
  }
}

function inc_renderCatalog() {
  const el = document.getElementById('incContent');
  if (!el) return;
  const isAdmin = currentUser.role === 'admin';
  const rows = inc_catData.map(function(c) {
    const off = String(c.status).toLowerCase() === 'inactive';
    return '<tr' + (off ? ' style="opacity:.55"' : '') + '>' +
      '<td><b>' + esc(c.category) + '</b></td>' +
      '<td class="fw-700 text-green">&#8369;' + (parseFloat(c.amount) || 0).toFixed(2) + '</td>' +
      '<td style="text-align:center">' + (c.products || 0) + '</td>' +
      '<td>' + (off ? '<span class="badge-out">Inactive</span>' : '<span class="badge-in-stock">Active</span>') + '</td>' +
      (isAdmin ? '<td style="white-space:nowrap">' +
        '<button class="btn btn-ghost btn-sm" onclick="inc_openCategoryModal(\'' + esc(c.id) + '\')">Edit</button> ' +
        '<button class="btn btn-danger btn-sm" onclick="inc_deleteCategory(\'' + esc(c.id) + '\')">Delete</button></td>' : '') +
    '</tr>';
  }).join('') || '<tr><td colspan="5"><div class="no-data"><div class="no-data-text">No categories yet. Add one or upload a file.</div></div></td></tr>';

  el.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px">' +
      '<div style="font-size:0.85rem;color:var(--text2)">The amount you set here is the same for <b>all branches</b>. Agents type the item, pick the category, and the amount shows automatically.</div>' +
      (isAdmin ? '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-ghost btn-sm" onclick="inc_downloadCatalogTemplate()">Download Template</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'inc_cat_file\').click()">Upload Excel/CSV</button>' +
        '<button class="btn btn-primary btn-sm" onclick="inc_openCategoryModal()">+ Add Category</button>' +
        '<input type="file" id="inc_cat_file" accept=".xlsx,.xls,.csv" style="display:none" onchange="inc_handleCatalogUpload(this)">' +
      '</div>' : '') +
    '</div>' +
    '<div class="card"><div class="tbl-wrap"><table>' +
      '<thead><tr><th>Category</th><th>Amount</th><th>Product names</th><th>Status</th>' + (isAdmin ? '<th>Actions</th>' : '') + '</tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>' +
    '<div style="margin-top:18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
      '<div style="font-size:0.85rem;font-weight:700">Product names (suggestions for agents) &mdash; ' + inc_prodData.length + '</div>' +
      '<input type="text" id="inc_prod_q" placeholder="Search product or category..." oninput="inc_renderProductList()" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:var(--font-main);min-width:220px">' +
    '</div>' +
    '<div class="card" style="margin-top:8px"><div class="tbl-wrap"><table>' +
      '<thead><tr><th>Product Name</th><th>Category</th>' + (isAdmin ? '<th></th>' : '') + '</tr></thead>' +
      '<tbody id="inc_prod_body"></tbody></table></div></div>';
  inc_renderProductList();
}

function inc_renderProductList() {
  const body = document.getElementById('inc_prod_body');
  if (!body) return;
  const q = (document.getElementById('inc_prod_q')?.value || '').toLowerCase().trim();
  const isAdmin = currentUser.role === 'admin';
  const list = inc_prodData.filter(p => !q || p.productName.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  const shown = list.slice(0, 200);
  body.innerHTML = shown.map(function(p) {
    return '<tr><td>' + esc(p.productName) + '</td><td>' + esc(p.category) + '</td>' +
      (isAdmin ? '<td><button class="btn btn-danger btn-sm" onclick="inc_deleteProductName(\'' + esc(p.id) + '\')">Remove</button></td>' : '') + '</tr>';
  }).join('') || '<tr><td colspan="3"><div class="no-data"><div class="no-data-text">No product names.</div></div></td></tr>';
  if (list.length > shown.length) {
    body.innerHTML += '<tr><td colspan="3" style="text-align:center;color:var(--text3);font-size:0.8rem">Showing first 200 of ' + list.length + '. Use search to narrow down.</td></tr>';
  }
}

function inc_openCategoryModal(id) {
  const c = id ? inc_catData.find(x => x.id === id) : null;
  openModal(
    '<div class="modal-title">' + (c ? 'Edit Category' : 'Add Category') + '</div>' +
    '<div class="field"><label for="cat_name">Category name</label>' +
      '<input id="cat_name" maxlength="60" placeholder="e.g. Washing Machine" value="' + esc(c ? c.category : '') + '"></div>' +
    '<div class="field" style="margin-top:10px"><label for="cat_amount">Incentive amount per unit (&#8369;) &mdash; all branches</label>' +
      '<input id="cat_amount" type="number" min="0" step="0.01" placeholder="e.g. 50" value="' + (c ? c.amount : '') + '"></div>' +
    '<div class="field" style="margin-top:10px"><label for="cat_status">Status</label>' +
      '<select id="cat_status"><option value="Active"' + (c && String(c.status).toLowerCase()==='inactive' ? '' : ' selected') + '>Active</option>' +
      '<option value="Inactive"' + (c && String(c.status).toLowerCase()==='inactive' ? ' selected' : '') + '>Inactive (hidden from agents)</option></select></div>' +
    '<button class="btn btn-primary" style="width:100%;margin-top:14px" onclick="inc_saveCategory(' + (c ? '\'' + esc(c.id) + '\'' : 'null') + ')">Save</button>'
  );
}

async function inc_saveCategory(id) {
  const category = document.getElementById('cat_name')?.value.trim();
  const amount   = parseFloat(document.getElementById('cat_amount')?.value);
  const status   = document.getElementById('cat_status')?.value || 'Active';
  if (!category)                    { toast('Enter the category name.', 'error'); return; }
  if (!amount || amount <= 0)       { toast('Enter an amount greater than 0.', 'error'); return; }
  try {
    const res = await gasPost({ action: 'inc_saveCategory', id: id || '', category, amount, status });
    if (res.success) { toast('Category saved.', 'success'); closeModalDirect(); inc_loadCatalog(); }
    else toast(res.message || 'Error saving.', 'error');
  } catch(e) { toast('Network error.', 'error'); }
}

async function inc_deleteCategory(id) {
  const c = inc_catData.find(x => x.id === id);
  if (!confirm('Delete category "' + (c ? c.category : '') + '" and its product names? Existing claims are not affected.')) return;
  try {
    const res = await gasPost({ action: 'inc_deleteCategory', id });
    if (res.success) { toast('Category deleted.', 'success'); inc_loadCatalog(); }
    else toast(res.message || 'Error.', 'error');
  } catch(e) { toast('Network error.', 'error'); }
}

async function inc_deleteProductName(id) {
  try {
    const res = await gasPost({ action: 'inc_deleteProduct', id });
    if (res.success) { inc_prodData = inc_prodData.filter(p => p.id !== id); inc_renderProductList(); }
    else toast(res.message || 'Error.', 'error');
  } catch(e) { toast('Network error.', 'error'); }
}

function inc_downloadCatalogTemplate() {
  const csv = 'Product Name,Category,Amount\n' +
    'Washing Machine 7kg,Washing,50\n' +
    'Washing Machine 9kg,Washing,50\n' +
    'Refrigerator 2 Door,Refrigerator,100\n' +
    'Electric Fan Stand,Fan,20\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'AEHome_Incentive_Template.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Template downloaded!', 'success');
}

async function inc_handleCatalogUpload(input) {
  const file = input?.files?.[0];
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    input.value = '';
    if (!raw.length) { toast('No data found in file.', 'error'); return; }
    const rows = raw.map(function(r) {
      const keys = Object.keys(r);
      const get = names => { for (const n of names) { const k = keys.find(k2 => k2.trim().toLowerCase() === n); if (k !== undefined) return String(r[k] == null ? '' : r[k]).trim(); } return ''; };
      return {
        product:  get(['product name','product','name','item','item name','description']),
        category: get(['category','cat']),
        amount:   parseFloat(String(get(['amount','incentive','incentive amount','price'])).replace(/[^0-9.]/g, '')) || 0,
      };
    }).filter(r => r.category);
    if (!rows.length) { toast('No valid rows. File needs "Category" and "Amount" columns (and optional "Product Name").', 'error'); return; }
    inc_catImportRows = rows;
    inc_showCatalogPreview();
  } catch(e) { toast('File read error: ' + e.message, 'error'); }
}

function inc_showCatalogPreview() {
  const rows = inc_catImportRows;
  // work out the amount per category and flag conflicts / missing amounts
  const cats = {};
  rows.forEach(function(r) {
    const k = r.category.toLowerCase();
    if (!cats[k]) cats[k] = { name: r.category, amounts: {}, count: 0 };
    cats[k].count++;
    if (r.amount > 0) cats[k].amounts[r.amount] = true;
  });
  const existing = {};
  inc_catData.forEach(c => { existing[c.category.toLowerCase()] = c; });
  let warn = 0;
  const lines = Object.keys(cats).map(function(k) {
    const c = cats[k];
    const amts = Object.keys(c.amounts);
    const ex = existing[k];
    let note = '', amtTxt;
    if (amts.length === 0)      { amtTxt = ex ? '<span style="color:var(--text3)">keeps &#8369;' + ex.amount.toFixed(2) + '</span>' : '<span class="text-red">no amount</span>'; if (!ex) { warn++; note = 'Will be skipped (new category without amount)'; } }
    else if (amts.length > 1)   { amtTxt = '&#8369;' + parseFloat(amts[amts.length - 1]).toFixed(2); warn++; note = 'Different amounts in file (' + amts.map(a => '&#8369;' + a).join(', ') + '). The last one is used.'; }
    else                        { amtTxt = '&#8369;' + parseFloat(amts[0]).toFixed(2); }
    return '<tr><td><b>' + esc(c.name) + '</b></td><td>' + amtTxt + '</td><td style="text-align:center">' + c.count + '</td>' +
           '<td>' + (ex ? '<span class="badge-low">Update</span>' : '<span class="badge-in-stock">New</span>') + '</td>' +
           '<td style="font-size:0.75rem;color:var(--amber,#d97706)">' + note + '</td></tr>';
  }).join('');
  openModal(
    '<div class="modal-title">Review Upload</div>' +
    '<div style="font-size:0.82rem;color:var(--text2);margin-bottom:10px">' + rows.length + ' row(s), ' + Object.keys(cats).length + ' categor' + (Object.keys(cats).length === 1 ? 'y' : 'ies') +
      (warn ? ' &mdash; <b style="color:var(--amber,#d97706)">' + warn + ' warning(s)</b>' : '') + '</div>' +
    '<div class="tbl-wrap" style="max-height:300px;overflow:auto"><table><thead><tr><th>Category</th><th>Amount</th><th>Rows</th><th></th><th></th></tr></thead><tbody>' + lines + '</tbody></table></div>' +
    '<button class="btn btn-primary" id="inc_cat_confirm" style="width:100%;margin-top:14px" onclick="inc_confirmCatalogImport()">Confirm Upload</button>'
  );
}

async function inc_confirmCatalogImport() {
  const btn = document.getElementById('inc_cat_confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }
  try {
    const res = await gasPost({ action: 'inc_importCatalog', rows: JSON.stringify(inc_catImportRows) }, 90000);
    if (res.success) {
      toast('Done! ' + res.addedCategories + ' new, ' + res.updatedCategories + ' updated categories, ' + res.addedProducts + ' product name(s) added.', 'success');
      closeModalDirect(); inc_loadCatalog();
    } else {
      toast(res.message || 'Upload failed.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Confirm Upload'; }
    }
  } catch(e) {
    toast('Network error.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Confirm Upload'; }
  }
}

// ── MASTER LIST ───────────────────────────────────────────

// ── INCENTIVE MASTER LIST STATE ────────────────────────────
let inc_activeBranch = null; // null = All view


// ── MASTER LIST STATE ─────────────────────────────────────
async function inc_loadMasterList(branch) {
  if (branch !== undefined) inc_activeBranch = branch;
  if (inc_activeBranch === undefined) inc_activeBranch = null;
  const el = document.getElementById('incContent');
  if (!el) return;
  el.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
  try {
    const res = await gasRequest({ action:'inc_getMaster' });
    inc_masterCache = res.data || [];
    inc_renderMasterTable(inc_masterCache, el);
  } catch(e) {
    el.innerHTML = '<div class="no-data"><div class="no-data-text">Error loading. Check connection.</div></div>';
    toast('Error loading incentive list.', 'error');
  }
}

function inc_renderMasterTable(items, el) {
  const target  = el || document.getElementById('incContent');
  if (!target) return;
  const canEdit = currentUser.role === 'admin';
  const branch  = inc_activeBranch;

  // Tab styles
  const tabBase   = 'padding:6px 14px;border-radius:20px;border:1.5px solid var(--border);background:white;color:var(--text2);font-size:0.78rem;font-weight:600;font-family:var(--font-main);cursor:pointer;white-space:nowrap';
  const tabActive = 'padding:6px 14px;border-radius:20px;border:1.5px solid var(--blue,#1e90ff);background:var(--blue,#1e90ff);color:white;font-size:0.78rem;font-weight:600;font-family:var(--font-main);cursor:pointer;white-space:nowrap';

  const tabsHtml =
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">' +
      '<button style="' + (!branch ? tabActive : tabBase) + '" onclick="inc_switchBranchTab(null)">All Branches</button>' +
      INC_BRANCHES.map(function(b, i) {
        return '<button style="' + (branch===b ? tabActive : tabBase) + '" ' +
          'onclick="inc_switchBranchTab(\'' + b + '\')">' + INC_BRANCHES_DISP[i] + '</button>';
      }).join('') +
    '</div>';

  const toolbar =
    '<div style="display:flex;gap:10px;margin-bottom:12px;flex-wrap:wrap;align-items:center">' +
      (canEdit ? '<button class="btn btn-primary" onclick="inc_triggerExcelUpload()">Upload Excel/CSV</button>' : '') +
      (canEdit ? '<button class="btn btn-ghost" onclick="inc_downloadTemplate()">Download Template</button>' : '') +
      '<input type="file" id="inc_excel_input" accept=".xlsx,.xls,.csv" style="display:none" onchange="inc_handleExcelUpload(this)">' +
      '<div class="search-wrap" style="margin-bottom:0">' +
        '<span class="search-icon">&#128269;</span>' +
        '<input type="text" id="incMasterSearch" placeholder="Search item or barcode..." ' +
          'oninput="inc_filterMaster(this.value)" ' +
          'style="padding:8px 12px 8px 32px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font-main)">' +
      '</div>' +
      (canEdit && branch ?
        '<span style="font-size:0.78rem;color:var(--text3)">Viewing: <b>' + (INC_BRANCHES_DISP[INC_BRANCHES.indexOf(branch)] || branch) + '</b> — amounts set via Excel upload</span>' : '') +
    '</div>';

  // ALL BRANCHES view
  let thead, rows;
  if (!branch) {
    const branchHeaders = INC_BRANCHES_DISP.map(function(d) { return '<th style="min-width:70px;text-align:center">' + d + '</th>'; }).join('');
    thead = '<thead><tr>' +
      '<th>Barcode</th><th>Description</th><th>Category</th>' +
      branchHeaders +
      '<th>Status</th>' + (canEdit ? '<th></th>' : '') +
    '</tr></thead>';

    rows = items.map(function(m) {
      const branchCells = INC_BRANCHES.map(function(b) {
        const amt = (m[b] !== undefined && m[b] !== '' && m[b] !== null) ? parseFloat(m[b]) : null;
        return '<td style="text-align:center;font-size:0.82rem">' +
          (amt !== null && !isNaN(amt)
            ? '<b style="color:var(--green)">&#8369;' + amt.toFixed(0) + '</b>'
            : '<span style="color:#ddd">&#8212;</span>') +
        '</td>';
      }).join('');
      return '<tr>' +
        '<td style="font-family:var(--font-mono);font-size:0.78rem">' + esc(m.barcode || '—') + '</td>' +
        '<td><b>' + esc(m.description) + '</b></td>' +
        '<td style="font-size:0.8rem;color:var(--text3)">' + esc(m.category || '—') + '</td>' +
        branchCells +
        '<td>' + inc_statusBadge(m.status) + '</td>' +
        (canEdit ?
          '<td><div style="display:flex;gap:5px">' +
            '<button class="inv-btn inv-btn-edit" onclick="inc_openItemModal(\'' + esc(m.id) + '\')">Edit</button>' +
            '<button class="inv-btn inv-btn-del"  onclick="inc_deleteMasterItem(\'' + esc(m.id) + '\')">Del</button>' +
          '</div></td>' : '') +
      '</tr>';
    }).join('') || '<tr><td colspan="' + (4 + INC_BRANCHES.length + (canEdit?1:0)) + '" style="padding:24px;text-align:center;color:var(--text3)">No items yet. Upload an Excel file to add products.</td></tr>';

  } else {
    // SINGLE BRANCH — read-only amounts (set via upload only)
    const branchDisp = INC_BRANCHES_DISP[INC_BRANCHES.indexOf(branch)] || branch;
    thead = '<thead><tr>' +
      '<th>Barcode</th><th>Description</th><th>Category</th>' +
      '<th style="color:var(--accent)">Incentive (' + branchDisp + ')</th>' +
      '<th>Status</th>' +
    '</tr></thead>';

    rows = items.map(function(m) {
      const amt    = (m[branch] !== undefined && m[branch] !== '' && m[branch] !== null) ? parseFloat(m[branch]) : null;
      const amtD   = (amt !== null && !isNaN(amt) && amt > 0)
        ? '<b style="color:var(--green);font-size:1rem">&#8369;' + amt.toFixed(2) + '</b>'
        : '<span style="color:var(--text4)">Not set</span>';
      return '<tr>' +
        '<td style="font-family:var(--font-mono);font-size:0.78rem">' + esc(m.barcode || '—') + '</td>' +
        '<td><b>' + esc(m.description) + '</b></td>' +
        '<td style="font-size:0.8rem;color:var(--text3)">' + esc(m.category || '—') + '</td>' +
        '<td>' + amtD + '</td>' +
        '<td>' + inc_statusBadge(m.status) + '</td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--text3)">No items. Upload an Excel file to add products.</td></tr>';
  }

  target.innerHTML = tabsHtml + toolbar +
    '<div class="card"><div class="tbl-wrap" style="max-height:60vh;overflow-y:auto"><table>' +
      thead + '<tbody>' + rows + '</tbody>' +
    '</table></div></div>';
}

function inc_switchBranchTab(branch) {
  inc_activeBranch = branch;
  inc_renderMasterTable(inc_masterCache);
}

function inc_filterMaster(q) {
  const term     = (q || '').toLowerCase().trim();
  const filtered = term
    ? inc_masterCache.filter(function(m) {
        return (m.barcode      || '').toLowerCase().includes(term) ||
               (m.description  || '').toLowerCase().includes(term) ||
               (m.category     || '').toLowerCase().includes(term);
      })
    : inc_masterCache;
  const el = document.getElementById('incContent');
  if (!el) return;
  const tbody = el.querySelector('tbody');
  if (!tbody) { inc_renderMasterTable(filtered); return; }
  const canEdit = currentUser.role === 'admin';
  const branch  = inc_activeBranch;
  if (!branch) {
    tbody.innerHTML = filtered.map(function(m) {
      const branchCells = INC_BRANCHES.map(function(b) {
        const amt = (m[b] !== undefined && m[b] !== '' && m[b] !== null) ? parseFloat(m[b]) : null;
        return '<td style="text-align:center;font-size:0.82rem">' +
          (amt !== null && !isNaN(amt)
            ? '<b style="color:var(--green)">&#8369;' + amt.toFixed(0) + '</b>'
            : '<span style="color:#ddd">&#8212;</span>') +
        '</td>';
      }).join('');
      return '<tr>' +
        '<td style="font-family:var(--font-mono);font-size:0.78rem">' + esc(m.barcode||'—') + '</td>' +
        '<td><b>' + esc(m.description) + '</b></td>' +
        '<td style="font-size:0.8rem;color:var(--text3)">' + esc(m.category||'—') + '</td>' +
        branchCells +
        '<td>' + inc_statusBadge(m.status) + '</td>' +
        (canEdit ? '<td><div style="display:flex;gap:5px">' +
          '<button class="inv-btn inv-btn-edit" onclick="inc_openItemModal(\'' + esc(m.id) + '\')">Edit</button>' +
          '<button class="inv-btn inv-btn-del"  onclick="inc_deleteMasterItem(\'' + esc(m.id) + '\')">Del</button>' +
        '</div></td>' : '') +
      '</tr>';
    }).join('') || '<tr><td colspan="' + (4+INC_BRANCHES.length+(canEdit?1:0)) + '" style="padding:24px;text-align:center;color:var(--text3)">No matching items.</td></tr>';
  } else {
    tbody.innerHTML = filtered.map(function(m) {
      const amt  = (m[branch] !== undefined && m[branch] !== '' && m[branch] !== null) ? parseFloat(m[branch]) : null;
      const amtD = (amt !== null && !isNaN(amt))
        ? '<b style="color:var(--green)">&#8369;' + amt.toFixed(2) + '</b>'
        : '<span style="color:var(--text4)">Not set</span>';
      return '<tr>' +
        '<td style="font-family:var(--font-mono);font-size:0.78rem">' + esc(m.barcode||'—') + '</td>' +
        '<td><b>' + esc(m.description) + '</b></td>' +
        '<td style="font-size:0.8rem;color:var(--text3)">' + esc(m.category||'—') + '</td>' +
        '<td>' + amtD + '</td>' +
        '<td>' + inc_statusBadge(m.status) + '</td>' +
      '</tr>';
    }).join('') || '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--text3)">No matching items.</td></tr>';
  }
}

function inc_openItemModal(id) {
  // Edit info only (barcode, description, category, status)
  // Incentive amounts are managed via Excel upload
  const m = id ? inc_masterCache.find(function(x){ return x.id === id; }) : null;
  if (!m) return;
  const html =
    '<div class="modal-title">Edit Item</div>' +
    '<div class="input-row">' +
      '<div class="field" style="grid-column:1/-1"><label for="ii_desc">Product Description *</label>' +
        '<input id="ii_desc" name="ii_desc" value="' + esc(m.description) + '" placeholder="e.g. Washing Machine XL"></div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field"><label for="ii_barcode">Barcode</label>' +
        '<input id="ii_barcode" name="ii_barcode" value="' + esc(m.barcode||'') + '" placeholder="e.g. 100001"></div>' +
      '<div class="field"><label for="ii_cat">Category</label>' +
        '<input id="ii_cat" name="ii_cat" value="' + esc(m.category||'') + '" placeholder="e.g. Appliances"></div>' +
    '</div>' +
    '<div class="input-row">' +
      '<div class="field"><label for="ii_status">Status</label>' +
        '<select id="ii_status" name="ii_status">' +
          '<option value="Active"' + (m.status==='Active' ? ' selected' : '') + '>Active</option>' +
          '<option value="Inactive"' + (m.status==='Inactive' ? ' selected' : '') + '>Inactive</option>' +
        '</select></div>' +
    '</div>' +
    '<p style="font-size:0.78rem;color:var(--text3);margin-top:4px;padding:8px;background:#f9fafb;border-radius:6px">' +
      'Incentive amounts are set via Excel upload. Use the Upload Excel/CSV button to set or update amounts per branch.' +
    '</p>' +
    '<button class="btn btn-primary" style="width:100%;margin-top:10px" ' +
      'onclick="inc_saveItemModal(\'' + id + '\')">Update Item</button>';
  openModal(html);
}

async function inc_saveItemModal(id) {
  if (!id) return;
  const desc = document.getElementById('ii_desc')?.value.trim();
  if (!desc) { toast('Product description is required.', 'error'); return; }
  // Preserve ALL existing branch amounts
  const m = inc_masterCache.find(function(x){ return x.id === id; });
  const payload = {
    action:      'inc_saveMasterItem',
    id:          id,
    barcode:     document.getElementById('ii_barcode')?.value.trim() || '',
    category:    document.getElementById('ii_cat')?.value.trim() || '',
    description: desc,
    status:      document.getElementById('ii_status')?.value || 'Active',
    updatedBy:   currentUser.name || currentUser.username,
  };
  // Always preserve branch amounts — never blank them out on edit
  INC_BRANCHES.forEach(function(b) {
    payload['branch_' + b] = (m && m[b] !== undefined && m[b] !== '') ? m[b] : '';
  });
  const btn = document.querySelector('#modalBox .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Updating...'; }
  try {
    const res = await gasPost(payload);
    if (res.success) {
      toast('Item updated.', 'success');
      closeModalDirect();
      await inc_loadMasterList();
    } else {
      toast(res.message || 'Error saving.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Update Item'; }
    }
  } catch(e) {
    toast('Network error.', 'error');
    if (btn) btn.disabled = false;
  }
}

async function inc_deleteMasterItem(id) {
  if (!confirm('Delete this item? This cannot be undone.')) return;
  try {
    const res = await gasPost({ action:'inc_deleteMasterItem', id:id, caller_role: currentUser.role });
    if (res.success) { toast('Item deleted.', 'success'); await inc_loadMasterList(); }
    else toast(res.message || 'Error deleting.', 'error');
  } catch(e) { toast('Network error.', 'error'); }
}


// ── EXCEL UPLOAD STATE ────────────────────────────────────
let inc_importRows   = [];
let inc_importCombos = [];

function inc_downloadTemplate() {
  // Build CSV template with required columns
  const header = 'Barcode,Name,Category';
  const sample = [
    '100001,Washing Machine XL,Appliances',
    '100002,Refrigerator 2 Door,Appliances',
    '100003,Aircon Split Type 1HP,Aircon',
    '100004,Electric Fan Stand,Appliances',
    '100005,Rice Cooker 1.8L,Appliances',
  ].join('\n');
  const csv  = header + '\n' + sample;
  const blob = new Blob([csv], { type:'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'AEHome_IncentiveItems_Template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Template downloaded!', 'success');
}

function inc_triggerExcelUpload() {
  const inp = document.getElementById('inc_excel_input');
  if (inp) { inp.value = ''; inp.click(); }
}

async function inc_handleExcelUpload(input) {
  const file = input?.files?.[0];
  if (!file) return;
  toast('Reading file...', 'info');
  try {

    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type:'array' });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, { defval:'' });
    if (!raw.length) { toast('No data found in file.', 'error'); return; }

    const normalized = raw.map(function(r) {
      const keys = Object.keys(r);
      function get(names) {
        for (const n of names) {
          const k = keys.find(function(k2){ return k2.trim().toLowerCase() === n.toLowerCase(); });
          if (k !== undefined) return String(r[k]||'').trim();
        }
        return '';
      }
      return {
        barcode:  get(['barcode','Barcode','BARCODE','bar code','bar_code']),
        name:     get(['name','Name','NAME','product name','Product Name','PRODUCT NAME','description','Description']),
        category: get(['category','Category','CATEGORY','cat','Cat']),
      };
    }).filter(function(r){ return r.name; });

    if (!normalized.length) {
      toast('No valid rows. File needs "Barcode" and "Name" or "Product Name" columns.', 'error');
      return;
    }
    inc_importRows   = normalized;
    inc_importCombos = [{ branch:'', category:'', amount:'' }];
    // Ensure master cache is loaded for duplicate detection
    if (!inc_masterCache.length) {
      try {
        const mr = await gasRequest({ action:'inc_getMaster' });
        inc_masterCache = mr.data || [];
      } catch(e) { inc_masterCache = []; }
    }
    inc_showImportPreview();
  } catch(e) {
    toast('File read error: ' + e.message, 'error');
  }
}

function inc_showImportPreview() {
  const rows     = inc_importRows;
  const existing = inc_masterCache;
  const tagged   = rows.map(function(r) {
    const isDup = existing.some(function(e) {
      return (r.barcode && e.barcode === r.barcode) ||
             e.description.toLowerCase() === r.name.toLowerCase();
    });
    return Object.assign({}, r, { dup: isDup });
  });
  const newCount = tagged.filter(function(r){ return !r.dup; }).length;
  const dupCount = tagged.filter(function(r){ return r.dup;  }).length;

  function buildCombos() {
    return inc_importCombos.map(function(c, ci) {
      const branchOpts = '<option value="">-- Branch --</option>' +
        INC_BRANCHES.map(function(b,i){
          return '<option value="' + b + '"' + (c.branch===b?' selected':'') + '>' + INC_BRANCHES_DISP[i] + '</option>';
        }).join('');
      return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">' +
        '<select onchange="inc_updateCombo(' + ci + ',\'branch\',this.value)" ' +
          'style="padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-family:var(--font-main);font-size:0.83rem;min-width:130px">' +
          branchOpts + '</select>' +
        '<input type="text" placeholder="Category (e.g. Aircon)" value="' + (c.category||'') + '" ' +
          'oninput="inc_updateCombo(' + ci + ',\'category\',this.value)" ' +
          'style="padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-family:var(--font-main);font-size:0.83rem;flex:1;min-width:120px">' +
        '<div style="display:flex;align-items:center;gap:4px">' +
          '<span style="font-weight:700">&#8369;</span>' +
          '<input type="number" min="0" placeholder="Amount" value="' + (c.amount||'') + '" ' +
            'oninput="inc_updateCombo(' + ci + ',\'amount\',this.value)" ' +
            'style="padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-family:var(--font-main);font-size:0.83rem;width:100px">' +
        '</div>' +
        (inc_importCombos.length > 1
          ? '<button onclick="inc_removeCombo(' + ci + ')" style="background:none;border:none;color:var(--red,#ef4444);font-size:1.1rem;cursor:pointer;padding:0 4px">&#10005;</button>'
          : '') +
      '</div>';
    }).join('');
  }

  const previewRows = tagged.map(function(r, i) {
    return '<tr style="' + (r.dup ? 'opacity:0.45' : '') + '">' +
      '<td style="padding:8px 12px;font-family:var(--font-mono);font-size:0.78rem">' + esc(r.barcode||'—') + '</td>' +
      '<td style="padding:8px 12px;font-size:0.85rem"><b>' + esc(r.name) + '</b></td>' +
      '<td style="padding:8px 12px;font-size:0.8rem;color:var(--text3)">' + esc(r.category||'—') + '</td>' +
      '<td style="padding:8px 12px;text-align:center">' +
        (r.dup
          ? '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700">DUPLICATE</span>'
          : '<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:700">NEW</span>') +
      '</td>' +
      '<td style="padding:8px 12px;text-align:center">' +
        (!r.dup ? '<button onclick="inc_removeImportRow(' + i + ')" title="Remove" ' +
          'style="background:none;border:none;color:var(--red,#ef4444);font-size:1rem;cursor:pointer">&#10005;</button>' : '') +
      '</td>' +
    '</tr>';
  }).join('');

  const html =
    '<div class="modal-title">Import Incentive Items</div>' +
    '<div style="display:flex;gap:10px;margin-bottom:14px">' +
      '<div style="flex:1;background:#d1fae5;border-radius:8px;padding:10px 14px;text-align:center">' +
        '<div style="font-size:1.4rem;font-weight:700;color:#065f46">' + newCount + '</div>' +
        '<div style="font-size:0.73rem;color:#065f46">New Items</div>' +
      '</div>' +
      '<div style="flex:1;background:#fee2e2;border-radius:8px;padding:10px 14px;text-align:center">' +
        '<div style="font-size:1.4rem;font-weight:700;color:#991b1b">' + dupCount + '</div>' +
        '<div style="font-size:0.73rem;color:#991b1b">Duplicates (skipped)</div>' +
      '</div>' +
    '</div>' +
    '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px;margin-bottom:14px">' +
      '<div style="font-size:0.82rem;font-weight:700;color:var(--text2);margin-bottom:6px">Set Incentive Amounts ' +
        '<span style="font-weight:400;color:var(--text3);font-size:0.78rem">(optional — can re-upload to update)</span></div>' +
      '<div style="font-size:0.75rem;color:var(--text3);margin-bottom:10px">Select Branch + type Category keyword + enter Amount. Applies to all matching items.</div>' +
      '<div id="inc_combos_wrap">' + buildCombos() + '</div>' +
      '<button onclick="inc_addCombo()" ' +
        'style="background:none;border:1.5px dashed var(--border);border-radius:7px;padding:6px 14px;font-size:0.8rem;color:var(--text3);cursor:pointer;font-family:var(--font-main);margin-top:6px;width:100%">' +
        '+ Add Another Branch / Category' +
      '</button>' +
    '</div>' +
    '<div style="font-size:0.82rem;font-weight:700;margin-bottom:8px">Preview (' + rows.length + ' items)</div>' +
    '<div style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:8px">' +
      '<table style="width:100%;border-collapse:collapse">' +
        '<thead><tr style="background:#f9fafb;border-bottom:1px solid var(--border)">' +
          '<th style="padding:8px 12px;font-size:0.73rem;color:var(--text3);text-align:left">Barcode</th>' +
          '<th style="padding:8px 12px;font-size:0.73rem;color:var(--text3);text-align:left">Name</th>' +
          '<th style="padding:8px 12px;font-size:0.73rem;color:var(--text3);text-align:left">Category</th>' +
          '<th style="padding:8px 12px;font-size:0.73rem;color:var(--text3);text-align:center">Status</th>' +
          '<th style="padding:8px 12px;font-size:0.73rem;color:var(--text3);text-align:center">Remove</th>' +
        '</tr></thead>' +
        '<tbody>' + previewRows + '</tbody>' +
      '</table>' +
    '</div>' +
    '<div style="display:flex;gap:10px;margin-top:14px">' +
      '<button class="btn btn-ghost" style="flex:1" onclick="closeModalDirect()">Cancel</button>' +
      '<button class="btn btn-primary" style="flex:2" onclick="inc_confirmImport()">' +
      (newCount > 0 ? 'Import ' + newCount + ' Items' : 'Apply Incentive Amounts') + '</button>' +
    '</div>';

  openModal(html);
}

function inc_updateCombo(idx, field, value) {
  if (inc_importCombos[idx]) inc_importCombos[idx][field] = value;
}

function inc_addCombo() {
  inc_importCombos.push({ branch:'', category:'', amount:'' });
  inc_refreshCombos();
}

function inc_removeCombo(idx) {
  inc_importCombos.splice(idx, 1);
  inc_refreshCombos();
}

function inc_refreshCombos() {
  const wrap = document.getElementById('inc_combos_wrap');
  if (!wrap) return;
  wrap.innerHTML = inc_importCombos.map(function(c, ci) {
    const branchOpts = '<option value="">-- Branch --</option>' +
      INC_BRANCHES.map(function(b,i){
        return '<option value="' + b + '"' + (c.branch===b?' selected':'') + '>' + INC_BRANCHES_DISP[i] + '</option>';
      }).join('');
    return '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">' +
      '<select onchange="inc_updateCombo(' + ci + ',\'branch\',this.value)" ' +
        'style="padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-family:var(--font-main);font-size:0.83rem;min-width:130px">' +
        branchOpts + '</select>' +
      '<input type="text" placeholder="Category (e.g. Aircon)" value="' + (c.category||'') + '" ' +
        'oninput="inc_updateCombo(' + ci + ',\'category\',this.value)" ' +
        'style="padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-family:var(--font-main);font-size:0.83rem;flex:1;min-width:120px">' +
      '<div style="display:flex;align-items:center;gap:4px">' +
        '<span style="font-weight:700">&#8369;</span>' +
        '<input type="number" min="0" placeholder="Amount" value="' + (c.amount||'') + '" ' +
          'oninput="inc_updateCombo(' + ci + ',\'amount\',this.value)" ' +
          'style="padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-family:var(--font-main);font-size:0.83rem;width:100px">' +
      '</div>' +
      (inc_importCombos.length > 1
        ? '<button onclick="inc_removeCombo(' + ci + ')" style="background:none;border:none;color:var(--red,#ef4444);font-size:1.1rem;cursor:pointer;padding:0 4px">&#10005;</button>'
        : '') +
    '</div>';
  }).join('');
}

function inc_removeImportRow(idx) {
  inc_importRows.splice(idx, 1);
  inc_showImportPreview();
}

async function inc_confirmImport() {
  const allRows     = inc_importRows;
  const validCombos = inc_importCombos.filter(function(c){ return c.branch && c.amount; });

  const newRows = allRows.filter(function(r) {
    return !inc_masterCache.some(function(e) {
      return (r.barcode && e.barcode === r.barcode) ||
             e.description.toLowerCase() === r.name.toLowerCase();
    });
  });

  // Nothing to do at all
  if (!newRows.length && !validCombos.length) {
    toast('No new items and no incentive amounts to set.', 'warning');
    return;
  }

  const btn = document.querySelector('#modalBox .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

  try {
    // Always send ALL rows (inc. duplicates) + combos so GAS can apply amounts to existing items
    const res = await gasPost({
      action:    'inc_bulkImportMaster',
      rows:      JSON.stringify(allRows),
      combos:    JSON.stringify(validCombos),
      updatedBy: currentUser.name || currentUser.username,
    });
    if (res.success) {
      closeModalDirect();
      let msg = '';
      if (res.added)       msg += 'Added ' + res.added + ' new item(s). ';
      if (res.amountsSet)  msg += 'Incentive amounts set for ' + res.amountsSet + ' item(s).';
      if (!msg)            msg  = 'Done — no changes needed.';
      toast(msg, 'success');
      await inc_loadMasterList();
    } else {
      toast(res.message || 'Import failed.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Confirm'; }
    }
  } catch(e) {
    toast('Network error: ' + e.message, 'error');
    if (btn) btn.disabled = false;
  }
}



// ══════════════════════════════════════════════════════════
// AGENT / CASHIER VIEW — Submit Claims
// ══════════════════════════════════════════════════════════
async function inc_renderAgentPage() {
  const pc = document.getElementById('pageContent');
  if (!pc) return;
  // Reload cache only if empty or older than 5 minutes
  const now5 = Date.now();
  if (!inc_masterCache.length || !window._incCacheTime || (now5 - window._incCacheTime) > 300000) {
    try {
      const mr = await gasRequest({ action:'inc_getMaster' });
      inc_masterCache      = mr.data || [];
      window._incCacheTime = Date.now();
    } catch(e) { inc_masterCache = inc_masterCache.length ? inc_masterCache : []; }
  }

  const today = localDateStr(new Date());
  pc.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">' +
      '<div style="font-size:0.9rem;color:var(--text2)">Your Incentive Claims &mdash; ' + safeFormatDateOnly(today) + '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-ghost btn-sm" onclick="inc_renderAgentPage()" title="Refresh">&#8635; Refresh</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="inc_photoGallery()">&#128247; Receipt Photos</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="inc_proofGallery()">&#128247; Proof of Sale</button>' +
        '<button class="btn btn-primary" onclick="inc_openClaimModal()">+ Add Incentive Claim</button>' +
      '</div>' +
    '</div>' +
    '<div id="incAgentContent"><div class="loading-spinner"><div class="spinner"></div></div></div>';

  await inc_loadAgentClaims(today);
}

async function inc_loadAgentClaims(date) {
  const el = document.getElementById('incAgentContent');
  if (!el) return;
  try {
    const res    = await gasRequest({ action:'inc_getClaims', employeeId: currentUser.id || currentUser.username, date:date });
    const claims = res.data || [];
    const total  = claims.filter(inc_isLive).reduce((s,c) => s + parseFloat(c.totalIncentive||0), 0);

    let photoHave = new Set();
    try { photoHave = await inc_photoHave(); } catch(pe) {}
    const rows = claims.slice().reverse().map(c =>
      '<tr>' +
        '<td style="font-family:var(--font-mono);font-size:0.78rem">' + esc(c.invoiceNo) + '</td>' +
        '<td><b>' + esc(c.description) + '</b>' + (c.category ? '<div style="font-size:0.72rem;color:var(--text3)">' + esc(c.category) + '</div>' : '') + '</td>' +
        '<td style="text-align:center">' + (c.qty||1) + '</td>' +
        '<td>&#8369;' + parseFloat(c.incentivePerUnit||0).toFixed(2) + '</td>' +
        '<td class="fw-700 text-green">&#8369;' + parseFloat(c.totalIncentive||0).toFixed(2) + '</td>' +
        '<td>' + inc_statusBadge(c.status) + '</td>' +
        '<td style="font-size:0.75rem;color:var(--text3)">' + safeFormatDateTime(c.claimDate) + '</td>' +
        '<td><button class="btn btn-ghost btn-sm" onclick="inc_photoRowClick(\'' + String(c.invoiceNo || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;') + '\')">' +
          (photoHave.has(String(c.invoiceNo || '').trim().toUpperCase()) ? '&#128247; View' : '+ Photo') + '</button></td>' +
      '</tr>'
    ).join('') || '<tr><td colspan="8"><div class="no-data"><div class="no-data-text">No claims yet today. Click <b>Add Incentive Claim</b> to start.</div></div></td></tr>';

    el.innerHTML =
      '<div style="background:linear-gradient(135deg,var(--blue,#1e90ff),#0056d2);border-radius:12px;padding:18px 22px;color:white;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">' +
        '<div><div style="font-size:0.75rem;opacity:.7">TODAY\'S INCENTIVE</div><div style="font-size:2rem;font-weight:700;font-family:var(--font-mono)">&#8369;' + total.toFixed(2) + '</div><div style="font-size:0.78rem;opacity:.6">' + claims.length + ' claim(s)</div></div>' +
      '</div>' +
      '<div class="card"><div class="tbl-wrap"><table>' +
        '<thead><tr><th>OR No.</th><th>Item</th><th>Qty</th><th>&#8369;/Unit</th><th>Total</th><th>Status</th><th>Time</th><th>Receipt</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table></div></div>';
  } catch(e) {
    toast('Error loading your claims.','error');
  }
}

// ── CLAIM MODAL (one OR number -> many items, amount by category) ─────
// ── LOCAL RECEIPT PHOTOS (agent) ─────────────────────────────
// A personal backup of the OR receipt. The agent can snap/upload a photo FIRST (no OR
// number needed) and fill in the claim later while looking at the photo. Photos are kept
// ONLY in this browser/phone (IndexedDB) - nothing goes to the server or Google Sheets.
// Each photo belongs to the logged-in user; once a claim is submitted it is linked to that OR.
const INC_PHOTO_DB    = 'ae_pos_local';
const INC_PHOTO_STORE = 'receipt_photos';
let inc_photoCtx = '';   // OR number when the gallery was opened from a claim row ("+ Photo")

function inc_photoDb() {
  return new Promise(function(resolve, reject) {
    if (!window.indexedDB) { reject(new Error('This browser cannot store photos.')); return; }
    const rq = indexedDB.open(INC_PHOTO_DB, 2);
    rq.onupgradeneeded = function() {
      const db = rq.result, tx = rq.transaction;
      if (!db.objectStoreNames.contains(INC_PHOTO_STORE)) db.createObjectStore(INC_PHOTO_STORE, { keyPath: 'id' });
      // carry over photos saved by the first version (keyed by user|OR)
      if (db.objectStoreNames.contains('or_photos')) {
        const oc = tx.objectStore('or_photos').openCursor();
        oc.onsuccess = function() {
          const cur = oc.result; if (!cur) return;
          const k = String(cur.key), i = k.indexOf('|');
          tx.objectStore(INC_PHOTO_STORE).put({
            id: 'm' + (cur.value.ts || Date.now()).toString(36) + Math.random().toString(36).slice(2, 6),
            user: k.slice(0, i), inv: k.slice(i + 1), data: cur.value.data, ts: cur.value.ts || Date.now()
          });
          cur.continue();
        };
      }
    };
    rq.onsuccess = function() { resolve(rq.result); };
    rq.onerror   = function() { reject(rq.error || new Error('Storage error.')); };
  });
}
function inc_photoUser() { return String((currentUser && (currentUser.id || currentUser.username)) || ''); }
function inc_photoNormInv(inv) { return String(inv || '').trim().toUpperCase(); }

async function inc_photoAdd(dataUrl, inv) {
  const db = await inc_photoDb();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch(e) {}
  const rec = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                user: inc_photoUser(), inv: inc_photoNormInv(inv), data: dataUrl, ts: Date.now() };
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(INC_PHOTO_STORE, 'readwrite');
    tx.objectStore(INC_PHOTO_STORE).put(rec);
    tx.oncomplete = function() { resolve(rec.id); };
    tx.onerror    = function() { reject(tx.error || new Error('Could not save photo.')); };
  });
}
// all photos of the current user, newest first
async function inc_photoList() {
  const db = await inc_photoDb();
  const me = inc_photoUser();
  return new Promise(function(resolve, reject) {
    const rq = db.transaction(INC_PHOTO_STORE, 'readonly').objectStore(INC_PHOTO_STORE).getAll();
    rq.onsuccess = function() {
      resolve((rq.result || []).filter(function(r) { return r.user === me; }).sort(function(a, b) { return b.ts - a.ts; }));
    };
    rq.onerror = function() { reject(rq.error); };
  });
}
// Set of OR numbers (upper-cased) that already have a photo, for the Receipt column
async function inc_photoHave() {
  const set = new Set();
  (await inc_photoList()).forEach(function(r) { if (r.inv) set.add(r.inv); });
  return set;
}
async function inc_photoById(id) {
  const db = await inc_photoDb();
  return new Promise(function(resolve, reject) {
    const rq = db.transaction(INC_PHOTO_STORE, 'readonly').objectStore(INC_PHOTO_STORE).get(id);
    rq.onsuccess = function() { const r = rq.result; resolve(r && r.user === inc_photoUser() ? r : null); };
    rq.onerror   = function() { reject(rq.error); };
  });
}
async function inc_photoLink(id, inv) {
  const rec = await inc_photoById(id);
  if (!rec) throw new Error('Photo not found on this device.');
  rec.inv = inc_photoNormInv(inv);
  const db = await inc_photoDb();
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(INC_PHOTO_STORE, 'readwrite');
    tx.objectStore(INC_PHOTO_STORE).put(rec);
    tx.oncomplete = function() { resolve(true); };
    tx.onerror    = function() { reject(tx.error); };
  });
}
async function inc_photoRemove(id) {
  const rec = await inc_photoById(id);
  if (!rec) return true;
  const db = await inc_photoDb();
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(INC_PHOTO_STORE, 'readwrite');
    tx.objectStore(INC_PHOTO_STORE).delete(id);
    tx.oncomplete = function() { resolve(true); };
    tx.onerror    = function() { reject(tx.error); };
  });
}

// Shrink the photo (phone cameras make 3-8 MB files) to ~150-300 KB, still readable
function inc_photoCompress(file) {
  return new Promise(function(resolve, reject) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function() {
      const MAX = 1400;
      const sc  = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image.')); };
    img.src = url;
  });
}

// Full-screen viewer that does NOT replace the open form, so an agent can read the
// receipt photo while typing the OR number / items in the claim form.
function inc_photoShow(data, caption) {
  const old = document.getElementById('incLightbox');
  if (old) old.remove();
  const d = document.createElement('div');
  d.id = 'incLightbox';
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:12px;cursor:pointer';
  d.innerHTML =
    '<div style="color:#fff;font-size:0.85rem;margin-bottom:8px">' + esc(caption || '') + ' &mdash; tap anywhere to close</div>' +
    '<img src="' + data + '" style="max-width:100%;max-height:88vh;object-fit:contain;border-radius:8px;background:#fff">';
  d.onclick = function() { d.remove(); };
  document.body.appendChild(d);
}
async function inc_photoView(id) {
  try {
    const rec = await inc_photoById(id);
    if (rec) inc_photoShow(rec.data, rec.inv ? 'OR ' + rec.inv : safeFormatDateTime(new Date(rec.ts).toISOString()));
  } catch(e) { toast('Could not open photo.', 'error'); }
}
async function inc_photoDownload(id) {
  try {
    const rec = await inc_photoById(id);
    if (!rec) return;
    const a = document.createElement('a');
    a.href = rec.data;
    a.download = 'receipt_' + (rec.inv || localDateStr(new Date(rec.ts))) + '_' + rec.id + '.jpg';
    document.body.appendChild(a); a.click(); a.remove();
  } catch(e) { toast('Could not download photo.', 'error'); }
}

// ── "My Receipt Photos" gallery (take a photo any time, no OR needed) ──
async function inc_photoGallery(attachInv) {
  inc_photoCtx = attachInv ? inc_photoNormInv(attachInv) : '';
  let list = [], err = '';
  try { list = await inc_photoList(); } catch(e) { err = e.message || 'Storage error.'; }
  const cards = list.slice(0, 40).map(function(r) {
    const linked = !!r.inv;
    return '<div style="width:150px;border:1.5px solid var(--border);border-radius:10px;padding:8px;background:#fff">' +
      '<img src="' + r.data + '" style="width:100%;height:110px;object-fit:cover;border-radius:6px;cursor:pointer" onclick="inc_photoView(\'' + r.id + '\')">' +
      '<div style="font-size:0.7rem;color:var(--text3);margin:5px 0 2px">' + safeFormatDateTime(new Date(r.ts).toISOString()) + '</div>' +
      '<div style="font-size:0.74rem;font-weight:700;margin-bottom:6px;color:' + (linked ? 'var(--green)' : 'var(--amber,#d97706)') + '">' + (linked ? 'OR ' + esc(r.inv) : 'Not yet claimed') + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
        (!linked && inc_photoCtx ? '<button class="btn btn-primary btn-sm" onclick="inc_photoAttach(\'' + r.id + '\')">Attach to OR ' + esc(inc_photoCtx) + '</button>' : '') +
        (!linked && !inc_photoCtx ? '<button class="btn btn-primary btn-sm" onclick="inc_photoUseForClaim(\'' + r.id + '\')">Use for Claim</button>' : '') +
        '<button class="btn btn-ghost btn-sm" onclick="inc_photoDownload(\'' + r.id + '\')">Download</button>' +
        '<button class="btn btn-danger btn-sm" onclick="inc_photoDeleteConfirm(\'' + r.id + '\')">Delete</button>' +
      '</div></div>';
  }).join('');
  openModal(
    '<div class="modal-title">' + (inc_photoCtx ? 'Receipt Photo &mdash; OR ' + esc(inc_photoCtx) : 'My Receipt Photos') + '</div>' +
    (err ? '<div style="color:var(--red,#ef4444);font-size:0.85rem;margin-bottom:10px">' + esc(err) + '</div>' : '') +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
      '<label class="btn btn-primary btn-sm" style="cursor:pointer">&#128247; Take Photo' +
        '<input type="file" accept="image/*" capture="environment" style="display:none" onchange="inc_photoGalleryAdd(this)"></label>' +
      '<label class="btn btn-ghost btn-sm" style="cursor:pointer">Upload' +
        '<input type="file" accept="image/*" style="display:none" onchange="inc_photoGalleryAdd(this)"></label>' +
    '</div>' +
    '<div style="font-size:0.74rem;color:var(--text3);margin-bottom:12px">Take the photo first, fill in the claim later. Photos are saved only on this device/browser &mdash; not uploaded to the system. Clearing your browser data removes them, so Download the important ones to your gallery.</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;max-height:55vh;overflow-y:auto">' +
      (cards || '<div style="font-size:0.85rem;color:var(--text2)">No photos saved yet.</div>') +
    '</div>'
  );
}
async function inc_photoGalleryAdd(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  try {
    const data = await inc_photoCompress(file);
    await inc_photoAdd(data, inc_photoCtx);
    toast('Receipt photo saved on this device.', 'success');
    const ctx = inc_photoCtx;
    inc_photoGallery(ctx);
    if (ctx) inc_loadAgentClaims(localDateStr(new Date()));
  } catch(e) { toast(e.message || 'Could not save photo.', 'error'); }
  input.value = '';
}
async function inc_photoAttach(id) {
  try {
    await inc_photoLink(id, inc_photoCtx);
    toast('Photo attached to OR ' + inc_photoCtx + '.', 'success');
    closeModalDirect();
    inc_loadAgentClaims(localDateStr(new Date()));
  } catch(e) { toast(e.message || 'Could not attach photo.', 'error'); }
}
async function inc_photoDeleteConfirm(id) {
  if (!confirm('Delete this photo from this device? This cannot be undone.')) return;
  try {
    await inc_photoRemove(id);
    toast('Photo deleted.', 'success');
    const ctx = inc_photoCtx;
    inc_photoGallery(ctx);
    inc_loadAgentClaims(localDateStr(new Date()));
  } catch(e) { toast('Could not delete photo.', 'error'); }
}
// Start a new claim with this saved photo already selected (so it can be read while typing)
function inc_photoUseForClaim(id) {
  inc_openClaimModal();               // resets inc_claimState synchronously, then loads categories
  inc_claimState.photoId = id;
  inc_photoRenderPreview();
}
// Click on the Receipt column of a claim row
async function inc_photoRowClick(inv) {
  try {
    const key = inc_photoNormInv(inv);
    const rec = (await inc_photoList()).find(function(r) { return r.inv === key; });
    if (rec) inc_photoShow(rec.data, 'OR ' + key);
    else inc_photoGallery(inv);
  } catch(e) { inc_photoGallery(inv); }
}

// Photo section inside the "Add Incentive Claim" form (choose from saved Receipt Photos)
function inc_photoDeselect() { inc_claimState.photoId = null; inc_photoRenderPreview(); }
// The claim form shows NO image. If the agent started the claim from Receipt Photos
// ("Use for Claim"), only a one-line note appears; the photo itself opens on demand.
async function inc_photoRenderPreview() {
  const box = document.getElementById('inc_photo_preview');
  if (!box) return;
  const sel = inc_claimState.photoId;
  if (!sel) { box.innerHTML = ''; return; }
  let rec = null;
  try { rec = await inc_photoById(sel); } catch(e) {}
  if (!rec || rec.inv) { inc_claimState.photoId = null; box.innerHTML = ''; return; }
  box.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px;padding:9px 12px;border:1.5px solid var(--green);border-radius:10px;font-size:0.78rem;color:var(--text2)">' +
      '<span>&#128247; Receipt photo attached. It will be linked to this OR when you submit.</span>' +
      '<span style="margin-left:auto;display:flex;gap:6px">' +
        '<button type="button" class="btn btn-ghost btn-sm" onclick="inc_photoView(\'' + sel + '\')">View</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" onclick="inc_photoDeselect()">Remove</button>' +
      '</span>' +
    '</div>';
}

// ── PROOF OF SALE PHOTOS (agent) ──────────────────────────────
// Standalone gallery, separate from the receipt photos and from incentive claims.
// Photos are kept ONLY in this browser/phone (own IndexedDB), per logged-in user.
// Nothing is sent to the server. Agents can download them to their gallery.
const INC_PROOF_DB    = 'ae_pos_proof';
const INC_PROOF_STORE = 'photos';

function inc_proofDb() {
  return new Promise(function(resolve, reject) {
    if (!window.indexedDB) { reject(new Error('This browser cannot store photos.')); return; }
    const rq = indexedDB.open(INC_PROOF_DB, 1);
    rq.onupgradeneeded = function() { rq.result.createObjectStore(INC_PROOF_STORE, { keyPath: 'id' }); };
    rq.onsuccess = function() { resolve(rq.result); };
    rq.onerror   = function() { reject(rq.error || new Error('Storage error.')); };
  });
}
function inc_proofUser() { return String((currentUser && (currentUser.id || currentUser.username)) || ''); }

async function inc_proofAdd(dataUrl) {
  const db = await inc_proofDb();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch(e) {}
  const rec = { id: 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                user: inc_proofUser(), data: dataUrl, ts: Date.now() };
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(INC_PROOF_STORE, 'readwrite');
    tx.objectStore(INC_PROOF_STORE).put(rec);
    tx.oncomplete = function() { resolve(rec.id); };
    tx.onerror    = function() { reject(tx.error || new Error('Could not save photo.')); };
  });
}
async function inc_proofList() {
  const db = await inc_proofDb();
  const me = inc_proofUser();
  return new Promise(function(resolve, reject) {
    const rq = db.transaction(INC_PROOF_STORE, 'readonly').objectStore(INC_PROOF_STORE).getAll();
    rq.onsuccess = function() {
      resolve((rq.result || []).filter(function(r) { return r.user === me; }).sort(function(a, b) { return b.ts - a.ts; }));
    };
    rq.onerror = function() { reject(rq.error); };
  });
}
async function inc_proofGet(id) {
  const rec = (await inc_proofList()).find(function(r) { return r.id === id; });
  return rec || null;
}
async function inc_proofRemove(id) {
  const rec = await inc_proofGet(id);
  if (!rec) return true;
  const db = await inc_proofDb();
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(INC_PROOF_STORE, 'readwrite');
    tx.objectStore(INC_PROOF_STORE).delete(id);
    tx.oncomplete = function() { resolve(true); };
    tx.onerror    = function() { reject(tx.error); };
  });
}

async function inc_proofGallery() {
  let list = [], err = '';
  try { list = await inc_proofList(); } catch(e) { err = e.message || 'Storage error.'; }
  const cards = list.slice(0, 40).map(function(r) {
    return '<div style="width:150px;border:1.5px solid var(--border);border-radius:10px;padding:8px;background:#fff">' +
      '<img src="' + r.data + '" style="width:100%;height:110px;object-fit:cover;border-radius:6px;cursor:pointer" onclick="inc_proofView(\'' + r.id + '\')">' +
      '<div style="font-size:0.7rem;color:var(--text3);margin:5px 0 6px">' + safeFormatDateTime(new Date(r.ts).toISOString()) + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
        '<button class="btn btn-ghost btn-sm" onclick="inc_proofDownload(\'' + r.id + '\')">Download</button>' +
        '<button class="btn btn-danger btn-sm" onclick="inc_proofDeleteConfirm(\'' + r.id + '\')">Delete</button>' +
      '</div></div>';
  }).join('');
  openModal(
    '<div class="modal-title">Proof of Sale Photos</div>' +
    (err ? '<div style="color:var(--red,#ef4444);font-size:0.85rem;margin-bottom:10px">' + esc(err) + '</div>' : '') +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">' +
      '<label class="btn btn-primary btn-sm" style="cursor:pointer">&#128247; Take Photo' +
        '<input type="file" accept="image/*" capture="environment" style="display:none" onchange="inc_proofAddFromInput(this)"></label>' +
      '<label class="btn btn-ghost btn-sm" style="cursor:pointer">Upload' +
        '<input type="file" accept="image/*" style="display:none" onchange="inc_proofAddFromInput(this)"></label>' +
    '</div>' +
    '<div style="font-size:0.74rem;color:var(--text3);margin-bottom:12px">Your own proof-of-sale photos (for example the item sold). Saved only on this device/browser, not uploaded to the system, and separate from your receipt photos. Download the ones you want to keep &mdash; clearing your browser data removes them. If a person is in the photo, ask their permission first.</div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;max-height:55vh;overflow-y:auto">' +
      (cards || '<div style="font-size:0.85rem;color:var(--text2)">No proof-of-sale photos yet.</div>') +
    '</div>'
  );
}
async function inc_proofAddFromInput(input) {
  const file = input && input.files && input.files[0];
  if (!file) return;
  try {
    const data = await inc_photoCompress(file);
    await inc_proofAdd(data);
    toast('Photo saved on this device.', 'success');
    inc_proofGallery();
  } catch(e) { toast(e.message || 'Could not save photo.', 'error'); }
  input.value = '';
}
async function inc_proofView(id) {
  try {
    const rec = await inc_proofGet(id);
    if (rec) inc_photoShow(rec.data, safeFormatDateTime(new Date(rec.ts).toISOString()));
  } catch(e) { toast('Could not open photo.', 'error'); }
}
async function inc_proofDownload(id) {
  try {
    const rec = await inc_proofGet(id);
    if (!rec) return;
    const a = document.createElement('a');
    a.href = rec.data;
    a.download = 'proof_of_sale_' + localDateStr(new Date(rec.ts)) + '_' + rec.id + '.jpg';
    document.body.appendChild(a); a.click(); a.remove();
  } catch(e) { toast('Could not download photo.', 'error'); }
}
async function inc_proofDeleteConfirm(id) {
  if (!confirm('Delete this photo from this device? This cannot be undone.')) return;
  try {
    await inc_proofRemove(id);
    toast('Photo deleted.', 'success');
    inc_proofGallery();
  } catch(e) { toast('Could not delete photo.', 'error'); }
}

function inc_money(n) { return '&#8369;' + (parseFloat(n) || 0).toFixed(2); }

function inc_catAmount(catName) {
  const c = (inc_claimState.cats || []).find(x => x.category === catName);
  return c ? c.amount : 0;
}

function inc_btnStyle(active, color) {
  return 'flex:1;padding:9px;border-radius:8px;border:2px solid ' + (active ? color : 'var(--border)') +
         ';background:' + (active ? color : 'white') + ';color:' + (active ? 'white' : 'var(--text2)') +
         ';font-weight:700;font-family:var(--font-main);cursor:pointer;font-size:0.85rem';
}

function inc_setSaleType(type) {
  inc_claimState.saleType = type;
  const btnR = document.getElementById('inc_btn_retail');
  const btnW = document.getElementById('inc_btn_wholesale');
  if (btnR) btnR.style.cssText = inc_btnStyle(type === 'retail',    'var(--green)');
  if (btnW) btnW.style.cssText = inc_btnStyle(type === 'wholesale', 'var(--amber,#d97706)');
  inc_refreshTotals();
}

async function inc_openClaimModal() {
  inc_claimState = { invoiceNo:'', saleType:'retail', items:[{ description:'', category:'', qty:1, qtyOnOR:1, orAuto:true }], cats:[], prods:[], orTaken:false, orItems:[], orTimer:null };
  openModal(
    '<div class="modal-title">Add Incentive Claim</div>' +

    '<div class="field">' +
      '<label for="inc_invoice">Official Receipt (OR) Number</label>' +
      '<input id="inc_invoice" name="inc_invoice" placeholder="Type the OR number from the receipt" oninput="inc_orInput()" autocomplete="off">' +
      '<div id="inc_or_msg" style="font-size:0.75rem;margin:4px 0 10px;color:var(--text3)">Several agents can share one OR. Add only the items YOU assisted; an item already claimed under this OR cannot be claimed again.</div>' +
    '</div>' +

    '<div class="field"><label>Sale Type</label>' +
      '<div style="display:flex;gap:8px;margin-top:4px">' +
        '<button type="button" id="inc_btn_retail" onclick="inc_setSaleType(\'retail\')" style="' + inc_btnStyle(true, 'var(--green)') + '">Retail (100%)</button>' +
        '<button type="button" id="inc_btn_wholesale" onclick="inc_setSaleType(\'wholesale\')" style="' + inc_btnStyle(false, 'var(--amber,#d97706)') + '">Wholesale (50%)</button>' +
      '</div>' +
    '</div>' +

    '<div style="font-size:0.78rem;font-weight:700;color:var(--text3);text-transform:uppercase;margin:14px 0 6px">Items sold under this OR</div>' +
    '<datalist id="inc_prodlist"></datalist>' +
    '<div id="inc_items"></div>' +
    '<button type="button" class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="inc_addItemRow()">+ Add another item</button>' +

    '<div id="inc_photo_preview"></div>' +

    '<div id="inc_valbox" style="display:none;border-radius:8px;padding:12px 14px;margin-top:10px;font-size:0.84rem"></div>' +
    '<div id="inc_summary" style="background:var(--bg2,#f7f8fa);border:1.5px solid var(--border);border-radius:10px;padding:14px;margin-top:12px"></div>' +
    '<button class="btn btn-primary" id="inc_submit_btn" style="width:100%;margin-top:12px" disabled onclick="inc_submitClaim()">Submit Claim</button>'
  );
  inc_renderItems();
  inc_refreshTotals();
  inc_photoRenderPreview();
  try {
    let res;
    if (_incCatCache && Date.now() - _incCatCache.t < 300000 && _incCatCache.uid === (currentUser && currentUser.id)) res = _incCatCache.res;
    else {
      res = await gasRequest({ action: 'inc_getClaimCategories' });
      if (res && res.success) _incCatCache = { t: Date.now(), res: res, uid: currentUser && currentUser.id };
    }
    if (res.success) {
      inc_checkApiVersion(res);
      inc_claimState.cats  = res.data || [];
      inc_claimState.prods = res.products || [];
      const dl = document.getElementById('inc_prodlist');
      if (dl) dl.innerHTML = inc_claimState.prods.slice(0, 3000).map(p => '<option value="' + esc(p.productName) + '"></option>').join('');
      if (!inc_claimState.cats.length) {
        inc_showValbox('warn', 'No incentive categories are set up yet. Ask your Admin to add categories and amounts.');
      }
      inc_renderItems();
      inc_refreshTotals();
    } else {
      inc_showValbox('error', esc(res.message || 'Could not load categories.'));
    }
  } catch(e) {
    inc_showValbox('error', 'Network error while loading categories. Close and try again.');
  }
}

function inc_renderItems() {
  const box = document.getElementById('inc_items');
  if (!box) return;
  const cats = inc_claimState.cats || [];
  box.innerHTML = inc_claimState.items.map(function(it, i) {
    const opts = '<option value="">Select category</option>' + cats.map(function(c) {
      return '<option value="' + esc(c.category) + '"' + (c.category === it.category ? ' selected' : '') + '>' +
             esc(c.category) + ' (&#8369;' + c.amount.toFixed(2) + ')</option>';
    }).join('');
    return '<div style="border:1.5px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        '<b style="font-size:0.8rem;color:var(--text2)">Item ' + (i + 1) + '</b>' +
        (inc_claimState.items.length > 1
          ? '<button type="button" class="btn btn-ghost btn-sm" onclick="inc_removeItemRow(' + i + ')">Remove</button>' : '') +
      '</div>' +
      '<div class="field"><label>Item name</label>' +
        '<input type="text" list="inc_prodlist" maxlength="120" placeholder="Type the item sold" value="' + esc(it.description) + '" oninput="inc_itemChanged(' + i + ',\'description\',this.value)" autocomplete="off"></div>' +
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
        '<div class="field" style="flex:2;min-width:150px"><label>Category</label>' +
          '<select id="inc_catsel_' + i + '" onchange="inc_itemChanged(' + i + ',\'category\',this.value)">' + opts + '</select></div>' +
        '<div class="field" style="flex:1;min-width:80px"><label>My qty</label>' +
          '<input type="number" min="1" max="1000" value="' + (parseInt(it.qty) || 1) + '" oninput="inc_itemChanged(' + i + ',\'qty\',this.value)"></div>' +
        '<div class="field" style="flex:1;min-width:90px"><label title="Total pieces of this item on the OR, for all agents">Qty on OR</label>' +
          '<input type="number" min="1" max="1000" id="inc_oq_' + i + '" value="' + (parseInt(it.qtyOnOR) || 1) + '" oninput="inc_itemChanged(' + i + ',\'qtyOnOR\',this.value)"></div>' +
      '</div>' +
      '<div id="inc_line_' + i + '" style="margin-top:8px;font-size:0.82rem"></div>' +
    '</div>';
  }).join('');
}

function inc_addItemRow() {
  if (inc_claimState.items.length >= 30) { toast('Maximum of 30 items per OR.', 'warning'); return; }
  inc_claimState.items.push({ description:'', category:'', qty:1, qtyOnOR:1, orAuto:true });
  inc_renderItems();
  inc_refreshTotals();
}

function inc_removeItemRow(i) {
  if (inc_claimState.items.length <= 1) return;
  inc_claimState.items.splice(i, 1);
  inc_renderItems();
  inc_refreshTotals();
}

function inc_itemChanged(i, field, val) {
  const it = inc_claimState.items[i];
  if (!it) return;
  it[field] = (field === 'qty' || field === 'qtyOnOR') ? (Math.max(1, parseInt(val) || 1)) : val;
  if (field === 'qtyOnOR') it.orAuto = false;           // agent typed it himself
  if (field === 'qty' && it.orAuto) it.qtyOnOR = it.qty; // default: all pieces on the OR are mine
  // typed name matches a known product -> pick its category (agent can still change it)
  if (field === 'description' && !it.category) {
    const hit = (inc_claimState.prods || []).find(p => p.productName.toLowerCase() === String(val).trim().toLowerCase());
    if (hit && (inc_claimState.cats || []).some(c => c.category === hit.category)) {
      it.category = hit.category;
      const sel = document.getElementById('inc_catsel_' + i);
      if (sel) sel.value = hit.category;
    }
  }
  inc_refreshTotals();   // only updates text below the inputs, never re-renders them (keeps focus)
}

function inc_orInput() {
  inc_claimState.invoiceNo = (document.getElementById('inc_invoice')?.value || '').trim();
  inc_claimState.orTaken   = false;
  inc_claimState.orItems   = [];
  const msg = document.getElementById('inc_or_msg');
  if (msg) { msg.style.color = 'var(--text3)'; msg.textContent = 'Several agents can share one OR. Add only the items YOU assisted; an item already claimed under this OR cannot be claimed again.'; }
  clearTimeout(inc_claimState.orTimer);
  if (inc_claimState.invoiceNo) {
    inc_claimState.orTimer = setTimeout(inc_checkOR, 500);
  }
  inc_refreshTotals();
}

async function inc_checkOR() {
  const orNo = inc_claimState.invoiceNo;
  if (!orNo) return;
  try {
    const res = await gasRequest({ action: 'inc_checkOR', orNo: orNo });
    if (orNo !== inc_claimState.invoiceNo) return;   // user kept typing
    const msg = document.getElementById('inc_or_msg');
    if (!res.success) return;
    if (!inc_checkApiVersion(res)) return;
    inc_claimState.orItems = res.items || [];
    if (msg) {
      if (inc_claimState.orItems.length) {
        msg.style.color = 'var(--amber,#d97706)';
        msg.innerHTML = 'This OR already has <b>' + inc_claimState.orItems.length + '</b> claimed item(s). You can add other items sold under it:<br>' +
          inc_claimState.orItems.map(i => '&bull; ' + esc(i.description) + ' &times;' + (parseInt(i.qty) || 1) + (parseInt(i.qtyOnOR) > (parseInt(i.qty) || 1) ? ' (of ' + i.qtyOnOR + ' on OR)' : '') + ' &mdash; <i>' + esc(i.employeeName) + '</i>').join('<br>');
      } else {
        msg.style.color = 'var(--green,#059669)';
        msg.textContent = 'OR number is available. No items claimed under it yet.';
      }
    }
    inc_refreshTotals();
  } catch(e) {}
}

function inc_refreshTotals() {
  const isWhole = inc_claimState.saleType === 'wholesale';
  let grand = 0, ready = true;
  const agg = inc_orAggregate();
  const seenNames = {};
  inc_claimState.items.forEach(function(it, i) {
    const base = inc_catAmount(it.category);
    const eff  = isWhole ? base * 0.5 : base;
    const qty  = parseInt(it.qty) || 1;
    const tot  = eff * qty;
    const line = document.getElementById('inc_line_' + i);
    const oq   = document.getElementById('inc_oq_' + i);
    if (!String(it.description || '').trim() || !it.category || !base) ready = false;

    const nk = inc_normItem(it.description);
    const ex = nk ? agg[nk] : null;
    let err = '', warn = '', info = '';

    if (ex) {
      // the OR already has this item: its total is fixed, my qty must fit what is left
      it.qtyOnOR = ex.total;
      if (oq) { oq.value = ex.total; oq.disabled = true; }
      if (ex.remaining <= 0)       err = 'Fully claimed (' + ex.claimed + ' of ' + ex.total + ') by ' + ex.who.join(', ') + '. Remove this item.';
      else if (qty > ex.remaining) err = 'Only ' + ex.remaining + ' of ' + ex.total + ' left under this OR (claimed by ' + ex.who.join(', ') + ').';
      else                         info = ex.claimed + ' of ' + ex.total + ' already claimed by ' + ex.who.join(', ') + '. ' + ex.remaining + ' left.';
    } else {
      if (oq) oq.disabled = false;
      if (it.orAuto) { it.qtyOnOR = qty; if (oq) oq.value = qty; }
      if ((parseInt(it.qtyOnOR) || 1) < qty) err = 'Qty on OR cannot be less than your qty.';
      // similar (but not identical) to an item somebody already claimed under this OR
      if (nk) {
        let best = null;
        Object.keys(agg).forEach(function(k) { const sc = inc_similarity(it.description, agg[k].name); if (sc >= 0.8 && (!best || sc > best.sc)) best = { sc: sc, e: agg[k] }; });
        if (best) warn = 'Looks similar to "' + best.e.name + '" already claimed by ' + best.e.who.join(', ') + '. Make sure this is a different item.';
      }
    }
    if (nk && seenNames[nk]) err = 'This item is listed twice. Combine it into one line.';
    if (nk) seenNames[nk] = true;

    if (err) ready = false;
    if (it.category && base && !err) grand += tot;
    if (line) {
      let html = '';
      if (err)  html += '<div style="color:var(--red,#ef4444);font-weight:600">' + esc(err) + '</div>';
      if (info) html += '<div style="color:var(--blue,#1e90ff)">' + esc(info) + '</div>';
      if (warn) html += '<div style="color:var(--amber,#d97706)">&#9888; ' + esc(warn) + '</div>';
      html += (it.category && base)
        ? 'Incentive: <b>' + inc_money(eff) + '</b> &times; ' + qty +
          ' = <b style="color:var(--green)">' + inc_money(tot) + '</b>' + (isWhole ? ' <span style="color:var(--amber,#d97706)">(50%)</span>' : '')
        : '<span style="color:var(--text3)">Choose a category to see the incentive amount.</span>';
      line.innerHTML = html;
    }
  });
  const sum = document.getElementById('inc_summary');
  if (sum) {
    sum.innerHTML =
      '<div style="font-size:0.73rem;font-weight:700;color:var(--text3);text-transform:uppercase;margin-bottom:8px">Claim Summary</div>' +
      '<table style="width:100%;font-size:0.85rem">' +
        '<tr><td style="color:var(--text3);padding:2px 0;width:120px">OR Number</td><td style="font-weight:600">' + (esc(inc_claimState.invoiceNo) || '-') + '</td></tr>' +
        '<tr><td style="color:var(--text3);padding:2px 0">Items</td><td style="font-weight:600">' + inc_claimState.items.length + '</td></tr>' +
        '<tr><td style="color:var(--text3);padding:2px 0">TOTAL</td><td style="font-weight:700;font-size:1.05rem;color:var(--green)">' + inc_money(grand) + '</td></tr>' +
      '</table>';
  }
  const btn = document.getElementById('inc_submit_btn');
  if (btn) btn.disabled = !(ready && inc_claimState.invoiceNo && !inc_claimState.orTaken && !inc_claimState.apiOutdated);
}

function inc_showValbox(type, msg) {
  const el = document.getElementById('inc_valbox');
  if (!el) return;
  if (!type) { el.style.display='none'; return; }
  const colors = {
    ok:    'background:#d1fae5;border:1px solid #6ee7b7;color:#065f46',
    warn:  'background:#fffbeb;border:1px solid #fde68a;color:#92400e',
    error: 'background:#fee2e2;border:1px solid #fca5a5;color:#991b1b',
  };
  el.style.cssText = (colors[type]||'') + ';display:block;border-radius:8px;padding:10px 14px;font-size:0.84rem;margin-top:10px';
  el.innerHTML = msg;
}

async function inc_submitClaim() {
  const btn = document.getElementById('inc_submit_btn');
  if (!inc_claimState.invoiceNo || inc_claimState.orTaken) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  // Only names, categories and quantities are sent; the server works out the amounts.
  const payload = {
    action:    'inc_submitClaim',
    invoiceNo: inc_claimState.invoiceNo,
    saleType:  inc_claimState.saleType || 'retail',
    items:     inc_claimState.items.map(it => ({
      description: String(it.description || '').trim(),
      category:    it.category,
      qty:         parseInt(it.qty) || 1,
      qtyOnOR:     parseInt(it.qtyOnOR) || parseInt(it.qty) || 1,
    })),
  };

  try {
    const res = await gasPost(payload);
    if (res.success) {
      if (inc_claimState.photoId) {
        try { await inc_photoLink(inc_claimState.photoId, payload.invoiceNo); }
        catch(pe) { toast('Claim saved, but the receipt photo could not be linked on this device.', 'warning'); }
      }
      toast('Incentive claim submitted! &#8369;' + (parseFloat(res.totalIncentive) || 0).toFixed(2) + ' (' + (res.count || payload.items.length) + ' item/s)', 'success');
      closeModalDirect();
      inc_loadAgentClaims(localDateStr(new Date()));
    } else {
      toast(res.message || 'Error submitting claim.', 'error');
      if (/claimed|left to claim|listed twice/i.test(res.message || '')) { inc_checkOR(); }
      if (btn) { btn.disabled = false; btn.textContent = 'Submit Claim'; }
    }
  } catch(e) {
    toast('Network error.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Claim'; }
  }
}

// ── VERIFY / REJECT ───────────────────────────────────────
// Update one claim row in place (status badge + action cell) so the admin stays where they are:
// same tab, same filters, same scroll position. No page reload.
function inc_updateClaimRow(btn, id, status, reason) {
  const c = (inc_allClaimsCache || []).find(x => x.id === id);
  if (c) {
    c.status = status;
    if (status === 'Rejected' && reason !== undefined) c.rejectionReason = reason;
    if (status === 'Voided'   && reason !== undefined) c.voidReason      = reason;
  }
  if (inc_view === 'orcheck') { inc_renderOrCheck(); return; }   // cards recount themselves
  const actionTd = btn && btn.closest ? btn.closest('td') : null;
  const statusTd = actionTd ? actionTd.previousElementSibling : null;
  if (statusTd) statusTd.innerHTML = inc_statusBadge(status);
  if (actionTd) actionTd.innerHTML = status === 'Rejected'
    ? '<span style="font-size:0.73rem;color:var(--red,#ef4444)">' + esc(reason || '') + '</span>'
    : status === 'Voided'
    ? '<span style="font-size:0.73rem;color:#6b21a8">' + esc(reason || '') + '</span>'
    : '';
}

async function inc_verifyClaim(id, btn) {
  if (btn) { if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Verifying...'; }
  try {
    const res = await gasPost({ action:'inc_verifyClaim', id, verifiedBy: currentUser.name || currentUser.username });
    if (res.success) {
      toast('Claim verified.','success');
      if (btn && btn.isConnected) inc_updateClaimRow(btn, id, 'Verified');
      else navigateTo('incentives');
    } else {
      toast(res.message || 'Error verifying.','error');
      if (btn) { btn.disabled = false; btn.textContent = 'Verify'; }
    }
  } catch(e) {
    toast('Network error.','error');
    if (btn) { btn.disabled = false; btn.textContent = 'Verify'; }
  }
}

let inc_rejectBtn = null;
function inc_openRejectModal(id, btn) {
  inc_rejectId = id;
  inc_rejectBtn = btn || null;
  openModal(
    '<div class="modal-title">Reject Claim</div>' +
    '<p style="font-size:0.85rem;color:var(--text2);margin-bottom:14px">Please provide a reason for rejection. This will be recorded and visible to the employee.</p>' +
    '<div class="field"><label for="inc_reject_reason">Rejection Reason *</label>' +
      '<textarea id="inc_reject_reason" name="inc_reject_reason" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:var(--font-main);min-height:80px" placeholder="e.g. Item was not sold under this invoice..."></textarea>' +
    '</div>' +
    '<button class="btn btn-danger" style="width:100%;margin-top:8px" onclick="inc_confirmReject()">Confirm Reject</button>'
  );
}

async function inc_confirmReject() {
  const reason = document.getElementById('inc_reject_reason')?.value.trim();
  if (!reason) { toast('Please enter a rejection reason.','error'); return; }
  const btn = document.querySelector('#modalBox .btn-danger');
  if (btn) { btn.disabled = true; btn.textContent = 'Rejecting...'; }
  try {
    const res = await gasPost({
      action: 'inc_rejectClaim', id: inc_rejectId,
      rejectionReason: reason,
      verifiedBy: currentUser.name || currentUser.username,
    });
    if (res.success) {
      toast('Claim rejected.','success'); closeModalDirect();
      if (inc_rejectBtn && inc_rejectBtn.isConnected) inc_updateClaimRow(inc_rejectBtn, inc_rejectId, 'Rejected', reason);
      else navigateTo('incentives');
    }
    else { toast(res.message || 'Error.','error'); if(btn){btn.disabled=false;btn.textContent='Confirm Reject';} }
  } catch(e) { toast('Network error.','error'); if(btn){btn.disabled=false;} }
}

// ── VOID (admin-only, for already-Verified claims) ──────────
let inc_voidId  = null;
let inc_voidBtn = null;
function inc_openVoidModal(id, btn) {
  inc_voidId  = id;
  inc_voidBtn = btn || null;
  openModal(
    '<div class="modal-title">Void Claim</div>' +
    '<p style="font-size:0.85rem;color:var(--text2);margin-bottom:14px">This claim was already Verified. Voiding it removes it from the incentive totals but keeps the record for audit purposes. Please give a reason.</p>' +
    '<div class="field"><label for="inc_void_reason">Void Reason *</label>' +
      '<textarea id="inc_void_reason" name="inc_void_reason" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:7px;font-family:var(--font-main);min-height:80px" placeholder="e.g. Verified by mistake, duplicate claim..."></textarea>' +
    '</div>' +
    '<button class="btn btn-danger" style="width:100%;margin-top:8px" onclick="inc_confirmVoid()">Confirm Void</button>'
  );
}

async function inc_confirmVoid() {
  const reason = document.getElementById('inc_void_reason')?.value.trim();
  if (!reason) { toast('Please enter a void reason.','error'); return; }
  const btn = document.querySelector('#modalBox .btn-danger');
  if (btn) { btn.disabled = true; btn.textContent = 'Voiding...'; }
  try {
    const res = await gasPost({
      action: 'inc_voidClaim', id: inc_voidId,
      voidReason: reason,
      voidedBy: currentUser.name || currentUser.username,
    });
    if (res.success) {
      toast('Claim voided.','success'); closeModalDirect();
      if (inc_voidBtn && inc_voidBtn.isConnected) inc_updateClaimRow(inc_voidBtn, inc_voidId, 'Voided', reason);
      else navigateTo('incentives');
    }
    else { toast(res.message || 'Error.','error'); if(btn){btn.disabled=false;btn.textContent='Confirm Void';} }
  } catch(e) { toast('Network error.','error'); if(btn){btn.disabled=false;} }
}

// ── EXCEL EXPORT ──────────────────────────────────────────
async function inc_exportDailyExcel(date) {
  toast('Preparing Excel...','info');
  try {
    const res = await gasRequest({ action:'inc_getDailySummary', date:date });
    const claims = inc_filterByBranch(res.claims || []);
    if (!res.success || !claims.length) { toast('No data to export.','warning'); return; }
    const now = new Date();
    const summary    = inc_summarize(claims);
    const grandTotal = claims.filter(inc_isLive).reduce((t, c) => t + parseFloat(c.totalIncentive || 0), 0);
    const HEADER = ['Employee','Branch','OR No.','Category','Description','Qty','Incentive/Unit','Total Incentive','Status'];
    const data = claims.map(c => [
      c.employeeName, inc_branchDisp(c.branch), c.invoiceNo, c.category || '', c.description,
      parseInt(c.qty||1), parseFloat(c.incentivePerUnit||0), parseFloat(c.totalIncentive||0), c.status
    ]);
    const summaryRows = summary.map(s => [s.employeeName, inc_branchDisp(s.branch), '', '', 'SUBTOTAL', '', '', s.total, '']);

    const sheet_data = [
      ['AE HOME POS \u2014 Incentive Daily Report'],
      ['Date:', safeFormatDateOnly(date)],
      ['Branch:', inc_branchFilter ? inc_branchDisp(inc_branchFilter) : 'All Branches'],
      ['Generated:', now.toLocaleString('en-PH')],
      [],
      HEADER,
      ...data,
      [],
      ['EMPLOYEE SUMMARY'],
      ['Employee','Branch','','','','','','Total Incentive',''],
      ...summaryRows,
      [],
      ['','','','','','','','Grand Total:', grandTotal],
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheet_data);
    ws['!cols'] = [{wch:22},{wch:12},{wch:16},{wch:16},{wch:30},{wch:6},{wch:14},{wch:16},{wch:10}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Incentive Report');
    const tag = inc_branchFilter ? '_' + inc_branchFilter.replace(/\s+/g, '') : '';
    XLSX.writeFile(wb, 'IncentiveReport_' + date + tag + '.xlsx');
    toast('Excel downloaded!','success');
  } catch(e) { toast('Export failed: '+e.message,'error'); }
}

// ── HELPERS ───────────────────────────────────────────────
function inc_statusBadge(status) {
  const map = {
    'Pending':  'background:#fffbeb;color:#92400e',
    'Verified': 'background:#d1fae5;color:#065f46',
    'Rejected': 'background:#fee2e2;color:#991b1b',
    'Voided':   'background:#f3e8ff;color:#6b21a8',
  };
  const style = map[status] || 'background:#f3f4f6;color:var(--text3)';
  return '<span style="' + style + ';padding:2px 9px;border-radius:20px;font-size:0.72rem;font-weight:700">' + (status||'') + '</span>';
}

function inc_actionBtns(c) {
  const role = currentUser.role;
  if (c.status === 'Rejected') {
    return '<span style="font-size:0.73rem;color:var(--red,#ef4444)">' + esc(c.rejectionReason||'') + '</span>';
  }
  if (c.status === 'Voided') {
    return '<span style="font-size:0.73rem;color:#6b21a8">' + esc(c.voidReason||'') + '</span>';
  }
  if (c.status === 'Verified') {
    // Admin-only: void an already-verified claim (mistaken verify, duplicate, etc.)
    return role === 'admin'
      ? '<button class="inv-btn inv-btn-del" onclick="inc_openVoidModal(\'' + esc(c.id) + '\', this)">Void</button>'
      : '';
  }
  if (c.status !== 'Pending') return '';
  if (role === 'admin' || role === 'manager' || role === 'clerk' || role === 'verifier') {
    return '<div style="display:flex;gap:5px">' +
      '<button class="inv-btn inv-btn-in" onclick="inc_verifyClaim(\'' + esc(c.id) + '\', this)">Verify</button>' +
      '<button class="inv-btn inv-btn-del" onclick="inc_openRejectModal(\'' + esc(c.id) + '\', this)">Reject</button>' +
    '</div>';
  }
  return '';
}


// ═══════════════════════════════════════════════
// PRICE CHECKER (admin + clerk) — separate "Price Checker" sheet.
// The full list is cached in this browser (IndexedDB) so every lookup is instant
// and never calls the server. Upload replaces the whole list.
// ═══════════════════════════════════════════════
const PCX = { map: new Map(), list: [], updatedAt: '', count: 0, pending: null, busy: false, timer: null };

function pcx_norm(b) {
  const s = String(b == null ? '' : b).trim().replace(/\s+/g, '');
  return s.replace(/^0+(?=\d)/, '');   // ignore leading zeros so scanner (EAN) and sheet values still match
}
function pcx_money(n) {
  return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pcx_db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ae_price_checker', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function pcx_cacheGet() {
  try {
    const db = await pcx_db();
    return await new Promise(res => {
      const r = db.transaction('kv').objectStore('kv').get('list');
      r.onsuccess = () => res(r.result || null);
      r.onerror   = () => res(null);
    });
  } catch (e) { return null; }
}
async function pcx_cachePut(obj) {
  try {
    const db = await pcx_db();
    await new Promise(res => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(obj, 'list');
      tx.oncomplete = res; tx.onerror = res; tx.onabort = res;
    });
  } catch (e) {}
}

function pcx_setList(rows, updatedAt) {
  PCX.list = rows;
  PCX.updatedAt = updatedAt || '';
  PCX.count = rows.length;
  PCX.map = new Map();
  rows.forEach(r => PCX.map.set(pcx_norm(r[0]), r));
}

function pcx_renderPage() {
  try { pcx_closeScanner(); } catch (e) {}
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'clerk')) {
    document.getElementById('pageContent').innerHTML = '<div class="card"><div class="card-title">Access denied</div></div>';
    return;
  }
  document.getElementById('pageContent').innerHTML = `
<div class="card">
  <div class="card-title">Price Checker</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <input id="pcxInput" type="text" inputmode="text" autocomplete="off" autocapitalize="off"
      placeholder="Scan barcode or type product name"
      style="flex:1;min-width:200px;padding:12px;font-size:16px;border:1px solid var(--border,#ccc);border-radius:8px"
      oninput="pcx_onInput()" onkeydown="if(event.key==='Enter'){pcx_onEnter();}">
    <button class="btn btn-primary" onclick="pcx_openScanner()">Scan</button>
    <button class="btn btn-ghost" onclick="pcx_clearInput()">Clear</button>
  </div>
  <div id="pcxScanWrap" style="display:none;margin-top:10px">
    <video id="pcxVideo" autoplay playsinline muted style="width:100%;border-radius:8px;max-height:220px;object-fit:cover;background:#000"></video>
    <div id="pcxScanStatus" style="font-size:13px;margin-top:4px;opacity:.8">Point at the barcode...</div>
    <button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="pcx_closeScanner()">Close Camera</button>
  </div>
  <div id="pcxResult" style="margin-top:14px"></div>
  <div style="font-size:12px;margin-top:12px;opacity:.8">Note: Prices may vary or be updated. Please double-check the price with the cashier and tell them the product name or barcode.</div>
</div>
<div class="card">
  <div class="card-title">List</div>
  <div id="pcxMeta" style="font-size:13px;opacity:.8;margin-bottom:10px"></div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn btn-primary btn-sm" onclick="document.getElementById('pcxFile').click()">Upload List</button>
    <button class="btn btn-ghost btn-sm" onclick="pcx_refresh(true)">Refresh</button>
    <button class="btn btn-danger btn-sm" onclick="pcx_confirmClear()">Clear List</button>
    <input id="pcxFile" type="file" accept=".xlsx,.xls,.csv" style="display:none" onchange="pcx_onFile(this)">
  </div>
  <div style="font-size:12px;opacity:.7;margin-top:8px">Columns: Barcode, Product Name, Retail Price. Uploading a new file replaces the whole list.</div>
</div>`;
  pcx_updateMeta();
  pcx_load();
  setTimeout(() => { const i = document.getElementById('pcxInput'); if (i) i.focus(); }, 100);
}

function pcx_updateMeta() {
  const el = document.getElementById('pcxMeta');
  if (!el) return;
  if (!PCX.count) { el.textContent = 'No list loaded yet. Upload a file to start.'; return; }
  let when = '';
  if (PCX.updatedAt) { try { when = ' • updated ' + safeFormatDateTime(PCX.updatedAt); } catch (e) {} }
  el.textContent = PCX.count.toLocaleString() + ' items' + when;
}

async function pcx_load() {
  const cached = await pcx_cacheGet();
  if (cached && cached.rows && cached.rows.length) {
    pcx_setList(cached.rows, cached.updatedAt);
    pcx_updateMeta();
  } else {
    await pcx_refresh(false);
  }
}

async function pcx_refresh(manual) {
  try {
    if (manual) toast('Loading list...', 'info', 1500);
    const r = await gasRequest({ action: 'pc_getAll' }, 60000);
    if (!r || !r.success) { toast((r && r.message) || 'Could not load the list.', 'error'); return; }
    pcx_setList(r.data || [], r.updatedAt);
    await pcx_cachePut({ rows: PCX.list, updatedAt: PCX.updatedAt });
    pcx_updateMeta();
    pcx_onInput();
    if (manual) toast('List updated: ' + PCX.count.toLocaleString() + ' items', 'success');
  } catch (e) {
    toast('Could not load the list: ' + e.message, 'error');
  }
}

function pcx_clearInput() {
  const i = document.getElementById('pcxInput');
  if (i) { i.value = ''; i.focus(); }
  const r = document.getElementById('pcxResult');
  if (r) r.innerHTML = '';
}

function pcx_onInput() {
  clearTimeout(PCX.timer);
  PCX.timer = setTimeout(pcx_search, 120);
}
function pcx_onEnter() {
  clearTimeout(PCX.timer);
  pcx_search(true);
}

function pcx_card(r) {
  return '<div style="border:2px solid #2e7d32;border-radius:12px;padding:16px;text-align:center">' +
    '<div style="font-size:15px;font-weight:600">' + esc(r[1]) + '</div>' +
    '<div style="font-size:40px;font-weight:800;margin:8px 0">' + pcx_money(r[2]) + '</div>' +
    '<div style="font-size:12px;opacity:.7">Barcode: ' + esc(r[0]) + '</div>' +
    '<div style="font-size:12px;margin-top:10px;padding:8px;border-radius:8px;background:rgba(239,108,0,.12);color:#b45309">Note: Prices may vary or be updated. Please double-check the price with the cashier and tell them the product name or barcode.</div></div>';
}

function pcx_search(fromEnter) {
  const box = document.getElementById('pcxInput');
  const out = document.getElementById('pcxResult');
  if (!box || !out) return;
  const q = box.value.trim();
  if (!q) { out.innerHTML = ''; return; }
  if (!PCX.count) { out.innerHTML = '<div style="opacity:.7">No list loaded. Upload a list first.</div>'; return; }

  const exact = PCX.map.get(pcx_norm(q));
  if (exact) {
    out.innerHTML = pcx_card(exact);
    if (fromEnter === true) { box.select(); }   // scanner: ready for the next scan
    return;
  }
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = [];
  for (let i = 0; i < PCX.list.length && hits.length < 30; i++) {
    const r = PCX.list[i];
    const name = String(r[1]).toLowerCase();
    const bc   = String(r[0]).toLowerCase();
    if (tokens.every(t => name.indexOf(t) !== -1 || bc.indexOf(t) !== -1)) hits.push(r);
  }
  if (!hits.length) {
    out.innerHTML = '<div style="opacity:.7">No match for "' + esc(q) + '".</div>';
    if (fromEnter === true) box.select();
    return;
  }
  if (hits.length === 1 && fromEnter === true) { out.innerHTML = pcx_card(hits[0]); return; }
  out.innerHTML = hits.map((r, i) =>
    '<div onclick="pcx_pick(' + PCX.list.indexOf(r) + ')" style="display:flex;justify-content:space-between;gap:10px;padding:10px 4px;border-bottom:1px solid rgba(128,128,128,.25);cursor:pointer">' +
      '<div style="min-width:0"><div style="font-weight:600">' + esc(r[1]) + '</div><div style="font-size:12px;opacity:.65">' + esc(r[0]) + '</div></div>' +
      '<div style="font-weight:700;white-space:nowrap">' + pcx_money(r[2]) + '</div></div>'
  ).join('') + (hits.length >= 30 ? '<div style="font-size:12px;opacity:.65;padding-top:8px">Showing first 30. Type more to narrow down.</div>' : '');
}
function pcx_pick(idx) {
  const r = PCX.list[idx];
  const out = document.getElementById('pcxResult');
  if (r && out) out.innerHTML = pcx_card(r);
}

// ── Upload ────────────────────────────────────
function pcx_parsePrice(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v == null ? '' : v).replace(/[₱,\s]|php/gi, ''));
  return isNaN(n) ? 0 : n;
}
function pcx_cellBarcode(v) {
  if (typeof v === 'number') return v.toFixed(0);   // avoids 8.9E+12 style output
  return String(v == null ? '' : v).trim();
}

function pcx_onFile(input) {
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  if (typeof XLSX === 'undefined') { toast('Spreadsheet reader not loaded. Check your internet and reload.', 'error'); return; }
  const rd = new FileReader();
  rd.onerror = () => toast('Could not read the file.', 'error');
  rd.onload = () => {
    try {
      const wb = XLSX.read(new Uint8Array(rd.result), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      pcx_prepare(rows, f.name);
    } catch (e) {
      toast('Could not read this file: ' + e.message, 'error');
    }
  };
  rd.readAsArrayBuffer(f);
}

function pcx_prepare(rows, fileName) {
  if (!rows.length) { toast('The file is empty.', 'error'); return; }
  let cb = 0, cn = 1, cp = 2, start = 0;
  const head = rows[0].map(h => String(h == null ? '' : h).toLowerCase().trim());
  const fb = head.findIndex(h => /barcode|bar code|upc|ean|sku|code/.test(h));
  const fn = head.findIndex(h => /product|name|item|description/.test(h));
  const fp = head.findIndex(h => /price|srp|retail/.test(h));
  if (fb !== -1 && fn !== -1 && fp !== -1) { cb = fb; cn = fn; cp = fp; start = 1; }
  else if (fb !== -1 || fn !== -1 || fp !== -1) { start = 1; }   // header present but unusual names: use columns A, B, C

  const seen = new Map();
  let skipped = 0;
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const barcode = pcx_cellBarcode(r[cb]);
    const name    = String(r[cn] == null ? '' : r[cn]).trim();
    if (!barcode || !name) { skipped++; continue; }
    seen.set(pcx_norm(barcode), [barcode, name, pcx_parsePrice(r[cp])]);   // duplicates: last one wins
  }
  const list = Array.from(seen.values());
  if (!list.length) { toast('No valid rows found. Columns must be Barcode, Product Name, Retail Price.', 'error'); return; }
  PCX.pending = list;
  const sample = list.slice(0, 5).map(r =>
    '<tr><td style="padding:4px 8px">' + esc(r[0]) + '</td><td style="padding:4px 8px">' + esc(r[1]) + '</td><td style="padding:4px 8px;text-align:right">' + pcx_money(r[2]) + '</td></tr>').join('');
  openModal(`
<div style="padding:4px">
  <h3 style="margin:0 0 8px">Upload Price List</h3>
  <div style="font-size:14px;margin-bottom:8px">File: ${esc(fileName)}<br>
    <b>${list.length.toLocaleString()}</b> items ready${skipped ? ' (' + skipped + ' rows skipped: missing barcode or name)' : ''}.<br>
    This replaces the current list.</div>
  <table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:12px">
    <tr style="opacity:.7"><td style="padding:4px 8px">Barcode</td><td style="padding:4px 8px">Product Name</td><td style="padding:4px 8px;text-align:right">Retail Price</td></tr>${sample}
  </table>
  <div id="pcxProg" style="font-size:13px;margin-bottom:10px"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end">
    <button class="btn btn-ghost" id="pcxCancelBtn" onclick="closeModalDirect()">Cancel</button>
    <button class="btn btn-primary" id="pcxGoBtn" onclick="pcx_upload(0)">Upload</button>
  </div>
</div>`);
}

// Each request is a GET with the data in the URL, so batches are sized by encoded length, not row count.
function pcx_makeBatches(list) {
  const MAX = 3500, batches = [];
  let cur = [], len = 2;
  list.forEach(r => {
    const l = JSON.stringify(r).length + 1;
    if (cur.length && (len + l > MAX || cur.length >= 400)) { batches.push(cur); cur = []; len = 2; }
    cur.push(r); len += l;
  });
  if (cur.length) batches.push(cur);
  return batches;
}

async function pcx_upload(fromBatch) {
  if (PCX.busy || !PCX.pending) return;
  PCX.busy = true;
  const go = document.getElementById('pcxGoBtn'), cancel = document.getElementById('pcxCancelBtn'), prog = document.getElementById('pcxProg');
  if (go) go.disabled = true;
  if (cancel) cancel.disabled = true;
  const list = PCX.pending, batches = PCX.batches && fromBatch ? PCX.batches : pcx_makeBatches(list);
  PCX.batches = batches;
  let saved = 0;
  for (let i = 0; i < fromBatch; i++) saved += batches[i].length;
  try {
    for (let i = fromBatch; i < batches.length; i++) {
      if (prog) prog.textContent = 'Saving ' + saved.toLocaleString() + ' of ' + list.length.toLocaleString() + '... please do not close this window.';
      const payload = { action: 'pc_saveBatch', rows: batches[i], isFirstBatch: i === 0 };
      let res;
      try { res = await gasPost(payload); }
      catch (e) { await new Promise(r => setTimeout(r, 2000)); res = await gasPost(payload); }   // one retry
      if (!res || res.success === false) throw new Error((res && res.message) || 'Save failed');
      saved += batches[i].length;
      PCX.resumeFrom = i + 1;
      await new Promise(r => setTimeout(r, 800));
    }
    pcx_setList(list, new Date().toISOString());
    await pcx_cachePut({ rows: PCX.list, updatedAt: PCX.updatedAt });
    PCX.pending = null; PCX.batches = null; PCX.resumeFrom = 0;
    closeModalDirect();
    toast('Price list uploaded: ' + list.length.toLocaleString() + ' items', 'success');
    pcx_updateMeta();
  } catch (e) {
    const next = PCX.resumeFrom || 0;
    if (prog) prog.innerHTML = '<span style="color:#c62828">Stopped at ' + saved.toLocaleString() + ' of ' + list.length.toLocaleString() + ': ' + esc(e.message) + '</span>';
    if (go) { go.disabled = false; go.textContent = 'Resume'; go.onclick = () => pcx_upload(next); }
    if (cancel) cancel.disabled = false;
  } finally {
    PCX.busy = false;
  }
}

function pcx_confirmClear() {
  if (!confirm('Clear the whole price list? This cannot be undone.')) return;
  gasPost({ action: 'pc_clear' }).then(async r => {
    if (r && r.success === false) { toast(r.message || 'Could not clear.', 'error'); return; }
    pcx_setList([], '');
    await pcx_cachePut({ rows: [], updatedAt: '' });
    pcx_updateMeta(); pcx_clearInput();
    toast('Price list cleared', 'success');
  }).catch(e => toast(e.message, 'error'));
}

// ── Price Checker camera scanner (same engines as the POS scanner: BarcodeDetector, ZXing fallback) ──
const PCXCAM = { stream: null, on: false, raf: 0, last: '', lastAt: 0, reader: null };

async function pcx_openScanner() {
  const wrap = document.getElementById('pcxScanWrap');
  const video = document.getElementById('pcxVideo');
  const status = document.getElementById('pcxScanStatus');
  if (!wrap || !video) return;
  if (PCXCAM.on) { pcx_closeScanner(); return; }
  wrap.style.display = 'block';
  PCXCAM.on = true; PCXCAM.last = ''; PCXCAM.lastAt = 0;
  try {
    PCXCAM.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    video.srcObject = PCXCAM.stream;
    await video.play();
    if (status) status.textContent = 'Point at the barcode...';

    let detector = null;
    if ('BarcodeDetector' in window) {
      detector = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code'] });
    } else {
      if (typeof ZXing === 'undefined') {
        if (status) status.textContent = 'Loading scanner...';
        await loadScript('https://cdn.jsdelivr.net/npm/@zxing/library@0.19.1/umd/index.min.js');
      }
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E, ZXing.BarcodeFormat.QR_CODE
      ]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      PCXCAM.reader = new ZXing.BrowserMultiFormatReader(hints);
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (status) status.textContent = 'Point at the barcode...';

    const loop = async () => {
      if (!PCXCAM.on) return;
      if (!document.getElementById('pcxVideo')) { pcx_closeScanner(); return; }   // left the page
      let val = '';
      try {
        if (detector) {
          const codes = await detector.detect(video);
          if (codes.length) val = String(codes[0].rawValue || '').trim();
        } else if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const lum = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
          const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum));
          val = String(PCXCAM.reader.decodeBitmap(bmp).getText() || '').trim();
        }
      } catch (e) {}   // not found is normal
      const now = Date.now();
      if (val && (val !== PCXCAM.last || now - PCXCAM.lastAt > 2500)) {
        PCXCAM.last = val; PCXCAM.lastAt = now;
        const box = document.getElementById('pcxInput');
        if (box) box.value = val;
        pcx_search(true);
        if (status) status.textContent = 'Scanned: ' + val + ' (scan another or close)';
        try { inc_notifyUnlock(); } catch (e) {}
      }
      PCXCAM.raf = requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    if (status) status.textContent = (e && e.name === 'NotAllowedError') ? 'Camera access denied. Allow camera in browser settings.' : 'Camera error: ' + (e && e.message ? e.message : 'unavailable');
    PCXCAM.on = false;
  }
}

function pcx_closeScanner() {
  PCXCAM.on = false;
  if (PCXCAM.raf) { cancelAnimationFrame(PCXCAM.raf); PCXCAM.raf = 0; }
  if (PCXCAM.stream) { PCXCAM.stream.getTracks().forEach(t => t.stop()); PCXCAM.stream = null; }
  const wrap = document.getElementById('pcxScanWrap');
  const video = document.getElementById('pcxVideo');
  if (wrap) wrap.style.display = 'none';
  if (video) video.srcObject = null;
}


// ═══════════════════════════════════════════════════════════════
// IN-HOUSE INSTALLMENT (employees). Monitoring only: nothing here touches Sales or Inventory.
// Admin: create installments, verify payments, manage employee accounts.
// Verifier: verify / reject payment proofs. Employee: see own installments and upload proof of payment.
// ═══════════════════════════════════════════════════════════════
const IH_PARTNERS = ['Skyro', 'Home Credit', 'Salmon', 'Billease', 'PayJoy', 'Tonik', 'Credit Card'];
const IH_METHODS  = ['GCash', 'Bank Transfer', 'Cash', 'Salary Deduction', 'Other'];
const IH = { ins: [], pays: [], emps: [], tab: 'verify', filter: 'all', q: '', today: '', busy: false, refBase: null, upl: null, proof: {} };

function ih_isAdmin() { return !!currentUser && currentUser.role === 'admin'; }
function ih_isStaff() { return !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'clerk'); }   // Admin + Clerk only (Clerk: payments only)
function ih_isPayer() { return ih_isStaff(); }
function ih_isEmp()   { return !!currentUser && currentUser.role === 'employee'; }
function ih_money(n) { return '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function ih_date(s) {
  if (!s) return '-';
  const p = String(s).substring(0, 10).split('-');
  if (p.length !== 3) return esc(s);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(p[1], 10) - 1] || p[1];
  return m + ' ' + parseInt(p[2], 10) + ', ' + p[0];
}
function ih_badge(st) {
  const col = { Pending: '#b45309', Verified: '#2e7d32', Rejected: '#c62828', Active: '#1565c0', Completed: '#2e7d32', Cancelled: '#6b7280', Paid: '#2e7d32', Partial: '#b45309', Overdue: '#c62828', Upcoming: '#6b7280', Approved: '#2e7d32' }[st] || '#555';
  return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;color:#fff;background:' + col + '">' + esc(st) + '</span>';
}
function ih_rand(n) { let s = ''; const c = 'abcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)]; return s; }
function ih_sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function ih_hash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
const IH_INP = 'width:100%;padding:9px;border:1px solid var(--border);border-radius:8px;box-sizing:border-box;font-size:0.9rem;background:#fff';

async function ih_load() {
  const calls = [gasRequest({ action: 'ih_getInstallments' }, 45000), gasRequest({ action: 'ih_getPayments' }, 45000)];
  if (ih_isAdmin()) calls.push(gasRequest({ action: 'ih_getEmployees' }, 45000));
  try {
    const r = await Promise.all(calls);
    if (r[0] && r[0].success) { IH.ins = r[0].data || []; IH.today = r[0].today || IH.today; } else toast((r[0] && r[0].message) || 'Could not load installments.', 'error');
    if (r[1] && r[1].success) IH.pays = r[1].data || [];
    if (r[2] && r[2].success) IH.emps = r[2].data || [];
    return true;
  } catch (e) { toast('Could not load: ' + e.message, 'error'); return false; }
}
function ih_insById(id) { return IH.ins.find(i => String(i.id) === String(id)); }

// ── photo: compress, then send in small pieces ───────────────
function ih_compress(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const W = img.naturalWidth, H = img.naturalHeight;
      if (!W || !H) { reject(new Error('Could not read this image.')); return; }
      let out = null;
      for (const dim of [1100, 900, 750, 600, 480]) {
        const sc = Math.min(1, dim / Math.max(W, H)), w = Math.max(1, Math.round(W * sc)), h = Math.max(1, Math.round(H * sc));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
        for (const q of [0.7, 0.55, 0.4]) {
          const d = cv.toDataURL('image/jpeg', q);
          out = d.split(',')[1];
          if (Math.floor(out.length * 3 / 4) <= 90000) return resolve(out);
        }
      }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image. Try another photo.')); };
    img.src = url;
  });
}

async function ih_uploadProof(b64, onProg) {
  const SZ = 3800, total = Math.ceil(b64.length / SZ);
  if (total > 80) throw new Error('The photo is too large. Try a smaller one.');
  const uploadId = ih_rand(24);
  let next = 0, done = 0, failed = null;
  async function worker() {
    while (!failed && next < total) {
      const i = next++;
      let ok = false, msg = '';
      for (let a = 0; a < 3 && !ok; a++) {
        try {
          const r = await gasPost({ action: 'ih_proofChunk', uploadId, idx: i, total, chunk: b64.substr(i * SZ, SZ) }, 30000);
          if (r && r.success) ok = true; else msg = (r && r.message) || 'Upload failed';
        } catch (e) { msg = e.message; await ih_sleep(800 * (a + 1)); }
      }
      if (!ok) { failed = new Error(msg || 'Upload failed'); return; }
      done++; if (onProg) onProg(done, total);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  if (failed) throw failed;
  return { uploadId, total };
}

// ── proof viewer ─────────────────────────────────────────────
async function ih_viewProof(payId) {
  openModal('<div class="modal-title">Proof of Payment</div><div id="ihProofBox" style="text-align:center;min-height:80px">Loading photo...</div><div style="text-align:right;margin-top:10px"><button class="btn btn-ghost btn-sm" onclick="closeModalDirect()">Close</button></div>');
  try {
    let data = IH.proof[payId];
    if (!data) {
      const r = await gasRequest({ action: 'ih_getProof', id: payId }, 60000);
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not load the photo.');
      data = r.data;
      const keys = Object.keys(IH.proof); if (keys.length >= 8) delete IH.proof[keys[0]];
      IH.proof[payId] = data;
    }
    const box = document.getElementById('ihProofBox');
    if (box) { box.innerHTML = ''; const im = document.createElement('img'); im.src = data; im.style.cssText = 'max-width:100%;max-height:70vh;border-radius:8px'; box.appendChild(im); }
  } catch (e) { const box = document.getElementById('ihProofBox'); if (box) box.textContent = e.message; }
}

// ── payment modal (employee submits proof; admin can also record) ──
function ih_openPayModal(insId) {
  const ins = ih_insById(insId); if (!ins) return;
  const admin = ih_isPayer();
  const remaining = Math.max(0, Math.round((ins.balance - ins.pending) * 100) / 100);
  if (remaining <= 0) { toast('There is nothing left to pay, or the remaining balance is already waiting for verification.', 'info', 5000); return; }
  IH.upl = null; IH.refBase = 'p' + Date.now().toString(36) + ih_rand(5);
  const amt = Math.min(Number(ins.monthly), remaining);
  openModal('<div class="modal-title">' + (admin ? 'Record Payment' : 'Upload Proof of Payment') + '</div>' +
    '<div style="font-size:13px;margin-bottom:8px">' + esc(ins.itemsText) + '<br>Remaining balance: <b>' + ih_money(remaining) + '</b></div>' +
    '<div style="display:flex;gap:8px"><div class="field" style="flex:1"><label>Amount Paid (₱)</label><input id="ihPAmt" type="number" min="0" step="0.01" value="' + amt + '" style="' + IH_INP + '"></div>' +
    '<div class="field" style="flex:1"><label>Date Paid</label><input id="ihPDate" type="date" value="' + esc(IH.today || '') + '" style="' + IH_INP + '"></div></div>' +
    (admin ? '' : '<details id="ihPOptsBox" style="margin-bottom:10px"><summary style="cursor:pointer;font-weight:600">Where to pay (GCash / Bank / QR)</summary><div id="ihPOpts" style="margin-top:8px">Loading...</div></details>') +
    '<div class="field"><label>Payment Method</label><select id="ihPMethod" style="' + IH_INP + '">' + IH_METHODS.map(m => '<option>' + esc(m) + '</option>').join('') + '</select></div>' +
    '<div class="field"><label>Note (optional)</label><input id="ihPNote" type="text" maxlength="200" style="' + IH_INP + '"></div>' +
    '<div class="field"><label>Photo of ' + (admin ? 'proof (optional)' : 'receipt or proof (required)') + '</label>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-primary btn-sm" onclick="document.getElementById(\'ihPCam\').click()">Take Photo</button>' +
    '<button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById(\'ihPFile\').click()">Choose from Gallery</button></div>' +
    '<input id="ihPCam" type="file" accept="image/*" capture="environment" style="display:none" onchange="ih_onPhoto(this)">' +
    '<input id="ihPFile" type="file" accept="image/*" style="display:none" onchange="ih_onPhoto(this)">' +
    '<div id="ihPPrev" style="margin-top:8px"></div></div>' +
    '<div id="ihPProg" style="font-size:13px;margin:6px 0"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" id="ihPCancel" onclick="closeModalDirect()">Cancel</button><button class="btn btn-primary" id="ihPGo" onclick="ih_submitPay(\'' + esc(ins.id) + '\')">' + (admin ? 'Record' : 'Submit Payment') + '</button></div>');
  if (!admin) ih_fillPayOpts();
}
function ih_fillPayOpts() { ih_loadOpts(false).then(() => { const b = document.getElementById('ihPOpts'); if (b) b.innerHTML = ih_optsHtml(); }); }
function ih_onPhoto(input) {
  const f = input.files && input.files[0]; input.value = '';
  if (!f) return;
  if (!/^image\//.test(f.type || '')) { toast('Please choose an image.', 'error'); return; }
  IH.upl = { file: f, b64: null, uploadId: null, total: 0 };
  const prev = document.getElementById('ihPPrev');
  if (prev) { prev.innerHTML = ''; const im = document.createElement('img'); im.src = URL.createObjectURL(f); im.style.cssText = 'max-width:100%;max-height:200px;border-radius:8px;border:1px solid var(--border)'; prev.appendChild(im); }
}
async function ih_submitPay(insId) {
  if (IH.busy) return;
  const g = id => document.getElementById(id), v = id => (g(id) || {}).value;
  const ins = ih_insById(insId); if (!ins) return;
  const amount = Math.round(parseFloat(v('ihPAmt')) * 100) / 100, date = v('ihPDate');
  if (!(amount > 0)) { toast('Enter the amount paid.', 'error'); return; }
  if (!date) { toast('Enter the date paid.', 'error'); return; }
  const remaining = Math.round((ins.balance - ins.pending) * 100) / 100;
  if (amount > remaining + 0.005) { toast('The amount is more than the remaining balance (' + ih_money(remaining) + ').', 'error'); return; }
  const needPhoto = !ih_isPayer();
  if (needPhoto && !IH.upl) { toast('Please attach a photo of your proof of payment.', 'error'); return; }
  IH.busy = true;
  const go = g('ihPGo'), cancel = g('ihPCancel'), prog = g('ihPProg');
  if (go) { go.disabled = true; go.classList.add('ih-busy'); } if (cancel) cancel.disabled = true;
  try {
    let up = null;
    if (IH.upl) {
      if (!IH.upl.uploadId) {
        ih_setProg(prog, 'Preparing photo...', 5);
        IH.upl.b64 = await ih_compress(IH.upl.file);
        const r = await ih_uploadProof(IH.upl.b64, (d, t) => { ih_setProg(prog, 'Uploading photo ' + d + ' of ' + t + '... please do not close this window.', 10 + Math.round(80 * d / t)); });
        IH.upl.uploadId = r.uploadId; IH.upl.total = r.total;
      }
      up = IH.upl;
    }
    ih_setProg(prog, 'Saving payment...', 95);
    const payload = { action: 'ih_submitPayment', installmentId: ins.id, amount, paidDate: date, method: v('ihPMethod'), note: (v('ihPNote') || '').trim(),
      clientRef: IH.refBase + '-' + ih_hash([ins.id, amount, date, v('ihPMethod'), up ? up.uploadId : ''].join('|')) };
    if (up) { payload.uploadId = up.uploadId; payload.chunks = up.total; }
    const res = await gasPost(payload, 60000);
    if (res && res.success) {
      IH.upl = null; IH.refBase = null;
      closeModalDirect();
      toast(ih_isPayer() ? 'Payment recorded.' : 'Payment submitted. Please wait for verification.', 'success', 5000);
      await ih_refreshCurrent();
    } else {
      if (prog) prog.innerHTML = '<span style="color:#c62828">' + esc((res && res.message) || 'Could not save the payment.') + '</span>';
      if (go) { go.disabled = false; go.classList.remove('ih-busy'); } if (cancel) cancel.disabled = false;
    }
  } catch (e) {
    if (prog) prog.innerHTML = '<span style="color:#c62828">' + esc(e.message) + ' You can press the button again to retry.</span>';
    if (go) { go.disabled = false; go.classList.remove('ih-busy'); } if (cancel) cancel.disabled = false;
  } finally { IH.busy = false; }
}
async function ih_refreshCurrent() {
  await ih_load();
  if (ih_isEmp()) ih_drawMy(); else ih_drawAdminTab();
}

// ═════════ EMPLOYEE PAGE ═════════
async function ih_renderMy() {
  const pc = document.getElementById('pageContent');
  if (!ih_isEmp()) { pc.innerHTML = '<div class="card"><div class="card-title">Access denied</div></div>'; return; }
  pc.innerHTML = '<div class="card"><div style="opacity:.7">Loading your installments...</div>' + ih_barHtml() + '</div>';
  await ih_load();
  ih_drawMy();
}
function ih_scheduleTable(ins) {
  return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="opacity:.7;text-align:left"><td style="padding:5px">#</td><td style="padding:5px">Due Date</td><td style="padding:5px;text-align:right">Amount</td><td style="padding:5px">Status</td></tr>' +
    (ins.schedule || []).map(s => '<tr style="border-top:1px solid rgba(128,128,128,.2)"><td style="padding:5px">' + s.n + '</td><td style="padding:5px">' + ih_date(s.due) + '</td><td style="padding:5px;text-align:right">' + ih_money(s.amount) + '</td><td style="padding:5px">' + ih_badge(s.status) + '</td></tr>').join('') + '</table></div>';
}
function ih_payRows(list, showProof) {
  if (!list.length) return '<div style="opacity:.7;font-size:13px">No payments yet.</div>';
  return list.map(p => '<div style="border-top:1px solid rgba(128,128,128,.2);padding:7px 0;font-size:13px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>' + ih_money(p.amount) + '</b>' + ih_badge(p.status) + '</div>' +
    '<div style="opacity:.75">' + ih_date(p.paidDate) + ' • ' + esc(p.method) + (p.note ? ' • ' + esc(p.note) : '') + '</div>' +
    (p.status === 'Rejected' && p.reason ? '<div style="color:#c62828">Rejected: ' + esc(p.reason) + '</div>' : '') +
    (p.hasProof && showProof ? '<button class="btn btn-ghost btn-sm" style="margin-top:4px" onclick="ih_viewProof(\'' + esc(p.id) + '\')">View Photo</button>' : '') + '</div>').join('');
}
function ih_drawMy() {
  const pc = document.getElementById('pageContent');
  if (!pc || currentPage !== 'ihMy') return;
  const active = IH.ins.filter(i => i.status === 'Active');
  const owe = active.reduce((s, i) => s + i.balance, 0);
  const dues = active.map(i => i.nextDue).filter(Boolean).sort();
  const overdue = active.reduce((s, i) => s + i.overdueCount, 0);
  const card = (t, v, sub, bad) => '<div style="flex:1;min-width:140px;border:1px solid var(--border);border-radius:10px;padding:10px"><div style="font-size:12px;opacity:.7">' + t + '</div><div style="font-size:20px;font-weight:800;' + (bad ? 'color:#c62828' : '') + '">' + v + '</div>' + (sub ? '<div style="font-size:11px;opacity:.65">' + sub + '</div>' : '') + '</div>';
  pc.innerHTML = '<div style="margin-bottom:10px"><button class="btn btn-ghost btn-sm" onclick="ih_openHowToPay()">How to Pay (GCash / Bank / QR)</button></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">' + card('Total Balance', ih_money(owe)) + card('Next Due Date', dues.length ? ih_date(dues[0]) : '-', '', dues.length && dues[0] < IH.today) + card('Overdue Payments', overdue, '', overdue > 0) + '</div>' +
    (IH.ins.length ? IH.ins.map(i => {
      const pays = IH.pays.filter(p => String(p.installmentId) === String(i.id));
      const pct = i.totalDue > 0 ? Math.min(100, Math.round(i.paid / i.totalDue * 100)) : 0;
      return '<div class="card" style="margin-bottom:14px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div class="card-title" style="margin:0">' + esc(i.itemsText) + '</div>' + ih_badge(i.status) + '</div>' +
        '<div style="font-size:12px;opacity:.7;margin:4px 0 8px">' + esc(i.id) + ' • started ' + ih_date(i.createdAt) + '</div>' +
        '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:13px;margin-bottom:8px"><span>Price <b>' + ih_money(i.totalPrice) + '</b></span><span>Down Payment <b>' + ih_money(i.downPayment) + '</b></span><span>Monthly <b>' + ih_money(i.monthly) + '</b> x ' + esc(i.term) + '</span><span>Computed by <b>' + esc(i.computedBy) + '</b></span></div>' +
        '<div style="background:rgba(128,128,128,.2);border-radius:8px;height:10px;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:#2e7d32"></div></div>' +
        '<div style="display:flex;justify-content:space-between;font-size:13px;margin:4px 0 10px"><span>Paid ' + ih_money(i.paid) + (i.pending > 0 ? ' (+' + ih_money(i.pending) + ' waiting for verification)' : '') + '</span><span>Balance <b>' + ih_money(i.balance) + '</b></span></div>' +
        (i.status === 'Active' ? '<button class="btn btn-primary btn-sm" onclick="ih_openPayModal(\'' + esc(i.id) + '\')">Upload Payment Proof</button>' : '') +
        '<details style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">Payment Schedule</summary>' + ih_scheduleTable(i) + '</details>' +
        '<details style="margin-top:8px"' + (pays.some(p => p.status === 'Pending') ? ' open' : '') + '><summary style="cursor:pointer;font-weight:600">My Payments (' + pays.length + ')</summary>' + ih_payRows(pays, true) + '</details></div>';
    }).join('') : '<div class="card"><div style="opacity:.8">You have no installments yet. Please see your Admin once your item has been recorded.</div></div>');
}

// ═════════ ADMIN / VERIFIER PAGE ═════════
async function ih_renderAdmin() {
  const pc = document.getElementById('pageContent');
  if (!ih_isStaff()) { pc.innerHTML = '<div class="card"><div class="card-title">Access denied</div></div>'; return; }
  pc.innerHTML = '<div id="ihTabBar" class="tab-bar" style="margin-bottom:16px"></div><div id="ihContent"><div class="card"><div style="opacity:.7">Loading...</div></div></div>';
  await ih_load();
  ih_drawAdminTab();
}
function ih_setTab(t) { IH.tab = t; ih_drawAdminTab(); }
function ih_drawTabs() {
  const bar = document.getElementById('ihTabBar'); if (!bar) return;
  const pend = IH.pays.filter(p => p.status === 'Pending').length;
  const tabs = [['verify', 'Payments to Verify' + (pend ? ' (' + pend + ')' : '')], ['installments', 'Installments']];
  if (ih_isAdmin()) tabs.push(['employees', 'Employees' + (IH.emps.filter(e => e.status === 'Pending').length ? ' (' + IH.emps.filter(e => e.status === 'Pending').length + ')' : '')]);
  if (ih_isAdmin()) tabs.push(['options', 'Payment Options']);
  tabs.push(['report', 'Reports']);
  bar.innerHTML = tabs.map(t => '<button class="tab-btn' + (IH.tab === t[0] ? ' active' : '') + '" onclick="ih_setTab(\'' + t[0] + '\')">' + t[1] + '</button>').join('');
}
function ih_drawAdminTab() {
  if (currentPage !== 'ihAdmin') return;
  if ((IH.tab === 'employees' || IH.tab === 'options') && !ih_isAdmin()) IH.tab = 'verify';
  ih_drawTabs();
  const el = document.getElementById('ihContent'); if (!el) return;
  if (IH.tab === 'verify') el.innerHTML = ih_htmlVerify();
  else if (IH.tab === 'installments') el.innerHTML = ih_htmlInstallments();
  else if (IH.tab === 'employees') el.innerHTML = ih_htmlEmployees();
  else if (IH.tab === 'options' && ih_isAdmin()) { if (IH.opts) el.innerHTML = ih_htmlOptions(); else { el.innerHTML = '<div class="card"><div style="opacity:.7">Loading...</div>' + ih_barHtml() + '</div>'; ih_showOptionsTab(); } }
  else el.innerHTML = ih_htmlReport();
}

function ih_htmlVerify() {
  const pend = IH.pays.filter(p => p.status === 'Pending');
  const done = IH.pays.filter(p => p.status !== 'Pending').slice(0, 25);
  const insTxt = id => { const i = ih_insById(id); return i ? esc(i.itemsText) : ''; };
  return '<div class="card"><div class="card-title">Payments Waiting for Verification</div>' +
    (pend.length ? pend.map(p => '<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>' + esc(p.employeeName) + '</b><b>' + ih_money(p.amount) + '</b></div>' +
      '<div style="font-size:12px;opacity:.8;margin:2px 0">' + insTxt(p.installmentId) + '</div>' +
      '<div style="font-size:12px;opacity:.8">Paid ' + ih_date(p.paidDate) + ' • ' + esc(p.method) + (p.note ? ' • ' + esc(p.note) : '') + ' • sent ' + esc(safeFormatDateTime(p.submittedAt)) + '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' + (p.hasProof ? '<button class="btn btn-ghost btn-sm" onclick="ih_viewProof(\'' + esc(p.id) + '\')">View Photo</button>' : '') +
      '<button class="btn btn-primary btn-sm" onclick="ih_verify(\'' + esc(p.id) + '\')">Verify</button><button class="btn btn-danger btn-sm" onclick="ih_openReject(\'' + esc(p.id) + '\')">Reject</button></div></div>').join('') : '<div style="opacity:.7">Nothing waiting. All caught up.</div>') + '</div>' +
    '<div class="card"><div class="card-title">Recently Decided</div>' + (done.length ? done.map(p => '<div style="border-top:1px solid rgba(128,128,128,.2);padding:6px 0;font-size:13px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>' + esc(p.employeeName) + ' • ' + ih_money(p.amount) + ' • ' + ih_date(p.paidDate) + '</span><span>' + ih_badge(p.status) + ' <span style="opacity:.7;font-size:11px">by ' + esc(p.decidedBy || '') + '</span></span></div>').join('') : '<div style="opacity:.7">None yet.</div>') + '</div>';
}
async function ih_verify(id) {
  if (IH.busy) return;
  if (!confirm('Verify this payment? It will be counted toward the balance.')) return;
  IH.busy = true; showLoading('Verifying...');
  try {
    const r = await gasPost({ action: 'ih_verifyPayment', id });
    hideLoading();
    if (r && r.success) { toast('Payment verified', 'success'); await ih_refreshCurrent(); closeModalDirect(); }
    else toast((r && r.message) || 'Could not verify.', 'error', 6000);
  } catch (e) { hideLoading(); toast('Network error: ' + e.message, 'error'); }
  finally { IH.busy = false; }
}
function ih_openReject(id) {
  openModal('<div class="modal-title">Reject Payment</div><div class="field"><label>Reason (required)</label><input id="ihRjReason" type="text" maxlength="200" style="' + IH_INP + '"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn btn-ghost" onclick="closeModalDirect()">Cancel</button><button class="btn btn-danger" id="ihRjBtn" onclick="ih_doReject(\'' + esc(id) + '\')">Reject</button></div>');
}
async function ih_doReject(id) {
  const reason = ((document.getElementById('ihRjReason') || {}).value || '').trim();
  if (!reason) { toast('Please enter a reason.', 'error'); return; }
  if (IH.busy) return;
  IH.busy = true; const b = document.getElementById('ihRjBtn'); if (b) b.disabled = true; showLoading('Rejecting payment...');
  try {
    const r = await gasPost({ action: 'ih_rejectPayment', id, reason });
    if (r && r.success) { closeModalDirect(); toast('Payment rejected', 'success'); await ih_refreshCurrent(); }
    else { toast((r && r.message) || 'Could not reject.', 'error'); if (b) b.disabled = false; }
  } catch (e) { toast('Network error: ' + e.message, 'error'); if (b) b.disabled = false; }
  finally { IH.busy = false; hideLoading(); }
}

function ih_htmlInstallments() {
  const q = IH.q.toLowerCase();
  const list = IH.ins.filter(i => (IH.filter === 'all' || i.status === IH.filter) &&
    (!q || (i.employeeName + ' ' + i.employeeId + ' ' + i.itemsText + ' ' + i.branch).toLowerCase().indexOf(q) >= 0));
  return '<div class="card"><div class="card-title">In-House Installments</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><input type="text" placeholder="Search employee, ID, item or branch" value="' + esc(IH.q) + '" style="' + IH_INP + ';flex:1;min-width:180px" oninput="IH.q=this.value;ih_redrawList()">' +
    '<select style="' + IH_INP + ';width:auto" onchange="IH.filter=this.value;ih_redrawList()">' + ['all', 'Active', 'Completed', 'Cancelled'].map(s => '<option value="' + s + '"' + (IH.filter === s ? ' selected' : '') + '>' + (s === 'all' ? 'All statuses' : s) + '</option>').join('') + '</select>' +
    '<button class="btn btn-ghost btn-sm" onclick="ih_refreshCurrent()">Refresh</button>' + (ih_isAdmin() ? '<button class="btn btn-primary btn-sm" onclick="ih_openCreate()">New Installment</button>' : '') + '</div>' +
    '<div id="ihList">' + ih_listHtml(list) + '</div></div>';
}
function ih_listHtml(list) {
  if (!list.length) return '<div style="opacity:.7">No installments found.</div>';
  return list.map(i => '<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer" onclick="ih_openDetail(\'' + esc(i.id) + '\')">' +
    '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>' + esc(i.employeeName) + '</b>' + ih_badge(i.status) + '</div>' +
    '<div style="font-size:12px;opacity:.8">' + esc(i.employeeId) + ' • ' + esc(i.branch) + ' • ' + esc(i.itemsText) + '</div>' +
    '<div style="font-size:13px;margin-top:4px">Monthly ' + ih_money(i.monthly) + ' x ' + esc(i.term) + ' • Balance <b>' + ih_money(i.balance) + '</b>' + (i.status === 'Active' && i.nextDue ? ' • Next due ' + ih_date(i.nextDue) : '') +
    (i.overdueCount > 0 && i.status === 'Active' ? ' <span style="color:#c62828;font-weight:700">• ' + i.overdueCount + ' overdue</span>' : '') + '</div>' + ih_monthStrip(i) + '</div>').join('');
}
// month-by-month payment status for the Admin / Clerk list (Paid, Partial, Overdue, Upcoming)
function ih_monthStrip(i) {
  const sch = i.schedule || []; if (!sch.length) return '';
  const col = { Paid: '#2e7d32', Partial: '#ef6c00', Overdue: '#c62828', Upcoming: 'rgba(128,128,128,.35)' };
  const paidN = sch.filter(x => x.status === 'Paid').length;
  const last = IH.pays.filter(p => String(p.installmentId) === String(i.id) && p.status === 'Verified').sort((x, y) => String(y.paidDate).localeCompare(String(x.paidDate)))[0];
  return '<div style="margin-top:6px"><div style="font-size:12px;opacity:.85;margin-bottom:3px">Monthly payments: <b>' + paidN + ' of ' + sch.length + '</b> paid &bull; Paid ' + ih_money(i.paid) + (i.pending > 0 ? ' (+' + ih_money(i.pending) + ' waiting)' : '') + (last ? ' &bull; Last payment ' + ih_date(last.paidDate) : '') + '</div>' +
    '<div style="display:flex;gap:3px;flex-wrap:wrap">' + sch.map(x => '<span title="Month ' + x.n + ' - ' + esc(ih_date(x.due)) + ' - ' + esc(x.status) + '" style="width:16px;height:8px;border-radius:3px;background:' + (col[x.status] || col.Upcoming) + '"></span>').join('') + '</div></div>';
}
function ih_redrawList() {
  const q = IH.q.toLowerCase();
  const list = IH.ins.filter(i => (IH.filter === 'all' || i.status === IH.filter) && (!q || (i.employeeName + ' ' + i.employeeId + ' ' + i.itemsText + ' ' + i.branch).toLowerCase().indexOf(q) >= 0));
  const el = document.getElementById('ihList'); if (el) el.innerHTML = ih_listHtml(list);
}
function ih_openDetail(id) {
  const i = ih_insById(id); if (!i) return;
  const pays = IH.pays.filter(p => String(p.installmentId) === String(i.id));
  const row = (k, v) => '<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;font-size:13px"><span style="opacity:.75">' + k + '</span><span style="text-align:right">' + v + '</span></div>';
  let items = []; try { items = JSON.parse(i.items || '[]'); } catch (e) {}
  openModal('<div class="modal-title">' + esc(i.employeeName) + '</div><div style="margin-bottom:6px">' + ih_badge(i.status) + '</div>' +
    row('Employee ID', esc(i.employeeId)) + row('Branch', esc(i.branch)) + row('Installment', esc(i.id)) +
    '<hr style="margin:6px 0;border:none;border-top:1px solid var(--border)">' +
    items.map(x => row(esc(x.name) + ' x' + esc(x.qty), ih_money(x.qty * x.price))).join('') +
    row('<b>Total Price</b>', '<b>' + ih_money(i.totalPrice) + '</b>') + row('Down Payment', ih_money(i.downPayment)) + row('Financed', ih_money(i.financed)) +
    row('Monthly Payment', ih_money(i.monthly) + ' x ' + esc(i.term)) + row('Total Payable', ih_money(i.totalPayable)) +
    row('Computed by', esc(i.computedBy)) + (i.basis ? row('Basis', esc(i.basis)) : '') + (i.notes ? row('Notes', esc(i.notes)) : '') +
    row('First Due Date', ih_date(i.startDate)) + row('Paid (verified)', ih_money(i.paid)) + row('Waiting verification', ih_money(i.pending)) + row('<b>Balance</b>', '<b>' + ih_money(i.balance) + '</b>') +
    (i.statusNote ? row('Status note', esc(i.statusNote)) : '') +
    '<details style="margin-top:8px"><summary style="cursor:pointer;font-weight:600">Payment Schedule</summary>' + ih_scheduleTable(i) + '</details>' +
    '<details style="margin-top:8px" open><summary style="cursor:pointer;font-weight:600">Payments (' + pays.length + ')</summary>' +
    (pays.length ? pays.map(p => '<div style="border-top:1px solid rgba(128,128,128,.2);padding:6px 0;font-size:13px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>' + ih_money(p.amount) + '</b>' + ih_badge(p.status) + '</div><div style="opacity:.75">' + ih_date(p.paidDate) + ' • ' + esc(p.method) + (p.note ? ' • ' + esc(p.note) : '') + (p.decidedBy ? ' • by ' + esc(p.decidedBy) : '') + '</div>' +
      (p.reason ? '<div style="color:#c62828">' + esc(p.reason) + '</div>' : '') +
      '<div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">' + (p.hasProof ? '<button class="btn btn-ghost btn-sm" onclick="ih_viewProof(\'' + esc(p.id) + '\')">View Photo</button>' : '') +
      (p.status === 'Pending' ? '<button class="btn btn-primary btn-sm" onclick="ih_verify(\'' + esc(p.id) + '\')">Verify</button><button class="btn btn-danger btn-sm" onclick="ih_openReject(\'' + esc(p.id) + '\')">Reject</button>' : '') + '</div></div>').join('') : '<div style="opacity:.7;font-size:13px">No payments yet.</div>') + '</details>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
    (ih_isPayer() && i.status === 'Active' ? '<button class="btn btn-primary btn-sm" onclick="ih_openPayModal(\'' + esc(i.id) + '\')">Record Payment</button>' : '') + (ih_isAdmin() && i.status === 'Active' ? '<button class="btn btn-danger btn-sm" onclick="ih_openCancel(\'' + esc(i.id) + '\')">Cancel Installment</button>' : '') +
    '<button class="btn btn-ghost btn-sm" onclick="closeModalDirect()">Close</button></div>');
}
function ih_openCancel(id) {
  openModal('<div class="modal-title">Cancel Installment</div><div style="font-size:12px;opacity:.8;margin-bottom:8px">Existing payments stay on record. This stops further payments.</div><div class="field"><label>Reason (required)</label><input id="ihCnReason" type="text" maxlength="300" style="' + IH_INP + '"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn btn-ghost" onclick="ih_openDetail(\'' + esc(id) + '\')">Back</button><button class="btn btn-danger" id="ihCnBtn" onclick="ih_doCancel(\'' + esc(id) + '\')">Cancel Installment</button></div>');
}
async function ih_doCancel(id) {
  const reason = ((document.getElementById('ihCnReason') || {}).value || '').trim();
  if (!reason) { toast('Please enter a reason.', 'error'); return; }
  if (IH.busy) return; IH.busy = true;
  const b = document.getElementById('ihCnBtn'); if (b) b.disabled = true; showLoading('Cancelling installment...');
  try {
    const r = await gasPost({ action: 'ih_cancelInstallment', id, reason });
    if (r && r.success) { closeModalDirect(); toast('Installment cancelled', 'success'); await ih_refreshCurrent(); }
    else { toast((r && r.message) || 'Could not cancel.', 'error'); if (b) b.disabled = false; }
  } catch (e) { toast('Network error: ' + e.message, 'error'); if (b) b.disabled = false; }
  finally { IH.busy = false; hideLoading(); }
}

// ── create installment (admin) ──
let ih_itemSeq = 0;
function ih_openCreate() {
  const emps = IH.emps.filter(e => e.status === 'Approved');
  if (!emps.length) { toast('No approved employee accounts yet. Approve a sign-up in the Employees tab first.', 'warning', 5000); return; }
  IH.refBase = 'i' + Date.now().toString(36) + ih_rand(5); ih_itemSeq = 0;
  const d = new Date(); d.setMonth(d.getMonth() + 1);
  const dueDefault = localDateStr(d);
  openModal('<div class="modal-title">New In-House Installment</div>' +
    '<div class="field"><label>Employee</label><select id="ihCEmp" style="' + IH_INP + '">' + emps.map(e => '<option value="' + esc(e.userId) + '">' + esc(e.name) + ' (' + esc(e.employeeId) + ', ' + esc(e.branch) + ')</option>').join('') + '</select></div>' +
    '<div style="font-weight:700;font-size:13px;margin:6px 0">Items taken</div><div id="ihCItems"></div>' +
    '<button type="button" class="btn btn-ghost btn-sm" onclick="ih_addItemRow()">+ Add Item</button>' +
    '<div style="display:flex;gap:8px;margin-top:10px"><div class="field" style="flex:1"><label>Down Payment (collected)</label><input id="ihCDp" type="number" min="0" step="0.01" value="0" style="' + IH_INP + '" oninput="ih_calcCreate()"></div>' +
    '<div class="field" style="flex:1"><label>Term (months)</label><input id="ihCTerm" type="number" min="1" max="60" step="1" value="6" style="' + IH_INP + '" oninput="ih_calcCreate()"></div></div>' +
    '<div style="display:flex;gap:8px"><div class="field" style="flex:1"><label>Monthly Payment (₱)</label><input id="ihCMonthly" type="number" min="0" step="0.01" style="' + IH_INP + '" oninput="ih_calcCreate()"></div>' +
    '<div class="field" style="flex:1"><label>First Due Date</label><input id="ihCStart" type="date" value="' + esc(dueDefault) + '" style="' + IH_INP + '"></div></div>' +
    '<div style="display:flex;gap:8px"><div class="field" style="flex:1"><label>Computed by</label><select id="ihCBy" style="' + IH_INP + '" onchange="ih_calcCreate()">' + IH_PARTNERS.map(p => '<option>' + esc(p) + '</option>').join('') + '<option value="__other">Other (type below)</option></select></div>' +
    '<div class="field" style="flex:1" id="ihCByWrap"><label>Other: name</label><input id="ihCByOther" type="text" maxlength="60" style="' + IH_INP + '" placeholder="Person or company"></div></div>' +
    '<div class="field"><label>Basis of computation</label><input id="ihCBasis" type="text" maxlength="300" style="' + IH_INP + '" placeholder="e.g. Skyro quotation ref, rate used"></div>' +
    '<div class="field"><label>Notes (optional)</label><input id="ihCNotes" type="text" maxlength="300" style="' + IH_INP + '"></div>' +
    '<div id="ihCSum" style="font-size:13px;background:#f8fbff;border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:10px"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" onclick="closeModalDirect()">Cancel</button><button class="btn btn-primary" id="ihCGo" onclick="ih_submitCreate()">Create Installment</button></div>');
  ih_addItemRow(); ih_calcCreate();
}
function ih_addItemRow() {
  const box = document.getElementById('ihCItems'); if (!box) return;
  const n = ++ih_itemSeq, d = document.createElement('div');
  d.id = 'ihRow' + n; d.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center';
  d.innerHTML = '<input class="ihIName" type="text" maxlength="120" placeholder="Item name" style="' + IH_INP + ';flex:3" oninput="ih_calcCreate()">' +
    '<input class="ihIQty" type="number" min="1" step="1" value="1" style="' + IH_INP + ';flex:1;min-width:52px" oninput="ih_calcCreate()">' +
    '<input class="ihIPrice" type="number" min="0" step="0.01" placeholder="Price" style="' + IH_INP + ';flex:2" oninput="ih_calcCreate()">' +
    '<button type="button" class="btn btn-ghost btn-sm" onclick="this.parentNode.remove();ih_calcCreate()">x</button>';
  box.appendChild(d);
}
function ih_readItems() {
  return Array.from(document.querySelectorAll('#ihCItems > div')).map(r => ({
    name: r.querySelector('.ihIName').value.trim(), qty: parseFloat(r.querySelector('.ihIQty').value) || 0, price: parseFloat(r.querySelector('.ihIPrice').value) || 0
  })).filter(x => x.name || x.price);
}
function ih_calcCreate() {
  const w = document.getElementById('ihCByWrap'), by = document.getElementById('ihCBy');
  if (w && by) w.style.display = by.value === '__other' ? 'block' : 'none';
  const sum = document.getElementById('ihCSum'); if (!sum) return;
  const items = ih_readItems(), total = Math.round(items.reduce((s, x) => s + x.qty * x.price, 0) * 100) / 100;
  const dp = parseFloat((document.getElementById('ihCDp') || {}).value) || 0, term = parseInt((document.getElementById('ihCTerm') || {}).value, 10) || 0, mo = parseFloat((document.getElementById('ihCMonthly') || {}).value) || 0;
  const fin = Math.round((total - dp) * 100) / 100, payable = Math.round((dp + mo * term) * 100) / 100;
  let warn = '';
  if (total > 0 && dp >= total) warn = 'Down payment must be less than the total price.';
  else if (term > 0 && mo > 0 && mo * term < fin - 0.5) warn = 'Monthly x term is less than the financed amount.';
  sum.innerHTML = 'Total Price <b>' + ih_money(total) + '</b> • Financed <b>' + ih_money(Math.max(0, fin)) + '</b><br>Total Payable (DP + monthly x term) <b>' + ih_money(payable) + '</b>' +
    (mo > 0 && term > 0 && fin > 0 ? ' • Difference vs price <b>' + ih_money(payable - total) + '</b>' : '') + (warn ? '<div style="color:#c62828;margin-top:4px">' + esc(warn) + '</div>' : '');
}
async function ih_submitCreate() {
  if (IH.busy) return;
  const v = id => (document.getElementById(id) || {}).value;
  const items = ih_readItems();
  if (!items.length || items.some(x => !x.name || !(x.qty > 0))) { toast('Complete every item (name and quantity).', 'error'); return; }
  const by = v('ihCBy') === '__other' ? (v('ihCByOther') || '').trim() : v('ihCBy');
  if (!by) { toast('Enter who computed this.', 'error'); return; }
  const total = Math.round(items.reduce((s, x) => s + x.qty * x.price, 0) * 100) / 100;
  const dp = parseFloat(v('ihCDp')) || 0, term = parseInt(v('ihCTerm'), 10), mo = parseFloat(v('ihCMonthly'));
  if (!(total > 0)) { toast('Enter the item prices.', 'error'); return; }
  if (dp >= total) { toast('Down payment must be less than the total price.', 'error'); return; }
  if (!(term >= 1 && term <= 60)) { toast('Term must be 1 to 60 months.', 'error'); return; }
  if (!(mo > 0)) { toast('Enter the monthly payment.', 'error'); return; }
  if (mo * term < (total - dp) - 0.5) { toast('Monthly x term is less than the financed amount.', 'error'); return; }
  if (!v('ihCStart')) { toast('Enter the first due date.', 'error'); return; }
  const payload = { action: 'ih_createInstallment', userId: v('ihCEmp'), items: JSON.stringify(items), downPayment: dp, term, monthly: mo, computedBy: by,
    basis: (v('ihCBasis') || '').trim(), notes: (v('ihCNotes') || '').trim(), startDate: v('ihCStart') };
  payload.clientRef = IH.refBase + '-' + ih_hash(JSON.stringify([payload.userId, payload.items, dp, term, mo, payload.startDate]));
  IH.busy = true; const b = document.getElementById('ihCGo'); if (b) b.disabled = true; showLoading('Creating installment...');
  try {
    const r = await gasPost(payload);
    if (r && r.success) { IH.refBase = null; closeModalDirect(); toast('Installment created', 'success'); IH.tab = 'installments'; await ih_refreshCurrent(); }
    else { toast((r && r.message) || 'Could not create.', 'error', 6000); if (b) b.disabled = false; }
  } catch (e) { toast('Network error. Check the list before trying again, it may have saved.', 'error', 6000); if (b) b.disabled = false; }
  finally { IH.busy = false; hideLoading(); }
}

// ── employees tab (admin) ──
function ih_htmlEmployees() {
  const sec = (title, list, acts) => '<div class="card"><div class="card-title">' + title + '</div>' + (list.length ? list.map(e =>
    '<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>' + esc(e.name) + '</b>' + ih_badge(e.status) + '</div>' +
    '<div style="font-size:12px;opacity:.85">Employee ID <b>' + esc(e.employeeId) + '</b> • ' + esc(e.branch) + (e.contact ? ' • ' + esc(e.contact) : '') + ' • signed up ' + esc(safeFormatDateTime(e.createdAt)) + '</div>' +
    (e.reason ? '<div style="font-size:12px;color:#c62828">Reason: ' + esc(e.reason) + '</div>' : '') +
    '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">' + acts(e) + '</div></div>').join('') : '<div style="opacity:.7">None.</div>') + '</div>';
  const emps = IH.emps;
  return sec('Waiting for Approval', emps.filter(e => e.status === 'Pending'), e => '<button class="btn btn-primary btn-sm" onclick="ih_decideEmp(\'' + esc(e.userId) + '\',\'Approved\')">Approve</button><button class="btn btn-danger btn-sm" onclick="ih_openEmpReject(\'' + esc(e.userId) + '\')">Reject</button>') +
    sec('Approved Employees', emps.filter(e => e.status === 'Approved'), e => '<button class="btn btn-ghost btn-sm" onclick="ih_openEmpReject(\'' + esc(e.userId) + '\')">Deactivate</button>') +
    sec('Rejected', emps.filter(e => e.status === 'Rejected'), e => '<button class="btn btn-ghost btn-sm" onclick="ih_decideEmp(\'' + esc(e.userId) + '\',\'Approved\')">Approve Instead</button>');
}
async function ih_decideEmp(userId, decision, reason) {
  if (IH.busy) return;
  if (decision === 'Approved' && !confirm('Approve this employee? They will be able to log in.')) return;
  IH.busy = true; showLoading('Saving...');
  try {
    const r = await gasPost({ action: 'ih_decideEmployee', userId, decision, reason: reason || '' });
    hideLoading();
    if (r && r.success) { closeModalDirect(); toast('Employee ' + decision.toLowerCase(), 'success'); await ih_refreshCurrent(); }
    else toast((r && r.message) || 'Could not save.', 'error');
  } catch (e) { hideLoading(); toast('Network error: ' + e.message, 'error'); }
  finally { IH.busy = false; }
}
function ih_openEmpReject(userId) {
  openModal('<div class="modal-title">Reject or Deactivate Employee</div><div class="field"><label>Reason (required)</label><input id="ihErReason" type="text" maxlength="200" style="' + IH_INP + '"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn btn-ghost" onclick="closeModalDirect()">Cancel</button><button class="btn btn-danger" onclick="ih_submitEmpReject(\'' + esc(userId) + '\')">Confirm</button></div>');
}
function ih_submitEmpReject(userId) {
  const reason = ((document.getElementById('ihErReason') || {}).value || '').trim();
  if (!reason) { toast('Please enter a reason.', 'error'); return; }
  ih_decideEmp(userId, 'Rejected', reason);
}

// ── reports ──
function ih_htmlReport() {
  const active = IH.ins.filter(i => i.status === 'Active');
  const sum = (a, k) => a.reduce((s, x) => s + (Number(x[k]) || 0), 0);
  const outstanding = sum(active, 'balance'), collected = IH.pays.filter(p => p.status === 'Verified').reduce((s, p) => s + Number(p.amount || 0), 0);
  const overdueIns = active.filter(i => i.overdueCount > 0);
  const card = (t, v, s, bad) => '<div style="flex:1;min-width:150px;border:1px solid var(--border);border-radius:10px;padding:10px"><div style="font-size:12px;opacity:.7">' + t + '</div><div style="font-size:20px;font-weight:800;' + (bad ? 'color:#c62828' : '') + '">' + v + '</div>' + (s ? '<div style="font-size:11px;opacity:.65">' + s + '</div>' : '') + '</div>';
  const byBranch = {};
  active.forEach(i => { const b = i.branch || '-'; (byBranch[b] = byBranch[b] || { n: 0, bal: 0 }); byBranch[b].n++; byBranch[b].bal += i.balance; });
  const rows = Object.keys(byBranch).sort().map(b => '<tr style="border-top:1px solid rgba(128,128,128,.2)"><td style="padding:6px">' + esc(b) + '</td><td style="padding:6px;text-align:right">' + byBranch[b].n + '</td><td style="padding:6px;text-align:right">' + ih_money(byBranch[b].bal) + '</td></tr>').join('');
  const od = overdueIns.sort((a, b) => b.overdueCount - a.overdueCount).slice(0, 15).map(i => '<div style="border-top:1px solid rgba(128,128,128,.2);padding:6px 0;font-size:13px;cursor:pointer" onclick="ih_openDetail(\'' + esc(i.id) + '\')">' + esc(i.employeeName) + ' (' + esc(i.branch) + ') • ' + i.overdueCount + ' overdue • balance ' + ih_money(i.balance) + '</div>').join('');
  return '<div class="card"><div class="card-title">In-House Installment Reports</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
    card('Active Installments', active.length, IH.ins.filter(i => i.status === 'Completed').length + ' completed') + card('Total Outstanding', ih_money(outstanding)) +
    card('Total Collected (verified)', ih_money(collected)) + card('Awaiting Verification', IH.pays.filter(p => p.status === 'Pending').length) + card('With Overdue Payments', overdueIns.length, '', overdueIns.length > 0) + '</div>' +
    '<div style="font-weight:700;margin:8px 0 4px">By Branch (active)</div><table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="opacity:.7"><td style="padding:6px">Branch</td><td style="padding:6px;text-align:right">Installments</td><td style="padding:6px;text-align:right">Outstanding</td></tr>' + (rows || '<tr><td style="padding:6px;opacity:.7" colspan="3">No active installments.</td></tr>') + '</table>' +
    '<div style="font-weight:700;margin:14px 0 4px">Overdue</div>' + (od || '<div style="opacity:.7;font-size:13px">No overdue payments.</div>') + '</div>' + ih_htmlMonthly();
}
// Monthly collection monitor (Admin + Clerk): who is due in a chosen month and whether it is paid
IH.repMonth = '';
function ih_setRepMonth(v) { IH.repMonth = /^\d{4}-\d{2}$/.test(v) ? v : ''; if (IH.tab === 'report') ih_drawAdminTab(); }
function ih_htmlMonthly() {
  const month = IH.repMonth || String(IH.today || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return '';
  const rows = [];
  IH.ins.forEach(i => { if (i.status === 'Cancelled') return; (i.schedule || []).forEach(x => { if (String(x.due).slice(0, 7) === month) rows.push({ i, x }); }); });
  rows.sort((p, q) => String(p.x.due).localeCompare(String(q.x.due)) || String(p.i.employeeName).localeCompare(String(q.i.employeeName)));
  const due = rows.reduce((t, r) => t + Number(r.x.amount || 0), 0);
  const paidN = rows.filter(r => r.x.status === 'Paid').length;
  const late = rows.filter(r => r.x.status === 'Overdue').length;
  const line = r => '<tr style="border-top:1px solid rgba(128,128,128,.2);cursor:pointer" onclick="ih_openDetail(\'' + esc(r.i.id) + '\')"><td style="padding:6px">' + esc(r.i.employeeName) + '<div style="font-size:11px;opacity:.65">' + esc(r.i.branch) + '</div></td><td style="padding:6px">' + ih_date(r.x.due) + '</td><td style="padding:6px;text-align:right">' + ih_money(r.x.amount) + '<div style="font-size:11px;opacity:.65">#' + esc(r.x.n) + ' of ' + esc(r.i.term) + '</div></td><td style="padding:6px">' + ih_badge(r.x.status) + '</td></tr>';
  return '<div class="card" style="margin-top:14px"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center"><div class="card-title" style="margin:0">Monthly Collection Monitor</div>' +
    '<input type="month" value="' + esc(month) + '" onchange="ih_setRepMonth(this.value)" style="' + IH_INP + ';width:auto"></div>' +
    '<div style="font-size:13px;margin:8px 0">' + rows.length + ' due &bull; Expected <b>' + ih_money(due) + '</b> &bull; Paid <b>' + paidN + '</b> of ' + rows.length + (late ? ' &bull; <span style="color:#c62828;font-weight:700">' + late + ' overdue</span>' : '') + '</div>' +
    (rows.length ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="opacity:.7;text-align:left"><td style="padding:6px">Employee</td><td style="padding:6px">Due Date</td><td style="padding:6px;text-align:right">Amount</td><td style="padding:6px">Status</td></tr>' + rows.map(line).join('') + '</table></div>' : '<div style="opacity:.7;font-size:13px">No payments are due in this month.</div>') + '</div>';
}

// ── notifications: banner and chime (reuses the existing incentive chime and banner) ──
let ih_notifyTimer = null, ih_notifyState = null;
async function ih_notifyCheck() {
  if (!currentUser || (!ih_isStaff() && !ih_isEmp())) return;
  if (document.hidden && ih_isEmp()) return;
  let r;
  try { r = await gasRequest({ action: 'ih_getPayments' }); } catch (e) { return; }
  if (!r || !r.success || !currentUser) return;
  const pays = r.data || [], uid = String(currentUser.id || currentUser.username || '');
  const baseline = !ih_notifyState || ih_notifyState.user !== uid;
  if (baseline) ih_notifyState = { user: uid, pending: new Set(), status: {} };
  const st = ih_notifyState;
  if (ih_isStaff()) {
    const pend = pays.filter(p => p.status === 'Pending');
    const fresh = baseline ? [] : pend.filter(p => !st.pending.has(p.id));
    st.pending = new Set(pend.map(p => p.id));
    if (fresh.length) {
      try { inc_notifyPlay(); } catch (e) {}
      fresh.slice(0, 3).forEach(p => inc_banner(p.employeeName, 'Sent a payment of ' + ih_money(p.amount) + ' for verification', 'info', 9000, 'ihAdmin'));
      if (fresh.length > 3) inc_banner('In-House Installment', (fresh.length - 3) + ' more payments waiting for verification', 'info', 9000, 'ihAdmin');
    }
  } else {
    const changed = [];
    pays.forEach(p => { const prev = st.status[p.id]; if (!baseline && prev === 'Pending' && p.status !== 'Pending') changed.push(p); st.status[p.id] = p.status; });
    if (changed.length) {
      try { inc_notifyPlay(); } catch (e) {}
      changed.slice(0, 3).forEach(p => inc_banner(p.decidedBy || 'In-House Installment', 'Your payment of ' + ih_money(p.amount) + ' was ' + p.status.toLowerCase() + (p.reason ? ': ' + p.reason : ''), p.status === 'Verified' ? 'success' : 'warning', 10000, 'ihMy'));
    }
    if (baseline) ih_dueReminder();
  }
}
// once a day on login: payments due within 3 days or overdue
async function ih_dueReminder() {
  try {
    const key = 'ih_due_' + localDateStr(new Date());
    if (lsGet(key, false)) return;
    const r = await gasRequest({ action: 'ih_getInstallments' });
    if (!r || !r.success) return;
    const today = r.today || localDateStr(new Date());
    const soon = new Date(today + 'T00:00:00'); soon.setDate(soon.getDate() + 3);
    const lim = localDateStr(soon);
    const act = (r.data || []).filter(i => i.status === 'Active' && i.nextDue);
    const over = act.filter(i => i.overdueCount > 0), due = act.filter(i => i.overdueCount === 0 && i.nextDue <= lim);
    if (over.length) inc_banner('Payment Overdue', 'You have an overdue installment payment. Please pay and upload your proof.', 'warning', 12000, 'ihMy');
    else if (due.length) inc_banner('Payment Reminder', 'An installment payment is due on ' + ih_date(due[0].nextDue) + '.', 'info', 12000, 'ihMy');
    if (over.length || due.length) lsSet(key, true);
  } catch (e) {}
}
function ih_notifyStart() {
  ih_notifyStop();
  if (!currentUser || (!ih_isStaff() && !ih_isEmp())) return;
  ih_notifyCheck();
  ih_notifyTimer = setInterval(ih_notifyCheck, 50000 + Math.floor(Math.random() * 6000));
}
function ih_notifyStop() { if (ih_notifyTimer) { clearInterval(ih_notifyTimer); ih_notifyTimer = null; } ih_notifyState = null; }
(function () {
  const s0 = inc_notifyStart, p0 = inc_notifyStop;
  inc_notifyStart = function () { try { s0.apply(this, arguments); } catch (e) {} ih_notifyStart(); };
  inc_notifyStop  = function () { try { p0.apply(this, arguments); } catch (e) {} ih_notifyStop(); };
})();

// ── login screen: employee sign-up (added from here so index.html stays untouched) ──
function ih_showSignup() {
  document.querySelectorAll('#loginScreen .login-card').forEach(c => { c.style.display = 'none'; });
  const p = document.getElementById('ihSignupPanel'); if (p) p.style.display = 'block';
  ['ihName', 'ihEmpId', 'ihUser', 'ihContact', 'ihPass', 'ihPass2'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ih_signupMsg('', '');
}
function ih_hideSignup() {
  const p = document.getElementById('ihSignupPanel'); if (p) p.style.display = 'none';
  const lc = document.querySelector('#loginScreen .login-card'); if (lc) lc.style.display = 'block';
}
function ih_signupMsg(msg, type) {
  const el = document.getElementById('ihSignupMsg'); if (!el) return;
  el.textContent = msg; el.style.color = type === 'error' ? 'var(--red,#ef4444)' : type === 'ok' ? 'var(--green,#059669)' : 'var(--text3,#6b7280)';
}
async function ih_doSignup() {
  const v = id => ((document.getElementById(id) || {}).value || '').trim();
  const name = v('ihName'), empId = v('ihEmpId').toUpperCase(), user = v('ihUser').toLowerCase(), branch = (document.getElementById('ihBranch') || {}).value || '', contact = v('ihContact');
  const pass = (document.getElementById('ihPass') || {}).value || '', pass2 = (document.getElementById('ihPass2') || {}).value || '';
  if (!name) { ih_signupMsg('Full name is required.', 'error'); return; }
  if (!/^[A-Z0-9\-]{3,20}$/.test(empId)) { ih_signupMsg('Enter your Employee ID (letters, numbers or dashes).', 'error'); return; }
  if (!/^[a-z0-9._]{3,30}$/.test(user)) { ih_signupMsg('Username: 3-30 letters, numbers, dots or underscores.', 'error'); return; }
  if (!branch) { ih_signupMsg('Please select your branch.', 'error'); return; }
  if (contact && !/^[0-9+\- ]{7,20}$/.test(contact)) { ih_signupMsg('Contact number is invalid.', 'error'); return; }
  if (pass.length < 6) { ih_signupMsg('Password must be at least 6 characters.', 'error'); return; }
  if (pass !== pass2) { ih_signupMsg('Passwords do not match.', 'error'); return; }
  const btn = document.getElementById('ihSignupBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; btn.classList.add('ih-busy'); }
  ih_signupMsg('Creating account... please wait.', ''); ih_signupBar(true);
  try {
    const res = await gasPost({ action: 'registerEmployee', name, employeeId: empId, username: user, password: pass, branch, contact });
    if (res && res.success) {
      ih_signupMsg('Account created. Please wait for Admin approval before you can sign in.', 'ok');
      if (btn) { btn.textContent = 'Done'; }
    } else {
      ih_signupMsg((res && res.message) || 'Could not create the account.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
    }
  } catch (e) {
    ih_signupMsg('Network error. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
  } finally { ih_signupBar(false); if (btn) btn.classList.remove('ih-busy'); }
}
function ih_injectSignup() {
  try {
    const form = document.querySelector('#loginScreen .login-card .login-form');
    if (form && !document.getElementById('ihSignupLink')) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'ihSignupLink'; b.className = 'btn-link'; b.textContent = 'Employee? Create an installment account';
      b.onclick = ih_showSignup; form.appendChild(b);
    }
    const screen = document.getElementById('loginScreen');
    if (screen && !document.getElementById('ihSignupPanel')) {
      const branchOpts = (document.getElementById('regBranch') || {}).innerHTML || '<option value="">Select your branch</option>';
      const d = document.createElement('div');
      d.id = 'ihSignupPanel'; d.className = 'login-card'; d.style.display = 'none';
      d.innerHTML = '<div class="login-logo"><div class="login-logo-text">AE HOME</div><p>Employee Installment Sign Up</p></div><div class="login-form">' +
        '<div class="form-group"><label for="ihName">Full Name</label><input type="text" id="ihName" placeholder="Your full name" autocomplete="off" maxlength="60"></div>' +
        '<div class="form-group"><label for="ihEmpId">Employee ID</label><input type="text" id="ihEmpId" placeholder="Your company Employee ID" autocomplete="off" maxlength="20"></div>' +
        '<div class="form-group"><label for="ihUser">Username</label><input type="text" id="ihUser" placeholder="Letters, numbers, . or _" autocomplete="off" maxlength="30"></div>' +
        '<div class="form-group"><label for="ihBranch">Branch</label><select id="ihBranch" style="width:100%;padding:11px 12px;border:1.5px solid var(--border);border-radius:8px;font-family:inherit;font-size:0.9rem;background:#fff">' + branchOpts + '</select></div>' +
        '<div class="form-group"><label for="ihContact">Contact No. (optional)</label><input type="text" id="ihContact" placeholder="09xx xxx xxxx" autocomplete="off" maxlength="20"></div>' +
        '<div class="form-group"><label for="ihPass">Password</label><input type="password" id="ihPass" placeholder="At least 6 characters" autocomplete="new-password"></div>' +
        '<div class="form-group"><label for="ihPass2">Confirm Password</label><input type="password" id="ihPass2" placeholder="Re-enter password" autocomplete="new-password"></div>' +
        '<button class="btn-login" id="ihSignupBtn" onclick="ih_doSignup()">Create Account</button>' +
        '<button type="button" class="btn-link" onclick="ih_hideSignup()">Back to Sign In</button></div>' +
        '<div id="ihSignupMsg" style="margin-top:10px;font-size:0.82rem;text-align:center;min-height:18px"></div>';
      screen.appendChild(d);
    }
  } catch (e) { console.warn('[IH] signup inject failed', e); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ih_injectSignup); else ih_injectSignup();

// ═════════ PAYMENT OPTIONS (GCash / bank + QR) ═════════
// Admin manages them; employees (and verifiers) only read them so they know where to send the payment.
const IH_OPT_TYPES = ['GCash', 'Maya', 'Bank Transfer', 'Other'];
IH.opts = null; IH.optQr = {}; IH.optUpl = null; IH.optEdit = null;
async function ih_loadOpts(force) {
  if (IH.opts && !force) return IH.opts;
  try {
    const r = await gasRequest({ action: 'ih_getPayOptions' }, 45000);
    if (r && r.success) IH.opts = r.data || []; else { toast((r && r.message) || 'Could not load payment options.', 'error'); if (!IH.opts) IH.opts = []; }
  } catch (e) { toast('Could not load payment options: ' + e.message, 'error'); if (!IH.opts) IH.opts = []; }
  return IH.opts;
}
function ih_copyText(t) {
  try { navigator.clipboard.writeText(String(t)).then(() => toast('Copied', 'success', 1500), () => toast('Could not copy. Please copy it manually.', 'error')); }
  catch (e) { toast('Could not copy. Please copy it manually.', 'error'); }
}
function ih_optCard(o, admin) {
  const row = (k, v, copy) => v ? '<div style="font-size:13px"><span style="opacity:.65">' + k + ':</span> <b>' + esc(v) + '</b>' + (copy ? ' <button type="button" class="btn btn-ghost btn-sm" style="padding:1px 8px" data-copy="' + esc(v) + '" onclick="ih_copyText(this.getAttribute(\'data-copy\'))">Copy</button>' : '') + '</div>' : '';
  return '<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px' + (o.active ? '' : ';opacity:.55') + '">' +
    '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>' + esc(o.label) + '</b><span style="font-size:12px;opacity:.75">' + esc(o.type) + (o.active ? '' : ' (hidden from employees)') + '</span></div>' +
    row('Bank', o.bankName) + row('Account Name', o.accountName) + row('Number', o.accountNumber, true) +
    (o.instructions ? '<div style="font-size:12px;opacity:.8;margin-top:4px">' + esc(o.instructions) + '</div>' : '') +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' +
    (o.hasQr ? '<button type="button" class="btn btn-primary btn-sm" onclick="ih_viewQr(\'' + esc(o.id) + '\')">View QR Code</button>' : '') +
    (admin ? '<button type="button" class="btn btn-ghost btn-sm" onclick="ih_openOptEdit(\'' + esc(o.id) + '\')">Edit</button><button type="button" class="btn btn-danger btn-sm" onclick="ih_deleteOpt(\'' + esc(o.id) + '\')">Delete</button>' : '') +
    '</div></div>';
}
function ih_optsHtml() {
  const list = (IH.opts || []).filter(o => o.active);
  return list.length ? list.map(o => ih_optCard(o, false)).join('') : '<div style="opacity:.75;font-size:13px">No online payment details have been set up yet. Please ask your Admin.</div>';
}
async function ih_viewQr(id) {
  openModal('<div class="modal-title">QR Code</div><div id="ihQrBox" style="text-align:center;min-height:80px">Loading...</div><div style="text-align:right;margin-top:10px"><button class="btn btn-ghost btn-sm" onclick="closeModalDirect()">Close</button></div>');
  try {
    let data = IH.optQr[id];
    if (!data) {
      const r = await gasRequest({ action: 'ih_getPayQr', id }, 60000);
      if (!r || !r.success) throw new Error((r && r.message) || 'Could not load the QR code.');
      data = r.data; const ks = Object.keys(IH.optQr); if (ks.length >= 6) delete IH.optQr[ks[0]]; IH.optQr[id] = data;
    }
    const box = document.getElementById('ihQrBox');
    if (box) { box.innerHTML = ''; const im = document.createElement('img'); im.src = data; im.style.cssText = 'max-width:100%;max-height:70vh;border-radius:8px;background:#fff'; box.appendChild(im); }
  } catch (e) { const box = document.getElementById('ihQrBox'); if (box) box.textContent = e.message; }
}
// employee: "How to Pay" window
async function ih_openHowToPay() {
  openModal('<div class="modal-title">How to Pay</div><div id="ihHowBox">Loading...</div><div style="text-align:right;margin-top:10px"><button class="btn btn-ghost btn-sm" onclick="closeModalDirect()">Close</button></div>');
  await ih_loadOpts(true);
  const box = document.getElementById('ihHowBox'); if (box) box.innerHTML = ih_optsHtml();
}
// admin tab
function ih_htmlOptions() {
  const list = IH.opts || [];
  return '<div class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><div class="card-title" style="margin:0">Payment Options for Employees</div><button class="btn btn-primary btn-sm" onclick="ih_openOptEdit(\'\')">Add Option</button></div>' +
    '<div style="font-size:12px;opacity:.75;margin-bottom:10px">Employees see these (GCash, bank, QR code) when they pay online.</div>' +
    (list.length ? list.map(o => ih_optCard(o, true)).join('') : '<div style="opacity:.75">No payment options yet. Press Add Option.</div>') + '</div>';
}
async function ih_showOptionsTab() {
  const el = document.getElementById('ihContent'); if (el && !IH.opts) el.innerHTML = '<div class="card"><div style="opacity:.7">Loading...</div>' + ih_barHtml() + '</div>';
  await ih_loadOpts(true);
  if (IH.tab === 'options' && currentPage === 'ihAdmin') { const e2 = document.getElementById('ihContent'); if (e2) e2.innerHTML = ih_htmlOptions(); }
}
function ih_openOptEdit(id) {
  if (!ih_isAdmin()) return;
  const o = id ? (IH.opts || []).find(x => x.id === id) : null; IH.optEdit = o || null; IH.optUpl = null; IH.refBase = null;
  const v = k => o ? esc(o[k] || '') : '';
  openModal('<div class="modal-title">' + (o ? 'Edit' : 'Add') + ' Payment Option</div>' +
    '<div class="field"><label>Type</label><select id="ihOType" style="' + IH_INP + '">' + IH_OPT_TYPES.map(t => '<option' + (o && o.type === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div>' +
    '<div class="field"><label>Name of this option</label><input id="ihOLabel" type="text" maxlength="60" placeholder="Example: Company GCash" value="' + v('label') + '" style="' + IH_INP + '"></div>' +
    '<div class="field"><label>Bank name (for bank transfer)</label><input id="ihOBank" type="text" maxlength="60" value="' + v('bankName') + '" style="' + IH_INP + '"></div>' +
    '<div class="field"><label>Account name</label><input id="ihOAccName" type="text" maxlength="80" value="' + v('accountName') + '" style="' + IH_INP + '"></div>' +
    '<div class="field"><label>Account / GCash number</label><input id="ihOAccNo" type="text" maxlength="40" value="' + v('accountNumber') + '" style="' + IH_INP + '"></div>' +
    '<div class="field"><label>Instructions (optional)</label><input id="ihOIns" type="text" maxlength="300" placeholder="Example: Put your Employee ID in the message" value="' + v('instructions') + '" style="' + IH_INP + '"></div>' +
    '<div class="field"><label>QR code image (optional)</label>' + (o && o.hasQr ? '<div style="font-size:12px;margin-bottom:4px">A QR code is saved. Choose a new one to replace it. <label style="margin-left:6px"><input type="checkbox" id="ihORemQr"> Remove it</label></div>' : '') +
    '<button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById(\'ihOFile\').click()">Choose QR Image</button>' +
    '<input id="ihOFile" type="file" accept="image/*" style="display:none" onchange="ih_onOptPhoto(this)"><div id="ihOPrev" style="margin-top:8px"></div></div>' +
    '<label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-bottom:8px"><input type="checkbox" id="ihOActive"' + (!o || o.active ? ' checked' : '') + '> Show to employees</label>' +
    '<div id="ihOProg" style="font-size:13px;margin:6px 0"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" id="ihOCancel" onclick="closeModalDirect()">Cancel</button><button class="btn btn-primary" id="ihOGo" onclick="ih_saveOpt()">Save</button></div>');
}
function ih_onOptPhoto(input) {
  const f = input.files && input.files[0]; input.value = '';
  if (!f) return;
  if (!/^image\//.test(f.type || '')) { toast('Please choose an image.', 'error'); return; }
  IH.optUpl = { file: f, uploadId: null, total: 0 };
  const prev = document.getElementById('ihOPrev');
  if (prev) { prev.innerHTML = ''; const im = document.createElement('img'); im.src = URL.createObjectURL(f); im.style.cssText = 'max-width:100%;max-height:200px;border-radius:8px;border:1px solid var(--border);background:#fff'; prev.appendChild(im); }
}
async function ih_saveOpt() {
  if (IH.busy || !ih_isAdmin()) return;
  const g = id => document.getElementById(id), v = id => ((g(id) || {}).value || '').trim();
  const o = IH.optEdit;
  if (!v('ihOLabel')) { toast('Enter a name for this option.', 'error'); return; }
  const hasQr = !!(IH.optUpl || (o && o.hasQr && !(g('ihORemQr') || {}).checked));
  if (!v('ihOAccNo') && !hasQr) { toast('Enter the account / GCash number, or upload a QR code.', 'error'); return; }
  IH.busy = true;
  const go = g('ihOGo'), cancel = g('ihOCancel'), prog = g('ihOProg');
  if (go) { go.disabled = true; go.classList.add('ih-busy'); } if (cancel) cancel.disabled = true;
  try {
    const payload = { action: 'ih_savePayOption', id: o ? o.id : '', type: v('ihOType'), label: v('ihOLabel'), bankName: v('ihOBank'), accountName: v('ihOAccName'), accountNumber: v('ihOAccNo'),
      instructions: v('ihOIns'), active: !!(g('ihOActive') || {}).checked, removeQr: !!(g('ihORemQr') || {}).checked, keepQr: !!(o && o.hasQr) };
    if (IH.optUpl) {
      if (!IH.optUpl.uploadId) {
        ih_setProg(prog, 'Preparing image...', 5);
        const b64 = await ih_compress(IH.optUpl.file);
        const r = await ih_uploadProof(b64, (d, t) => { ih_setProg(prog, 'Uploading image ' + d + ' of ' + t + '...', 10 + Math.round(80 * d / t)); });
        IH.optUpl.uploadId = r.uploadId; IH.optUpl.total = r.total;
      }
      payload.uploadId = IH.optUpl.uploadId; payload.chunks = IH.optUpl.total;
    }
    ih_setProg(prog, 'Saving...', 95);
    const res = await gasPost(payload, 60000);
    if (res && res.success) {
      IH.optUpl = null; IH.optEdit = null; IH.optQr = {}; closeModalDirect(); toast('Payment option saved.', 'success');
      await ih_loadOpts(true); if (IH.tab === 'options') ih_drawAdminTab();
    } else {
      if (prog) prog.innerHTML = '<span style="color:#c62828">' + esc((res && res.message) || 'Could not save.') + '</span>';
      if (go) { go.disabled = false; go.classList.remove('ih-busy'); } if (cancel) cancel.disabled = false;
    }
  } catch (e) {
    if (prog) prog.innerHTML = '<span style="color:#c62828">' + esc(e.message) + ' You can press Save to retry.</span>';
    if (go) { go.disabled = false; go.classList.remove('ih-busy'); } if (cancel) cancel.disabled = false;
  } finally { IH.busy = false; }
}
async function ih_deleteOpt(id) {
  if (!ih_isAdmin() || IH.busy) return;
  const o = (IH.opts || []).find(x => x.id === id); if (!o) return;
  if (!confirm('Delete "' + o.label + '"? Employees will no longer see it.')) return;
  IH.busy = true; showLoading('Deleting...');
  try {
    const r = await gasPost({ action: 'ih_deletePayOption', id }, 45000);
    if (r && r.success) { IH.optQr = {}; toast('Deleted.', 'success'); await ih_loadOpts(true); ih_drawAdminTab(); }
    else toast((r && r.message) || 'Could not delete.', 'error');
  } catch (e) { toast('Could not delete: ' + e.message, 'error'); } finally { IH.busy = false; hideLoading(); }
}

// ═════════ PROGRESS / LOADING ANIMATIONS (In-House only) ═════════
(function () {
  try {
    if (document.getElementById('ihProgCss')) return;
    const st = document.createElement('style'); st.id = 'ihProgCss';
    st.textContent = '.ih-track{height:8px;background:rgba(128,128,128,.22);border-radius:6px;overflow:hidden;margin-top:6px}' +
      '.ih-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,#1e90ff,#00c85a);transition:width .35s ease}' +
      '.ih-fill.ind{width:40%!important;animation:ihInd 1.1s ease-in-out infinite}' +
      '@keyframes ihInd{0%{margin-left:-40%}100%{margin-left:100%}}' +
      '@keyframes ihSpin{to{transform:rotate(360deg)}}' +
      '.ih-busy::before{content:"";display:inline-block;width:12px;height:12px;margin-right:8px;vertical-align:-2px;border:2px solid rgba(255,255,255,.5);border-top-color:#fff;border-radius:50%;animation:ihSpin .7s linear infinite}';
    document.head.appendChild(st);
  } catch (e) {}
})();
function ih_barHtml(pct) {
  const p = (typeof pct === 'number') ? Math.max(0, Math.min(100, pct)) : null;
  return '<div class="ih-track"><div class="ih-fill' + (p === null ? ' ind' : '') + '"' + (p === null ? '' : ' style="width:' + p + '%"') + '></div></div>';
}
function ih_setProg(el, label, pct) {
  if (!el) return;
  el.innerHTML = '<div>' + esc(label) + (typeof pct === 'number' ? ' (' + Math.max(0, Math.min(100, pct)) + '%)' : '') + '</div>' + ih_barHtml(pct);
}
function ih_signupBar(on) {
  const m = document.getElementById('ihSignupMsg'); if (!m) return;
  let b = document.getElementById('ihSignupBar');
  if (on) { if (!b) { b = document.createElement('div'); b.id = 'ihSignupBar'; m.insertAdjacentElement('afterend', b); } b.innerHTML = ih_barHtml(); }
  else if (b) b.remove();
}

// ═══════════════════════════════════════════════════════════
// ATTENDANCE (Admin only for now): staff roster, branch geofence + shifts, Time In/Out with selfie + GPS (+ optional device biometric)
// ═══════════════════════════════════════════════════════════
const ATT = { tab: 'today', staff: [], branches: [], today: null, logs: null, report: null, month: '', from: '', to: '', staffId: '', busy: false, stream: null, clk: null, photo: {} };
function att_fmtMin(m) { m = Math.round(Number(m) || 0); if (m <= 0) return '0m'; const h = Math.floor(m / 60), r = m % 60; return (h ? h + 'h ' : '') + (r || !h ? r + 'm' : '').trim(); }
function att_branchName(b) { const i = INC_BRANCHES.indexOf(b); return i >= 0 ? INC_BRANCHES_DISP[i] : (b || '-'); }
function att_branchOpts(sel) { return INC_BRANCHES.map((b, i) => '<option value="' + esc(b) + '"' + (b === sel ? ' selected' : '') + '>' + esc(INC_BRANCHES_DISP[i]) + '</option>').join(''); }
function att_chip(t, col) { return '<span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:11px;font-weight:700;color:#fff;background:' + (col || '#555') + ';margin:1px 3px 1px 0">' + esc(t) + '</span>'; }
function att_flags(f) { return String(f || '').split(';').map(x => x.trim()).filter(Boolean).map(x => att_chip(x, x === 'Manual' ? '#6b7280' : '#c62828')).join(''); }
function att_stopCam() { try { if (ATT.stream) ATT.stream.getTracks().forEach(t => t.stop()); } catch (e) {} ATT.stream = null; }
(function () {   // switch the camera off whenever the clock window disappears (X button, outside click, etc.)
  try {
    new MutationObserver(() => { const ov = document.getElementById('modalOverlay'); if (ATT.stream && (!document.getElementById('attVideo') || (ov && ov.classList.contains('hidden')))) att_stopCam(); })
      .observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  } catch (e) {}
})();
function att_deviceId() {
  try { let d = localStorage.getItem('att_dev'); if (!d) { d = 'D' + ih_rand(14); localStorage.setItem('att_dev', d); } return d; } catch (e) { return 'D-nostore'; }
}

async function att_renderAdmin() {
  const pc = document.getElementById('pageContent');
  if (!ih_isAdmin()) { pc.innerHTML = '<div class="card"><div class="card-title">Access denied</div></div>'; return; }
  att_stopCam();
  pc.innerHTML = '<div id="attTabBar" class="tab-bar" style="margin-bottom:16px"></div><div id="attContent"><div class="card"><div style="opacity:.7">Loading attendance...</div>' + ih_barHtml() + '</div></div>';
  await att_loadBase();
  att_drawTab();
}
async function att_loadBase() {
  try {
    const [s, b] = await Promise.all([gasRequest({ action: 'att_getStaff' }, 45000), gasRequest({ action: 'att_getBranches' }, 45000)]);
    if (s && s.success) ATT.staff = s.data || []; else toast((s && s.message) || 'Could not load staff.', 'error');
    if (b && b.success) ATT.branches = b.data || [];
  } catch (e) { toast('Could not load attendance: ' + e.message, 'error'); }
}
function att_setTab(t) { ATT.tab = t; att_drawTab(); }
function att_drawTab() {
  if (currentPage !== 'attAdmin') return;
  const bar = document.getElementById('attTabBar'), el = document.getElementById('attContent'); if (!bar || !el) return;
  const tabs = [['today', 'Today'], ['logs', 'Logs'], ['staff', 'Staff'], ['branches', 'Branches & Shifts'], ['report', 'Reports']];
  bar.innerHTML = tabs.map(t => '<button class="tab-btn' + (ATT.tab === t[0] ? ' active' : '') + '" onclick="att_setTab(\'' + t[0] + '\')">' + t[1] + '</button>').join('');
  if (ATT.tab === 'today') att_showToday();
  else if (ATT.tab === 'logs') att_showLogs();
  else if (ATT.tab === 'staff') el.innerHTML = att_htmlStaff();
  else if (ATT.tab === 'branches') el.innerHTML = att_htmlBranches();
  else if (ATT.tab === 'report') att_showReport();
}
function att_loading(msg) { const el = document.getElementById('attContent'); if (el) el.innerHTML = '<div class="card"><div style="opacity:.7">' + esc(msg || 'Loading...') + '</div>' + ih_barHtml() + '</div>'; }

// ── Today ──
async function att_showToday() {
  att_loading('Loading today...');
  try {
    const r = await gasRequest({ action: 'att_getToday' }, 45000);
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not load.');
    ATT.today = r;
  } catch (e) { const el = document.getElementById('attContent'); if (el) el.innerHTML = '<div class="card">' + esc(e.message) + ' <button class="btn btn-ghost btn-sm" onclick="att_showToday()">Retry</button></div>'; return; }
  if (ATT.tab !== 'today') return;
  const d = ATT.today.data, nIn = d.filter(x => x.status === 'In').length, nOut = d.filter(x => x.status === 'Out').length, nNot = d.filter(x => x.status === 'Not in').length, nLate = d.filter(x => x.lateMin > 0).length, nFlag = d.filter(x => x.flagged > 0).length;
  const card = (t, v, c) => '<div style="flex:1;min-width:110px;border:1px solid var(--border);border-radius:10px;padding:8px 12px;background:#fff"><div style="font-size:11px;opacity:.7">' + t + '</div><div style="font-size:20px;font-weight:800' + (c ? ';color:' + c : '') + '">' + v + '</div></div>';
  const row = x => {
    const st = x.status === 'In' ? '#2e7d32' : x.status === 'Out' ? '#1565c0' : '#6b7280';
    return '<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#fff"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">' +
      '<div><b>' + esc(x.name) + '</b> <span style="opacity:.65;font-size:12px">' + esc(x.employeeId) + ' &bull; ' + esc(att_branchName(x.branch)) + '</span></div><div>' + att_chip(x.status, st) + (x.lateMin > 0 ? att_chip('Late ' + att_fmtMin(x.lateMin), '#b45309') : '') + (x.flagged ? att_chip(x.flagged + ' flagged', '#c62828') : '') + (x.missingOut ? att_chip('Missing Time Out yesterday', '#c62828') : '') + '</div></div>' +
      '<div style="font-size:13px;margin-top:4px;opacity:.85">Shift ' + (x.shiftStart ? esc(x.shiftStart) + ' - ' + esc(x.shiftEnd || '?') : 'not set') + ' &bull; In ' + (x.firstIn || '-') + ' &bull; Out ' + (x.lastOut || '-') + ' &bull; Worked ' + att_fmtMin(x.workedMin) + '</div>' +
      '<div style="margin-top:8px"><button class="btn btn-primary btn-sm" onclick="att_openClock(\'' + esc(x.staffId) + '\',\'' + (x.status === 'In' ? 'OUT' : 'IN') + '\')">' + (x.status === 'In' ? 'Time Out' : 'Time In') + '</button></div></div>';
  };
  document.getElementById('attContent').innerHTML = '<div class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><div class="card-title" style="margin:0">Attendance Today &bull; ' + ih_date(ATT.today.date) + '</div><button class="btn btn-ghost btn-sm" onclick="att_showToday()">Refresh</button></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">' + card('Staff', d.length) + card('Timed In', nIn, '#2e7d32') + card('Timed Out', nOut, '#1565c0') + card('Not in yet', nNot) + card('Late', nLate, nLate ? '#b45309' : '') + card('Flagged', nFlag, nFlag ? '#c62828' : '') + '</div>' +
    (d.length ? d.map(row).join('') : '<div style="opacity:.75">No staff yet. Open the Staff tab and press Add Staff.</div>') + '</div>';
}

// ── Logs ──
async function att_showLogs() {
  if (!ATT.from) { const t = ATT.today ? ATT.today.date : new Date().toISOString().slice(0, 10); ATT.to = t; const d = new Date(t + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 6); ATT.from = d.toISOString().slice(0, 10); }
  att_loading('Loading logs...');
  try {
    const q = { action: 'att_getLogs', from: ATT.from, to: ATT.to }; if (ATT.staffId) q.staffId = ATT.staffId;
    const r = await gasRequest(q, 60000);
    if (!r || !r.success) throw new Error((r && r.message) || 'Could not load.');
    ATT.logs = r;
  } catch (e) { const el = document.getElementById('attContent'); if (el) el.innerHTML = '<div class="card">' + esc(e.message) + ' <button class="btn btn-ghost btn-sm" onclick="att_showLogs()">Retry</button></div>'; return; }
  if (ATT.tab === 'logs') att_drawLogs();
}
function att_drawLogs() {
  const r = ATT.logs, el = document.getElementById('attContent'); if (!r || !el) return;
  const row = o => {
    const map = (o.lat != null && o.lng != null) ? ' <a href="https://www.google.com/maps?q=' + encodeURIComponent(o.lat + ',' + o.lng) + '" target="_blank" rel="noopener noreferrer">Map</a>' : '';
    return '<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#fff' + (o.status === 'Voided' ? ';opacity:.5;text-decoration:line-through' : '') + '">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><b>' + esc(o.name) + '</b> <span style="opacity:.65;font-size:12px">' + esc(o.employeeId) + ' &bull; ' + esc(att_branchName(o.branch)) + '</span></div><div>' + att_chip(o.type === 'IN' ? 'Time In' : 'Time Out', o.type === 'IN' ? '#2e7d32' : '#1565c0') + (o.source === 'Manual' ? att_chip('Manual', '#6b7280') : '') + (o.status === 'Voided' ? att_chip('Voided', '#6b7280') : '') + '</div></div>' +
      '<div style="font-size:13px;margin-top:4px">' + ih_date(o.date) + ' ' + esc(String(o.time).substring(0, 5)) + (o.lateMin ? ' &bull; Late ' + att_fmtMin(o.lateMin) : '') + (o.type === 'OUT' ? ' &bull; Worked ' + att_fmtMin(o.workedMin) + (o.underMin ? ' &bull; Undertime ' + att_fmtMin(o.underMin) : '') : '') +
      (o.distance != null ? ' &bull; ' + o.distance + ' m from branch' : '') + (o.accuracy != null ? ' &bull; GPS &plusmn;' + o.accuracy + ' m' : '') + (o.authMethod === 'biometric' ? ' &bull; Biometric verified' : '') + map + '</div>' +
      (o.flags ? '<div style="margin-top:4px">' + att_flags(o.flags) + '</div>' : '') + (o.note ? '<div style="font-size:12px;opacity:.8;margin-top:3px">Note: ' + esc(o.note) + '</div>' : '') + (o.voidReason ? '<div style="font-size:12px;margin-top:3px">Void reason: ' + esc(o.voidReason) + '</div>' : '') +
      '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' + (o.hasPhoto ? '<button class="btn btn-ghost btn-sm" onclick="att_viewPhoto(\'' + esc(o.id) + '\')">View Selfie</button>' : '') + (o.status !== 'Voided' ? '<button class="btn btn-danger btn-sm" onclick="att_openVoid(\'' + esc(o.id) + '\')">Void</button>' : '') + '</div></div>';
  };
  el.innerHTML = '<div class="card"><div class="card-title">Attendance Logs</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:flex-end">' +
    '<div style="flex:1;min-width:130px"><label style="font-size:12px">From</label><input type="date" id="attFrom" value="' + esc(ATT.from) + '" style="' + IH_INP + '"></div>' +
    '<div style="flex:1;min-width:130px"><label style="font-size:12px">To</label><input type="date" id="attTo" value="' + esc(ATT.to) + '" style="' + IH_INP + '"></div>' +
    '<div style="flex:2;min-width:160px"><label style="font-size:12px">Staff</label><select id="attStaffSel" style="' + IH_INP + '"><option value="">All staff</option>' + ATT.staff.map(s => '<option value="' + esc(s.id) + '"' + (s.id === ATT.staffId ? ' selected' : '') + '>' + esc(s.name) + ' (' + esc(s.employeeId) + ')</option>').join('') + '</select></div>' +
    '<button class="btn btn-primary btn-sm" onclick="att_applyLogFilter()">Show</button><button class="btn btn-ghost btn-sm" onclick="att_openManual()">Add Missed Entry</button><button class="btn btn-ghost btn-sm" onclick="att_openBulk()">Bulk Entry</button></div>' +
    '<div style="font-size:12px;opacity:.7;margin-bottom:8px">' + r.total + ' entr' + (r.total === 1 ? 'y' : 'ies') + (r.total > r.data.length ? ' (showing the latest ' + r.data.length + ')' : '') + '</div>' +
    (r.data.length ? r.data.map(row).join('') : '<div style="opacity:.75">No entries for this range.</div>') + '</div>';
}
function att_applyLogFilter() {
  const f = (document.getElementById('attFrom') || {}).value, t = (document.getElementById('attTo') || {}).value;
  if (!f || !t || f > t) { toast('Choose a valid date range.', 'error'); return; }
  ATT.from = f; ATT.to = t; ATT.staffId = (document.getElementById('attStaffSel') || {}).value || ''; att_showLogs();
}
async function att_viewPhoto(id) {
  openModal('<div class="modal-title">Selfie</div><div id="attPhotoBox" style="text-align:center;min-height:80px">Loading photo...</div><div style="text-align:right;margin-top:10px"><button class="btn btn-ghost btn-sm" onclick="closeModalDirect()">Close</button></div>');
  try {
    let data = ATT.photo[id];
    if (!data) { const r = await gasRequest({ action: 'att_getPhoto', id }, 60000); if (!r || !r.success) throw new Error((r && r.message) || 'Could not load the photo.'); data = r.data; const ks = Object.keys(ATT.photo); if (ks.length >= 8) delete ATT.photo[ks[0]]; ATT.photo[id] = data; }
    const box = document.getElementById('attPhotoBox'); if (box) { box.innerHTML = ''; const im = document.createElement('img'); im.src = data; im.style.cssText = 'max-width:100%;max-height:70vh;border-radius:8px'; box.appendChild(im); }
  } catch (e) { const box = document.getElementById('attPhotoBox'); if (box) box.textContent = e.message; }
}
function att_openVoid(id) {
  openModal('<div class="modal-title">Void this entry?</div><div style="font-size:13px;margin-bottom:8px">The entry stays in the sheet but is no longer counted. This is recorded in the audit log.</div><div class="field"><label>Reason (required)</label><input id="attVoidReason" type="text" maxlength="200" style="' + IH_INP + '"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" onclick="closeModalDirect()">Cancel</button><button class="btn btn-danger" id="attVoidBtn" onclick="att_doVoid(\'' + esc(id) + '\')">Void</button></div>');
}
async function att_doVoid(id) {
  const reason = ((document.getElementById('attVoidReason') || {}).value || '').trim(); if (!reason) { toast('Enter the reason.', 'error'); return; }
  if (ATT.busy) return; ATT.busy = true; const b = document.getElementById('attVoidBtn'); if (b) b.disabled = true; showLoading('Voiding entry...');
  try { const r = await gasPost({ action: 'att_void', id, reason }, 45000); if (r && r.success) { closeModalDirect(); toast('Entry voided.', 'success'); att_drawTab(); } else { toast((r && r.message) || 'Could not void.', 'error'); if (b) b.disabled = false; } }
  catch (e) { toast('Network error: ' + e.message, 'error'); if (b) b.disabled = false; } finally { ATT.busy = false; hideLoading(); }
}
function att_openManual() {
  const t = ATT.today ? ATT.today.date : new Date().toISOString().slice(0, 10);
  openModal('<div class="modal-title">Add Missed Entry</div><div style="font-size:13px;margin-bottom:8px">Use this when someone forgot to time in or out. It is marked Manual and has no selfie.</div>' +
    '<div class="field"><label>Staff</label><select id="attMStaff" style="' + IH_INP + '">' + ATT.staff.map(s => '<option value="' + esc(s.id) + '">' + esc(s.name) + ' (' + esc(s.employeeId) + ')</option>').join('') + '</select></div>' +
    '<div class="field"><label>Type</label><select id="attMType" style="' + IH_INP + '"><option value="IN">Time In</option><option value="OUT">Time Out</option></select></div>' +
    '<div style="display:flex;gap:8px"><div class="field" style="flex:1"><label>Date</label><input id="attMDate" type="date" value="' + esc(t) + '" max="' + esc(t) + '" style="' + IH_INP + '"></div><div class="field" style="flex:1"><label>Time</label><input id="attMTime" type="time" style="' + IH_INP + '"></div></div>' +
    '<div class="field"><label>Reason (required)</label><input id="attMReason" type="text" maxlength="200" style="' + IH_INP + '"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" onclick="closeModalDirect()">Cancel</button><button class="btn btn-primary" id="attMBtn" onclick="att_saveManual()">Save</button></div>');
}
async function att_saveManual() {
  const v = id => ((document.getElementById(id) || {}).value || '').trim();
  const p = { action: 'att_addManual', staffId: v('attMStaff'), type: v('attMType'), date: v('attMDate'), time: v('attMTime'), reason: v('attMReason') };
  if (!p.staffId) { toast('Select the staff.', 'error'); return; } if (!p.date || !p.time) { toast('Enter the date and time.', 'error'); return; } if (!p.reason) { toast('Enter the reason.', 'error'); return; }
  if (ATT.busy) return; ATT.busy = true; const b = document.getElementById('attMBtn'); if (b) b.disabled = true; showLoading('Saving entry...');
  try { const r = await gasPost(p, 45000); if (r && r.success) { closeModalDirect(); toast(r.warning ? 'Entry added. ' + r.warning : 'Entry added.', r.warning ? 'warning' : 'success', r.warning ? 9000 : undefined); att_drawTab(); } else { toast((r && r.message) || 'Could not save.', 'error', 6000); if (b) b.disabled = false; } }
  catch (e) { toast('Network error. Check the logs before trying again.', 'error', 6000); if (b) b.disabled = false; } finally { ATT.busy = false; hideLoading(); }
}

// ── Staff ──
function att_htmlStaff() {
  const row = s => '<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#fff' + (s.active ? '' : ';opacity:.55') + '"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><b>' + esc(s.name) + '</b> <span style="opacity:.65;font-size:12px">' + esc(s.employeeId) + '</span></div><div>' + att_chip(s.active ? 'Active' : 'Disabled', s.active ? '#2e7d32' : '#6b7280') + '</div></div>' +
    '<div style="font-size:13px;opacity:.85;margin-top:3px">' + esc(att_branchName(s.branch)) + (s.position ? ' &bull; ' + esc(s.position) : '') + ' &bull; Shift ' + (s.shiftStart ? esc(s.shiftStart) + ' - ' + esc(s.shiftEnd || '?') : 'follows branch') + '</div>' +
    '<div style="margin-top:8px"><button class="btn btn-ghost btn-sm" onclick="att_openStaff(\'' + esc(s.id) + '\')">Edit</button> <button class="btn btn-ghost btn-sm" onclick="att_openDtr(\'' + esc(s.id) + '\')">DTR</button> ' + (s.hasLogin ? att_chip('Login: ' + esc(s.username), '#2e7d32') : att_chip('No login', '#b45309')) + '</div></div>';
  return '<div class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><div class="card-title" style="margin:0">Attendance Staff</div><button class="btn btn-primary btn-sm" onclick="att_openStaff(\'\')">Add Staff</button></div>' +
    (ATT.staff.length ? ATT.staff.map(row).join('') : '<div style="opacity:.75">No staff yet. Press Add Staff.</div>') + '</div>';
}
function att_openStaff(id) {
  const s = id ? ATT.staff.find(x => x.id === id) : null, v = k => s ? esc(s[k] || '') : '';
  openModal('<div class="modal-title">' + (s ? 'Edit' : 'Add') + ' Staff</div>' +
    '<div class="field"><label>Employee ID</label><input id="attSEid" type="text" maxlength="20" value="' + v('employeeId') + '" style="' + IH_INP + ';text-transform:uppercase"></div>' +
    '<div class="field"><label>Full name</label><input id="attSName" type="text" maxlength="80" value="' + v('name') + '" style="' + IH_INP + '"></div>' +
    '<div class="field"><label>Branch</label><select id="attSBranch" style="' + IH_INP + '">' + att_branchOpts(s ? s.branch : '') + '</select></div>' +
    '<div class="field"><label>Position (optional)</label><input id="attSPos" type="text" maxlength="60" value="' + v('position') + '" style="' + IH_INP + '"></div>' +
    '<div style="display:flex;gap:8px"><div class="field" style="flex:1"><label>Shift start (optional)</label><input id="attSStart" type="time" value="' + v('shiftStart') + '" style="' + IH_INP + '"></div><div class="field" style="flex:1"><label>Shift end (optional)</label><input id="attSEnd" type="time" value="' + v('shiftEnd') + '" style="' + IH_INP + '"></div></div>' +
    '<div style="font-size:12px;opacity:.7;margin-bottom:8px">Leave the shift empty to follow the branch shift.</div>' +
    '<div style="border-top:1px solid var(--border);padding-top:8px;margin:6px 0"><div style="font-weight:700;font-size:13px;margin-bottom:4px">Bundy login (staff uses own phone)</div>' +
    '<div class="field"><label>Username' + (s && s.hasLogin ? ' (cannot change)' : '') + '</label><input id="attSUser" type="text" maxlength="30" autocomplete="off" value="' + v('username') + '"' + (s && s.hasLogin ? ' disabled' : '') + ' style="' + IH_INP + '"></div>' +
    '<div class="field"><label>Password' + (s && s.hasLogin ? ' (leave empty to keep)' : '') + '</label><input id="attSPw" type="text" maxlength="64" autocomplete="off" style="' + IH_INP + '"></div>' +
    '<div class="field"><label>PIN, 4-6 digits' + (s && s.hasPin ? ' (leave empty to keep)' : '') + '</label><input id="attSPin" type="text" inputmode="numeric" maxlength="6" autocomplete="off" style="' + IH_INP + '"></div></div>' +
    '<label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-bottom:8px"><input type="checkbox" id="attSActive"' + (!s || s.active ? ' checked' : '') + '> Active</label>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" onclick="closeModalDirect()">Cancel</button><button class="btn btn-primary" id="attSBtn" onclick="att_saveStaff(\'' + esc(id || '') + '\')">Save</button></div>');
}
async function att_saveStaff(id) {
  const v = k => ((document.getElementById(k) || {}).value || '').trim();
  const p = { action: 'att_saveStaff', id: id || '', employeeId: v('attSEid').toUpperCase(), name: v('attSName'), branch: v('attSBranch'), position: v('attSPos'), shiftStart: v('attSStart'), shiftEnd: v('attSEnd'), active: !!(document.getElementById('attSActive') || {}).checked, username: v('attSUser'), password: v('attSPw'), pin: v('attSPin') };
  if (!p.name) { toast('Enter the full name.', 'error'); return; } if (!/^[A-Z0-9\-]{3,20}$/.test(p.employeeId)) { toast('Employee ID: 3-20 letters, numbers or dashes.', 'error'); return; }
  if ((p.shiftStart && !p.shiftEnd) || (!p.shiftStart && p.shiftEnd)) { toast('Enter both shift start and end, or leave both empty.', 'error'); return; }
  if (ATT.busy) return; ATT.busy = true; const b = document.getElementById('attSBtn'); if (b) b.disabled = true; showLoading('Saving staff...');
  try { const r = await gasPost(p, 45000); if (r && r.success) { closeModalDirect(); toast('Staff saved.', 'success'); await att_loadBase(); att_drawTab(); } else { toast((r && r.message) || 'Could not save.', 'error', 6000); if (b) b.disabled = false; } }
  catch (e) { toast('Network error. Check the list before trying again.', 'error', 6000); if (b) b.disabled = false; } finally { ATT.busy = false; hideLoading(); }
}

// ── Branches & shifts ──
function att_htmlBranches() {
  const row = (b, i) => {
    const c = ATT.branches.find(x => x.branch === b);
    return '<div style="border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:#fff"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>' + esc(INC_BRANCHES_DISP[i]) + '</b><div>' + (c && c.lat != null ? att_chip('Location set', '#2e7d32') : att_chip('No location', '#b45309')) + '</div></div>' +
      '<div style="font-size:13px;opacity:.85;margin-top:3px">' + (c && c.lat != null ? 'Radius ' + c.radius + ' m' : 'Not set: entries will be flagged') + ' &bull; Shift ' + (c && c.shiftStart ? esc(c.shiftStart) + ' - ' + esc(c.shiftEnd || '?') + ' (grace ' + c.grace + ' min)' : 'not set') + '</div>' +
      '<div style="margin-top:8px"><button class="btn btn-ghost btn-sm" onclick="att_openBranch(\'' + esc(b) + '\')">Edit</button></div></div>';
  };
  return '<div class="card"><div class="card-title">Branch Location and Shift</div><div style="font-size:12px;opacity:.75;margin-bottom:10px">Set where each branch is so we can flag entries made outside it, and the shift hours used to compute late and undertime.</div>' + INC_BRANCHES.map(row).join('') + '</div>';
}
function att_openBranch(b) {
  const c = ATT.branches.find(x => x.branch === b) || {}, v = k => (c[k] == null ? '' : esc(c[k]));
  openModal('<div class="modal-title">' + esc(att_branchName(b)) + '</div>' +
    '<div style="display:flex;gap:8px"><div class="field" style="flex:1"><label>Latitude</label><input id="attBLat" type="text" inputmode="decimal" value="' + v('lat') + '" style="' + IH_INP + '"></div><div class="field" style="flex:1"><label>Longitude</label><input id="attBLng" type="text" inputmode="decimal" value="' + v('lng') + '" style="' + IH_INP + '"></div></div>' +
    '<button type="button" class="btn btn-ghost btn-sm" onclick="att_useMyLocation()" style="margin-bottom:8px">Use my current location (stand inside the branch)</button><div id="attBGps" style="font-size:12px;margin-bottom:8px"></div>' +
    '<div class="field"><label>Allowed radius (meters)</label><input id="attBRad" type="number" min="10" max="5000" value="' + (c.radius || 100) + '" style="' + IH_INP + '"></div>' +
    '<div style="display:flex;gap:8px"><div class="field" style="flex:1"><label>Shift start</label><input id="attBStart" type="time" value="' + v('shiftStart') + '" style="' + IH_INP + '"></div><div class="field" style="flex:1"><label>Shift end</label><input id="attBEnd" type="time" value="' + v('shiftEnd') + '" style="' + IH_INP + '"></div></div>' +
    '<div class="field"><label>Lunch break length (minutes)</label><input id="attBLunch" type="number" min="0" max="240" value="' + (c.lunchMin != null ? c.lunchMin : 60) + '" style="' + IH_INP + '"><div style="font-size:12px;opacity:.7">Example 60. Counted from the staff\'s own AM Time Out, so any lunch hour works. Late for the PM Time In starts after this plus the grace. Use 0 to skip.</div></div>' +
    '<div class="field"><label>Grace period (minutes)</label><input id="attBGrace" type="number" min="0" max="120" value="' + (c.grace != null ? c.grace : 10) + '" style="' + IH_INP + '"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" onclick="closeModalDirect()">Cancel</button><button class="btn btn-primary" id="attBBtn" onclick="att_saveBranch(\'' + esc(b) + '\')">Save</button></div>');
}
function att_useMyLocation() {
  const msg = document.getElementById('attBGps'); if (!navigator.geolocation) { if (msg) msg.textContent = 'Location is not available on this device.'; return; }
  if (msg) msg.textContent = 'Getting location...';
  navigator.geolocation.getCurrentPosition(p => {
    const a = document.getElementById('attBLat'), o = document.getElementById('attBLng'); if (a) a.value = p.coords.latitude.toFixed(6); if (o) o.value = p.coords.longitude.toFixed(6);
    if (msg) msg.textContent = 'Location filled in (accuracy about ' + Math.round(p.coords.accuracy) + ' m).';
  }, e => { if (msg) msg.textContent = 'Could not get the location: ' + (e && e.message ? e.message : 'permission denied') + '.'; }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}
async function att_saveBranch(b) {
  const v = k => ((document.getElementById(k) || {}).value || '').trim();
  const p = { action: 'att_saveBranch', branch: b, lat: v('attBLat'), lng: v('attBLng'), radius: v('attBRad'), shiftStart: v('attBStart'), shiftEnd: v('attBEnd'), lunchMin: v('attBLunch'), grace: v('attBGrace') };
  if ((p.lat === '') !== (p.lng === '')) { toast('Enter both latitude and longitude, or leave both empty.', 'error'); return; }
  if ((p.shiftStart && !p.shiftEnd) || (!p.shiftStart && p.shiftEnd)) { toast('Enter both shift start and end, or leave both empty.', 'error'); return; }
  if (ATT.busy) return; ATT.busy = true; const bt = document.getElementById('attBBtn'); if (bt) bt.disabled = true; showLoading('Saving branch...');
  try { const r = await gasPost(p, 45000); if (r && r.success) { closeModalDirect(); toast('Branch saved.', 'success'); await att_loadBase(); att_drawTab(); } else { toast((r && r.message) || 'Could not save.', 'error', 6000); if (bt) bt.disabled = false; } }
  catch (e) { toast('Network error: ' + e.message, 'error'); if (bt) bt.disabled = false; } finally { ATT.busy = false; hideLoading(); }
}

// ── Reports ──
async function att_showReport() {
  if (!ATT.month) ATT.month = ((ATT.today && ATT.today.date) || new Date().toISOString().slice(0, 10)).slice(0, 7);
  att_loading('Loading report...');
  try { const r = await gasRequest({ action: 'att_getReport', month: ATT.month }, 60000); if (!r || !r.success) throw new Error((r && r.message) || 'Could not load.'); ATT.report = r; }
  catch (e) { const el = document.getElementById('attContent'); if (el) el.innerHTML = '<div class="card">' + esc(e.message) + ' <button class="btn btn-ghost btn-sm" onclick="att_showReport()">Retry</button></div>'; return; }
  if (ATT.tab !== 'report') return;
  const d = ATT.report.data, td = 'padding:6px;border-top:1px solid rgba(128,128,128,.2)';
  document.getElementById('attContent').innerHTML = '<div class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><div class="card-title" style="margin:0">Monthly Attendance Report</div><div style="display:flex;gap:8px;align-items:center"><input type="month" value="' + esc(ATT.month) + '" onchange="att_setMonth(this.value)" style="' + IH_INP + ';width:auto"><button class="btn btn-ghost btn-sm" onclick="att_exportReport()">Export CSV</button></div></div>' +
    (d.length ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="opacity:.7;text-align:left"><td style="padding:6px">Staff</td><td style="padding:6px;text-align:right">Days</td><td style="padding:6px;text-align:right">Late days</td><td style="padding:6px;text-align:right">Late</td><td style="padding:6px;text-align:right">Undertime</td><td style="padding:6px;text-align:right">Hours</td><td style="padding:6px;text-align:right">Flagged</td><td style="padding:6px;text-align:right">No Time Out</td></tr>' +
      d.map(x => '<tr><td style="' + td + '">' + esc(x.name) + '<div style="font-size:11px;opacity:.65">' + esc(x.employeeId) + ' &bull; ' + esc(att_branchName(x.branch)) + '</div></td><td style="' + td + ';text-align:right">' + x.daysPresent + '</td><td style="' + td + ';text-align:right">' + x.lateDays + '</td><td style="' + td + ';text-align:right">' + att_fmtMin(x.lateMin) + '</td><td style="' + td + ';text-align:right">' + att_fmtMin(x.underMin) + '</td><td style="' + td + ';text-align:right">' + (x.workedMin / 60).toFixed(1) + '</td><td style="' + td + ';text-align:right">' + x.flagged + '</td><td style="' + td + ';text-align:right">' + x.missingOut + '</td></tr>').join('') + '</table></div>' : '<div style="opacity:.75">No staff yet.</div>') +
    '<div style="font-size:12px;opacity:.7;margin-top:8px">Late counts the first Time In of each day. Undertime counts the last Time Out of each day. Hours are the total of all In/Out pairs. Voided entries are not counted.</div></div>';
}
function att_setMonth(m) { if (/^\d{4}-\d{2}$/.test(m)) { ATT.month = m; att_showReport(); } }
function att_csv(v) { let t = String(v == null ? '' : v); if (/^[=+\-@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; }
function att_exportReport() {
  const r = ATT.report; if (!r) return;
  const head = ['Employee ID', 'Name', 'Branch', 'Days present', 'Late days', 'Late minutes', 'Undertime minutes', 'Hours worked', 'Flagged entries', 'Days without Time Out'];
  const rows = r.data.map(x => [x.employeeId, x.name, att_branchName(x.branch), x.daysPresent, x.lateDays, x.lateMin, x.underMin, (x.workedMin / 60).toFixed(2), x.flagged, x.missingOut]);
  const csv = [head].concat(rows).map(a => a.map(att_csv).join(',')).join('\r\n');
  try {
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'attendance-' + r.month + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast('Could not export: ' + e.message, 'error'); }
}

// ── Time In / Time Out window: optional biometric + GPS + selfie with watermark ──
async function att_bioCheck() {
  try {
    if (!window.PublicKeyCredential || !window.isSecureContext || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return 'unavailable';
    if (!(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) return 'unavailable';
    const rnd = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
    let stored = null; try { stored = localStorage.getItem('att_cred'); } catch (e) {}
    if (stored) {
      const id = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
      await navigator.credentials.get({ publicKey: { challenge: rnd(32), allowCredentials: [{ id, type: 'public-key' }], userVerification: 'required', timeout: 60000 } });
      return 'biometric';
    }
    const cred = await navigator.credentials.create({ publicKey: { challenge: rnd(32), rp: { name: 'AE Home POS' }, user: { id: rnd(16), name: 'attendance-device', displayName: 'Attendance device' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' }, timeout: 60000 } });
    try { localStorage.setItem('att_cred', btoa(String.fromCharCode.apply(null, new Uint8Array(cred.rawId)))); } catch (e) {}
    return 'biometric';
  } catch (e) { return 'failed'; }
}
function att_openClock(staffId, type) {
  const s = ATT.staff.find(x => x.id === staffId); if (!s || ATT.busy) return;
  att_stopCam();
  ATT.clk = { staffId, type, name: s.name, eid: s.employeeId, auth: 'skipped', gps: null, gpsState: 'wait', camState: 'wait', ref: ih_rand(18), upload: null, done: false, busy: false };
  openModal('<div class="modal-title">' + (type === 'IN' ? 'Time In' : 'Time Out') + ': ' + esc(s.name) + '</div>' +
    '<div id="attClkBody"><div style="font-size:13px;margin-bottom:8px">Step 1 (optional): confirm with this phone\'s fingerprint or face unlock.</div>' +
    '<div style="margin-bottom:10px"><button type="button" class="btn btn-ghost btn-sm" id="attBioBtn" onclick="att_doBio()">Use fingerprint / face unlock</button> <span id="attBioSt" style="font-size:12px;opacity:.8"></span></div>' +
    '<div style="font-size:13px;margin-bottom:4px">Step 2: location <span id="attGpsSt" style="opacity:.8">Getting location...</span></div>' +
    '<div style="font-size:13px;margin-bottom:6px">Step 3: take the selfie</div>' +
    '<div id="attCamBox" style="position:relative;background:#111;border-radius:10px;overflow:hidden;min-height:160px;text-align:center"><video id="attVideo" playsinline autoplay muted style="width:100%;max-height:50vh;display:block"></video><div id="attCamMsg" style="color:#fff;font-size:12px;padding:8px;position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.45)">Starting camera...</div></div>' +
    '<div id="attFallback" style="display:none;margin-top:6px"><input id="attFile" type="file" accept="image/*" capture="user" style="display:none" onchange="att_onFile(this)"><button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById(\'attFile\').click()">Take photo with the phone camera app</button></div>' +
    '<div id="attClkProg" style="font-size:13px;margin:8px 0"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn btn-ghost" id="attClkCancel" onclick="att_closeClock()">Cancel</button><button class="btn btn-primary" id="attClkGo" onclick="att_captureClock()" disabled>Take Selfie and Submit</button></div></div>');
  const bio = document.getElementById('attBioBtn');
  if (bio) att_bioCheckSupport().then(ok => { if (!ok) { bio.style.display = 'none'; const st = document.getElementById('attBioSt'); if (st) st.textContent = 'Fingerprint is not available on this device. Skipped.'; if (ATT.clk) ATT.clk.auth = 'unavailable'; } });
  att_startGps(); att_startCam();
}
async function att_bioCheckSupport() { try { return !!(window.PublicKeyCredential && window.isSecureContext && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; } }
function att_closeClock() { att_stopCam(); closeModalDirect(); }
async function att_doBio() {
  const st = document.getElementById('attBioSt'), b = document.getElementById('attBioBtn'); if (!ATT.clk) return;
  if (b) b.disabled = true; if (st) st.textContent = 'Waiting for fingerprint / face unlock...';
  const res = await att_bioCheck(); if (!ATT.clk) return; ATT.clk.auth = res;
  if (st) st.innerHTML = res === 'biometric' ? '<span style="color:#2e7d32;font-weight:700">Verified</span>' : res === 'unavailable' ? 'Not available on this device. Skipped.' : '<span style="color:#c62828">Not verified. You can try again or continue without it.</span>';
  if (b && res !== 'biometric' && res !== 'unavailable') b.disabled = false;
}
function att_startGps() {
  const st = () => document.getElementById('attGpsSt'), c = ATT.clk; if (!c) return;
  if (!navigator.geolocation) { c.gpsState = 'fail'; if (st()) st().innerHTML = '<span style="color:#c62828">Location not available (will be flagged)</span>'; att_updateGo(); return; }
  navigator.geolocation.getCurrentPosition(p => {
    if (ATT.clk !== c) return; c.gps = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }; c.gpsState = 'ok';
    if (st()) st().innerHTML = '<span style="color:#2e7d32;font-weight:700">Found</span> (accuracy about ' + Math.round(p.coords.accuracy) + ' m)'; att_updateGo();
  }, e => {
    if (ATT.clk !== c) return; c.gpsState = 'fail';
    if (st()) st().innerHTML = '<span style="color:#c62828">Could not get location (' + esc(e && e.message ? e.message : 'denied') + '). It will be flagged.</span>'; att_updateGo();
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}
async function att_startCam() {
  const c = ATT.clk, msg = () => document.getElementById('attCamMsg'); if (!c) return;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera preview is not supported here.');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 } }, audio: false });
    if (ATT.clk !== c || !document.getElementById('attVideo')) { stream.getTracks().forEach(t => t.stop()); return; }
    ATT.stream = stream; const v = document.getElementById('attVideo'); v.srcObject = stream; try { await v.play(); } catch (e) {}
    c.camState = 'ok'; if (msg()) msg().style.display = 'none'; att_updateGo();
  } catch (e) {
    if (ATT.clk !== c) return; c.camState = 'fail';
    if (msg()) msg().textContent = 'Camera preview could not start (' + (e && e.message ? e.message : 'blocked') + '). Use the button below.';
    const fb = document.getElementById('attFallback'); if (fb) fb.style.display = 'block'; att_updateGo();
  }
}
function att_updateGo() { const c = ATT.clk, b = document.getElementById('attClkGo'); if (!c || !b) return; b.disabled = c.busy || c.done || c.gpsState === 'wait' || c.camState !== 'ok'; }
function att_stamp(src, w, h) {
  const sc = Math.min(1, 960 / Math.max(w, h)), W = Math.max(1, Math.round(w * sc)), H = Math.max(1, Math.round(h * sc));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.drawImage(src, 0, 0, W, H);
  const c = ATT.clk, g = c.gps, d = new Date();
  const dateTxt = d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: '2-digit' }), timeTxt = d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const lines = [c.name + ' (' + c.eid + ')  -  ' + (c.type === 'IN' ? 'TIME IN' : 'TIME OUT'), dateTxt + '  ' + timeTxt, g ? 'Lat ' + g.lat.toFixed(5) + '  Lng ' + g.lng.toFixed(5) + '  (+/-' + Math.round(g.accuracy) + ' m)' : 'Location not available'];
  const fs = Math.max(12, Math.round(W / 34)), pad = Math.round(fs * 0.6), bh = pad * 2 + fs * 1.25 * lines.length;
  x.fillStyle = 'rgba(0,0,0,0.6)'; x.fillRect(0, H - bh, W, bh); x.fillStyle = '#fff'; x.font = 'bold ' + fs + 'px sans-serif'; x.textBaseline = 'top';
  lines.forEach((t, i) => x.fillText(t, pad, H - bh + pad + i * fs * 1.25, W - pad * 2));
  return cv;
}
function att_onFile(input) {
  const f = input.files && input.files[0]; input.value = ''; if (!f || !ATT.clk) return;
  const img = new Image(), url = URL.createObjectURL(f);
  img.onload = () => { URL.revokeObjectURL(url); att_submitCanvas(att_stamp(img, img.naturalWidth, img.naturalHeight)); };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Could not read the photo. Try again.', 'error'); };
  img.src = url;
}
function att_captureClock() {
  const c = ATT.clk, v = document.getElementById('attVideo'); if (!c || c.busy || c.done) return;
  if (!v || !v.videoWidth) { toast('The camera is not ready yet.', 'error'); return; }
  att_submitCanvas(att_stamp(v, v.videoWidth, v.videoHeight));
}
async function att_submitCanvas(cv) {
  const c = ATT.clk; if (!c || c.busy || c.done) return;
  c.busy = true; const go = document.getElementById('attClkGo'), cancel = document.getElementById('attClkCancel'), prog = document.getElementById('attClkProg');
  if (go) { go.disabled = true; go.classList.add('ih-busy'); } if (cancel) cancel.disabled = true;
  try {
    if (!c.upload) {
      ih_setProg(prog, 'Preparing selfie...', 5);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85)); if (!blob) throw new Error('Could not process the photo.');
      const b64 = await ih_compress(new File([blob], 'selfie.jpg', { type: 'image/jpeg' }));
      const up = await ih_uploadProof(b64, (d, t) => ih_setProg(prog, 'Uploading selfie ' + d + ' of ' + t + '...', 10 + Math.round(80 * d / t)));
      c.upload = up; att_stopCam();
    }
    ih_setProg(prog, 'Recording ' + (c.type === 'IN' ? 'Time In' : 'Time Out') + '...', 95);
    const g = c.gps || {};
    const res = await gasPost({ action: 'att_clock', staffId: c.staffId, type: c.type, lat: g.lat, lng: g.lng, accuracy: g.accuracy, auth: c.auth, deviceId: att_deviceId(), deviceTime: Date.now(), uploadId: c.upload.uploadId, chunks: c.upload.total, clientRef: c.ref }, 60000);
    if (res && res.success) {
      c.done = true; const fl = res.flags || [];
      const body = document.getElementById('attClkBody');
      if (body) body.innerHTML = '<div style="text-align:center;padding:10px 0"><div style="font-size:18px;font-weight:800;color:#2e7d32">' + (c.type === 'IN' ? 'Timed In' : 'Timed Out') + ' at ' + esc(res.time) + '</div><div style="font-size:13px;margin-top:4px">' + esc(c.name) + ' &bull; ' + ih_date(res.date) + '</div>' +
        (res.lateMin ? '<div style="margin-top:6px">' + att_chip('Late ' + att_fmtMin(res.lateMin), '#b45309') + '</div>' : '') + (res.underMin ? '<div style="margin-top:6px">' + att_chip('Undertime ' + att_fmtMin(res.underMin), '#b45309') + '</div>' : '') +
        (c.type === 'OUT' ? '<div style="margin-top:6px;font-size:13px">Worked ' + att_fmtMin(res.workedMin) + '</div>' : '') + (fl.length ? '<div style="margin-top:8px">' + fl.map(f => att_chip(f, '#c62828')).join('') + '</div><div style="font-size:12px;opacity:.75">Flagged entries are shown to the Admin in the Logs tab.</div>' : '') +
        '</div><div style="text-align:right"><button class="btn btn-primary" onclick="closeModalDirect()">Done</button></div>';
      toast('Recorded.', 'success'); if (ATT.tab === 'today') att_showToday();
    } else {
      if (prog) prog.innerHTML = '<span style="color:#c62828">' + esc((res && res.message) || 'Could not record.') + '</span>';
      c.busy = false; if (go) { go.classList.remove('ih-busy'); } if (cancel) cancel.disabled = false;
      if (res && /Already timed in|no open Time In|disabled/.test(res.message || '')) { c.upload = null; if (ATT.tab === 'today') att_showToday(); }
    }
  } catch (e) {
    if (prog) prog.innerHTML = '<span style="color:#c62828">' + esc(e.message) + ' Press the button to retry. It will not record twice.</span>';
    c.busy = false; if (go) go.classList.remove('ih-busy'); if (cancel) cancel.disabled = false;
    if (!ATT.stream && !c.upload) { c.camState = 'fail'; const fb = document.getElementById('attFallback'); if (fb) fb.style.display = 'block'; }
  }
  const b2 = document.getElementById('attClkGo'); if (b2) { if (c.done) b2.disabled = true; else { c.camState = c.upload ? 'ok' : c.camState; b2.disabled = false; } }
}

// ═══════════════════ BUNDY CLOCK / DTR (staff own phone, PIN, no selfie) ═══════════════════
const BND = { st: null, month: '', half: (new Date().getDate() <= 15 ? '1' : '2'), busy: false, ref: null, clockTimer: null };
function bnd_fmt12(hhmm) { const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || '')); if (!m) return esc(hhmm || ''); let h = +m[1]; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + m[2] + ' ' + ap; }
function bnd_dateLong(d) { const t = new Date(String(d) + 'T00:00:00'); return isNaN(t) ? esc(d) : t.toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }); }
function bnd_lbl(punches, i) { const p = punches[i]; let n = 0; for (let k = 0; k <= i; k++) if (punches[k].type === p.type) n++; const w = p.type === 'IN' ? 'Time In' : 'Time Out'; return n === 1 ? 'AM ' + w : n === 2 ? 'PM ' + w : w + ' (' + n + ')'; }
function bnd_nextLbl(punches, type) { let n = 1; (punches || []).forEach(p => { if (p.type === type) n++; }); const w = type === 'IN' ? 'Time In' : 'Time Out'; return n === 1 ? 'AM ' + w : n === 2 ? 'PM ' + w : w + ' (' + n + ')'; }
function bnd_stopClock() { if (BND.clockTimer) { clearInterval(BND.clockTimer); BND.clockTimer = null; } }
async function att_renderMy() {
  const pc = document.getElementById('pageContent'); bnd_stopClock();
  if (!currentUser || currentUser.role !== 'attstaff') { pc.innerHTML = '<div class="card"><div class="card-title">Access denied</div></div>'; return; }
  pc.innerHTML = '<div id="bndTabBar" class="tab-bar" style="margin-bottom:16px"><button class="tab-btn active" id="bndT1" onclick="bnd_tab(1)">Bundy Clock</button><button class="tab-btn" id="bndT2" onclick="bnd_tab(2)">My DTR</button></div><div id="bndBody"><div class="card"><div style="opacity:.7">Loading...</div>' + ih_barHtml() + '</div></div>';
  bnd_tab(1);
}
function bnd_tab(n) {
  const a = document.getElementById('bndT1'), b = document.getElementById('bndT2'); if (!a || !b) return;
  a.classList.toggle('active', n === 1); b.classList.toggle('active', n === 2);
  if (n === 1) bnd_loadStatus(); else { bnd_stopClock(); BND.month = BND.month || (BND.st && BND.st.date ? BND.st.date.substring(0, 7) : ''); bnd_loadDtr(); }
}
async function bnd_loadStatus() {
  const body = document.getElementById('bndBody'); if (!body) return;
  try {
    const r = await gasRequest({ action: 'att_getMyStatus' }, 45000);
    if (currentPage !== 'attMy') return;
    if (!r || !r.success) { body.innerHTML = '<div class="card"><div style="color:#c62828">' + esc((r && r.message) || 'Could not load.') + '</div></div>'; return; }
    BND.st = r; bnd_drawClock();
  } catch (e) { if (body) body.innerHTML = '<div class="card"><div style="color:#c62828">' + esc(e.message) + '</div><button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="bnd_loadStatus()">Retry</button></div>'; }
}
function bnd_drawClock() {
  const body = document.getElementById('bndBody'), s = BND.st; if (!body || !s) return;
  const stCol = s.status === 'In' ? '#2e7d32' : (s.status === 'Out' ? '#6b7280' : '#b45309');
  const canIn = s.active && s.status !== 'In', canOut = s.active && s.status === 'In';
  body.innerHTML = '<div class="card" style="text-align:center">' +
    '<div style="font-weight:700">' + esc(s.staff.name) + '</div><div style="font-size:12px;opacity:.7">' + esc(s.staff.employeeId) + ' &bull; ' + esc(att_branchName(s.staff.branch)) + ' &bull; Shift ' + bnd_fmt12(s.staff.shiftStart) + ' - ' + bnd_fmt12(s.staff.shiftEnd) + '</div>' +
    '<div id="bndClock" style="font-size:44px;font-weight:800;letter-spacing:1px;margin:14px 0 2px;font-variant-numeric:tabular-nums">--:--:--</div><div id="bndDate" style="font-size:13px;opacity:.7"></div>' +
    '<div style="margin:12px 0">' + att_chip('Status: ' + (s.status === 'Not in' ? 'Not in yet' : s.status === 'In' ? 'Timed in' : 'Timed out'), stCol) + (s.lateMin ? ' ' + att_chip('Late ' + att_fmtMin(s.lateMin), '#b45309') : '') + '</div>' +
    (s.active ? '<div style="max-width:260px;margin:0 auto"><input id="bndPin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="Your PIN" style="' + IH_INP + ';text-align:center;font-size:20px;letter-spacing:6px">' +
      '<label id="bndBioRow" style="display:none;gap:6px;align-items:center;justify-content:center;font-size:12px;margin-top:8px"><input type="checkbox" id="bndBio"> Also use fingerprint / face</label>' +
      '<div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-primary" style="flex:1;padding:14px 0;font-size:16px;justify-content:center;text-align:center" id="bndIn"' + (canIn ? '' : ' disabled') + ' onclick="bnd_punch(\'IN\')">' + bnd_nextLbl(s.punches, 'IN') + '</button><button class="btn btn-ghost" style="flex:1;padding:14px 0;font-size:16px;justify-content:center;text-align:center;border:1px solid var(--border)" id="bndOut"' + (canOut ? '' : ' disabled') + ' onclick="bnd_punch(\'OUT\')">' + bnd_nextLbl(s.punches, 'OUT') + '</button></div>' +
      '<div id="bndMsg" style="font-size:12px;margin-top:8px;min-height:16px"></div></div>' : '<div style="color:#c62828">Your attendance is disabled. Please ask your Admin.</div>') +
    '</div>' +
    '<div class="card"><div class="card-title">Today</div>' + (s.punches.length ? s.punches.map((p, i) => '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--border)"><span>' + bnd_lbl(s.punches, i) + '</span><b>' + bnd_fmt12(p.time) + '</b></div>').join('') + (s.workedMin ? '<div style="margin-top:8px;font-size:13px">Worked so far: <b>' + att_fmtMin(s.workedMin) + '</b></div>' : '') : '<div style="opacity:.7">No punches yet today.</div>') + '</div>';
  const tick = () => { const c = document.getElementById('bndClock'); if (!c) { bnd_stopClock(); return; } const n = new Date(); c.textContent = n.toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Manila' }); const d = document.getElementById('bndDate'); if (d) d.textContent = n.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' }); };
  bnd_stopClock(); tick(); BND.clockTimer = setInterval(tick, 1000);
  att_bioCheckSupport().then(ok => { const r = document.getElementById('bndBioRow'); if (r && ok) r.style.display = 'flex'; });
}
function bnd_gps() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    let done = false; const t = setTimeout(() => { if (!done) { done = true; res(null); } }, 9000);
    navigator.geolocation.getCurrentPosition(p => { if (!done) { done = true; clearTimeout(t); res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); } }, () => { if (!done) { done = true; clearTimeout(t); res(null); } }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
  });
}
async function bnd_punch(type) {
  if (BND.busy) return;
  const pinEl = document.getElementById('bndPin'), msg = document.getElementById('bndMsg'), pin = pinEl ? pinEl.value.trim() : '';
  if (!/^\d{4,6}$/.test(pin)) { if (msg) msg.innerHTML = '<span style="color:#c62828">Enter your 4-6 digit PIN.</span>'; if (pinEl) pinEl.focus(); return; }
  BND.busy = true; const bi = document.getElementById('bndIn'), bo = document.getElementById('bndOut'); if (bi) bi.disabled = true; if (bo) bo.disabled = true;
  if (!BND.ref || BND.ref.type !== type) BND.ref = { type, id: 'BND-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) };
  try {
    let auth = 'skipped'; const bio = document.getElementById('bndBio');
    if (bio && bio.checked) { if (msg) msg.textContent = 'Verifying fingerprint / face...'; auth = await att_bioCheck(); }
    if (msg) msg.textContent = 'Getting location...'; const g = await bnd_gps() || {};
    showLoading(type === 'IN' ? 'Recording Time In...' : 'Recording Time Out...');
    const r = await gasPost({ action: 'att_clockSelf', type, pin, lat: g.lat, lng: g.lng, accuracy: g.accuracy, auth, deviceId: att_deviceId(), deviceTime: Date.now(), clientRef: BND.ref.id }, 45000);
    hideLoading();
    if (r && r.success) { BND.ref = null; bnd_showSlip(r, type); bnd_loadStatus(); }
    else { if (msg) msg.innerHTML = '<span style="color:#c62828">' + esc((r && r.message) || 'Could not record.') + '</span>'; if (/Already timed in|no open Time In/.test((r && r.message) || '')) { BND.ref = null; bnd_loadStatus(); } else { if (pinEl) pinEl.value = ''; const s = BND.st; if (bi) bi.disabled = !(s && s.status !== 'In'); if (bo) bo.disabled = !(s && s.status === 'In'); } }
  } catch (e) { hideLoading(); if (msg) msg.innerHTML = '<span style="color:#c62828">' + esc(e.message) + ' Press again to retry. It will not record twice.</span>'; if (bi) bi.disabled = false; if (bo) bo.disabled = false; }
  finally { BND.busy = false; }
}
function bnd_slipHtml(r, type) {
  const line = (a, b) => '<div class="sl-r"><span>' + a + '</span><b>' + b + '</b></div>';
  const pun = (r.punches || []).map((p, i) => line(bnd_lbl(r.punches, i), bnd_fmt12(p.time))).join('');
  return '<div class="slip"><div class="sl-c sl-t">AE HOME</div><div class="sl-c">Daily Time Record Slip</div><hr>' +
    '<div class="sl-c sl-big">' + ((r.punches && r.punches.length) ? bnd_lbl(r.punches, r.punches.length - 1).toUpperCase() : (type === 'IN' ? 'TIME IN' : 'TIME OUT')) + '</div><div class="sl-c sl-big2">' + bnd_fmt12(r.time) + '</div><div class="sl-c">' + bnd_dateLong(r.date) + '</div><hr>' +
    line('Name', esc(r.name)) + line('Employee ID', esc(r.employeeId)) + line('Branch', esc(att_branchName(r.branch))) +
    (r.lateMin ? line('Late', att_fmtMin(r.lateMin)) : '') + (r.underMin ? line('Undertime', att_fmtMin(r.underMin)) : '') + (type === 'OUT' && r.workedMin ? line('Worked (last)', att_fmtMin(r.workedMin)) : '') +
    ((r.punches || []).length ? '<hr><div class="sl-c" style="font-weight:700">Today\'s punches</div>' + pun : '') +
    '<hr><div class="sl-c" style="font-size:11px">Ref: ' + esc(r.ref || r.id) + '</div><div class="sl-c" style="font-size:11px">Keep this slip. Check your DTR for corrections.</div></div>';
}
const BND_SLIP_CSS = '.slip{font-family:"Courier New",monospace;font-size:13px;color:#000;max-width:300px;margin:0 auto;padding:8px 6px}.slip hr{border:0;border-top:1px dashed #000;margin:7px 0}.sl-c{text-align:center}.sl-t{font-size:18px;font-weight:800}.sl-big{font-size:16px;font-weight:800;margin-top:2px}.sl-big2{font-size:26px;font-weight:800}.sl-r{display:flex;justify-content:space-between;gap:8px;margin:2px 0}.sl-r b{text-align:right}';
function bnd_showSlip(r, type) {
  BND.slip = bnd_slipHtml(r, type);
  openModal('<style>' + BND_SLIP_CSS + '</style><div style="background:#fff;border:1px solid var(--border);border-radius:8px;padding:6px;margin-bottom:10px">' + BND.slip + '</div>' +
    (r.flags && r.flags.length ? '<div style="margin-bottom:8px;text-align:center">' + r.flags.map(f => att_chip(f, '#b45309')).join(' ') + '</div>' : '') +
    '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" onclick="bnd_print(BND.slip,\'slip\')">Print slip</button><button class="btn btn-primary" onclick="closeModalDirect()">Done</button></div>');
}
function bnd_print(html, kind) {
  const old = document.getElementById('bndPrintFrame'); if (old) old.remove();
  const f = document.createElement('iframe'); f.id = 'bndPrintFrame'; f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f); const d = f.contentWindow.document; d.open();
  d.write('<!doctype html><html><head><meta charset="utf-8"><title>' + (kind === 'slip' ? 'Slip' : 'DTR') + '</title><style>' + BND_SLIP_CSS + (kind === 'slip' ? '@page{size:58mm auto;margin:2mm}.slip{max-width:none}' : '@page{margin:12mm}') + 'body{margin:0;font-family:Arial,sans-serif}' + BND_DTR_CSS + '</style></head><body>' + html + '</body></html>'); d.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Could not open print.', 'error'); } }, 300);
}
// ── DTR ──
const BND_DTR_CSS = '.dtr{color:#000;font-size:13px}.dtr h2{margin:0;text-align:center}.dtr .sub{text-align:center;margin-bottom:10px}.dtr table{width:100%;border-collapse:collapse;margin-top:8px}.dtr th,.dtr td{border:1px solid #444;padding:4px 6px;text-align:left;font-size:12px}.dtr th{background:#eee}.dtr .sig{display:flex;gap:30px;margin-top:34px}.dtr .sig div{flex:1;border-top:1px solid #000;text-align:center;padding-top:3px;font-size:12px}';
function bnd_dtrHtml(r) {
  const s = r.staff, t = r.totals, mon = new Date(r.month + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  const per = r.half ? (r.half === '1' ? 'Cut-off: 1 - 15 ' : 'Cut-off: 16 - ' + r.to + ' ') + mon : mon;
  const byDate = {}; r.days.forEach(d => { byDate[d.date] = d; });
  const rows = [];
  for (let n = r.from; n <= r.to; n++) {
    const ds = r.month + '-' + String(n).padStart(2, '0'), d = byDate[ds], wd = new Date(ds + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short' });
    if (!d) { rows.push('<tr><td>' + n + ' ' + wd + '</td><td colspan="9" style="color:#888">No record</td></tr>'); continue; }
    const P = d.punches, c = i => P[i] ? bnd_fmt12(P[i].time) : '-', ex = P.slice(4).map(p => (p.type === 'IN' ? 'In ' : 'Out ') + bnd_fmt12(p.time)).join(', ');
    const lun = d.lunchMin ? att_fmtMin(d.lunchMin) + (d.lunchMin > 60 ? ' (over)' : '') : '-';
    rows.push('<tr><td>' + n + ' ' + wd + '</td><td>' + c(0) + '</td><td>' + c(1) + '</td><td>' + c(2) + '</td><td>' + c(3) + '</td><td>' + (d.lateMin ? att_fmtMin(d.lateMin) : '-') + '</td><td>' + (d.underMin ? att_fmtMin(d.underMin) : '-') + '</td><td>' + lun + '</td><td>' + att_fmtMin(d.workedMin) + '</td><td>' + [d.open ? 'Missing Time Out' : '', d.manual ? 'Manual entry' : '', ex ? 'Extra: ' + esc(ex) : ''].filter(Boolean).join('; ') + '</td></tr>');
  }
  return '<div class="dtr"><h2>AE HOME</h2><div class="sub"><b>DAILY TIME RECORD</b><br>' + esc(per) + '</div>' +
    '<div><b>Name:</b> ' + esc(s.name) + ' &nbsp; <b>Employee ID:</b> ' + esc(s.employeeId) + '<br><b>Branch:</b> ' + esc(att_branchName(s.branch)) + ' &nbsp; <b>Shift:</b> ' + bnd_fmt12(s.shiftStart) + ' - ' + bnd_fmt12(s.shiftEnd) + '</div>' +
    '<table><thead><tr><th>Date</th><th>AM In</th><th>AM Out</th><th>PM In</th><th>PM Out</th><th>Late</th><th>Under</th><th>Lunch</th><th>Worked</th><th>Remarks</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
    '<div style="margin-top:8px"><b>Days present:</b> ' + t.days + ' &nbsp; <b>Late:</b> ' + t.lateDays + ' day(s), ' + att_fmtMin(t.lateMin) + ' &nbsp; <b>Undertime:</b> ' + att_fmtMin(t.underMin) + ' &nbsp; <b>Total worked:</b> ' + att_fmtMin(t.workedMin) + (t.missingOut ? ' &nbsp; <b>Missing Time Out:</b> ' + t.missingOut : '') + '</div>' +
    '<div class="sig"><div>Employee signature</div><div>Verified by (Admin)</div></div></div>';
}
function bnd_monthBar(fn) {
  const m = BND.month, d = new Date(m + '-01T00:00:00'), shift = k => { const x = new Date(d.getFullYear(), d.getMonth() + k, 1); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); };
  const hb = (h, l) => '<button class="btn btn-sm ' + (BND.half === h ? 'btn-primary' : 'btn-ghost') + '" onclick="BND.half=\'' + h + '\';' + fn + '()">' + l + '</button>';
  return '<div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-bottom:8px"><button class="btn btn-ghost btn-sm" onclick="BND.month=\'' + shift(-1) + '\';' + fn + '()">&lsaquo;</button><b>' + esc(d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })) + '</b><button class="btn btn-ghost btn-sm" onclick="BND.month=\'' + shift(1) + '\';' + fn + '()">&rsaquo;</button></div>' +
    '<div style="display:flex;gap:6px;justify-content:center;margin-bottom:10px">' + hb('1', '1 - 15') + hb('2', '16 - end') + hb('', 'Whole month') + '</div>';
}
async function bnd_loadDtr() {
  const body = document.getElementById('bndBody'); if (!body) return;
  if (!BND.month) BND.month = new Date().toISOString().substring(0, 7);
  body.innerHTML = '<div class="card"><div style="opacity:.7">Loading DTR...</div>' + ih_barHtml() + '</div>';
  try {
    const r = await gasRequest({ action: 'att_getMyDtr', month: BND.month, half: BND.half }, 45000); if (currentPage !== 'attMy') return;
    if (!r || !r.success) { body.innerHTML = '<div class="card" style="color:#c62828">' + esc((r && r.message) || 'Could not load.') + '</div>'; return; }
    BND.dtr = r; body.innerHTML = bnd_monthBar('bnd_loadDtr') + '<div class="card" style="overflow-x:auto"><style>' + BND_DTR_CSS + '</style>' + bnd_dtrHtml(r) + '</div><div style="font-size:12px;opacity:.7;margin:6px 0">Read-only. If something is wrong, tell your Admin to correct it.</div><button class="btn btn-ghost" onclick="bnd_print(bnd_dtrHtml(BND.dtr),\'dtr\')">Print DTR</button>';
  } catch (e) { body.innerHTML = '<div class="card" style="color:#c62828">' + esc(e.message) + '</div>'; }
}
// Admin: DTR per staff
async function att_openDtr(staffId) {
  BND.month = BND.month || new Date().toISOString().substring(0, 7); BND.adminStaff = staffId; att_loadDtrAdmin();
}
async function att_loadDtrAdmin() {
  showLoading('Loading DTR...');
  try {
    const r = await gasRequest({ action: 'att_getDtr', staffId: BND.adminStaff, month: BND.month, half: BND.half }, 45000); hideLoading();
    if (!r || !r.success) { toast((r && r.message) || 'Could not load DTR.', 'error'); return; }
    BND.dtr = r;
    openModal('<style>' + BND_DTR_CSS + '</style>' + bnd_monthBar('att_loadDtrAdmin') + '<div style="overflow-x:auto;background:#fff;padding:8px;border:1px solid var(--border);border-radius:8px">' + bnd_dtrHtml(r) + '</div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn btn-ghost" onclick="bnd_print(bnd_dtrHtml(BND.dtr),\'dtr\')">Print DTR</button><button class="btn btn-primary" onclick="closeModalDirect()">Close</button></div>');
  } catch (e) { hideLoading(); toast(e.message, 'error'); }
}

// ═══════════ Login-page entry for Attendance (LOCKED: only shows on devices where the tester unlocked it) ═══════════
// Unlock on your own phone/PC by opening the app link with ?attendance=1 once. Lock again with ?attendance=0.
function att_betaOn() {
  try {
    const q = new URLSearchParams(location.search).get('attendance');
    if (q === '1') localStorage.setItem('att_beta', '1'); else if (q === '0') localStorage.removeItem('att_beta');
    return localStorage.getItem('att_beta') === '1';
  } catch (e) { return false; }
}
function att_showLoginHint() {
  const u = document.getElementById('loginUser'); if (!u) return;
  let h = document.getElementById('attLoginHint');
  if (!h) { h = document.createElement('div'); h.id = 'attLoginHint'; h.style.cssText = 'font-size:13px;text-align:center;margin:0 0 10px;padding:8px 10px;border-radius:10px;background:#eef6ff;color:#1e3a5f';
    const f = document.querySelector('#loginScreen .login-card .login-form'); if (f) f.insertBefore(h, f.firstChild); }
  h.textContent = 'Attendance staff: sign in with the username and password from your Admin. You will land on the Bundy Clock and your DTR.';
  u.focus();
}
function att_injectLoginLink() {
  try {
    if (!att_betaOn()) return;
    const form = document.querySelector('#loginScreen .login-card .login-form');
    if (form && !document.getElementById('attLoginLink')) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'attLoginLink'; b.className = 'btn-link'; b.textContent = 'Attendance? Bundy Clock and DTR';
      b.onclick = att_showLoginHint; form.appendChild(b);
    }
  } catch (e) {}
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', att_injectLoginLink); else att_injectLoginLink();

// Tester unlock without a URL (for installed PWA): tap the "AE HOME" logo 5 times quickly. Same 5 taps again locks it.
(function att_logoTap() {
  function bind() {
    const el = document.querySelector('#loginScreen .login-logo-text'); if (!el || el._attTap) return; el._attTap = true;
    let n = 0, t = null;
    el.addEventListener('click', () => {
      n++; clearTimeout(t); t = setTimeout(() => { n = 0; }, 2500);
      if (n >= 5) {
        n = 0;
        try {
          const on = localStorage.getItem('att_beta') === '1';
          if (on) { localStorage.removeItem('att_beta'); const l = document.getElementById('attLoginLink'); if (l) l.remove(); const h = document.getElementById('attLoginHint'); if (h) h.remove(); toast('Attendance entry locked.', 'info'); }
          else { localStorage.setItem('att_beta', '1'); att_injectLoginLink(); toast('Attendance entry unlocked on this device.', 'success'); }
        } catch (e) { toast('Could not change the lock on this device.', 'error'); }
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();

// ── Bulk missed entries (Admin picks the staff, any date range, and the times) ──
function att_openBulk() {
  const t = ATT.today ? ATT.today.date : new Date().toISOString().slice(0, 10), tm = (id, lbl, val) => '<div class="field" style="flex:1;min-width:120px"><label>' + lbl + '</label><input id="' + id + '" type="time" value="' + val + '" style="' + IH_INP + '"></div>';
  openModal('<div class="modal-title">Bulk Entry</div><div style="font-size:13px;margin-bottom:8px">Use this for several missed days at once. Choose the dates, then untick any day that was an off day. Marked Manual, no selfie. Days that already have punches are skipped.</div>' +
    '<div class="field"><label>Staff</label><select id="attBkStaff" style="' + IH_INP + '">' + ATT.staff.map(s => '<option value="' + esc(s.id) + '">' + esc(s.name) + ' (' + esc(s.employeeId) + ')</option>').join('') + '</select></div>' +
    '<div style="display:flex;gap:8px"><div class="field" style="flex:1"><label>From</label><input id="attBkFrom" type="date" max="' + esc(t) + '" onchange="att_bulkList()" style="' + IH_INP + '"></div><div class="field" style="flex:1"><label>To</label><input id="attBkTo" type="date" max="' + esc(t) + '" onchange="att_bulkList()" style="' + IH_INP + '"></div></div>' +
    '<div id="attBkDates" style="margin:4px 0 10px;font-size:13px;max-height:170px;overflow:auto"><span style="opacity:.7">Pick the From and To dates.</span></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' + tm('attBkAi', 'AM Time In', '08:00') + tm('attBkAo', 'AM Time Out', '12:00') + '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' + tm('attBkPi', 'PM Time In', '13:00') + tm('attBkPo', 'PM Time Out', '17:00') + '</div>' +
    '<div style="font-size:12px;opacity:.7;margin-bottom:8px">Clear both fields of a pair to skip it.</div>' +
    '<div class="field"><label>Reason (required)</label><input id="attBkReason" type="text" maxlength="200" style="' + IH_INP + '"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-ghost" onclick="closeModalDirect()">Cancel</button><button class="btn btn-primary" id="attBkBtn" onclick="att_saveBulk()">Save</button></div>');
}
function att_bulkList() {
  const f = (document.getElementById('attBkFrom') || {}).value, t = (document.getElementById('attBkTo') || {}).value, box = document.getElementById('attBkDates'); if (!box) return;
  if (!f || !t) { box.innerHTML = '<span style="opacity:.7">Pick the From and To dates.</span>'; return; }
  if (f > t) { box.innerHTML = '<span style="color:#c62828">The From date must not be after the To date.</span>'; return; }
  const out = []; for (let d = new Date(f + 'T00:00:00'); d <= new Date(t + 'T00:00:00') && out.length < 32; d.setDate(d.getDate() + 1)) out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  if (out.length > 31) { box.innerHTML = '<span style="color:#c62828">Pick at most 31 days at a time.</span>'; return; }
  box.innerHTML = out.map(d => '<label style="display:flex;gap:8px;align-items:center;padding:3px 0"><input type="checkbox" class="attBkD" value="' + d + '" checked> ' + esc(bnd_dateLong(d)) + '</label>').join('');
}
async function att_saveBulk() {
  const v = id => ((document.getElementById(id) || {}).value || '').trim();
  const dates = Array.from(document.querySelectorAll('.attBkD')).filter(c => c.checked).map(c => c.value);
  if (!dates.length) { toast('Pick the dates first.', 'error'); return; }
  const times = { amIn: v('attBkAi'), amOut: v('attBkAo'), pmIn: v('attBkPi'), pmOut: v('attBkPo') };
  if (!times.amIn && !times.amOut && !times.pmIn && !times.pmOut) { toast('Enter the times.', 'error'); return; }
  if (!v('attBkReason')) { toast('Enter the reason.', 'error'); return; }
  if (ATT.busy) return; ATT.busy = true; const b = document.getElementById('attBkBtn'); if (b) b.disabled = true; showLoading('Saving entries...');
  try {
    const r = await gasPost({ action: 'att_addManualBulk', staffId: v('attBkStaff'), dates, times, reason: v('attBkReason') }, 90000);
    if (r && r.success) { closeModalDirect(); toast(r.days + ' day(s) added (' + r.entries + ' entries).' + (r.skipped && r.skipped.length ? ' Skipped (already had punches): ' + r.skipped.join(', ') + '.' : ''), r.skipped && r.skipped.length ? 'warning' : 'success', 9000); att_drawTab(); }
    else { toast((r && r.message) || 'Could not save.', 'error', 6000); if (b) b.disabled = false; }
  } catch (e) { toast('Network error. Check the logs before trying again; nothing is added twice for days that already have punches.', 'error', 8000); if (b) b.disabled = false; } finally { ATT.busy = false; hideLoading(); }
}
