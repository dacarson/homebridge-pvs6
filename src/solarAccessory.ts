import { PlatformAccessory, Service } from 'homebridge';
import { PVS6Platform } from './platform';
import { PVS6Reading } from './pvs6Client';

export class SolarAccessory {
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
      .setCharacteristic(Characteristic.SerialNumber, `${serialNumber}-solar`);

    // Eve Energy uses the standard HAP Outlet service as its container.
    // getService(Service.Outlet) matches by constructor/UUID — reliable across restarts.
    this.service =
      accessory.getService(Service.Outlet) ??
      accessory.addService(Service.Outlet, displayName);

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

    this.service
      .getCharacteristic(EveVoltage)
      .onGet(() => this.lastVoltageV);

    // fakegato history — 'energy' type records { time, power } in Watts
    this.historyService = new FakeGatoHistoryService('energy', accessory, { storage: 'fs' });
  }

  updateValues(reading: PVS6Reading): void {
    const { Characteristic } = this.platform;
    const { EveWatts, EveKWh, EveVoltage } = this.platform.eveChars;

    this.lastPowerW = reading.pvPowerW;
    this.lastEnergyKWh = reading.pvEnergyKWh;
    this.lastVoltageV = reading.pvVoltageV;

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
      `Solar: ${this.lastPowerW}W  ${this.lastEnergyKWh}kWh  ${this.lastVoltageV}V`,
    );
  }
}
