import { API, Characteristic, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { EveChars } from './eveCharacteristics';
export declare class PVS6Platform implements DynamicPlatformPlugin {
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    readonly api: API;
    readonly eveChars: EveChars;
    readonly log: Logger;
    readonly accessories: PlatformAccessory[];
    private readonly client;
    private readonly config;
    private readonly pollIntervalMs;
    private solarAccessory?;
    private gridImportAccessory?;
    private gridExportAccessory?;
    private pollTimer?;
    private pollInFlight;
    private backedOff;
    constructor(log: Logger, config: PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    private setupAccessories;
    private getOrCreateAccessory;
    private startAuthAndPolling;
    private startPolling;
    private enterBackoff;
}
//# sourceMappingURL=platform.d.ts.map