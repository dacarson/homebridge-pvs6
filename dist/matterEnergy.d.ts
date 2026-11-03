/**
 * matterEnergy.ts
 *
 * Publishes a PVS6 meter (solar, grid, home consumption) to Matter
 * controllers as an ElectricalSensor reporting live power and cumulative /
 * periodic energy, so it feeds the Apple Home Energy view (iOS 26+).
 *
 * Background
 * ----------
 * Apple Home's Energy view is driven by Matter electrical-measurement
 * clusters, not by classic HomeKit/HAP characteristics. HAP has no native
 * power/energy characteristic, so the Eve custom characteristics this plugin
 * also exposes (see eveCharacteristics.ts) are only ever read by Eve-class
 * apps and never populate the native Energy tile.
 *
 * Device type: ElectricalSensor, not OnOffOutlet
 * -----------------------------------------------
 * An earlier version of this feature declared these accessories as
 * OnOffOutlet so their tile would show a headline status (a pure metering
 * device type like ElectricalSensor has no actionable primary cluster, and
 * its tile showed "Not Supported" as a result — confirmed live). That's
 * reverted here: none of these meters are actually controllable, the on/off
 * state was only ever a workaround for the tile headline, and the "Not
 * Supported" tile is an accepted tradeoff as long as the wattage still rolls
 * into the Home aggregate and (via PeriodicEnergy, below) into this
 * accessory's own Energy-view attribution — which it does.
 *
 *   powerW    -> electricalPowerMeasurement.activePower                        (mW, signed)
 *   energyKWh -> electricalEnergyMeasurement.cumulativeEnergyImported.energy   (mWh)
 *             and/or .cumulativeEnergyExported.energy, depending on this
 *             meter's direction (see EnergyDirection below).
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
 * selects ExportedEnergy + CumulativeEnergy, and both together (for a
 * bidirectional meter) select both pairs at once. The grid meter omits
 * voltage and current. Solar publishes the production meter's line voltage
 * and an active current derived from the same power reading (I = P / V).
 *
 * Imported vs. exported energy is always two separate attributes
 * ------------------------------------------------------------
 * `activePower` is a signed attribute (positive = importing, negative =
 * exporting), so a single bidirectional meter — the grid meter — can report
 * live direction with one accessory. Cumulative/periodic *energy* has no
 * equivalent signed "net" attribute, though: Imported and Exported are
 * distinct lifetime running totals per the Matter spec (you don't want a
 * day's production and consumption cancelling each other out), so a
 * bidirectional meter still declares both `cumulativeEnergyImported` and
 * `cumulativeEnergyExported` (and their periodic counterparts) together on
 * the same cluster. See EnergyDirection's 'bidirectional' case below — this
 * is how the grid meter is published as a single Matter accessory even
 * though it remains two separate accessories in Eve/HomeKit (Grid Import /
 * Grid Export), since that split is purely about Eve's inability to
 * represent a negative watt value, not a Matter limitation.
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
 * would not retroactively add the feature. register() therefore seeds a
 * zero-energy periodic fragment (no timestamps).
 *
 * Event rate
 * ----------
 * Homebridge sends every electricalEnergyMeasurement update through
 * matter.js setMeasurement(), which emits a CumulativeEnergyMeasured /
 * PeriodicEnergyMeasured event for each energy field passed — changed or
 * not. update() therefore asks EnergyEventScheduler (energyEvents.ts) which
 * fields are due: cumulative totals only when they change or every 15
 * minutes, and periodic energy summed into 15-minute periods (sent early
 * when an idle direction becomes active). Live activePower is unaffected
 * and still updates on every poll; it is a plain attribute with no event.
 *
 * Solar production on Homebridge 2.5.0+
 * --------------------------------------
 * Homebridge 2.5.0 adds Matter's SolarPower device type (spec §14.3). When
 * this bridge is asked for a solar device and api.versionGreaterOrEqual
 * ('2.5.0') is true, register() publishes that type instead of a standalone
 * ElectricalSensor. SolarPower is composed: a wired PowerSource for the
 * inverter, plus an ElectricalSensor part ('meter') that carries the same
 * power and exported-energy clusters as before. Its voltage is the production
 * meter's line-to-line reading (v12V). Its active current is that power
 * divided by that voltage, with the same sign as activePower. The production
 * meter's phase currents stay at 0 while it is generating, so they are not
 * used. Older Homebridge builds, and the grid meter, stay on ElectricalSensor.
 *
 * Requirements
 * ------------
 * - Homebridge 2.3.0+ (2.5.0+ for the SolarPower device type)
 * - Matter enabled on this plugin's child bridge (Homebridge UI ->
 *   plugin settings -> Bridge Settings -> enable Matter)
 *
 * Everything here is feature-detected and guarded: on a Homebridge build
 * without the Matter API, or with Matter disabled, isSupported() returns
 * false and the plugin runs HAP/Eve-only exactly as before.
 */
import type { API, Logger } from 'homebridge';
export type EnergyDirection = 'imported' | 'exported' | 'bidirectional';
export interface EnergyReadings {
    /** Signed for a 'bidirectional' meter (positive = importing, negative = exporting). */
    powerW: number;
    /** Required when direction is 'imported' or 'bidirectional'. */
    importedEnergyKWh?: number;
    /** Required when direction is 'exported' or 'bidirectional'. */
    exportedEnergyKWh?: number;
    /**
     * Line voltage in volts. Solar passes the production meter's v12V.
     * Null is "no reading"; omit the field for a meter that does not report it.
     * Active current is then powerW / voltageV.
     */
    voltageV?: number | null;
}
export declare class MatterEnergyBridge {
    private readonly log;
    private readonly direction;
    private readonly preferSolarDevice;
    private readonly api;
    private uuid;
    private registered;
    private warnedUpdate;
    private meterPartId;
    private readonly energyEvents;
    constructor(api: API, log: Logger, direction: EnergyDirection, preferSolarDevice?: boolean);
    /**
     * Homebridge 2.5.0+ exposes deviceTypes.SolarPower. Older builds keep the
     * ElectricalSensor meter.
     */
    private useSolarDevice;
    private kinds;
    /**
     * Whether this Homebridge build exposes everything needed to publish this
     * meter. Logs at debug level so unsupported builds stay quiet.
     */
    isSupported(): boolean;
    private initialClusters;
    private solarParts;
    /**
     * Register this meter as a Matter accessory. Solar production on
     * Homebridge 2.5.0+ is a SolarPower device; everything else is an
     * ElectricalSensor.
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