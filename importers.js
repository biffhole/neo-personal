'use strict';

// ---------------------------------------------------------------------------
// Import, beyond NEO's own .docx / .txt / .md: web pages, EPUB, OpenDocument,
// PDF, RTF and old Word files, and documents behind a link (a Google Doc, a
// file on Google Drive, any web page). Each reader hands back paragraphs the
// way importFile in main.js reads a Word file:
//   { text, pageBreak, heading, level, title, fmt }
// text in Markdown emphasis (**bold**, *italic*) with the document's own
// * _ and \ escaped; heading with its level (1 the largest); fmt a NEO
// paragraph style ('quote', 'ul', 'ol'). importFile then finds the chapters.
// ---------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');

// numeric references too, and &amp; last, so a literal "&lt;" in the text
// stays "&lt;" instead of turning into "<"
const NAMED = {
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', shy: '­', zwj: '‍', zwnj: '‌',
  mdash: '—', ndash: '–', hellip: '…', bull: '•', middot: '·', prime: '′', Prime: '″',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›',
  copy: '©', reg: '®', trade: '™', deg: '°', sect: '§', para: '¶', dagger: '†', Dagger: '‡', times: '×', divide: '÷',
  frac12: '½', frac14: '¼', frac34: '¾', euro: '€', pound: '£', yen: '¥', cent: '¢', iexcl: '¡', iquest: '¿',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', oelig: 'œ',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', yuml: 'ÿ', szlig: 'ß',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Auml: 'Ä', Aring: 'Å', Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê',
  Iacute: 'Í', Ntilde: 'Ñ', Oacute: 'Ó', Ouml: 'Ö', Oslash: 'Ø', Uacute: 'Ú', Uuml: 'Ü'
};
const decodeEntities = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return m; } })
  .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return m; } })
  .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, n) => (n === 'amp' || n === 'lt' || n === 'gt' || n === 'quot' || n === 'apos' ? m : NAMED[n] || m))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// a document's own * _ and \ are text, not emphasis: they travel escaped,
// the way Markdown writes them, and the window turns them back into letters
const escapeMarks = (s) => s.replace(/[\\*_]/g, '\\$&');

// Runs of { text, bold, italic } as one line of Markdown emphasis. Runs
// styled alike join first, so "**one**" + "**two**" is "**onetwo**", and
// the markers hug the words: "** bold **" isn't emphasis to a reader of
// Markdown, and a run of spaces gets none at all.
function runsToText(runs) {
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.bold === run.bold && last.italic === run.italic) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged.map((run) => {
    const m = run.text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    let t = escapeMarks(m[2]);
    if (!t) return run.text;
    if (run.bold) t = '**' + t + '**';
    if (run.italic) t = '*' + t + '*';
    return m[1] + t + m[3];
  }).join('').replace(/\s+/g, ' ').trim();
}

/* ---------- CSS: what a class says about its words ---------- */

// A font size as points, or as a multiple of the text around it
function cssSize(v) {
  const m = /^\s*([\d.]+)\s*(px|pt|em|rem|%)?/.exec(v || '');
  if (!m) {
    const named = { 'xx-large': 2, 'x-large': 1.5, larger: 1.2, large: 1.125 }[String(v || '').trim()];
    return named ? { rel: named } : null;
  }
  const n = parseFloat(m[1]);
  if (m[2] === 'px') return { abs: n * 0.75 };
  if (m[2] === 'pt') return { abs: n };
  if (m[2] === '%') return { rel: n / 100 };
  if (m[2] === 'em' || m[2] === 'rem') return { rel: n };
  return null;
}
// the properties NEO reads, from a declaration block or a style attribute
function cssProps(decl) {
  const out = {};
  for (const part of String(decl || '').split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim().toLowerCase();
    if (k === 'font-weight') out.bold = v === 'bold' || v === 'bolder' || parseInt(v, 10) >= 600;
    else if (k === 'font-style') out.italic = v === 'italic' || v === 'oblique';
    else if (k === 'font-size') out.size = cssSize(v);
    else if (k === 'font') {
      // the shorthand textutil writes: "italic bold 24.0px Times"
      if (/\bitalic\b/.test(v)) out.italic = true;
      if (/\bbold\b|\b[6-9]00\b/.test(v)) out.bold = true;
      const s = v.match(/([\d.]+(?:px|pt|em|%))/);
      if (s) out.size = cssSize(s[1]);
    } else if ((k === 'page-break-before' || k === 'break-before') && /always|page|left|right/.test(v)) out.pageBreak = true;
    else if (k === 'text-align' && v === 'center') out.center = true;
  }
  return out;
}
// .class rules (alone, or after a tag name) from a style sheet
function cssClasses(css) {
  const map = {};
  const clean = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{([\s\S]*?\})\s*\}/g, '$1');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props = cssProps(m[2]);
    if (!Object.keys(props).length) continue;
    for (const sel of m[1].split(',')) {
      const s = sel.trim().match(/^[a-z0-9]*\.([\w-]+)$/i);
      if (s) map[s[1]] = Object.assign(map[s[1]] || {}, props);
    }
  }
  return map;
}

/* ---------- HTML ---------- */

const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'section', 'article', 'header',
  'footer', 'main', 'aside', 'figure', 'figcaption', 'pre', 'tr', 'td', 'th', 'dd', 'dt', 'dl', 'ul', 'ol', 'table', 'body',
  'address', 'center', 'caption', 'hgroup', 'details', 'summary']);
