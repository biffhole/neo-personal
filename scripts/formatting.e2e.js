// End-to-end tests for this version's paragraph styles (headings, quotes,
// lists), the paste that keeps them, the copy that brings a chapter's
// heading along, and the exports that carry them. NEO runs on a throwaway
// library, and the keys arrive as the writer types them. Run with
// `npm run test:formatting`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-formatting-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-formatting-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
// simple NEO (no moreFeatures): Markdown as you type stays on here
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
// run from scripts/, NEO's window would look for scripts/index.html
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const MOD = process.platform === 'darwin' ? 'meta' : 'control';

async function type(text) {
  for (const c of text) {
    const keyCode = c === ' ' ? 'Space' : c;
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: c });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await tick(60);
  }
}
async function key(keyCode, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (!modifiers.length && keyCode.length === 1) wc.sendInputEvent({ type: 'char', keyCode });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await tick(120);
}

// chapter c's body, and the caret at the end of its paragraph n
const BODY = (c) => `document.querySelectorAll('.chapter-body')[${c}]`;
async function caretEnd(c, n) {
  await js(`(() => {
    const body = ${BODY(c)};
    body.focus();
    const r = document.createRange();
    r.selectNodeContents(body.children[${n}]);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(200);
}
const paraOf = (c, n) => js(`(() => { const p = ${BODY(c)}.children[${n}]; return { fmt: p.dataset.fmt || '', text: p.textContent, html: p.innerHTML }; })()`);
const count = (c) => js(`${BODY(c)}.children.length`);
// a paste, as the editor receives one
const paste = (c, data) => js(`(() => {
  const dt = new DataTransfer();
  for (const [k, v] of Object.entries(${JSON.stringify(data)})) dt.setData(k, v);
  ${BODY(c)}.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
})()`);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('"# " at the start of a line makes a heading', async () => {
  await caretEnd(0, 0);
  await key('Enter');
  await type('# Arrival');
  await tick(200);
  const p = await paraOf(0, 1);
  assert.equal(p.fmt, 'h1');
  assert.equal(p.text, 'Arrival');
});

test('Enter after a heading goes back to prose', async () => {
  await key('Enter');
  await type('Plain words');
  await tick(200);
  const p = await paraOf(0, 2);
  assert.equal(p.fmt, '');
  assert.equal(p.text, 'Plain words');
});

test('⌘⌥2 makes a subheading and ⌘⌥0 takes it back', async () => {
  await caretEnd(0, 2);
  await key('2', [MOD, 'alt']);
  assert.equal((await paraOf(0, 2)).fmt, 'h2');
  await key('0', [MOD, 'alt']);
  assert.equal((await paraOf(0, 2)).fmt, '');
});

test('a list carries on with Enter and stops at an empty line', async () => {
  await caretEnd(0, 2);
  await key('Enter');
  await type('- one');
  await key('Enter');
  await type('two');
  await key('Enter');
  await key('Enter');
  await type('after');
  await tick(200);
  assert.equal((await paraOf(0, 3)).fmt, 'ul');
  assert.equal((await paraOf(0, 4)).fmt, 'ul');
  assert.equal((await paraOf(0, 4)).text, 'Two'); // (capitals as you type)
  const after = await paraOf(0, 5);
  assert.equal(after.fmt, '');
  assert.equal(after.text, 'After');
});

test('Backspace at the start of a styled line takes the style off first', async () => {
  await js(`(() => {
    const p = ${BODY(0)}.children[4];
    const r = document.createRange();
    r.setStart(p.firstChild, 0);
    r.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(100);
  const before = await count(0);
  await key('Backspace');
  const p = await paraOf(0, 4);
  assert.equal(p.fmt, '');
  assert.equal(p.text, 'Two');
  assert.equal(await count(0), before);
});

test('the drop cap skips a heading', async () => {
  const first = await js(`${BODY(0)}.querySelector('p[data-first]').textContent`);
  assert.notEqual(first, 'Arrival');
});

test('pasting a document keeps its headings, lists and quotes', async () => {
  await caretEnd(0, 5);
  await key('Enter');
  await paste(0, {
    'text/html': '<h2>From Docs</h2><ul><li>alpha</li><li><b>beta</b></li></ul><blockquote>a quote</blockquote><hr><p>last</p>',
    'text/plain': 'From Docs\nalpha\nbeta\na quote\nlast'
  });
  await tick(300);
  const all = await js(`[...${BODY(0)}.children].slice(6).map((p) => [p.dataset.fmt || (p.classList.contains('scene-break') ? 'brk' : ''), p.textContent])`);
  assert.deepEqual(all.slice(0, 6), [['h2', 'From Docs'], ['ul', 'alpha'], ['ul', 'beta'], ['quote', 'a quote'], ['brk', '***'], ['', 'last']]);
});

test('pasting Markdown turns it into formatting', async () => {
  const at = await count(0);
  await caretEnd(0, at - 1);
  await key('Enter');
  await paste(0, { 'text/plain': '# Notes\n\n1. first\n2. second\n\nSome **bold** words' });
  await tick(300);
  const all = await js(`[...${BODY(0)}.children].slice(${at}).map((p) => [p.dataset.fmt || '', p.innerHTML])`);
  assert.deepEqual(all.map((x) => x[0]), ['h1', 'ol', 'ol', '']);
  assert.match(all[3][1], /Some <b>bold<\/b> words/);
});

test('copying from the top of a chapter brings its heading', async () => {
  const clip = await js(`(() => {
    const body = ${BODY(1)};
    const r = document.createRange();
    r.selectNodeContents(body);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    const dt = new DataTransfer();
    body.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return { text: dt.getData('text/plain'), html: dt.getData('text/html') };
  })()`);
  assert.match(clip.text, /^Chapter 2 . Second\n\nThe second chapter/);
  assert.match(clip.html, /^<h1>Chapter 2 . Second<\/h1>/);
});

test('a copy that starts partway in is an ordinary copy', async () => {
  const clip = await js(`(() => {
    const body = ${BODY(1)};
    const t = body.children[0].firstChild;
    const r = document.createRange();
    r.setStart(t, 4);
    r.setEnd(t, 10);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    const dt = new DataTransfer();
    body.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return dt.getData('text/plain');
  })()`);
  assert.equal(clip, '');
});

test('the exports carry the paragraph styles', async () => {
  const out = await js(`(async () => {
    flushAllSaves();
    const d = bookExportData();
    const docx = buildDocxEntries(d).find((e) => e.path === 'word/document.xml').content;
    const epub = (await buildEpubEntries(d)).filter((e) => /\\.xhtml$/.test(e.path)).map((e) => e.content).join('\\n');
    return { md: buildMd(d), txt: buildTxt(d), html: buildHtml(d), docx, epub };
  })()`);
  assert.match(out.md, /\n### Arrival\n/);
  assert.match(out.md, /\n- alpha\n/);
  assert.match(out.md, /\n> a quote\n/);
  assert.match(out.md, /\n1\. first\n\n2\. second\n/);
  assert.match(out.txt, /\n {2}• alpha\n/);
  assert.match(out.html, /<h3>Arrival<\/h3>/);
  assert.match(out.html, /<ul>\n<li>alpha<\/li>\n<li><b>beta<\/b><\/li>\n<\/ul>/);
  assert.match(out.html, /<blockquote>\n<p>a quote<\/p>\n<\/blockquote>/);
  assert.match(out.docx, /<w:pStyle w:val="InlineHeading"\/>/);
  assert.match(out.docx, /<w:pStyle w:val="ListParagraph"\/>.*?•<\/w:t><w:tab\/>/);
  assert.match(out.epub, /<h2 class="fmt">Arrival<\/h2>/);
  assert.match(out.epub, /<ol>\n<li>first<\/li>\n<li>second<\/li>\n<\/ol>/);
});

test('Enter three times at the start of a heading starts a chapter there', async () => {
  // a pasted chapter heading in the middle of a chapter, the caret before it
  const chapters = await js(`document.querySelectorAll('.chapter-body').length`);
  const last = chapters - 1;
  await js(`(() => {
    const body = ${BODY(last)};
    body.innerHTML = '<p>The end of one chapter.</p><p data-fmt="h1"><b>Chapter 9</b></p><p>The plate was empty.</p>';
    enterRun = 0; // (a click would)
    body.focus();
    const r = document.createRange();
    r.setStart(body.children[1].firstChild.firstChild, 0);
    r.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(200);
  await key('Enter');
  assert.deepEqual(await paraOf(last, 1), { fmt: '', text: '', html: '<br>' }, 'once: the heading moves down, a plain empty line above it');
  assert.equal((await paraOf(last, 2)).fmt, 'h1');
  await key('Enter');
  assert.equal((await paraOf(last, 1)).text, '***', 'twice: a section break above it');
  assert.equal((await paraOf(last, 2)).fmt, 'h1');
  await key('Enter');
  await tick(300);
  assert.equal(await js(`document.querySelectorAll('.chapter-body').length`), chapters + 1, 'three times: a new chapter');
  assert.equal(await js(`${BODY(last)}.textContent`), 'The end of one chapter.');
  const head = await paraOf(last + 1, 0);
  assert.equal(head.fmt, 'h1');
  assert.equal(head.text, 'Chapter 9');
  assert.equal((await paraOf(last + 1, 1)).text, 'The plate was empty.');
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
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Formatting', chapters: [
        { title: 'First', paras: [{ text: 'Rain fell on the harbor.' }] },
        { title: 'Second', paras: [{ text: 'The second chapter opens here.' }, { text: 'And goes on.' }] }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(400);
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
    app.exit(failed ? 1 : 0);
  }
}
main();
