import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_UPDATE_CONFIG,
  EVE_HEARTBEAT_MS,
  EveUpdatePolicy,
  PowerSwitch,
  resolveUpdateConfig,
  SWITCH_OFF_BELOW_W,
  SWITCH_ON_ABOVE_W,
  UpdateConfig,
  UpdateStats,
} from '../src/throttle';

// Fake clock so heartbeat/hold timing is deterministic.
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (seconds: number) => { t += seconds * 1000; },
  };
}

function makePolicy(overrides: Partial<UpdateConfig> = {}) {
  const c = clock();
  const debug: string[] = [];
  const stats = new UpdateStats();
  const policy = new EveUpdatePolicy({ ...DEFAULT_UPDATE_CONFIG, ...overrides }, stats, msg => debug.push(msg), c.now);
  return { policy, stats, clock: c, debug };
}

describe('EveUpdatePolicy — throttled (default)', () => {
  it('is the default mode and keeps NOTIFY', () => {
    const { policy } = makePolicy();
    assert.equal(policy.mode, 'throttled');
    assert.equal(policy.notify, true);
  });

  it('always pushes the first value for a key (startup)', () => {
    const { policy } = makePolicy();
    assert.equal(policy.shouldPush('solar.watts', 'watts', 1234), true);
    assert.equal(policy.shouldPush('solar.kwh', 'kwh', 5000), true);
    assert.equal(policy.shouldPush('grid-import.watts', 'watts', 0), true);
  });

  it('watts: uses minChangeWatts when it is larger than the percentage', () => {
    // 2% of 500 W = 10 W, so the 25 W floor applies.
    const { policy } = makePolicy();
    policy.shouldPush('k', 'watts', 500);
    assert.equal(policy.shouldPush('k', 'watts', 524), false);
    assert.equal(policy.shouldPush('k', 'watts', 476), false);
    assert.equal(policy.shouldPush('k', 'watts', 525), true);
  });

  it('watts: uses minChangePercent when it is larger than the watts', () => {
    // 2% of 5000 W = 100 W.
    const { policy } = makePolicy();
    policy.shouldPush('k', 'watts', 5000);
    assert.equal(policy.shouldPush('k', 'watts', 5099), false);
    assert.equal(policy.shouldPush('k', 'watts', 5100), true);
  });

  it('watts: small changes near zero wait for the threshold or heartbeat', () => {
    const { policy } = makePolicy();
    policy.shouldPush('k', 'watts', 10);
    assert.equal(policy.shouldPush('k', 'watts', 0), false);
  });

  it('measures change against the last value pushed, not the last reading', () => {
    const { policy } = makePolicy();
    policy.shouldPush('k', 'watts', 500);
    assert.equal(policy.shouldPush('k', 'watts', 510), false);
    assert.equal(policy.shouldPush('k', 'watts', 520), false);
    assert.equal(policy.shouldPush('k', 'watts', 530), true);
    assert.equal(policy.shouldPush('k', 'watts', 540), false);
  });

  it('kWh: pushes once the change reaches minChangeKwh', () => {
    const { policy } = makePolicy();
    policy.shouldPush('k', 'kwh', 1000);
    assert.equal(policy.shouldPush('k', 'kwh', 1000.05), false);
    assert.equal(policy.shouldPush('k', 'kwh', 1000.09), false);
    assert.equal(policy.shouldPush('k', 'kwh', 1000.1), true);
  });

  it('kWh: honours a configured minChangeKwh', () => {
    const { policy } = makePolicy({ minChangeKwh: 0.01 });
    policy.shouldPush('k', 'kwh', 1000);
    assert.equal(policy.shouldPush('k', 'kwh', 1000.009), false);
    assert.equal(policy.shouldPush('k', 'kwh', 1000.01), true);
  });

  it('pushes an unchanged value once 5 minutes have passed', () => {
    const { policy, clock: c } = makePolicy();
    assert.equal(EVE_HEARTBEAT_MS, 5 * 60 * 1000);
    policy.shouldPush('w', 'watts', 500);
    policy.shouldPush('e', 'kwh', 1000);
    c.advance(299);
    assert.equal(policy.shouldPush('w', 'watts', 501), false);
    assert.equal(policy.shouldPush('e', 'kwh', 1000), false);
    c.advance(1);
    assert.equal(policy.shouldPush('w', 'watts', 501), true);
    assert.equal(policy.shouldPush('e', 'kwh', 1000), true);
    // The heartbeat restarts from the push.
    c.advance(10);
    assert.equal(policy.shouldPush('w', 'watts', 502), false);
  });

  it('tracks keys independently', () => {
    const { policy } = makePolicy();
    policy.shouldPush('a', 'watts', 500);
    policy.shouldPush('b', 'watts', 1000);
    assert.equal(policy.shouldPush('a', 'watts', 530), true);
    assert.equal(policy.shouldPush('b', 'watts', 1010), false);
  });

  it('counts and debug-logs suppressed updates', () => {
    const { policy, stats, debug } = makePolicy();
    policy.shouldPush('k', 'watts', 500); // sent
    policy.shouldPush('k', 'watts', 505); // suppressed
    policy.shouldPush('k', 'watts', 600); // sent
    assert.equal(stats.eveSent, 2);
    assert.equal(stats.eveSuppressed, 1);
    assert.equal(debug.length, 1);
    assert.match(debug[0], /suppressed: k 505/);
  });
});

