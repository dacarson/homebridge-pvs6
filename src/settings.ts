import { PlatformConfig } from 'homebridge';

export const PLATFORM_NAME = 'PVS6';
export const PLUGIN_NAME = 'homebridge-pvs6';

export interface PVS6Config extends PlatformConfig {
  host: string;
  serialNumber: string;
  pollInterval?: number;
  accessories?: {
    solar?: boolean;
    grid?: boolean;
  };
  solarName?: string;
  gridName?: string;
}
