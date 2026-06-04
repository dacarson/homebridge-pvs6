import * as https from 'https';
import * as http from 'http';
import { Logger } from 'homebridge';

export interface PVS6Reading {
  pvPowerW: number;        // solar production in W (from livedata pv_p * 1000)
  pvEnergyKWh: number;    // solar cumulative kWh (from livedata pv_en)
  pvVoltageV: number;     // solar line voltage (from production meter v12V)
  netPowerW: number;      // net grid W, positive = importing, negative = exporting (net_p * 1000)
  gridImportKWh: number;  // lifetime imported kWh (from consumption meter posLtea3phsumKwh)
  gridExportKWh: number;  // lifetime exported kWh (from consumption meter negLtea3phsumKwh)
  gridVoltageV: number;   // grid line voltage (from consumption meter v12V)
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

// Flat JSON dict returned by the PVS6 varserver — all keys are full variable paths.
type VarDict = Record<string, string | number>;

export class PVS6Client {
  private sessionCookie = '';
  private livedataCacheId: string | null = null;
  private mdataCacheId: string | null = null;
  private productionMeterIdx: string | null = null;
  private consumptionMeterIdx: string | null = null;
  private lastRequestTime = 0;

  // Retained across polls — partial responses use last known good values (spec §ErrorHandling)
  private lastReading: PVS6Reading = {
    pvPowerW: 0,
    pvEnergyKWh: 0,
    pvVoltageV: 0,
    netPowerW: 0,
    gridImportKWh: 0,
    gridExportKWh: 0,
    gridVoltageV: 0,
  };

  private static readonly MIN_INTERVAL_MS = 5000;
  private static readonly TIMEOUT_MS = 10000;

  constructor(
    private readonly host: string,
    private readonly serialNumber: string,
    private readonly log: Logger,
  ) {}

  private get password(): string {
    return this.serialNumber.slice(-5);
  }

  // Authenticate with the PVS6 and store the session cookie.
  // The PVS6 uses GET /auth?login with Basic auth; the session cookie arrives in Set-Cookie.
  async authenticate(): Promise<void> {
    const credentials = Buffer.from(`ssm_owner:${this.password}`).toString('base64');
    const { status, headers } = await this.rawRequest('GET', '/auth?login', {
      Authorization: `Basic ${credentials}`,
    });

    if (status === 401) {
      throw new HttpError(401, 'PVS6 authentication rejected — check serialNumber');
    }
    if (status !== 200) {
      throw new HttpError(status, `Auth returned HTTP ${status}`);
    }

    const setCookieHeader = headers['set-cookie'];
    if (setCookieHeader && setCookieHeader.length > 0) {
      // Store the cookie name=value pair (strip attributes like Path, Expires, etc.)
      this.sessionCookie = setCookieHeader[0].split(';')[0].trim();
      this.log.debug(`Session cookie: ${this.sessionCookie}`);
    }

    this.log.debug('Authenticated with PVS6');
  }

  // Fetch livedata and meter data, parse into a PVS6Reading.
  // Throws HttpError on HTTP errors; throws Error on timeout or parse failure.
  async poll(): Promise<PVS6Reading> {
    const livedataVars = await this.fetchCache('livedata', '/sys/livedata/*');
    const mdataVars = await this.fetchCache('mdata', '/sys/devices/meter/*/');
    return this.parseReading(livedataVars, mdataVars);
  }

  private async fetchCache(name: 'livedata' | 'mdata', matchPattern: string): Promise<VarDict> {
    const cacheId = name === 'livedata' ? this.livedataCacheId : this.mdataCacheId;

    if (cacheId !== null) {
      try {
        const { status, body } = await this.rawRequest('GET', `/vars?cache=${encodeURIComponent(cacheId)}&fmt=obj`);
        if (status === 200) {
          const data = JSON.parse(body) as VarDict;
          this.log.debug(`${name} cache hit (id=${cacheId})`);
          return data;
        }
        this.log.debug(`${name} cache returned HTTP ${status} — falling back to match query`);
      } catch (err) {
        this.log.debug(`${name} cache request failed (${err}) — falling back to match query`);
      }
      // Cache stale or server reset — clear and re-fetch via match
      if (name === 'livedata') {
        this.livedataCacheId = null;
      } else {
        this.mdataCacheId = null;
      }
    }

    // First-time or cache-miss: fetch with match= to create the cache
    const { status, body } = await this.rawRequest('GET', `/vars?match=${encodeURIComponent(matchPattern)}&fmt=obj`);

    if (status === 401) {
      throw new HttpError(401, 'Unauthorized — session expired');
    }
    if (status >= 500) {
      throw new HttpError(status, `PVS6 HTTP ${status} — device may be overloaded`);
    }
    if (status !== 200) {
      throw new HttpError(status, `Unexpected HTTP ${status}`);
    }

    if (!body.trim()) {
      throw new Error('Empty response body from PVS6');
    }

    let data: VarDict;
    try {
      data = JSON.parse(body) as VarDict;
    } catch {
      throw new Error(`JSON parse failure — raw response: ${body.slice(0, 200)}`);
    }

    // Try to find a cache key in the response: it's a non-path key (doesn't start with '/')
    for (const key of Object.keys(data)) {
      if (!key.startsWith('/')) {
        const id = String(data[key]);
        if (name === 'livedata') {
          this.livedataCacheId = id;
        } else {
          this.mdataCacheId = id;
        }
        this.log.debug(`${name} cache key stored: ${id}`);
        break;
      }
    }

    return data;
  }

