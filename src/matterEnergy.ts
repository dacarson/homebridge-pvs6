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
import { EnergyClusterFragment, EnergyEventScheduler, EnergyKind, EnergyStruct, kWhToMilliWh } from './energyEvents';

const PLUGIN_NAME = 'homebridge-pvs6';
const PLATFORM_NAME = 'PVS6';

/** Matter expresses power in milliwatts. */
function wToMilliW(value: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) : 0;
}

interface PowerMeasurement {
  activePower: number;
  voltage?: number | null;
  activeCurrent?: number | null;
}

// Voltage is millivolts. Active current is milliamps, I = P / V, and it
// carries activePower's sign. A missing or non-positive voltage is "no reading".
function powerMeasurement(r: EnergyReadings): PowerMeasurement {
  const activePower = wToMilliW(r.powerW);
  if (r.voltageV === undefined) {
    return { activePower };
  }
  const voltageV = r.voltageV;
  if (voltageV === null || !Number.isFinite(voltageV) || voltageV <= 0) {
    return { activePower, voltage: null, activeCurrent: null };
  }
  const voltage = Math.round(voltageV * 1000);
  if (voltage <= 0) {
    return { activePower, voltage: null, activeCurrent: null };
  }
  return {
    activePower,
    voltage,
    activeCurrent: Math.round(activePower / voltage * 1000),
  };
}

// Which way energy flows through this meter, from the meter's own point of
// view: solar flows out (exported), home consumption flows in (imported),
// and the grid meter flows both ways (bidirectional — see the file header
// note on imported/exported energy always being separate attributes).
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

interface MatterAccessoryClusters {
  electricalPowerMeasurement: { activePower: number; voltage?: number | null; activeCurrent?: number | null };
  electricalEnergyMeasurement: EnergyClusterFragment;
}

interface MatterAccessoryPart {
  id: string;
  displayName: string;
  deviceType: unknown;
  clusters: Record<string, unknown>;
}

interface MatterAccessoryDefinition {
  UUID: string;
  displayName: string;
  deviceType: unknown;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  clusters?: MatterAccessoryClusters;
  parts?: MatterAccessoryPart[];
}

interface MatterDeviceTypes {
  ElectricalSensor?: unknown;
  SolarPower?: unknown;
  PowerSource?: unknown;
}

// Minimal shape of the subset of Homebridge's Matter plugin API this module
// uses. Not imported from 'homebridge' because the type declarations for
// api.matter only ship with Homebridge 2.2+; this keeps the plugin buildable
// against older @types without pulling in a hard dependency on them.
interface MatterAPILike {
  deviceTypes: MatterDeviceTypes;
  registerPlatformAccessories: (
    pluginIdentifier: string,
    platformName: string,
    accessories: MatterAccessoryDefinition[],
  ) => Promise<void>;
  updateAccessoryState: (uuid: string, cluster: string, state: unknown, partId?: string) => Promise<void>;
  uuid: { generate: (seed: string) => string };
}

type APIWithMatter = API & { matter?: MatterAPILike };

export class MatterEnergyBridge {
  private readonly api: APIWithMatter;
  private uuid: string | null = null;
  private registered = false;
  private warnedUpdate = false;
  // Set when this accessory is a composed SolarPower device. Measurement
  // updates then target the 'meter' part instead of the parent endpoint.
  private meterPartId: string | undefined;

  // Decides which energy fields (and so which Matter events) each update sends.
  private readonly energyEvents: EnergyEventScheduler;

  constructor(
    api: API,
    private readonly log: Logger,
    private readonly direction: EnergyDirection,
    // Solar production asks for Matter's SolarPower device when Homebridge
    // is new enough to have it. Anything else stays an ElectricalSensor.
    private readonly preferSolarDevice = false,
  ) {
    this.api = api as APIWithMatter;
    this.energyEvents = new EnergyEventScheduler(this.kinds());
  }

  /**
   * Homebridge 2.5.0+ exposes deviceTypes.SolarPower. Older builds keep the
   * ElectricalSensor meter.
   */
  private useSolarDevice(): boolean {
    if (!this.preferSolarDevice) return false;
    if (this.api.versionGreaterOrEqual?.('2.5.0') !== true) {
      this.log.debug('[matter] Homebridge is older than 2.5.0 — publishing solar as an ElectricalSensor.');
      return false;
    }
    const types = this.api.matter?.deviceTypes;
    if (!types?.SolarPower || !types.PowerSource) {
      this.log.debug('[matter] SolarPower device type unavailable — publishing solar as an ElectricalSensor.');
      return false;
    }
    return true;
  }

  private kinds(): EnergyKind[] {
    return this.direction === 'bidirectional' ? ['imported', 'exported'] : [this.direction];
  }

