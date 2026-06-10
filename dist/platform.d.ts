import { API, Characteristic, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { EveChars } from './eveCharacteristics';
export declare class PVS6Platform implements DynamicPlatformPlugin {
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    readonly api: API;
    readonly eveChars: EveChars;
    readonly log: Logger;
    readonly accessories: PlatformAccessory[];
    private client;
    private readonly config;
    private readonly pollIntervalMs;
    private solarAccessory?;
    private gridImportAccessory?;
    private gridExportAccessory?;
    private pollTimer?;
    private pollInFlight;
    private backedOff;
    private authGeneration;
    private lastSuccessfulPollTime;
    private rediscovering;
    constructor(log: Logger, config: PlatformConfig, api: API);
    configureAccessory(accessory: PlatformAccessory): void;
    private resolveConfig;
    private setupAccessories;
    private getOrCreateAccessory;
    private get discoveryEnabled();
    private checkRediscovery;
    private triggerRediscovery;
    private stopPolling;
    private startAuthAndPolling;
    private startPolling;
    private enterBackoff;
}
//# sourceMappingURL=platform.d.ts.map