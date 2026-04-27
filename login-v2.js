// ==UserScript==
// @name         GR Consulate Auto Booking Bot
// @namespace    https://github.com/grcon-booking-bot
// @version      2.0
// @description  Automatically books appointments on the Greek Consulate scheduling system for Work National VISA
// @author       BookingBot
// @match        https://schedule.cf-grcon-isl-pakistan.com/*
// @match        https://*.supersaas.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
  
    // ─── CONFIG ────────────────────────────────────────────────────────────────
    const STORAGE_KEY = 'grcon_bot_profiles';
    const ACTIVE_KEY  = 'grcon_bot_active';
    const INTERVAL_KEY = 'grcon_bot_interval';
  
    // ─── HELPERS ───────────────────────────────────────────────────────────────
    function saveProfiles(profiles) { GM_setValue(STORAGE_KEY, JSON.stringify(profiles)); }
    function loadProfiles() {
      try { return JSON.parse(GM_getValue(STORAGE_KEY, '[]')); } catch { return []; }
    }
    function getActive() { return GM_getValue(ACTIVE_KEY, null); }
    function setActive(id) { GM_setValue(ACTIVE_KEY, id); }
    function getInterval() { return parseInt(GM_getValue(INTERVAL_KEY, '5'), 10); }
    function setInterval_(v) { GM_setValue(INTERVAL_KEY, String(v)); }
    function log(msg) {
      const el = document.getElementById('grcon_log');
      if (!el) return;
      const time = new Date().toLocaleTimeString();
      el.innerHTML = `<div style="color:#aef"><b>${time}</b> ${msg}</div>` + el.innerHTML;
    }
    function notify(title, msg) {
      GM_notification({ title, text: msg, timeout: 8000 });
      log(`✅ ${msg}`);
    }
    function getField(id) { return document.getElementById(id); }
    function setVal(id, val) { const el = getField(id); if (el) { el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); } }
  
    // ─── PAGE DETECTION ────────────────────────────────────────────────────────
    const url = window.location.href;
    const isLoginPage    = url.includes('/schedule/grcon-isl-pakistan') && !url.includes('VISA') && !url.includes('view=');
    const isSchedulePage = url.includes('WORK_National_VISA') || url.includes('National_visa_for_WORK');
    const isFormPage     = url.includes('view=free') || (isSchedulePage && document.querySelector('table#outer'));
  
    // ─── STYLES ────────────────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
      #grcon_panel {
        position: fixed; bottom: 12px; right: 0; width: 320px; z-index: 999999;
        background: #0f1117; border: 1px solid #1e40af; border-radius: 10px 0 0 10px;
        font-family: system-ui, sans-serif; font-size: 12px; color: #e2e8f0;
        box-shadow: -4px 0 20px rgba(0,0,0,0.5);
      }
      #grcon_panel .hdr {
        background: linear-gradient(135deg,#1e40af,#1d4ed8);
        padding: 8px 12px; border-radius: 10px 0 0 0;
        display: flex; align-items: center; justify-content: space-between;
        cursor: move; user-select: none;
      }
      #grcon_panel .hdr .title { font-weight: bold; font-size: 13px; flex:1; }
      #grcon_panel .hdr .badge {
        background: #22c55e; color: #fff; padding: 1px 7px;
        border-radius: 99px; font-size: 10px; margin-right: 6px;
      }
      #grcon_panel .hdr .badge.off { background: #6b7280; }
      #grcon_panel .body { padding: 8px; }
      #grcon_panel .section { background: #1e2130; border-radius: 6px; padding: 8px; margin-bottom: 6px; }
      #grcon_panel label { display: block; color: #94a3b8; font-size: 10px; margin-bottom: 2px; text-transform: uppercase; }
      #grcon_panel input, #grcon_panel select {
        width: 100%; padding: 5px 8px; border-radius: 4px;
        border: 1px solid #334155; background: #0f172a; color: #e2e8f0;
        font-size: 11px; box-sizing: border-box; margin-bottom: 5px;
      }
      #grcon_panel .row { display: flex; gap: 5px; }
      #grcon_panel .row > * { flex: 1; }
      #grcon_panel button {
        width: 100%; padding: 7px; border-radius: 5px; border: none;
        font-weight: bold; font-size: 11px; cursor: pointer; margin-bottom: 4px;
      }
      #grcon_panel .btn-start { background: linear-gradient(135deg,#16a34a,#15803d); color: #fff; }
      #grcon_panel .btn-stop  { background: linear-gradient(135deg,#dc2626,#b91c1c); color: #fff; }
      #grcon_panel .btn-save  { background: linear-gradient(135deg,#1d4ed8,#1e40af); color: #fff; }
      #grcon_panel .btn-fill  { background: linear-gradient(135deg,#7c3aed,#6d28d9); color: #fff; }
      #grcon_panel .btn-login { background: linear-gradient(135deg,#0891b2,#0e7490); color: #fff; }
      #grcon_panel .btn-mini  { padding: 4px 8px; border-radius: 4px; font-size: 10px; }
      #grcon_panel .profile-card {
        background: #0f172a; border-radius: 4px; padding: 6px 8px; margin-bottom: 4px;
        border: 1px solid #334155; cursor: pointer; display: flex; justify-content: space-between; align-items: center;
      }
      #grcon_panel .profile-card:hover { border-color: #3b82f6; }
      #grcon_panel .profile-card.active { border-color: #22c55e; background: #052e16; }
      #grcon_panel #grcon_log {
        max-height: 100px; overflow-y: auto; font-size: 10px; color: #94a3b8;
        background: #0f172a; border-radius: 4px; padding: 5px; font-family: monospace;
      }
      #grcon_panel .collapse-btn { background: rgba(255,255,255,.15); border: none; color: #fff; width: 22px; height: 22px; border-radius: 4px; cursor: pointer; }
      #grcon_panel .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
      #grcon_panel .dot-on  { background: #22c55e; animation: pulse 1.5s infinite; }
      #grcon_panel .dot-off { background: #6b7280; }
      @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
      #grcon_panel .tab-btns { display: flex; gap: 3px; margin-bottom: 6px; }
      #grcon_panel .tab-btns button { flex:1; padding:4px; border-radius:4px; border:1px solid #334155; background:#1e2130; color:#94a3b8; font-size:10px; margin:0; }
      #grcon_panel .tab-btns button.active-tab { background:#1e40af; color:#fff; border-color:#1e40af; }
      #grcon_panel select option { background: #0f172a; }
    `;
    document.head.appendChild(style);
  
    // ─── GREEK REGIONS ─────────────────────────────────────────────────────────
    const REGIONS = [
      'ΑΓΙΟΣ ΝΙΚΟΛΑΟΣ','ΑΓΡΙΝΙΟ','ΑΘΗΝΑ','ΑΛΕΞΑΝΔΡΟΥΠΟΛΗ','ΑΜΦΙΣΣΑ','ΑΡΓΟΣΤΟΛΙ','ΑΡΤΑ',
      'ΒΑΘΥ ΣΑΜΟΥ','ΒΕΡΟΙΑ','ΒΟΛΟΣ','ΓΡΕΒΕΝΑ','ΔΡΑΜΑ','ΕΔΕΣΣΑ','ΕΡΜΟΥΠΟΛΗ ΣΥΡΟΥ',
      'ΖΑΚΥΝΘΟΣ','ΗΓΟΥΜΕΝΙΤΣΑ','ΗΡΑΚΛΕΙΟ','ΘΕΣΣΑΛΟΝΙΚΗ','Ι.Π. ΜΕΣΟΛΟΓΓΙΟΥ','ΙΩΑΝΝΙΝΑ',
      'ΚΑΒΑΛΑ','ΚΑΛΑΜΑΤΑ','ΚΑΡΔΙΤΣΑ','ΚΑΡΠΕΝΗΣΙ','ΚΑΣΤΟΡΙΑ','ΚΑΤΕΡΙΝΗ','ΚΕΡΚΥΡΑ',
      'ΚΙΛΚΙΣ','ΚΟΖΑΝΗ','ΚΟΜΟΤΗΝΗ','ΚΟΡΙΝΘΟΣ','ΛΑΜΙΑ','ΛΑΡΙΣΑ','ΛΕΥΚΑΔΑ','ΛΙΒΑΔΕΙΑ',
      'ΜΥΤΙΛΗΝΗ','ΝΑΥΠΑΚΤΟΣ','ΝΑΥΠΛΙΟ','ΞΑΝΘΗ','ΠΑΛΛΗΝΗ','ΠΑΤΡΑ','ΠΕΙΡΑΙΑΣ',
      'ΠΟΛΥΓΥΡΟΣ','ΠΡΕΒΕΖΑ','ΠΥΡΓΟΣ','ΡΕΘΥΜΝΟ','ΡΟΔΟΣ','ΣΕΡΡΕΣ','ΣΠΑΡΤΗ',
      'ΤΡΙΚΑΛΑ','ΤΡΙΠΟΛΗ','ΦΛΩΡΙΝΑ','ΧΑΛΚΙΔΑ','ΧΑΝΙΑ','ΧΙΟΣ'
    ];
  
    // ─── PANEL HTML ────────────────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.id = 'grcon_panel';
    panel.innerHTML = `
      <div class="hdr" id="grcon_hdr">
        <span class="status-dot dot-off" id="grcon_dot"></span>
        <span class="title">GR Consulate Bot</span>
        <span class="badge off" id="grcon_badge">OFF</span>
        <button class="collapse-btn" id="grcon_toggle">−</button>
      </div>
      <div class="body" id="grcon_body">
        <div class="tab-btns">
          <button class="active-tab" id="tab-profile-btn" data-action="tab" data-tab="profile">Profile</button>
          <button id="tab-bot-btn" data-action="tab" data-tab="bot">Bot</button>
          <button id="tab-log-btn" data-action="tab" data-tab="log">Log</button>
        </div>
  
        <!-- PROFILE TAB -->
        <div id="tab-profile">
          <div class="section">
            <label>Profile Label</label>
            <input id="g_label" placeholder="e.g. Ahmed Work VISA" />
            <label>Login Email</label>
            <input id="g_email" type="email" placeholder="your@email.com" />
            <label>Password</label>
            <input id="g_pass" type="password" placeholder="••••••••" />
          </div>
          <div class="section">
            <label>Full Name (as on document)</label>
            <input id="g_name" placeholder="Muhammad Ahmed" />
            <div class="row">
              <div><label>Phone</label><input id="g_phone" placeholder="0312XXXXXXX" /></div>
              <div><label>Mobile</label><input id="g_mobile" placeholder="+923XXXXXXXXX" /></div>
            </div>
          </div>
          <div class="section">
            <label>Region of Employment (Greece)</label>
            <select id="g_region">
              <option value="">-- Select Region --</option>
              ${REGIONS.map(r => `<option value="${r}">${r}</option>`).join('')}
            </select>
            <div class="row">
              <div><label>AM Number (6 digits)</label><input id="g_am" placeholder="XXXXXX" maxlength="6" /></div>
              <div><label>AM Year</label>
                <select id="g_year"><option value="2024">2024</option><option value="2025" selected>2025</option></select>
              </div>
            </div>
            <label>Apofasi Number (7 digits, NOT year)</label>
            <input id="g_apofasi" placeholder="XXXXXXX" maxlength="7" />
          </div>
          <button class="btn-save" data-action="save-profile">Save Profile</button>
          <div id="grcon_profiles_list"></div>
        </div>

        <!-- BOT TAB -->
        <div id="tab-bot" style="display:none">
          <div class="section">
            <label>Active Profile</label>
            <div id="grcon_active_profile" style="color:#94a3b8;font-size:11px;padding:4px">No profile selected</div>
          </div>
          <div class="section">
            <div class="row">
              <div><label>Retry (minutes)</label><input id="g_retry" type="number" value="5" min="1" max="60" /></div>
              <div><label>Max Retries</label><input id="g_max" type="number" value="200" min="1" /></div>
            </div>
            <label>Schedule URL</label>
            <input id="g_sched_url" value="https://schedule.cf-grcon-isl-pakistan.com/schedule/grcon-isl-pakistan/WORK_National_VISA" />
          </div>
          <button class="btn-login" data-action="do-login">Step 1: Login Now</button>
          <button class="btn-fill" data-action="fill-form">Step 2: Fill Form</button>
          <button class="btn-start" id="grcon_start_btn" data-action="start">Start Auto-Bot</button>
          <button class="btn-stop" id="grcon_stop_btn" style="display:none" data-action="stop">Stop Bot</button>
          <div id="grcon_status" style="text-align:center;font-size:11px;color:#94a3b8;padding:4px">Ready</div>
        </div>

        <!-- LOG TAB -->
        <div id="tab-log" style="display:none">
          <div id="grcon_log">Logs appear here...</div>
          <button data-action="clear-log" style="background:#1e2130;color:#94a3b8;border:1px solid #334155;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:10px;margin-top:4px;width:100%">Clear Log</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // ─── EVENT DELEGATION ──────────────────────────────────────────────────────
    // Tampermonkey isolates the userscript window from the page window, so inline
    // onclick="..." attributes cannot reach our window.grconXxx functions.
    // We attach a single delegated click listener inside the userscript context.
    panel.addEventListener('click', (e) => {
      const target = e.target.closest('[data-action]');
      if (!target) return;
      const action = target.dataset.action;
      switch (action) {
        case 'tab':
          window.grconTab(target.dataset.tab);
          break;
        case 'save-profile':
          window.grconSaveProfile();
          break;
        case 'do-login':
          window.grconDoLogin();
          break;
        case 'fill-form':
          window.grconFillForm();
          break;
        case 'start':
          window.grconStart();
          break;
        case 'stop':
          window.grconStop();
          break;
        case 'clear-log': {
          const logEl = document.getElementById('grcon_log');
          if (logEl) logEl.innerHTML = '';
          break;
        }
        case 'select-profile':
          window.grconSelectProfile(target.dataset.id);
          break;
        case 'load-profile':
          e.stopPropagation();
          window.grconLoadProfile(parseInt(target.dataset.idx, 10));
          break;
        case 'delete-profile':
          e.stopPropagation();
          window.grconDeleteProfile(parseInt(target.dataset.idx, 10));
          break;
      }
    });

    // ─── TAB SWITCHER ──────────────────────────────────────────────────────────
    window.grconTab = function(tab) {
      ['profile','bot','log'].forEach(t => {
        document.getElementById(`tab-${t}`).style.display = t === tab ? '' : 'none';
        const btn = document.getElementById(`tab-${t}-btn`);
        if (btn) btn.classList.toggle('active-tab', t === tab);
      });
    };
  
    // ─── DRAG ──────────────────────────────────────────────────────────────────
    (function() {
      const hdr = document.getElementById('grcon_hdr');
      let dragging = false, ox = 0, oy = 0;
      hdr.addEventListener('mousedown', e => {
        dragging = true; ox = e.clientX - panel.getBoundingClientRect().left;
        oy = e.clientY - panel.getBoundingClientRect().top;
      });
      document.addEventListener('mousemove', e => {
        if (!dragging) return;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        panel.style.left = (e.clientX - ox) + 'px';
        panel.style.top  = (e.clientY - oy) + 'px';
      });
      document.addEventListener('mouseup', () => dragging = false);
      document.getElementById('grcon_toggle').addEventListener('click', () => {
        const body = document.getElementById('grcon_body');
        const collapsed = body.style.display === 'none';
        body.style.display = collapsed ? '' : 'none';
        document.getElementById('grcon_toggle').textContent = collapsed ? '−' : '+';
      });
    })();
  
    // ─── RENDER PROFILES LIST ──────────────────────────────────────────────────
    function renderProfilesList() {
      const profiles = loadProfiles();
      const active = getActive();
      const el = document.getElementById('grcon_profiles_list');
      if (!el) return;
      if (profiles.length === 0) {
        el.innerHTML = '<div style="color:#6b7280;text-align:center;padding:8px;font-size:11px">No saved profiles</div>';
        return;
      }
      el.innerHTML = profiles.map((p, i) => `
        <div class="profile-card ${p.id === active ? 'active' : ''}" data-action="select-profile" data-id="${p.id}">
          <div>
            <div style="font-weight:bold;color:#e2e8f0">${p.label}</div>
            <div style="color:#64748b;font-size:10px">${p.email} · ${p.fullName}</div>
          </div>
          <div style="display:flex;gap:3px">
            <button class="btn-mini" style="background:#1e40af;color:#fff;border:none;cursor:pointer" data-action="load-profile" data-idx="${i}">Edit</button>
            <button class="btn-mini" style="background:#7f1d1d;color:#fff;border:none;cursor:pointer" data-action="delete-profile" data-idx="${i}">Del</button>
          </div>
        </div>
      `).join('');
  
      // Update active profile info in bot tab
      const ap = profiles.find(p => p.id === active);
      const apEl = document.getElementById('grcon_active_profile');
      if (apEl) {
        apEl.innerHTML = ap
          ? `<span style="color:#22c55e;font-weight:bold">${ap.label}</span><br><span style="color:#64748b">${ap.email}</span>`
          : '<span style="color:#ef4444">No profile selected — click a profile below</span>';
      }
    }
  
    // ─── SAVE PROFILE ──────────────────────────────────────────────────────────
    window.grconSaveProfile = function() {
      const email = document.getElementById('g_email').value.trim();
      const pass  = document.getElementById('g_pass').value;
      const label = document.getElementById('g_label').value.trim();
      const name  = document.getElementById('g_name').value.trim();
      if (!email || !pass || !label || !name) { alert('Please fill in Label, Email, Password and Full Name'); return; }
  
      const profiles = loadProfiles();
      const editing = window._grconEditIdx;
      const profile = {
        id: editing != null ? profiles[editing].id : Date.now().toString(),
        label,
        email,
        password: pass,
        fullName: name,
        phone: document.getElementById('g_phone').value.trim(),
        mobile: document.getElementById('g_mobile').value.trim(),
        region: document.getElementById('g_region').value,
        amNumber: document.getElementById('g_am').value.trim(),
        amYear: document.getElementById('g_year').value,
        apofasiNumber: document.getElementById('g_apofasi').value.trim(),
      };
  
      if (editing != null) { profiles[editing] = profile; window._grconEditIdx = null; }
      else { profiles.push(profile); }
      saveProfiles(profiles);
      log(`Profile saved: ${label}`);
      renderProfilesList();
      if (!getActive()) setActive(profile.id);
    };
  
    window.grconLoadProfile = function(idx) {
      const p = loadProfiles()[idx];
      if (!p) return;
      window._grconEditIdx = idx;
      document.getElementById('g_label').value  = p.label || '';
      document.getElementById('g_email').value  = p.email || '';
      document.getElementById('g_pass').value   = p.password || '';
      document.getElementById('g_name').value   = p.fullName || '';
      document.getElementById('g_phone').value  = p.phone || '';
      document.getElementById('g_mobile').value = p.mobile || '';
      document.getElementById('g_region').value = p.region || '';
      document.getElementById('g_am').value     = p.amNumber || '';
      document.getElementById('g_year').value   = p.amYear || '2025';
      document.getElementById('g_apofasi').value = p.apofasiNumber || '';
      grconTab('profile');
    };
  
    window.grconDeleteProfile = function(idx) {
      const profiles = loadProfiles();
      if (!confirm(`Delete profile "${profiles[idx].label}"?`)) return;
      profiles.splice(idx, 1);
      saveProfiles(profiles);
      renderProfilesList();
    };
  
    window.grconSelectProfile = function(id) {
      setActive(id);
      renderProfilesList();
      grconTab('bot');
      log(`Active profile set to ID: ${id}`);
    };
  
    // ─── GET ACTIVE PROFILE ────────────────────────────────────────────────────
    function getActiveProfile() {
      const id = getActive();
      return loadProfiles().find(p => p.id === id) || null;
    }
  
    // ─── FILL FORM ─────────────────────────────────────────────────────────────
    window.grconFillForm = function() {
      const p = getActiveProfile();
      if (!p) { alert('No active profile selected. Go to Profile tab and select one.'); return; }
  
      // Fill standard reservation fields
      setVal('reservation_full_name', p.fullName);
      setVal('oldres_full_name', p.fullName);
      setVal('reservation_phone', p.phone);
      setVal('oldres_phone', p.phone);
      setVal('reservation_mobile', p.mobile);
      setVal('oldres_mobile', p.mobile);
  
      // Fill Apofasi form fields
      const regionSel = document.getElementById('form_3');
      if (regionSel) { regionSel.value = p.region; regionSel.dispatchEvent(new Event('change', {bubbles:true})); }
  
      setVal('form_4', p.amNumber);
      const yearSel = document.getElementById('form_5') || document.querySelector('select[name="form[5]"]');
      if (yearSel) { yearSel.value = p.amYear; yearSel.dispatchEvent(new Event('change', {bubbles:true})); }
      setVal('form_7', p.apofasiNumber);
  
      // Also fill hidden fields if present
      setVal('reservation_full_name', p.fullName);
  
      log(`Form filled for: ${p.fullName}`);
      document.getElementById('grcon_status').textContent = 'Form filled!';
    };
  
    // ─── LOGIN ─────────────────────────────────────────────────────────────────
    window.grconDoLogin = function() {
      const p = getActiveProfile();
      if (!p) { alert('No active profile selected.'); return; }
      log(`Logging in as ${p.email}...`);
  
      // Navigate to login page if not already there
      const loginUrl = 'https://schedule.cf-grcon-isl-pakistan.com/schedule/grcon-isl-pakistan';
      if (!window.location.href.includes('/schedule/grcon-isl-pakistan') || isSchedulePage) {
        window.location.href = loginUrl;
        return;
      }
  
      // Fill login form
      const nameField = document.getElementById('name') || document.querySelector('input[name="name"]');
      const passField = document.getElementById('password') || document.querySelector('input[name="password"]');
      if (nameField && passField) {
        nameField.value = p.email;
        passField.value = p.password;
        log('Credentials filled. Submitting login...');
        setTimeout(() => {
          const form = nameField.closest('form');
          if (form) form.submit();
        }, 500);
      } else {
        log('Login form not found on this page. Navigate to the login page first.');
      }
    };
  
    // ─── BOT VARIABLES ─────────────────────────────────────────────────────────
    let botTimer = null;
    let botRunning = false;
    let retryCount = 0;
  
    function updateBotUI(running) {
      const dot   = document.getElementById('grcon_dot');
      const badge = document.getElementById('grcon_badge');
      const start = document.getElementById('grcon_start_btn');
      const stop  = document.getElementById('grcon_stop_btn');
      if (!dot) return;
      dot.className   = 'status-dot ' + (running ? 'dot-on' : 'dot-off');
      badge.textContent = running ? 'ON' : 'OFF';
      badge.className = 'badge ' + (running ? '' : 'off');
      if (start) start.style.display = running ? 'none' : '';
      if (stop)  stop.style.display  = running ? '' : 'none';
    }
  
    window.grconStart = function() {
      const p = getActiveProfile();
      if (!p) { alert('Select an active profile in the Profile tab first.'); return; }
      const interval = parseInt(document.getElementById('g_retry').value, 10) || 5;
      setInterval_(interval);
      botRunning = true;
      retryCount = 0;
      updateBotUI(true);
      log(`Bot started for ${p.label}. Retry every ${interval} min.`);
      document.getElementById('grcon_status').textContent = 'Bot running...';
      grconBotCycle();
    };
  
    window.grconStop = function() {
      botRunning = false;
      if (botTimer) { clearTimeout(botTimer); botTimer = null; }
      updateBotUI(false);
      log('Bot stopped by user.');
      document.getElementById('grcon_status').textContent = 'Stopped';
    };
  
    // ─── MAIN BOT CYCLE ────────────────────────────────────────────────────────
    function grconBotCycle() {
      if (!botRunning) return;
      const p = getActiveProfile();
      if (!p) { grconStop(); return; }
      const maxR = parseInt(document.getElementById('g_max').value, 10) || 200;
      retryCount++;
  
      if (retryCount > maxR) {
        log(`Max retries (${maxR}) reached. Stopping.`);
        grconStop();
        return;
      }
  
      document.getElementById('grcon_status').textContent = `Check #${retryCount} — ${new Date().toLocaleTimeString()}`;
  
      // If on login page, auto-login
      if (isLoginPage || window.location.pathname.endsWith('/grcon-isl-pakistan')) {
        log(`Check #${retryCount}: On login page. Logging in...`);
        autoLogin(p);
        return;
      }
  
      // If on schedule page, check for slots
      if (isSchedulePage || isFormPage) {
        log(`Check #${retryCount}: Checking for available slots...`);
        checkSlots(p);
        return;
      }
  
      // Navigate to the schedule
      const schedUrl = document.getElementById('g_sched_url').value || p.scheduleUrl ||
        'https://schedule.cf-grcon-isl-pakistan.com/schedule/grcon-isl-pakistan/WORK_National_VISA?view=free';
      log(`Check #${retryCount}: Navigating to schedule...`);
      window.location.href = schedUrl + (schedUrl.includes('?') ? '&' : '?') + 'view=free';
    }
  
    function autoLogin(p) {
      const nameField = document.getElementById('name') || document.querySelector('input[name="name"]');
      const passField = document.getElementById('password') || document.querySelector('input[name="password"]');
      if (nameField && passField) {
        nameField.value = p.email;
        passField.value = p.password;
        log('Auto-logging in...');
        setTimeout(() => {
          const form = nameField.closest('form');
          if (form) form.submit();
        }, 1000);
      } else {
        scheduleNextCheck();
      }
    }
  
    function checkSlots(p) {
      const freeContainer = document.getElementById('container');
      const noRoom = document.getElementById('noroom');
      const noSlotText = freeContainer && freeContainer.textContent.includes('No available space found');
      const hasSlot = !noSlotText && (
        document.querySelector('.avail') ||
        document.querySelector('td.free') ||
        document.querySelector('a[href*="view=free"]') ||
        (freeContainer && !noSlotText && freeContainer.querySelector('form'))
      );
  
      if (noSlotText || (noRoom && noRoom.style.display !== 'none')) {
        log(`Check #${retryCount}: No slots available. Next check in ${getInterval()} min.`);
        scheduleNextCheck();
        return;
      }
  
      if (hasSlot) {
        log(`Check #${retryCount}: SLOT FOUND! Attempting to fill and book...`);
        handleSlotFound(p);
        return;
      }
  
      // If on the form page (slot was clicked), fill it
      if (document.querySelector('table#outer') || document.querySelector('#reservation_start_time')) {
        log(`Check #${retryCount}: On booking form. Filling and submitting...`);
        fillAndSubmit(p);
        return;
      }
  
      log(`Check #${retryCount}: Unclear page state. Refreshing schedule...`);
      scheduleNextCheck();
    }
  
    function handleSlotFound(p) {
      // Try to click the first available slot
      const firstFree = document.querySelector('td.free a, .avail a, [class*="free"] a');
      if (firstFree) {
        log('Clicking first available slot...');
        firstFree.click();
        // After navigation to form, fill it — handled on next page load
        return;
      }
  
      // Try finding any clickable slot in the calendar
      const cells = document.querySelectorAll('td');
      for (const cell of cells) {
        if (cell.className.includes('free') || cell.className.includes('avail')) {
          cell.click();
          log('Clicked a free slot in calendar.');
          return;
        }
      }
  
      log('Slot detected but could not click. Will retry.');
      scheduleNextCheck();
    }
  
    function fillAndSubmit(p) {
      // Fill all visible form fields
      grconFillForm();
  
      setTimeout(() => {
        // Find and submit the form
        const submitBtn = document.querySelector('input[type="submit"], button[type="submit"]');
        const form = document.querySelector('form.auto-spin, form#outer, table#outer').closest
          ? document.querySelector('table#outer')?.closest('form')
          : null;
  
        if (submitBtn) {
          log('Submitting booking form...');
          submitBtn.click();
          notify('Appointment Booked!', `Slot booked for ${p.fullName}! Check the schedule.`);
          grconStop();
        } else if (form) {
          log('Submitting form...');
          form.submit();
          notify('Appointment Booked!', `Slot booked for ${p.fullName}!`);
          grconStop();
        } else {
          log('Could not find submit button. Manual submission may be needed.');
          scheduleNextCheck();
        }
      }, 1500);
    }
  
    function scheduleNextCheck() {
      if (!botRunning) return;
      const mins = getInterval();
      const ms = mins * 60 * 1000;
      log(`Next check in ${mins} minute(s)...`);
  
      // Reload the page with free view after interval
      botTimer = setTimeout(() => {
        if (!botRunning) return;
        const schedUrl = (document.getElementById('g_sched_url') && document.getElementById('g_sched_url').value) ||
          'https://schedule.cf-grcon-isl-pakistan.com/schedule/grcon-isl-pakistan/WORK_National_VISA';
        window.location.href = schedUrl + '?view=free&_t=' + Date.now();
      }, ms);
    }
  
    // ─── AUTO-ACTIONS ON PAGE LOAD ─────────────────────────────────────────────
    window.addEventListener('load', () => {
      renderProfilesList();
      const p = getActiveProfile();
      if (!p) return;
  
      // Auto-login if on login page and bot was running
      if (isLoginPage && GM_getValue('grcon_bot_was_running', false)) {
        log('Auto-resuming: logging in...');
        setTimeout(() => autoLogin(p), 1000);
        return;
      }
  
      // Auto-fill and submit if we arrive on the booking form page
      if (isFormPage && document.querySelector('table#outer') && GM_getValue('grcon_bot_was_running', false)) {
        log('Auto-resuming: on booking form, filling...');
        setTimeout(() => fillAndSubmit(p), 1500);
        return;
      }
  
      // Auto-check slots if on schedule page and bot was running
      if (isSchedulePage && GM_getValue('grcon_bot_was_running', false)) {
        log('Auto-resuming: checking slots...');
        retryCount++;
        setTimeout(() => checkSlots(p), 1500);
        return;
      }
    });
  
    // Persist bot state across page loads
    const origStart = window.grconStart;
    window.grconStart = function() {
      GM_setValue('grcon_bot_was_running', true);
      origStart();
    };
    const origStop = window.grconStop;
    window.grconStop = function() {
      GM_setValue('grcon_bot_was_running', false);
      origStop();
    };
  
    // ─── INIT ──────────────────────────────────────────────────────────────────
    renderProfilesList();
    updateBotUI(false);
    log('Bot panel loaded. Select or create a profile to begin.');
  
    // Auto-switch to bot tab if already has profiles
    if (loadProfiles().length > 0 && getActive()) {
      grconTab('bot');
    }
  
  })();