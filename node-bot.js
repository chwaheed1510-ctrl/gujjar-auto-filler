const fs = require('fs');
const { connect } = require('puppeteer-real-browser');

/* ================= CONFIG ================= */
const PROXY_HOST = 'geo.iproyal.com';
const PROXY_PORT = '12321';
const PROXY_USER = 'a9ltqZwmcD1J9wqn';
const PROXY_PASS_BASE = 'eA0OYqC13FvuDrqE';

function getProxyPass(sessionId) {
    return `${PROXY_PASS_BASE}_session-${sessionId}_lifetime-10m`;
}

function generateSessionId() {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

const BASE_URL = 'https://schedule.cf-grcon-isl-pakistan.com';
const RESOURCE_ID = '1134189';
const LOGIN_PATH = '/schedule/login/grcon-isl-pakistan/WORK_National_VISA';
const APPOINTMENT_PATH = '/schedule/grcon-isl-pakistan/WORK_National_VISA';
const LOGOUT_PATH = '/users/logout/grcon-isl-pakistan?return=WORK_National_VISA';
const CSV_FILE = './users.csv';

const DELAY_BETWEEN_USERS_MS = 2000;
const NAV_TIMEOUT_MS = 30000;
const IP_POOL_FILE = './ip-pool.json';

let slots = [
    ["11:00 "," 11:05"],["10:55 "," 11:00"],["10:50 "," 10:55"],
    ["10:45 "," 10:50"],["10:40 "," 10:45"],["10:35 "," 10:40"],["10:30 "," 10:35"],
    ["10:25 "," 10:30"],["10:20 "," 10:25"],["10:15 "," 10:20"],["10:10 "," 10:15"],
    ["10:05 "," 10:10"],["10:00 "," 10:05"],["9:55 "," 10:00"],["9:50 "," 9:55"],
    ["9:45 "," 9:50"],["9:40 "," 9:45"],["9:35 "," 9:40"],["9:30 "," 9:35"],
    ["9:25 "," 9:30"],["9:20 "," 9:25"],["9:15 "," 9:20"],["9:10 "," 9:15"],
    ["9:05 "," 9:10"],["9:00 "," 9:05"]
];

const slotTracker = {};

/* ================= CSV PARSER ================= */
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
        if (obj.phone && /^\d{9,10}$/.test(obj.phone) && !obj.phone.startsWith('0')) {
            obj.phone = '0' + obj.phone;
        }
        if (obj.email && obj.name) users.push(obj);
    }
    return users;
}

/* ================= UTILITY ================= */
function getCurrentDate() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function randomDelay(min, max) {
    return sleep(Math.floor(Math.random() * (max - min + 1)) + min);
}

function getNextAvailableSlot(startIndex) {
    for (let i = startIndex; i < slots.length; i++) {
        if (!slotTracker[i] || slotTracker[i].status !== 'booked') return i;
    }
    return -1;
}

function markSlot(index, status, email) {
    slotTracker[index] = { status, email, time: new Date().toISOString() };
}

/* ================= BROWSER SETUP ================= */
async function launchBrowser() {
    loadIPPool();

    const activeEntry = getNextActiveIP();
    let sid, proxyPass;

    if (activeEntry) {
        sid = activeEntry.sessionId;
        proxyPass = getProxyPass(sid);
        console.log(`🚀 Launching browser with saved IP: ${activeEntry.ip} (session: ${sid})...`);
    } else {
        sid = generateSessionId();
        proxyPass = getProxyPass(sid);
        console.log(`🚀 Launching browser with new session: ${sid}...`);
    }

    const { page, browser } = await connect({
        headless: false,
        turnstile: true,
        args: [
            `--proxy-server=http://${PROXY_HOST}:${PROXY_PORT}`,
        ],
    });

    await page.authenticate({ username: PROXY_USER, password: proxyPass });
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    page._proxyPass = proxyPass;
    browser._proxyPass = proxyPass;
    browser._proxyUser = PROXY_USER;

    const ip = await resolveIPFromSession(page, sid);
    if (ip) {
        currentIP = ip;
        addIPToPool(ip, sid);
        const stats = getPoolStats();
        console.log(`  🌐 Current IP: ${ip} (pool: ${stats.active} active, ${stats.blocked} blocked)`);
    }

    return { browser, page };
}

async function clearSession(page) {
    try {
        const client = await page.target().createCDPSession();
        await client.send('Network.clearBrowserCookies');
        await client.send('Network.clearBrowserCache');
        await client.detach();
    } catch {}
}

/* ================= IP POOL MANAGEMENT ================= */
let currentIP = 'unknown';
let ipPool = [];

function loadIPPool() {
    try {
        if (fs.existsSync(IP_POOL_FILE)) {
            ipPool = JSON.parse(fs.readFileSync(IP_POOL_FILE, 'utf-8'));
            console.log(`📋 IP Pool loaded: ${ipPool.length} IPs (${ipPool.filter(e => e.status === 'active').length} active, ${ipPool.filter(e => e.status === 'blocked').length} blocked)`);
        }
    } catch { ipPool = []; }
}

function saveIPPool() {
    fs.writeFileSync(IP_POOL_FILE, JSON.stringify(ipPool, null, 2));
}

function addIPToPool(ip, sessionId) {
    const existing = ipPool.find(e => e.ip === ip);
    if (existing) {
        if (existing.status === 'blocked') return;
        existing.sessionId = sessionId;
        existing.lastUsed = new Date().toISOString();
        existing.usedCount = (existing.usedCount || 0) + 1;
    } else {
        ipPool.push({
            ip,
            sessionId,
            status: 'active',
            addedAt: new Date().toISOString(),
            lastUsed: new Date().toISOString(),
            blockedAt: null,
            usedCount: 1,
        });
    }
    saveIPPool();
}