describe('EveUpdatePolicy — pollOnly', () => {
  it('removes NOTIFY and never pushes, not even the first value', () => {
    const { policy, stats, debug } = makePolicy({ evePowerUpdates: 'pollOnly' });
    assert.equal(policy.notify, false);
    for (const v of [500, 5000, 0]) {
      assert.equal(policy.shouldPush('k', 'watts', v), false);
      assert.equal(policy.shouldPush('e', 'kwh', v), false);
    }
    assert.equal(stats.eveSent, 0);
    assert.equal(debug.length, 0);
  });
});

describe('EveUpdatePolicy — live', () => {
  it('keeps NOTIFY and pushes every value', () => {
    const { policy, stats, debug } = makePolicy({ evePowerUpdates: 'live' });
    assert.equal(policy.notify, true);
    for (const v of [500, 500, 501, 0, 0, 1]) {
      assert.equal(policy.shouldPush('k', 'watts', v), true);
      assert.equal(policy.shouldPush('e', 'kwh', v), true);
    }
    assert.equal(stats.eveSuppressed, 0);
    assert.equal(debug.length, 0);
  });
});

describe('resolveUpdateConfig', () => {
  it('defaults to throttled with the documented values', () => {
    assert.deepEqual(resolveUpdateConfig({}), {
      evePowerUpdates: 'throttled',
      minChangeWatts: 25,
      minChangePercent: 2,
      minChangeKwh: 0.1,
      switchHoldSeconds: 60,
    });
  });

  it('honours user values and ignores invalid ones', () => {
    assert.deepEqual(
      resolveUpdateConfig({ evePowerUpdates: 'pollOnly', minChangeWatts: 10, minChangePercent: -1, minChangeKwh: 'x', switchHoldSeconds: 0 }),
      { evePowerUpdates: 'pollOnly', minChangeWatts: 10, minChangePercent: 2, minChangeKwh: 0.1, switchHoldSeconds: 0 },
    );
    assert.equal(resolveUpdateConfig({ evePowerUpdates: 'bogus' }).evePowerUpdates, 'throttled');
  });
});

describe('PowerSwitch', () => {
  const HOLD_S = 60;

  function make(holdS = HOLD_S) {
    const c = clock();
    const stats = new UpdateStats();
    const debug: string[] = [];
    const sw = new PowerSwitch('Test', holdS * 1000, stats, msg => debug.push(msg), c.now);
    return { sw, stats, debug, clock: c };
  }

  it('is off before the first reading and reports the first reading immediately', () => {
    assert.equal(make().sw.isOn, false);
    assert.equal(make().sw.update(800), true);
    assert.equal(make().sw.update(30), false);
  });

  describe('deadband', () => {
    it('uses the named thresholds', () => {
      assert.equal(SWITCH_ON_ABOVE_W, 50);
      assert.equal(SWITCH_OFF_BELOW_W, 20);
    });

    it('turns on only above 50 W and off only below 20 W', () => {
      const { sw } = make(0);
      sw.update(0);
      assert.equal(sw.update(50), false);
      assert.equal(sw.update(30), false);
      assert.equal(sw.update(51), true);
      assert.equal(sw.update(20), true);
      assert.equal(sw.update(35), true);
      assert.equal(sw.update(19.9), false);
    });
  });

  describe('hold', () => {
    it('reports a new state only after it has held for switchHoldSeconds', () => {
      const { sw, stats, debug, clock: c } = make();
      sw.update(0);
      c.advance(10);
      assert.equal(sw.update(100), false); // pending on
      c.advance(HOLD_S - 1);
      assert.equal(sw.update(100), false); // 59 s held
      c.advance(1);
      assert.equal(sw.update(100), true); // 60 s held → reported
      assert.equal(stats.switchReported, 1);
      assert.ok(debug.some(m => /holding change to on/.test(m)));
    });

    it('cancels a pending change if power goes back, and restarts the hold next time', () => {
      const { sw, stats, debug, clock: c } = make();
      sw.update(800);
      c.advance(10);
      assert.equal(sw.update(5), true); // pending off (cloud)
      c.advance(30);
      assert.equal(sw.update(400), true); // sun back: cancelled
      assert.equal(stats.switchHeld, 1);
      assert.ok(debug.some(m => /cancelled/.test(m)));
      c.advance(10);
      assert.equal(sw.update(5), true); // new pending off
      c.advance(HOLD_S - 1);
      assert.equal(sw.update(5), true); // hold restarted, not yet 60 s
      c.advance(1);
      assert.equal(sw.update(5), false);
    });

    it('treats a reading in the deadband as no change (cancels the pending one)', () => {
      const { sw, clock: c } = make();
      sw.update(0);
      c.advance(10);
      sw.update(100); // pending on
      c.advance(30);
      assert.equal(sw.update(35), false); // in deadband while off → stays off, pending cancelled
      c.advance(HOLD_S);
      assert.equal(sw.update(100), false); // pending starts over
    });

    it('reports immediately when switchHoldSeconds is 0', () => {
      const { sw, clock: c } = make(0);
      sw.update(0);
      c.advance(10);
      assert.equal(sw.update(100), true);
      c.advance(10);
      assert.equal(sw.update(0), false);
    });
  });
});

describe('UpdateStats', () => {
  it('summarises the counts on one line and resets them', () => {
    const stats = new UpdateStats();
    stats.eveSent = 3;
    stats.eveSuppressed = 7;
    stats.switchReported = 1;
    stats.switchHeld = 2;
    const line = stats.takeSummary();
    assert.match(line, /3 sent, 7 suppressed/);
    assert.match(line, /1 reported, 2 held back/);
    assert.ok(!line.includes('\n'));
    assert.match(stats.takeSummary(), /0 sent, 0 suppressed.*0 reported, 0 held back/);
  });
});
