import { Perms, PlatformAccessory, Service } from 'homebridge';
import type { PVS6Platform } from './platform';
import { EVE_ENERGY_SERVICE_UUID, EVE_KWH_UUID, EVE_WATT_UUID } from './eveCharacteristics';
import { PowerSwitch } from './throttle';

// Sets NOTIFY on the Eve power/energy characteristics according to the
// evePowerUpdates mode (removed for pollOnly, present otherwise). Called from
// configureAccessory() for cached accessories, so the perms are right before
// the bridge is published, and again when an accessory is set up.
export function applyEvePerms(accessory: PlatformAccessory, notify: boolean): void {
  const perms = notify ? [Perms.PAIRED_READ, Perms.NOTIFY] : [Perms.PAIRED_READ];
  const service = accessory.services.find(s => s.UUID === EVE_ENERGY_SERVICE_UUID);
  for (const c of service?.characteristics ?? []) {
    if (c.UUID === EVE_WATT_UUID || c.UUID === EVE_KWH_UUID) {
      c.setProps({ perms });
    }
  }
}

// The On / OutletInUse / Eve Watts / Eve kWh characteristics shared by every
// meter accessory. Holds the newest reading (served by onGet in every mode)
// and decides what to push via the platform's EveUpdatePolicy and a
// per-accessory PowerSwitch.
export class MeterCharacteristics {
  private powerW = 0;
  private energyKWh = 0;
  private readonly onSwitch: PowerSwitch;

  constructor(
    private readonly platform: PVS6Platform,
    accessory: PlatformAccessory,
    private readonly service: Service,
    private readonly key: string,
    label: string,
  ) {
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

  get isOn(): boolean {
    return this.onSwitch.isOn;
  }

  update(powerW: number, energyKWh: number): void {
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