function markIPBlocked(ip) {
    const entry = ipPool.find(e => e.ip === ip);
    if (entry) {
        entry.status = 'blocked';
        entry.blockedAt = new Date().toISOString();
        saveIPPool();
        console.log(`  🚫 IP marked blocked: ${ip}`);
    }
}

function getNextActiveIP() {
    return ipPool.find(e => e.status === 'active' && e.ip !== currentIP);
}

function allIPsBlocked() {
    return ipPool.length > 0 && ipPool.every(e => e.status === 'blocked');
}

function getPoolStats() {
    const active = ipPool.filter(e => e.status === 'active').length;
    const blocked = ipPool.filter(e => e.status === 'blocked').length;
    return { total: ipPool.length, active, blocked };
}

async function resolveIPFromSession(page, sessionId) {
    const pass = getProxyPass(sessionId);
    try {
        const testPage = await page.browser().newPage();
        await testPage.authenticate({ username: PROXY_USER, password: pass });
        await testPage.goto('https://ipv4.icanhazip.com', { waitUntil: 'domcontentloaded', timeout: 10000 });
        await sleep(1000);
        const ip = await testPage.evaluate(() => document.body.innerText.trim());
        await testPage.close();
        return ip;
    } catch {
        return null;
    }
}

async function switchToIP(page, entry) {
    const pass = getProxyPass(entry.sessionId);
    await page.authenticate({ username: PROXY_USER, password: pass });
    page._proxyPass = pass;
    currentIP = entry.ip;
    entry.lastUsed = new Date().toISOString();
    entry.usedCount = (entry.usedCount || 0) + 1;
    saveIPPool();
    console.log(`  🔀 Switched to saved IP: ${entry.ip} (session: ${entry.sessionId})`);
}

async function rotateIP(page) {
    const oldIP = currentIP;
    markIPBlocked(oldIP);
    const blockedIPs = ipPool.filter(e => e.status === 'blocked').map(e => e.ip);

    const oldBrowser = page.browser();
    console.log(`  🔄 Closing browser and launching new one for fresh IP...`);
    try { await oldBrowser.close(); } catch {}

    for (let attempt = 1; attempt <= 5; attempt++) {
        await sleep(3000);
        const newSid = generateSessionId();
        const newPass = getProxyPass(newSid);

        console.log(`  🔄 Launch attempt ${attempt}/5 (session: ${newSid})...`);

        const { page: newPage, browser: newBrowser } = await connect({
            headless: false,
            turnstile: true,
            args: [`--proxy-server=http://${PROXY_HOST}:${PROXY_PORT}`],
        });

        await newPage.authenticate({ username: PROXY_USER, password: newPass });
        newPage.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
        newPage._proxyPass = newPass;
        newBrowser._proxyPass = newPass;

        let newIP = null;
        try {
            await newPage.goto('https://ipv4.icanhazip.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
            await sleep(2000);
            newIP = await newPage.evaluate(() => document.body.innerText.trim());
        } catch (e) {
            console.log(`  ⚠️  IP check failed: ${e.message}`);
            try { await newBrowser.close(); } catch {}
            continue;
        }

        console.log(`  📡 Got IP: ${newIP}`);

        if (newIP && !blockedIPs.includes(newIP) && newIP !== oldIP) {
            currentIP = newIP;
            addIPToPool(newIP, newSid);
            const stats = getPoolStats();
            console.log(`  ✅ New IP: ${oldIP} → ${currentIP} (pool: ${stats.active} active, ${stats.blocked} blocked)`);
            return { ip: currentIP, page: newPage, browser: newBrowser };
        }

        console.log(`  ⚠️  Got same/blocked IP (${newIP}), trying again...`);
        try { await newBrowser.close(); } catch {}
    }

    console.log(`  ❌ Could not get fresh IP after 5 browser launches. Launching anyway...`);
    const fallbackSid = generateSessionId();
    const fallbackPass = getProxyPass(fallbackSid);
    const { page: fbPage, browser: fbBrowser } = await connect({
        headless: false,
        turnstile: true,
        args: [`--proxy-server=http://${PROXY_HOST}:${PROXY_PORT}`],
    });
    await fbPage.authenticate({ username: PROXY_USER, password: fallbackPass });
    fbPage.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    fbPage._proxyPass = fallbackPass;
    return { ip: currentIP, page: fbPage, browser: fbBrowser };
}

function isBlocked(html, status) {
    if (status === 403) return true;
    return false;
}

async function waitForCloudflare(page, maxWait = 60000) {
    const title = await page.title().catch(() => '');
    if (title.includes('Just a moment') || title.includes('Cloudflare') || title.includes('Attention')) {
        console.log('  ☁️  Cloudflare detected, waiting...');
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            await sleep(3000);
            const currentTitle = await page.title().catch(() => 'Just a moment');
            if (!currentTitle.includes('Just a moment') && !currentTitle.includes('Cloudflare') && !currentTitle.includes('Attention')) {
                await sleep(2000);
                console.log('  ✅ Cloudflare passed!');
                return true;
            }
            const elapsed = Math.round((Date.now() - start) / 1000);
            console.log(`  ☁️  Still solving... (${elapsed}s)`);
        }
        console.log('  ⚠️  Cloudflare wait timed out');
        return false;
    }
    return true;
}

function isActualSite(page) {
    const url = page.url() || '';
    if (url.includes('challenges.cloudflare.com') || url === 'about:blank') return false;
    return true;
}

