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
import type { API, Logger } from 'homebridge';
export type EnergyDirection = 'imported' | 'exported';
export interface EnergyReadings {
    on: boolean;
    powerW: number;
    energyKWh: number;
}
export declare class MatterEnergyBridge {
    private readonly log;
    private readonly direction;
    private static readonly MIN_PERIODIC_INTERVAL_S;
    private readonly api;
    private uuid;
    private displayName;
    private registered;
    private warnedUpdate;
    private lastPeriodicBaselineKWh;
    private lastPeriodicTimestampS;
    private lastPeriodic;
    constructor(api: API, log: Logger, direction: EnergyDirection);
    /**
     * Whether this Homebridge build exposes everything needed to publish this
     * meter. Logs at debug level so unsupported builds stay quiet.
     */
    isSupported(): boolean;
    private buildClusters;
    /**
     * Compute (or, between periodic reports, just return the last computed)
     * periodic-energy fragment. The very first call — always from register(),
     * before any real reading exists — seeds a zero-energy fragment with no
     * timestamps, purely so the PeriodicEnergy feature composes at
     * registration. Every call after that reports a real delta against the
     * last periodic baseline once MIN_PERIODIC_INTERVAL_S has elapsed.
     */
    private computePeriodic;
    /**
     * Register this meter as a Matter outlet with electrical measurements.
     *
     * @param seedKey - unique per-meter key used to derive this accessory's
     * Matter UUID, distinct from the HAP accessory's UUID
     * @param displayName
     * @param serialNumber
     * @param readings - initial readings to seed the clusters with
     */
    register(seedKey: string, displayName: string, serialNumber: string, readings: EnergyReadings): Promise<boolean>;
    private _rejectControl;
    /**
     * Push fresh readings to the registered Matter accessory. No-op until
     * registration has succeeded.
     */
    update(readings: EnergyReadings): Promise<void>;
}
//# sourceMappingURL=matterEnergy.d.ts.map