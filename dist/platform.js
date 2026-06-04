"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PVS6Platform = void 0;
const settings_1 = require("./settings");
const pvs6Client_1 = require("./pvs6Client");
const solarAccessory_1 = require("./solarAccessory");
const gridImportAccessory_1 = require("./gridImportAccessory");
const gridExportAccessory_1 = require("./gridExportAccessory");
const eveCharacteristics_1 = require("./eveCharacteristics");
const MIN_POLL_INTERVAL = 5;
const AUTH_RETRY_MS = 30000;
const AUTH_BACKOFF_MS = 60000;
const OVERLOAD_BACKOFF_MS = 15000;
class PVS6Platform {
    constructor(log, config, api) {
        this.accessories = [];
        this.pollInFlight = false;
        this.backedOff = false;
        this.log = log;
        this.api = api;
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.eveChars = (0, eveCharacteristics_1.createEveCharacteristics)(api);
        const pvs6Config = config;
        this.config = pvs6Config;
        if (!pvs6Config.host || !pvs6Config.serialNumber) {
            this.log.error('Missing required config: host and serialNumber are required.');
            this.client = new pvs6Client_1.PVS6Client('', '', log);
            this.pollIntervalMs = MIN_POLL_INTERVAL * 1000;
            return;
        }
        let pollInterval = pvs6Config.pollInterval ?? 10;
        if (pollInterval < MIN_POLL_INTERVAL) {
            this.log.warn(`pollInterval ${pollInterval}s is below minimum; clamping to ${MIN_POLL_INTERVAL}s`);
            pollInterval = MIN_POLL_INTERVAL;
        }
        this.pollIntervalMs = pollInterval * 1000;
        this.client = new pvs6Client_1.PVS6Client(pvs6Config.host, pvs6Config.serialNumber, log);
        this.log.info('Finished initializing platform:', config.name ?? settings_1.PLATFORM_NAME);
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
    configureAccessory(accessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);
        this.accessories.push(accessory);
    }
    setupAccessories(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    FakeGatoHistoryService) {
        const { serialNumber } = this.config;
        // Solar Production is always registered.
        const solarName = this.config.solarName ?? 'Solar Production';
        const solarUuid = this.api.hap.uuid.generate(`${serialNumber}-solar`);
        this.solarAccessory = new solarAccessory_1.SolarAccessory(this, this.getOrCreateAccessory(solarUuid, solarName), FakeGatoHistoryService, solarName, serialNumber);
        // Grid Import + Grid Export are registered together as an optional pair (default: enabled).
        if (this.config.accessories?.grid !== false) {
            const importName = this.config.gridName ?? 'Grid Meter - Import';
            const importUuid = this.api.hap.uuid.generate(`${serialNumber}-grid`);
            this.gridImportAccessory = new gridImportAccessory_1.GridImportAccessory(this, this.getOrCreateAccessory(importUuid, importName), FakeGatoHistoryService, importName, serialNumber);
            const exportName = this.config.gridExportName ?? 'Grid Meter - Export';
            const exportUuid = this.api.hap.uuid.generate(`${serialNumber}-grid-export`);
            this.gridExportAccessory = new gridExportAccessory_1.GridExportAccessory(this, this.getOrCreateAccessory(exportUuid, exportName), FakeGatoHistoryService, exportName, serialNumber);
        }
    }
    getOrCreateAccessory(uuid, displayName) {
        const existing = this.accessories.find(a => a.UUID === uuid);
        if (existing) {
            this.log.info('Restoring accessory from cache:', existing.displayName);
            existing.displayName = displayName;
            this.api.updatePlatformAccessories([existing]);
            return existing;
        }
        this.log.info('Registering new accessory:', displayName);
        const accessory = new this.api.platformAccessory(displayName, uuid);
        this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
        this.accessories.push(accessory);
        return accessory;
    }
    startAuthAndPolling() {
        this.client
            .authenticate()
            .then(() => {
            this.log.info('Authenticated with PVS6 — starting polling');
            this.startPolling();
        })
            .catch((err) => {
            this.log.error(`Authentication failed: ${err.message}. Retrying in ${AUTH_RETRY_MS / 1000}s`);
            setTimeout(() => this.startAuthAndPolling(), AUTH_RETRY_MS);
        });
    }
    startPolling() {
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
            }
            catch (err) {
                if (err instanceof pvs6Client_1.HttpError) {
                    if (err.statusCode === 401) {
                        this.log.warn('HTTP 401 — session expired, re-authenticating...');
                        this.enterBackoff(AUTH_BACKOFF_MS);
                        this.client.authenticate()
                            .then(() => {
                            this.log.info('Re-authenticated — resuming polls');
                            this.backedOff = false;
                        })
                            .catch((authErr) => {
                            this.log.error(`Re-auth failed: ${authErr.message}. Backing off ${AUTH_BACKOFF_MS / 1000}s`);
                        });
                    }
                    else if (err.statusCode >= 500) {
                        this.log.warn(`HTTP ${err.statusCode} from PVS6 — device may be overloaded. Backing off ${OVERLOAD_BACKOFF_MS / 1000}s`);
                        this.enterBackoff(OVERLOAD_BACKOFF_MS);
                    }
                    else {
                        this.log.warn(`Poll HTTP error: ${err.message}`);
                    }
                }
                else if (err instanceof Error) {
                    if (err.message.includes('timeout')) {
                        this.log.warn('Poll timed out — skipping cycle');
                    }
                    else if (err.message.includes('JSON parse')) {
                        this.log.warn(`${err.message}`);
                    }
                    else {
                        this.log.warn(`Poll error: ${err.message}`);
                    }
                }
            }
            finally {
                this.pollInFlight = false;
            }
        }, this.pollIntervalMs);
    }
    enterBackoff(durationMs) {
        this.backedOff = true;
        setTimeout(() => {
            this.backedOff = false;
            this.log.info('Backoff period ended — resuming polls');
        }, durationMs);
    }
}
exports.PVS6Platform = PVS6Platform;
//# sourceMappingURL=platform.js.map