export declare const CUMULATIVE_HEARTBEAT_MS: number;
export declare const PERIODIC_PERIOD_MS: number;
export type EnergyKind = 'imported' | 'exported';
/** Matter's EnergyMeasurementStruct: energy in mWh, timestamps in Unix seconds. */
export interface EnergyStruct {
    energy: number;
    startTimestamp?: number;
    endTimestamp?: number;
}
export interface EnergyClusterFragment {
    cumulativeEnergyImported?: EnergyStruct;
    periodicEnergyImported?: EnergyStruct;
    cumulativeEnergyExported?: EnergyStruct;
    periodicEnergyExported?: EnergyStruct;
}
/** Matter expresses energy in milliwatt-hours; PVS6 readings are in kWh. */
export declare function kWhToMilliWh(value: number): number;
export declare class EnergyEventScheduler {
    private readonly kinds;
    private readonly now;
    private lastCumulativeMilliWh;
    private lastCumulativeTime;
    private previousKWh;
    private accumulatedKWh;
    private idle;
    private periodStart;
    constructor(kinds: readonly EnergyKind[], now?: () => number);
    /**
     * Feed the latest lifetime readings (kWh, one per direction this meter
     * reports). Returns the cluster fields to send, or null if nothing is due.
     */
    next(readingsKWh: Partial<Record<EnergyKind, number>>): EnergyClusterFragment | null;
}
//# sourceMappingURL=energyEvents.d.ts.map