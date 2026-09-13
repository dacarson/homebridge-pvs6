/**
 * matterEnergy.ts
 *
 * Publishes a PVS6 meter (solar, grid import, grid export, home consumption)
 * to Matter controllers as an electrical sensor reporting live power and
 * cumulative energy, so it appears in the Apple Home Energy view (iOS 26+)
 * with live watts on its tile.
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
 * clusters to its Matter plugin API, and later releases added the
 * ElectricalSensor device type — a pure metering endpoint with no on/off
 * control, which is a better fit for a solar/grid/home meter than an outlet.
 * This module talks to that API directly:
 *
 *   powerW   -> electricalPowerMeasurement.activePower                       (mW)
 *   energyKWh -> electricalEnergyMeasurement.cumulativeEnergyImported.energy  (mWh)
 *             or .cumulativeEnergyExported.energy, depending on this meter's
 *             direction (see EnergyDirection below).
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
 * numberOfMeasurementTypes, the PowerTopology cluster) and the feature-gated
 * ElectricalEnergyMeasurement features from the declared state — declaring
 * `cumulativeEnergyImported` selects the ImportedEnergy + CumulativeEnergy
 * features, `cumulativeEnergyExported` selects ExportedEnergy + CumulativeEnergy.
 * No voltage/current data is available from the PVS6 varserver reliably
 * enough to publish, so only activePower is declared; voltage/activeCurrent
 * are optional per the Matter spec and are simply omitted.
 *
 * Requirements
 * ------------
 * - Homebridge 2.3.0+ with the ElectricalSensor device type (2.4.0+ verified)
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
    powerW: number;
    energyKWh: number;
}
export declare class MatterEnergyBridge {
    private readonly log;
    private readonly direction;
    private readonly deviceTypeOverride?;
    private readonly api;
    private uuid;
    private registered;
    private warnedUpdate;
    constructor(api: API, log: Logger, direction: EnergyDirection, deviceTypeOverride?: unknown | undefined);
    /**
     * Whether this Homebridge build exposes everything needed to publish an
     * electrical sensor. Logs at debug level so unsupported builds stay quiet.
     */
    isSupported(): boolean;
    private buildClusters;
    /**
     * Register this meter as a Matter electrical sensor.
     *
     * @param seedKey - unique per-meter key used to derive this accessory's
     * Matter UUID, distinct from the HAP accessory's UUID
     * @param displayName
     * @param serialNumber
     * @param readings - initial readings to seed the clusters with
     */
    register(seedKey: string, displayName: string, serialNumber: string, readings: EnergyReadings): Promise<boolean>;
    /**
     * Push fresh readings to the registered Matter accessory. No-op until
     * registration has succeeded.
     */
    update(readings: EnergyReadings): Promise<void>;
}
//# sourceMappingURL=matterEnergy.d.ts.map