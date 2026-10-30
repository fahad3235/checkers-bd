// Checkers BD — headless-Chrome smoke tests via raw CDP.
// Run: node tests/smoke.js   (spawns /opt/meta-chromium/chrome, file:// page)
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 9337;
const PAGE = 'file://' + path.resolve(__dirname, '..', 'index.html');
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('ok - ' + name); }
  else { failed++; console.log('FAIL - ' + name + (extra ? ' :: ' + extra : '')); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getWsUrl() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('chrome debugger endpoint never came up');
}

async function main() {
  const policyPath = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
  const policySha = crypto.createHash('sha256').update(fs.readFileSync(policyPath)).digest('hex');
  const chrome = spawn('/opt/meta-chromium/chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--remote-debugging-port=' + PORT, '--no-first-run',
    '--user-data-dir=/tmp/checkers-smoke-profile',
    '--hatch-webgl-allowed-domains-file=' + policyPath,
    '--hatch-webgl-allowed-domains-sha256=' + policySha,
    PAGE,
  ], { stdio: 'ignore' });
  const errors = [];
  try {
    const wsUrl = await getWsUrl();
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id && pending.has(data.id)) {
        const { res, rej } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) rej(new Error(JSON.stringify(data.error)));
        else res(data.result);
      }
      if (data.method === 'Runtime.consoleAPICalled' && data.params && data.params.type === 'error') {
        errors.push(data.params.args.map((a) => a.value || a.description).join(' '));
      }
      if (data.method === 'Runtime.exceptionThrown') {
        const det = data.params.exceptionDetails || {};
        const ex = det.exception || {};
        errors.push(String(ex.description || det.text || 'exception'));
      }
    };
    function send(method, params) {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params: params || {} }));
      return new Promise((res, rej) => pending.set(id, { res, rej }));
    }
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await sleep(900);
    // Fresh state: earlier smoke runs persist localStorage in the profile dir.
    await ev('localStorage.clear();');
    await send('Page.reload');
    await sleep(900);

    check('title present', (await ev('document.title')).includes('Checkers'));
    check('heading present', (await ev('document.querySelector("h1").textContent')).includes('Checkers'));
    check('board has 64 cells', (await ev('document.querySelectorAll("#board .cell").length')) === 64);
    check('initial 24 pieces', (await ev('document.querySelectorAll("#board .piece").length')) === 24);
    check('initial 12 red + 12 black', (await ev('document.querySelectorAll("#board .piece.red").length')) === 12 &&
      (await ev('document.querySelectorAll("#board .piece.black").length')) === 12);
    check('status shows your turn', (await ev('document.getElementById("statusMain").textContent')).includes('Your turn'));

    // Select corner red man (5,0) -> exactly 1 hint destination
    await ev('document.querySelectorAll("#board .cell")[40].click();');
    await sleep(300);
    check('selecting (5,0) shows 1 hint', (await ev('document.querySelectorAll("#board .cell.hint").length')) === 1);

    // Play the hinted move, then wait for the computer reply
    await ev('document.querySelector("#board .cell.hint").click();');
    await sleep(1300);
    check('history has player + computer moves', (await ev('document.querySelectorAll("#historyList li").length')) === 2,
      await ev('document.getElementById("historyList").textContent'));
    check('still 24 pieces after quiet exchange', (await ev('document.querySelectorAll("#board .piece").length')) === 24);
    check('turn returns to player', (await ev('document.getElementById("statusMain").textContent')).includes('Your turn'));

    // Undo rewinds the full round
    await ev('document.getElementById("undoBtn").click();');
    await sleep(300);
    check('undo clears history', (await ev('document.querySelectorAll("#historyList li").length')) === 1 &&
      (await ev('document.getElementById("historyList").textContent')).includes('No moves yet'));

    // Two-player mode disables difficulty
    await ev('document.getElementById("modeSelect").value = "2p"; document.getElementById("modeSelect").dispatchEvent(new Event("change"));');
    await sleep(300);
    check('2p mode disables difficulty', await ev('document.getElementById("diffSelect").disabled'));
    check('2p status shows red turn', (await ev('document.getElementById("statusMain").textContent')).includes("Red's turn"));

    // Bengali toggle + persistence
    await ev('document.getElementById("langBtn").click();');
    await sleep(300);
    check('BN toggle changes heading', (await ev('document.querySelector("h1").textContent')).includes('চেকার্স'));
    check('lang persisted', (await ev('localStorage.getItem("checkers-bd-state-v1")')).includes('"lang":"bn"'));
    await ev('document.getElementById("langBtn").click();');
    await sleep(200);

    // Seeded double-jump: verify the multi-jump UI chain end to end.
    // Position (2p mode): red man (4,1); black men (3,2) and (1,4).
    await ev(`localStorage.setItem("checkers-bd-state-v1", JSON.stringify({lang:"en",mode:"2p",difficulty:"medium",sound:false,stats:{you:0,comp:0,red:0,black:0,draws:0,streak:0,best:0},game:{board:[[0,0,0,0,0,0,0,0],[0,0,0,0,-1,0,0,0],[0,0,0,0,0,0,0,0],[0,0,-1,0,0,0,0,0],[0,1,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0]],turn:1,over:null,history:[],halfmoveClock:0,snapshots:[]}}));`);
    await send('Page.reload');
    await sleep(900);
    check('seeded position has 3 pieces', (await ev('document.querySelectorAll("#board .piece").length')) === 3);
    await ev('document.querySelectorAll("#board .cell")[33].click();'); // (4,1)
    await sleep(300);
    check('capture hint shown for (4,1)', (await ev('document.querySelectorAll("#board .cell.hint-capture").length')) === 1);
    await ev('document.querySelector("#board .cell.hint").click();'); // first jump -> (2,3)
    await sleep(300);
    check('chain continues: hint to (0,5)', (await ev('document.querySelectorAll("#board .cell.hint").length')) === 1);
    await ev('document.querySelector("#board .cell.hint").click();'); // second jump -> (0,5), crowned
    await sleep(300);
    check('double jump recorded x2', (await ev('document.getElementById("historyList").textContent')).includes('×2'));
    check('double jump captures both', (await ev('document.querySelectorAll("#board .piece.black").length')) === 0);
    check('red wins after clearing black', (await ev('document.getElementById("statusMain").textContent')).includes('Red wins'));

    // New game resets the board
    await ev('document.getElementById("newGameBtn").click();');
    await sleep(300);
    check('new game restores 24 pieces', (await ev('document.querySelectorAll("#board .piece").length')) === 24);

    // Mobile viewport: no horizontal overflow
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await sleep(400);
    const overflow = await ev('Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= 390');
    check('390px no horizontal overflow', overflow, await ev('document.body.scrollWidth + "x" + document.documentElement.scrollWidth'));
    await send('Emulation.clearDeviceMetricsOverride');

    check('zero console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    ws.close();
  } finally {
    try { chrome.kill(); } catch (e) { /* ignore */ }
  }
  console.log('smoke passed: ' + passed + ', failed: ' + failed);
  if (failed > 0) process.exitCode = 1;
}
main().catch((e) => { console.error('smoke harness error:', e); process.exit(1); });
