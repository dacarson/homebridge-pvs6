"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolarAccessory = void 0;
const eveCharacteristics_1 = require("./eveCharacteristics");
const meterCharacteristics_1 = require("./meterCharacteristics");
const matterEnergy_1 = require("./matterEnergy");
class SolarAccessory {
    constructor(platform, accessory, 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FakeGatoHistoryService, displayName, serialNumber, matterEnabled = false) {
        this.platform = platform;
        this.lastPowerW = 0;
        this.lastEnergyKWh = 0;
        // Optional: publishes this meter over Matter for the Apple Home Energy
        // view. Null when the "matter" config option is off; also cleared when the
        // Homebridge build doesn't support it. See matterEnergy.ts.
        this.matter = null;
        const { Characteristic } = platform;
        const infoService = accessory.getService(platform.Service.AccessoryInformation) ??
            accessory.addService(platform.Service.AccessoryInformation);
        infoService
            .setCharacteristic(Characteristic.Manufacturer, 'SunStrong')
            .setCharacteristic(Characteristic.Model, 'PVS6')
            .setCharacteristic(Characteristic.SerialNumber, `${serialNumber}-solar`);
        const existingService = accessory.services.find(s => s.UUID === eveCharacteristics_1.EVE_ENERGY_SERVICE_UUID);
        this.service = existingService ??
            accessory.addService(new platform.api.hap.Service(displayName, eveCharacteristics_1.EVE_ENERGY_SERVICE_UUID));
        this.service.setCharacteristic(Characteristic.Name, displayName);
        // On (power-derived, with deadband + hold), OutletInUse, Eve Watts, Eve kWh.
        this.meter = new meterCharacteristics_1.MeterCharacteristics(platform, accessory, this.service, 'solar', displayName);
        // fakegato history — 'energy' type records { time, power } in Watts
        this.historyService = new FakeGatoHistoryService('energy', accessory, { storage: 'fs' });
        if (matterEnabled) {
            // Solar production flows out of the meter — reported as exported energy.
            // Matter's activePower sign convention is positive = drawing power,
            // negative = supplying it, so a generation-only meter like this one
            // must negate its (always non-negative) wattage for Matter.
            const bridge = new matterEnergy_1.MatterEnergyBridge(platform.api, platform.log, 'exported');
            if (bridge.isSupported()) {
                this.matter = bridge;
                bridge.register(`${serialNumber}-solar`, displayName, `${serialNumber}-solar`, {
                    powerW: -this.lastPowerW,
                    exportedEnergyKWh: this.lastEnergyKWh,
                }).catch(() => { });
            }
            else {
                platform.log.info('[matter] Config option "matter" is enabled, but the Matter API is unavailable. It needs a Homebridge build with the ElectricalSensor device type, with Matter enabled on this plugin\'s child bridge. Continuing with HomeKit/Eve only.');
            }
        }
    }
    updateValues(reading) {
        this.lastPowerW = reading.pvPowerW;
        this.lastEnergyKWh = reading.pvEnergyKWh;
        this.meter.update(this.lastPowerW, this.lastEnergyKWh);
        this.historyService.addEntry({
            time: Math.round(Date.now() / 1000),
            power: this.lastPowerW,
        });
        this.matter?.update({ powerW: -this.lastPowerW, exportedEnergyKWh: this.lastEnergyKWh }).catch(() => { });
        this.platform.log.debug(`Solar: ${this.lastPowerW}W  ${this.lastEnergyKWh}kWh`);
    }
}
exports.SolarAccessory = SolarAccessory;
//# sourceMappingURL=solarAccessory.js.map