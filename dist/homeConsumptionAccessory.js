"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeConsumptionAccessory = void 0;
const eveCharacteristics_1 = require("./eveCharacteristics");
const meterCharacteristics_1 = require("./meterCharacteristics");
class HomeConsumptionAccessory {
    constructor(platform, accessory, 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FakeGatoHistoryService, displayName, serialNumber) {
        this.platform = platform;
        this.lastPowerW = 0;
        this.lastEnergyKWh = 0;
        const { Characteristic } = platform;
        const infoService = accessory.getService(platform.Service.AccessoryInformation) ??
            accessory.addService(platform.Service.AccessoryInformation);
        infoService
            .setCharacteristic(Characteristic.Manufacturer, 'SunStrong')
            .setCharacteristic(Characteristic.Model, 'PVS6')
            .setCharacteristic(Characteristic.SerialNumber, `${serialNumber}-home`);
        const existingService = accessory.services.find(s => s.UUID === eveCharacteristics_1.EVE_ENERGY_SERVICE_UUID);
        this.service = existingService ??
            accessory.addService(new platform.api.hap.Service(displayName, eveCharacteristics_1.EVE_ENERGY_SERVICE_UUID));
        this.service.setCharacteristic(Characteristic.Name, displayName);
        // On (power-derived, with deadband + hold), OutletInUse, Eve Watts, Eve kWh.
        this.meter = new meterCharacteristics_1.MeterCharacteristics(platform, accessory, this.service, 'home', displayName);
        this.historyService = new FakeGatoHistoryService('energy', accessory, { storage: 'fs' });
    }
    updateValues(reading) {
        this.lastPowerW = reading.siteLoadPowerW;
        this.lastEnergyKWh = reading.homeConsumptionKWh;
        this.meter.update(this.lastPowerW, this.lastEnergyKWh);
        this.historyService.addEntry({
            time: Math.round(Date.now() / 1000),
            power: this.lastPowerW,
        });
        this.platform.log.debug(`Home Consumption: ${this.lastPowerW}W  ${this.lastEnergyKWh.toFixed(3)}kWh`);
    }
}
exports.HomeConsumptionAccessory = HomeConsumptionAccessory;
//# sourceMappingURL=homeConsumptionAccessory.js.map