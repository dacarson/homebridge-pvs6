# homebridge-pvs6 — Project Specification

A Homebridge plugin that exposes SunStrong PVS6 solar monitoring data to Apple HomeKit via Eve Energy accessories with fakegato history support.

---

## Overview

`homebridge-pvs6` polls the PVS6 local FCGI API and publishes up to three HomeKit accessories:

- **Solar Production** — always registered; current PV output, cumulative energy, voltage
- **Grid Import** — real-time import watts (`max(0, net_p) × 1000`), imported energy, voltage
- **Grid Export** — real-time export watts (`max(0, −net_p) × 1000`), exported energy, voltage

Solar Production is always registered. Grid Import and Grid Export are always registered **as a pair** — enabling one enables both. The grid pair is on by default and can be disabled with `accessories.grid: false`. The plugin runs entirely standalone — no InfluxDB, no cloud dependency, no SunStrong Connect required.

It complements `homebridge-eagle` (Rainforest EAGLE-200 grid meter): the two plugins are fully independent but sit alongside each other naturally in Apple Home and the Eve app, and share the same Eve/fakegato accessory patterns documented in *Implementation Learnings* below.

---

## Supported Hardware

| Device | Notes |
|---|---|
| SunStrong PVS6 | Firmware build 61840 or later required |
| PVS5 | Not yet supported upstream; out of scope |
| PVS2 | Not supported |

---

## Architecture

```
Homebridge (Node.js)
  └── homebridge-pvs6 plugin
        ├── PVS6Client              — HTTP auth + varserver polling
        ├── SolarAccessory          — Eve Energy + fakegato history
        ├── GridImportAccessory     — Eve Energy + fakegato history
        └── GridExportAccessory     — Eve Energy + fakegato history (optional)
```

### PVS6Client

Handles all communication with the PVS6:

- **Authentication**: POST to `/auth?login` with Basic Auth (`ssm_owner` / last 5 chars of serial). Stores session cookie. Re-authenticates automatically on 401.
- **Data fetch**: GET `/vars?cache=<id>&fmt=obj` for cached queries. On first run, creates caches via `match=` queries, then uses cache IDs on all subsequent polls.
- **Two caches used**:
  - `livedata` — `/sys/livedata/*` for aggregate solar + site load
  - `mdata` — `/sys/devices/*/meter/data` for per-meter detail (grid CT meter)
- **TLS**: PVS6 uses a self-signed cert; the client must set `rejectUnauthorized: false`.
- **Rate limiting**: Enforces a minimum 5-second interval between requests regardless of configured `pollInterval`.

### Data mapping

#### Livedata endpoint (`/sys/livedata/*`)

| Variable | Meaning | Unit |
|---|---|---|
| `pv_p` | Solar production power | kW |
| `pv_en` | Solar cumulative energy | kWh |
| `net_p` | Net grid power (+ = import, − = export) | kW |
| `net_en` | Net grid cumulative energy | kWh |
| `site_load_p` | Total site load | kW |

#### Meter endpoint (`/sys/devices/12/meter/data`)

Device 12 is the consumption CT meter (model `PVS6M0400c`) with per-phase detail:

| Field | Meaning | Unit |
|---|---|---|
| `p3phsumKw` | Total 3-phase power | kW |
| `netLtea3phsumKwh` | Net cumulative energy | kWh |
| `posLtea3phsumKwh` | Total imported energy | kWh |
| `negLtea3phsumKwh` | Total exported energy | kWh |
| `v12V` | Line voltage | V |
| `v1nV` / `v2nV` | Per-leg voltages | V |
| `i1A` / `i2A` | Per-leg current | A |
| `freqHz` | Grid frequency | Hz |

Device 11 is the production meter (`PVS6M0400p`). Used as a cross-check but `livedata/pv_p` is the primary solar source.

---

## HomeKit Accessories

### Solar Production Accessory

**Accessory type:** Eve Energy — custom Eve Energy service (`E863F10A-079E-48FF-8F27-9C2605A29F52`). Eve recognises the accessory as an Eve Energy meter via this service UUID.

**Display name (configurable):** `Solar Production`

| Characteristic | HAP UUID | Source | Notes |
|---|---|---|---|
| `On` (read-only) | `00000025` | `pv_p > 0` | Producing = on |
| `OutletInUse` | `00000026` | always `true` | Required by Eve Energy |
| Eve Watt | `E863F10D` | `pv_p × 1000` | Converted to W |
| Eve kWh | `E863F10C` | `pv_en` | Cumulative lifetime |
| `Name` | `00000023` | config `solarName` | |