  /**
   * Whether this Homebridge build exposes everything needed to publish this
   * meter. Logs at debug level so unsupported builds stay quiet.
   */
  isSupported(): boolean {
    const matter = this.api.matter;
    if (!matter) {
      this.log.debug('[matter] api.matter unavailable — Matter energy export disabled. Requires Homebridge 2.3.0+ with Matter enabled on this plugin\'s child bridge.');
      return false;
    }
    if (!matter.deviceTypes?.ElectricalSensor) {
      this.log.debug('[matter] api.matter.deviceTypes.ElectricalSensor unavailable — Matter energy export disabled. Requires a newer Homebridge build.');
      return false;
    }
    if (typeof matter.registerPlatformAccessories !== 'function' || typeof matter.updateAccessoryState !== 'function') {
      this.log.debug('[matter] Matter registration/update API unavailable — Matter energy export disabled.');
      return false;
    }
    return true;
  }

  // Initial cluster state for registration: cumulative totals plus a
  // zero-energy periodic seed so the PeriodicEnergy feature composes.
  private initialClusters(r: EnergyReadings): MatterAccessoryClusters {
    const energyField: EnergyClusterFragment = {};
    const seed: EnergyStruct = { energy: 0 };
    for (const kind of this.kinds()) {
      if (kind === 'imported') {
        energyField.cumulativeEnergyImported = { energy: kWhToMilliWh(r.importedEnergyKWh ?? 0) };
        energyField.periodicEnergyImported = seed;
      } else {
        energyField.cumulativeEnergyExported = { energy: kWhToMilliWh(r.exportedEnergyKWh ?? 0) };
        energyField.periodicEnergyExported = seed;
      }
    }

    return {
      electricalPowerMeasurement: powerMeasurement(r),
      electricalEnergyMeasurement: energyField,
    };
  }

  // SolarPower (spec §14.3) is the parent. Its parts are a wired inverter
  // and the generation meter. The meter part carries line voltage and the
  // current derived from it.
  private solarParts(readings: EnergyReadings): MatterAccessoryPart[] {
    const matter = this.api.matter!;
    const clusters = this.initialClusters(readings);
    return [
      {
        id: 'inverter',
        displayName: 'Inverter',
        deviceType: matter.deviceTypes.PowerSource,
        clusters: {
          powerSource: { status: 1, order: 0, description: 'Inverter', wiredCurrentType: 0 },
        },
      },
      {
        id: 'meter',
        displayName: 'Generation',
        deviceType: matter.deviceTypes.ElectricalSensor,
        clusters: {
          electricalPowerMeasurement: clusters.electricalPowerMeasurement,
          electricalEnergyMeasurement: clusters.electricalEnergyMeasurement,
        },
      },
    ];
  }

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
  async register(seedKey: string, displayName: string, serialNumber: string, readings: EnergyReadings): Promise<boolean> {
    if (!this.isSupported()) return false;
    const matter = this.api.matter!;
    this.uuid = matter.uuid.generate(`${PLUGIN_NAME}:matter:${seedKey}`);

    const solar = this.useSolarDevice();
    const accessory: MatterAccessoryDefinition = {
      UUID: this.uuid,
      displayName,
      deviceType: solar ? matter.deviceTypes.SolarPower : matter.deviceTypes.ElectricalSensor,
      serialNumber,
      manufacturer: 'SunStrong',
      model: 'PVS6',
      ...(solar
        ? { parts: this.solarParts(readings) }
        : { clusters: this.initialClusters(readings) }),
    };

    try {
      await matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.registered = true;
      this.meterPartId = solar ? 'meter' : undefined;
      const kind = solar ? 'solar power device' : 'electrical sensor';
      this.log.info(`[matter] Published "${displayName}" as a Matter ${kind} — live power should feed the Apple Home Energy view.`);
      return true;
    } catch (err) {
      this.log.warn(`[matter] Failed to register Matter accessory for "${displayName}" (${err instanceof Error ? err.message : err}). Continuing with HomeKit/Eve only.`);
      this.registered = false;
      return false;
    }
  }

  /**
   * Push fresh readings to the registered Matter accessory. No-op until
   * registration has succeeded.
   */
  async update(readings: EnergyReadings): Promise<void> {
    if (!this.registered || !this.uuid) return;
    const matter = this.api.matter;
    if (!matter) return;

    const partId = this.meterPartId;
    const updates = [
      matter.updateAccessoryState(this.uuid, 'electricalPowerMeasurement', powerMeasurement(readings), partId),
    ];
    // Only the energy fields that are due — each one sent emits a Matter event.
    const energy = this.energyEvents.next({
      imported: readings.importedEnergyKWh,
      exported: readings.exportedEnergyKWh,
    });
    if (energy) {
      updates.push(matter.updateAccessoryState(this.uuid, 'electricalEnergyMeasurement', energy, partId));
    }

    try {
      await Promise.all(updates);
    } catch (err) {
      // Log the first failure at warn, the rest at debug, so a persistently
      // unhappy Matter server can't flood the log on every poll.
      const message = `[matter] Failed to update Matter state: ${err instanceof Error ? err.message : err}`;
      if (!this.warnedUpdate) {
        this.warnedUpdate = true;
        this.log.warn(message);
      } else {
        this.log.debug(message);
      }
    }
  }
}
