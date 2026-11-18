# Changelog

## 1.5.1 — 2026-11-18

Fixes Eve history for accessories above 6.5 kW, and records history as 10-minute averages.

### Fixed

- **Eve history no longer wraps above 6553.5 W.** Eve stores power in a 16-bit field of tenths of a watt, so a reading of, say, 9183 W was recorded as about 2630 W. History power is now capped at 6553.5 W instead, and the plugin logs once per accessory when it caps. The live Eve Watts and Eve kWh values, and the Apple Home Energy view, were never affected and are not capped. See [Eve History](README.md#eve-history).

### Changed

- **One Eve history entry every 10 minutes**, holding the time-weighted average power for that window. Before, an entry was written on every poll (every 10 seconds by default), which filled fakegato's 4032-entry buffer in about 11 hours. History now covers about 28 days.
- fakegato's own timer is disabled (`disableTimer: true`); the plugin does its own averaging.
- Gaps between polls longer than 2 minutes (or two poll intervals, if longer) are treated as no data, so an outage doesn't carry the last reading forward.

### Upgrading: clear old history in Eve

Entries recorded by earlier versions stay in Eve, including any wrapped readings above 6.5 kW. To remove them, open the accessory's history in the Eve app, tap **Edit**, and delete the old entries. New 10-minute entries keep arriving afterwards. Don't delete fakegato's `*_persist.json` files to reset history: Eve only asks for entries newer than the last one it downloaded, so it would ignore a fresh file until it caught up.

## 1.5.0 — 2026-11-04

Reduces HomeKit traffic. The plugin used to send about 1,000 HomeKit events an hour, and this release cuts that while keeping automations working.

### Changed defaults

Without any config changes, upgrading from 1.4.0 changes this behaviour:

- **Eve Watts and Eve kWh are now throttled** (`evePowerUpdates: "throttled"`). Before, both were pushed on every poll. Now they're pushed when they change by at least 25 W / 2% (Watts) or 0.1 kWh (kWh), or every 5 minutes. Eve and Home+ automations that trigger on these values still work, accurate to within those thresholds. Set `evePowerUpdates: "live"` to restore the old behaviour.
- **On switches have a deadband and a 60-second hold** (`switchHoldSeconds: 60`). Before, On was `power > 0 W` and changed on the next poll. Now it turns on above 50 W and off below 20 W, and a new state must hold for 60 seconds before it's reported. This affects Solar Production, Grid Meter - Import, Grid Meter - Export and Home Consumption. Automations triggered by these switches can fire up to 60 seconds later. Set `switchHoldSeconds: 0` to remove the hold; the deadband always applies.

### Added

- `evePowerUpdates` setting: `"throttled"` (default), `"pollOnly"` or `"live"`. `"pollOnly"` removes event notifications from the Eve characteristics for the lowest traffic, but stops automations from triggering on these values.
- `minChangeWatts`, `minChangePercent` and `minChangeKwh` thresholds for throttled mode.
- `switchHoldSeconds` setting for the On switches.
- The first poll now runs as soon as the plugin authenticates, so HomeKit has correct values at startup without waiting a full poll interval.
- Debug logging of suppressed and held updates, plus an hourly debug summary of sent vs. suppressed updates.
- Unit tests (`npm test`).
