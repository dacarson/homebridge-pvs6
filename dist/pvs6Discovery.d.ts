import { Logger } from 'homebridge';
export interface PVS6DiscoveryResult {
    host: string;
    serialNumber: string;
}
export declare function discoverPVS6(log: Logger): Promise<PVS6DiscoveryResult>;
//# sourceMappingURL=pvs6Discovery.d.ts.map