// (a site's or an ebook's navigation is never the story)
const SKIP = new Set(['nav', 'head', 'script', 'style', 'noscript', 'svg', 'math', 'title', 'template', 'iframe', 'button', 'select',
  'object', 'canvas', 'video', 'audio', 'form', 'textarea', 'rt', 'rp']);
const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'wbr', 'col', 'area', 'base', 'source', 'embed', 'param', 'track']);
const attrOf = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs || '');
  return m ? decodeEntities(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : '';
};
// a chapter's title set as a styled paragraph, the way ebooks often do it
const TITLE_CLASS = /(^|[-_\s])(chap(ter)?[-_]?(title|head|num(ber)?|hd)|title|heading|ct|cn|h[1-6])($|[-_\s])/i;

// The paragraphs of an HTML document. css: style sheets from outside it
// (an EPUB's, an OpenDocument's styles); opts.firstBreak marks the first
// paragraph as starting a new page (an EPUB's next file).
function htmlToParas(html, css = '', opts = {}) {
  html = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<![^>]*>|<\?[^>]*\?>/g, '');
  const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const classes = cssClasses(css + '\n' + inline);
  const styleOf = (tag, attrs) => {
    const own = {};
    for (const c of attrOf(attrs, 'class').split(/\s+/)) if (c && classes[c]) Object.assign(own, classes[c]);
    Object.assign(own, cssProps(attrOf(attrs, 'style')));
    if (tag === 'b' || tag === 'strong') own.bold = own.bold !== false;
    if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'dfn' || tag === 'var') own.italic = own.italic !== false;
    if (/^h[1-6]$/.test(tag) && own.bold === undefined) own.bold = false; // a heading's weight is its style's, not its words'
    return own;
  };

  const paras = [];
  const stack = [{ tag: '#root', bold: false, italic: false, scale: 1 }];
  let runs = [];
  let pendingBreak = !!opts.firstBreak;
  let skipping = 0;
  const top = () => stack[stack.length - 1];
  const nearest = (re) => { for (let i = stack.length - 1; i >= 0; i--) if (re.test(stack[i].tag)) return stack[i]; return null; };
  const flush = () => {
    const text = runsToText(runs);
    runs = [];
    if (!text) return;
    const p = { text, pageBreak: pendingBreak, heading: false, title: false };
    pendingBreak = false;
    const h = nearest(/^h[1-6]$/);
    const li = nearest(/^li$/);
    if (h) { p.heading = true; p.level = +h.tag[1]; } else if (li) {
      const list = nearest(/^(ul|ol)$/);
      p.fmt = list && list.tag === 'ol' ? 'ol' : 'ul';
    } else if (nearest(/^blockquote$/)) p.fmt = 'quote';
    // a paragraph set large, or with a chapter-title class, and short
    if (stack.some((f) => f.role === 'title')) { p.title = true; p.fmt = undefined; paras.push(p); return; }
    if (stack.some((f) => f.role === 'quote') && !p.heading && !p.fmt) p.fmt = 'quote';
    const block = nearest(/^(p|div|center|header|section)$/);
    const sized = top().scale;
    if (!p.heading && text.length < 140 && !/[.,;:]$/.test(text.replace(/\*+$/, ''))) {
      if (sized >= 1.3) { p.heading = true; p.level = sized >= 1.8 ? 1 : sized >= 1.5 ? 2 : 3; } else if (block && TITLE_CLASS.test(block.cls || '') && !/(sub|author|byline|epigraph)/i.test(block.cls || '')) {
        p.heading = true; p.level = 2;
      }
    }
    if (p.heading) p.fmt = undefined;
    paras.push(p);
  };
  const tagRe = /<(\/)?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?>|([^<]+)/g;
  let m;
  while ((m = tagRe.exec(html))) {
    if (m[5] !== undefined) {
      if (skipping) continue;
      const pre = nearest(/^pre$/);
      let text = decodeEntities(m[5]);
      if (!pre) text = text.replace(/[\s­]+/g, (s) => (s === '­' ? '' : ' '));
      if (pre && text.includes('\n')) {
        text.split('\n').forEach((line, i) => { if (i) flush(); runs.push({ text: line, bold: top().bold, italic: top().italic }); });
      } else runs.push({ text, bold: top().bold, italic: top().italic });
      continue;
    }
    const closing = !!m[1];
    const tag = m[2].toLowerCase().replace(/^\w+:/, '');
    if (SKIP.has(tag)) {
      if (m[4] || VOID.has(tag)) continue;
      skipping += closing ? -1 : 1;
      if (skipping < 0) skipping = 0;
      continue;
    }
    if (skipping) continue;
    if (tag === 'br') { flush(); continue; }
    if (tag === 'hr') { flush(); paras.push({ text: '***', pageBreak: false }); continue; }
    if (tag === 'img') {
      // a picture's words, where the picture is all there is (a drop cap set as an image)
      continue;
    }
    if (VOID.has(tag)) continue;
    const block = BLOCKS.has(tag);
    if (closing) {
      // close back to the matching element (HTML forgives unclosed <p>s)
      let i = stack.length - 1;
      while (i > 0 && stack[i].tag !== tag) i--;
      if (i <= 0) continue;
      if (block || stack.slice(i).some((f) => f.block)) flush();
      stack.length = i;
      continue;
    }
    // a new paragraph closes an open one (<p>one<p>two)
    if ((tag === 'p' || tag === 'li') && nearest(new RegExp(`^${tag}$`))) {
      let i = stack.length - 1;
      while (i > 0 && stack[i].tag !== tag) i--;
      flush();
      stack.length = i;
    }
    if (block) flush();
    const st = styleOf(tag, m[3]);
    if (st.pageBreak) pendingBreak = paras.length > 0 || pendingBreak;
    const parent = top();
    const size = st.size;
    const scale = size ? (size.rel ? parent.scale * size.rel : size.abs / (opts.bodyPt || 12)) : parent.scale;
    const frame = {
      tag, block, cls: attrOf(m[3], 'class') || parent.cls,
      role: attrOf(m[3], 'data-neo-role'),
      bold: st.bold !== undefined ? st.bold : parent.bold,
      italic: st.italic !== undefined ? st.italic : parent.italic,
      scale
    };
    if (!m[4]) stack.push(frame);
  }
  flush();
  return paras;
}

