// HomeKit traffic reduction.
//
// The PVS6 is polled every ~10 s and every reading differs by a few watts, so
// pushing each one to HomeKit generates ~1,000 events/hour. Two independent
// mechanisms cut that down without breaking automations:
//
// - EveUpdatePolicy decides whether a new Eve Watts / Eve kWh value is pushed,
//   per the evePowerUpdates setting:
//     throttled — push on a meaningful change or every EVE_HEARTBEAT_MS
//     pollOnly  — never push (NOTIFY is removed); values are served on read
//     live      — push every poll (original behaviour)
// - PowerSwitch derives the standard HomeKit On switches from power, with a
//   deadband (on above SWITCH_ON_ABOVE_W, off below SWITCH_OFF_BELOW_W) and a
//   hold: a new state must persist for switchHoldSeconds before it's reported.
//
// Both are pure (no HAP dependency, injectable clock) so they can be unit-tested.

export type EvePowerUpdatesMode = 'throttled' | 'pollOnly' | 'live';

export const EVE_HEARTBEAT_MS = 5 * 60 * 1000;
export const SWITCH_ON_ABOVE_W = 50;
export const SWITCH_OFF_BELOW_W = 20;

export interface UpdateConfig {
  evePowerUpdates: EvePowerUpdatesMode;
  minChangeWatts: number;
  minChangePercent: number;
  minChangeKwh: number;
  switchHoldSeconds: number;
}

export const DEFAULT_UPDATE_CONFIG: UpdateConfig = {
  evePowerUpdates: 'throttled',
  minChangeWatts: 25,
  minChangePercent: 2,
  minChangeKwh: 0.1,
  switchHoldSeconds: 60,
};

const MODES: readonly EvePowerUpdatesMode[] = ['throttled', 'pollOnly', 'live'];

// Builds an UpdateConfig from raw user config, falling back to defaults for
// missing, unknown, non-numeric or negative values.
export function resolveUpdateConfig(raw: {
  evePowerUpdates?: unknown;
  minChangeWatts?: unknown;
  minChangePercent?: unknown;
  minChangeKwh?: unknown;
  switchHoldSeconds?: unknown;
}): UpdateConfig {
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  const d = DEFAULT_UPDATE_CONFIG;
  return {
    evePowerUpdates: MODES.includes(raw.evePowerUpdates as EvePowerUpdatesMode)
      ? raw.evePowerUpdates as EvePowerUpdatesMode
      : d.evePowerUpdates,
    minChangeWatts: num(raw.minChangeWatts, d.minChangeWatts),
    minChangePercent: num(raw.minChangePercent, d.minChangePercent),
    minChangeKwh: num(raw.minChangeKwh, d.minChangeKwh),
    switchHoldSeconds: num(raw.switchHoldSeconds, d.switchHoldSeconds),
  };
}

type DebugLog = (message: string) => void;

// Counts for the hourly summary, shared by the Eve policy and all switches.
export class UpdateStats {
  eveSent = 0;
  eveSuppressed = 0;
  switchReported = 0;
  // A pending switch change that was cancelled because power went back
  // before switchHoldSeconds elapsed (i.e. a flap that was never reported).
  switchHeld = 0;

  // Returns a one-line summary of the counts and resets them.
  takeSummary(): string {
    const line =
      `HomeKit updates in the last hour: Eve values ${this.eveSent} sent, ${this.eveSuppressed} suppressed; ` +
      `switch changes ${this.switchReported} reported, ${this.switchHeld} held back`;
    this.eveSent = this.eveSuppressed = this.switchReported = this.switchHeld = 0;
    return line;
  }
}

export type EveValueKind = 'watts' | 'kwh';

export class EveUpdatePolicy {
  private readonly lastPushed = new Map<string, { value: number; time: number }>();

  constructor(
    readonly config: UpdateConfig,
    private readonly stats: UpdateStats = new UpdateStats(),
    private readonly debug: DebugLog = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  get mode(): EvePowerUpdatesMode {
    return this.config.evePowerUpdates;
  }

  // Whether the Eve characteristics should advertise NOTIFY.
  get notify(): boolean {
    return this.mode !== 'pollOnly';
  }

  // Returns true if `value` should be pushed to HomeKit for `key`
  // (accessory + characteristic), and records it as pushed if so.
  shouldPush(key: string, kind: EveValueKind, value: number): boolean {
    if (this.mode === 'pollOnly') {
      return false;
    }
    if (this.mode === 'live') {
      this.stats.eveSent++;
      return true;
    }

    const now = this.now();
    const prev = this.lastPushed.get(key);
    if (prev !== undefined) {
      const threshold = kind === 'watts'
        ? Math.max(this.config.minChangeWatts, (this.config.minChangePercent / 100) * Math.abs(prev.value))
        : this.config.minChangeKwh;
      // Small tolerance so float subtraction (1000.01 - 1000 = 0.00999…) still meets the threshold.
      const changedEnough = Math.abs(value - prev.value) + 1e-9 >= threshold;
      const heartbeatDue = now - prev.time >= EVE_HEARTBEAT_MS;
      if (!changedEnough && !heartbeatDue) {
        this.stats.eveSuppressed++;
        this.debug(
          `Eve update suppressed: ${key} ${value} (last pushed ${prev.value} ` +
          `${Math.round((now - prev.time) / 1000)}s ago, threshold ${threshold})`,
        );
        return false;
      }
    }

    // First value (startup) is always pushed.
    this.lastPushed.set(key, { value, time: now });
    this.stats.eveSent++;
    return true;
  }
}

// A HomeKit On switch derived from a power reading.
export class PowerSwitch {
  private reported: boolean | undefined;
  private pending: { state: boolean; since: number } | null = null;

  constructor(
    private readonly name: string,
    private readonly holdMs: number,
    private readonly stats: UpdateStats = new UpdateStats(),
    private readonly debug: DebugLog = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  // Reported state; false before the first reading.
  get isOn(): boolean {
    return this.reported ?? false;
  }

  // Feeds a new power reading and returns the (possibly unchanged) reported state.
  update(powerW: number): boolean {
    const now = this.now();

    if (this.reported === undefined) {
      // Startup: report the current state immediately, no hold.
      this.reported = powerW > SWITCH_ON_ABOVE_W;
      return this.reported;
    }

    // Deadband: what the state should be, judged against the reported state.
    const target = this.reported ? !(powerW < SWITCH_OFF_BELOW_W) : powerW > SWITCH_ON_ABOVE_W;

    if (target === this.reported) {
      if (this.pending) {
        this.stats.switchHeld++;
        this.debug(`${this.name} switch: change to ${this.pending.state ? 'on' : 'off'} cancelled after ` +
          `${Math.round((now - this.pending.since) / 1000)}s (power ${powerW}W)`);
        this.pending = null;
      }
      return this.reported;
    }

    if (!this.pending) {
      this.pending = { state: target, since: now };
    }
    const heldMs = now - this.pending.since;
    if (heldMs >= this.holdMs) {
      this.reported = target;
      this.pending = null;
      this.stats.switchReported++;
      return this.reported;
    }

    this.debug(`${this.name} switch: holding change to ${target ? 'on' : 'off'} ` +
      `(${Math.round(heldMs / 1000)}s of ${Math.round(this.holdMs / 1000)}s, power ${powerW}W)`);
    return this.reported;
  }
}
