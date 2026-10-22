// End-to-end test for the Discord status: NEO runs on a throwaway library
// with a pretend Discord listening where the real one would, and the test
// reads what NEO tells it. Updates are fifteen seconds apart (Discord's own
// limit), so this takes about a minute.
// Run with `npm run test:discord`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { encode } = require('../discord.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-discord-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'app'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'app', 'settings.json'), JSON.stringify({ discordClientId: '123456789012345678' }));
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: true,
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
// where NEO looks for Discord first
process.env.XDG_RUNTIME_DIR = path.join(tmp, 'run');
fs.mkdirSync(process.env.XDG_RUNTIME_DIR);

// the pretend Discord: answers the handshake, keeps every SET_ACTIVITY
const sent = [];
let handshake = null;
const server = net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 8 && buf.length >= 8 + buf.readInt32LE(4)) {
      const op = buf.readInt32LE(0);
      const len = buf.readInt32LE(4);
      const msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8'));
      buf = buf.subarray(8 + len);
      if (op === 0) { handshake = msg; sock.write(encode(1, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } })); }
      else if (msg.cmd === 'SET_ACTIVITY') sent.push(msg.args.activity || null);
    }
  });
});
server.listen(path.join(process.env.XDG_RUNTIME_DIR, 'discord-ipc-0'));

const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
// the newest activity Discord was sent once it passes `ok`, waiting out the limit
async function until(ok, what) {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    const last = sent.length ? sent[sent.length - 1] : undefined;
    if (last !== undefined && ok(last)) return last;
    await tick(200);
  }
  throw new Error(`Discord never showed ${what}; last sent: ${JSON.stringify(sent[sent.length - 1])}`);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('on the shelf: NEO, the bookshelf and the time since NEO opened', async () => {
  const a = await until((x) => x && x.details === 'On the bookshelf', 'the bookshelf');
  assert.deepEqual(handshake, { v: 1, client_id: '123456789012345678' });
  assert.ok(a.timestamps.start <= Date.now() && a.timestamps.start > Date.now() - 120000);
  assert.match(a.assets.large_image, /^https:\/\/raw\.githubusercontent\.com\/.+\/icon\.png$/);
  assert.equal(a.assets.large_text, 'NEO Enhanced');
});

test('in a book: its title, the chapter and the words typed since it opened', async () => {
  await js(`(async () => {
    document.getElementById('firstrun').hidden = true;
    await addImportedBooks([{ name: 'The Long Way Home', chapters: [
      { title: 'Harbor', paras: [{ text: 'Rain fell on the harbor.' }] },
      { title: 'Storm', paras: [{ text: 'Morning.' }] }
    ] }], library.shelves[0]);
    const ids = library.shelves[0].bookIds;
    await openBook(ids[ids.length - 1]);
  })()`);
  await tick(600);
  const opened = Date.now();
  await js(`(() => {
    const b = document.querySelectorAll('.chapter-body')[1];
    b.focus();
    const r = document.createRange(); r.selectNodeContents(b.lastElementChild); r.collapse(false);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  })()`);
  await tick(200);
  for (const c of ' Three more words') {
    wc.sendInputEvent({ type: 'keyDown', keyCode: c === ' ' ? 'Space' : c });
    wc.sendInputEvent({ type: 'char', keyCode: c });
    wc.sendInputEvent({ type: 'keyUp', keyCode: c === ' ' ? 'Space' : c });
    await tick(40);
  }
  const a = await until((x) => x && /3 words this session/.test(x.state || ''), 'three words');
  assert.equal(a.details, 'Writing The Long Way Home');
  assert.match(a.state, /^Chapter 2 — Storm · 3 words this session$/);
  assert.ok(Math.abs(a.timestamps.start - opened) < 5000, 'the time counts from the book’s opening');
});

test('on the Outline tab it says so', async () => {
  await js(`switchTab('outline')`);
  const a = await until((x) => x && /^Outlining/.test(x.state || ''), 'Outlining');
  assert.equal(a.state, 'Outlining · 3 words this session');
  await js(`switchTab('manuscript')`);
});

test('Customize NEO → Discord status off clears it', async () => {
  await js(`setFeature('discord', false); writeLibrary(library).then(applyFeatures)`);
  await until((x) => x === null, 'nothing');
});

/* ---------- runner ---------- */

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    win.setBounds({ width: 1200, height: 800 });
    while (!(await js(`typeof library !== 'undefined' && !!library && !!library.autoTheme`).catch(() => false))) await tick(50);
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
}
main();