**fakegato history:** Records `power` (W) at each poll interval. History service UUID `E863F007-079E-48FF-8F27-9C2605A29F52`.

**Apple Home tile:** Shows as a smart plug. The `On` state (producing/not producing) is visible on the tile. Wattage visible in detail view.

---

### Grid Import Accessory

Registered as part of the grid pair (unless `accessories.grid: false`). Shows real-time import watts and lifetime imported energy.

**Accessory type:** Eve Energy — custom Eve Energy service (`E863F10A-079E-48FF-8F27-9C2605A29F52`), as for Solar Production above.

**Display name (configurable):** `gridName` (default: `"Grid Meter - Import"`)

**Platform accessory UUID:** `hap.uuid.generate(serialNumber + '-grid')`

| Characteristic | HAP UUID | Source | Notes |
|---|---|---|---|
| `On` (read-only) | `00000025` | `net_p > 0` | On = importing. No-op setter reverts to polled state. |
| `OutletInUse` | `00000026` | always `true` | Required by Eve Energy |
| Eve Watt | `E863F10D` | `max(0, net_p) × 1000` | Import watts; zero when net-exporting |
| Eve kWh | `E863F10C` | `posLtea3phsumKwh` | Lifetime imported energy |
| `Name` | `00000023` | config `gridName` | |

**fakegato history:** Records `{ time, power }` (W, import only — non-negative) at each poll.

**Apple Home tile:** `On` = grid importing power. Wattage in detail view. Eve app shows import history.

---

### Grid Export Accessory

Registered together with Grid Import as part of the grid pair (unless `accessories.grid: false`). Shows real-time export watts and lifetime exported energy.

**Accessory type:** Eve Energy — custom Eve Energy service (`E863F10A-079E-48FF-8F27-9C2605A29F52`), as for Solar Production above.

**Display name (configurable):** `gridExportName` (default: `"Grid Meter - Export"`)

**Platform accessory UUID:** `hap.uuid.generate(serialNumber + '-grid-export')` — the `-grid-export` suffix keeps it distinct from the import accessory UUID.

| Characteristic | HAP UUID | Source | Notes |
|---|---|---|---|
| `On` (read-only) | `00000025` | `net_p < 0` | On = exporting. No-op setter reverts to polled state. |
| `OutletInUse` | `00000026` | always `true` | Required by Eve Energy |
| Eve Watt | `E863F10D` | `max(0, −net_p) × 1000` | Export watts (positive); zero when not exporting |
| Eve kWh | `E863F10C` | `negLtea3phsumKwh` | Lifetime exported energy |
| `Name` | `00000023` | config `gridExportName` | |

**fakegato history:** Records `{ time, power }` (W, export only — non-negative) at each poll.

**Apple Home tile:** `On` = actively exporting to grid. Eve app shows export history.

---

## Configuration

Configured via `config.json` in the Homebridge `platforms` array.

Minimal config (solar only — grid disabled):

```json
{
  "platform": "PVS6",
  "name": "PVS6",
  "host": "192.168.1.x",
  "serialNumber": "ABCDE12345",
  "accessories": { "grid": false }
}
```

Standard config (solar + grid pair):

```json
{
  "platform": "PVS6",
  "name": "PVS6",
  "host": "192.168.1.x",
  "serialNumber": "ABCDE12345",
  "pollInterval": 10,
  "solarName": "Solar Production",
  "gridName": "Grid Meter - Import",
  "gridExportName": "Grid Meter - Export"
}
```

### Config schema (`config.schema.json`)

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `host` | string | yes | — | IP or hostname of PVS6 on local network |
| `serialNumber` | string | yes | — | Full PVS6 serial number (password = last 5 chars) |
| `pollInterval` | integer | no | `10` | Seconds between polls. Minimum enforced: `5` |
| `accessories.grid` | boolean | no | `true` | Enable the Grid Import + Grid Export accessory pair. Set `false` to disable both |
| `solarName` | string | no | `"Solar Production"` | HomeKit display name for solar accessory |
| `gridName` | string | no | `"Grid Meter - Import"` | HomeKit display name for grid import accessory |
| `gridExportName` | string | no | `"Grid Meter - Export"` | HomeKit display name for grid export accessory |