/* ================= LOG PANEL (only on actual site) ================= */
async function injectLogPanel(page) {
    if (!isActualSite(page)) return;
    await page.evaluate(() => {
        if (document.getElementById('gujjar-log-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'gujjar-log-panel';
        panel.innerHTML = `
            <div id="glp-header">
                <span>🔧 Gujjar Bot Logs</span>
                <span id="glp-toggle" style="cursor:pointer;">—</span>
            </div>
            <div id="glp-body"></div>
        `;
        panel.style.cssText = `
            position:fixed; top:10px; right:10px; width:480px; max-height:90vh;
            background:#1a1a2e; border:2px solid #0f3460; border-radius:10px;
            font-family:Consolas,monospace; font-size:12px; color:#e0e0e0;
            z-index:999999; box-shadow:0 4px 20px rgba(0,0,0,0.5); overflow:hidden;
        `;
        const header = panel.querySelector('#glp-header');
        header.style.cssText = `
            padding:8px 12px; background:#0f3460; color:#fff; font-weight:bold;
            display:flex; justify-content:space-between; cursor:move; border-radius:8px 8px 0 0;
        `;
        const body = panel.querySelector('#glp-body');
        body.style.cssText = `padding:8px; max-height:calc(90vh - 40px); overflow-y:auto;`;

        let minimized = false;
        panel.querySelector('#glp-toggle').addEventListener('click', () => {
            minimized = !minimized;
            body.style.display = minimized ? 'none' : 'block';
            panel.querySelector('#glp-toggle').textContent = minimized ? '▢' : '—';
        });

        let dx=0,dy=0,mx=0,my=0,dragging=false;
        header.addEventListener('mousedown', e => { dragging=true; mx=e.clientX; my=e.clientY; e.preventDefault(); });
        document.addEventListener('mousemove', e => {
            if(!dragging) return;
            dx=mx-e.clientX; dy=my-e.clientY; mx=e.clientX; my=e.clientY;
            panel.style.top=(panel.offsetTop-dy)+'px'; panel.style.left=(panel.offsetLeft-dx)+'px';
            panel.style.bottom='auto'; panel.style.right='auto';
        });
        document.addEventListener('mouseup', () => { dragging=false; });
        document.body.appendChild(panel);
    }).catch(() => {});
}

async function addLog(page, type, message, details) {
    if (!isActualSite(page)) return;
    await page.evaluate((t, msg, det) => {
        const body = document.getElementById('glp-body');
        if (!body) return;

        const colors = { info:'#4fc3f7', success:'#66bb6a', error:'#ef5350', warn:'#ffa726', step:'#ce93d8' };
        const icons = { info:'ℹ️', success:'✅', error:'❌', warn:'⚠️', step:'▶️' };
        const time = new Date().toLocaleTimeString();

        const entry = document.createElement('div');
        entry.style.cssText = `margin-bottom:6px; padding:6px 8px; background:#16213e; border-radius:6px; border-left:3px solid ${colors[t]||'#888'};`;
        entry.innerHTML = `<div style="color:${colors[t]||'#ccc'}">${icons[t]||'•'} <b>${msg}</b> <span style="color:#666;font-size:10px;">[${time}]</span></div>`;

        if (det) {
            const escaped = String(det).replace(/</g,'&lt;').replace(/>/g,'&gt;');
            const pre = document.createElement('pre');
            pre.style.cssText = `margin:4px 0 0;padding:4px;background:#0d1117;border-radius:4px;font-size:10px;color:#8b949e;white-space:pre-wrap;max-height:80px;overflow-y:auto;`;
            pre.textContent = det;
            entry.appendChild(pre);
        }

        body.appendChild(entry);
        body.scrollTop = body.scrollHeight;
    }, type, message, details).catch(() => {});
}

async function addResponseLog(page, callName, url, payload, responseHtml, isOk) {
    if (!isActualSite(page)) return;
    await page.evaluate((name, reqUrl, payloadStr, html, ok) => {
        const body = document.getElementById('glp-body');
        if (!body) return;

        const time = new Date().toLocaleTimeString();
        const color = ok ? '#66bb6a' : '#ef5350';
        const icon = ok ? '✅' : '❌';

        const section = document.createElement('div');
        section.style.cssText = `margin-bottom:8px; background:#16213e; border-radius:6px; border-left:3px solid ${color}; overflow:hidden;`;

        const header = document.createElement('div');
        header.style.cssText = `padding:8px 10px; cursor:pointer; color:${color}; display:flex; justify-content:space-between; align-items:center;`;
        header.innerHTML = `<span>${icon} <b>${name}</b> <span style="color:#666;font-size:10px;">[${time}]</span></span><span class="rc-arrow" style="font-size:10px;">▼</span>`;

        const content = document.createElement('div');
        content.style.cssText = `display:none; padding:0 10px 10px;`;

        content.innerHTML = `
            <div style="font-size:10px;color:#888;margin-bottom:4px;"><b>URL:</b> <span style="color:#4fc3f7;">${reqUrl}</span></div>
            <div style="font-size:10px;color:#888;margin-bottom:2px;"><b>Payload:</b></div>
            <pre style="margin:0 0 6px;padding:6px;background:#0d1117;border-radius:4px;font-size:10px;color:#8b949e;white-space:pre-wrap;max-height:100px;overflow-y:auto;">${payloadStr}</pre>
            <div style="font-size:10px;color:#888;margin-bottom:2px;"><b>Response HTML:</b></div>
        `;

        const iframe = document.createElement('iframe');
        iframe.sandbox = 'allow-same-origin';
        iframe.style.cssText = `width:100%;height:200px;border:1px solid #333;border-radius:4px;background:#fff;`;
        content.appendChild(iframe);

        header.addEventListener('click', () => {
            const open = content.style.display === 'none';
            content.style.display = open ? 'block' : 'none';
            header.querySelector('.rc-arrow').textContent = open ? '▲' : '▼';
            if (open && !iframe._loaded) {
                iframe.srcdoc = html || '<p style="padding:10px;color:#999;">No response</p>';
                iframe._loaded = true;
            }
        });

        section.appendChild(header);
        section.appendChild(content);
        body.appendChild(section);
        body.scrollTop = body.scrollHeight;
    }, callName, url, payload, responseHtml, isOk).catch(() => {});
}

/* ================= CAPTCHA SOLVER ================= */
async function solveMathCaptcha(page) {
    try {
        const questionText = await page.evaluate(() => document.body.innerText);
        const questionHtml = await page.evaluate(() => {
            const el = document.querySelector('form, .captcha, div');
            return el ? el.innerHTML : document.body.innerHTML.substring(0, 500);
        });

        let match = questionText.match(/(\d+)\s*[\+\-\*x×\+]\s*(\d+)\s*=/);
        if (!match) match = questionText.match(/(\d+)\s+(\d+)\s*=/);
        if (!match) {
            console.log('  ⚠️  Could not parse captcha:', questionText.substring(0, 100));
            return false;
        }

        const num1 = parseInt(match[1]);
        const num2 = parseInt(match[2]);

        const opMatch = questionHtml.match(/\d+\s*([+\-*×x\+\−\×])\s*\d+/) ||
                         questionText.match(/\d+\s*([+\-*×x])\s*\d+/);
        const operator = opMatch ? opMatch[1] : '+';

        let answer;
        if (operator === '-' || operator === '−') answer = num1 - num2;
        else if (operator === '*' || operator === 'x' || operator === '×') answer = num1 * num2;
        else answer = num1 + num2;

        console.log(`  🧮 Captcha: ${num1} ${operator} ${num2} = ${answer}`);

        const inputField = await page.$('#captcha, input[type="text"], input[type="number"]');
        if (inputField) {
            await inputField.click({ clickCount: 3 });
            await sleep(500);
            await inputField.type(String(answer), { delay: 100 });
            await sleep(2000);

            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {}),
                page.evaluate((ans) => {
                    document.getElementById('captcha').value = String(ans);
                    const form = document.querySelector('form');
                    if (typeof solve_captcha === 'function') {
                        solve_captcha(new Event('submit'));
                    } else if (form) {
                        form.submit();
                    }
                }, answer).catch(() => {}),
            ]);

            await sleep(5000);
            await waitForCloudflare(page);
            console.log('  ✅ Captcha solved');
            return true;
        }

        console.log('  ⚠️  Could not find captcha input field');
        return false;
    } catch (error) {
        console.error('  ❌ Captcha error:', error.message);
        return false;
    }
}

