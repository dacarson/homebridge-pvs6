# Changelog

## 1.5.0 — unreleased

Reduces HomeKit and Matter traffic. The plugin used to send about 1,000 HomeKit events an hour, and this release cuts that while keeping automations working.

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

### Fixed

- **Matter:** energy events are no longer recorded on every poll. Lifetime totals are sent when they change or every 15 minutes, and periodic energy is reported in 15-minute periods. A period is sent early when an idle direction becomes active.
- **Matter:** the same periodic-energy interval is no longer reported several times.
- **Matter:** the first periodic-energy interval after startup no longer reports the meter's entire lifetime total.
