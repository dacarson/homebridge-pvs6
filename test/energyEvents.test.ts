import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CUMULATIVE_HEARTBEAT_MS,
  EnergyEventScheduler,
  EnergyKind,
  PERIODIC_PERIOD_MS,
} from '../src/energyEvents';

const POLL_MS = 10_000;
const START_MS = 1_700_000_000_000;

function make(kinds: EnergyKind[] = ['exported']) {
  let t = START_MS;
  const scheduler = new EnergyEventScheduler(kinds, () => t);
  return {
    scheduler,
    advance: (ms: number) => { t += ms; },
    nowS: () => Math.floor(t / 1000),
  };
}

describe('EnergyEventScheduler', () => {
  it('sends cumulative totals on the first reading (startup) without a periodic event', () => {
    const { scheduler } = make();
    assert.deepEqual(scheduler.next({ exported: 1234.5 }), {
      cumulativeEnergyExported: { energy: 1_234_500_000 },
    });
  });

  it('sends nothing while idle except the 15-minute heartbeat', () => {
    const { scheduler, advance, nowS } = make();
    scheduler.next({ exported: 1000 });
    const startS = nowS();

    const sent: Array<{ atMs: number; fragment: object }> = [];
    let elapsed = 0;
    // One hour of 10 s polls with no production (night).
    while (elapsed < 60 * 60 * 1000) {
      advance(POLL_MS);
      elapsed += POLL_MS;
      const fragment = scheduler.next({ exported: 1000 });
      if (fragment) sent.push({ atMs: elapsed, fragment });
    }

    // Exactly one combined cumulative + periodic heartbeat every 15 minutes.
    assert.deepEqual(sent.map(s => s.atMs), [1, 2, 3, 4].map(n => n * 15 * 60 * 1000));
    assert.equal(CUMULATIVE_HEARTBEAT_MS, 15 * 60 * 1000);
    assert.equal(PERIODIC_PERIOD_MS, 15 * 60 * 1000);
    assert.deepEqual(sent[0].fragment, {
      cumulativeEnergyExported: { energy: 1_000_000_000 },
      periodicEnergyExported: { energy: 0, startTimestamp: startS, endTimestamp: startS + 15 * 60 },
    });
  });

  it('sends cumulative only when the total changes', () => {
    const { scheduler, advance } = make();
    scheduler.next({ exported: 1000 });
    advance(PERIODIC_PERIOD_MS); // close the first (idle) period
    scheduler.next({ exported: 1000 });
    // Producing: becomes active, so this emits a prompt period too.
    advance(POLL_MS);
    assert.ok(scheduler.next({ exported: 1000.01 })?.cumulativeEnergyExported);
    // Unchanged total, mid-period: nothing to send.
    advance(POLL_MS);
    assert.equal(scheduler.next({ exported: 1000.01 }), null);
    // Changed total, mid-period: cumulative only.
    advance(POLL_MS);
    assert.deepEqual(scheduler.next({ exported: 1000.02 }), {
      cumulativeEnergyExported: { energy: 1_000_020_000 },
    });
  });

  it('sums periodic energy across polls into one period covering the whole span', () => {
    const { scheduler, advance, nowS } = make();
    // Start active: a first period with energy, so later readings accumulate quietly.
    scheduler.next({ exported: 500 });
    advance(POLL_MS);
    const first = scheduler.next({ exported: 500.005 });
    assert.equal(first?.periodicEnergyExported?.energy, 5000);
    const periodStartS = nowS();

    // 90 polls (15 min) adding 0.012 kWh each. At poll 40 the counter resets
    // (drops by 5 kWh) and keeps counting from there.
    let kWh = 500.005;
    const sent: object[] = [];
    for (let i = 1; i <= 90; i++) {
      advance(POLL_MS);
      kWh += 0.012;
      const reading = i >= 40 ? kWh - 5 : kWh;
      const fragment = scheduler.next({ exported: reading });
      if (fragment?.periodicEnergyExported) sent.push(fragment.periodicEnergyExported);
    }

    // The reset poll contributes nothing (never negative); every other poll adds 12 Wh.
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], {
      energy: 89 * 12_000,
      startTimestamp: periodStartS,
      endTimestamp: periodStartS + 15 * 60,
    });
  });

  it('sums periodic energy exactly over steady polls', () => {
    const { scheduler, advance } = make();
    scheduler.next({ exported: 0 });
    advance(POLL_MS);
    scheduler.next({ exported: 0.001 }); // becomes active → prompt period
    let kWh = 0.001;
    let periodic;
    for (let i = 0; i < 90; i++) {
      advance(POLL_MS);
      kWh += 0.0125;
      periodic = scheduler.next({ exported: kWh })?.periodicEnergyExported ?? periodic;
    }
    assert.equal(periodic?.energy, 90 * 12_500);
  });

  it('emits promptly when going from idle to active', () => {
    const { scheduler, advance, nowS } = make();
    scheduler.next({ exported: 1000 });
    const startS = nowS();
    // 5 idle minutes, then the first poll with energy.
    for (let i = 0; i < 30; i++) {
      advance(POLL_MS);
      assert.equal(scheduler.next({ exported: 1000 }), null);
    }
    advance(POLL_MS);
    assert.deepEqual(scheduler.next({ exported: 1000.003 }), {
      cumulativeEnergyExported: { energy: 1_000_003_000 },
      periodicEnergyExported: { energy: 3000, startTimestamp: startS, endTimestamp: nowS() },
    });
    // Now active: the next period waits the full 15 minutes.
    advance(POLL_MS);
    assert.equal(scheduler.next({ exported: 1000.003 }), null);
  });

  it('tracks idle per direction on a bidirectional meter', () => {
    const { scheduler, advance, nowS } = make(['imported', 'exported']);
    scheduler.next({ imported: 100, exported: 200 });
    // Exporting only: export becomes active and both directions are reported.
    advance(POLL_MS);
    const first = scheduler.next({ imported: 100, exported: 200.01 });
    assert.equal(first?.periodicEnergyImported?.energy, 0);
    assert.equal(first?.periodicEnergyExported?.energy, 10_000);
    const startS = nowS();
    // Export keeps going: quiet. Import starts: import was idle, so emit promptly.
    advance(POLL_MS);
    assert.equal(scheduler.next({ imported: 100, exported: 200.01 })?.periodicEnergyExported, undefined);
    advance(POLL_MS);
    const flipped = scheduler.next({ imported: 100.002, exported: 200.01 });
    assert.deepEqual(flipped?.periodicEnergyImported, { energy: 2000, startTimestamp: startS, endTimestamp: nowS() });
    assert.deepEqual(flipped?.periodicEnergyExported, { energy: 0, startTimestamp: startS, endTimestamp: nowS() });
  });
});
