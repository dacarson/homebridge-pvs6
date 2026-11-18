import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EVE_HISTORY_INTERVAL_MS,
  EVE_HISTORY_MAX_GAP_MS,
  EVE_HISTORY_MAX_POWER_W,
  EveEnergyHistory,
  EveHistoryRecorder,
  historyMaxGapMs,
} from '../src/eveHistory';

const T0 = 1_700_000_000_000;
const s = (seconds: number) => T0 + seconds * 1000;

describe('EveEnergyHistory', () => {
  it('averages a constant reading', () => {
    const h = new EveEnergyHistory();
    for (let t = 0; t < 600; t += 10) {
      h.sample(1500, s(t));
    }
    assert.deepEqual(h.flush(s(600)), { powerW: 1500, averageW: 1500 });
  });

  it('weights by time, not by sample count', () => {
    const h = new EveEnergyHistory();
    // 1000 W for 60 s, then 100 samples of 0 W over the next 540 s.
    h.sample(1000, s(0));
    h.sample(0, s(60));
    for (let i = 1; i <= 100; i++) {
      h.sample(0, s(60 + i * 5.4));
    }
    assert.equal(h.flush(s(600)).averageW, 100);
  });

  it('caps power so watts × 10 fits in a uint16', () => {
    const h = new EveEnergyHistory();
    for (let t = 0; t <= 600; t += 10) {
      h.sample(9183, s(t));
    }
    const e = h.flush(s(600));
    assert.equal(e.averageW, 9183);
    assert.equal(e.powerW, EVE_HISTORY_MAX_POWER_W);
    assert.ok(e.powerW * 10 <= 0xffff);
  });

  it('treats negative and non-finite readings as 0', () => {
    const h = new EveEnergyHistory();
    h.sample(-500, s(0));
    h.sample(NaN, s(300));
    assert.equal(h.flush(s(600)).averageW, 0);
  });

  it('does not credit gaps longer than the outage limit', () => {
    const h = new EveEnergyHistory();
    h.sample(6000, s(0));
    // No samples for 10 minutes: only EVE_HISTORY_MAX_GAP_MS is credited.
    const e = h.flush(s(600));
    assert.equal(e.averageW, 6000 * (EVE_HISTORY_MAX_GAP_MS / 1000) / 600);
  });

  it('honours a custom gap limit', () => {
    const h = new EveEnergyHistory(600_000);
    h.sample(600, s(0));
    assert.equal(h.flush(s(600)).averageW, 600);
  });

  it('splits a reading across window edges', () => {
    const h = new EveEnergyHistory();
    h.sample(0, s(0));
    h.sample(1200, s(540)); // 1200 W for the last 60 s of window 1
    assert.equal(h.flush(s(600)).averageW, 120);
    h.sample(1200, s(610)); // and it continues into window 2
    h.sample(0, s(660));
    assert.equal(h.flush(s(1200)).averageW, 120);
  });

  it('returns 0 for a window with no time in it', () => {
    const h = new EveEnergyHistory();
    assert.deepEqual(h.flush(s(0)), { powerW: 0, averageW: 0 });
  });
});

describe('EveHistoryRecorder', () => {
  function make() {
    const entries: Array<{ time: number; power: number }> = [];
    const logs: string[] = [];
    const rec = new EveHistoryRecorder(
      { addEntry: e => entries.push(e) },
      'Solar',
      { info: m => logs.push(m) },
    );
    return { rec, entries, logs };
  }

  it('writes one entry per record() with time in seconds', () => {
    const { rec, entries } = make();
    for (let t = 0; t < 600; t += 10) {
      rec.sample(2000, s(t));
    }
    rec.record(s(600));
    assert.deepEqual(entries, [{ time: Math.round(s(600) / 1000), power: 2000 }]);
  });

  it('logs the cap once', () => {
    const { rec, entries, logs } = make();
    for (let w = 0; w < 3; w++) {
      for (let t = 0; t < 600; t += 10) {
        rec.sample(8000, s(w * 600 + t));
      }
      rec.record(s((w + 1) * 600));
    }
    assert.equal(entries.length, 3);
    assert.ok(entries.every(e => e.power === EVE_HISTORY_MAX_POWER_W));
    assert.equal(logs.length, 1);
  });
});

describe('historyMaxGapMs', () => {
  it('is at least the default and covers two slow polls', () => {
    assert.equal(historyMaxGapMs(10_000), EVE_HISTORY_MAX_GAP_MS);
    assert.ok(historyMaxGapMs(120_000) > 2 * 120_000);
    assert.ok(historyMaxGapMs(120_000) < EVE_HISTORY_INTERVAL_MS);
  });
});
