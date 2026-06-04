import { PlatformAccessory } from 'homebridge';
import { PVS6Platform } from './platform';
import { PVS6Reading } from './pvs6Client';
export declare class GridImportAccessory {
    private readonly platform;
    private readonly service;
    private readonly historyService;
    private lastPowerW;
    private lastEnergyKWh;
    constructor(platform: PVS6Platform, accessory: PlatformAccessory, FakeGatoHistoryService: any, displayName: string, serialNumber: string);
    updateValues(reading: PVS6Reading): void;
}
//# sourceMappingURL=gridImportAccessory.d.ts.map