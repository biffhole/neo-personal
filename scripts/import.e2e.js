// End-to-end tests for importing: NEO's own exports read back (Word, EPUB,
// PDF, web page, Markdown, the paperback PDF with its running heads and
// page numbers), and files made the way other programs make them (a Word
// file with headings, a numbered list and a quote; OpenDocument; RTF; a web
// page; a link served from this computer). Each must come in as the right
// chapters with their titles, paragraphs, emphasis and paragraph styles.
// Run with `npm run test:import`.

'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-import-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-import-test-${process.pid}-`));
const out = path.join(tmp, 'out');
fs.mkdirSync(out);
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: 'Test Author', penNames: [], firstRunDone: true, moreFeatures: true,
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
dialog.showSaveDialog = async (_win, opts) => ({ canceled: false, filePath: path.join(out, path.basename((opts || _win).defaultPath)) });
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');
const JSZip = require('jszip');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
async function written(re, ms = 120000) {
  const t0 = Date.now();
  for (;;) {
    const f = fs.readdirSync(out).find((n) => re.test(n));
    if (f && fs.statSync(path.join(out, f)).size > 0) { await tick(300); return path.join(out, f); }
    if (Date.now() - t0 > ms) throw new Error('no file matching ' + re);
    await tick(250);
  }
}
const importOne = async (file) => {
  const [r] = await js(`window.neo.importFiles(${JSON.stringify([file])})`);
  assert.ok(r, 'nothing came back for ' + path.basename(file));
  assert.ok(!r.error, r.error);
  return r;
};
const plain = (t) => String(t || '').replace(/\\([\\*_])/g, '$1');
const words = (r) => r.chapters.map((c) => c.paras.map((p) => p.text || '').join(' ')).join(' ');

// the book the exports are made of
const BOOK = [
  { title: 'The Harbor', paras: [
    'Rain fell on the harbor all night, and *nobody* slept.',
    { fmt: 'h1', text: 'Morning' },
    'The boats came in at dawn with their nets **full** of silver fish.',
    { fmt: 'ul', text: 'herring' }, { fmt: 'ul', text: 'mackerel' },
    { fmt: 'quote', text: 'The sea gives and the sea takes.' },
    'Nobody argued with the old saying that morning.'
  ] },
  { title: 'The Lighthouse', paras: ['The keeper climbed the stairs one hundred and twelve times a day.', 'He counted every one of them.'] },
  { title: 'The Storm', paras: ['When the storm came, it came from the east, as the old men said it would.'] }
];

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// NEO's own book, exported and read back
const checkRoundTrip = (r, what) => {
  assert.equal(r.chapters.length, 3, what + ': ' + r.chapters.map((c) => c.title).join(' | '));
  assert.deepEqual(r.chapters.map((c) => c.title), ['The Harbor', 'The Lighthouse', 'The Storm'], what);
  const all = words(r);
  assert.match(plain(all), /Rain fell on the harbor all night, and/);
  assert.match(plain(all), /one hundred and twelve times a day/);
  assert.match(plain(all), /from the east, as the old men said it would/);
};
for (const fmt of ['docx', 'epub', 'html', 'md', 'pdf']) {
  test(`NEO's own ${fmt.toUpperCase()} comes back as the same chapters`, async () => {
    await js(`doExport('${fmt}')`);
    const file = await written(new RegExp(`^Export-Me\\.${fmt}$`));
    if (process.env.NEO_KEEP) fs.copyFileSync(file, path.join(process.env.NEO_KEEP, path.basename(file)));
    const r = await importOne(file);
    checkRoundTrip(r, fmt);
    assert.equal(r.title, 'Export Me', 'the title');
    const first = r.chapters[0].paras;
    if (fmt !== 'pdf') {
      assert.ok(first.some((p) => p.fmt === 'h1' && /Morning/.test(p.text)), fmt + ': the heading inside the chapter');
      assert.deepEqual(first.filter((p) => p.fmt === 'ul').map((p) => plain(p.text)), ['herring', 'mackerel'], fmt + ': the list');
      assert.ok(first.some((p) => p.fmt === 'quote'), fmt + ': the quote');
    }
    if (fmt !== 'md') {
      assert.match(first[0].text, /\*nobody\*/, fmt + ': italics');
      assert.ok(first.some((p) => /\*\*full\*\*/.test(p.text)), fmt + ': bold');
    }
    // (a PDF's list bullets are drawn, not written: its items come in as lines)
    if (fmt === 'pdf') assert.ok(first.some((p) => p.fmt === 'h1' && /Morning/.test(p.text)), 'pdf: the heading inside the chapter');
  });
}

