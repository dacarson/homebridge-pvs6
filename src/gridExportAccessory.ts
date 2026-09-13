import { PlatformAccessory, Service } from 'homebridge';
import { PVS6Platform } from './platform';
import { PVS6Reading } from './pvs6Client';
import { EVE_ENERGY_SERVICE_UUID } from './eveCharacteristics';
import { MatterEnergyBridge } from './matterEnergy';

export class GridExportAccessory {
  private readonly service: Service;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly historyService: any;

  private lastPowerW = 0;
  private lastEnergyKWh = 0;

  // Optional: publishes this meter over Matter for the Apple Home Energy
  // view. Null when the "matter" config option is off; also cleared when the
  // Homebridge build doesn't support it. See matterEnergy.ts.
  private matter: MatterEnergyBridge | null = null;

  constructor(
    private readonly platform: PVS6Platform,
    accessory: PlatformAccessory,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FakeGatoHistoryService: any,
    displayName: string,
    serialNumber: string,
    matterEnabled = false,
  ) {
    const { Characteristic } = platform;
    const { EveWatts, EveKWh } = platform.eveChars;

    const infoService =
      accessory.getService(platform.Service.AccessoryInformation) ??
      accessory.addService(platform.Service.AccessoryInformation);

    infoService
      .setCharacteristic(Characteristic.Manufacturer, 'SunStrong')
      .setCharacteristic(Characteristic.Model, 'PVS6')
      .setCharacteristic(Characteristic.SerialNumber, `${serialNumber}-grid-export`);

    const existingService = accessory.services.find(s => s.UUID === EVE_ENERGY_SERVICE_UUID);
    this.service = existingService ??
      accessory.addService(new platform.api.hap.Service(displayName, EVE_ENERGY_SERVICE_UUID));

    this.service.setCharacteristic(Characteristic.Name, displayName);

    // On = true when exporting (lastPowerW > 0); always non-negative so the comparison is natural.
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
      // Grid export flows out of the meter — reported as exported energy.
      const bridge = new MatterEnergyBridge(platform.api, platform.log, 'exported');
      if (bridge.isSupported()) {
        this.matter = bridge;
        bridge.register(`${serialNumber}-grid-export`, displayName, `${serialNumber}-grid-export`, {
          powerW: this.lastPowerW,
          energyKWh: this.lastEnergyKWh,
        }).catch(() => {});
      } else {
        platform.log.info('[matter] Config option "matter" is enabled, but the Matter API is unavailable. It needs a Homebridge build with the ElectricalSensor device type, with Matter enabled on this plugin\'s child bridge. Continuing with HomeKit/Eve only.');
      }
    }
  }

  updateValues(reading: PVS6Reading): void {
    const { Characteristic } = this.platform;
    const { EveWatts, EveKWh } = this.platform.eveChars;

    // Non-negative: positive when net-exporting, zero when importing.
    this.lastPowerW = Math.max(0, -reading.netPowerW);
    this.lastEnergyKWh = reading.gridExportKWh;

    this.service.updateCharacteristic(Characteristic.On, this.lastPowerW > 0);
    this.service.updateCharacteristic(Characteristic.OutletInUse, true);
    this.service.updateCharacteristic(EveWatts, this.lastPowerW);
    this.service.updateCharacteristic(EveKWh, this.lastEnergyKWh);

    this.historyService.addEntry({
      time: Math.round(Date.now() / 1000),
      power: this.lastPowerW,
    });

    this.matter?.update({ powerW: this.lastPowerW, energyKWh: this.lastEnergyKWh }).catch(() => {});

    this.platform.log.debug(`Grid Export: ${this.lastPowerW}W  ${this.lastEnergyKWh}kWh`);
  }
}
