import { PlatformConfig } from 'homebridge';

export const PLATFORM_NAME = 'PVS6';
export const PLUGIN_NAME = 'homebridge-pvs6';

export interface PVS6Config extends PlatformConfig {
  autoDiscover?: boolean;
  host?: string;
  serialNumber?: string;
  pollInterval?: number;
  matter?: boolean;
  evePowerUpdates?: 'throttled' | 'pollOnly' | 'live';  // default: 'throttled'
  minChangeWatts?: number;      // default: 25
  minChangePercent?: number;    // default: 2
  minChangeKwh?: number;        // default: 0.1
  switchHoldSeconds?: number;   // default: 60 (0 = disabled)
  accessories?: {
    grid?: boolean;             // enables/disables the grid pair (Import + Export) as a unit
    homeConsumption?: boolean;  // enables/disables the Home Consumption accessory (default: false)
  };
  solarName?: string;
  gridName?: string;
  gridExportName?: string;
  homeConsumptionName?: string;
}
