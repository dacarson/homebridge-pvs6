import { PlatformConfig } from 'homebridge';
export declare const PLATFORM_NAME = "PVS6";
export declare const PLUGIN_NAME = "homebridge-pvs6";
export interface PVS6Config extends PlatformConfig {
    host: string;
    serialNumber: string;
    pollInterval?: number;
    accessories?: {
        grid?: boolean;
    };
    solarName?: string;
    gridName?: string;
    gridExportName?: string;
}
//# sourceMappingURL=settings.d.ts.map