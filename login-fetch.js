
(function () {
    'use strict';

    /* ================= CONFIG ================= */
    const DEFAULT_PASS = 'muneeb6484';
    const resource_id = '1134189';
    const baseUrl = window.location.origin;
    const loginUrl = baseUrl + '/schedule/login/grcon-isl-pakistan/WORK_National_VISA';
    const appointmentUrl = baseUrl + '/schedule/grcon-isl-pakistan/WORK_National_VISA';
    const logoutUrl = baseUrl + '/users/logout/grcon-isl-pakistan?return=WORK_National_VISA';
    
    function getPassportFormUrl(date, hour, min) {
        const parts = date.split('-');
        const month = parseInt(parts[1]);
        const day = parseInt(parts[2]);
        return `${baseUrl}/schedule/grcon-isl-pakistan/WORK_National_VISA?view=free&day=${day}&month=${month}&hour=${hour}&min=${min}`;
    }

    /* ================= USERS DATA (from local CSV via Tampermonkey) ================= */
    const USERS_KEY = 'gujjar_users_data';
    let preload = [];

    function parseCSV(csvText) {
        const clean = csvText.replace(/^\uFEFF/, '');
        const lines = clean.trim().split('\n');
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.trim().replace(/^\uFEFF/, ''));
        const users = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            const vals = [];
            let current = '';
            let inQuotes = false;
            for (let c = 0; c < line.length; c++) {
                if (line[c] === '"') { inQuotes = !inQuotes; }
                else if (line[c] === ',' && !inQuotes) { vals.push(current.trim()); current = ''; }
                else { current += line[c]; }
            }
            vals.push(current.trim());
            const obj = {};
            headers.forEach((h, idx) => { obj[h] = vals[idx] || ''; });
            if (obj.email && obj.name) users.push(obj);
        }
        return users;
    }

    function saveUsersToStorage(users) {
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }

    function handleCSVUpload(file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const users = parseCSV(e.target.result);
            if (users.length === 0) {
                showToast('fail', { name: 'CSV Error', email: '-' }, 'No valid users found in CSV');
                return;
            }
            preload = users;
            saveUsersToStorage(users);
            console.log(`📁 Loaded ${users.length} users from CSV`);
            showToast('success', { name: 'CSV Loaded', email: `${users.length} users` }, 'Data saved to localStorage');
            rebuildPanel();
        };
        reader.readAsText(file, 'UTF-8');
    }

    function loadUsers() {
        // 1) Try localStorage override first
        try {
            const saved = JSON.parse(localStorage.getItem(USERS_KEY) || '[]');
            if (saved.length > 0) {
                preload = saved;
                console.log(`📦 Loaded ${preload.length} users from localStorage`);
                return;
            }
        } catch(e) {}

        // 2) Try loading from local CSV file via Tampermonkey @resource
        try {
            const csvText = GM_getResourceText('usersCSV');
            if (csvText) {
                preload = parseCSV(csvText);
                if (preload.length > 0) {
                    console.log(`📄 Loaded ${preload.length} users from local CSV file`);
                    return;
                }
            }
        } catch(e) {
            console.log('⚠️ GM_getResourceText not available, trying GM_xmlhttpRequest...');
        }

        // 3) Fallback: try reading file directly via GM_xmlhttpRequest
        try {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'file:///D:/personal/ext-waheed/users.csv',
                onload: function(response) {
                    if ((response.status === 200 || response.status === 0) && response.responseText) {
                        const users = parseCSV(response.responseText);
                        if (users.length > 0) {
                            preload = users;
                            console.log(`📄 Loaded ${preload.length} users from CSV file (xmlhttp)`);
                            rebuildPanel();
                            return;
                        }
                    }
                    loadFallbackUsers();
                },
                onerror: function() {
                    console.log('⚠️ File access blocked, using built-in data');
                    loadFallbackUsers();
                }
            });
        } catch(e) {
            loadFallbackUsers();
        }
    }

    function loadFallbackUsers() {
        if (preload.length > 0) return;
        preload = parseCSV('');
        console.log(`📄 Loaded ${preload.length} users (built-in fallback)`);
        rebuildPanel();
    }

    loadUsers();

    let slots = [
        ["9:00 "," 9:05"],["9:05 "," 9:10"],["9:10 "," 9:15"],["9:15 "," 9:20"],
        ["9:20 "," 9:25"],["9:25 "," 9:30"],["9:30 "," 9:35"],["9:35 "," 9:40"],
        ["9:40 "," 9:45"],["9:45 "," 9:50"],["9:50 "," 9:55"],["9:55 "," 10:00"],
        ["10:00 "," 10:05"],["10:05 "," 10:10"],["10:10 "," 10:15"],["10:15 "," 10:20"],
        ["10:20 "," 10:25"],["10:25 "," 10:30"],["10:30 "," 10:35"],["10:35 "," 10:40"],
        ["10:40 "," 10:45"],["10:45 "," 10:50"]
    ];

    /* ================= BOOKING WATCHER (auto-check every 1 min) ================= */
    const WATCHER_KEY = 'gujjar_watcher_active';
    const AUTOBOOK_KEY = 'gujjar_autobook';
    let watcherInterval = null;

    function isWatcherActive() {
        return localStorage.getItem(WATCHER_KEY) === 'true';
    }

    function setWatcherState(active) {
        localStorage.setItem(WATCHER_KEY, active ? 'true' : 'false');
    }

    function isAutoBookEnabled() {
        return localStorage.getItem(AUTOBOOK_KEY) === 'true';
    }

    function setAutoBookState(enabled) {
        localStorage.setItem(AUTOBOOK_KEY, enabled ? 'true' : 'false');
    }

    async function checkBookingStatus() {
        console.log('🔍 Checking if bookings are open...');
        const statusEl = document.getElementById('watcherStatus');
        if (statusEl) statusEl.textContent = `Checking... (${new Date().toLocaleTimeString()})`;

        try {
            const response = await fetch(appointmentUrl, { method: 'GET', credentials: 'include' });

            if (!response.ok) {
                console.log(`⚠️ Server error ${response.status}:`, new Date().toLocaleTimeString());
                if (statusEl) statusEl.textContent = `⚠️ Server ${response.status} (${new Date().toLocaleTimeString()})`;
                return false;
            }

            const html = await response.text();
            const htmlLower = html.toLowerCase();
            const closed = htmlLower.includes('is closed') || htmlLower.includes('no available appointments') || htmlLower.includes('کوئی دستیاب اپوائنٹمنٹس');
            const hasScheduleContent = htmlLower.includes('schedule') || htmlLower.includes('reservation') || htmlLower.includes('appointment');

            if (closed) {
                console.log('🚫 Still closed:', new Date().toLocaleTimeString());
                if (statusEl) statusEl.textContent = `🚫 Closed (${new Date().toLocaleTimeString()})`;
                return false;
            } else if (!hasScheduleContent) {
                console.log('⚠️ Unexpected response (no schedule content):', new Date().toLocaleTimeString());
                if (statusEl) statusEl.textContent = `⚠️ Unexpected page (${new Date().toLocaleTimeString()})`;
                return false;
            } else {
                console.log('🟢 BOOKINGS ARE OPEN!');
                if (statusEl) statusEl.textContent = `🟢 OPEN! (${new Date().toLocaleTimeString()})`;
                stopWatcher();
                showBookingOpenAlert();
                if (isAutoBookEnabled()) {
                    console.log('🚀 Auto-Book ON — starting sequential booking with 10s delay...');
                    const startSlot = getNextAvailableSlot(0);
                    runAll(startSlot < 0 ? 0 : startSlot, 10000);
                }
                return true;
            }
        } catch (error) {
            console.error('❌ Watcher check error:', error);
            if (statusEl) statusEl.textContent = `❌ Network Error (${new Date().toLocaleTimeString()})`;
            return false;
        }
    }

    function startWatcher() {
        if (watcherInterval) return;
        setWatcherState(true);
        updateWatcherUI(true);
        checkBookingStatus();
        watcherInterval = setInterval(checkBookingStatus, 60000);
        console.log('👁️ Watcher started - checking every 1 minute');
    }

    function stopWatcher() {
        if (watcherInterval) {
            clearInterval(watcherInterval);
            watcherInterval = null;
        }
        setWatcherState(false);
        updateWatcherUI(false);
        console.log('⏹️ Watcher stopped');
    }

    function updateWatcherUI(active) {
        const startBtn = document.getElementById('watcherStartBtn');
        const stopBtn = document.getElementById('watcherStopBtn');
        const dot = document.getElementById('watcherDot');
        if (startBtn) startBtn.disabled = active;
        if (stopBtn) stopBtn.disabled = !active;
        if (dot) {
            dot.style.background = active ? '#22c55e' : '#94a3b8';
            dot.style.boxShadow = active ? '0 0 8px #22c55e' : 'none';
        }
    }

    function showBookingOpenAlert() {
        ensureToastContainer();
        const toast = document.createElement('div');
        toast.style.cssText = `
            pointer-events:auto;
            background:linear-gradient(135deg, #065f46 0%, #10b981 100%);
            color:#fff;padding:0;border-radius:12px;
            box-shadow:0 8px 32px rgba(16,185,129,0.4);
            font-family:system-ui,-apple-system,sans-serif;
            overflow:hidden;
            animation: toastSlideIn 0.4s cubic-bezier(0.16,1,0.3,1);
        `;
        const autoMsg = isAutoBookEnabled() ? '<div style="font-size:12px;margin-top:6px;padding:4px 10px;background:rgba(255,255,255,0.15);border-radius:4px;">🚀 Auto-Book ON — starting bookings...</div>' : '';
        toast.innerHTML = `
            <div style="padding:16px 20px;text-align:center;">
                <div style="font-size:36px;margin-bottom:8px;">🟢</div>
                <div style="font-size:18px;font-weight:800;margin-bottom:4px;">BOOKINGS ARE OPEN!</div>
                <div style="font-size:13px;opacity:0.9;">Schedule is now accepting appointments</div>
                ${autoMsg}
                <div style="font-size:11px;opacity:0.7;margin-top:6px;">${new Date().toLocaleTimeString()}</div>
                <button onclick="this.closest('div').parentElement.remove()" style="margin-top:10px;padding:6px 20px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:#fff;border-radius:6px;cursor:pointer;font-weight:600;font-size:12px;">Dismiss</button>
            </div>
        `;
        toastContainer.appendChild(toast);

        // Browser notification
        if (Notification.permission === 'granted') {
            new Notification('Bookings are OPEN!', { body: 'Schedule is now accepting appointments. Go book now!', icon: '🟢' });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission();
        }

        // Sound alert
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            [523.25, 659.25, 783.99].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = freq;
                osc.type = 'sine';
                gain.gain.value = 0.3;
                osc.start(ctx.currentTime + i * 0.2);
                osc.stop(ctx.currentTime + i * 0.2 + 0.15);
            });
        } catch(e) {}
    }

    /* ================= SLOT TRACKER ================= */
    const slotTracker = {};

    function markSlot(slotIndex, status, userEmail) {
        slotTracker[slotIndex] = { status, userEmail, time: new Date().toISOString() };
        console.log(`🎰 Slot ${slotIndex} (${slots[slotIndex][0].trim()}-${slots[slotIndex][1].trim()}) → ${status} [${userEmail || ''}]`);
        updateNextSlotInfo();
    }

    function updateNextSlotInfo() {
        const el = document.getElementById('nextSlotInfo');
        if (!el) return;
        const next = getNextAvailableSlot(0);
        if (next < 0 || next >= slots.length) {
            el.innerHTML = '🎰 Next Slot: <b style="color:#dc2626;">No slots available</b>';
        } else {
            el.innerHTML = `🎰 Next Slot: <b>${next}: ${slots[next][0].trim()} - ${slots[next][1].trim()}</b>`;
        }
    }

    function getNextAvailableSlot(startIndex) {
        for (let i = startIndex; i < slots.length; i++) {
            if (!slotTracker[i] || slotTracker[i].status !== 'booked') {
                return i;
            }
        }
        return -1;
    }

    /* ================= BOOKING RESULTS STORAGE ================= */
    const STORAGE_KEY = 'gujjar_booking_results';
    let sessionResults = [];

    function saveBookingResult(record) {
        sessionResults.push(record);
        let existing = [];
        try { existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(e) {}
        existing.push(record);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
        updateDownloadBar();
    }

    function getAllBookingResults() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(e) { return []; }
    }

    /* ================= DOWNLOAD BAR (appears after bookings) ================= */
    function updateDownloadBar() {
        const bar = document.getElementById('gujjar_download_bar');
        if (!bar) return;
        const count = sessionResults.length;
        const allCount = getAllBookingResults().length;
        if (count === 0 && allCount === 0) {
            bar.style.display = 'none';
            return;
        }
        bar.style.display = 'block';
        bar.innerHTML = `
            <div style="font-size:11px;color:#555;margin-bottom:6px;font-weight:600;">📊 Results: ${count} this session | ${allCount} total saved</div>
            <div style="display:flex;gap:6px;">
                <a id="dlSessionCsv" href="#" style="flex:1;display:block;text-align:center;padding:7px 0;background:#1a7f37;color:#fff;border-radius:4px;font-size:10px;font-weight:700;text-decoration:none;cursor:pointer;">📁 Session CSV (${count})</a>
                <a id="dlAllCsv" href="#" style="flex:1;display:block;text-align:center;padding:7px 0;background:#6e40c9;color:#fff;border-radius:4px;font-size:10px;font-weight:700;text-decoration:none;cursor:pointer;">📁 All Results CSV (${allCount})</a>
            </div>
        `;
        bar.querySelector('#dlSessionCsv').onclick = (e) => { e.preventDefault(); if(sessionResults.length) downloadCSV(sessionResults, 'session'); };
        bar.querySelector('#dlAllCsv').onclick = (e) => { e.preventDefault(); const r = getAllBookingResults(); if(r.length) downloadCSV(r, 'all'); };
    }

    /* ================= CSV DOWNLOAD ================= */
    function downloadCSV(results, label) {
        const headers = ['Date','Name','Email','Phone','Passport','City','Father Name','Slot','Slot Time','Status','Passport Form','Timestamp'];
        const rows = results.map(r => [
            r.date || '',
            r.name || '',
            r.email || '',
            r.phone || '',
            r.passport || '',
            r.city || '',
            r.fname || '',
            r.slotIndex != null ? `Slot ${r.slotIndex}` : '',
            r.slotTime || '',
            r.status || '',
            r.passportForm ? 'Yes' : 'No',
            r.timestamp || ''
        ]);

        let csv = '\uFEFF' + headers.join(',') + '\n';
        rows.forEach(row => {
            csv += row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `booking-${label || 'results'}-${getCurrentDate()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log('📁 CSV downloaded:', a.download);
    }

    /* ================= JSON DOWNLOAD (from localStorage) ================= */
    function downloadLocalStorageJSON() {
        const allKeys = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            try { allKeys[key] = JSON.parse(localStorage.getItem(key)); } catch(e) { allKeys[key] = localStorage.getItem(key); }
        }
        const blob = new Blob([JSON.stringify(allKeys, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `localStorage-dump-${getCurrentDate()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log('📁 JSON downloaded:', a.download);
    }
    function downloadTMStorage() {
        const data = GM_getValue("gondal_accounts_v4");

        if (!data) {
            console.log("❌ Key not found in Tampermonkey storage");
            return;
        }

        const blob = new Blob(
            [JSON.stringify(data, null, 2)],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");

        a.href = url;
        a.download = `tm-storage-${Date.now()}.json`;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);

        console.log("📁 Tampermonkey JSON downloaded");
    }
    /* ================= CUSTOM TOAST NOTIFICATION ================= */
    let toastContainer = null;

    function ensureToastContainer() {
        if (toastContainer && document.body.contains(toastContainer)) return;
        toastContainer = document.createElement('div');
        toastContainer.id = 'gujjar_toast_container';
        toastContainer.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999999;display:flex;flex-direction:column;gap:10px;pointer-events:none;max-width:460px;width:90%;';
        document.body.appendChild(toastContainer);
    }

    function showToast(type, user, slotInfo) {
        ensureToastContainer();

        const isClosed = type === 'closed';
        const isSuccess = type === 'success';
        let bg, shadow;
        if (isClosed) {
            bg = 'linear-gradient(135deg, #7c2d12 0%, #ea580c 100%)';
            shadow = 'rgba(234,88,12,0.35)';
        } else if (isSuccess) {
            bg = 'linear-gradient(135deg, #0f5132 0%, #198754 100%)';
            shadow = 'rgba(25,135,84,0.35)';
        } else {
            bg = 'linear-gradient(135deg, #842029 0%, #dc3545 100%)';
            shadow = 'rgba(220,53,69,0.35)';
        }

        const toast = document.createElement('div');
        toast.style.cssText = `
            pointer-events:auto;
            background: ${bg};
            color:#fff;
            padding:0;
            border-radius:12px;
            box-shadow: 0 8px 32px ${shadow};
            font-family:system-ui,-apple-system,sans-serif;
            overflow:hidden;
            animation: toastSlideIn 0.4s cubic-bezier(0.16,1,0.3,1);
            transform-origin: top center;
        `;

        let icon, title;
        if (isClosed) {
            icon = '🚫';
            title = 'Schedule Closed - No Appointments';
        } else if (isSuccess) {
            icon = '✅';
            title = 'Booking Successful';
        } else {
            icon = '❌';
            title = 'Booking Failed';
        }

        toast.innerHTML = `
            <div style="padding:14px 18px 10px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(255,255,255,0.15);">
                <span style="font-size:22px;">${icon}</span>
                <span style="font-size:15px;font-weight:700;letter-spacing:0.3px;">${title}</span>
                <button onclick="this.closest('div').parentElement.remove()" style="margin-left:auto;background:rgba(255,255,255,0.15);border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;">×</button>
            </div>
            <div style="padding:12px 18px 14px;">
                <div style="display:grid;grid-template-columns:70px 1fr;gap:4px 8px;font-size:13px;">
                    <span style="opacity:0.7;font-weight:600;">Name</span>
                    <span style="font-weight:600;">${user.name || '-'}</span>
                    <span style="opacity:0.7;font-weight:600;">Email</span>
                    <span>${user.email || '-'}</span>
                    <span style="opacity:0.7;font-weight:600;">Slot</span>
                    <span style="font-weight:600;">${slotInfo || '-'}</span>
                </div>
            </div>
        `;

        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.transition = 'all 0.4s cubic-bezier(0.16,1,0.3,1)';
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-20px) scale(0.95)';
            setTimeout(() => toast.remove(), 400);
        }, 6000);
    }

    function addToastAnimation() {
        if (document.getElementById('gujjar_toast_anim')) return;
        const s = document.createElement('style');
        s.id = 'gujjar_toast_anim';
        s.textContent = `@keyframes toastSlideIn{0%{opacity:0;transform:translateY(-30px) scale(0.9)}100%{opacity:1;transform:translateY(0) scale(1)}}`;
        document.head.appendChild(s);
    }

    /* ================= LOGIN FUNCTION ================= */
    async function doLogin(user) {
        const formData = new URLSearchParams();
        formData.append('name', user.email);
        formData.append('password', user.pass);

        console.log('🔐 LOGIN:', user.email);

        try {
            const response = await fetch(loginUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData.toString(),
            });

            const html = await response.text();
            const htmlLower = html.toLowerCase();
            const closed = htmlLower.includes('is closed') || htmlLower.includes('no available appointments') || htmlLower.includes('کوئی دستیاب اپوائنٹمنٹس');
            const success = !closed && response.ok && (html.includes('logout') || html.includes('Logout') || !html.includes('Log in'));
            
            if (closed) {
                console.log('🚫 LOGIN: Schedule is CLOSED - No appointments available');
            } else {
                console.log(success ? '✅ Login OK' : '❌ Login FAIL', '- Status:', response.status);
            }
            return { success, status: response.status, html, closed };
            
        } catch (error) {
            console.error('❌ LOGIN ERROR:', error);
            return { success: false, error: error.message, closed: false };
        }
    }

    /* ================= BOOK APPOINTMENT FUNCTION ================= */
    async function bookAppointment(user, startTime, finishTime) {
        const formData = new URLSearchParams();
        formData.append('reservation[start_time]', startTime);
        formData.append('reservation[finish_time]', finishTime);
        formData.append('reservation[full_name]', user.name);
        formData.append('reservation[phone]', user.phone);
        formData.append('reservation[mobile]', user.phone);
        formData.append('reservation[resource_id]', resource_id);
        formData.append('reservation[xpos]', '');
        formData.append('reservation[ypos]', '');

        console.log('📅 BOOK:', user.name, '|', startTime, '-', finishTime);

        try {
            const response = await fetch(appointmentUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData.toString(),
                credentials: 'include'
            });

            const html = await response.text();
            const htmlLower = html.toLowerCase();
            const closed = htmlLower.includes('is closed') || htmlLower.includes('no available appointments') || htmlLower.includes('کوئی دستیاب اپوائنٹمنٹس');
            const alreadyBooked = !closed && (htmlLower.includes('already') || htmlLower.includes('not available') || htmlLower.includes('taken'));
            const success = response.ok && !alreadyBooked && !closed;

            if (closed) {
                console.log('🚫 SCHEDULE CLOSED - No appointments available!');
            } else {
                console.log(success ? '✅ Booked' : (alreadyBooked ? '⚠️ Already Booked' : '❌ Failed'), '- Status:', response.status);
            }
            
            return { success, status: response.status, html, user: user.name, alreadyBooked, closed };
            
        } catch (error) {
            console.error('❌ BOOK ERROR:', error);
            return { success: false, error: error.message, user: user.name, alreadyBooked: false, closed: false };
        }
    }

    /* ================= SUBMIT PASSPORT FORM ================= */
    async function submitPassportForm(user, startTime, finishTime) {
        const [datePart, timePart] = startTime.split(' ');
        const [hour, min] = timePart.split(':');
        
        const formUrl = getPassportFormUrl(datePart, hour, min);
        
        const formData = new URLSearchParams();
        
        formData.append('form[3]', user.region || '');
        formData.append('form[4]', user.am || '');
        formData.append('form[6]', user.year || '2025');
        formData.append('form[7]', user.apofasi || '');
        formData.append('form[5]', (user.greek || '').toUpperCase());
        formData.append('form[1]', (user.pno || '').toUpperCase());
        formData.append('form[19][]', 'I DECLARE THAT ALL ABOVE INFORMATION IS ACCURATE.');
        
        formData.append('reservation[start_time]', startTime);
        formData.append('reservation[finish_time]', finishTime);
        formData.append('reservation[full_name]', user.name);
        formData.append('reservation[phone]', user.phone);
        formData.append('reservation[mobile]', user.phone);
        formData.append('reservation[resource_id]', resource_id);
        formData.append('reservation[xpos]', '');
        formData.append('reservation[ypos]', '');

        console.log('📝 PASSPORT FORM:', user.name);

        try {
            const response = await fetch(formUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData.toString(),
                credentials: 'include'
            });

            const html = await response.text();
            const success = response.ok && !html.toLowerCase().includes('error');
            
            console.log(success ? '✅ Form Submitted' : '❌ Form Failed', '- Status:', response.status);
            
            return { success, status: response.status, html, user: user.name };
            
        } catch (error) {
            console.error('❌ PASSPORT FORM ERROR:', error);
            return { success: false, error: error.message, user: user.name };
        }
    }

    /* ================= LOGOUT FUNCTION ================= */
    async function doLogout() {
        console.log('🚪 LOGOUT...');

        try {
            const response = await fetch(logoutUrl, {
                method: 'GET',
                credentials: 'include'
            });

            console.log('🚪 Logout OK - Status:', response.status);
            return { success: response.ok, status: response.status };
            
        } catch (error) {
            console.error('❌ LOGOUT ERROR:', error);
            return { success: false, error: error.message };
        }
    }

    /* ================= UTILITY ================= */
    function getCurrentDate() {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function randomDelay(min, max) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        console.log(`⏳ Waiting ${delay}ms...`);
        return new Promise(r => setTimeout(r, delay));
    }

    /* ================= BUILD BOOKING RECORD ================= */
    function buildRecord(user, slotIndex, slot, status, passportFormOk) {
        return {
            date: getCurrentDate(),
            name: user.name,
            email: user.email,
            phone: user.phone,
            passport: user.pno,
            city: user.city,
            fname: user.fname,
            slotIndex: slotIndex,
            slotTime: slot ? `${slot[0].trim()} - ${slot[1].trim()}` : '',
            status: status,
            passportForm: passportFormOk,
            timestamp: new Date().toISOString()
        };
    }

    /* ================= FULL FLOW: LOGIN -> BOOK -> LOGOUT ================= */
    async function runAll(startSlotIndex = 0, delayMs = 3000) {
        const currentDate = getCurrentDate();
        
        console.log('\n🚀🚀🚀 LOGIN -> BOOK -> LOGOUT FOR ALL USERS 🚀🚀🚀');
        console.log('📅 Date:', currentDate);
        console.log('🎰 Starting from slot:', startSlotIndex);
        console.log('👥 Total users:', preload.length);
        console.log('⏱️ Delay:', delayMs, 'ms');
        console.log('========================================\n');

        const results = [];
        let slotIndex = startSlotIndex;

        for (let i = 0; i < preload.length; i++) {
            const user = preload[i];
            console.log(`\n[${i + 1}/${preload.length}] ===== ${user.name} (${user.email}) =====`);
            
            slotIndex = getNextAvailableSlot(slotIndex);
            if (slotIndex < 0 || slotIndex >= slots.length) {
                console.log('❌ No more slots available!');
                const rec = buildRecord(user, null, null, 'NO_SLOT', false);
                saveBookingResult(rec);
                showToast('fail', user, 'No slot available');
                results.push({ user: user.name, email: user.email, login: false, book: false, logout: false, slot: null });
                continue;
            }

            const slot = slots[slotIndex];
            const slotTime = `${slot[0].trim()} - ${slot[1].trim()}`;
            const startTime = currentDate + ' ' + slot[0].trim();
            const finishTime = currentDate + ' ' + slot[1].trim();
            
            console.log('🎰 Slot:', slotIndex, '|', startTime, '-', finishTime);

            const card = document.getElementById(`user-card-${i}`);
            const statusEl = document.getElementById(`status-${i}`);
            if (card) card.className = 'user-card processing';
            if (statusEl) statusEl.textContent = `Trying slot ${slotIndex} (${slotTime})...`;

            const loginResult = await doLogin(user);

            // Schedule closed detected at login
            if (loginResult.closed) {
                console.log('🚫 SCHEDULE CLOSED at login! Stopping all bookings.');
                showToast('closed', user, slotTime);
                const rec = buildRecord(user, slotIndex, slot, 'CLOSED', false);
                saveBookingResult(rec);
                if (card) card.className = 'user-card failed';
                if (statusEl) statusEl.textContent = '🚫 Schedule Closed - No Appointments Available';
                results.push({ user: user.name, email: user.email, login: false, book: false, logout: false, slot: slot, closed: true });
                for (let j = i + 1; j < preload.length; j++) {
                    const ru = preload[j];
                    const rc = document.getElementById(`user-card-${j}`);
                    const rs = document.getElementById(`status-${j}`);
                    if (rc) rc.className = 'user-card failed';
                    if (rs) rs.textContent = '🚫 Skipped - Schedule Closed';
                    const rrec = buildRecord(ru, null, null, 'CLOSED', false);
                    saveBookingResult(rrec);
                    results.push({ user: ru.name, email: ru.email, login: false, book: false, logout: false, slot: null, closed: true });
                }
                break;
            }
            
            if (!loginResult.success) {
                console.log('⏭️ Skipping - login failed');
                const rec = buildRecord(user, slotIndex, slot, 'LOGIN_FAILED', false);
                saveBookingResult(rec);
                showToast('fail', user, slotTime);
                if (card) card.className = 'user-card failed';
                if (statusEl) statusEl.textContent = 'Login failed';
                results.push({ user: user.name, email: user.email, login: false, book: false, logout: false, slot: slot });
                await randomDelay(2000, 4000);
                continue;
            }

            await randomDelay(1000, 2000);
            
            let bookResult = await bookAppointment(user, startTime, finishTime);

            // Schedule closed - stop everything
            if (bookResult.closed) {
                console.log('🚫 SCHEDULE CLOSED! Stopping all bookings.');
                showToast('closed', user, slotTime);
                const rec = buildRecord(user, slotIndex, slot, 'CLOSED', false);
                saveBookingResult(rec);
                if (card) card.className = 'user-card failed';
                if (statusEl) statusEl.textContent = '🚫 Schedule Closed - No Appointments Available';
                await doLogout();
                results.push({ user: user.name, email: user.email, login: true, book: false, logout: true, slot: slot, closed: true });
                // Mark remaining users
                for (let j = i + 1; j < preload.length; j++) {
                    const ru = preload[j];
                    const rc = document.getElementById(`user-card-${j}`);
                    const rs = document.getElementById(`status-${j}`);
                    if (rc) rc.className = 'user-card failed';
                    if (rs) rs.textContent = '🚫 Skipped - Schedule Closed';
                    const rrec = buildRecord(ru, null, null, 'CLOSED', false);
                    saveBookingResult(rrec);
                    results.push({ user: ru.name, email: ru.email, login: false, book: false, logout: false, slot: null, closed: true });
                }
                break;
            }

            // If slot already booked, try next available slots
            let retries = 0;
            while (bookResult.alreadyBooked && retries < 5) {
                markSlot(slotIndex, 'already_booked', '');
                console.log(`⚠️ Slot ${slotIndex} already booked, trying next...`);
                slotIndex++;
                const nextSlot = getNextAvailableSlot(slotIndex);
                if (nextSlot < 0 || nextSlot >= slots.length) break;
                slotIndex = nextSlot;
                const nSlot = slots[slotIndex];
                const nStart = currentDate + ' ' + nSlot[0].trim();
                const nFinish = currentDate + ' ' + nSlot[1].trim();
                console.log(`🔄 Retrying with slot ${slotIndex}: ${nStart} - ${nFinish}`);
                if (statusEl) statusEl.textContent = `Retry slot ${slotIndex} (${nSlot[0].trim()}-${nSlot[1].trim()})...`;
                await randomDelay(500, 1000);
                bookResult = await bookAppointment(user, nStart, nFinish);
                if (bookResult.closed) break;
                retries++;
            }

            // Check closed again after retries
            if (bookResult.closed) {
                console.log('🚫 SCHEDULE CLOSED during retry! Stopping all bookings.');
                showToast('closed', user, `${slots[slotIndex][0].trim()} - ${slots[slotIndex][1].trim()}`);
                const rec = buildRecord(user, slotIndex, slots[slotIndex], 'CLOSED', false);
                saveBookingResult(rec);
                if (card) card.className = 'user-card failed';
                if (statusEl) statusEl.textContent = '🚫 Schedule Closed - No Appointments Available';
                await doLogout();
                results.push({ user: user.name, email: user.email, login: true, book: false, logout: true, slot: slots[slotIndex], closed: true });
                for (let j = i + 1; j < preload.length; j++) {
                    const ru = preload[j];
                    const rc = document.getElementById(`user-card-${j}`);
                    const rs = document.getElementById(`status-${j}`);
                    if (rc) rc.className = 'user-card failed';
                    if (rs) rs.textContent = '🚫 Skipped - Schedule Closed';
                    const rrec = buildRecord(ru, null, null, 'CLOSED', false);
                    saveBookingResult(rrec);
                    results.push({ user: ru.name, email: ru.email, login: false, book: false, logout: false, slot: null, closed: true });
                }
                break;
            }

            const finalSlot = slots[slotIndex];
            const finalSlotTime = `${finalSlot[0].trim()} - ${finalSlot[1].trim()}`;

            await randomDelay(1000, 2000);
            
            let passportResult = { success: false };
            if (bookResult.success && user.region && user.am && user.apofasi) {
                const pStart = currentDate + ' ' + finalSlot[0].trim();
                const pFinish = currentDate + ' ' + finalSlot[1].trim();
                passportResult = await submitPassportForm(user, pStart, pFinish);
                await randomDelay(1000, 2000);
            }
            
            const logoutResult = await doLogout();

            if (bookResult.success) {
                markSlot(slotIndex, 'booked', user.email);
                showToast('success', user, finalSlotTime);
                if (card) card.className = 'user-card success';
                if (statusEl) statusEl.textContent = `✅ Booked: ${finalSlotTime}`;
            } else {
                markSlot(slotIndex, 'failed', user.email);
                showToast('fail', user, finalSlotTime);
                if (card) card.className = 'user-card failed';
                if (statusEl) statusEl.textContent = `❌ Failed: ${finalSlotTime}`;
            }

            const rec = buildRecord(user, slotIndex, finalSlot, bookResult.success ? 'BOOKED' : 'FAILED', passportResult.success);
            saveBookingResult(rec);
            
            results.push({ 
                user: user.name, 
                email: user.email, 
                login: true, 
                book: bookResult.success,
                passport: passportResult.success,
                logout: logoutResult.success,
                slot: finalSlot,
                slotIndex: slotIndex
            });

            slotIndex++;

            if (i < preload.length - 1) {
                await randomDelay(delayMs, delayMs + 2000);
            }
        }

        const booked = results.filter(r => r.book).length;
        const passportOk = results.filter(r => r.passport).length;
        const failed = results.filter(r => !r.book).length;

        console.log('\n========================================');
        console.log('🏁 ALL DONE');
        console.log('========================================');
        console.log('✅ Booked:', booked);
        console.log('📝 Passport Forms:', passportOk);
        console.log('❌ Failed:', failed);
        console.log('📊 Total:', preload.length);
        console.log('\n📋 Slot Tracker:', JSON.stringify(slotTracker, null, 2));
        
        console.log('\n📋 Details:');
        results.forEach((r) => {
            const bookStatus = r.book ? '✅' : '❌';
            const passStatus = r.passport ? '📝' : '⬜';
            const slotInfo = r.slot ? `${r.slot[0].trim()} - ${r.slot[1].trim()}` : 'no slot';
            console.log(`   ${bookStatus}${passStatus} ${r.user} | ${slotInfo}`);
        });

        updateDownloadBar();
        updateNextSlotInfo();

        return { results, booked, passportOk, failed, total: preload.length };
    }

    /* ================= SINGLE USER FLOW ================= */
    async function runOne(index, startTime, finishTime, slotIdx) {
        const user = preload[index];
        if (!user) {
            console.log('❌ Invalid index:', index);
            return { success: false };
        }

        console.log(`\n🚀 Processing: ${user.name} (${user.email})`);
        
        const loginResult = await doLogin(user);
        if (loginResult.closed) {
            showToast('closed', user, '');
            const rec = buildRecord(user, slotIdx, slots[slotIdx], 'CLOSED', false);
            saveBookingResult(rec);
            return { success: false, step: 'closed', closed: true, finalSlotIdx: slotIdx };
        }
        if (!loginResult.success) return { success: false, step: 'login' };
        
        await new Promise(r => setTimeout(r, 100));
        
        let bookResult = await bookAppointment(user, startTime, finishTime);
        let finalSlotIdx = slotIdx;
        let finalStart = startTime;
        let finalFinish = finishTime;

        // Schedule closed - no appointments
        if (bookResult.closed) {
            const slotRef = slots[finalSlotIdx];
            const slotTimeRef = slotRef ? `${slotRef[0].trim()} - ${slotRef[1].trim()}` : '';
            showToast('closed', user, slotTimeRef);
            const rec = buildRecord(user, finalSlotIdx, slotRef, 'CLOSED', false);
            saveBookingResult(rec);
            await doLogout();
            return { success: false, step: 'closed', closed: true, finalSlotIdx };
        }

        // If slot already booked, try next slots
        let retries = 0;
        while (bookResult.alreadyBooked && retries < 5) {
            markSlot(finalSlotIdx, 'already_booked', '');
            finalSlotIdx++;
            const nextSlot = getNextAvailableSlot(finalSlotIdx);
            if (nextSlot < 0 || nextSlot >= slots.length) break;
            finalSlotIdx = nextSlot;
            const nSlot = slots[finalSlotIdx];
            const currentDate = getCurrentDate();
            finalStart = currentDate + ' ' + nSlot[0].trim();
            finalFinish = currentDate + ' ' + nSlot[1].trim();
            console.log(`🔄 Slot ${finalSlotIdx - 1} already booked, trying slot ${finalSlotIdx}: ${finalStart} - ${finalFinish}`);
            await new Promise(r => setTimeout(r, 300));
            bookResult = await bookAppointment(user, finalStart, finalFinish);
            if (bookResult.closed) break;
            retries++;
        }

        // Closed during retries
        if (bookResult.closed) {
            const slotRef = slots[finalSlotIdx];
            const slotTimeRef = slotRef ? `${slotRef[0].trim()} - ${slotRef[1].trim()}` : '';
            showToast('closed', user, slotTimeRef);
            const rec = buildRecord(user, finalSlotIdx, slotRef, 'CLOSED', false);
            saveBookingResult(rec);
            await doLogout();
            return { success: false, step: 'closed', closed: true, finalSlotIdx };
        }
        
        await new Promise(r => setTimeout(r, 100));
        
        let passportResult = { success: false };
        if (bookResult.success && user.region && user.am && user.apofasi) {
            passportResult = await submitPassportForm(user, finalStart, finalFinish);
        }
        
        await new Promise(r => setTimeout(r, 100));
        
        const logoutResult = await doLogout();

        const finalSlot = slots[finalSlotIdx];
        const finalSlotTime = finalSlot ? `${finalSlot[0].trim()} - ${finalSlot[1].trim()}` : '';

        if (bookResult.success) {
            markSlot(finalSlotIdx, 'booked', user.email);
        } else {
            markSlot(finalSlotIdx, 'failed', user.email);
        }

        const rec = buildRecord(user, finalSlotIdx, finalSlot, bookResult.success ? 'BOOKED' : 'FAILED', passportResult.success);
        saveBookingResult(rec);
        showToast(bookResult.success ? 'success' : 'fail', user, finalSlotTime);
        
        return { 
            success: bookResult.success, 
            login: loginResult, 
            book: bookResult, 
            passport: passportResult,
            logout: logoutResult,
            finalSlotIdx
        };
    }

    /* ================= UI PANEL ================= */
    const UI_ID = 'gujjar_api_panel';

    function addStyles() {
        addToastAnimation();
        const style = document.createElement('style');
        style.textContent = `
            #${UI_ID} {
                position: fixed;
                top: 10px;
                right: 10px;
                width: 360px;
                background: #fff;
                border: 1px solid #ddd;
                border-radius: 6px;
                font-family: system-ui, -apple-system, sans-serif;
                font-size: 12px;
                z-index: 999999;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            #${UI_ID} .panel-header {
                background: #e8e8e8;
                color: #333;
                padding: 10px 12px;
                font-weight: bold;
                font-size: 13px;
                border-radius: 6px 6px 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                cursor: move;
                border-bottom: 1px solid #ccc;
            }
            #${UI_ID} .panel-body {
                padding: 10px;
                max-height: 70vh;
                overflow-y: auto;
                background: #fafafa;
            }
            #${UI_ID}.collapsed .panel-body { display: none; }
            #${UI_ID} .collapse-btn {
                background: #ccc;
                border: none;
                color: #555;
                width: 22px;
                height: 22px;
                border-radius: 3px;
                cursor: pointer;
                font-size: 14px;
            }
            #${UI_ID} .collapse-btn:hover { background: #bbb; }
            #${UI_ID} .next-slot-info {
                background: #f0f4ff;
                border: 1px solid #c8d6e5;
                border-radius: 4px;
                padding: 6px 10px;
                margin-bottom: 10px;
                font-size: 11px;
                color: #334155;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            #${UI_ID} .next-slot-info b { color: #0969da; }
            #${UI_ID} .user-card {
                background: #fff;
                border: 1px solid #ddd;
                padding: 10px;
                margin-bottom: 8px;
                border-radius: 4px;
            }
            #${UI_ID} .user-card.processing {
                background: #fffbe6;
                border-color: #e0d080;
            }
            #${UI_ID} .user-card.success {
                background: #f0fff0;
                border-color: #90c090;
            }
            #${UI_ID} .user-card.failed {
                background: #fff5f5;
                border-color: #d09090;
            }
            #${UI_ID} .user-name {
                font-weight: bold;
                color: #333;
                font-size: 12px;
                margin-bottom: 6px;
                padding-bottom: 4px;
                border-bottom: 1px solid #eee;
            }
            #${UI_ID} .user-section {
                margin-bottom: 6px;
            }
            #${UI_ID} .user-section-title {
                font-size: 9px;
                font-weight: bold;
                color: #888;
                text-transform: uppercase;
                margin-bottom: 2px;
            }
            #${UI_ID} .user-info {
                color: #555;
                font-size: 10px;
                line-height: 1.5;
            }
            #${UI_ID} .user-info b { color: #333; }
            #${UI_ID} .user-buttons {
                display: flex;
                gap: 4px;
                margin-top: 8px;
            }
            #${UI_ID} .btn {
                flex: 1;
                padding: 7px 8px;
                border: none;
                border-radius: 3px;
                font-size: 10px;
                font-weight: bold;
                cursor: pointer;
            }
            #${UI_ID} .btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
            #${UI_ID} .btn-book {
                background: #666;
                color: #fff;
            }
            #${UI_ID} .btn-book:hover:not(:disabled) {
                background: #555;
            }
            #${UI_ID} .btn-all {
                display: block;
                width: 100%;
                padding: 10px;
                background: #555;
                color: #fff;
                border: none;
                border-radius: 4px;
                font-size: 12px;
                font-weight: bold;
                cursor: pointer;
                margin-bottom: 6px;
            }
            #${UI_ID} .btn-all:hover {
                background: #444;
            }
            #${UI_ID} .btn-download {
                display: block;
                width: 100%;
                padding: 8px;
                border: none;
                border-radius: 4px;
                font-size: 11px;
                font-weight: bold;
                cursor: pointer;
                margin-bottom: 6px;
            }
            #${UI_ID} .btn-json {
                background: #0969da;
                color: #fff;
            }
            #${UI_ID} .btn-json:hover { background: #0757b5; }
            #${UI_ID} .status-text {
                font-size: 10px;
                color: #666;
                margin-top: 4px;
            }
            #${UI_ID} .btn-group {
                display: flex;
                gap: 6px;
                margin-bottom: 10px;
            }
            #${UI_ID} .btn-group .btn-download {
                flex: 1;
                margin-bottom: 0;
            }
        `;
        document.head.appendChild(style);
    }

    function rebuildPanel() {
        const existing = document.getElementById(UI_ID);
        if (existing) existing.remove();
        createPanel();
    }

    function createPanel() {
        if (document.getElementById(UI_ID)) return;
        addStyles();

        const panel = document.createElement('div');
        panel.id = UI_ID;
        
        const noUsersMsg = preload.length === 0 ? '<div style="text-align:center;padding:20px;color:#94a3b8;font-size:12px;"><div style="font-size:28px;margin-bottom:8px;">📄</div><b>No users loaded</b><br>Upload a CSV file to load user data</div>' : '';
        let userCards = preload.map((user, idx) => `
            <div class="user-card" id="user-card-${idx}">
                <div class="user-name">${idx + 1}. ${user.name}</div>
                
                <div class="user-section">
                    <div class="user-section-title">Account</div>
                    <div class="user-info">
                        <b>Email:</b> ${user.email} | <b>Pass:</b> ${user.pass}<br>
                        <b>Phone:</b> ${user.phone}
                    </div>
                </div>
                
                <div class="user-section">
                    <div class="user-section-title">Personal</div>
                    <div class="user-info">
                        <b>F/Name:</b> ${user.fname || '-'}<br>
                        <b>City:</b> ${user.city || '-'}
                    </div>
                </div>
                
                <div class="user-section">
                    <div class="user-section-title">Passport</div>
                    <div class="user-info">
                        <b>P.No:</b> ${user.pno} | <b>Expiry:</b> ${user.expiry || '-'}
                    </div>
                </div>
                
                <div class="user-section">
                    <div class="user-section-title">Apofasi / Greek</div>
                    <div class="user-info">
                        <b>Region:</b> ${user.region || '-'} | <b>Year:</b> ${user.year || '-'}<br>
                        <b>AM:</b> ${user.am || '-'} | <b>Apofasi:</b> ${user.apofasi || '-'}<br>
                        <b>Greek Employer:</b> ${user.greek || '-'}
                    </div>
                </div>
                
                <div class="user-buttons">
                    <button class="btn btn-book" data-idx="${idx}">Book Appointment</button>
                </div>
                <div class="status-text" id="status-${idx}"></div>
            </div>
        `).join('');

        panel.innerHTML = `
            <div class="panel-header">
                <span>Gujjar API</span>
                <button class="collapse-btn" id="collapseBtn">−</button>
            </div>
            <div class="panel-body">
                <div class="next-slot-info" id="nextSlotInfo">🎰 Next Slot: <b>0: ${slots[0][0].trim()} - ${slots[0][1].trim()}</b></div>
                <div id="watcherBox" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:10px;margin-bottom:10px;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                        <span id="watcherDot" style="width:8px;height:8px;border-radius:50%;background:#94a3b8;display:inline-block;transition:all 0.3s;"></span>
                        <span style="font-size:11px;font-weight:700;color:#334155;">Booking Watcher</span>
                        <span id="watcherStatus" style="margin-left:auto;font-size:10px;color:#64748b;">Idle</span>
                    </div>
                    <div style="display:flex;gap:6px;margin-bottom:8px;">
                        <button id="watcherStartBtn" style="flex:1;padding:7px 0;background:#16a34a;color:#fff;border:none;border-radius:4px;font-size:10px;font-weight:700;cursor:pointer;">▶ Start Watching</button>
                        <button id="watcherStopBtn" style="flex:1;padding:7px 0;background:#dc2626;color:#fff;border:none;border-radius:4px;font-size:10px;font-weight:700;cursor:pointer;" disabled>⏹ Stop</button>
                    </div>
                    <label id="autoBookLabel" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 8px;background:#fff;border:1px solid #e2e8f0;border-radius:4px;user-select:none;">
                        <input type="checkbox" id="autoBookToggle" style="width:14px;height:14px;cursor:pointer;accent-color:#7c3aed;">
                        <span style="font-size:10px;font-weight:600;color:#334155;">Auto-Book when open</span>
                        <span style="margin-left:auto;font-size:9px;color:#94a3b8;font-weight:500;">10s delay per user</span>
                    </label>
                </div>
                <div id="csvBox" style="background:#fffbeb;border:1px solid #fbbf24;border-radius:6px;padding:10px;margin-bottom:10px;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                        <span style="font-size:11px;font-weight:700;color:#92400e;">📄 Users Data</span>
                        <span id="csvUserCount" style="margin-left:auto;font-size:10px;color:#b45309;font-weight:600;">${preload.length} users (auto-loaded)</span>
                    </div>
                    <div style="display:flex;gap:6px;">
                        <button id="csvReloadBtn" style="flex:1;padding:7px 0;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:10px;font-weight:700;cursor:pointer;">🔄 Reload CSV</button>
                        <label id="csvUploadLabel" style="flex:1;display:block;text-align:center;padding:7px 0;background:#d97706;color:#fff;border-radius:4px;font-size:10px;font-weight:700;cursor:pointer;">
                            📁 Override CSV
                            <input type="file" id="csvFileInput" accept=".csv" style="display:none;">
                        </label>
                        <button id="csvClearBtn" style="flex:1;padding:7px 0;background:#ef4444;color:#fff;border:none;border-radius:4px;font-size:10px;font-weight:700;cursor:pointer;">🗑 Reset</button>
                    </div>
                </div>
                <button class="btn-all" id="runAllBtn">Run All (Sequential)</button>
                <div id="gujjar_download_bar" style="display:none;background:#f0f4ff;border:1px solid #c8d6e5;border-radius:6px;padding:10px;margin-bottom:10px;"></div>
                <div class="btn-group">
                    <button class="btn-download btn-json" id="downloadJsonBtn">📦 Download LocalStorage JSON</button>
                </div>
                <div id="userList">${noUsersMsg}${userCards}</div>
            </div>
        `;

        document.body.appendChild(panel);

        const collapseBtn = panel.querySelector('#collapseBtn');
        collapseBtn.addEventListener('click', () => {
            panel.classList.toggle('collapsed');
            collapseBtn.textContent = panel.classList.contains('collapsed') ? '+' : '−';
        });

        makePanelDraggable(panel, panel.querySelector('.panel-header'));

        panel.querySelector('#runAllBtn').addEventListener('click', async () => {
            const startSlot = getNextAvailableSlot(0);
            await runAll(startSlot < 0 ? 0 : startSlot);
        });

        // Watcher buttons
        panel.querySelector('#watcherStartBtn').addEventListener('click', () => {
            if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
                Notification.requestPermission();
            }
            startWatcher();
        });
        panel.querySelector('#watcherStopBtn').addEventListener('click', () => stopWatcher());

        // Auto-book toggle
        const autoBookToggle = panel.querySelector('#autoBookToggle');
        autoBookToggle.checked = isAutoBookEnabled();
        autoBookToggle.addEventListener('change', (e) => {
            setAutoBookState(e.target.checked);
            console.log(e.target.checked ? '🚀 Auto-Book ENABLED' : '⏸️ Auto-Book DISABLED');
        });

        // Reload CSV from local file
        panel.querySelector('#csvReloadBtn').addEventListener('click', () => {
            localStorage.removeItem(USERS_KEY);
            preload.length = 0;
            loadUsers();
            setTimeout(() => rebuildPanel(), 500);
        });

        // Override with different CSV file
        panel.querySelector('#csvFileInput').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handleCSVUpload(file);
        });

        // Reset - clear localStorage override, reload from file
        panel.querySelector('#csvClearBtn').addEventListener('click', () => {
            localStorage.removeItem(USERS_KEY);
            preload.length = 0;
            loadUsers();
            setTimeout(() => rebuildPanel(), 500);
            console.log('🔄 Reset to CSV file data');
        });

        // Auto-resume watcher if it was active before page reload
        if (isWatcherActive()) {
            startWatcher();
        }

        // Initialize download bar with any existing results
        updateDownloadBar();

        // Download full localStorage as JSON
        panel.querySelector('#downloadJsonBtn').addEventListener('click', () => {
            downloadTMStorage();
        });

        // Individual book buttons - auto pick next available slot
        panel.querySelector('#userList').addEventListener('click', async (e) => {
            if (e.target.dataset.idx !== undefined) {
                const idx = parseInt(e.target.dataset.idx);
                const btn = e.target;
                const card = document.getElementById(`user-card-${idx}`);
                const statusEl = document.getElementById(`status-${idx}`);

                const slotIdx = getNextAvailableSlot(0);
                if (slotIdx < 0 || slotIdx >= slots.length) {
                    statusEl.textContent = '❌ No slots available!';
                    return;
                }

                const slot = slots[slotIdx];
                const currentDate = getCurrentDate();
                const startTime = currentDate + ' ' + slot[0].trim();
                const finishTime = currentDate + ' ' + slot[1].trim();

                btn.disabled = true;
                btn.textContent = 'Processing...';
                card.className = 'user-card processing';
                statusEl.textContent = `Trying slot ${slotIdx} (${slot[0].trim()}-${slot[1].trim()})...`;

                try {
                    const result = await runOne(idx, startTime, finishTime, slotIdx);
                    
                    if (result.closed) {
                        card.className = 'user-card failed';
                        statusEl.textContent = '🚫 Schedule Closed - No Appointments Available';
                    } else if (result.success) {
                        const fSlot = slots[result.finalSlotIdx];
                        card.className = 'user-card success';
                        statusEl.textContent = `✅ Booked: ${fSlot[0].trim()} - ${fSlot[1].trim()}`;
                    } else {
                        card.className = 'user-card failed';
                        statusEl.textContent = '❌ Failed: ' + (result.step || 'booking');
                    }
                } catch (err) {
                    card.className = 'user-card failed';
                    statusEl.textContent = 'Error: ' + err.message;
                }

                btn.disabled = false;
                btn.textContent = 'Book Appointment';
                updateNextSlotInfo();
            }
        });
    }

    function makePanelDraggable(panel, handle) {
        let isDragging = false, startX, startY, startLeft, startTop;
        handle.addEventListener('mousedown', e => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
        });
        document.addEventListener('mousemove', e => {
            if (!isDragging) return;
            panel.style.left = (startLeft + e.clientX - startX) + 'px';
            panel.style.top = (startTop + e.clientY - startY) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { isDragging = false; });
    }

    /* ================= EXPOSE TO CONSOLE ================= */
    window.gujjar = {
        runAll: (startSlot, delay) => runAll(startSlot || 0, delay || 3000),
        runOne: (index, start, end) => runOne(index, start, end, 0),
        login: (index = 0) => doLogin(preload[index]),
        book: (index, start, end) => bookAppointment(preload[index], start, end),
        passport: (index, start, end) => submitPassportForm(preload[index], start, end),
        logout: doLogout,
        get users() { return preload; },
        slots: slots,
        slotTracker: slotTracker,
        date: getCurrentDate,
        list: () => preload.forEach((u, i) => console.log(`${i}: ${u.email} - ${u.name}`)),
        showSlots: () => slots.forEach((s, i) => {
            const status = slotTracker[i] ? ` [${slotTracker[i].status}]` : ' [free]';
            console.log(`${i}: ${s[0].trim()} - ${s[1].trim()}${status}`);
        }),
        showPanel: createPanel,
        rebuildPanel: rebuildPanel,
        downloadCSV: (type) => { const r = type === 'session' ? sessionResults : getAllBookingResults(); if(r.length) downloadCSV(r, type || 'all'); else console.log('No results'); },
        downloadJSON: downloadLocalStorageJSON,
        getResults: getAllBookingResults,
        startWatcher: startWatcher,
        stopWatcher: stopWatcher,
        checkNow: checkBookingStatus,
        loadCSV: (csvText) => { const u = parseCSV(csvText); if(u.length) { preload.length = 0; u.forEach(x => preload.push(x)); saveUsersToStorage(preload); rebuildPanel(); } },
        clearUsers: () => { preload.length = 0; localStorage.removeItem(USERS_KEY); rebuildPanel(); }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createPanel);
    } else {
        createPanel();
    }

    console.log('Gujjar API loaded!');
    console.log('Commands: gujjar.runAll(), gujjar.list(), gujjar.showSlots(), gujjar.downloadCSV(), gujjar.downloadJSON(), gujjar.startWatcher(), gujjar.stopWatcher()');
})();
