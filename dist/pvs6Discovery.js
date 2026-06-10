"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.discoverPVS6 = discoverPVS6;
const bonjour_hap_1 = __importDefault(require("bonjour-hap"));
const child_process_1 = require("child_process");
const DISCOVERY_TIMEOUT_MS = 30000;
const PVS6_SERVICE_TYPE = 'pvs6';
function discoverPVS6Bonjour(log) {
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
function discoverPVS6Avahi(log) {
    return new Promise((resolve, reject) => {
        log.info(`mDNS: using avahi-browse for Linux discovery — will time out in ${DISCOVERY_TIMEOUT_MS / 1000}s`);
        const proc = (0, child_process_1.spawn)('avahi-browse', ['-r', '-p', `_${PVS6_SERVICE_TYPE}._tcp`]);
        let resolved = false;
        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error(`mDNS discovery timed out after ${DISCOVERY_TIMEOUT_MS / 1000}s — ` +
                'set host and serialNumber in config to skip auto-discovery'));
        }, DISCOVERY_TIMEOUT_MS);
        proc.stdout.on('data', (data) => {
            if (resolved)
                return;
            for (const line of data.toString().split('\n')) {
                if (resolved || !line.startsWith('='))
                    continue;
                // Parseable resolved format: =;iface;proto;name;type;domain;hostname;address;port;txt...
                const parts = line.split(';');
                if (parts.length < 10)
                    continue;
                const host = parts[6]?.replace(/\.$/, '');
                const txtField = parts.slice(9).join(';');
                const serialNumber = txtField.match(/"serialnum=([^"]+)"/)?.[1];
                if (!host || !serialNumber) {
                    log.warn(`mDNS: PVS6 found but missing host or serialnum — host=${host}, txt=${txtField}`);
                    continue;
                }
                resolved = true;
                clearTimeout(timer);
                proc.kill();
                log.info(`mDNS: discovered PVS6 at ${host} (serial: ${serialNumber})`);
                resolve({ host, serialNumber });
            }
        });
        proc.stderr.on('data', (data) => {
            log.debug(`avahi-browse: ${data.toString().trim()}`);
        });
        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`avahi-browse failed: ${err.message}`));
        });
        proc.on('close', (code) => {
            if (!resolved) {
                clearTimeout(timer);
                reject(new Error(`avahi-browse exited (code ${code}) without finding PVS6 — ` +
                    'set host and serialNumber in config to skip auto-discovery'));
            }
        });
    });
}
function discoverPVS6(log) {
    return process.platform === 'linux' ? discoverPVS6Avahi(log) : discoverPVS6Bonjour(log);
}
//# sourceMappingURL=pvs6Discovery.js.map