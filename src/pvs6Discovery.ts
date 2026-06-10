import Bonjour, { BonjourService } from 'bonjour-hap';
import { Logger } from 'homebridge';

export interface PVS6DiscoveryResult {
  host: string;
  serialNumber: string;
}

const DISCOVERY_TIMEOUT_MS = 15_000;
const PVS6_SERVICE_TYPE = 'pvs6';

export function discoverPVS6(log: Logger): Promise<PVS6DiscoveryResult> {
  return new Promise((resolve, reject) => {
    log.info(`mDNS: scanning for _${PVS6_SERVICE_TYPE}._tcp — will time out in ${DISCOVERY_TIMEOUT_MS / 1000}s`);

    const bonjour = Bonjour();
    const browser = bonjour.find({ type: PVS6_SERVICE_TYPE });

    const cleanup = (cb: () => void) => {
      browser.stop();
      bonjour.destroy(cb);
    };

    const timer = setTimeout(() => {
      cleanup(() => {
        reject(new Error(
          `mDNS discovery timed out after ${DISCOVERY_TIMEOUT_MS / 1000}s — ` +
          'set host and serialNumber in config to skip auto-discovery',
        ));
      });
    }, DISCOVERY_TIMEOUT_MS);

    browser.on('up', (service: BonjourService) => {
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