// The body text's size in points, from a document's style sheets: the size
// of the most words, so a heading's size reads against it
function bodyPointSize(html, css) {
  const classes = cssClasses(css + '\n' + [...String(html).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n'));
  const weight = {};
  for (const m of String(html).matchAll(/<p\b[^>]*class\s*=\s*["']?([^"'>]+)["']?[^>]*>([\s\S]*?)<\/p>/gi)) {
    for (const c of m[1].split(/\s+/)) {
      const s = classes[c] && classes[c].size;
      if (s && s.abs) weight[s.abs] = (weight[s.abs] || 0) + m[2].replace(/<[^>]+>/g, '').length;
    }
  }
  const best = Object.entries(weight).sort((a, b) => b[1] - a[1])[0];
  return best ? +best[0] : 12;
}

// The part of a web page that's the writing: its <article> or <main>, else
// the body without the site's navigation, header, footer and sidebars
function mainContent(html) {
  const pick = (tag) => {
    const all = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((x) => x[1]);
    return all.sort((a, b) => b.length - a.length)[0];
  };
  const found = pick('article') || pick('main');
  if (found && found.replace(/<[^>]+>/g, '').trim().length > 200) return found;
  return html.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, '');
}

function readHtml(fp) {
  const html = fs.readFileSync(fp, 'utf8');
  return htmlDocument(html);
}
function htmlDocument(html, { page = false } = {}) {
  const title = decodeEntities(((html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)/i) || [])[1]) ||
    ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]) || '').replace(/\s+/g, ' ').trim();
  const author = decodeEntities((html.match(/<meta[^>]+name=["']author["'][^>]*content=["']([^"']+)/i) || [])[1] || '').trim();
  const body = page ? mainContent(html) : html;
  return { paras: htmlToParas(body, '', { bodyPt: bodyPointSize(html, '') }), title: title || null, author: author || null };
}

/* ---------- EPUB ---------- */

async function readEpub(fp) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(fp));
  const read = async (p) => { const f = zip.file(p); return f ? f.async('string') : null; };
  const container = await read('META-INF/container.xml');
  const opfPath = container && (container.match(/full-path\s*=\s*"([^"]+)"/) || [])[1];
  const opf = opfPath && await read(opfPath);
  if (!opf) throw new Error('Not a valid EPUB');
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const resolve = (href) => {
    const parts = (base + decodeURIComponent(href.split('#')[0])).split('/');
    const out = [];
    for (const p of parts) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); }
    return out.join('/');
  };
  const items = {};
  for (const im of opf.matchAll(/<(?:\w+:)?item\b([^>]*)\/?>/g)) {
    const id = attrOf(im[1], 'id');
    if (id) items[id] = { href: attrOf(im[1], 'href'), type: attrOf(im[1], 'media-type'), props: attrOf(im[1], 'properties') };
  }
  const meta = (tag) => decodeEntities(((opf.match(new RegExp(`<dc:${tag}\\b[^>]*>([\\s\\S]*?)</dc:${tag}>`, 'i')) || [])[1] || '').replace(/<[^>]+>/g, '')).trim();
  const title = meta('title');
  const author = meta('creator');
  // every style sheet in the book: an ebook styles its italics by class
  let css = '';
  for (const it of Object.values(items)) if (it.type === 'text/css') css += (await read(resolve(it.href))) || '';
  // the guide's (EPUB 2) cover, title page and contents are not the story
  const skipHrefs = new Set();
  for (const g of opf.matchAll(/<reference\b([^>]*)\/?>/g)) {
    if (/^(cover|title-page|toc|copyright-page)$/i.test(attrOf(g[1], 'type'))) skipHrefs.add(resolve(attrOf(g[1], 'href')));
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const paras = [];
  for (const ref of opf.matchAll(/<(?:\w+:)?itemref\b([^>]*)\/?>/g)) {
    if (attrOf(ref[1], 'linear') === 'no') continue;
    const it = items[attrOf(ref[1], 'idref')];
    if (!it || /\bnav\b|cover-image/.test(it.props || '')) continue;
    const p = resolve(it.href);
    if (skipHrefs.has(p)) continue;
    const html = await read(p);
    if (!html) continue;
    const type = (html.match(/<body[^>]*epub:type\s*=\s*"([^"]+)"/i) || html.match(/<section[^>]*epub:type\s*=\s*"([^"]+)"/i) || [])[1] || '';
    if (/\b(cover|titlepage|toc|copyright-page|landmarks|loi|lot)\b/.test(type)) continue;
    const doc = htmlToParas(html, css, { firstBreak: true, bodyPt: bodyPointSize(html, css) });
    // a page that only carries the title and the author's name
    const words = doc.map((x) => norm(x.text)).join('');
    if (!words || (words.length < 120 && norm(title + author).includes(words)) || (words.length < 120 && words.startsWith(norm(title)) && norm(title).length > 3)) continue;
    if (doc.length) doc[0].pageBreak = true;
    paras.push(...doc);
  }
  return { paras, title: title || null, author: author || null };
}

/* ---------- OpenDocument (.odt) ---------- */

// content.xml as HTML htmlToParas reads, with each style as a class
async function readOdt(fp) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(fp));
  const content = zip.file('content.xml') && await zip.file('content.xml').async('string');
  if (!content) throw new Error('Not a valid OpenDocument file');
  const stylesXml = zip.file('styles.xml') ? await zip.file('styles.xml').async('string') : '';
  const safe = (n) => 's-' + n.replace(/[^\w-]/g, (c) => '_' + c.charCodeAt(0).toString(16));
  // styles, each with its parent's properties beneath its own
  const raw = {};
  const listKinds = {};
  for (const xml of [stylesXml, content]) {
    for (const sm of xml.matchAll(/<style:style\b([^>]*?)(?:\/>|>([\s\S]*?)<\/style:style>)/g)) {
      const name = attrOf(sm[1], 'style:name');
      const props = (sm[2] || '').match(/<style:(?:text|paragraph)-properties\b[^>]*>/g) || [];
      const all = props.join(' ');
      const out = {};
      const w = attrOf(all, 'fo:font-weight');
      if (w) out.bold = w === 'bold' || parseInt(w, 10) >= 600;
      const s = attrOf(all, 'fo:font-style');
      if (s) out.italic = s === 'italic';
      const size = attrOf(all, 'fo:font-size');
      if (size) out.size = size;
      if (/^page$/.test(attrOf(all, 'fo:break-before'))) out.pageBreak = true;
      raw[name] = { parent: attrOf(sm[1], 'style:parent-style-name'), props: out };
    }
    for (const lm of xml.matchAll(/<text:list-style\b([^>]*)>([\s\S]*?)<\/text:list-style>/g)) {
      listKinds[attrOf(lm[1], 'style:name')] = /<text:list-level-style-number\b[^>]*text:level="1"/.test(lm[2]) ? 'ol' : 'ul';
    }
  }
  const resolved = (name, depth = 0) => {
    const st = raw[name];
    if (!st || depth > 8) return {};
    return Object.assign({}, st.parent ? resolved(st.parent, depth + 1) : {}, st.props);
  };
  // a paragraph style that names what it is: the title, a quotation
  const roleOf = (name, depth = 0) => {
    if (!name || depth > 8) return '';
    if (/^title$/i.test(name)) return 'title';
    if (/^(quotations?|quote)$/i.test(name.replace(/_20_/g, ' '))) return 'quote';
    return raw[name] ? roleOf(raw[name].parent, depth + 1) : '';
  };
  let css = '';
  for (const name of Object.keys(raw)) {
    const p = resolved(name);
    const decl = [p.bold !== undefined && `font-weight:${p.bold ? 'bold' : 'normal'}`, p.italic !== undefined && `font-style:${p.italic ? 'italic' : 'normal'}`,
      p.size && `font-size:${p.size}`, p.pageBreak && 'page-break-before:always'].filter(Boolean).join(';');
    if (decl) css += `.${safe(name)}{${decl}}\n`;
  }
  const body = (content.match(/<office:text\b[^>]*>([\s\S]*?)<\/office:text>/) || [])[1] || '';
  const html = body
    .replace(/<text:note\b[\s\S]*?<\/text:note>/g, '')
    .replace(/<office:annotation\b[\s\S]*?<\/office:annotation>/g, '')
    .replace(/<text:tracked-changes\b[\s\S]*?<\/text:tracked-changes>/g, '')
    .replace(/<text:(?:sequence-decls|table-of-content)\b[\s\S]*?<\/text:(?:sequence-decls|table-of-content)>/g, '')
    .replace(/<text:h\b([^>]*)>/g, (m, a) => `<h${Math.min(6, +attrOf(a, 'text:outline-level') || 1)} class="${safe(attrOf(a, 'text:style-name'))}">`)
    .replace(/<\/text:h>/g, () => '</h_>')
    .replace(/<text:p\b([^>]*)\/>/g, '<p></p>')
    .replace(/<text:p\b([^>]*)>/g, (m, a) => {
      const name = attrOf(a, 'text:style-name');
      const role = roleOf(name);
      return `<p class="${safe(name)}"${role ? ` data-neo-role="${role}"` : ''}>`;
    })
    .replace(/<\/text:p>/g, '</p>')
    .replace(/<text:span\b([^>]*)>/g, (m, a) => `<span class="${safe(attrOf(a, 'text:style-name'))}">`)
    .replace(/<\/text:span>/g, '</span>')
    .replace(/<text:list(\s[^>]*)?>/g, (m, a) => `<${listKinds[attrOf(a || '', 'text:style-name')] || 'ul'}>`)
    .replace(/<\/text:list>/g, '</list_>')
    .replace(/<text:list-item\b[^>]*>/g, '<li>').replace(/<\/text:list-item>/g, '</li>')
    .replace(/<text:line-break\s*\/>/g, '<br>')
    .replace(/<text:tab\s*\/>/g, ' ')
    .replace(/<text:s\b([^>]*)\/>/g, (m, a) => ' '.repeat(+attrOf(a, 'text:c') || 1))
    .replace(/<\/?(?:text|draw|table|office|svg|style|loext|field):[^>]*>/g, (t) => (/^<\/?table:table-row/.test(t) ? '<br>' : ''));
  // the closing tags that need their opener's name back
  const fixed = [];
  const open = [];
  for (const tok of html.split(/(<\/?[a-z_0-9]+\b[^>]*>)/)) {
    const om = /^<(h[1-6]|ul|ol)\b/.exec(tok);
    if (om) open.push(om[1]);
    if (tok === '</h_>' || tok === '</list_>') { fixed.push(`</${open.pop() || 'p'}>`); continue; }
    fixed.push(tok);
  }
  return { paras: htmlToParas(fixed.join(''), css, { bodyPt: 12 }) };
}