/* ================= INITIAL SETUP (one-time: Cloudflare + captcha) ================= */
async function initialSetup(page, firstUser) {
    console.log('🌐 Initial setup: navigate once to pass Cloudflare + Captcha...');
    try {
        await page.goto(BASE_URL + LOGIN_PATH, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    } catch (e) {
        console.log(`  ❌ Navigation failed: ${e.message}`);
        return { success: false, blocked: true };
    }
    await sleep(3000);
    await waitForCloudflare(page);
    await injectLogPanel(page);
    await addLog(page, 'info', '🚀 Bot started - establishing browser session...');

    const html = await page.content();
    const lower = html.toLowerCase();
    const hasLoginForm = lower.includes('type="password"') || lower.includes('name="name"') ||
                         lower.includes('user login') || lower.includes('log in');

    console.log(`  📄 Page has login form: ${hasLoginForm}`);

    if (hasLoginForm) {
        const email = firstUser ? firstUser.email : 'init@test.com';
        const pass = firstUser ? firstUser.pass : 'test';
        console.log(`  ✅ Login page loaded, filling form (${email})...`);
        await addLog(page, 'step', `Filling login form: ${email}`).catch(() => {});

        await page.waitForSelector('input[type="password"], input[type="text"], input[name="name"]', { timeout: 10000 }).catch(() => {});
        await sleep(1000);

        const filled = await page.evaluate((e, p) => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const ef = document.querySelector('input[name="name"]') ||
                       document.querySelector('input[type="email"]') ||
                       document.querySelector('input[name="email"]') ||
                       inputs.find(i => i.type === 'text');
            const pf = document.querySelector('input[name="password"]') ||
                       document.querySelector('input[type="password"]') ||
                       inputs.find(i => i.type === 'password');
            if (ef) { ef.value = e; ef.dispatchEvent(new Event('input', { bubbles: true })); }
            if (pf) { pf.value = p; pf.dispatchEvent(new Event('input', { bubbles: true })); }
            return { email: !!ef, pass: !!pf };
        }, email, pass);

        console.log(`  📋 Fields filled: email=${filled.email}, password=${filled.pass}`);

        await randomDelay(500, 1000);

        const btn = await page.$('input[type="submit"]') ||
                    await page.$('button[type="submit"]') ||
                    await page.$('input[value="Log in"]') ||
                    await page.$('input[name="commit"]');
        if (btn) {
            console.log('  🖱️  Clicking submit button...');
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {}),
                btn.click(),
            ]);
        } else {
            console.log('  🖱️  No button found, submitting form...');
            await page.evaluate(() => { const f = document.querySelector('form'); if (f) f.submit(); });
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {});
        }

        await sleep(3000);
        await waitForCloudflare(page);

        let pageHtml = await page.content();
        let pageTitle = await page.title();

        if (pageTitle.toLowerCase().includes('captcha') || pageHtml.toLowerCase().includes('please answer')) {
            console.log('  🧮 CAPTCHA detected, solving...');
            await addLog(page, 'warn', 'CAPTCHA detected, solving...');
            const solved = await solveMathCaptcha(page);
            if (solved) {
                await sleep(3000);
                await waitForCloudflare(page);
            }
        }
    }

    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200)).catch(() => '');
    console.log(`  📄 Page after setup: ${bodyText.substring(0, 150)}`);

    await injectLogPanel(page);
    const stats = getPoolStats();
    await addLog(page, 'success', '🟢 READY!', `IP: ${currentIP}\nCaptcha done - starting fetch calls now.\nPage stays here, no reloads.`);
    console.log('  ✅ READY! Captcha done. Starting fetch calls immediately.');
    return { success: true };
}

