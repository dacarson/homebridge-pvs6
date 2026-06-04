import {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME, PVS6Config } from './settings';
import { PVS6Client, HttpError } from './pvs6Client';
import { SolarAccessory } from './solarAccessory';
import { GridImportAccessory } from './gridImportAccessory';
import { GridExportAccessory } from './gridExportAccessory';
import { createEveCharacteristics, EveChars } from './eveCharacteristics';

const MIN_POLL_INTERVAL = 5;
const AUTH_RETRY_MS = 30_000;
const AUTH_BACKOFF_MS = 60_000;
const OVERLOAD_BACKOFF_MS = 15_000;

export class PVS6Platform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly api: API;
  public readonly eveChars: EveChars;
  public readonly log: Logger;

  public readonly accessories: PlatformAccessory[] = [];

  private readonly client: PVS6Client;
  private readonly config: PVS6Config;
  private readonly pollIntervalMs: number;

  private solarAccessory?: SolarAccessory;
  private gridImportAccessory?: GridImportAccessory;
  private gridExportAccessory?: GridExportAccessory;

  private pollTimer?: ReturnType<typeof setInterval>;
  private pollInFlight = false;
  private backedOff = false;

  constructor(
    log: Logger,
    config: PlatformConfig,
    api: API,
  ) {
    this.log = log;
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.eveChars = createEveCharacteristics(api);

    const pvs6Config = config as PVS6Config;
    this.config = pvs6Config;

    if (!pvs6Config.host || !pvs6Config.serialNumber) {
      this.log.error('Missing required config: host and serialNumber are required.');
      this.client = new PVS6Client('', '', log);
      this.pollIntervalMs = MIN_POLL_INTERVAL * 1000;
      return;
    }

    let pollInterval = pvs6Config.pollInterval ?? 10;
    if (pollInterval < MIN_POLL_INTERVAL) {
      this.log.warn(`pollInterval ${pollInterval}s is below minimum; clamping to ${MIN_POLL_INTERVAL}s`);
      pollInterval = MIN_POLL_INTERVAL;
    }
    this.pollIntervalMs = pollInterval * 1000;

    this.client = new PVS6Client(pvs6Config.host, pvs6Config.serialNumber, log);

    this.log.info('Finished initializing platform:', config.name ?? PLATFORM_NAME);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('didFinishLaunching — setting up accessories and authenticating');
      // fakegato-history must be loaded after the api is fully initialised
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const FakeGatoHistoryService = require('fakegato-history')(this.api);
      this.setupAccessories(FakeGatoHistoryService);
      this.startAuthAndPolling();
    });

    this.api.on('shutdown', () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
      }
    });
  }

  // Called by Homebridge for each accessory it has cached from a previous run.
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  private setupAccessories(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FakeGatoHistoryService: any,
  ): void {
    const { serialNumber } = this.config;

    // Solar Production is always registered.
    const solarName = this.config.solarName ?? 'Solar Production';
    const solarUuid = this.api.hap.uuid.generate(`${serialNumber}-solar`);
    this.solarAccessory = new SolarAccessory(
      this,
      this.getOrCreateAccessory(solarUuid, solarName),
      FakeGatoHistoryService,
      solarName,
      serialNumber,
    );

    // Grid Import + Grid Export are registered together as an optional pair (default: enabled).
    if (this.config.accessories?.grid !== false) {
      const importName = this.config.gridName ?? 'Grid Meter - Import';
      const importUuid = this.api.hap.uuid.generate(`${serialNumber}-grid`);
      this.gridImportAccessory = new GridImportAccessory(
        this,
        this.getOrCreateAccessory(importUuid, importName),
        FakeGatoHistoryService,
        importName,
        serialNumber,
      );

      const exportName = this.config.gridExportName ?? 'Grid Meter - Export';
      const exportUuid = this.api.hap.uuid.generate(`${serialNumber}-grid-export`);
      this.gridExportAccessory = new GridExportAccessory(
        this,
        this.getOrCreateAccessory(exportUuid, exportName),
        FakeGatoHistoryService,
        exportName,
        serialNumber,
      );
    }
  }

  private getOrCreateAccessory(uuid: string, displayName: string): PlatformAccessory {
    const existing = this.accessories.find(a => a.UUID === uuid);
    if (existing) {
      this.log.info('Restoring accessory from cache:', existing.displayName);
      existing.displayName = displayName;
      this.api.updatePlatformAccessories([existing]);
      return existing;
    }

    this.log.info('Registering new accessory:', displayName);
    const accessory = new this.api.platformAccessory(displayName, uuid);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories.push(accessory);
    return accessory;
  }

  private startAuthAndPolling(): void {
    this.client
      .authenticate()
      .then(() => {
        this.log.info('Authenticated with PVS6 — starting polling');
        this.startPolling();
      })
      .catch((err: Error) => {
        this.log.error(`Authentication failed: ${err.message}. Retrying in ${AUTH_RETRY_MS / 1000}s`);
        setTimeout(() => this.startAuthAndPolling(), AUTH_RETRY_MS);
      });
  }

  private startPolling(): void {
    this.pollTimer = setInterval(async () => {
      if (this.pollInFlight) {
        this.log.debug('Poll skipped — previous request still in flight');
        return;
      }
      if (this.backedOff) {
        this.log.debug('Poll skipped — in backoff period');
        return;
      }

      this.pollInFlight = true;
      try {
        const reading = await this.client.poll();
        this.solarAccessory?.updateValues(reading);
        this.gridImportAccessory?.updateValues(reading);
        this.gridExportAccessory?.updateValues(reading);
      } catch (err) {
        if (err instanceof HttpError) {
          if (err.statusCode === 401) {
            this.log.warn('HTTP 401 — session expired, re-authenticating...');
            this.enterBackoff(AUTH_BACKOFF_MS);
            this.client.authenticate()
              .then(() => {
                this.log.info('Re-authenticated — resuming polls');
                this.backedOff = false;
              })
              .catch((authErr: Error) => {
                this.log.error(`Re-auth failed: ${authErr.message}. Backing off ${AUTH_BACKOFF_MS / 1000}s`);
              });
          } else if (err.statusCode >= 500) {
            this.log.warn(`HTTP ${err.statusCode} from PVS6 — device may be overloaded. Backing off ${OVERLOAD_BACKOFF_MS / 1000}s`);
            this.enterBackoff(OVERLOAD_BACKOFF_MS);
          } else {
            this.log.warn(`Poll HTTP error: ${err.message}`);
          }
        } else if (err instanceof Error) {
          if (err.message.includes('timeout')) {
            this.log.warn('Poll timed out — skipping cycle');
          } else if (err.message.includes('JSON parse')) {
            this.log.warn(`${err.message}`);
          } else {
            this.log.warn(`Poll error: ${err.message}`);
          }
        }
      } finally {
        this.pollInFlight = false;
      }
    }, this.pollIntervalMs);
  }

  private enterBackoff(durationMs: number): void {
    this.backedOff = true;
    setTimeout(() => {
      this.backedOff = false;
      this.log.info('Backoff period ended — resuming polls');
    }, durationMs);
  }
}
