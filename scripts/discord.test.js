// Discord Rich Presence (discord.js): the frames, the activity, and a talk
// with a pretend Discord listening where the real one would.
// Run with `node --test scripts/discord.test.js`.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { createPresence, buildActivity, socketPaths, encode } = require('../discord.js');

// a frame off the wire: [op, payload]
function frames(buf) {
  const out = [];
  while (buf.length >= 8) {
    const len = buf.readInt32LE(4);
    out.push([buf.readInt32LE(0), JSON.parse(buf.subarray(8, 8 + len).toString('utf8'))]);
    buf = buf.subarray(8 + len);
  }
  return out;
}

describe('Discord frames and activity', () => {
  it('a frame is the op and the length, little-endian, then the JSON', () => {
    const f = encode(1, { cmd: 'SET_ACTIVITY' });
    assert.equal(f.readInt32LE(0), 1);
    assert.equal(f.readInt32LE(4), f.length - 8);
    assert.deepEqual(frames(f), [[1, { cmd: 'SET_ACTIVITY' }]]);
  });

  it('the activity carries the lines, the start time and the image', () => {
    const a = buildActivity({ details: 'Writing Wool', state: 'Chapter 3 · 412 words this session', since: 1700000000000 }, { largeImage: 'https://example.com/i.png' });
    assert.equal(a.details, 'Writing Wool');
    assert.equal(a.state, 'Chapter 3 · 412 words this session');
    assert.deepEqual(a.timestamps, { start: 1700000000000 });
    assert.deepEqual(a.assets, { large_image: 'https://example.com/i.png', large_text: 'NEO Enhanced' });
  });

  it('lines are cut to 128 characters, and an empty one is left out', () => {
    const a = buildActivity({ details: 'x'.repeat(300), state: '   ' });
    assert.equal(a.details.length, 128);
    assert.ok(a.details.endsWith('…'));
    assert.equal('state' in a, false);
    assert.equal(buildActivity(null), null);
  });

  it('looks in the runtime folder, then where Flatpak and Snap keep theirs', () => {
    if (process.platform === 'win32') return;
    const was = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = '/run/user/1000';
    try {
      const p = socketPaths();
      assert.equal(p[0], '/run/user/1000/discord-ipc-0');
      assert.ok(p.includes('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0'));
      assert.ok(p.includes('/run/user/1000/snap.discord/discord-ipc-0'));
    } finally {
      if (was === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR = was;
    }
  });
});

describe('Talking to Discord', { skip: process.platform === 'win32' }, () => {
  it('shakes hands, sets the activity, sends only the newest, and clears it on quit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-discord-'));
    const was = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = dir;
    const got = [];
    let ended;
    const done = new Promise((r) => { ended = r; });
    const server = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (const [op, msg] of frames(buf)) {
          got.push([op, msg]);
          if (op === 0) sock.write(encode(1, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } }));
        }
        buf = Buffer.alloc(0);
      });
      sock.on('end', ended);
    });
    await new Promise((r) => server.listen(path.join(dir, 'discord-ipc-0'), r));
    try {
      const p = createPresence({ clientId: '123456789012345678' });
      p.set(buildActivity({ details: 'Writing Wool', state: '1 word this session', since: 1 }));
      while (got.length < 2) await new Promise((r) => setTimeout(r, 20));
      assert.deepEqual(got[0], [0, { v: 1, client_id: '123456789012345678' }]);
      assert.equal(got[1][1].cmd, 'SET_ACTIVITY');
      assert.equal(got[1][1].args.pid, process.pid);
      assert.equal(got[1][1].args.activity.details, 'Writing Wool');
      // typing on: Discord's limit holds the rest back
      p.set(buildActivity({ details: 'Writing Wool', state: '2 words this session', since: 1 }));
      p.set(buildActivity({ details: 'Writing Wool', state: '3 words this session', since: 1 }));
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(got.length, 2);
      p.stop();
      await done;
      assert.equal(got.length, 3);
      assert.equal(got[2][1].cmd, 'SET_ACTIVITY');
      assert.equal('activity' in got[2][1].args, false, 'quitting clears the status');
    } finally {
      server.close();
      if (was === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR = was;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('with no Discord running, nothing breaks', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-discord-'));
    const keep = { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, TMPDIR: process.env.TMPDIR };
    process.env.XDG_RUNTIME_DIR = dir;
    try {
      const p = createPresence({ clientId: '123456789012345678' });
      p.set({ details: 'Writing Wool' });
      await new Promise((r) => setTimeout(r, 100));
      p.set(null);
      p.stop();
    } finally {
      for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