/* ================= API FUNCTIONS (all fetch-based, no page navigation) ================= */

async function doLogin(page, user) {
    console.log(`  🔐 LOGIN: ${user.email} [IP: ${currentIP}]`);

    try {
        const payloadStr = JSON.stringify({ name: user.email, password: user.pass.substring(0, 3) + '***' }, null, 2);
        await addLog(page, 'step', `LOGIN: ${user.email}`, `Password: ${user.pass.substring(0, 3)}***\nIP: ${currentIP}`).catch(() => {});

        const result = await page.evaluate(async (data) => {
            const params = new URLSearchParams();
            params.append('name', data.email);
            params.append('password', data.pass);

            const response = await fetch(data.loginUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
                credentials: 'include',
                redirect: 'follow',
            });

            return { status: response.status, html: await response.text(), ok: response.ok, url: response.url };
        }, {
            loginUrl: BASE_URL + LOGIN_PATH,
            email: user.email,
            pass: user.pass,
        });

        if (result.status === 403) {
            console.log(`  🚫 LOGIN 403 Forbidden! [IP: ${currentIP}]`);
            await addResponseLog(page, `LOGIN 403 FORBIDDEN`, BASE_URL + LOGIN_PATH, payloadStr, result.html, false);
            return { success: false, closed: false, blocked: true };
        }

        const lower = result.html.toLowerCase();
        const closed = lower.includes('is closed') || lower.includes('no available appointments');
        const loggedIn = result.ok && (lower.includes('logout') || lower.includes('sign out') || !lower.includes('log in'));
        const emailBlocked = lower.includes('too many requests');

        if (emailBlocked) {
            console.log(`  🚫 Email rate-limited: ${user.email} [IP: ${currentIP}]`);
            await addResponseLog(page, `LOGIN (Email Blocked)`, BASE_URL + LOGIN_PATH, payloadStr, result.html, false);
            return { success: false, closed: false, emailBlocked: true };
        }

        const label = closed ? 'LOGIN (Closed)' : (loggedIn ? 'LOGIN (OK)' : `LOGIN (${result.status})`);
        await addResponseLog(page, `${label} [IP: ${currentIP}]`, BASE_URL + LOGIN_PATH, payloadStr, result.html, loggedIn || closed);

        if (closed) console.log(`  🚫 Schedule CLOSED [IP: ${currentIP}]`);
        else console.log(loggedIn ? `  ✅ Login OK [IP: ${currentIP}]` : `  ⚠️  Login response (${result.status}) [IP: ${currentIP}]`);

        return { success: loggedIn, html: result.html, closed };

    } catch (error) {
        console.error(`  ❌ LOGIN ERROR:`, error.message);
        await addLog(page, 'error', `LOGIN ERROR`, error.message).catch(() => {});
        return { success: false, error: error.message, closed: false };
    }
}

async function bookAppointment(page, user, startTime, finishTime) {
    console.log(`  📅 BOOK: ${user.name} | ${startTime} - ${finishTime} [IP: ${currentIP}]`);

    try {
        const payloadObj = {
            'reservation[start_time]': startTime,
            'reservation[finish_time]': finishTime,
            'reservation[full_name]': user.name,
            'reservation[phone]': user.phone,
            'reservation[resource_id]': RESOURCE_ID,
        };

        await addLog(page, 'step', `BOOK: ${user.name}`, `Slot: ${startTime} - ${finishTime}\nIP: ${currentIP}`).catch(() => {});

        const result = await page.evaluate(async (data) => {
            const params = new URLSearchParams();
            params.append('reservation[start_time]', data.startTime);
            params.append('reservation[finish_time]', data.finishTime);
            params.append('reservation[full_name]', data.name);
            params.append('reservation[phone]', data.phone);
            params.append('reservation[mobile]', data.phone);
            params.append('reservation[resource_id]', data.resourceId);
            params.append('reservation[xpos]', '');
            params.append('reservation[ypos]', '');

            const response = await fetch(data.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
                credentials: 'include',
            });

            return { status: response.status, html: await response.text(), ok: response.ok };
        }, {
            url: BASE_URL + APPOINTMENT_PATH,
            startTime, finishTime,
            name: user.name,
            phone: user.phone,
            resourceId: RESOURCE_ID,
        });

        if (result.status === 403) {
            console.log(`  🚫 BOOK 403 Forbidden! [IP: ${currentIP}]`);
            await addResponseLog(page, `BOOK 403 FORBIDDEN`, BASE_URL + APPOINTMENT_PATH, JSON.stringify(payloadObj, null, 2), result.html, false);
            return { success: false, alreadyBooked: false, closed: false, blocked: true };
        }

        const lower = result.html.toLowerCase();
        const closed = lower.includes('is closed') || lower.includes('no available appointments');
        const alreadyBooked = !closed && (lower.includes('already') || lower.includes('not available') || lower.includes('taken'));
        const success = result.ok && !alreadyBooked && !closed;

        const label = closed ? 'BOOK (Closed)' : (success ? 'BOOK (Success)' : (alreadyBooked ? 'BOOK (Slot Taken)' : `BOOK (${result.status})`));
        await addResponseLog(page, `${label} [IP: ${currentIP}]`, BASE_URL + APPOINTMENT_PATH, JSON.stringify(payloadObj, null, 2), result.html, success);

        if (closed) console.log(`  🚫 SCHEDULE CLOSED [IP: ${currentIP}]`);
        else console.log(success ? `  ✅ Booked! [IP: ${currentIP}]` : (alreadyBooked ? `  ⚠️  Slot taken [IP: ${currentIP}]` : `  ❌ Failed (${result.status}) [IP: ${currentIP}]`));

        return { success, html: result.html, alreadyBooked, closed, status: result.status };

    } catch (error) {
        console.error(`  ❌ BOOK ERROR:`, error.message);
        await addLog(page, 'error', `BOOK ERROR`, error.message).catch(() => {});
        return { success: false, error: error.message, alreadyBooked: false, closed: false };
    }
}

