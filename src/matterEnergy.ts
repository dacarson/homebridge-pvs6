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

const PLUGIN_NAME = 'homebridge-pvs6';
const PLATFORM_NAME = 'PVS6';

/** Matter expresses power in milliwatts. */
function wToMilliW(value: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) : 0;
}

/** Matter expresses energy in milliwatt-hours; PVS6 readings are in kWh. */
function kWhToMilliWh(value: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.max(0, n) * 1_000_000) : 0;
}

// Which way energy flows through this meter, from the meter's own point of
// view: solar and grid-export meters push energy out (exported); grid-import
// and home-consumption meters bring energy in (imported).
export type EnergyDirection = 'imported' | 'exported';

export interface EnergyReadings {
  powerW: number;
  energyKWh: number;
}

interface MatterAccessoryClusters {
  electricalPowerMeasurement: { activePower: number };
  electricalEnergyMeasurement:
    | { cumulativeEnergyImported: { energy: number } }
    | { cumulativeEnergyExported: { energy: number } };
}

interface MatterAccessoryDefinition {
  UUID: string;
  displayName: string;
  deviceType: unknown;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  clusters: MatterAccessoryClusters;
}

// Minimal shape of the subset of Homebridge's Matter plugin API this module
// uses. Not imported from 'homebridge' because the type declarations for
// api.matter only ship with Homebridge 2.2+; this keeps the plugin buildable
// against older @types without pulling in a hard dependency on them.
interface MatterAPILike {
  deviceTypes: { ElectricalSensor?: unknown };
  registerPlatformAccessories: (
    pluginIdentifier: string,
    platformName: string,
    accessories: MatterAccessoryDefinition[],
  ) => Promise<void>;
  updateAccessoryState: (uuid: string, cluster: string, state: unknown) => Promise<void>;
  uuid: { generate: (seed: string) => string };
}

type APIWithMatter = API & { matter?: MatterAPILike };

export class MatterEnergyBridge {
  private readonly api: APIWithMatter;
  private uuid: string | null = null;
  private registered = false;
  private warnedUpdate = false;

  constructor(
    api: API,
    private readonly log: Logger,
    private readonly direction: EnergyDirection,
  ) {
    this.api = api as APIWithMatter;
  }

  /**
   * Whether this Homebridge build exposes everything needed to publish an
   * electrical sensor. Logs at debug level so unsupported builds stay quiet.
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

  private buildClusters(r: EnergyReadings): MatterAccessoryClusters {
    const energy = { energy: kWhToMilliWh(r.energyKWh) };
    return {
      electricalPowerMeasurement: { activePower: wToMilliW(r.powerW) },
      electricalEnergyMeasurement:
        this.direction === 'imported'
          ? { cumulativeEnergyImported: energy }
          : { cumulativeEnergyExported: energy },
    };
  }

  /**
   * Register this meter as a Matter electrical sensor.
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

    const accessory: MatterAccessoryDefinition = {
      UUID: this.uuid,
      displayName,
      deviceType: matter.deviceTypes.ElectricalSensor,
      serialNumber,
      manufacturer: 'SunStrong',
      model: 'PVS6',
      clusters: this.buildClusters(readings),
    };

    try {
      await matter.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.registered = true;
      this.log.info(`[matter] Published "${displayName}" as a Matter electrical sensor — live power/energy should appear in the Apple Home Energy view.`);
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

    const clusters = this.buildClusters(readings);

    try {
      await Promise.all([
        matter.updateAccessoryState(this.uuid, 'electricalPowerMeasurement', clusters.electricalPowerMeasurement),
        matter.updateAccessoryState(this.uuid, 'electricalEnergyMeasurement', clusters.electricalEnergyMeasurement),
      ]);
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
