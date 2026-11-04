export type EvePowerUpdatesMode = 'throttled' | 'pollOnly' | 'live';
export declare const EVE_HEARTBEAT_MS: number;
export declare const SWITCH_ON_ABOVE_W = 50;
export declare const SWITCH_OFF_BELOW_W = 20;
export interface UpdateConfig {
    evePowerUpdates: EvePowerUpdatesMode;
    minChangeWatts: number;
    minChangePercent: number;
    minChangeKwh: number;
    switchHoldSeconds: number;
}
export declare const DEFAULT_UPDATE_CONFIG: UpdateConfig;
export declare function resolveUpdateConfig(raw: {
    evePowerUpdates?: unknown;
    minChangeWatts?: unknown;
    minChangePercent?: unknown;
    minChangeKwh?: unknown;
    switchHoldSeconds?: unknown;
}): UpdateConfig;
type DebugLog = (message: string) => void;
export declare class UpdateStats {
    eveSent: number;
    eveSuppressed: number;
    switchReported: number;
    switchHeld: number;
    takeSummary(): string;
}
export type EveValueKind = 'watts' | 'kwh';
export declare class EveUpdatePolicy {
    readonly config: UpdateConfig;
    private readonly stats;
    private readonly debug;
    private readonly now;
    private readonly lastPushed;
    constructor(config: UpdateConfig, stats?: UpdateStats, debug?: DebugLog, now?: () => number);
    get mode(): EvePowerUpdatesMode;
    get notify(): boolean;
    shouldPush(key: string, kind: EveValueKind, value: number): boolean;
}
export declare class PowerSwitch {
    private readonly name;
    private readonly holdMs;
    private readonly stats;
    private readonly debug;
    private readonly now;
    private reported;
    private pending;
    constructor(name: string, holdMs: number, stats?: UpdateStats, debug?: DebugLog, now?: () => number);
    get isOn(): boolean;
    update(powerW: number): boolean;
}
export {};
//# sourceMappingURL=throttle.d.ts.map