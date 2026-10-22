<div align="center">

<img src="assets/logo/logo.png" alt="NEO Enhanced logo: a nautilus shell spiral" width="140">

# NEO Enhanced

**A distraction-free word processor for writing books.**

My own version of [NEO](https://github.com/hughhowey/neo), the writing app by Hugh Howey, with a few extra features.

[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-black.svg)
![Electron](https://img.shields.io/badge/electron-43-black.svg)
[![Based on NEO](https://img.shields.io/badge/based%20on-hughhowey%2Fneo-black.svg)](https://github.com/hughhowey/neo)

[Install](#install) · [What's different](#whats-different-here) · [Features](#features) · [Discord status](#discord-status) · [Building](#building-from-source)

<img src="Claude%20outputs/shelf.png" alt="The NEO bookshelf, with shelves of short stories and novels, each with its own cover" width="820">

</div>

NEO knows from the moment you open it that you're writing *books* and nothing else. There's no bloat and nothing to set up, and your manuscript looks like a book while you write it. Everything stays on your computer as plain files: no accounts, no subscriptions, and it's free.

All the credit for NEO goes to Hugh Howey. Most of this README is his, with a few bits changed to fit this version.

## Contents

- [What's different here](#whats-different-here)
- [Install](#install)
- [Features](#features)
- [Discord status](#discord-status)
- [Your files](#your-files)
- [Languages](#languages)
- [Building from source](#building-from-source)
- [Contributing](#contributing)
- [License](#license)
- [Philosophy](#philosophy)

## What's different here

- **Paragraph styles.** Headings, subheadings, block quotes, and bulleted or numbered lists, on top of the bold, italic, underline and strikethrough NEO has. They're all in the Format menu with shortcuts, along with Clear Formatting, and Markdown works as you type (`# `, `## `, `> `, `- ` or `1. ` at the start of a line). More on that under Formatting below.
- **Paste keeps formatting.** Paste from Google Docs, Word or a web page and headings, lists, quotes and section breaks come along, not just bold and italic. Paste Markdown (from a notes app, a code editor, or a chatbot) and it gets turned into the same formatting instead of showing the asterisks and hashes.
- **Copying a chapter copies its heading.** Select from the top of a chapter (or just press Cmd+A in it) and copy, and "Chapter 3 — Title" comes along above the text. Edit → Copy Chapter Headings turns this off.
- **Markdown stays on in simple NEO.** The original hides Markdown typing until you turn on File → Show More Features. Here it's on either way; Format → Markdown Emphasis turns it off.
- **A white page, with the interface following your Mac.** View → Page → Automatic (the default) keeps the page white and sets everything around it dark in dark mode and light in light mode, switching when your Mac does. Night, Paper and Light are still there.
- **Turn off what you don't use.** View → Customize NEO… lists every tab, panel and feature: the Notes, Outline and Darlings tabs, the chapters and notes panels, the counters, goals, zoom control, headings and lists, Markdown, flush and poetry paragraphs, placeholders, footnotes, spellcheck, read aloud, snapshots, email drafts, screenplays, painted covers, bound shelves and the Discord status. Untick one and its tab, panel, menu items and keys go away; tick it and it's back. Right-click a tab to hide just that tab. Nothing in your books is touched.
- **Import from almost anything.** Besides .docx, .txt and .md: PDF, EPUB, OpenDocument (.odt), web pages (.html), RTF and old Word .doc files, and links: File → Import from a Link… takes a Google Doc (shared as "Anyone with the link"), a file on Google Drive or any web page. A Google Docs shortcut (.gdoc) from Drive for desktop works too. NEO finds the chapters and their titles, the book's title and author, and keeps bold, italic, headings inside chapters, lists and quotes. From a PDF it rebuilds the paragraphs and leaves out page numbers and running heads (a scanned PDF has no text to import).
- **Discord status.** While Discord is open, your profile shows NEO Enhanced, the book you're writing, the chapter you're in, how long you've been at it and how many words you've written since you opened the book. Customize NEO → Discord status turns it off. See [Discord status](#discord-status) for details.
- **No automatic updates.** This version never checks for new releases or installs them, so an official NEO update can't replace it. The Check for Update menu item is gone too.

Save cover as image, underline and strikethrough, and the zoom and shelf fixes (sent upstream as [hughhowey/neo#132](https://github.com/hughhowey/neo/pull/132) and [#130](https://github.com/hughhowey/neo/pull/130)) used to be on this list. The original NEO has all of them now, so this version uses its versions.

It uses the same `~/Documents/NEO Library` folder as the original NEO, so your books show up in both. Just don't run the two at once.

## Install

There are no ready-made installers for this version yet, so you build it yourself. It takes a few commands and needs [Node.js](https://nodejs.org).

**macOS (Apple silicon)**

```sh
git clone https://github.com/justsomerandomshit/NEO_Enhanced.git
cd NEO_Enhanced
npm install
npx electron-builder --mac dir --arm64 -c.mac.notarize=false -c.mac.identity=null
codesign --force --deep --sign - dist/mac-arm64/NEO.app
```

Then drag `dist/mac-arm64/NEO.app` into Applications. On an Intel Mac, swap `--arm64` for `--x64` and `mac-arm64` for `mac`.

**Windows and Linux**

```sh
npm install
npm run package:win     # or: npm run package:linux
```

The installer lands in `dist/`.

Want the official NEO with signed installers for every platform? Get it from the [original Releases page](https://github.com/hughhowey/neo/releases).

## Features

### The bookshelf

Your library looks like a bookshelf, not a file list. Labeled shelves you organize however you like — by series, by status, by pen name. Progress bars on the covers show how far you are from your word goals. You can drag-and-drop books anywhere. You can also drag shelves around and put cover art on your titles.

### Just a blank page

There's a white page by default or a dark mode (which I now prefer!). Controls fade until you mouse over them. Chapters number and renumber themselves automatically. Drop caps mark chapter openings, because I'm a sucker for drop-caps. Em dashes, true ellipses, and curly quotes sort themselves out as you type. Spellcheck exists only when you invoke it — no more red squiggles mid-sentence triggering your imposter syndrome.

### Enter, Enter, Enter

One Enter: new paragraph. Two: a `***` section break. Three: a new chapter. The goal is to KEEP WRITING.

Right-click the first chapter's heading to make it a prologue, or the last one's to make it an epilogue: they step out of the numbering, and everything renumbers.

### Formatting

Bold, italic, underline and strikethrough, plus headings, block quotes, and bulleted or numbered lists — all under **Format**, all with keyboard shortcuts. Markdown habits work as you type: `*italic*`, `**bold**`, `~~struck~~`, and at the start of a line `# `, `## `, `> `, `- ` or `1. `. Everything carries through to every export.

### Darlings

The writing advice is "kill your darlings" — but I say: *keep the bodies*. Drag any beautiful-but-in-the-way passage onto the Darlings tab. It leaves your manuscript but isn't lost. Darlings restore to the exact spot it came from. More like zombies than darlings.

### Placeholders

Mid-flow and need a name, a fact, a date? ⌘⇧X drops a mark and a sticky note. The left panel shows a red dot on every chapter that you need to get back to. The right panel will list all these to-do items.

### Outlining with index cards

The Outline tab lays your book out as index cards, set like a page: they read left to right, line after line, so forty short chapters or a story of thirty scenes both fill the window. Each chapter starts at its big numeral, with its sections following on the same mat. Click a card and write a few lines on it. A section's note shows up in the manuscript as a gray ghost paragraph, and once you start writing, it rides one line below your words until you dismiss it. Drag a card to move it and the writing moves with it (⌘Z puts it back). Pantsers get cards too: every chapter and every *** section is already a card, showing its first line until you give it a note. Ideas without a home wait on loose cards in the right-hand panel. ⌘− shrinks the cards until a whole novel fits on one screen, and the old list is one click away. Pantsers can ignore all of it or learn to draw a freakin' map for the first time. Try it. You might like it!

### Cover Art

Every book gets a cover! New books are dressed in a seeded abstract (six art styles, six type templates, typefaces bundled with NEO) so no two stories on the shelf look alike. Once a story passes 1,000 words, NEO can read it and paint an abstract cover from the text. This is a bit more work but totally worth it. Get an OpenAI API key from their website and paste it into **File → Cover Art…**. The art is generated in the background for about a penny a picture. (These are not meant for publication, just writing inspiration!) The API key is stored encrypted in NEO's own settings, never in your library folder. The title and author are always set in real type on top, so the lettering is never left to a gen-AI model. The ↻ on any book re-rolls its type and colors, or paints it again. And you can always switch back and forth from the seeded modern look to the painted variety.

### Goals and momentum

Daily word goals, word sprints, and a NaNoWriMo-style progress chart. Needs more testing, but I think it works okay!

### A shelf can become one book

Right-click a shelf's name and choose **Bind into one book** for an omnibus, a trilogy, or a story collection. Hover over the bound shelf and the pages a published book carries show up faintly in their places: copyright, dedication, epigraph, prologue, epilogue, acknowledgments, about the author. A small + before each title starts a Part. Click a page and type it the way it will print; a prologue or epilogue opens in the editor like any story. The export is one EPUB, Word file, or PDF with a single cover and one table of contents, and chapters can number straight through the whole book. Unbind any time. Nothing is lost.

### Screenplays, too!

A lot of you have asked for this feature, so here it is! Right-click the + on any shelf and choose **New Script**. Scripts sit on the same shelves as your books, on white card stock with two brass brads. Inside, the page is set the way it will print: Courier Prime, pages, page numbers, a proper title page.

You never have to pick a formatting element. Start a line with INT. or EXT. and it's a scene heading. Type a name in capitals, hit Enter, and the next line is dialogue. Hit Enter twice after a speech and you're on the next speaker, with whoever is being answered already there in gray. Tab or Enter fills it in. ⌘1 through ⌘7 will let you pick an element yourself, the same keys Final Draft uses. The left panel lists your scenes and how long each one runs, in eighths of a page. Drag a scene to move it. (CONT'D) happens automatically. The Outline tab lays every scene out as an index card: its heading, its length, who's in it, and a note you can write on it. Drag the cards to restructure the script, or start a script as a stack of cards and write it from there.

Export an industry-format PDF, or a Fountain or Final Draft (.fdx) file. Drop a .fountain or .fdx file on a shelf to import a script. Notes, Darlings, placeholders, sprints, and NEO Pocket all work the same as they do for books.

### Exports

EPUB 3 with a proper table of contents built to KDP's guidelines, Word .docx, PDF with page numbers and bookmarks, HTML, markdown, and plain text. Email a timestamped PDF snapshot to yourself with a SHA-256 fingerprint of the text in the body. Might come in handy someday.

### Import

Bring in existing manuscripts: .docx, .txt, .md, PDF, EPUB, .odt, .html, .rtf and .doc, or a link to a Google Doc or a web page (File → Import from a Link…). Chapters and scene breaks are detected automatically, along with headings, lists and quotes. This is still a bit rough and might require you to tweak things. It will try to grab your title and remove that from the body, and it seems to be working okay.

### Backups

Continuous autosave, daily zip backups kept for two weeks, everything stored as plain files. Set up your NEO library folder on your iCloud if you want for extra safety. You can also email copies of your WIP to yourself with a keystroke: ⌘E.

## Discord status

NEO Enhanced can show what you're working on in your Discord profile, the way games and music players do:

> **NEO Enhanced**\
> Writing The Long Way Home\
> Chapter 3 — The Storm · 1,204 words this session\
> 00:42 elapsed

The time counts from when you opened the book, and the words are only the ones you typed since then (text synced in from another device doesn't count). On the Outline, Notes or Darlings tab it says so instead of the chapter, and on the bookshelf it just says you're on the bookshelf.

It talks to the Discord app on your computer directly, so there's no account to link and nothing is sent anywhere else. If Discord isn't running, nothing happens. To hide it, untick **Discord status** in **View → Customize NEO…**.

It works out of the box. If you'd rather it show under your own Discord application, create one in the [Discord Developer Portal](https://discord.com/developers/applications) and put its Application ID in `DISCORD_CLIENT_ID` in `main.js`, or add `"discordClientId": "<your ID>"` to NEO's `settings.json` (`~/Library/Application Support/NEO/settings.json` on a Mac) and restart NEO.

## Your files

Everything lives in `~/Documents/NEO Library` — one folder per book, chapters as readable HTML, metadata as JSON. Open them in your favorite text editor.

## Languages

NEO speaks English, French, Spanish, Portuguese, German, Italian, Dutch, Polish, Romanian and Russian. Pick one under **View → Language**; on first launch NEO follows your system language when it has it. Adding a language is a single file, no programming needed: see [TRANSLATING.md](TRANSLATING.md).

## Building from source

You need [Node.js](https://nodejs.org).

```sh
git clone https://github.com/justsomerandomshit/NEO_Enhanced.git
cd NEO_Enhanced
npm install
npm start
```

| Command | What it does |
|---|---|
| `npm start` | Runs NEO from the source folder |
| `npm test` | Runs the unit tests |
| `npm run lint` | Checks the code with oxlint |
| `npm run package:mac` | Builds the macOS app (also `package:win`, `package:linux`, `package:all`) |

The app is deliberately simple: an Electron shell (`main.js`), a preload bridge (`preload.js`), and a renderer (`app.js`, `styles.css`, `index.html`). There's no framework and no build step, so if you know JavaScript, you can change NEO. [AGENTS.md](AGENTS.md) maps out where everything lives.

**View → Keyboard Shortcuts…** opens the shortcut reference. You can also press `Cmd+/` on macOS or `Ctrl+/` on Windows and Linux.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Fair warning, in Hugh's words: NEO is opinionated by design, and bloat killed every writing app I've ever tried. If you want complex, try Scrivener. It really is a great application beloved by many!

## License

[MIT](LICENSE). Free to use, free to modify, free to share. The logo is in [`assets/logo`](assets/logo) under the same license.

## Philosophy

If you didn't know, I opened up the Silo universe to fan fiction years ago. And not just to put on fan fiction sites, but you can charge money for the things you write and keep every penny of the income! Lots of incredible Silo Stories out there. But readers are forever looking for more.
