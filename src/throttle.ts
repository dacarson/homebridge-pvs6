// Event throttling for power readings.
//
// The PVS6 is polled every ~10 s and every reading differs by a few watts, so
// pushing each one to HomeKit generates ~1,000 events/hour across the Eve Watts
// characteristics. PowerThrottle decides whether a new Eve Watts value is
// worth sending; SolarOnHysteresis keeps the Solar "On" switch from flapping
// at sunrise/sunset. Both are pure (no HAP dependency) so they can be unit-tested.

export interface ThrottleConfig {
  enabled: boolean;
  minChangeWatts: number;
  minChangePercent: number;
  maxIntervalSeconds: number;
}

export const DEFAULT_THROTTLE_CONFIG: ThrottleConfig = {
  enabled: true,
  minChangeWatts: 25,
  minChangePercent: 2,
  maxIntervalSeconds: 300,
};

// Builds a ThrottleConfig from raw user config, falling back to defaults for
// missing, non-numeric or negative values.
export function resolveThrottleConfig(raw: {
  throttleUpdates?: unknown;
  minChangeWatts?: unknown;
  minChangePercent?: unknown;
  maxIntervalSeconds?: unknown;
}): ThrottleConfig {
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  const d = DEFAULT_THROTTLE_CONFIG;
  return {
    enabled: raw.throttleUpdates !== false,
    minChangeWatts: num(raw.minChangeWatts, d.minChangeWatts),
    minChangePercent: num(raw.minChangePercent, d.minChangePercent),
    maxIntervalSeconds: num(raw.maxIntervalSeconds, d.maxIntervalSeconds),
  };
}

type DebugLog = (message: string) => void;

export class PowerThrottle {
  private readonly lastSent = new Map<string, { value: number; time: number }>();
  private sentCount = 0;
  private suppressedCount = 0;

  constructor(
    readonly config: ThrottleConfig,
    private readonly debug: DebugLog = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  // Returns true if `value` should be pushed to HomeKit for `key`
  // (accessory + characteristic), and records it as sent if so.
  // Always true when throttling is disabled or for the first value of a key.
  shouldSend(key: string, value: number): boolean {
    if (!this.config.enabled) {
      return true;
    }

    const now = this.now();
    const prev = this.lastSent.get(key);

    let send = prev === undefined;
    if (prev !== undefined) {
      const delta = Math.abs(value - prev.value);
      const threshold = Math.max(
        this.config.minChangeWatts,
        (this.config.minChangePercent / 100) * Math.abs(prev.value),
      );
      const zeroCrossing = (prev.value === 0) !== (value === 0);
      const heartbeatDue = now - prev.time >= this.config.maxIntervalSeconds * 1000;
      send = delta >= threshold || zeroCrossing || heartbeatDue;

      if (!send) {
        this.suppressedCount++;
        this.debug(
          `Throttle: suppressed ${key} ${value}W ` +
          `(last sent ${prev.value}W ${Math.round((now - prev.time) / 1000)}s ago, threshold ${threshold.toFixed(1)}W)`,
        );
        return false;
      }
    }

    this.lastSent.set(key, { value, time: now });
    this.sentCount++;
    return true;
  }

  // Returns the counts since the last call and resets them.
  takeStats(): { sent: number; suppressed: number } {
    const stats = { sent: this.sentCount, suppressed: this.suppressedCount };
    this.sentCount = 0;
    this.suppressedCount = 0;
    return stats;
  }
}

// Hysteresis for the Solar Production "On" switch: turns on above onAboveW,
// off below offBelowW, and holds each state for at least minHoldMs.
export class SolarOnHysteresis {
  private state: boolean | undefined;
  private lastChange = 0;

  constructor(
    private readonly onAboveW = 50,
    private readonly offBelowW = 20,
    private readonly minHoldMs = 5 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  // Current state; false before the first reading.
  get isOn(): boolean {
    return this.state ?? false;
  }

  // Feeds a new power reading and returns the (possibly unchanged) state.
  update(powerW: number): boolean {
    const now = this.now();
    if (this.state === undefined) {
      // First reading (startup): no previous state, so take it from the on
      // threshold directly. The minimum hold starts from here.
      this.state = powerW > this.onAboveW;
      this.lastChange = now;
      return this.state;
    }
    if (now - this.lastChange < this.minHoldMs) {
      return this.state;
    }
    if (!this.state && powerW > this.onAboveW) {
      this.state = true;
      this.lastChange = now;
    } else if (this.state && powerW < this.offBelowW) {
      this.state = false;
      this.lastChange = now;
    }
    return this.state;
  }
}
