"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolarAccessory = void 0;
const eveCharacteristics_1 = require("./eveCharacteristics");
const matterEnergy_1 = require("./matterEnergy");
// EXPERIMENTAL SPIKE — see notes below and in matterEnergy.ts. Not intended
// to ship: this imports matter.js directly from our own pinned @matter/main
// dependency, which is a *different module instance* than the one bundled
// and lazy-loaded internally by Homebridge's own Matter server. The point of
// this spike is to find out empirically whether that's actually a problem.
// The version pinned in package.json MUST match the @matter/main version
// your target Homebridge install uses internally, or this experiment
// conflates "different module instance" with "different library version".
const solar_power_1 = require("@matter/main/devices/solar-power");
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
        if (matterEnabled) {
            // Solar production flows out of the meter — reported as exported energy.
            // SPIKE: pass SolarPowerDevice directly instead of relying on
            // api.matter.deviceTypes.ElectricalSensor, since Homebridge doesn't
            // expose a Solar-specific device type yet even though matter.js does.
            const bridge = new matterEnergy_1.MatterEnergyBridge(platform.api, platform.log, 'exported', solar_power_1.SolarPowerDevice);
            if (bridge.isSupported()) {
                this.matter = bridge;
                bridge.register(`${serialNumber}-solar`, displayName, `${serialNumber}-solar`, {
                    powerW: this.lastPowerW,
                    energyKWh: this.lastEnergyKWh,
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
        this.matter?.update({ powerW: this.lastPowerW, energyKWh: this.lastEnergyKWh }).catch(() => { });
        this.platform.log.debug(`Solar: ${this.lastPowerW}W  ${this.lastEnergyKWh}kWh`);
    }
}
exports.SolarAccessory = SolarAccessory;
//# sourceMappingURL=solarAccessory.js.map