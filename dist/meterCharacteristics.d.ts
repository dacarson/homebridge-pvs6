import { PlatformAccessory, Service } from 'homebridge';
import type { PVS6Platform } from './platform';
export declare function applyEvePerms(accessory: PlatformAccessory, notify: boolean): void;
export declare class MeterCharacteristics {
    private readonly platform;
    private readonly service;
    private readonly key;
    private powerW;
    private energyKWh;
    private readonly onSwitch;
    constructor(platform: PVS6Platform, accessory: PlatformAccessory, service: Service, key: string, label: string);
    get isOn(): boolean;
    update(powerW: number, energyKWh: number): void;
}
//# sourceMappingURL=meterCharacteristics.d.ts.map