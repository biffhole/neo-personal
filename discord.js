// Discord Rich Presence: what NEO is doing, on the writer's Discord profile.
// Main process. It talks to the Discord app on this computer over its local
// socket (discord-ipc-N), the same way Discord's own SDK does, so it needs no
// package, no account and no network of its own. When Discord isn't running
// nothing happens; NEO looks again now and then, quietly.
//
// The window sends the activity it wants shown (`discord:activity` in
// main.js); null clears it. Discord takes about five updates in twenty
// seconds, so a word count that changes with every key is sent at most every
// fifteen seconds, always the newest.

const net = require('net');
const os = require('os');
const path = require('path');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

const SEND_EVERY = 15000; // ms between updates Discord is sent
const RETRY_EVERY = 30000; // ms between looks for a Discord that wasn't there

// the sockets the Discord app may be listening on: a named pipe on Windows,
// a file in the runtime or temp folder elsewhere (Flatpak and Snap keep
// theirs one level in)
function socketPaths() {
  if (process.platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const env = process.env;
  const base = (env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || os.tmpdir() || '/tmp').replace(/\/$/, '');
  const dirs = [base, path.join(base, 'app', 'com.discordapp.Discord'), path.join(base, 'snap.discord'), path.join(base, '.flatpak', 'com.discordapp.Discord', 'xdg-run')];
  if (base !== '/tmp') dirs.push('/tmp');
  return dirs.flatMap((d) => Array.from({ length: 10 }, (_, i) => path.join(d, `discord-ipc-${i}`)));
}

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

// the first socket that answers, or null
function connectAny(paths) {
  return new Promise((resolve) => {
    const next = (i) => {
      if (i >= paths.length) return resolve(null);
      const sock = net.createConnection(paths[i]);
      const fail = () => { sock.destroy(); next(i + 1); };
      sock.once('error', fail);
      sock.once('connect', () => { sock.removeListener('error', fail); resolve(sock); });
    };
    next(0);
  });
}

function createPresence({ clientId, log = () => {} }) {
  let sock = null;
  let ready = false;
  let connecting = false;
  let lastTry = 0;
  let wanted = null; // the activity the window last asked for (null: none)
  let sentSig = 'null'; // what Discord was last sent
  let lastSend = 0;
  let sendTimer = null;
  let retryTimer = null;
  let nonce = 0;
  let stopped = false;
  let badClient = false; // Discord turned the client id down: stop asking

  function drop() {
    ready = false;
    if (sock) { sock.removeAllListeners(); sock.on('error', () => {}); sock.destroy(); }
    sock = null;
    sentSig = 'null';
  }

  function scheduleRetry() {
    if (stopped || badClient || retryTimer || !wanted) return;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, RETRY_EVERY);
    if (retryTimer.unref) retryTimer.unref();
  }

  async function connect() {
    if (stopped || badClient || ready || connecting || !clientId) return;
    if (Date.now() - lastTry < 5000) return scheduleRetry();
    connecting = true;
    lastTry = Date.now();
    const s = await connectAny(socketPaths());
    connecting = false;
    if (!s) return scheduleRetry();
    if (stopped) { s.destroy(); return; }
    sock = s;
    let buf = Buffer.alloc(0);
    s.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 8) {
        const op = buf.readInt32LE(0);
        const len = buf.readInt32LE(4);
        if (buf.length < 8 + len) break;
        let msg = null;
        try { msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')); } catch { /* a frame we can't read */ }
        buf = buf.subarray(8 + len);
        onMessage(op, msg);
      }
    });
    s.on('error', () => {});
    s.on('close', () => { if (sock === s) { drop(); scheduleRetry(); } });
    s.write(encode(OP_HANDSHAKE, { v: 1, client_id: String(clientId) }));
  }

  function onMessage(op, msg) {
    if (op === OP_PING) { if (sock) sock.write(encode(OP_PONG, msg)); return; }
    if (op === OP_CLOSE) {
      // 4000: an id Discord doesn't know. Asking again won't change that.
      if (msg && (msg.code === 4000 || /client id/i.test(msg.message || ''))) {
        badClient = true;
        log('discord', `Discord did not accept the application id: ${msg.message || msg.code}`);
      }
      drop();
      scheduleRetry();
      return;
    }
    if (op !== OP_FRAME || !msg) return;
    if (msg.evt === 'READY') { ready = true; flush(true); return; }
    if (msg.evt === 'ERROR') log('discord', `${msg.data && msg.data.message}`);
  }

  // send the newest activity, now or when Discord's limit allows
  function flush(force) {
    if (!ready || !sock) return;
    const sig = JSON.stringify(wanted);
    if (sig === sentSig && !force) return;
    const wait = SEND_EVERY - (Date.now() - lastSend);
    if (wait > 0 && !force) {
      if (!sendTimer) {
        sendTimer = setTimeout(() => { sendTimer = null; flush(); }, wait);
        if (sendTimer.unref) sendTimer.unref();
      }
      return;
    }
    lastSend = Date.now();
    sentSig = sig;
    const args = { pid: process.pid };
    if (wanted) args.activity = wanted;
    sock.write(encode(OP_FRAME, { cmd: 'SET_ACTIVITY', args, nonce: String(++nonce) }));
  }

  return {
    // the activity to show, or null to show nothing
    set(activity) {
      if (stopped) return;
      wanted = activity || null;
      if (ready) flush();
      else if (wanted) connect();
    },
    // clear it and let go of the socket (quitting)
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(sendTimer);
      clearTimeout(retryTimer);
      if (ready && sock && sentSig !== 'null') {
        try { sock.write(encode(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid }, nonce: String(++nonce) })); } catch { /* closing anyway */ }
      }
      if (sock) { try { sock.end(); } catch { /* closing anyway */ } }
      drop();
    }
  };
}

// The activity as Discord wants it, from what the window reports. Every line
// is cut to Discord's 128 characters; an empty one is left out.
function buildActivity(st, { largeImage } = {}) {
  if (!st || typeof st !== 'object') return null;
  const line = (s) => {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (s.length > 128) s = s.slice(0, 127) + '…';
    return s.length >= 2 ? s : s ? s + ' ' : '';
  };
  const a = {};
  const details = line(st.details);
  const state = line(st.state);
  if (details) a.details = details;
  if (state) a.state = state;
  if (Number.isFinite(st.since) && st.since > 0) a.timestamps = { start: Math.floor(st.since) };
  if (largeImage) a.assets = { large_image: largeImage, large_text: line(st.imageText) || 'NEO Enhanced' };
  a.instance = false;
  return a;
}

module.exports = { createPresence, buildActivity, socketPaths, encode };
