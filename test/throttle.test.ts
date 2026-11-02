import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_THROTTLE_CONFIG,
  PowerThrottle,
  resolveThrottleConfig,
  SolarOnHysteresis,
  ThrottleConfig,
} from '../src/throttle';

// Fake clock so heartbeat/hold timing is deterministic.
function clock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (seconds: number) => { t += seconds * 1000; },
  };
}

function makeThrottle(overrides: Partial<ThrottleConfig> = {}) {
  const c = clock();
  const debug: string[] = [];
  const throttle = new PowerThrottle(
    { ...DEFAULT_THROTTLE_CONFIG, ...overrides },
    msg => debug.push(msg),
    c.now,
  );
  return { throttle, clock: c, debug };
}

describe('PowerThrottle', () => {
  it('always sends the first value for a key (startup)', () => {
    const { throttle } = makeThrottle();
    assert.equal(throttle.shouldSend('solar.watts', 1234), true);
    assert.equal(throttle.shouldSend('grid-import.watts', 0), true);
  });

  describe('threshold', () => {
    it('uses minChangeWatts when it is larger than the percentage', () => {
      // 2% of 500 W = 10 W, so the 25 W floor applies.
      const { throttle } = makeThrottle();
      throttle.shouldSend('k', 500);
      assert.equal(throttle.shouldSend('k', 524), false);
      assert.equal(throttle.shouldSend('k', 476), false);
      assert.equal(throttle.shouldSend('k', 525), true);
    });

    it('uses minChangePercent when it is larger than the watts', () => {
      // 2% of 5000 W = 100 W.
      const { throttle } = makeThrottle();
      throttle.shouldSend('k', 5000);
      assert.equal(throttle.shouldSend('k', 5099), false);
      assert.equal(throttle.shouldSend('k', 4901), false);
      assert.equal(throttle.shouldSend('k', 5100), true);
    });

    it('measures change against the last value sent, not the last reading', () => {
      const { throttle } = makeThrottle();
      throttle.shouldSend('k', 500);
      // Slow drift: each step is small, but the total eventually crosses 25 W.
      assert.equal(throttle.shouldSend('k', 510), false);
      assert.equal(throttle.shouldSend('k', 520), false);
      assert.equal(throttle.shouldSend('k', 530), true);
      // Baseline is now 530.
      assert.equal(throttle.shouldSend('k', 540), false);
    });

    it('tracks keys independently', () => {
      const { throttle } = makeThrottle();
      throttle.shouldSend('a', 500);
      throttle.shouldSend('b', 1000);
      assert.equal(throttle.shouldSend('a', 530), true);
      assert.equal(throttle.shouldSend('b', 1010), false);
    });
  });

  describe('zero crossing', () => {
    it('sends when a value drops to 0, even below the threshold', () => {
      const { throttle } = makeThrottle();
      throttle.shouldSend('k', 10);
      assert.equal(throttle.shouldSend('k', 0), true);
    });

    it('sends when a value rises from 0, even below the threshold', () => {
      const { throttle } = makeThrottle();
      throttle.shouldSend('k', 0);
      assert.equal(throttle.shouldSend('k', 3), true);
    });

    it('suppresses repeated zeros', () => {
      const { throttle } = makeThrottle();
      throttle.shouldSend('k', 0);
      assert.equal(throttle.shouldSend('k', 0), false);
    });
  });

  describe('heartbeat', () => {
    it('sends an unchanged value once maxIntervalSeconds has passed', () => {
      const { throttle, clock: c } = makeThrottle();
      throttle.shouldSend('k', 500);
      c.advance(299);
      assert.equal(throttle.shouldSend('k', 501), false);
      c.advance(1);
      assert.equal(throttle.shouldSend('k', 501), true);
      // Heartbeat resets on send.
      c.advance(10);
      assert.equal(throttle.shouldSend('k', 502), false);
    });

    it('suppressed readings do not reset the heartbeat timer', () => {
      const { throttle, clock: c } = makeThrottle({ maxIntervalSeconds: 60 });
      throttle.shouldSend('k', 500);
      for (let i = 0; i < 5; i++) {
        c.advance(10);
        assert.equal(throttle.shouldSend('k', 500), false);
      }
      c.advance(10);
      assert.equal(throttle.shouldSend('k', 500), true);
    });
  });

  describe('disabled', () => {
    it('sends every value and records nothing', () => {
      const { throttle, debug } = makeThrottle({ enabled: false });
      assert.equal(throttle.enabled, false);
      for (const v of [500, 500, 501, 0, 0, 1]) {
        assert.equal(throttle.shouldSend('k', v), true);
      }
      assert.deepEqual(throttle.takeStats(), { sent: 0, suppressed: 0 });
      assert.equal(debug.length, 0);
    });
  });

  it('counts sent vs suppressed, logs suppressions, and resets stats', () => {
    const { throttle, debug } = makeThrottle();
    throttle.shouldSend('k', 500); // sent
    throttle.shouldSend('k', 505); // suppressed
    throttle.shouldSend('k', 510); // suppressed
    throttle.shouldSend('k', 600); // sent
    assert.deepEqual(throttle.takeStats(), { sent: 2, suppressed: 2 });
    assert.deepEqual(throttle.takeStats(), { sent: 0, suppressed: 0 });
    assert.equal(debug.length, 2);
    assert.match(debug[0], /suppressed k 505W/);
  });
});

describe('resolveThrottleConfig', () => {
  it('defaults to enabled with the documented values', () => {
    assert.deepEqual(resolveThrottleConfig({}), {
      enabled: true,
      minChangeWatts: 25,
      minChangePercent: 2,
      maxIntervalSeconds: 300,
    });
  });

  it('honours user values and ignores invalid ones', () => {
    assert.deepEqual(
      resolveThrottleConfig({ throttleUpdates: false, minChangeWatts: 10, minChangePercent: -1, maxIntervalSeconds: 'x' }),
      { enabled: false, minChangeWatts: 10, minChangePercent: 2, maxIntervalSeconds: 300 },
    );
  });
});

describe('SolarOnHysteresis', () => {
  const HOLD_S = 5 * 60;

  function make() {
    const c = clock();
    return { h: new SolarOnHysteresis(50, 20, HOLD_S * 1000, c.now), clock: c };
  }

  it('is off before the first reading', () => {
    assert.equal(make().h.isOn, false);
  });

  it('takes the first reading directly', () => {
    assert.equal(make().h.update(800), true);
    assert.equal(make().h.update(30), false);
  });

  it('turns on only above 50 W and off only below 20 W', () => {
    const { h, clock: c } = make();
    h.update(0);
    c.advance(HOLD_S);
    assert.equal(h.update(50), false);
    assert.equal(h.update(51), true);
    c.advance(HOLD_S);
    assert.equal(h.update(20), true);
    assert.equal(h.update(30), true);
    assert.equal(h.update(19), false);
  });

  it('holds each state for at least 5 minutes', () => {
    const { h, clock: c } = make();
    h.update(0);
    c.advance(HOLD_S);
    assert.equal(h.update(100), true);
    c.advance(HOLD_S - 1);
    assert.equal(h.update(0), true); // still held
    c.advance(1);
    assert.equal(h.update(0), false);
    c.advance(60);
    assert.equal(h.update(100), false); // held off
    c.advance(HOLD_S);
    assert.equal(h.update(100), true);
  });
});
