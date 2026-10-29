'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// the rules for today's word count from app.js, on their own (#345)
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('// ---- daily words rules:');
const to = app.indexOf('// ---- end of daily words rules ----');
const context = vm.createContext({});
vm.runInContext(app.slice(from, to), context);
vm.runInContext('this.api = { dayWords, nextDayCount, mergeDayCounts, setDayCount };', context);
const { dayWords, nextDayCount, mergeDayCounts, setDayCount } = context.api;
const plain = (o) => JSON.parse(JSON.stringify(o));

test('a new day starts at the story\'s count', () => {
  assert.deepEqual(plain(nextDayCount(undefined, 2060, undefined)), { start: 2060, end: 2060 });
  assert.deepEqual(plain(nextDayCount(undefined, 2061, 2060)), { start: 2061, end: 2061 }, 'the keystroke that crosses midnight starts the new day at nothing');
});

test('typing here counts, and so does cutting, down to zero', () => {
  const day = { start: 1000, end: 1400 };
  assert.equal(dayWords(nextDayCount(day, 1405, 1400)), 405);
  assert.equal(dayWords(nextDayCount(day, 1300, 1400)), 300, 'a cut takes from today');
  const cut = nextDayCount(day, 200, 1400);
  assert.equal(dayWords(cut), 0, 'today never reads below zero');
  assert.equal(dayWords(nextDayCount(cut, 210, 200)), 10, 'what is written after the cut counts in full');
});

test('text read from disk never counts as written today', () => {
  // a chapter still syncing when the book opened arrives: 2,000 words more
  const opened = nextDayCount(undefined, 60, undefined);
  assert.equal(dayWords(nextDayCount(opened, 2060, 2060)), 0);
  // the other device wrote 400 today; the book opens with a chapter missing
  const there = { start: 1660, end: 2060 };
  const short = nextDayCount(there, 60, 60);
  assert.equal(dayWords(short), 400, 'the day keeps what was written there');
  const typed = nextDayCount(short, 61, 60);
  assert.equal(dayWords(typed), 401);
  assert.equal(dayWords(nextDayCount(typed, 2061, 2061)), 401, 'the missing chapter arriving adds nothing');
  // the other device's copy of a chapter, kept beside ours: no words of today
  assert.equal(dayWords(nextDayCount({ start: 1500, end: 1501 }, 3002, 3002)), 1);
});

test('a broken entry reads as nothing written', () => {
  assert.equal(dayWords(undefined), 0);
  assert.equal(dayWords({ start: 'x', end: 5 }), 0);
  assert.equal(dayWords({ start: 10, end: 5 }), 0);
  assert.deepEqual(plain(nextDayCount({ start: null, end: 5 }, 50, 50)), { start: 50, end: 50 });
});

test('another device\'s days: the larger tally of a day wins', () => {
  const ours = { '2026-10-13': { start: 500, end: 900 }, '2026-10-14': { start: 3001, end: 3002 } };
  const theirs = { '2026-10-12': { start: 100, end: 500 }, '2026-10-13': { start: 500, end: 600 }, '2026-10-14': { start: 100, end: 400 } };
  const days = plain(mergeDayCounts(ours, theirs));
  assert.deepEqual(days['2026-10-12'], { start: 100, end: 500 }, 'a day only they have is taken');
  assert.deepEqual(days['2026-10-13'], { start: 500, end: 900 }, 'ours, where we saw more');
  assert.deepEqual(days['2026-10-14'], { start: 2702, end: 3002 }, 'their 300, against our count');
  assert.deepEqual(plain(mergeDayCounts(ours, ours)), plain(ours), 'our own file read back changes nothing');
  assert.deepEqual(plain(mergeDayCounts(ours, null)), plain(ours));
  assert.deepEqual(plain(mergeDayCounts(undefined, { d: { start: 'a', end: 1 } })), {});
});

test('today\'s count set by hand: reset, changed, and typed on from there', () => {
  const reset = setDayCount(3000, 0, 50);
  assert.deepEqual(plain(reset), { start: 3000, end: 3000, set: 50 });
  assert.equal(dayWords(nextDayCount(reset, 3012, 3000)), 12, 'typing after a reset counts from nothing');
  assert.equal(nextDayCount(reset, 3012, 3000).set, 50, 'and the entry remembers it was set');
  assert.equal(dayWords(setDayCount(3000, 4500, 50)), 4500, 'a count above the story\'s own is the writer\'s to give');
  assert.equal(dayWords(setDayCount(3000, -5, 50)), 0);
});

test('a count set by hand isn\'t undone by the other device\'s older tally', () => {
  const day = '2026-10-23';
  const mine = { [day]: { start: 3000, end: 3010, set: 50 } }; // reset, then 10 typed
  const theirs = { [day]: { start: 2600, end: 3000 } }; // the 400 they saw before the reset
  assert.equal(dayWords(mergeDayCounts(mine, theirs)[day]), 10, 'the reset stands here');
  const there = mergeDayCounts(theirs, mine)[day];
  assert.equal(dayWords(there), 10, 'and is taken in there');
  assert.equal(there.set, 50);
  // both have the same setting: the larger tally since then wins, as ever
  assert.equal(dayWords(mergeDayCounts(mine, { [day]: { start: 2980, end: 3010, set: 50 } })[day]), 30);
  // a newer setting over there wins over an older one here
  assert.equal(dayWords(mergeDayCounts(mine, { [day]: { start: 3000, end: 3200, set: 90 } })[day]), 200);
});
