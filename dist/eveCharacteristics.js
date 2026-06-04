"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVE_VOLT_UUID = exports.EVE_KWH_UUID = exports.EVE_WATT_UUID = void 0;
exports.createEveCharacteristics = createEveCharacteristics;
exports.EVE_WATT_UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52';
exports.EVE_KWH_UUID = 'E863F10C-079E-48FF-8F27-9C2605A29F52';
exports.EVE_VOLT_UUID = 'E863F10A-079E-48FF-8F27-9C2605A29F52';
function createEveCharacteristics(api) {
    const { hap } = api;
    class EveWatts extends hap.Characteristic {
        constructor() {
            super('Eve Watts', EveWatts.UUID, {
                format: "float" /* Formats.FLOAT */,
                unit: 'W',
                minValue: -100000,
                maxValue: 100000,
                minStep: 0.1,
                perms: ["pr" /* Perms.PAIRED_READ */, "ev" /* Perms.NOTIFY */],
            });
            this.value = this.getDefaultValue();
        }
    }
    EveWatts.UUID = exports.EVE_WATT_UUID;
    class EveKWh extends hap.Characteristic {
        constructor() {
            super('Eve kWh', EveKWh.UUID, {
                format: "float" /* Formats.FLOAT */,
                unit: 'kWh',
                minValue: 0,
                maxValue: 1000000,
                minStep: 0.001,
                perms: ["pr" /* Perms.PAIRED_READ */, "ev" /* Perms.NOTIFY */],
            });
            this.value = this.getDefaultValue();
        }
    }
    EveKWh.UUID = exports.EVE_KWH_UUID;
    // EVE_VOLT_UUID (E863F10A) is the Volt characteristic UUID.
    // It is NOT used as a service UUID — the container is the standard Outlet service.
    class EveVoltage extends hap.Characteristic {
        constructor() {
            super('Eve Voltage', EveVoltage.UUID, {
                format: "float" /* Formats.FLOAT */,
                unit: 'V',
                minValue: 0,
                maxValue: 400,
                minStep: 0.1,
                perms: ["pr" /* Perms.PAIRED_READ */, "ev" /* Perms.NOTIFY */],
            });
            this.value = this.getDefaultValue();
        }
    }
    EveVoltage.UUID = exports.EVE_VOLT_UUID;
    return {
        EveWatts: EveWatts,
        EveKWh: EveKWh,
        EveVoltage: EveVoltage,
    };
}
//# sourceMappingURL=eveCharacteristics.js.map