---

## Session Management

1. On startup, authenticate and store the session cookie in memory.
2. On every poll response, check HTTP status:
   - `401` → re-authenticate, then retry the request once.
   - `5xx` → log warning, skip this poll cycle, retain last known values.
3. No cookie persistence to disk (re-auth on Homebridge restart is acceptable).

---

## Error Handling

| Condition | Behaviour |
|---|---|
| PVS6 unreachable at startup | Log error, retry auth every 30s until successful |
| Poll timeout (>10s) | Skip cycle, warn in log, retain last values |
| Partial data (missing field) | Use last known good value; log debug |
| JSON parse failure / truncated body | Log warning with raw response, treat as skipped cycle, retain last values |
| Auth failure after retry (401) | Log error, backoff 60s |
| HTTP 503 / other 5xx | Embedded HTTP server overloaded. Skip cycle, log warning, apply a short backoff (temporarily widen poll interval) rather than retrying immediately |
| Overlapping poll (previous poll still in flight) | Skip the new cycle (single in-flight request only — see `pollInFlight` guard) |
| `pollInterval` < 5 in config | Clamp to 5, log warning |

> **Overload caution:** Like the EAGLE, the PVS6's embedded HTTP server is easily overwhelmed by frequent polling and can return `503` or truncated bodies. Enforce a single in-flight request at a time (no overlapping polls), back off rather than retrying immediately, and keep `pollInterval` conservative. This is independent of the client's 5-second minimum-interval rate limit.

Accessories remain visible in HomeKit during outages; values freeze until connectivity resumes.

---

## fakegato Integration