async function submitPassportForm(page, user, startTime, finishTime) {
    console.log(`  📝 PASSPORT FORM: ${user.name}`);

    try {
        const payloadObj = {
            'form[1]': (user.pno || '').toUpperCase(),
            'form[3]': user.region || '',
            'form[4]': user.am || '',
            'form[5]': (user.greek || '').toUpperCase(),
            'form[6]': user.year || '2025',
            'form[7]': user.apofasi || '',
            'form[19][]': 'I DECLARE...',
            'reservation[start_time]': startTime,
            'reservation[finish_time]': finishTime,
            'reservation[full_name]': user.name,
        };

        const result = await page.evaluate(async (data) => {
            const [datePart, timePart] = data.startTime.split(' ');
            const [hour, min] = timePart.split(':');
            const parts = datePart.split('-');
            const month = parseInt(parts[1]);
            const day = parseInt(parts[2]);
            const formUrl = `${data.baseUrl}${data.appointmentPath}?view=free&day=${day}&month=${month}&hour=${hour}&min=${min}`;

            const params = new URLSearchParams();
            params.append('form[3]', data.region);
            params.append('form[4]', data.am);
            params.append('form[6]', data.year);
            params.append('form[7]', data.apofasi);
            params.append('form[5]', data.greek);
            params.append('form[1]', data.pno);
            params.append('form[19][]', 'I DECLARE THAT ALL ABOVE INFORMATION IS ACCURATE.');
            params.append('reservation[start_time]', data.startTime);
            params.append('reservation[finish_time]', data.finishTime);
            params.append('reservation[full_name]', data.name);
            params.append('reservation[phone]', data.phone);
            params.append('reservation[mobile]', data.phone);
            params.append('reservation[resource_id]', data.resourceId);
            params.append('reservation[xpos]', '');
            params.append('reservation[ypos]', '');

            const response = await fetch(formUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString(),
                credentials: 'include',
            });

            return { status: response.status, html: await response.text(), ok: response.ok, url: formUrl };
        }, {
            baseUrl: BASE_URL,
            appointmentPath: APPOINTMENT_PATH,
            startTime, finishTime,
            name: user.name,
            phone: user.phone,
            region: user.region || '',
            am: user.am || '',
            year: user.year || '2025',
            apofasi: user.apofasi || '',
            greek: (user.greek || '').toUpperCase(),
            pno: (user.pno || '').toUpperCase(),
            resourceId: RESOURCE_ID,
        });

        const success = result.ok && !result.html.toLowerCase().includes('error');
        await addResponseLog(page, success ? 'PASSPORT (OK)' : `PASSPORT (${result.status})`, result.url, JSON.stringify(payloadObj, null, 2), result.html, success);

        console.log(success ? '  ✅ Form Submitted' : `  ❌ Form Failed (${result.status})`);
        return { success, html: result.html, status: result.status };

    } catch (error) {
        console.error('  ❌ PASSPORT ERROR:', error.message);
        await addLog(page, 'error', 'PASSPORT ERROR', error.message).catch(() => {});
        return { success: false, error: error.message };
    }
}

async function doLogout(page, email) {
    console.log('  🚪 LOGOUT...');
    try {
        const result = await page.evaluate(async (logoutUrl) => {
            const response = await fetch(logoutUrl, {
                method: 'GET',
                credentials: 'include',
            });
            return { status: response.status, ok: response.ok };
        }, BASE_URL + LOGOUT_PATH);

        const responseText = `<p>Logout ${result.ok ? 'OK' : 'Failed'} - Status: ${result.status}</p>`;
        await addResponseLog(page, `LOGOUT [IP: ${currentIP}]`, BASE_URL + LOGOUT_PATH, `User: ${email}`, responseText, result.ok);
        console.log(`  🚪 Logout ${result.ok ? 'OK' : 'Failed'} - Status: ${result.status}`);
        return { success: result.ok };
    } catch (error) {
        console.error('  ❌ LOGOUT ERROR:', error.message);
        await addLog(page, 'error', 'LOGOUT ERROR', error.message).catch(() => {});
        return { success: false };
    }
}

