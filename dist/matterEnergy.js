"use strict";
/**
 * matterEnergy.ts
 *
 * Publishes a PVS6 meter (solar, grid import, grid export, home consumption)
 * to Matter controllers as an outlet reporting live power and cumulative
 * energy, so it appears in the Apple Home Energy view (iOS 26+) with live
 * watts on its tile.
 *
 * Background
 * ----------
 * Apple Home's Energy view is driven by Matter electrical-measurement
 * clusters, not by classic HomeKit/HAP characteristics. HAP has no native
 * power/energy characteristic, so the Eve custom characteristics this plugin
 * also exposes (see eveCharacteristics.ts) are only ever read by Eve-class
 * apps and never populate the native Energy tile.
 *
 * Homebridge 2.2.0 added the ElectricalPowerMeasurement / ElectricalEnergyMeasurement
 * clusters to its Matter plugin API. A pure metering device type with no
 * actionable primary cluster (e.g. ElectricalSensor, declaring only the
 * measurement clusters) does register and its wattage does roll into the
 * Home app's room/home aggregate power total — but as verified live, its
 * tile shows "Not Supported" as the headline status, because Home's tile
 * face wants a primary characteristic (on/off, a sensor reading, etc.) to
 * show, and pure measurement clusters don't provide one. Declaring `onOff`
 * via the OnOffOutlet device type (the same approach homebridge-chargepoint
 * uses, confirmed working) gives Home that headline, while these clusters
 * still populate the Energy view exactly as before:
 *
 *   on       -> onOff.onOff                                             (bool)
 *   powerW   -> electricalPowerMeasurement.activePower                       (mW)
 *   energyKWh -> electricalEnergyMeasurement.cumulativeEnergyImported.energy  (mWh)
 *             or .cumulativeEnergyExported.energy, depending on this meter's
 *             direction (see EnergyDirection below).
 *
 * `on` mirrors each accessory's own HAP `On` characteristic exactly (true
 * when lastPowerW > 0) — see the matching logic in each *Accessory.ts file.
 * None of these meters are actually controllable, so a set command is
 * accepted (so the controller isn't left hanging) and logged as rejected;
 * the next poll pushes the true state back. See _rejectControl().
 *
 * Matter expresses power in milliwatts and energy in milliwatt-hours, hence
 * the x1000 / x1,000,000 conversions. cumulativeEnergyImported/Exported are
 * themselves structs (EnergyMeasurementStruct — { energy, startTimestamp?,
 * endTimestamp?, ... }), not plain numbers: Homebridge's updateAccessoryState()
 * accepts and normalizes a flat number for convenience, but the *initial*
 * state passed at registration goes straight to matter.js's struct-typed
 * attribute and must already be an object, or registration fails with
 * "Cannot manage number because it is not a struct".
 *
 * Homebridge derives the mandatory cluster attributes (powerMode, accuracy,
 * numberOfMeasurementTypes) and the feature-gated ElectricalEnergyMeasurement
 * features from the declared state — declaring `cumulativeEnergyImported`
 * selects the ImportedEnergy + CumulativeEnergy features, `cumulativeEnergyExported`
 * selects ExportedEnergy + CumulativeEnergy. No voltage/current data is
 * available from the PVS6 varserver reliably enough to publish, so only
 * activePower is declared; voltage/activeCurrent are optional per the
 * Matter spec and are simply omitted.
 *
 * Cumulative vs. periodic energy
 * ------------------------------
 * Alongside the cumulative (lifetime) total, this module also declares the
 * PeriodicEnergy feature (`periodicEnergyImported`/`periodicEnergyExported`)
 * — a per-interval delta with its own start/end timestamps. Per prior art in
 * homebridge-shelly-matter (github.com/keremerkan/homebridge-shelly-matter,
 * shellyAccessory.ts), this is what drives Apple Home's per-device energy
 * attribution in the Energy view, not the cumulative total alone. Matter
 * features compose once at registration, so PeriodicEnergy must already be
 * present in the *initial* cluster state passed to registerPlatformAccessories()
 * — declaring it for the first time in a later updateAccessoryState() call
 * would not retroactively add the feature. buildClusters() therefore seeds a
 * zero-energy periodic fragment (no timestamps yet) on its very first call,
 * which is always the one register() makes, before any real reading exists
 * to diff against; every call after that computes a real delta against the
 * last *periodic* baseline (not the last poll), throttled to at most once
 * per MIN_PERIODIC_INTERVAL_S so a short poll interval (default 10s, minimum
 * 5s) doesn't turn into excessive Matter event/state churn compared to a
 * device that naturally reports once a minute.
 *
 * Requirements
 * ------------
 * - Homebridge 2.3.0+
 * - Matter enabled on this plugin's child bridge (Homebridge UI ->
 *   plugin settings -> Bridge Settings -> enable Matter)
 *
 * Everything here is feature-detected and guarded: on a Homebridge build
 * without the Matter API, or with Matter disabled, isSupported() returns
 * false and the plugin runs HAP/Eve-only exactly as before.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatterEnergyBridge = void 0;
const PLUGIN_NAME = 'homebridge-pvs6';
const PLATFORM_NAME = 'PVS6';
/** Matter expresses power in milliwatts. */
function wToMilliW(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 1000) : 0;
}
/** Matter expresses energy in milliwatt-hours; PVS6 readings are in kWh. */
function kWhToMilliWh(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(Math.max(0, n) * 1000000) : 0;
}
class MatterEnergyBridge {
    constructor(api, log, direction) {
        this.log = log;
        this.direction = direction;
        this.uuid = null;
        this.displayName = '';
        this.registered = false;
        this.warnedUpdate = false;
        // Periodic-energy bookkeeping — see the "Cumulative vs. periodic energy"
        // note at the top of this file. lastPeriodicBaselineKWh/-TimestampS mark
        // the start of the current periodic window; lastPeriodic is the most
        // recently computed fragment, resent unchanged between periodic reports.
        this.lastPeriodicBaselineKWh = null;
        this.lastPeriodicTimestampS = null;
        this.lastPeriodic = { energy: 0 };
        this.api = api;
    }
    /**
     * Whether this Homebridge build exposes everything needed to publish this
     * meter. Logs at debug level so unsupported builds stay quiet.
     */
    isSupported() {
        const matter = this.api.matter;
        if (!matter) {
            this.log.debug('[matter] api.matter unavailable — Matter energy export disabled. Requires Homebridge 2.3.0+ with Matter enabled on this plugin\'s child bridge.');
            return false;
        }
        if (!matter.deviceTypes?.OnOffOutlet) {
            this.log.debug('[matter] api.matter.deviceTypes.OnOffOutlet unavailable — Matter energy export disabled. Requires a newer Homebridge build.');
            return false;
        }
        if (typeof matter.registerPlatformAccessories !== 'function' || typeof matter.updateAccessoryState !== 'function') {
            this.log.debug('[matter] Matter registration/update API unavailable — Matter energy export disabled.');
            return false;
        }
        return true;
    }
    buildClusters(r) {
        const cumulative = { energy: kWhToMilliWh(r.energyKWh) };
        const periodic = this.computePeriodic(r.energyKWh);
        const energyField = this.direction === 'imported'
            ? { cumulativeEnergyImported: cumulative, periodicEnergyImported: periodic }
            : { cumulativeEnergyExported: cumulative, periodicEnergyExported: periodic };
        return {
            onOff: { onOff: r.on },
            electricalPowerMeasurement: { activePower: wToMilliW(r.powerW) },
            electricalEnergyMeasurement: energyField,
        };
    }
    /**
     * Compute (or, between periodic reports, just return the last computed)
     * periodic-energy fragment. The very first call — always from register(),
     * before any real reading exists — seeds a zero-energy fragment with no
     * timestamps, purely so the PeriodicEnergy feature composes at
     * registration. Every call after that reports a real delta against the
     * last periodic baseline once MIN_PERIODIC_INTERVAL_S has elapsed.
     */
    computePeriodic(energyKWh) {
        const nowS = Math.floor(Date.now() / 1000);
        if (this.lastPeriodicBaselineKWh === null || this.lastPeriodicTimestampS === null) {
            this.lastPeriodicBaselineKWh = energyKWh;
            this.lastPeriodicTimestampS = nowS;
            return this.lastPeriodic;
        }
        if (nowS - this.lastPeriodicTimestampS >= MatterEnergyBridge.MIN_PERIODIC_INTERVAL_S) {
            const deltaKWh = Math.max(0, energyKWh - this.lastPeriodicBaselineKWh);
            this.lastPeriodic = {
                energy: kWhToMilliWh(deltaKWh),
                startTimestamp: this.lastPeriodicTimestampS,
                endTimestamp: nowS,
            };
            this.lastPeriodicBaselineKWh = energyKWh;
            this.lastPeriodicTimestampS = nowS;
        }
        return this.lastPeriodic;
    }
    /**
     * Register this meter as a Matter outlet with electrical measurements.
     *
     * @param seedKey - unique per-meter key used to derive this accessory's
     * Matter UUID, distinct from the HAP accessory's UUID
     * @param displayName
     * @param serialNumber
     * @param readings - initial readings to seed the clusters with
     */
    async register(seedKey, displayName, serialNumber, readings) {
        if (!this.isSupported())
            return false;
        const matter = this.api.matter;
        this.uuid = matter.uuid.generate(`${PLUGIN_NAME}:matter:${seedKey}`);
        this.displayName = displayName;
        const accessory = {
            UUID: this.uuid,
            displayName,
            deviceType: matter.deviceTypes.OnOffOutlet,
            serialNumber,
            manufacturer: 'SunStrong',
            model: 'PVS6',
            clusters: this.buildClusters(readings),
            handlers: {
                // None of these meters can actually be switched. Accept the command
                // so the controller isn't left hanging, warn, and let the next poll
                // push the true state back.
                onOff: {
                    on: async () => this._rejectControl(true),
                    off: async () => this._rejectControl(false),
                },
            },
        };
        try {
            await matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            this.registered = true;
            this.log.info(`[matter] Published "${displayName}" as a Matter outlet with electrical measurements — live power should appear on its tile in the Apple Home Energy view.`);
            return true;
        }
        catch (err) {
            this.log.warn(`[matter] Failed to register Matter accessory for "${displayName}" (${err instanceof Error ? err.message : err}). Continuing with HomeKit/Eve only.`);
            this.registered = false;
            return false;
        }
    }
    _rejectControl(requested) {
        this.log.warn(`[matter] Ignoring request to turn "${this.displayName}" ${requested ? 'on' : 'off'} — this meter cannot be controlled through this plugin.`);
    }
    /**
     * Push fresh readings to the registered Matter accessory. No-op until
     * registration has succeeded.
     */
    async update(readings) {
        if (!this.registered || !this.uuid)
            return;
        const matter = this.api.matter;
        if (!matter)
            return;
        const clusters = this.buildClusters(readings);
        try {
            await Promise.all([
                matter.updateAccessoryState(this.uuid, 'onOff', clusters.onOff),
                matter.updateAccessoryState(this.uuid, 'electricalPowerMeasurement', clusters.electricalPowerMeasurement),
                matter.updateAccessoryState(this.uuid, 'electricalEnergyMeasurement', clusters.electricalEnergyMeasurement),
            ]);
        }
        catch (err) {
            // Log the first failure at warn, the rest at debug, so a persistently
            // unhappy Matter server can't flood the log on every poll.
            const message = `[matter] Failed to update Matter state: ${err instanceof Error ? err.message : err}`;
            if (!this.warnedUpdate) {
                this.warnedUpdate = true;
                this.log.warn(message);
            }
            else {
                this.log.debug(message);
            }
        }
    }
}
exports.MatterEnergyBridge = MatterEnergyBridge;
MatterEnergyBridge.MIN_PERIODIC_INTERVAL_S = 60;
//# sourceMappingURL=matterEnergy.js.map