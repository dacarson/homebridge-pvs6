"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MeterCharacteristics = void 0;
exports.applyEvePerms = applyEvePerms;
const eveCharacteristics_1 = require("./eveCharacteristics");
// Sets NOTIFY on the Eve power/energy characteristics according to the
// evePowerUpdates mode (removed for pollOnly, present otherwise). Called from
// configureAccessory() for cached accessories, so the perms are right before
// the bridge is published, and again when an accessory is set up.
function applyEvePerms(accessory, notify) {
    const perms = notify ? ["pr" /* Perms.PAIRED_READ */, "ev" /* Perms.NOTIFY */] : ["pr" /* Perms.PAIRED_READ */];
    const service = accessory.services.find(s => s.UUID === eveCharacteristics_1.EVE_ENERGY_SERVICE_UUID);
    for (const c of service?.characteristics ?? []) {
        if (c.UUID === eveCharacteristics_1.EVE_WATT_UUID || c.UUID === eveCharacteristics_1.EVE_KWH_UUID) {
            c.setProps({ perms });
        }
    }
}
// The On / OutletInUse / Eve Watts / Eve kWh characteristics shared by every
// meter accessory. Holds the newest reading (served by onGet in every mode)
// and decides what to push via the platform's EveUpdatePolicy and a
// per-accessory PowerSwitch.
class MeterCharacteristics {
    constructor(platform, accessory, service, key, label) {
        this.platform = platform;
        this.service = service;
        this.key = key;
        this.powerW = 0;
        this.energyKWh = 0;
        const { Characteristic: C } = platform;
        const { EveWatts, EveKWh } = platform.eveChars;
        this.onSwitch = platform.createPowerSwitch(label);
        // On is read/write in HAP; the setter reverts to the reported state immediately.
        service
            .getCharacteristic(C.On)
            .onGet(() => this.onSwitch.isOn)
            .onSet(async () => {
            service.updateCharacteristic(C.On, this.onSwitch.isOn);
        });
        // OutletInUse is required for Eve Energy to render correctly
        service
            .getCharacteristic(C.OutletInUse)
            .onGet(() => true);
        // Eve custom characteristics — getCharacteristic() is idempotent across restarts.
        // Reads always return the newest reading, whatever was last pushed.
        service.getCharacteristic(EveWatts).onGet(() => this.powerW);
        service.getCharacteristic(EveKWh).onGet(() => this.energyKWh);
        applyEvePerms(accessory, platform.evePolicy.notify);
    }
    get isOn() {
        return this.onSwitch.isOn;
    }
    update(powerW, energyKWh) {
        const { Characteristic: C } = this.platform;
        const { EveWatts, EveKWh } = this.platform.eveChars;
        const policy = this.platform.evePolicy;
        this.powerW = powerW;
        this.energyKWh = energyKWh;
        // Standard characteristics stay evented (HAP only sends an event when the value changes).
        this.service.updateCharacteristic(C.On, this.onSwitch.update(powerW));
        this.service.updateCharacteristic(C.OutletInUse, true);
        if (policy.shouldPush(`${this.key}.watts`, 'watts', powerW)) {
            this.service.updateCharacteristic(EveWatts, powerW);
        }
        if (policy.shouldPush(`${this.key}.kwh`, 'kwh', energyKWh)) {
            this.service.updateCharacteristic(EveKWh, energyKWh);
        }
    }
}
exports.MeterCharacteristics = MeterCharacteristics;
//# sourceMappingURL=meterCharacteristics.js.map