"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GridImportAccessory = void 0;
const eveCharacteristics_1 = require("./eveCharacteristics");
class GridImportAccessory {
    constructor(platform, accessory, 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FakeGatoHistoryService, displayName, serialNumber) {
        this.platform = platform;
        this.lastPowerW = 0;
        this.lastEnergyKWh = 0;
        const { Characteristic } = platform;
        const { EveWatts, EveKWh } = platform.eveChars;
        const infoService = accessory.getService(platform.Service.AccessoryInformation) ??
            accessory.addService(platform.Service.AccessoryInformation);
        infoService
            .setCharacteristic(Characteristic.Manufacturer, 'SunStrong')
            .setCharacteristic(Characteristic.Model, 'PVS6')
            .setCharacteristic(Characteristic.SerialNumber, `${serialNumber}-grid`);
        const existingService = accessory.services.find(s => s.UUID === eveCharacteristics_1.EVE_ENERGY_SERVICE_UUID);
        this.service = existingService ??
            accessory.addService(new platform.api.hap.Service(displayName, eveCharacteristics_1.EVE_ENERGY_SERVICE_UUID));
        this.service.setCharacteristic(Characteristic.Name, displayName);
        // On = true when importing (lastPowerW > 0); always non-negative so the comparison is natural.
        this.service
            .getCharacteristic(Characteristic.On)
            .onGet(() => this.lastPowerW > 0)
            .onSet(async () => {
            this.service.updateCharacteristic(Characteristic.On, this.lastPowerW > 0);
        });
        this.service
            .getCharacteristic(Characteristic.OutletInUse)
            .onGet(() => true);
        this.service
            .getCharacteristic(EveWatts)
            .onGet(() => this.lastPowerW);
        this.service
            .getCharacteristic(EveKWh)
            .onGet(() => this.lastEnergyKWh);
        this.historyService = new FakeGatoHistoryService('energy', accessory, { storage: 'fs' });
    }
    updateValues(reading) {
        const { Characteristic } = this.platform;
        const { EveWatts, EveKWh } = this.platform.eveChars;
        // Non-negative: zero when net-exporting, positive when importing.
        this.lastPowerW = Math.max(0, reading.netPowerW);
        this.lastEnergyKWh = reading.gridImportKWh;
        this.service.updateCharacteristic(Characteristic.On, this.lastPowerW > 0);
        this.service.updateCharacteristic(Characteristic.OutletInUse, true);
        this.service.updateCharacteristic(EveWatts, this.lastPowerW);
        this.service.updateCharacteristic(EveKWh, this.lastEnergyKWh);
        this.historyService.addEntry({
            time: Math.round(Date.now() / 1000),
            power: this.lastPowerW,
        });
        this.platform.log.debug(`Grid Import: ${this.lastPowerW}W  ${this.lastEnergyKWh}kWh`);
    }
}
exports.GridImportAccessory = GridImportAccessory;
//# sourceMappingURL=gridImportAccessory.js.map