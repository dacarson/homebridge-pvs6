import { PlatformAccessory, Service } from 'homebridge';
import { PVS6Platform } from './platform';
import { PVS6Reading } from './pvs6Client';
import { EVE_ENERGY_SERVICE_UUID } from './eveCharacteristics';
import { MeterCharacteristics } from './meterCharacteristics';

export class HomeConsumptionAccessory {
  private readonly service: Service;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly historyService: any;

  private lastPowerW = 0;
  private lastEnergyKWh = 0;
  private readonly meter: MeterCharacteristics;

  constructor(
    private readonly platform: PVS6Platform,
    accessory: PlatformAccessory,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FakeGatoHistoryService: any,
    displayName: string,
    serialNumber: string,
  ) {
    const { Characteristic } = platform;

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

    // On (power-derived, with deadband + hold), OutletInUse, Eve Watts, Eve kWh.
    this.meter = new MeterCharacteristics(platform, accessory, this.service, 'home', displayName);

    this.historyService = new FakeGatoHistoryService('energy', accessory, { storage: 'fs' });
  }

  updateValues(reading: PVS6Reading): void {
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
