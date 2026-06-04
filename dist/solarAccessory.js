"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolarAccessory = void 0;
const eveCharacteristics_1 = require("./eveCharacteristics");
class SolarAccessory {
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
            .setCharacteristic(Characteristic.SerialNumber, `${serialNumber}-solar`);
        const existingService = accessory.services.find(s => s.UUID === eveCharacteristics_1.EVE_ENERGY_SERVICE_UUID);
        this.service = existingService ??
            accessory.addService(new platform.api.hap.Service(displayName, eveCharacteristics_1.EVE_ENERGY_SERVICE_UUID));
        this.service.setCharacteristic(Characteristic.Name, displayName);
        // On = true when solar is producing.
        // HAP's On is read/write; the setter reverts to the polled state immediately.
        this.service
            .getCharacteristic(Characteristic.On)
            .onGet(() => this.lastPowerW > 0)
            .onSet(async () => {
            this.service.updateCharacteristic(Characteristic.On, this.lastPowerW > 0);
        });
        // OutletInUse is required for Eve Energy to render correctly
        this.service
            .getCharacteristic(Characteristic.OutletInUse)
            .onGet(() => true);
        // Eve custom characteristics — getCharacteristic() is idempotent across restarts
        this.service
            .getCharacteristic(EveWatts)
            .onGet(() => this.lastPowerW);
        this.service
            .getCharacteristic(EveKWh)
            .onGet(() => this.lastEnergyKWh);
        // fakegato history — 'energy' type records { time, power } in Watts
        this.historyService = new FakeGatoHistoryService('energy', accessory, { storage: 'fs' });
    }
    updateValues(reading) {
        const { Characteristic } = this.platform;
        const { EveWatts, EveKWh } = this.platform.eveChars;
        this.lastPowerW = reading.pvPowerW;
        this.lastEnergyKWh = reading.pvEnergyKWh;
        this.service.updateCharacteristic(Characteristic.On, this.lastPowerW > 0);
        this.service.updateCharacteristic(Characteristic.OutletInUse, true);
        this.service.updateCharacteristic(EveWatts, this.lastPowerW);
        this.service.updateCharacteristic(EveKWh, this.lastEnergyKWh);
        this.historyService.addEntry({
            time: Math.round(Date.now() / 1000),
            power: this.lastPowerW,
        });
        this.platform.log.debug(`Solar: ${this.lastPowerW}W  ${this.lastEnergyKWh}kWh`);
    }
}
exports.SolarAccessory = SolarAccessory;
//# sourceMappingURL=solarAccessory.js.map