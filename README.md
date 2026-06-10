# homebridge-pvs6

A [Homebridge](https://homebridge.io) plugin for the [SunStrong PVS6](https://sunstrong.com) solar monitoring system. Exposes solar production and grid metering as **Eve Energy** accessories in Apple HomeKit, with real-time power, cumulative energy, voltage, and native Eve app history.

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
- Import and Export accessories are always registered together as a pair, making import/export history immediately readable as separate graphs
- Up to 7 days of native power history in the Eve app via [fakegato-history](https://github.com/simont77/fakegato-history)
- Polls the PVS6 **local** FCGI API — no SunStrong Connect, no cloud dependency
- **Auto-discovers** the PVS6 on your local network via mDNS — no IP address or serial number required in config
- Automatically identifies production and consumption CT meters from the PVS6 device list
- Designed to complement [homebridge-rainforest-eagle3](https://github.com/dacarson/homebridge-rainforest-eagle3) for a complete solar + grid picture in Apple Home

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
- **Meter data** — per-phase detail from the CT meters (voltage, cumulative energy)

The plugin automatically identifies the production meter (model suffix `p`, e.g. `PVS6M0400p`) and consumption meter (model suffix `c`, e.g. `PVS6M0400c`) from the device list.

All accessories render as **smart plugs** in Apple Home:

- **Solar Production** — always registered; `On` when the panels are producing power
- **Grid Import** — `On` when importing from the grid; zero watts when net-exporting
- **Grid Export** — `On` when net-exporting solar to the grid; zero watts when importing

Grid Import and Grid Export are always registered together — enabling `accessories.grid` creates both.

---

## Requirements

- [Homebridge](https://homebridge.io) v2.0 or later
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
      "solarName": "Solar Production",
      "gridName": "Grid Meter - Import",
      "gridExportName": "Grid Meter - Export"
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
| `accessories.grid` | boolean | no | `true` | Enable the Grid Import + Grid Export accessory pair. Set `false` to disable both |
| `solarName` | string | no | `"Solar Production"` | HomeKit display name for the Solar Production accessory |
| `gridName` | string | no | `"Grid Meter - Import"` | HomeKit display name for the Grid Import accessory |
| `gridExportName` | string | no | `"Grid Meter - Export"` | HomeKit display name for the Grid Export accessory |

\* Required when `autoDiscover` is `false`.

### Finding Your Serial Number

The serial number is printed on the label on the PVS6 unit (format: `ZT...`). It is also visible in the SunStrong Connect app and is broadcast by the PVS6 itself via mDNS (which is how Auto Discover retrieves it). The last 5 characters are used as the local API login password — no separate password configuration is required.

---

## HomeKit Accessories

### Solar Production

| Characteristic | Source | Notes |
|---|---|---|
| On | `pv_p > 0` | True when panels are actively generating |
| OutletInUse | Always `true` | Required by Eve Energy |
| Eve Watts | `pv_p × 1000` | Real-time solar output in Watts |
| Eve kWh | `pv_en` | Lifetime generation in kWh |

### Grid Import

| Characteristic | Source | Notes |
|---|---|---|
| On | `net_p > 0` | True when importing from grid |
| OutletInUse | Always `true` | Required by Eve Energy |
| Eve Watts | `max(0, net_p) × 1000` | Import watts; zero when net-exporting |
| Eve kWh | `posLtea3phsumKwh` | Lifetime imported energy from consumption CT meter |

### Grid Export *(optional — enabled with `accessories.grid: true`)*

| Characteristic | Source | Notes |
|---|---|---|
| On | `net_p < 0` | True when net-exporting solar to the grid |
| OutletInUse | Always `true` | Required by Eve Energy |
| Eve Watts | `max(0, −net_p) × 1000` | Export watts; zero when importing |
| Eve kWh | `negLtea3phsumKwh` | Lifetime exported energy from consumption CT meter |

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
