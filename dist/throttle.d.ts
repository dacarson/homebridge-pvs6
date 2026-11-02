export interface ThrottleConfig {
    enabled: boolean;
    minChangeWatts: number;
    minChangePercent: number;
    maxIntervalSeconds: number;
}
export declare const DEFAULT_THROTTLE_CONFIG: ThrottleConfig;
export declare function resolveThrottleConfig(raw: {
    throttleUpdates?: unknown;
    minChangeWatts?: unknown;
    minChangePercent?: unknown;
    maxIntervalSeconds?: unknown;
}): ThrottleConfig;
type DebugLog = (message: string) => void;
export declare class PowerThrottle {
    readonly config: ThrottleConfig;
    private readonly debug;
    private readonly now;
    private readonly lastSent;
    private sentCount;
    private suppressedCount;
    constructor(config: ThrottleConfig, debug?: DebugLog, now?: () => number);
    get enabled(): boolean;
    shouldSend(key: string, value: number): boolean;
    takeStats(): {
        sent: number;
        suppressed: number;
    };
}
export declare class SolarOnHysteresis {
    private readonly onAboveW;
    private readonly offBelowW;
    private readonly minHoldMs;
    private readonly now;
    private state;
    private lastChange;
    constructor(onAboveW?: number, offBelowW?: number, minHoldMs?: number, now?: () => number);
    get isOn(): boolean;
    update(powerW: number): boolean;
}
export {};
//# sourceMappingURL=throttle.d.ts.map