/* ================= SINGLE USER FLOW (all fetch, no page reload) ================= */
async function runOneUser(page, user, slotIdx) {
    const currentDate = getCurrentDate();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`👤 ${user.name} (${user.email})`);
    console.log(`${'='.repeat(60)}`);

    await addLog(page, 'info', `👤 ${user.name}`, `Email: ${user.email}\nSlot: ${slots[slotIdx][0].trim()} - ${slots[slotIdx][1].trim()}`).catch(() => {});

    const loginResult = await doLogin(page, user);

    if (loginResult.blocked) {
        return { success: false, closed: false, slotIdx, needNewIP: true };
    }

    if (loginResult.emailBlocked) {
        return { success: false, closed: false, slotIdx, emailBlocked: true };
    }

    const slot = slots[slotIdx];
    const startTime = currentDate + ' ' + slot[0].trim();
    const finishTime = currentDate + ' ' + slot[1].trim();

    await addLog(page, 'step', `BOOKING slot: ${slot[0].trim()} - ${slot[1].trim()}`).catch(() => {});
    await randomDelay(300, 800);
    let bookResult = await bookAppointment(page, user, startTime, finishTime);
    let finalSlotIdx = slotIdx;

    let retries = 0;
    while (bookResult.alreadyBooked && !bookResult.closed && retries < 5) {
        markSlot(finalSlotIdx, 'already_booked', '');
        finalSlotIdx++;
        const next = getNextAvailableSlot(finalSlotIdx);
        if (next < 0 || next >= slots.length) break;
        finalSlotIdx = next;
        const nSlot = slots[finalSlotIdx];
        const nStart = currentDate + ' ' + nSlot[0].trim();
        const nFinish = currentDate + ' ' + nSlot[1].trim();
        console.log(`  🔄 Trying slot ${finalSlotIdx}: ${nStart} - ${nFinish}`);
        await addLog(page, 'warn', `Retry slot: ${nSlot[0].trim()} - ${nSlot[1].trim()}`).catch(() => {});
        await randomDelay(300, 600);
        bookResult = await bookAppointment(page, user, nStart, nFinish);
        retries++;
    }

    await randomDelay(300, 800);

    let passportResult = { success: false };
    if (user.region && user.am && user.apofasi) {
        const fSlot = slots[finalSlotIdx];
        const pStart = currentDate + ' ' + fSlot[0].trim();
        const pFinish = currentDate + ' ' + fSlot[1].trim();
        await addLog(page, 'step', `PASSPORT FORM: ${user.name}`).catch(() => {});
        passportResult = await submitPassportForm(page, user, pStart, pFinish);
        await randomDelay(300, 600);
    }

    await doLogout(page, user.email);

    const closed = loginResult.closed || bookResult.closed;

    if (bookResult.success) {
        markSlot(finalSlotIdx, 'booked', user.email);
        console.log(`  🎉 SUCCESS: ${user.name} booked at ${slots[finalSlotIdx][0].trim()} - ${slots[finalSlotIdx][1].trim()}`);
        await addLog(page, 'success', `🎉 BOOKED: ${user.name} at ${slots[finalSlotIdx][0].trim()}`).catch(() => {});
    } else {
        markSlot(finalSlotIdx, 'failed', user.email);
        console.log(`  💔 FAILED: ${user.name}${closed ? ' (CLOSED)' : ''}`);
    }

    return { success: bookResult.success, closed, passport: passportResult.success, slotIdx: finalSlotIdx };
}