  private parseReading(livedata: VarDict, mdata: VarDict): PVS6Reading {
    // Discover production and consumption meters on first parse (or if lost)
    if (this.productionMeterIdx === null || this.consumptionMeterIdx === null) {
      this.discoverMeters(mdata);
    }

    const last = this.lastReading;
    const prodIdx = this.productionMeterIdx;
    const consIdx = this.consumptionMeterIdx;

    // For each field: use parsed value if present, otherwise retain last known good value.
    const pvPowerKW = this.num(livedata['/sys/livedata/pv_p'], 'pv_p');
    const pvEnergyKWh = this.num(livedata['/sys/livedata/pv_en'], 'pv_en');
    const netPowerKW = this.num(livedata['/sys/livedata/net_p'], 'net_p');

    const pvVoltageRaw = prodIdx !== null
      ? this.num(mdata[`/sys/devices/meter/${prodIdx}/v12V`], 'prod.v12V')
      : null;
    const gridImportKWhRaw = consIdx !== null
      ? this.num(mdata[`/sys/devices/meter/${consIdx}/posLtea3phsumKwh`], 'cons.posLtea3phsumKwh')
      : null;
    const gridExportKWhRaw = consIdx !== null
      ? this.num(mdata[`/sys/devices/meter/${consIdx}/negLtea3phsumKwh`], 'cons.negLtea3phsumKwh')
      : null;
    const gridVoltageRaw = consIdx !== null
      ? this.num(mdata[`/sys/devices/meter/${consIdx}/v12V`], 'cons.v12V')
      : null;

    const reading: PVS6Reading = {
      pvPowerW: pvPowerKW !== null ? Math.round(pvPowerKW * 1000 * 10) / 10 : last.pvPowerW,
      pvEnergyKWh: pvEnergyKWh ?? last.pvEnergyKWh,
      pvVoltageV: pvVoltageRaw ?? last.pvVoltageV,
      netPowerW: netPowerKW !== null ? Math.round(netPowerKW * 1000 * 10) / 10 : last.netPowerW,
      gridImportKWh: gridImportKWhRaw ?? last.gridImportKWh,
      gridExportKWh: gridExportKWhRaw ?? last.gridExportKWh,
      gridVoltageV: gridVoltageRaw ?? last.gridVoltageV,
    };

    this.lastReading = reading;
    return reading;
  }

  private discoverMeters(mdata: VarDict): void {
    // Meter paths: /sys/devices/meter/{idx}/{field}
    // Model suffix 'p' = production, 'c' = consumption
    const indices = new Set<string>();
    for (const key of Object.keys(mdata)) {
      const m = key.match(/^\/sys\/devices\/meter\/(\d+)\//);
      if (m) {
        indices.add(m[1]);
      }
    }

    for (const idx of indices) {
      const model = String(mdata[`/sys/devices/meter/${idx}/prodMdlNm`] ?? '');
      if (model.toLowerCase().endsWith('p')) {
        this.productionMeterIdx = idx;
        this.log.debug(`Production meter at index ${idx}: ${model}`);
      } else if (model.toLowerCase().endsWith('c')) {
        this.consumptionMeterIdx = idx;
        this.log.debug(`Consumption meter at index ${idx}: ${model}`);
      }
    }

    if (this.productionMeterIdx === null) {
      this.log.warn('No production meter found in PVS6 response (model ending in "p")');
    }
    if (this.consumptionMeterIdx === null) {
      this.log.warn('No consumption meter found in PVS6 response (model ending in "c")');
    }
  }

  private num(raw: string | number | undefined, field: string): number | null {
    if (raw === undefined || raw === '') {
      this.log.debug(`Field ${field} missing from PVS6 response — using last known value`);
      return null;
    }
    const val = Number(raw);
    if (isNaN(val)) {
      this.log.debug(`Field ${field} is not a number: ${raw} — using last known value`);
      return null;
    }
    return val;
  }

  // Core HTTP request with rate limiting and timeout.
  // All requests share a global 5-second minimum interval (PVS6 embedded server protection).
  private rawRequest(
    method: string,
    path: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      const delay = this.lastRequestTime > 0 && elapsed < PVS6Client.MIN_INTERVAL_MS
        ? PVS6Client.MIN_INTERVAL_MS - elapsed
        : 0;

      const doRequest = () => {
        this.lastRequestTime = Date.now();

        const headers: Record<string, string> = { ...extraHeaders };
        if (!headers['Authorization'] && this.sessionCookie) {
          headers['Cookie'] = this.sessionCookie;
        }

        const options: https.RequestOptions = {
          hostname: this.host,
          path,
          method,
          headers,
          rejectUnauthorized: false,
        };

        const req = https.request(options, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            this.log.debug(`${method} ${path} → HTTP ${res.statusCode}`);
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
          });
        });

        req.setTimeout(PVS6Client.TIMEOUT_MS, () => {
          req.destroy(new Error(`Request timeout after ${PVS6Client.TIMEOUT_MS / 1000}s`));
        });

        req.on('error', (err) => reject(err));
        req.end();
      };

      if (delay > 0) {
        this.log.debug(`Rate limiting: waiting ${delay}ms before next PVS6 request`);
        setTimeout(doRequest, delay);
      } else {
        doRequest();
      }
    });
  }
}
