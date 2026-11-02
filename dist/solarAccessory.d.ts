import { PlatformAccessory } from 'homebridge';
import { PVS6Platform } from './platform';
import { PVS6Reading } from './pvs6Client';
export declare class SolarAccessory {
    private readonly platform;
    private readonly service;
    private readonly historyService;
    private lastPowerW;
    private lastEnergyKWh;
    private readonly onHysteresis;
    private matter;
    constructor(platform: PVS6Platform, accessory: PlatformAccessory, FakeGatoHistoryService: any, displayName: string, serialNumber: string, matterEnabled?: boolean);
    private isOn;
    updateValues(reading: PVS6Reading): void;
}
//# sourceMappingURL=solarAccessory.d.ts.map