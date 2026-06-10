import { PlatformConfig } from 'homebridge';

export const PLATFORM_NAME = 'PVS6';
export const PLUGIN_NAME = 'homebridge-pvs6';

export interface PVS6Config extends PlatformConfig {
  autoDiscover?: boolean;
  host?: string;
  serialNumber?: string;
  pollInterval?: number;
  accessories?: {
    grid?: boolean;  // enables/disables the grid pair (Import + Export) as a unit
  };
  solarName?: string;
  gridName?: string;
  gridExportName?: string;
}