/* ================= RUN ALL USERS ================= */
async function runAll() {
    console.log('\n🚀🚀🚀 GUJJAR NODE BOT - SINGLE BROWSER + PROXY 🚀🚀🚀');
    console.log(`📅 Date: ${getCurrentDate()}`);
    console.log(`🌐 Proxy: ${PROXY_HOST}:${PROXY_PORT}`);

    const csvText = fs.readFileSync(CSV_FILE, 'utf-8');
    const users = parseCSV(csvText);
    console.log(`👥 Users: ${users.length}`);
    console.log(`🎰 Slots: ${slots.length} (${slots[0][0].trim()} to ${slots[slots.length-1][1].trim()})\n`);

    if (FORCE_ALL) console.log('⚡ FORCE MODE: All users will be tried, no skipping!\n');

    let { browser, page } = await launchBrowser();

    await initialSetup(page, users[1] || users[0]);

    await addLog(page, 'info', `📋 ${users.length} users | ${slots.length} slots | ${FORCE_ALL ? 'FORCE MODE' : 'Normal mode'}`).catch(() => {});

    const results = [];
    const blockedEmails = new Set();
    let slotIndex = 0;
    const MAX_IP_RETRIES = 3;
    const MIN_USERS_TO_TRY = 3;
    let usersTried = 0;
    let allFailing = true;

    try {
        for (let i = 0; i < users.length; i++) {
            const user = users[i];

            if (blockedEmails.has(user.email)) {
                console.log(`\n⏭️  Skipping ${user.email} (email rate-limited)`);
                results.push({ user: user.name, email: user.email, success: false, reason: 'EMAIL_BLOCKED', slot: '-' });
                continue;
            }

            if (!FORCE_ALL && usersTried >= 1 && allFailing) {
                console.log(`\n⏭️  Skipping ${user.email} (closed/failed - normal mode)`);
                results.push({ user: user.name, email: user.email, success: false, reason: 'SKIPPED', slot: '-' });
                continue;
            }

            slotIndex = getNextAvailableSlot(slotIndex);

            if (slotIndex < 0 || slotIndex >= slots.length) {
                console.log(`\n❌ No more slots for ${user.name}`);
                results.push({ user: user.name, email: user.email, success: false, reason: 'NO_SLOT', slot: '-' });
                continue;
            }

            let result = null;
            let ipRetry = 0;

            while (ipRetry <= MAX_IP_RETRIES) {
                result = await runOneUser(page, user, slotIndex);

                if (result.emailBlocked) {
                    blockedEmails.add(user.email);
                    console.log(`  📧 Email ${user.email} added to blocked list`);
                    await addLog(page, 'warn', `📧 Email blocked: ${user.email}`).catch(() => {});
                    break;
                }

                if (result.needNewIP && ipRetry < MAX_IP_RETRIES) {
                    ipRetry++;
                    console.log(`\n  🔄 403! New browser + IP (retry ${ipRetry}/${MAX_IP_RETRIES})...`);
                    const rotated = await rotateIP(page);
                    page = rotated.page;
                    browser = rotated.browser;
                    await sleep(2000);
                    await initialSetup(page, users[(i + ipRetry) % users.length]);
                    continue;
                }
                break;
            }

            usersTried++;
            if (result.success) allFailing = false;

            const reason = result.emailBlocked ? 'EMAIL_BLOCKED' :
                           result.closed ? 'CLOSED' :
                           result.success ? 'BOOKED' :
                           result.needNewIP ? 'IP_BLOCKED' : 'FAILED';

            results.push({
                user: user.name,
                email: user.email,
                success: result.success,
                passport: result.passport || false,
                slot: result.slotIdx !== undefined && slots[result.slotIdx]
                    ? `${slots[result.slotIdx][0].trim()} - ${slots[result.slotIdx][1].trim()}`
                    : '-',
                reason,
            });

            if (!result.emailBlocked) slotIndex++;

            if (i < users.length - 1) {
                await sleep(DELAY_BETWEEN_USERS_MS);
            }
        }
    } catch (err) {
        console.error('❌ Fatal error:', err.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('🏁 ALL DONE - Browser kept open for inspection');
    console.log('='.repeat(60));

    const booked = results.filter(r => r.success).length;
    console.log(`✅ Booked: ${booked} | ❌ Failed: ${results.length - booked} | 📊 Total: ${results.length}\n`);
    results.forEach(r => console.log(`  ${r.success ? '✅' : '❌'} ${r.user} | ${r.email} | ${r.slot} | ${r.reason}`));

    const csvOut = ['date,name,email,slot,status,passport']
        .concat(results.map(r => `${getCurrentDate()},"${r.user}","${r.email}","${r.slot}",${r.reason},${r.passport || false}`))
        .join('\n');
    const outFile = `results-${getCurrentDate()}.csv`;
    fs.writeFileSync(outFile, csvOut);
    console.log(`\n📁 Results saved to ${outFile}`);
    console.log('👁️  Browser is open - close it manually when done inspecting logs');
}

/* ================= TEST ================= */
async function testProxy() {
    console.log('🧪 Testing proxy...');
    const { browser, page } = await launchBrowser();

    try {
        await page.goto('https://ipv4.icanhazip.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(2000);
        const ip = await page.evaluate(() => document.body.innerText.trim());
        console.log(`✅ Proxy IP: ${ip}`);

        console.log('\n🌐 Testing target site...');
        await page.goto(BASE_URL + APPOINTMENT_PATH, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);
        await waitForCloudflare(page);

        const title = await page.title();
        const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
        console.log(`📄 Title: ${title}`);
        console.log(`📝 Body: ${bodyText.substring(0, 300)}`);

        const isBlocked = title.includes('Just a moment') || bodyText.toLowerCase().includes('403');
        console.log(isBlocked ? '❌ Still blocked' : '✅ Site accessible!');
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    } finally {
        await browser.close();
    }
}

/* ================= SINGLE USER ================= */
async function runSingle(userIndex) {
    const csvText = fs.readFileSync(CSV_FILE, 'utf-8');
    const users = parseCSV(csvText);
    if (userIndex < 0 || userIndex >= users.length) {
        console.log(`❌ Invalid index ${userIndex} (0-${users.length - 1})`);
        return;
    }

    const user = users[userIndex];
    console.log(`\n🚀 Single user: ${user.name} (${user.email})`);

    let { browser, page } = await launchBrowser();
    try {
        let setupOk = false;
        for (let t = 0; t < 5; t++) {
            const s = await initialSetup(page, user);
            if (!s.blocked) { setupOk = true; break; }
            console.log(`  🔄 Blocked! New browser + IP (attempt ${t + 1}/5)...`);
            const rotated = await rotateIP(page);
            page = rotated.page;
            browser = rotated.browser;
            await sleep(2000);
        }
        if (!setupOk) {
            console.log('  ❌ All setup attempts failed.');
            return;
        }

        let result = await runOneUser(page, user, 0);
        let retries = 0;

        while (result.needNewIP && retries < 5) {
            retries++;
            console.log(`\n  🔄 Blocked! New browser + IP (retry ${retries}/5)...`);
            const rotated = await rotateIP(page);
            page = rotated.page;
            browser = rotated.browser;
            await sleep(1000);
            await initialSetup(page, user);
            result = await runOneUser(page, user, 0);
        }

        console.log('\n📊 Result:', result.success ? '✅ BOOKED' : '❌ FAILED');
        console.log('👁️  Browser kept open - close manually when done');
    } catch (error) {
        console.error('❌ Error:', error.message);
        await browser.close();
    }
}

/* ================= IP POOL VIEWER ================= */
function showPool() {
    loadIPPool();
    const stats = getPoolStats();
    console.log(`\n📋 IP POOL STATUS (${IP_POOL_FILE})`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total: ${stats.total} | Active: ${stats.active} | Blocked: ${stats.blocked}\n`);

    if (ipPool.length === 0) {
        console.log('  (empty - no IPs saved yet)\n');
        return;
    }

    ipPool.forEach((e, i) => {
        const icon = e.status === 'active' ? '🟢' : '🔴';
        console.log(`  ${icon} ${i + 1}. ${e.ip}`);
        console.log(`     Session: ${e.sessionId}`);
        console.log(`     Status:  ${e.status} | Used: ${e.usedCount}x | Added: ${e.addedAt}`);
        if (e.blockedAt) console.log(`     Blocked: ${e.blockedAt}`);
        console.log('');
    });
}

function resetPool() {
    ipPool = [];
    saveIPPool();
    console.log('🗑️  IP pool cleared!');
}

/* ================= MAIN ================= */
const args = process.argv.slice(2);
const command = args[0] || 'help';
const FORCE_ALL = args.includes('--force');

switch (command) {
    case 'test':   testProxy(); break;
    case 'run':    runAll(); break;
    case 'user':   runSingle(parseInt(args[1] || '0')); break;
    case 'pool':   showPool(); break;
    case 'reset':  resetPool(); break;
    default:
        console.log('🔧 GUJJAR NODE BOT - Usage:');
        console.log('  node node-bot.js test              - Test proxy + Cloudflare bypass');
        console.log('  node node-bot.js run               - Run (stop on closed/fail)');
        console.log('  node node-bot.js run --force       - Run ALL users (no skip, no limit)');
        console.log('  node node-bot.js user 0            - Run single user by index');
        console.log('  node node-bot.js user 0 --force    - Single user (force mode)');
        console.log('  node node-bot.js pool              - View IP pool status');
        console.log('  node node-bot.js reset             - Clear IP pool (start fresh)');
        break;
}