/* ---------- RTF, Word 97–2003, web archives ---------- */

// On a Mac, the system's own converter reads them (as it reads them for
// TextEdit); elsewhere an .rtf is read by the small reader below
function textutilHtml(fp) {
  const { execFileSync } = require('child_process');
  return execFileSync('/usr/bin/textutil', ['-convert', 'html', '-stdout', '-noload', fp], { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
}
async function readViaTextutil(fp) {
  const html = textutilHtml(fp);
  return { paras: htmlToParas(html, '', { bodyPt: bodyPointSize(html, '') }) };
}

// RTF's own words and paragraphs, its bold and italic, for computers
// without textutil
function readRtf(fp) {
  const src = fs.readFileSync(fp, 'latin1');
  const paras = [];
  let runs = [];
  const stack = [];
  let st = { bold: false, italic: false, skip: false, uc: 1 };
  let skipChars = 0;
  const flush = () => { const text = runsToText(runs); runs = []; if (text) paras.push({ text, pageBreak: false }); };
  const put = (s) => { if (st.skip || !s) return; if (skipChars) { const n = Math.min(skipChars, s.length); skipChars -= n; s = s.slice(n); if (!s) return; } runs.push({ text: s, bold: st.bold, italic: st.italic }); };
  const DEST = /^(fonttbl|colortbl|stylesheet|info|pict|header|footer|headerl|headerr|footerl|footerr|footnote|xmlnstbl|listtable|listoverridetable|rsidtbl|generator|themedata|colorschememapping|latentstyles|datastore|fldinst|object|bkmkstart|bkmkend)$/;
  const re = /\\([a-z]+)(-?\d+)? ?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|([^\\{}\r\n]+)|[\r\n]+/gi;
  let m;
  let starDest = false;
  while ((m = re.exec(src))) {
    if (m[5] === '{') { stack.push({ ...st }); starDest = false; continue; }
    if (m[5] === '}') { st = stack.pop() || st; continue; }
    if (m[6] !== undefined) { put(m[6]); continue; }
    if (m[3]) { put(Buffer.from([parseInt(m[3], 16)]).toString('latin1')); continue; }
    if (m[4]) {
      if (m[4] === '*') { st.skip = true; starDest = true; } else if (m[4] === '~') put(' ');
      else if (m[4] === '-') { /* optional hyphen */ } else if (m[4] === '_') put('‑');
      else if (m[4] === '\n' || m[4] === '\r') flush();
      else put(m[4]);
      continue;
    }
    if (!m[1]) continue;
    const word = m[1];
    const arg = m[2] === undefined ? null : +m[2];
    if (DEST.test(word)) { st.skip = true; continue; }
    if (word === 'par' || word === 'line' || word === 'sect') flush();
    else if (word === 'page') { flush(); }
    else if (word === 'b') st.bold = arg !== 0;
    else if (word === 'i') st.italic = arg !== 0;
    else if (word === 'plain') { st.bold = false; st.italic = false; }
    else if (word === 'tab') put(' ');
    else if (word === 'emdash') put('—');
    else if (word === 'endash') put('–');
    else if (word === 'lquote') put('‘');
    else if (word === 'rquote') put('’');
    else if (word === 'ldblquote') put('“');
    else if (word === 'rdblquote') put('”');
    else if (word === 'bullet') put('•');
    else if (word === 'uc') st.uc = arg || 0;
    else if (word === 'u' && arg !== null) { put(String.fromCharCode(arg < 0 ? arg + 65536 : arg)); skipChars = st.uc; }
    if (starDest) starDest = false;
  }
  flush();
  return { paras };
}

/* ---------- PDF ---------- */

// The words of a PDF, set back into paragraphs. A PDF only knows where
// each piece of text sits on its page, so NEO rebuilds the rest: lines from
// pieces at the same height, paragraphs where the gap between lines opens
// up, a line starts indented, or a short line ends a sentence; headings
// where the type is set larger than the body; bold and italic from the
// font's name. Page numbers and running heads (the same words at the top
// or foot of page after page) are left out, and a word hyphenated at the
// end of a line is joined again.
async function readPdf(fp) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(fp));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  const info = await doc.getMetadata().catch(() => null);
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    // the fonts' names (and so bold and italic) arrive with the drawing
    // operations, not with the text
    await page.getOperatorList();
    const tc = await page.getTextContent();
    const fontStyle = {};
    const styleOf = (name) => {
      if (fontStyle[name]) return fontStyle[name];
      let f = null;
      try { f = page.commonObjs.get(name); } catch { /* not loaded */ }
      const fname = String((f && (f.name || f.loadedName)) || (tc.styles[name] && tc.styles[name].fontFamily) || '');
      fontStyle[name] = {
        bold: !!(f && f.bold) || /bold|black|heavy|semibold|demi/i.test(fname),
        italic: !!(f && f.italic) || /italic|oblique|slanted/i.test(fname)
      };
      return fontStyle[name];
    };
    const items = tc.items.filter((it) => typeof it.str === 'string').map((it) => ({
      str: it.str.replace(/[ﬀ-ﬆ]/g, (c) => c.normalize('NFKC')),
      x: it.transform[4], y: it.transform[5],
      w: it.width, size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 10,
      eol: it.hasEOL, ...styleOf(it.fontName)
    })).filter((it) => it.str.trim() || it.str === ' ');
    // A drop cap is its own piece, a letter set two or three lines deep:
    // it goes back onto the front of its word, and the lines beside it are
    // not indented paragraphs
    const sizeTally = {};
    for (const it of items) sizeTally[Math.round(it.size)] = (sizeTally[Math.round(it.size)] || 0) + it.str.length;
    const pageBody = +((Object.entries(sizeTally).sort((a, b) => b[1] - a[1])[0] || [12])[0]);
    for (const cap of items.filter((it) => /^\p{L}{1,2}$/u.test(it.str.trim()) && it.size >= pageBody * 1.8)) {
      const beside = items.filter((it) => it !== cap && it.x > cap.x && it.x - (cap.x + cap.w) < cap.size &&
        it.y >= cap.y - 2 && it.y <= cap.y + cap.size * 1.1 && it.size < cap.size / 1.5);
      if (!beside.length) continue;
      const top = Math.max(...beside.map((it) => it.y));
      const first = beside.filter((it) => Math.abs(it.y - top) < 2).sort((a, b) => a.x - b.x)[0];
      const textX = first.x; // where the words beside the letter start
      first.str = cap.str.trim() + first.str.replace(/^\s+/, '');
      first.w += first.x - cap.x;
      first.x = cap.x;
      for (const it of beside) if (it.y < top - 2) it.besideCap = textX;
      items.splice(items.indexOf(cap), 1);
    }
    // lines: pieces at (about) the same height, left to right
    const lines = [];
    for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
      const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(2, it.size * 0.35));
      if (line) line.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      l.x0 = l.items[0].x;
      const last = l.items[l.items.length - 1];
      l.x1 = last.x + last.w;
      l.size = Math.max(...l.items.filter((i) => i.str.trim()).map((i) => i.size), 0) || l.items[0].size;
      // the runs, with a space where the gap between pieces is a space. A
      // line set letter by letter (small capitals spaced out for a heading)
      // has a gap after every letter: there only the wider gaps are spaces
      const solid = l.items.filter((it) => it.str.trim());
      const letterByLetter = solid.length > 4 && solid.filter((it) => it.str.trim().length === 1).length >= solid.length * 0.6;
      // (the spaces the PDF itself puts between such letters say nothing)
      if (letterByLetter) l.items = solid;
      const gaps = l.items.slice(1).map((it, i) => it.x - (l.items[i].x + l.items[i].w)).filter((g) => g >= 0).sort((a, b) => a - b);
      const spaceAt = letterByLetter && gaps.length ? Math.max(l.items[0].size * 0.18, gaps[Math.floor(gaps.length / 2)] * 1.8) : l.items[0].size * 0.18;
      l.runs = [];
      let prevEnd = null;
      for (const it of l.items) {
        if (prevEnd !== null && it.x - prevEnd > spaceAt && !/\s$/.test(l.runs[l.runs.length - 1].text) && !/^\s/.test(it.str)) {
          l.runs.push({ text: ' ', bold: it.bold, italic: it.italic });
        }
        l.runs.push({ text: it.str, bold: it.bold, italic: it.italic });
        prevEnd = it.x + it.w;
      }
      // letters spaced out for show ("C H A P T E R") close up again
      for (const r of l.runs) if (/^(\p{L} )+\p{L}$/u.test(r.text.trim())) r.text = r.text.replace(/(\p{L}) (?=\p{L})/gu, '$1');
      l.besideCap = (l.items.find((i) => i.besideCap) || {}).besideCap || 0;
      l.text = l.runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
      // and its small capitals were capitals only to look at
      // (one run: letter by letter, each letter came as its own piece)
      if (letterByLetter && l.text === l.text.toUpperCase() && /\p{Lu}{2}/u.test(l.text)) {
        l.text = l.text.toLowerCase().replace(/(^|[\s'’(—–-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
        l.runs = [{ text: l.text, bold: l.runs[0].bold, italic: l.runs[0].italic }];
      }
    }
    pages.push(lines.filter((l) => l.text).sort((a, b) => b.y - a.y));
  }
  if (!pages.some((p) => p.length)) throw new Error('This PDF has no text in it (it may be scanned pages). NEO can only import a PDF whose words can be selected');

  // running heads and page numbers: the first and last lines of a page that
  // are only a number, or repeat (numbers aside) on several pages
  const key = (l) => l.text.replace(/\d+/g, '#').toLowerCase();
  const edgeCount = {};
  for (const lines of pages) {
    for (const l of [lines[0], lines[lines.length - 1]]) if (l) edgeCount[key(l)] = (edgeCount[key(l)] || 0) + 1;
  }
  // (a label over a chapter's title, "CHAPTER 3", repeats too: it stays)
  const sizes = {};
  for (const lines of pages) for (const l of lines) sizes[Math.round(l.size)] = (sizes[Math.round(l.size)] || 0) + l.text.length;
  const bodyGuess = +Object.entries(sizes).sort((a, b) => b[1] - a[1])[0][0];
  // (just above it, that is: a running head sits well up, at the top margin)
  const overTitle = (l, lines) => { const next = lines[lines.indexOf(l) + 1]; return !!next && next.size >= bodyGuess * 1.25 && l.y - next.y < l.size * 4; };
  // (and the title, set large, is never one, though a running head repeat it)
  const isFurniture = (l, lines) => (l === lines[0] || l === lines[lines.length - 1] || l === lines[1] || l === lines[lines.length - 2]) &&
    l.size <= bodyGuess * 1.1 &&
    (/^[\divxlc\s.\-–—|]+$/i.test(l.text) || (edgeCount[key(l)] >= Math.max(3, pages.length * 0.3) && l.text.length < 90 && !overTitle(l, lines)));
  for (let i = 0; i < pages.length; i++) pages[i] = pages[i].filter((l) => !isFurniture(l, pages[i]));

  // the body's size and left edge: those of the most text
  const tally = (f) => {
    const w = {};
    for (const lines of pages) for (const l of lines) { const k = f(l); w[k] = (w[k] || 0) + l.text.length; }
    return +Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
  };
  const body = tally((l) => Math.round(l.size * 2) / 2);
  const left = tally((l) => Math.round(l.x0));
  const right = tally((l) => Math.round(l.x1));
  // the usual step from one line to the next
  const steps = {};
  for (const lines of pages) {
    for (let i = 1; i < lines.length; i++) {
      const s = Math.round((lines[i - 1].y - lines[i].y) * 2) / 2;
      if (s > 0 && Math.abs(lines[i].size - body) < 1) steps[s] = (steps[s] || 0) + 1;
    }
  }
  const step = +((Object.entries(steps).sort((a, b) => b[1] - a[1])[0] || [body * 1.2])[0]);
  // heading sizes, largest first: level 1, 2, 3
  const headSizes = [...new Set(pages.flat().filter((l) => l.size >= body * 1.25 && l.text.length < 120).map((l) => Math.round(l.size)))].sort((a, b) => b - a);
  const levelOf = (l) => Math.min(3, headSizes.indexOf(Math.round(l.size)) + 1);

  const paras = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const text = runsToText(cur.runs);
    if (text) paras.push({ text, pageBreak: false, heading: cur.heading, level: cur.level, fmt: cur.fmt });
    cur = null;
  };
  const addLine = (l) => {
    if (cur && cur.runs.length) {
      const prev = cur.runs[cur.runs.length - 1];
      // a word broken at the line's end comes back together
      if (/[\p{L}]-$/u.test(prev.text) && /^\p{Ll}/u.test(l.runs[0].text.trimStart())) prev.text = prev.text.slice(0, -1);
      else cur.runs.push({ text: ' ', bold: false, italic: false });
    }
    cur.runs.push(...l.runs);
  };
  const width = right - left;
  for (let pi = 0; pi < pages.length; pi++) {
    const lines = pages[pi];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const prev = i > 0 ? lines[i - 1] : null;
      const head = l.size >= body * 1.25 && l.text.length < 120;
      if (head) {
        // a heading's lines run together, until the type changes
        if (cur && cur.heading && prev && Math.round(prev.size) === Math.round(l.size) && prev.y - l.y < l.size * 1.8) { addLine(l); continue; }
        flush();
        cur = { runs: [], heading: true, level: levelOf(l) };
        addLine(l);
        continue;
      }
      const bullet = /^([•●▪◦‣∙·–-]|\d{1,3}[.)])\s+\S/.exec(l.text);
      // (beside a drop cap, the indent counts from where the words beside it start)
      const from = l.besideCap || left;
      const indented = l.x0 - from > body * 0.8 && l.x0 - from < width * 0.3;
      const gap = prev ? prev.y - l.y : Infinity;
      const prevShort = prev && prev.x1 < left + width * 0.82 && /[.!?:”’"'»)…]$/.test(prev.text);
      const isCentered = (x) => !!x && Math.abs((x.x0 + x.x1) / 2 - (left + right) / 2) < body && x.x0 - left > width * 0.15;
      const centered = isCentered(l) || isCentered(prev);
      const isBreak = /^\s*([*#•~⁂—–-]\s*){1,7}$/.test(l.text);
      const newPara = !cur || cur.heading || isBreak || bullet ||
        indented || centered ||
        (pi > 0 && i === 0 ? (paras.length && prevShortOf(pages[pi - 1])) : (gap > step * 1.45 || prevShort));
      if (newPara) {
        flush();
        if (isBreak) { paras.push({ text: '***', pageBreak: false }); cur = null; continue; }
        cur = { runs: [], heading: false };
        if (bullet) {
          cur.fmt = /\d/.test(bullet[1]) ? 'ol' : 'ul';
          l.runs = stripLead(l.runs, bullet[0].length - bullet[0].replace(/^\S+\s+/, '').length);
        }
      }
      addLine(l);
    }
  }
  flush();
  // a page's last line ends its paragraph when it stops short: after a
  // sentence, well before the margin, or set in the middle
  function prevShortOf(lines) {
    const p = lines[lines.length - 1];
    if (!p) return true;
    const mid = Math.abs((p.x0 + p.x1) / 2 - (left + right) / 2) < body && p.x0 - left > width * 0.15;
    return mid || p.x1 < left + width * 0.6 || (p.x1 < left + width * 0.82 && /[.!?:”’"'»)…]$/.test(p.text));
  }
  const meta = info && info.info ? info.info : {};
  return { paras, title: (meta.Title || '').trim() || null, author: (meta.Author || '').trim() || null };
}
// runs without their first n characters (a list's bullet or number)
function stripLead(runs, n) {
  const out = [];
  for (const r of runs) {
    if (n <= 0) { out.push(r); continue; }
    const t = r.text.trimStart();
    const lead = r.text.length - t.length;
    if (lead + t.length <= n) { n -= r.text.length; continue; }
    out.push({ ...r, text: r.text.slice(Math.max(0, n)) });
    n = 0;
  }
  return out;
}

/* ---------- links: Google Docs, Google Drive, any web page ---------- */

// Where to fetch a link's document from. A Google Doc comes as the Word file
// Google makes of it; a file on Google Drive as itself.
function linkSource(url) {
  const u = String(url || '').trim();
  let m = u.match(/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([\w-]{10,})/);
  if (m) return { url: `https://docs.google.com/document/d/${m[1]}/export?format=docx`, ext: '.docx', google: 'doc' };
  m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]{10,})/);
  if (m) return { url: `https://drive.google.com/uc?export=download&id=${m[1]}`, google: 'drive' };
  if (!/^https?:\/\//i.test(u)) return null;
  return { url: u };
}
const TYPE_EXT = {
  'application/pdf': '.pdf', 'application/epub+zip': '.epub', 'text/plain': '.txt', 'text/markdown': '.md',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.oasis.opendocument.text': '.odt', 'application/rtf': '.rtf', 'text/rtf': '.rtf', 'application/msword': '.doc'
};
// The link's document saved to a temporary file, for importFile to read.
// Returns { file, name } — or { html, name } for a web page.
async function fetchLink(url) {
  const src = linkSource(url);
  if (!src) throw new Error('That isn’t a web address (it should start with https://)');
  let res;
  try {
    res = await fetch(src.url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 NEO' } });
  } catch (err) {
    throw new Error('Couldn’t reach that address (' + ((err.cause && err.cause.code) || err.message) + ')');
  }
  const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (src.google && (!res.ok || type === 'text/html')) {
    throw new Error('Google wouldn’t hand over that document. Share it as “Anyone with the link”, or in Google Docs choose File → Download → Microsoft Word (.docx) and import that file');
  }
  if (!res.ok) throw new Error('The address answered ' + res.status);
  const disp = res.headers.get('content-disposition') || '';
  const fname = decodeURIComponent((disp.match(/filename\*=UTF-8''([^;]+)/i) || [])[1] || (disp.match(/filename="?([^";]+)"?/i) || [])[1] || '');
  const buf = Buffer.from(await res.arrayBuffer());
  let ext = src.ext || (fname && path.extname(fname).toLowerCase()) || TYPE_EXT[type] || path.extname(new URL(src.url).pathname).toLowerCase();
  const name = (fname && fname.replace(/\.[^.]+$/, '')) || decodeURIComponent(path.basename(new URL(url).pathname).replace(/\.[^.]+$/, '')) || 'Imported';
  if (type === 'text/html' || type === 'application/xhtml+xml' || (!ext && /^\s*</.test(buf.subarray(0, 200).toString()))) {
    return { html: buf.toString('utf8'), name };
  }
  if (!ext) ext = '.txt';
  const file = path.join(os.tmpdir(), `neo-import-${process.pid}-${Date.now()}${ext}`);
  fs.writeFileSync(file, buf);
  return { file, name };
}
// a Google Drive shortcut file (.gdoc, from Drive for desktop): its link
function gdocLink(fp) {
  try {
    const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (j.url) return j.url;
    if (j.doc_id) return `https://docs.google.com/document/d/${j.doc_id}/edit`;
  } catch { /* not the JSON it should be */ }
  throw new Error('This Google Docs shortcut has no link in it. In Google Docs choose File → Download → Microsoft Word (.docx) and import that file');
}

// what importFile reads here, by file extension
const READERS = {
  '.html': async (fp) => readHtml(fp), '.htm': async (fp) => readHtml(fp), '.xhtml': async (fp) => readHtml(fp),
  '.epub': readEpub,
  '.odt': readOdt,
  '.pdf': readPdf,
  '.rtf': async (fp) => (process.platform === 'darwin' ? readViaTextutil(fp) : readRtf(fp)),
  '.doc': async (fp) => {
    if (process.platform !== 'darwin') throw new Error('Open it in Word and save it as .docx, then import that');
    return readViaTextutil(fp);
  },
  '.webarchive': async (fp) => {
    if (process.platform !== 'darwin') throw new Error('Save the page as HTML and import that');
    return readViaTextutil(fp);
  }
};
// every file NEO can import (scripts: .fountain, .fdx; a Google Docs shortcut: .gdoc)
const IMPORT_EXTENSIONS = ['docx', 'txt', 'md', 'markdown', 'text', 'html', 'htm', 'xhtml', 'epub', 'odt', 'pdf', 'rtf', 'doc', 'webarchive', 'gdoc'];

module.exports = { decodeEntities, escapeMarks, htmlToParas, htmlDocument, readPdf, readRtf, linkSource, fetchLink, gdocLink, READERS, IMPORT_EXTENSIONS, cssClasses };
