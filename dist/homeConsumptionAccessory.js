"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeConsumptionAccessory = void 0;
const eveCharacteristics_1 = require("./eveCharacteristics");
const matterEnergy_1 = require("./matterEnergy");
class HomeConsumptionAccessory {
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
        const { EveWatts, EveKWh } = platform.eveChars;
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
        // On = true when site is drawing power (always true in practice).
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
        if (matterEnabled) {
            // Home consumption flows into the meter — reported as imported energy.
            const bridge = new matterEnergy_1.MatterEnergyBridge(platform.api, platform.log, 'imported');
            if (bridge.isSupported()) {
                this.matter = bridge;
                bridge.register(`${serialNumber}-home`, displayName, `${serialNumber}-home`, {
                    powerW: this.lastPowerW,
                    importedEnergyKWh: this.lastEnergyKWh,
                }).catch(() => { });
            }
            else {
                platform.log.info('[matter] Config option "matter" is enabled, but the Matter API is unavailable. It needs a Homebridge build with the ElectricalSensor device type, with Matter enabled on this plugin\'s child bridge. Continuing with HomeKit/Eve only.');
            }
        }
    }
    updateValues(reading) {
        const { Characteristic } = this.platform;
        const { EveWatts, EveKWh } = this.platform.eveChars;
        this.lastPowerW = reading.siteLoadPowerW;
        this.lastEnergyKWh = reading.homeConsumptionKWh;
        this.service.updateCharacteristic(Characteristic.On, this.lastPowerW > 0);
        this.service.updateCharacteristic(Characteristic.OutletInUse, true);
        this.service.updateCharacteristic(EveWatts, this.lastPowerW);
        this.service.updateCharacteristic(EveKWh, this.lastEnergyKWh);
        this.historyService.addEntry({
            time: Math.round(Date.now() / 1000),
            power: this.lastPowerW,
        });
        this.matter?.update({ powerW: this.lastPowerW, importedEnergyKWh: this.lastEnergyKWh }).catch(() => { });
        this.platform.log.debug(`Home Consumption: ${this.lastPowerW}W  ${this.lastEnergyKWh.toFixed(3)}kWh`);
    }
}
exports.HomeConsumptionAccessory = HomeConsumptionAccessory;
//# sourceMappingURL=homeConsumptionAccessory.js.map