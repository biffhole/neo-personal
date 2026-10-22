// End-to-end tests for View → Customize NEO… (turning tabs, panels and
// features off and on) and for this version's Automatic page: white,
// in a room that follows the computer's dark or light mode. NEO runs on a
// throwaway library that starts dark, the way an older one would.
// Run with `npm run test:customize`.

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-customize-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-customize-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
const LIB = path.join(tmp, 'NEO Library', 'library.json');
fs.writeFileSync(LIB, JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const MOD = process.platform === 'darwin' ? 'meta' : 'control';
async function key(keyCode, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (!modifiers.length && keyCode.length === 1) wc.sendInputEvent({ type: 'char', keyCode });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await tick(150);
}
async function type(text) {
  for (const c of text) {
    wc.sendInputEvent({ type: 'keyDown', keyCode: c === ' ' ? 'Space' : c });
    wc.sendInputEvent({ type: 'char', keyCode: c });
    wc.sendInputEvent({ type: 'keyUp', keyCode: c === ' ' ? 'Space' : c });
    await tick(50);
  }
}
const BODY = `document.querySelector('.chapter-body')`;
async function caretEnd() {
  await js(`(() => { const b = ${BODY}; b.focus(); const r = document.createRange(); r.selectNodeContents(b.lastElementChild); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  await tick(150);
}
const shown = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!el && getComputedStyle(el).display !== 'none'; })()`);
const menuLabels = () => {
  const out = [];
  const walk = (m) => { for (const i of m.items) { if (i.visible !== false) out.push(i.label); if (i.submenu) walk(i.submenu); } };
  walk(Menu.getApplicationMenu());
  return out;
};
// turn features off (or on) the way the panel does
const set = async (id, on) => { await js(`setFeature('${id}', ${on}); writeLibrary(library).then(applyFeatures)`); await tick(400); };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('an older dark library opens Automatic once: a white page, the room as the computer is set', async () => {
  assert.equal(await js('library.pageTheme'), 'auto');
  assert.equal(await js('!!library.autoTheme'), true);
  assert.ok(menuLabels().includes('Automatic'));
  const { nativeTheme } = require('electron');
  for (const mode of ['dark', 'light']) {
    nativeTheme.themeSource = mode; // the computer's appearance, as Electron reports it
    await tick(500);
    assert.equal(await js('pageThemeNow()'), mode === 'dark' ? 'paper' : 'light', mode);
    assert.equal(await js(`document.body.classList.contains('night')`), false, mode + ': never the dark page');
    assert.equal(await js(`document.body.classList.contains('light')`), mode === 'light', mode + ': the room follows');
    assert.equal(await js(`getComputedStyle(document.querySelector('.sheet')).backgroundColor`), 'rgb(251, 250, 247)', mode + ': a white page');
  }
  nativeTheme.themeSource = 'system';
});

test('View → Customize NEO… opens the panel, and a box turns a feature off', async () => {
  assert.ok(menuLabels().includes('Customize NEO…'));
  await js(`customizeNeo()`);
  await tick(200);
  const boxes = await js(`document.querySelectorAll('.customize-modal input[data-id]').length`);
  assert.ok(boxes >= 20, boxes + ' features');
  await js(`(() => { const b = document.querySelector('.customize-modal input[data-id="outline"]'); b.click(); })()`);
  await tick(400);
  assert.deepEqual(JSON.parse(fs.readFileSync(LIB, 'utf8')).featuresOff, ['outline']);
  assert.equal(await shown('.tab[data-tab="outline"]'), false);
  await js(`document.querySelector('.customize-modal .cz-all').click()`);
  await tick(400);
  assert.equal(await shown('.tab[data-tab="outline"]'), true);
  await js(`document.querySelector('.customize-modal .m-ok').click()`);
});

test('a hidden tab is skipped by ⌥⌘→ and left if it was open', async () => {
  await js(`switchTab('darlings')`);
  await set('darlings', false);
  assert.equal(await js('currentTab'), 'manuscript', 'back to the manuscript');
  assert.equal(await shown('.tab[data-tab="darlings"]'), false);
  await set('notes', false);
  await key('Right', [MOD, 'alt']);
  assert.equal(await js('currentTab'), 'outline', 'past Notes');
  await key('Right', [MOD, 'alt']);
  assert.equal(await js('currentTab'), 'manuscript', 'past Darlings');
  await set('notes', true);
  await set('darlings', true);
});

test('right-click a tab to hide it', async () => {
  await js(`document.querySelector('.tab[data-tab="notes"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 700 }))`);
  await tick(300);
  const items = await js(`[...document.querySelectorAll('.pop-menu [role="menuitem"]')].map((b) => b.textContent.trim())`);
  assert.ok(items.some((x) => /^Hide the Notes Tab$/.test(x)), items.join(' | '));
  await js(`[...document.querySelectorAll('.pop-menu [role="menuitem"]')].find((b) => /^Hide/.test(b.textContent.trim())).click()`);
  await tick(400);
  assert.equal(await shown('.tab[data-tab="notes"]'), false);
  await set('notes', true);
});

test('panels and counters go when turned off', async () => {
  for (const [id, sel] of [['chapters', '#nav-pane'], ['counters', '#word-counter'], ['goals', '#goal-counter'], ['zoom', '#zoom-control']]) {
    await set(id, false);
    assert.equal(await shown(sel), false, sel + ' hidden');
    await set(id, true);
    assert.equal(await shown(sel), true, sel + ' back');
  }
});

test('a feature that is off: its keys stand down and its menu items go', async () => {
  await set('paragraphStyles', false);
  await set('darlings', false);
  await set('snapshots', false);
  const labels = menuLabels();
  for (const l of ['Paragraph Style', 'Clear Formatting', 'Take Snapshot']) assert.ok(!labels.includes(l), l + ' gone');
  await caretEnd();
  await key('1', [MOD, 'alt']);
  assert.equal(await js(`${BODY}.lastElementChild.dataset.fmt || ''`), '', '⌘⌥1 does nothing');
  await type('# Not a heading');
  await tick(200);
  assert.equal(await js(`${BODY}.lastElementChild.dataset.fmt || ''`), '', '"# " stays text');
  const darlings = await js('darlings.length');
  await js(`(() => { const r = document.createRange(); r.selectNodeContents(${BODY}.firstElementChild); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  await key('d', [MOD, 'shift']);
  assert.equal(await js('darlings.length'), darlings, '⌘⇧D does nothing');
  for (const id of ['paragraphStyles', 'darlings', 'snapshots']) await set(id, true);
  const back = menuLabels();
  for (const l of ['Paragraph Style', 'Clear Formatting', 'Take Snapshot']) assert.ok(back.includes(l), l + ' back');
});

test('with flush paragraphs off, ⇧Enter is an ordinary new paragraph', async () => {
  await set('flush', false);
  await caretEnd();
  const before = await js(`${BODY}.children.length`);
  await key('Enter', ['shift']);
  await type('Next');
  await tick(200);
  assert.equal(await js(`${BODY}.children.length`), before + 1);
  assert.equal(await js(`${BODY}.lastElementChild.classList.contains('flush')`), false);
  assert.equal(await js(`${BODY}.lastElementChild.querySelector('br') ? 'br' : 'ok'`), 'ok');
  await set('flush', true);
});

test('Markdown in the panel is Format → Markdown Emphasis', async () => {
  await set('markdown', false);
  assert.equal(await js('!!library.markdownOff'), true);
  assert.equal(await js('markdownOff()'), true);
  await set('markdown', true);
  assert.equal(await js('markdownOff()'), false);
});

test('File → Back to Bookshelf (⇧⌘B) closes the book onto the shelf', async () => {
  const find = (m) => { for (const i of m.items) { if (i.label === 'Back to Bookshelf') return i; const sub = i.submenu && find(i.submenu); if (sub) return sub; } return null; };
  const item = find(Menu.getApplicationMenu());
  assert.ok(item, 'the menu item is there');
  assert.equal(item.accelerator, 'CmdOrCtrl+Shift+B');
  assert.equal(item.enabled, true, 'with a book open');
  item.click();
  await tick(500);
  assert.equal(await js(`document.getElementById('bookshelf-view').hidden`), false);
  assert.equal(await js(`document.getElementById('editor-view').hidden`), true);
  assert.equal(await js('book'), null);
  assert.equal(find(Menu.getApplicationMenu()).enabled, false, 'and on the shelf it rests');
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
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Custom', chapters: [
        { title: 'One', paras: [{ text: 'Rain fell on the harbor.' }, { text: 'The boats came in.' }] },
        { title: 'Two', paras: [{ text: 'Morning.' }] }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
    })()`);
    await tick(500);
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
