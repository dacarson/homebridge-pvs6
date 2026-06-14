import { PlatformAccessory, Service } from 'homebridge';
import { PVS6Platform } from './platform';
import { PVS6Reading } from './pvs6Client';
import { EVE_ENERGY_SERVICE_UUID } from './eveCharacteristics';

export class HomeConsumptionAccessory {
  private readonly service: Service;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly historyService: any;

  private lastPowerW = 0;
  private lastEnergyKWh = 0;

  constructor(
    private readonly platform: PVS6Platform,
    accessory: PlatformAccessory,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FakeGatoHistoryService: any,
    displayName: string,
    serialNumber: string,
  ) {
    const { Characteristic } = platform;
    const { EveWatts, EveKWh } = platform.eveChars;

    const infoService =
      accessory.getService(platform.Service.AccessoryInformation) ??
      accessory.addService(platform.Service.AccessoryInformation);

    infoService
      .setCharacteristic(Characteristic.Manufacturer, 'SunStrong')
      .setCharacteristic(Characteristic.Model, 'PVS6')
      .setCharacteristic(Characteristic.SerialNumber, `${serialNumber}-home`);

    const existingService = accessory.services.find(s => s.UUID === EVE_ENERGY_SERVICE_UUID);
    this.service = existingService ??
      accessory.addService(new platform.api.hap.Service(displayName, EVE_ENERGY_SERVICE_UUID));

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
  }

  updateValues(reading: PVS6Reading): void {
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

    this.platform.log.debug(`Home Consumption: ${this.lastPowerW}W  ${this.lastEnergyKWh.toFixed(3)}kWh`);
  }
}
