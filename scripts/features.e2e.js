// A run through NEO's features end to end, one quick check each: typing,
// breaks and chapters, paragraph styles, placeholders, Darlings,
// snapshots, the Outline's cards, zoom, every export (the save dialog
// answers itself into a throwaway folder), the paperback and manuscript
// PDFs, importing what was exported, saving a cover, a bound shelf, a
// screenplay, and the menu this version keeps. Run with
// `npm run test:features`.

'use strict';

const { app, BrowserWindow, Menu, dialog } = require('electron');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js for why earlier runs'
// folders are the ones removed).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-features-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-features-test-${process.pid}-`));
const out = path.join(tmp, 'out');
fs.mkdirSync(out);
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: 'Test Author', penNames: [], firstRunDone: true, moreFeatures: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }, { id: 'shelf-2', name: 'Trilogy', bookIds: [] }]
}));
// every save dialog answers with its own suggested name, in the out folder
dialog.showSaveDialog = async (_win, opts) => ({ canceled: false, filePath: path.join(out, path.basename((opts || _win).defaultPath)) });
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
    await tick(50);
  }
}
async function key(keyCode, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await tick(150);
}
const BODY = (c) => `document.querySelectorAll('.chapter-body')[${c}]`;
async function caretEnd(c) {
  await js(`(() => {
    const body = ${BODY(c)};
    body.focus();
    const r = document.createRange();
    r.selectNodeContents(body.lastElementChild);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(150);
}
// a file the exports wrote, waiting for it if it's still being set
async function written(re, ms = 60000) {
  const t0 = Date.now();
  for (;;) {
    const f = fs.readdirSync(out).find((n) => re.test(n));
    if (f && fs.statSync(path.join(out, f)).size > 0) { await tick(300); return path.join(out, f); }
    if (Date.now() - t0 > ms) throw new Error('no file matching ' + re + ' in ' + fs.readdirSync(out).join(', '));
    await tick(250);
  }
}
const zipOk = (f) => { execFileSync('unzip', ['-tq', f]); return true; };
const unzipText = (f, entry) => execFileSync('unzip', ['-p', f, entry]).toString();
const head = (f, n) => fs.readFileSync(f).subarray(0, n);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('typing sets curly quotes, dashes and ellipses', async () => {
  await caretEnd(0);
  await key('Enter');
  await type('"Wait--" she said...');
  await tick(200);
  const text = await js(`${BODY(0)}.lastElementChild.textContent`);
  assert.match(text, /^“Wait—” she said…$/);
});

test('Enter twice makes a section break, three times a new chapter', async () => {
  const before = await js('book.chapterOrder.length');
  await key('Enter');
  await key('Enter');
  assert.equal(await js(`!!${BODY(0)}.querySelector('p.scene-break')`), true);
  await type('After the break.');
  await key('Enter');
  await key('Enter');
  await key('Enter');
  await tick(500);
  assert.equal(await js('book.chapterOrder.length'), before + 1);
  await type('A brand new chapter.');
  await tick(300);
});

test('a paragraph style comes off again with ⌘Z', async () => {
  await caretEnd(1);
  await key('1', [MOD, 'alt']);
  assert.equal(await js(`${BODY(1)}.lastElementChild.dataset.fmt`), 'h1');
  await key('z', [MOD]);
  await tick(400);
  assert.equal(await js(`${BODY(1)}.lastElementChild.dataset.fmt || ''`), '');
});

test('⌘⇧X drops a placeholder and its note', async () => {
  await caretEnd(0);
  const before = await js('stickies.length');
  await js('insertPlaceholder()');
  await tick(300);
  await key('Escape');
  assert.equal(await js(`!!${BODY(0)}.querySelector('.ph-mark')`), true);
  assert.equal(await js('stickies.length'), before + 1);
});

const paras = () => js(`[...${BODY(0)}.children].map((p) => p.textContent)`);
// select chapter 1's paragraph n, or characters from..to of it
const pick = (n, from, to) => js(`(() => {
  const p = ${BODY(0)}.children[${n}];
  const r = document.createRange();
  if (${from === undefined}) r.selectNodeContents(p);
  else { r.setStart(p.firstChild, ${from}); r.setEnd(p.firstChild, ${to}); }
  getSelection().removeAllRanges();
  getSelection().addRange(r);
})()`);
for (const n of [0, 1]) {
  test(`a whole paragraph sent to Darlings comes back as its own paragraph (paragraph ${n + 1})`, async () => {
    const was = await paras();
    await pick(n);
    const before = await js('darlings.length');
    await js('darlingFromKeyboard()');
    await tick(500);
    assert.equal(await js('darlings.length'), before + 1);
    assert.ok(!(await paras()).includes(was[n]), 'the words left the page');
    await js('restoreDarling(darlings[0].id)');
    await tick(600);
    assert.deepEqual(await paras(), was);
    assert.equal(await js(`${BODY(0)}.children[1].dataset.fmt`), 'h1', 'the heading is still a heading');
  });
}
test('a few words sent to Darlings go back mid-sentence', async () => {
  const was = await paras();
  // ("fell", without the space after it: a trailing space doesn't come back)
  await pick(0, 5, 9);
  await js('darlingFromKeyboard()');
  await tick(500);
  assert.notDeepEqual(await paras(), was);
  await js('restoreDarling(darlings[0].id)');
  await tick(600);
  assert.deepEqual(await paras(), was);
});

test('⌘S takes a snapshot', async () => {
  // (the day's own snapshot may already be there)
  const before = await js('loadSnaps(book.id, true).then((s) => s.length)');
  await js('flushAllSaves(); snapshotNow()');
  await tick(1500);
  assert.equal(await js('loadSnaps(book.id, true).then((s) => s.length)'), before + 1);
});

test('the Outline lays the book out as cards', async () => {
  await js(`switchTab('outline')`);
  await tick(600);
  const cards = await js(`document.querySelectorAll('#outline-board .ob-cell').length`);
  assert.ok(cards >= 2, cards + ' cards');
  await js(`switchTab('manuscript')`);
  await tick(400);
});

test('zooming keeps the line under the caret in place', async () => {
  await caretEnd(0);
  await js(`${BODY(0)}.lastElementChild.scrollIntoView({ block: 'center' })`);
  await tick(300);
  const top = () => js(`${BODY(0)}.lastElementChild.getBoundingClientRect().top`);
  const y0 = await top();
  await js('setPageZoom(1.4)');
  await tick(300);
  const y1 = await top();
  await js('setPageZoom(1)');
  await tick(300);
  assert.ok(Math.abs(y1 - y0) < 40, `moved ${Math.round(y1 - y0)}px`);
});

for (const fmt of ['txt', 'md', 'html', 'pdf', 'docx', 'epub']) {
  test(`File → Export → ${fmt.toUpperCase()}`, async () => {
    await js(`doExport('${fmt}')`);
    const f = await written(new RegExp(`^Features\\.${fmt}$`));
    if (fmt === 'pdf') assert.equal(head(f, 4).toString(), '%PDF');
    if (fmt === 'docx') { zipOk(f); assert.match(unzipText(f, 'word/document.xml'), /Arrival/); }
    if (fmt === 'epub') { zipOk(f); assert.equal(unzipText(f, 'mimetype'), 'application/epub+zip'); }
    if (fmt === 'md') assert.match(fs.readFileSync(f, 'utf8'), /### Arrival/);
  });
}

test('Paperback for KDP makes the interior and the cover template', async () => {
  fs.unlinkSync(path.join(out, 'Features.pdf')); // the plain PDF's, from above
  js(`doExport('paperback')`);
  await tick(800);
  await js(`document.querySelector('.print-modal').closest('.modal-backdrop').querySelector('.m-ok').click()`);
  const cover = await written(/cover template\.pdf$/, 120000);
  const f = await written(/^(?!.*cover template).*\.pdf$/);
  assert.equal(head(f, 4).toString(), '%PDF');
  assert.equal(head(cover, 4).toString(), '%PDF');
});

test('Manuscript Format as PDF and as Word', async () => {
  js(`doExport('manuscript')`);
  await tick(800);
  await js(`document.querySelector('.ms-modal .ms-pdf').click()`);
  assert.equal(head(await written(/manuscript\.pdf$/, 120000), 4).toString(), '%PDF');
  js(`doExport('manuscript')`);
  await tick(800);
  await js(`document.querySelector('.ms-modal .ms-docx').click()`);
  zipOk(await written(/manuscript\.docx$/));
});

test('what was exported imports back as a book with its chapters', async () => {
  const files = ['docx', 'md', 'txt'].map((x) => path.join(out, 'Features.' + x));
  const res = await js(`window.neo.importFiles(${JSON.stringify(files)})`);
  for (const r of res) {
    assert.ok(!r.error, r.name + ': ' + r.error);
    assert.ok(r.chapters.length >= 2, r.name + ' has ' + r.chapters.length + ' chapters');
  }
});

test('Save cover as image writes a full-size JPEG', async () => {
  await js(`shelfMeta(book.id).then((m) => saveCoverImage(m))`);
  const f = await written(/-cover\.jpg$/);
  assert.equal(head(f, 2).toString('hex'), 'ffd8');
});

test('a shelf binds into one book and unbinds again', async () => {
  await js(`(async () => {
    const shelf = library.shelves[1];
    await addImportedBooks([
      { name: 'Book One', chapters: [{ title: 'A', paras: [{ text: 'One begins.' }] }] },
      { name: 'Book Two', chapters: [{ title: 'B', paras: [{ text: 'Two begins.' }] }] }
    ], shelf);
    await bindShelf(shelf);
  })()`);
  await tick(500);
  assert.equal(await js('library.shelves[1].binding.bound'), true);
  await js('unbindShelf(library.shelves[1])');
  await tick(500);
  assert.equal(await js('!!(library.shelves[1].binding && library.shelves[1].binding.bound)'), false);
});

test('the menu has the formatting items and no update check', async () => {
  const labels = [];
  const walk = (m) => { for (const i of m.items) { labels.push(i.label); if (i.submenu) walk(i.submenu); } };
  walk(Menu.getApplicationMenu());
  for (const l of ['Paragraph Style', 'Heading', 'Numbered List', 'Clear Formatting', 'Copy Chapter Headings', 'Markdown Emphasis', 'Paperback for KDP…', 'Take Snapshot']) {
    assert.ok(labels.includes(l), l + ' is in the menu');
  }
  assert.ok(!labels.some((l) => /Check for Update/.test(l || '')), 'no Check for Update');
});

test('a screenplay sets its lines as it types, and exports', async () => {
  await js('createScriptOnShelf(library.shelves[0])');
  await tick(1200);
  await js(`(() => { const b = document.querySelector('.chapter-body'); b.focus(); const r = document.createRange(); r.selectNodeContents(b.lastElementChild); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  await type('INT. KITCHEN - NIGHT');
  await key('Enter');
  await type('Rain at the window.');
  await key('Enter');
  await type('MARA');
  await key('Enter');
  await type('Who is there?');
  await tick(400);
  const lines = await js(`[...document.querySelector('.chapter-body').children].map((p) => spType(p))`);
  for (const kind of ['heading', 'action', 'character', 'dialogue']) assert.ok(lines.includes(kind), kind + ' in ' + lines.join(','));
  await js(`book.title = 'Script'; flushAllSaves()`);
  for (const fmt of ['pdf', 'fountain', 'fdx']) {
    await js(`spExport('${fmt}')`);
    const f = await written(new RegExp(`\\.${fmt}$`));
    if (fmt === 'pdf') assert.equal(head(f, 4).toString(), '%PDF');
    else assert.match(fs.readFileSync(f, 'utf8'), /KITCHEN/);
    fs.unlinkSync(f);
  }
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
      await addImportedBooks([{ name: 'Features', chapters: [
        { title: 'First', paras: [{ text: 'Rain fell on the harbor all night long.' }, { text: 'Arrival' }, { text: 'The boats came in at dawn.' }] }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
      // the second paragraph as a heading, for the exports to carry
      const p = document.querySelector('.chapter-body').children[1];
      p.dataset.fmt = 'h1';
      syncChapter(p.parentElement, book.chapterOrder[0]);
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
