# homebridge-pvs6
[![License: MIT](https://img.shields.io/github/license/dacarson/homebridge-pvs6)](LICENSE)
[![Version](https://img.shields.io/github/v/release/dacarson/homebridge-pvs6)](https://github.com/dacarson/homebridge-pvs6/releases)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-pvs6)](https://www.npmjs.com/package/homebridge-pvs6)

A [Homebridge](https://homebridge.io) plugin for the [SunStrong PVS6](https://sunstrong.com) solar monitoring system. Exposes solar production and grid metering as **Eve Energy** accessories in Apple HomeKit, with real-time power, cumulative energy, and native Eve app history.

<table>
  <tr>
    <td align="center" valign="middle">
<img width="300" alt="Eve Energy view" src="https://github.com/user-attachments/assets/f85d2e28-b419-4c41-a651-cbb88c011c79" />
      <br><sub>Eve Energy view</sub>
    </td>
    <td align="center" valign="middle">
<img width="600" alt="Total Consumption landscape" src="https://github.com/user-attachments/assets/76332baa-e1a2-45dd-a4ee-4dffac008ab8" />
      <br><sub>Total Consumption landscape</sub>
    </td>
  </tr>
</table>

---
## Features

- **Solar Production** accessory — always registered; real-time PV output (W), lifetime generation (kWh)
- **Grid Import + Grid Export** accessory pair — optional (default enabled); each shows non-negative watts and its own Eve app history
- **Home Consumption** accessory — optional (default disabled); real-time site load (W) and derived lifetime consumption (kWh)
- Import and Export accessories are always registered together as a pair, making import/export history immediately readable as separate graphs
- Up to 7 days of native power history in the Eve app via [fakegato-history](https://github.com/simont77/fakegato-history)
- Polls the PVS6 **local** FCGI API — no SunStrong Connect, no cloud dependency
- **Auto-discovers** the PVS6 on your local network via mDNS — no IP address or serial number required in config
- Automatically identifies production and consumption CT meters from the PVS6 device list
- Optional: live watts in the Apple Home **Energy** view via Matter (see [Apple Home Energy & Matter](#apple-home-energy--matter))

---

## Supported Hardware

| Device | Status |
|---|---|
| SunStrong PVS6 (firmware build 61840+) | Supported |
| PVS5 | Not supported |
| PVS2 | Not supported |

---

## How It Works

The PVS6 exposes a local HTTPS varserver API that this plugin polls on a configurable interval. It reads two data streams:

- **Livedata** — aggregate solar production and net grid power computed by the PVS6
- **Meter data** — per-phase detail from the CT meters (cumulative energy)

The plugin automatically identifies the production meter (model suffix `p`, e.g. `PVS6M0400p`) and consumption meter (model suffix `c`, e.g. `PVS6M0400c`) from the device list.

All accessories render as **smart plugs** in Apple Home:

- **Solar Production** — always registered; `On` when the panels are producing power
- **Grid Import** — `On` when importing from the grid; zero watts when net-exporting
- **Grid Export** — `On` when net-exporting solar to the grid; zero watts when importing
- **Home Consumption** — optional; `On` when the house is drawing power (always true in practice); shows total site load and derived lifetime consumption energy

Grid Import and Grid Export are always registered together — enabling `accessories.grid` creates both. Home Consumption is opt-in via `accessories.homeConsumption: true`.

---

## Requirements

- [Homebridge](https://homebridge.io) v2.0 or later (v2.3.0+ if you want the optional Apple Home Energy view via Matter)
- Node.js 18 or later
- SunStrong PVS6 on the same local network as your Homebridge host

---

## Installation

Install via the Homebridge UI plugin search, or from the command line:

```bash
npm install -g homebridge-pvs6
```

---

## Configuration

The Homebridge UI exposes an **Auto Discover** checkbox (on by default). When checked, the plugin finds the PVS6 on your local network automatically via mDNS — Host and Serial Number fields are ignored even if filled in. When unchecked, Host and Serial Number are used directly. Either way, both fields are always visible and their values are preserved in `config.json`.

### Auto Discover (default)

The checkbox is on by default. No other fields are required:

```json
{
  "platforms": [
    {
      "platform": "PVS6",
      "name": "PVS6",
      "autoDiscover": true
    }
  ]
}
```

At startup the plugin scans for `_pvs6._tcp` on the local network. The PVS6 broadcasts its hostname (`pvs.local`) and serial number via mDNS, so both are discovered automatically. Discovery times out after 30 seconds with an actionable error if no device is found.

If the device becomes unreachable for 2 hours (e.g. the router assigned it a new IP), the plugin runs mDNS discovery again automatically and reconnects.

### Manual config

Uncheck **Auto Discover** and supply the host and serial number directly. This skips mDNS entirely and is useful if you assign the PVS6 a static IP or DHCP reservation:

```json
{
  "platforms": [
    {
      "platform": "PVS6",
      "name": "PVS6",
      "autoDiscover": false,
      "host": "pvs.local",
      "serialNumber": "ZT231385000549A1234"
    }
  ]
}
```

### Full config (all options)

```json
{
  "platforms": [
    {
      "platform": "PVS6",
      "name": "PVS6",
      "autoDiscover": true,
      "host": "pvs.local",
      "serialNumber": "ZT231385000549A1234",
      "pollInterval": 10,
      "matter": true,
      "evePowerUpdates": "throttled",
      "minChangeWatts": 25,
      "minChangePercent": 2,
      "minChangeKwh": 0.1,
      "switchHoldSeconds": 60,
      "accessories": {
        "grid": true,
        "homeConsumption": true
      },
      "solarName": "Solar Production",
      "gridName": "Grid Meter - Import",
      "gridExportName": "Grid Meter - Export",
      "homeConsumptionName": "Home Consumption"
    }
  ]
}
```

### Configuration Options

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `platform` | string | yes | — | Must be `PVS6` |
| `autoDiscover` | boolean | no | `true` | When `true`, find the PVS6 via mDNS — `host` and `serialNumber` are ignored. Re-discovers automatically after 2 hours of unreachability |
| `host` | string | no* | — | IP address or hostname of the PVS6. Used only when `autoDiscover` is `false` |
| `serialNumber` | string | no* | — | Full PVS6 serial number. The last 5 characters are used as the API password. Used only when `autoDiscover` is `false` |
| `pollInterval` | integer | no | `10` | Seconds between polls. Minimum enforced: `5` |
| `matter` | boolean | no | `false` | Also publish each enabled meter over Matter with live electrical measurements, so it shows watts on its tile in the Apple Home Energy view (see [Apple Home Energy & Matter](#apple-home-energy--matter)) |
| `evePowerUpdates` | string | no | `"throttled"` | How Eve Watts and Eve kWh are sent to HomeKit: `"throttled"`, `"pollOnly"` or `"live"`. See [HomeKit Updates & Automations](#homekit-updates--automations) |
| `minChangeWatts` | number | no | `25` | Throttled mode: push Eve Watts once it has changed by this many watts, or by `minChangePercent` if that is larger |
| `minChangePercent` | number | no | `2` | Throttled mode: push Eve Watts once it has changed by this percentage of the last value pushed |
| `minChangeKwh` | number | no | `0.1` | Throttled mode: push Eve kWh once it has changed by this much |
| `switchHoldSeconds` | integer | no | `60` | A power-derived On switch only changes once the new state has held this long. `0` disables the hold |
| `accessories.grid` | boolean | no | `true` | Enable the Grid Import + Grid Export accessory pair. Set `false` to disable both |
| `accessories.homeConsumption` | boolean | no | `false` | Enable the Home Consumption accessory. Opt-in; off by default |
| `solarName` | string | no | `"Solar Production"` | HomeKit display name for the Solar Production accessory |
| `gridName` | string | no | `"Grid Meter - Import"` | HomeKit display name for the Grid Import accessory |
| `gridExportName` | string | no | `"Grid Meter - Export"` | HomeKit display name for the Grid Export accessory |
| `homeConsumptionName` | string | no | `"Home Consumption"` | HomeKit display name for the Home Consumption accessory |

\* Required when `autoDiscover` is `false`.

### HomeKit Updates & Automations

The PVS6 is polled every ~10 seconds, and each reading differs from the last by a few watts. If every reading were pushed to HomeKit, each accessory's Eve Watts and Eve kWh values would send an event on every poll, adding up to about 1,000 events per hour. The settings below reduce that without breaking your automations.

#### Eve power and energy values (`evePowerUpdates`)

Eve Watts and Eve kWh are Eve custom characteristics. The Home app doesn't show them, but **Eve and Home+ automations can trigger on them** ("when power rises above 3 kW") **or check them as conditions**. Choose a mode with that in mind:

| Mode | What is pushed | Effect on automations |
|---|---|---|
| `throttled` (default) | Eve Watts when it changes by at least `max(minChangeWatts, minChangePercent%)` (defaults 25 W / 2%, so 25 W below 1,250 W and 2% above). Eve kWh when it changes by at least `minChangeKwh` (default 0.1 kWh). Either value is also pushed every 5 minutes, even if it hasn't changed much | Triggers and conditions keep working. Values are accurate to within the configured thresholds |
| `pollOnly` | Nothing. Event notifications are removed from these characteristics, and apps get the newest reading when they read the accessory | Lowest traffic, but **triggers on these values stop firing**. Use it only if no automation uses them |
| `live` | Every reading, on every poll | Original behaviour; highest traffic |

In every mode, reading an accessory returns the latest value, and the current values are reported as soon as the plugin starts.

#### On switches

Each accessory's **On** switch is a standard HomeKit characteristic. It always sends events, so Home app automations that use it keep working. To keep the switches from flickering at sunrise, at sunset, or when a cloud passes, each one is derived from power with:

- **a deadband:** it turns on above 50 W and off below 20 W
- **a hold:** a new state must last `switchHoldSeconds` (default 60) before it's reported. If power goes back first, the change is dropped. Set it to `0` to report changes on the next poll

Because of the hold, **automations triggered by these switches can fire up to `switchHoldSeconds` later** than the underlying change in power.

#### Logging

At debug level, each suppressed Eve update and each held or cancelled switch change is logged. Once an hour a single debug line reports how many updates were sent and how many were suppressed.

### Finding Your Serial Number

The serial number is printed on the label on the PVS6 unit (format: `ZT...`). It is also visible in the SunStrong Connect app and is broadcast by the PVS6 itself via mDNS (which is how Auto Discover retrieves it). The last 5 characters are used as the local API login password — no separate password configuration is required.

---

## HomeKit Accessories

### Solar Production

| Characteristic | Source | Notes |
|---|---|---|
| On | `pv_p` | True when panels are generating: on above 50 W, off below 20 W, after the state has held for `switchHoldSeconds` |
| OutletInUse | Always `true` | Required by Eve Energy |
| Eve Watts | `pv_p × 1000` | Real-time solar output in Watts |
| Eve kWh | `pv_en` | Lifetime generation in kWh |

### Grid Import

| Characteristic | Source | Notes |
|---|---|---|
| On | `max(0, net_p)` | True when importing from the grid: on above 50 W, off below 20 W, after the state has held for `switchHoldSeconds` |
| OutletInUse | Always `true` | Required by Eve Energy |
| Eve Watts | `max(0, net_p) × 1000` | Import watts; zero when net-exporting |
| Eve kWh | `posLtea3phsumKwh` | Lifetime imported energy from consumption CT meter |

### Grid Export *(optional — enabled with `accessories.grid: true`)*

| Characteristic | Source | Notes |
|---|---|---|
| On | `max(0, −net_p)` | True when net-exporting to the grid: on above 50 W, off below 20 W, after the state has held for `switchHoldSeconds` |
| OutletInUse | Always `true` | Required by Eve Energy |
| Eve Watts | `max(0, −net_p) × 1000` | Export watts; zero when importing |
| Eve kWh | `negLtea3phsumKwh` | Lifetime exported energy from consumption CT meter |

### Home Consumption *(optional — enable with `accessories.homeConsumption: true`)*

Shows the total real-time load of the home and a derived lifetime consumption figure. Enable via `accessories.homeConsumption: true` in config.

| Characteristic | Source | Notes |
|---|---|---|
| On | `site_load_p` | True when the house is drawing power (on above 50 W, off below 20 W, after the state has held for `switchHoldSeconds`; always on in practice) |
| OutletInUse | Always `true` | Required by Eve Energy |
| Eve Watts | `site_load_p × 1000` | Real-time site load in Watts |
| Eve kWh | `pv_en + posLtea3phsumKwh − negLtea3phsumKwh` | Derived lifetime consumption — all solar generated, plus grid imported, minus grid exported |

The derived kWh formula is exact without a battery: solar energy either goes to the home or the grid, so `pv_en − negLtea3phsumKwh` is the on-site solar consumed and `posLtea3phsumKwh` is the grid energy consumed. All three values already come from the existing livedata and meter caches — no additional API calls are required.

---

## Apple Home Energy & Matter

<table>
  <td>
<img width="600" alt="MatterEnergy" src="https://github.com/user-attachments/assets/fcff5f12-54cb-4431-a944-8ac04c6e044f" />
        <br><sub>Apple Energy view with other Energy accessories</sub>
    </td>
</table>

Apple Home's native **Energy** view is driven by **Matter** electrical-measurement clusters, **not** by classic HomeKit/HAP characteristics. HAP has no power or energy characteristic at all, so the Eve characteristics above (which only Eve-class apps read) can never populate it — no matter how the HomeKit accessory is shaped.

With `"matter": true`, this plugin publishes an **`ElectricalSensor`** Matter accessory for Solar Production and Grid, carrying live power and cumulative/periodic energy — no on/off, no controllable state, purely metering:

| Meter | Matter accessory | Matter power attribute | Matter energy attributes |
|---|---|---|---|
| Solar Production | "Solar Production" | `electricalPowerMeasurement.activePower` (always negative — see below) | `electricalEnergyMeasurement.cumulativeEnergyExported` |
| Grid | "Grid" | `electricalPowerMeasurement.activePower` (signed: positive = importing, negative = exporting) | `electricalEnergyMeasurement.cumulativeEnergyImported` **and** `cumulativeEnergyExported`, together |

Power is sent in milliwatts, energy in milliwatt-hours, per the Matter spec. Matter's `activePower` sign convention is positive = the accessory is *drawing* power, negative = it's *supplying* power — Solar Production only ever supplies (so its wattage is negated before being sent), and Grid does both depending on live direction.

**Home Consumption is intentionally not published over Matter.** Its energy is mathematically derived from the other two (`homeConsumptionKWh = pvEnergyKWh + gridImportKWh − gridExportKWh`, see [How It Works](#how-it-works)) rather than an independent measurement, so exposing all three to Apple Home's own aggregate power total risked double-counting rather than isolating grid draw. Home Consumption still works exactly as before in Eve/HomeKit.

**Grid Import and Grid Export stay two separate accessories in Eve/HomeKit** (see [HomeKit Accessories](#homekit-accessories) below) — that split exists only because Eve's custom Energy characteristic can't represent a negative wattage. Matter's `activePower` attribute *is* signed, so on the Matter side the grid meter is published as a single **"Grid"** accessory instead, with power flipping sign as the meter crosses between importing and exporting. Matter's cumulative/periodic *energy* attributes have no equivalent signed "net" value — Imported and Exported are always separate running totals per the Matter spec — so the Grid accessory reports both simultaneously on the one accessory rather than needing two.

**Why a pure sensor and not an outlet:** this device type has no on/off cluster, so its tile in the Home app shows "Not Supported" as its headline status — Home's tile face wants a primary characteristic (on/off, a reading, etc.) to display, and a pure measurement cluster doesn't provide one. An earlier version of this feature used Matter's `OnOffOutlet` device type specifically to get a tile headline (the same approach [homebridge-chargepoint](https://github.com/dacarson/homebridge-chargepoint) uses), at the cost of declaring a fake on/off state that couldn't actually be switched. That tradeoff was reversed: the tile headline isn't worth carrying dead on/off state for, as long as the wattage still rolls into the Home aggregate and — via periodic energy, below — into each accessory's own Energy-view attribution, which it does either way.

**Cumulative and periodic energy:** each meter reports both the lifetime total (`cumulativeEnergyImported`/`Exported`) and a periodic delta (`periodicEnergyImported`/`Exported`) with its own start/end timestamps. The periodic figure is what drives Apple Home's per-device energy attribution in the Energy view, not the cumulative total alone.

**Energy reporting rate:** every energy update records a Matter event, so the plugin doesn't send one on every poll. The lifetime total is sent when it changes, and at least every 15 minutes even if it hasn't. Periodic energy is added up across polls and sent as one 15-minute period. A period is sent early when a direction that was idle starts recording energy, such as at sunrise or when the grid switches from exporting to importing, so new activity shows up right away. Live power (`activePower`) still updates on every poll. This behaviour is always on and isn't affected by `evePowerUpdates`.

Requirements:

- **Homebridge 2.3.0 or later**
- **Matter enabled on this plugin's child bridge** — in the Homebridge UI: plugin settings → **Bridge Settings** → enable Matter, then pair the Matter bridge in the Home app
- An Apple Home setup on **iOS/tvOS 26 or later** for the Energy view itself

If the Matter API isn't available (older Homebridge, or Matter not enabled), the plugin detects that, logs a single informational line, and continues to work exactly as before over HomeKit/Eve.

**Upgrading from an earlier version:** since this changes the Matter device type (and merges Grid Import/Export into one accessory), Apple Home will likely need the old Matter tiles removed and the Matter bridge re-paired to pick up the new endpoints cleanly.

---

## Error Handling

The plugin is designed to be resilient to transient PVS6 failures:

- If the PVS6 is unreachable at startup, authentication retries every 30 seconds
- If mDNS discovery times out (30 s) at startup, the platform logs an error and does not start — set `host` and `serialNumber` with `autoDiscover: false` to bypass discovery
- If the device is unreachable for 2 hours and `autoDiscover` is not `false`, mDNS re-discovery runs automatically to pick up a changed IP or serial
- Overlapping poll cycles are skipped — only one request is in flight at a time
- Poll cycles are skipped (not fatal) on timeout (>10 s), JSON parse errors, or HTTP 5xx responses
- HTTP 5xx triggers a short backoff to avoid overwhelming the PVS6's embedded HTTP server
- HTTP 401 during polling triggers silent re-authentication with a 60-second backoff
- Missing fields in a partial response retain their last known-good values
- HomeKit characteristics remain visible and frozen at last-known values during outages

---

## Building from Source

```bash
git clone https://github.com/dacarson/homebridge-pvs6.git
cd homebridge-pvs6
npm install
npm run build
```

To run the unit tests:

```bash
npm test
```

To develop with live rebuilds:

```bash
npm run watch
```

---

## Related Plugins

- [homebridge-rainforest-eagle3](https://github.com/dacarson/homebridge-rainforest-eagle3) — Rainforest EAGLE-200 grid meter, designed to sit alongside this plugin in Apple Home

---

## License

Apache-2.0
