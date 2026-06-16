import * as fs from 'fs';
import * as path from 'path';
import { API, Logger } from 'homebridge';
import { PVS6DiscoveryResult } from './pvs6Discovery';

const CACHE_FILE_NAME = '.pvs6-discovery-cache.json';

function cachePath(api: API): string {
  return path.join(api.user.storagePath(), CACHE_FILE_NAME);
}

// Reads a previously-cached mDNS discovery result, if any.
// Returns undefined on first run (no cache yet) or if the cache file is unreadable/malformed.
export function loadDiscoveryCache(api: API, log: Logger): PVS6DiscoveryResult | undefined {
  try {
    const raw = fs.readFileSync(cachePath(api), 'utf8');
    const data = JSON.parse(raw) as Partial<PVS6DiscoveryResult>;
    if (data.host && data.serialNumber) {
      return { host: data.host, serialNumber: data.serialNumber };
    }
    log.debug('Discovery cache file is malformed — ignoring');
  } catch (err) {
    // ENOENT just means there's no cache yet (first run); anything else is worth a debug log.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.debug(`Failed to read discovery cache: ${err}`);
    }
  }
  return undefined;
}

// Persists a successful mDNS discovery so subsequent startups can skip discovery entirely.
export function saveDiscoveryCache(api: API, log: Logger, result: PVS6DiscoveryResult): void {
  try {
    fs.writeFileSync(cachePath(api), JSON.stringify(result), 'utf8');
    log.debug(`Cached PVS6 location: ${result.host} (serial: ${result.serialNumber})`);
  } catch (err) {
    log.warn(`Failed to write discovery cache: ${err}`);
  }
}
