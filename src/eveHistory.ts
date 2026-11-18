// Eve Energy history (fakegato-history 'energy' type).
//
// Two quirks of Eve's history format drive this design (see
// docs/eve-energy-history.md for how they were worked out):
//
// 1. Power is stored as a uint16 of watts × 10, so anything above 6553.5 W
//    wraps around silently (9183 W is stored as ~2630 W). We cap it instead.
// 2. Eve calculates an entry's energy as
//    power × min(time since the previous entry, 600 s). Writing an entry on
//    every poll gains nothing and fills fakegato's 4032-entry buffer in hours.
//
// So each accessory writes one entry every 10 minutes, holding the average
// power over that window weighted by time, capped at 6553.5 W.

export const EVE_HISTORY_INTERVAL_MS = 10 * 60 * 1000;
export const EVE_HISTORY_MAX_POWER_W = 6553.5; // uint16 / 10
// Gaps between samples longer than this are not credited, so an outage
// doesn't carry the last reading forward.
export const EVE_HISTORY_MAX_GAP_MS = 2 * 60 * 1000;

export interface EveHistoryEntry {
  /** Power to store in Eve history, capped at EVE_HISTORY_MAX_POWER_W. */
  powerW: number;
  /** The uncapped time-weighted average over the window. */
  averageW: number;
}

export class EveEnergyHistory {
  private energyWs = 0;
  private lastPowerW = 0;
  private lastSampleMs: number | null = null;
  private windowStartMs: number | null = null;

  constructor(private readonly maxGapMs = EVE_HISTORY_MAX_GAP_MS) {}

  /** Call on every reading. */
  sample(powerW: number, nowMs: number): void {
    this.integrateTo(nowMs);
    this.lastPowerW = Number.isFinite(powerW) && powerW > 0 ? powerW : 0;
  }

  /** Call every EVE_HISTORY_INTERVAL_MS; returns the entry for the window that just ended. */
  flush(nowMs: number): EveHistoryEntry {
    this.integrateTo(nowMs);
    const seconds = (nowMs - (this.windowStartMs ?? nowMs)) / 1000;
    const average = seconds > 0 ? this.energyWs / seconds : 0;
    this.energyWs = 0;
    this.windowStartMs = nowMs;
    const averageW = Math.round(average * 10) / 10;
    return { powerW: Math.min(EVE_HISTORY_MAX_POWER_W, averageW), averageW };
  }

  private integrateTo(nowMs: number): void {
    if (this.windowStartMs === null) {
      this.windowStartMs = nowMs;
    }
    if (this.lastSampleMs !== null && nowMs > this.lastSampleMs) {
      const dt = Math.min(nowMs - this.lastSampleMs, this.maxGapMs);
      this.energyWs += this.lastPowerW * dt / 1000;
    }
    if (this.lastSampleMs === null || nowMs > this.lastSampleMs) {
      this.lastSampleMs = nowMs;
    }
  }
}

/** The part of FakeGatoHistoryService this plugin uses. */
export interface EnergyHistoryService {
  addEntry(entry: { time: number; power: number }): void;
}

/**
 * Feeds one accessory's fakegato 'energy' history. Create the fakegato
 * service with `disableTimer: true`, call sample() on every reading and
 * record() every EVE_HISTORY_INTERVAL_MS.
 */
export class EveHistoryRecorder {
  private readonly history: EveEnergyHistory;
  private capWarned = false;

  constructor(
    private readonly service: EnergyHistoryService,
    private readonly name: string,
    private readonly log: { info(msg: string): void },
    maxGapMs = EVE_HISTORY_MAX_GAP_MS,
  ) {
    this.history = new EveEnergyHistory(maxGapMs);
  }

  sample(powerW: number, nowMs = Date.now()): void {
    this.history.sample(powerW, nowMs);
  }

  record(nowMs = Date.now()): EveHistoryEntry {
    const entry = this.history.flush(nowMs);
    this.service.addEntry({ time: Math.round(nowMs / 1000), power: entry.powerW });
    if (entry.averageW > entry.powerW && !this.capWarned) {
      this.capWarned = true;
      this.log.info(
        `${this.name}: averaged ${entry.averageW} W over 10 minutes; Eve history can only store up to ` +
        `${EVE_HISTORY_MAX_POWER_W} W, so it is capped there. Live Watts and kWh are not capped.`,
      );
    }
    return entry;
  }
}

/** Longest gap to credit, given the poll interval: two polls, and at least EVE_HISTORY_MAX_GAP_MS. */
export function historyMaxGapMs(pollIntervalMs: number): number {
  return Math.max(EVE_HISTORY_MAX_GAP_MS, 2 * pollIntervalMs + 5_000);
}