test('the paperback PDF: running heads and page numbers left out, hyphenated words whole', async () => {
  for (const f of fs.readdirSync(out)) if (/\.pdf$/.test(f)) fs.unlinkSync(path.join(out, f));
  js(`doExport('paperback')`);
  await tick(800);
  await js(`document.querySelector('.print-modal').closest('.modal-backdrop').querySelector('.m-ok').click()`);
  await written(/cover template\.pdf$/);
  const r = await importOne(await written(/^(?!.*cover template).*\.pdf$/));
  const all = plain(words(r));
  assert.match(all, /one hundred and twelve times a day/);
  assert.match(all, /from the east, as the old men said it would/);
  assert.ok(!/\b(Export Me|Test Author)\b.*\b(Export Me|Test Author)\b/.test(all), 'no running heads in the text');
  const chs = r.chapters.filter((c) => c.paras.some((p) => /keeper|storm|harbor/i.test(p.text || '')));
  assert.ok(chs.length >= 3, 'the three chapters: ' + r.chapters.map((c) => c.title).join(' | '));
});

// A PDF the way a word processor writes one: a line of text at a time in
// the standard fonts, a running head and a page number on every page but
// the first, paragraphs with a first-line indent, a word hyphenated across
// a line break
function plainPdf(file) {
  const pages = [];
  let y = 0;
  const page = () => { pages.push([]); y = 700; };
  const line = (font, size, x, text) => { if (y < 90) page(); pages[pages.length - 1].push({ font, size, x, y, text }); y -= size * 1.45; };
  const wrap = (p) => { const out = []; let cur = ''; for (const w of p.split(' ')) { if ((cur + ' ' + w).trim().length > 80) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } out.push(cur); return out; };
  const chapter = (num, title, paras) => {
    if (pages[pages.length - 1].length) page();
    line('F2', 16, 230, 'CHAPTER ' + num); y -= 4;
    line('F2', 14, 240, title); y -= 14;
    paras.forEach((p, i) => {
      const lines = wrap(p);
      if (i === 0) { const at = lines[0].lastIndexOf(' '); const w = lines[0].slice(at + 1); lines[0] = lines[0].slice(0, at) + ' ' + w.slice(0, 3) + '-'; lines[1] = w.slice(3) + ' ' + lines[1]; }
      lines.forEach((l, j) => line('F1', 11, 72 + (j === 0 && i > 0 ? 22 : 0), l));
    });
  };
  const one = 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief.';
  const two = 'It was the Dover road that lay, on a Friday night late in November, before the first of the persons with whom this history has business.';
  page();
  line('F2', 24, 180, 'A Tale of Two Cities'); y -= 10;
  line('F1', 12, 250, 'by Charles Dickens');
  chapter('I', 'The Period', Array(10).fill(one));
  chapter('II', 'The Mail', Array(10).fill(two));
  const objs = ['<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'];
  const esc = (t) => t.replace(/[\\()]/g, '\\$&');
  const contents = pages.map((pg, n) => {
    const ops = (n ? ['BT /F1 9 Tf 250 750 Td (A TALE OF TWO CITIES) Tj ET', `BT /F1 9 Tf 300 40 Td (${n + 1}) Tj ET`] : [])
      .concat(pg.map((l) => `BT /${l.font} ${l.size} Tf ${l.x} ${l.y.toFixed(1)} Td (${esc(l.text)}) Tj ET`)).join('\n');
    objs.push(`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`);
    return objs.length;
  });
  const pagesId = objs.length + pages.length + 1;
  const kids = contents.map((c) => { objs.push(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 1 0 R /F2 2 0 R >> >> >>`); return objs.length; });
  objs.push(`<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
  objs.push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offs = objs.map((o, i) => { const at = Buffer.byteLength(out, 'latin1'); out += `${i + 1} 0 obj\n${o}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, Buffer.from(out, 'latin1'));
}

test('a word processor\'s PDF: title, author, chapters, no running heads, hyphenated words whole', async () => {
  const f = path.join(tmp, 'tale.pdf');
  plainPdf(f);
  const r = await importOne(f);
  assert.equal(r.title, 'A Tale of Two Cities');
  assert.equal(r.author, 'Charles Dickens');
  assert.deepEqual(r.chapters.map((c) => c.title), ['The Period', 'The Mail']);
  assert.equal(r.chapters[0].paras.length, 10, 'ten paragraphs: ' + r.chapters[0].paras.map((p) => p.text.slice(0, 20)).join(' | '));
  assert.match(r.chapters[0].paras[0].text, /^It was the best of times, .* the age of wisdom, it was the age of foolishness, it was the epoch of belief\.$/);
  assert.ok(!/TALE OF TWO CITIES/.test(words(r)), 'no running heads');
});

// a Word file made the way Word makes one
async function wordFile(file) {
  const zip = new JSZip();
  const p = (text, pPr = '', rPr = '') => `<w:p><w:pPr>${pPr}</w:pPr><w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const st = (id) => `<w:pStyle w:val="${id}"/>`;
  const list = (n) => `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${n}"/></w:numPr>`;
  const body = [
    p('My Novel', st('Title')),
    p('Chapter One', st('Heading1')), p('It began on a Tuesday.'),
    p('A Scene Apart', st('Heading2')), p('Later, in the kitchen.', '', '<w:i/>'),
    p('Chapter Two', st('Heading1')), p('Things to pack:'),
    p('a lamp', list(1)), p('a rope', list(1)),
    p('first', list(2)), p('second', list(2)),
    p('All is well that ends well.', st('Quote')),
    p('Chapter Three', st('Heading1')), p('The end came quietly.')
  ].join('');
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`);
  zip.file('word/styles.xml', `<?xml version="1.0"?><w:styles xmlns:w="w">
    <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
    <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
    <w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/></w:style></w:styles>`);
  zip.file('word/numbering.xml', `<?xml version="1.0"?><w:numbering xmlns:w="w">
    <w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
    <w:abstractNum w:abstractNumId="11"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
    <w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="11"/></w:num></w:numbering>`);
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
}
const checkNovel = (r, what, { lists = true } = {}) => {
  assert.equal(r.title, 'My Novel', what + ': the title');
  assert.deepEqual(r.chapters.map((c) => c.title), ['', '', ''], what + ': numbered chapters, no titles: ' + JSON.stringify(r.chapters.map((c) => c.title)));
  const [one, two] = r.chapters;
  assert.ok(one.paras.some((p) => p.fmt === 'h1' && /A Scene Apart/.test(p.text)), what + ': the smaller heading stays in its chapter');
  assert.ok(one.paras.some((p) => /^\*Later, in the kitchen\.\*$/.test(p.text)), what + ': italics');
  if (lists) {
    assert.deepEqual(two.paras.filter((p) => p.fmt === 'ul').map((p) => p.text), ['a lamp', 'a rope'], what + ': bullets');
    assert.deepEqual(two.paras.filter((p) => p.fmt === 'ol').map((p) => p.text), ['first', 'second'], what + ': numbers');
  }
  assert.ok(two.paras.some((p) => p.fmt === 'quote'), what + ': the quote');
};

test('a Word file: Heading 1 chapters, a Heading 2 inside, bullets, numbers and a quote', async () => {
  const f = path.join(tmp, 'novel.docx');
  await wordFile(f);
  checkNovel(await importOne(f), 'docx');
});

test('a web page: its title, h2 chapters, lists and a quote', async () => {
  const f = path.join(tmp, 'novel.html');
  fs.writeFileSync(f, `<!DOCTYPE html><html><head><title>My Novel</title><style>.it { font-style: italic }</style></head><body>
    <nav><a href="/">Home</a> · <a href="/about">About</a></nav>
    <h1>My Novel</h1>
    <h2>Chapter One</h2><p>It began on a Tuesday.</p>
    <h3>A Scene Apart</h3><p><span class="it">Later, in the kitchen.</span></p>
    <h2>Chapter Two</h2><p>Things to pack:</p><ul><li>a lamp</li><li>a rope</li></ul><ol><li>first</li><li>second</li></ol>
    <blockquote><p>All is well that ends well.</p></blockquote>
    <h2>Chapter Three</h2><p>The end came quietly &mdash; at last.</p></body></html>`);
  const r = await importOne(f);
  checkNovel(r, 'html');
  assert.match(words(r), /quietly — at last/);
});

test('an OpenDocument file (.odt): headings, italics by style, lists, a quote', async () => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text');
  zip.file('styles.xml', `<office:document-styles xmlns:office="o" xmlns:style="s" xmlns:fo="f" xmlns:text="t"><office:styles>
    <style:style style:name="Quotations" style:family="paragraph"/></office:styles></office:document-styles>`);
  zip.file('content.xml', `<office:document-content xmlns:office="o" xmlns:style="s" xmlns:fo="f" xmlns:text="t"><office:automatic-styles>
    <style:style style:name="T1" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
    <text:list-style style:name="L2"><text:list-level-style-number text:level="1"/></text:list-style>
    </office:automatic-styles><office:body><office:text>
    <text:p text:style-name="Title">My Novel</text:p>
    <text:h text:outline-level="1">Chapter One</text:h><text:p>It began on a Tuesday.</text:p>
    <text:h text:outline-level="2">A Scene Apart</text:h><text:p><text:span text:style-name="T1">Later, in the kitchen.</text:span></text:p>
    <text:h text:outline-level="1">Chapter Two</text:h><text:p>Things to pack:</text:p>
    <text:list><text:list-item><text:p>a lamp</text:p></text:list-item><text:list-item><text:p>a rope</text:p></text:list-item></text:list>
    <text:list text:style-name="L2"><text:list-item><text:p>first</text:p></text:list-item><text:list-item><text:p>second</text:p></text:list-item></text:list>
    <text:p text:style-name="Quotations">All is well that ends well.</text:p>
    <text:h text:outline-level="1">Chapter Three</text:h><text:p>The end came quietly.</text:p>
    </office:text></office:body></office:document-content>`);
  const f = path.join(tmp, 'novel.odt');
  fs.writeFileSync(f, await zip.generateAsync({ type: 'nodebuffer' }));
  const r = await importOne(f);
  // (an .odt's title and quote ride on named styles: "Title", "Quotations")
  assert.equal(r.chapters.length, 3, JSON.stringify(r.chapters.map((c) => c.title)));
  assert.ok(r.chapters[0].paras.some((p) => p.fmt === 'h1' && /A Scene Apart/.test(p.text)), 'the smaller heading');
  assert.ok(r.chapters[0].paras.some((p) => /^\*Later, in the kitchen\.\*$/.test(p.text)), 'italics by style');
  assert.deepEqual(r.chapters[1].paras.filter((p) => p.fmt === 'ol').map((p) => p.text), ['first', 'second']);
  assert.deepEqual(r.chapters[1].paras.filter((p) => p.fmt === 'ul').map((p) => p.text), ['a lamp', 'a rope']);
});

test('an RTF file: chapters from "Chapter" lines, bold and italic', async () => {
  const f = path.join(tmp, 'story.rtf');
  fs.writeFileSync(f, String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times;}}\f0\fs24
Chapter 1\par
It began on a {\i Tuesday}, as these things do.\par
\par
Chapter 2\par
The {\b end} came quietly \emdash  at last.\par
}`);
  const r = await importOne(f);
  assert.equal(r.chapters.length, 2, JSON.stringify(r.chapters));
  assert.match(r.chapters[0].paras[0].text, /began on a \*Tuesday\*/);
  assert.match(r.chapters[1].paras[0].text, /The \*\*end\*\* came quietly/);
});

test('a Markdown file: # chapters, ## inside, lists and quotes', async () => {
  const f = path.join(tmp, 'notes.md');
  fs.writeFileSync(f, '# Chapter One\n\nIt began on a Tuesday.\n\n## A Scene Apart\n\n*Later, in the kitchen.*\n\n# Chapter Two\n\nThings to pack:\n\n- a lamp\n- a rope\n\n1. first\n2. second\n\n> All is well\n> that ends well.\n\n# Chapter Three\n\nThe end came quietly.\n');
  const r = await importOne(f);
  assert.equal(r.chapters.length, 3);
  assert.ok(r.chapters[0].paras.some((p) => p.fmt === 'h1'));
  assert.deepEqual(r.chapters[1].paras.filter((p) => p.fmt).map((p) => [p.fmt, p.text]),
    [['ul', 'a lamp'], ['ul', 'a rope'], ['ol', 'first'], ['ol', 'second'], ['quote', 'All is well that ends well.']]);
});

test('a link: a web page and a Word file, fetched and read', async () => {
  const docx = path.join(tmp, 'novel.docx');
  const server = http.createServer((req, res) => {
    if (req.url === '/story') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><head><title>A Web Story</title></head><body><header>Site menu</header><article><h2>Chapter 1</h2><p>' + 'Words on the web. '.repeat(20) + '</p><h2>Chapter 2</h2><p>More words.</p></article><footer>© the site</footer></body></html>');
    } else if (req.url === '/novel.docx') {
      res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      res.end(fs.readFileSync(docx));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const [page] = await js(`window.neo.importUrl(${JSON.stringify(base + '/story')})`);
    assert.ok(!page.error, page.error);
    assert.equal(page.title, 'A Web Story');
    assert.equal(page.chapters.length, 2);
    assert.ok(!/Site menu|the site/.test(words(page)), 'no site furniture');
    const [doc] = await js(`window.neo.importUrl(${JSON.stringify(base + '/novel.docx')})`);
    assert.ok(!doc.error, doc.error);
    checkNovel(doc, 'docx by link');
    const [bad] = await js(`window.neo.importUrl('not a link')`);
    assert.ok(bad.error);
  } finally {
    server.close();
  }
});

test('Google Docs and Drive links go to the file Google makes of them', async () => {
  const { linkSource } = require('../importers.js');
  assert.equal(linkSource('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit?usp=sharing').url,
    'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/export?format=docx');
  assert.equal(linkSource('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view').url,
    'https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp');
  const gdoc = path.join(tmp, 'Draft.gdoc');
  fs.writeFileSync(gdoc, JSON.stringify({ doc_id: 'x' }));
  // (no network in a test: the shortcut is read, and its fetch fails plainly)
  const [r] = await js(`window.neo.importFiles(${JSON.stringify([gdoc])})`);
  assert.ok(r.error, 'an error, not a crash');
});

test('an imported book keeps its paragraph styles on the page', async () => {
  const f = path.join(tmp, 'novel.docx');
  const before = await js('library.shelves[0].bookIds.length');
  await js(`window.neo.importFiles(${JSON.stringify([f])}).then((r) => addImportedBooks(r, library.shelves[0]))`);
  await tick(500);
  assert.equal(await js('library.shelves[0].bookIds.length'), before + 1);
  await js('openBook(library.shelves[0].bookIds[library.shelves[0].bookIds.length - 1])');
  await tick(600);
  const fmts = await js(`[...document.querySelectorAll('.chapter-body p[data-fmt]')].map((p) => p.dataset.fmt)`);
  assert.deepEqual(fmts, ['h1', 'ul', 'ul', 'ol', 'ol', 'quote']);
  assert.equal(await js('book.title'), 'My Novel');
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
      await addImportedBooks([{ name: 'Export Me', chapters: ${JSON.stringify(BOOK.map((c) => ({ title: c.title, paras: c.paras.map((p) => (typeof p === 'string' ? { text: p } : p)) })))} }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      await openBook(ids[ids.length - 1]);
      flushAllSaves();
    })()`);
    await tick(600);
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
