import test from 'node:test';
import assert from 'node:assert/strict';
import { timeOfDay, normaliseStartMinutes, DAY_DURATION_SECONDS } from '../game-time.js';

test('the clock advances through dusk and midnight using active simulation time', () => {
  assert.equal(timeOfDay({ elapsed: 0 }).label, '18:30');
  assert.equal(timeOfDay({ elapsed: 165 }).label, '00:00');
  assert.equal(timeOfDay({ elapsed: 165 }).day, 2);
  assert.equal(timeOfDay({ elapsed: DAY_DURATION_SECONDS }).label, '18:30');
  assert.equal(timeOfDay({ elapsed: DAY_DURATION_SECONDS }).day, 2);
});

test('day and night are distinct and dawn and sunset blend continuously', () => {
  assert.equal(timeOfDay({ startClockMinutes: 720 }).daylight, 1);
  assert.equal(timeOfDay({ startClockMinutes: 0 }).night, 1);
  for (const hour of [6.5, 19.5]) {
    const middle = timeOfDay({ startClockMinutes: hour * 60 });
    assert.equal(middle.daylight, .5);
    assert.equal(middle.twilight, 1);
    const before = timeOfDay({ startClockMinutes: hour * 60 - .01 });
    const after = timeOfDay({ startClockMinutes: hour * 60 + .01 });
    assert.ok(Math.abs(before.daylight - after.daylight) < .001);
  }
});

test('a frozen simulation freezes lighting and selected start times remain bounded', () => {
  const state = { startClockMinutes: 360, elapsed: 24 };
  assert.deepEqual(timeOfDay(state), timeOfDay({ ...state, mode: 'paused' }));
  assert.equal(normaliseStartMinutes(-60), 1380);
  assert.equal(normaliseStartMinutes(Infinity), 1110);
  assert.equal(timeOfDay({ startClockMinutes: 0, elapsed: NaN }).label, '00:00');
});