Uses [`fakegato-history`](https://github.com/simont77/fakegato-history) npm package.

- Each accessory gets its own `FakeGatoHistoryService` instance.
- History type: `energy` for both accessories.
- Data logged: `{ time, power }` at each successful poll.
- History persisted to Homebridge storage directory so it survives restarts.
- Eve app graphs display up to 7 days of wattage history natively.

---

## File Structure

```
homebridge-pvs6/
├── src/
│   ├── index.ts                  — Homebridge platform registration
│   ├── platform.ts               — PVS6Platform class, accessory lifecycle
│   ├── pvs6Client.ts             — HTTP auth + polling logic
│   ├── solarAccessory.ts         — Solar HomeKit accessory
│   ├── gridImportAccessory.ts    — Grid Import HomeKit accessory
│   ├── gridExportAccessory.ts    — Grid Export HomeKit accessory (optional)
│   └── eveCharacteristics.ts     — Eve custom UUID definitions
├── config.schema.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## Dependencies

| Package | Purpose |
|---|---|
| `homebridge` | Peer dependency |
| `fakegato-history` | Eve history storage and HAP service |
| `node-fetch` or `axios` | HTTP client for PVS6 API |

Node.js ≥ 18 required (for native `fetch` as an alternative to a HTTP library).

---

## Out of Scope (v1)

- Battery / ESS (SunVault) — no hardware present
- Per-inverter individual accessories
- Write/control operations (no setters on PVS6 production data)
- InfluxDB integration (handled separately by existing stack)
- Cloud fallback or SunStrong Connect passthrough
- PVS5 support

---

## Future Considerations

- `site_load_p` as a third optional accessory (derived: solar + grid import − export)
- Per-leg current characteristics for grid accessory (L1/L2 split)
- Prometheus metrics endpoint on a configurable port (optional sidecar)
- HACS-style Homebridge UI config page via `homebridge-config-ui-x` schema extensions

---

## Key Differences from homebridge-eagle

| Aspect | homebridge-pvs6 | homebridge-eagle |
|---|---|---|
| Protocol | HTTPS (self-signed cert) | HTTP plain |
| Auth | Session cookie; re-auth on 401 | Stateless Basic Auth per request |
| Data format | JSON (varserver key/value flat dict) | XML fragments |
| Startup | Build varserver cache IDs; discover meter indices | Discover meter `HardwareAddress` via `device_list` |
| Value format | Native float in JSON | ASCII string with unit suffix |
| Accessories | Solar (always) + Grid Import + Grid Export (pair, optional via `accessories.grid`) | Grid Import (always) + Grid Export (optional, `showExportMeter`) |
| Negative power | `net_p` split via `max(0, ±net_p)` across import/export accessories | `InstantaneousDemand` split via `max(0, ±demand)` across import/export accessories |
| Export kWh source | `negLtea3phsumKwh` from consumption meter | `CurrentSummationReceived` from ZigBee meter |

---

## Shared Code Opportunity

`eveCharacteristics.ts` is identical between `homebridge-pvs6` and `homebridge-eagle`. If both plugins are maintained in the same repository or as a monorepo, this file can be shared. For standalone npm distribution, duplicating the small file keeps each plugin self-contained and dependency-free between them.

---

## Implementation Learnings — Homebridge / Eve Energy Plugin

Lessons carried over from building `homebridge-eagle`, which uses the same Eve Energy + fakegato accessory pattern. Recorded here so they apply directly without repeating the same debugging cycles. (The XML-specific learnings from that plugin do not apply — the PVS6 API returns JSON.)

### Custom Eve Service: find by UUID, not `getService()`

`accessory.getService(string)` in hap-nodejs matches by `displayName`, `name`, or `subtype` — **not** by UUID. After a Homebridge restart the cached accessory's service will not be found, and a duplicate service will be added, causing errors. Match by UUID via `accessory.services.find()` instead. The Eve Energy accessory uses the custom Eve Energy service UUID `E863F10A-079E-48FF-8F27-9C2605A29F52` as its container — this is what causes Eve app to render the accessory as an Eve Energy meter rather than a generic plug:

```typescript
const existingService = accessory.services.find(s => s.UUID === EVE_ENERGY_SERVICE_UUID);
this.service = existingService ??
  accessory.addService(new platform.api.hap.Service(displayName, EVE_ENERGY_SERVICE_UUID));
```

### Custom Eve Characteristics: `getCharacteristic()` not `addCharacteristic()`

`addCharacteristic()` **always** adds a new instance and throws `DuplicateCharacteristicError` on the second Homebridge start (the characteristic already exists in the cached service). Use `getCharacteristic(CharClass)` instead — it returns the existing instance from cache, or adds it if genuinely absent:

```typescript
// Correct — idempotent across restarts
this.eveEnergyService.getCharacteristic(EveWatts).onGet(() => this.lastPowerW);

// Wrong — throws on restart
this.eveEnergyService.addCharacteristic(EveWatts).onGet(() => this.lastPowerW);
```

### Eve Energy: Service and Characteristic UUIDs

`E863F10A-079E-48FF-8F27-9C2605A29F52` serves double duty in the Eve ecosystem: it is the **Eve Energy service UUID** that tells Eve app to render the accessory as an energy meter. It is also documented as the Volt characteristic UUID, but since the Volt characteristic lives on the same service and a service and characteristic cannot share a UUID, voltage is not used. The fakegato history service is separate: `E863F007-079E-48FF-8F27-9C2605A29F52`.

The canonical Eve characteristic UUIDs used by this plugin (per the [simont77](https://gist.github.com/simont77/3f4d4330fa55b83f8ca96388d9004e7d) and [gomfunkel](https://gist.github.com/gomfunkel/b1a046d729757120907c) gists) are:

| Eve characteristic | UUID | Eve app label |
|---|---|---|
| Watt | `E863F10D-079E-48FF-8F27-9C2605A29F52` | Consumption |
| Kilowatt-hour | `E863F10C-079E-48FF-8F27-9C2605A29F52` | Total Consumption |

### `OutletInUse` Is Required

The Eve Energy accessory model requires the `OutletInUse` characteristic (`00000026`). Omitting it can cause the accessory to render incorrectly in the Eve app. Wire it to always return `true`:

```typescript
this.eveEnergyService.getCharacteristic(Characteristic.OutletInUse).onGet(() => true);
```

### The `On` Characteristic Must Have a No-op Setter

HAP's `On` characteristic (`00000025`) is defined as read/write. Without a setter, hap-nodejs logs a warning; a writable setter lets HomeKit momentarily toggle the tile. Immediately revert to the polled state (`pv_p > 0` for Solar, `net_p > 0` for Grid):

```typescript
this.eveEnergyService
  .getCharacteristic(Characteristic.On)
  .onGet(() => this.lastPowerW > 0)
  .onSet(async () => {
    this.eveEnergyService.updateCharacteristic(Characteristic.On, this.lastPowerW > 0);
  });
```

### Split Import/Export — Both Accessories Use Non-Negative Watts

`net_p` goes negative when the site is net-exporting. Rather than a single accessory with negative watts, use two mutually exclusive accessories — one for import and one for export — each showing only non-negative values:

```typescript
// Grid Import: positive when importing, zero when exporting
const importW = Math.max(0, netPowerKW * 1000);

// Grid Export: positive when exporting, zero when importing
const exportW = Math.max(0, -netPowerKW * 1000);
```

This eliminates the `minValue: -100000` requirement and produces cleaner history graphs in the Eve app — import and export are separated into distinct timelines. The export accessory's `On` state is `net_p < 0` and its kWh comes from `negLtea3phsumKwh`; the import accessory's kWh comes from `posLtea3phsumKwh`.

> **Historical note:** An earlier version of this spec used a single Grid Meter with negative watts for export. The split-accessory approach is preferred — it matches the homebridge-eagle pattern and renders correctly in Apple Home without requiring `minValue: -100000`.

### Stable, Per-Accessory UUID from Hardware Identity

Generate each platform accessory UUID from a stable hardware identifier so cached accessories survive Homebridge restarts. pvs6 has up to three accessories backed by one device serial — they must derive **distinct** UUIDs by adding a per-accessory suffix:

```typescript
const solarUuid      = this.api.hap.uuid.generate(`${serialNumber}-solar`);
const gridUuid       = this.api.hap.uuid.generate(`${serialNumber}-grid`);
const gridExportUuid = this.api.hap.uuid.generate(`${serialNumber}-grid-export`);
```

Using the config `name` or a hardcoded string breaks caching when the name changes or when multiple instances run.

### TypeScript Pattern for Custom Characteristic Classes

hap-nodejs expects characteristic constructors typed as `{ new(): Characteristic; UUID: string }`. The inner class inheriting from `hap.Characteristic` does not satisfy this constraint without a cast — use `as unknown as EveCharClass` (a direct cast fails strict checks):

```typescript
export type EveCharClass = { new(): Characteristic; UUID: string };

return {
  EveWatts:   EveWatts   as unknown as EveCharClass,
  EveKWh:     EveKWh     as unknown as EveCharClass,
  EveVoltage: EveVoltage as unknown as EveCharClass,
};
```

### Custom Unit Strings in Characteristics

HAP's `unit` property is typed as a `Units` enum, which does not include `'W'`, `'kWh'`, `'V'`, or `'A'`. Cast to `string` to use non-standard unit labels:

```typescript
unit: 'W' as string,
```

### fakegato-history: Load After `didFinishLaunching`

`fakegato-history` must be loaded via `require()` (not `import`) and instantiated **after** the Homebridge `api` object is fully initialised — i.e., inside the `didFinishLaunching` callback, not in the platform constructor. Each accessory gets its own instance:

```typescript
const FakeGatoHistoryService = require('fakegato-history')(this.api);
this.historyService = new FakeGatoHistoryService('energy', accessory, { storage: 'fs' });
```

Passing `{ storage: 'fs' }` is required for history to persist across restarts; without it, history is in-memory only.

### fakegato `addEntry` Format for `energy` Type

The energy history type expects `{ time, power }` with:
- `time`: Unix timestamp in **seconds** (not milliseconds) — `Math.round(Date.now() / 1000)`
- `power`: Watts (not kW). Both grid accessories use non-negative values — import watts for Grid Import, export watts for Grid Export.

```typescript
this.historyService.addEntry({
  time: Math.round(Date.now() / 1000),
  power: this.lastPowerW,   // already in Watts; always >= 0 with the split-accessory design
});
```

### `pollInFlight` Guard for Overlapping Polls

`setInterval` fires regardless of whether the previous async poll has completed. On a slow device this causes overlapping requests that can overwhelm the embedded HTTP server. A single shared client polls both caches per cycle, so guard the whole cycle with a boolean flag:

```typescript
if (this.pollInFlight) return;
this.pollInFlight = true;
try {
  await this.client.poll();
} finally {
  this.pollInFlight = false;
}
```

### `displayName` in `package.json` for the Homebridge Plugin Registry

The Homebridge plugin registry UI uses the `"displayName"` field in `package.json` (distinct from `"name"`) as the human-readable label. Without it, the raw npm package name is shown:

```json
{
  "name": "homebridge-pvs6",
  "displayName": "PVS6 Solar",
  ...
}
```
