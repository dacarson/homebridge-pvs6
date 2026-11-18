export declare const EVE_HISTORY_INTERVAL_MS: number;
export declare const EVE_HISTORY_MAX_POWER_W = 6553.5;
export declare const EVE_HISTORY_MAX_GAP_MS: number;
export interface EveHistoryEntry {
    /** Power to store in Eve history, capped at EVE_HISTORY_MAX_POWER_W. */
    powerW: number;
    /** The uncapped time-weighted average over the window. */
    averageW: number;
}
export declare class EveEnergyHistory {
    private readonly maxGapMs;
    private energyWs;
    private lastPowerW;
    private lastSampleMs;
    private windowStartMs;
    constructor(maxGapMs?: number);
    /** Call on every reading. */
    sample(powerW: number, nowMs: number): void;
    /** Call every EVE_HISTORY_INTERVAL_MS; returns the entry for the window that just ended. */
    flush(nowMs: number): EveHistoryEntry;
    private integrateTo;
}
/** The part of FakeGatoHistoryService this plugin uses. */
export interface EnergyHistoryService {
    addEntry(entry: {
        time: number;
        power: number;
    }): void;
}
/**
 * Feeds one accessory's fakegato 'energy' history. Create the fakegato
 * service with `disableTimer: true`, call sample() on every reading and
 * record() every EVE_HISTORY_INTERVAL_MS.
 */
export declare class EveHistoryRecorder {
    private readonly service;
    private readonly name;
    private readonly log;
    private readonly history;
    private capWarned;
    constructor(service: EnergyHistoryService, name: string, log: {
        info(msg: string): void;
    }, maxGapMs?: number);
    sample(powerW: number, nowMs?: number): void;
    record(nowMs?: number): EveHistoryEntry;
}
/** Longest gap to credit, given the poll interval: two polls, and at least EVE_HISTORY_MAX_GAP_MS. */
export declare function historyMaxGapMs(pollIntervalMs: number): number;
//# sourceMappingURL=eveHistory.d.ts.map