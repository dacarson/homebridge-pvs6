"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverPVS6 = discoverPVS6;
const bonjour_hap_1 = __importDefault(require("bonjour-hap"));
const DISCOVERY_TIMEOUT_MS = 15000;
const PVS6_SERVICE_TYPE = 'pvs6';
function discoverPVS6(log) {
    return new Promise((resolve, reject) => {
        log.info(`mDNS: scanning for _${PVS6_SERVICE_TYPE}._tcp — will time out in ${DISCOVERY_TIMEOUT_MS / 1000}s`);
        const bonjour = (0, bonjour_hap_1.default)();
        const browser = bonjour.find({ type: PVS6_SERVICE_TYPE });
        const cleanup = (cb) => {
            browser.stop();
            bonjour.destroy(cb);
        };
        const timer = setTimeout(() => {
            cleanup(() => {
                reject(new Error(`mDNS discovery timed out after ${DISCOVERY_TIMEOUT_MS / 1000}s — ` +
                    'set host and serialNumber in config to skip auto-discovery'));
            });
        }, DISCOVERY_TIMEOUT_MS);
        browser.on('up', (service) => {
            // Strip trailing dot that mDNS hostnames include (e.g. "pvs.local." → "pvs.local")
            const host = service.host?.replace(/\.$/, '');
            const serialNumber = service.txt?.serialnum;
            if (!host || !serialNumber) {
                log.warn(`mDNS: PVS6 service found but missing host or serialnum — host=${host}, txt=${JSON.stringify(service.txt)}`);
                return;
            }
            clearTimeout(timer);
            cleanup(() => {
                log.info(`mDNS: discovered PVS6 at ${host} (serial: ${serialNumber})`);
                resolve({ host, serialNumber });
            });
        });
    });
}
//# sourceMappingURL=pvs6Discovery.js.map