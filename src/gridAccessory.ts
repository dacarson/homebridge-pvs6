import { PlatformAccessory, Service } from 'homebridge';
import { PVS6Platform } from './platform';
import { PVS6Reading } from './pvs6Client';

export class GridAccessory {
  private readonly service: Service;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly historyService: any;

  private lastPowerW = 0;
  private lastEnergyKWh = 0;
  private lastVoltageV = 0;

  constructor(
    private readonly platform: PVS6Platform,
    accessory: PlatformAccessory,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FakeGatoHistoryService: any,
    displayName: string,
    serialNumber: string,
  ) {
    const { Characteristic, Service } = platform;
    const { EveWatts, EveKWh, EveVoltage } = platform.eveChars;

    // Accessory information service
    const infoService =
      accessory.getService(Service.AccessoryInformation) ??
      accessory.addService(Service.AccessoryInformation);

    infoService
      .setCharacteristic(Characteristic.Manufacturer, 'SunStrong')
      .setCharacteristic(Characteristic.Model, 'PVS6')
      .setCharacteristic(Characteristic.SerialNumber, `${serialNumber}-grid`);

    // Eve Energy uses the standard HAP Outlet service as its container.
    this.service =
      accessory.getService(Service.Outlet) ??
      accessory.addService(Service.Outlet, displayName);

    this.service.setCharacteristic(Characteristic.Name, displayName);

    // On = true when importing from grid (net_p > 0), off when net-exporting.
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

    // EveWatts minValue MUST be negative — grid power goes negative when exporting.
    // Without this the Eve app silently clamps export values to zero.
    this.service
      .getCharacteristic(EveWatts)
      .onGet(() => this.lastPowerW);

    this.service
      .getCharacteristic(EveKWh)
      .onGet(() => this.lastEnergyKWh);

    this.service
      .getCharacteristic(EveVoltage)
      .onGet(() => this.lastVoltageV);

    // fakegato history — power may be negative for export
    this.historyService = new FakeGatoHistoryService('energy', accessory, { storage: 'fs' });
  }

  updateValues(reading: PVS6Reading): void {
    const { Characteristic } = this.platform;
    const { EveWatts, EveKWh, EveVoltage } = this.platform.eveChars;

    this.lastPowerW = reading.netPowerW;
    this.lastEnergyKWh = reading.gridNetKWh;
    this.lastVoltageV = reading.gridVoltageV;

    this.service.updateCharacteristic(Characteristic.On, this.lastPowerW > 0);
    this.service.updateCharacteristic(Characteristic.OutletInUse, true);
    this.service.updateCharacteristic(EveWatts, this.lastPowerW);
    this.service.updateCharacteristic(EveKWh, this.lastEnergyKWh);
    this.service.updateCharacteristic(EveVoltage, this.lastVoltageV);

    this.historyService.addEntry({
      time: Math.round(Date.now() / 1000),
      power: this.lastPowerW,
    });

    this.platform.log.debug(
      `Grid: ${this.lastPowerW}W  ${this.lastEnergyKWh}kWh  ${this.lastVoltageV}V` +
        (this.lastPowerW < 0 ? '  (exporting)' : '  (importing)'),
    );
  }
}
