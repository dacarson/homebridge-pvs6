import { Logger } from 'homebridge';
export interface PVS6Reading {
    pvPowerW: number;
    pvEnergyKWh: number;
    netPowerW: number;
    gridImportKWh: number;
    gridExportKWh: number;
}
export declare class HttpError extends Error {
    readonly statusCode: number;
    constructor(statusCode: number, message: string);
}
export declare class PVS6Client {
    private readonly host;
    private readonly serialNumber;
    private readonly log;
    private sessionCookie;
    private livedataCacheId;
    private mdataCacheId;
    private consumptionMeterIdx;
    private lastRequestTime;
    private lastReading;
    private static readonly MIN_INTERVAL_MS;
    private static readonly TIMEOUT_MS;
    constructor(host: string, serialNumber: string, log: Logger);
    private get password();
    authenticate(): Promise<void>;
    poll(): Promise<PVS6Reading>;
    private fetchCache;
    private parseReading;
    private discoverMeters;
    private num;
    private rawRequest;
}
//# sourceMappingURL=pvs6Client.d.ts.map