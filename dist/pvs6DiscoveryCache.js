"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDiscoveryCache = loadDiscoveryCache;
exports.saveDiscoveryCache = saveDiscoveryCache;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const CACHE_FILE_NAME = '.pvs6-discovery-cache.json';
function cachePath(api) {
    return path.join(api.user.storagePath(), CACHE_FILE_NAME);
}
// Reads a previously-cached mDNS discovery result, if any.
// Returns undefined on first run (no cache yet) or if the cache file is unreadable/malformed.
function loadDiscoveryCache(api, log) {
    try {
        const raw = fs.readFileSync(cachePath(api), 'utf8');
        const data = JSON.parse(raw);
        if (data.host && data.serialNumber) {
            return { host: data.host, serialNumber: data.serialNumber };
        }
        log.debug('Discovery cache file is malformed — ignoring');
    }
    catch (err) {
        // ENOENT just means there's no cache yet (first run); anything else is worth a debug log.
        if (err.code !== 'ENOENT') {
            log.debug(`Failed to read discovery cache: ${err}`);
        }
    }
    return undefined;
}
// Persists a successful mDNS discovery so subsequent startups can skip discovery entirely.
function saveDiscoveryCache(api, log, result) {
    try {
        fs.writeFileSync(cachePath(api), JSON.stringify(result), 'utf8');
        log.debug(`Cached PVS6 location: ${result.host} (serial: ${result.serialNumber})`);
    }
    catch (err) {
        log.warn(`Failed to write discovery cache: ${err}`);
    }
}
//# sourceMappingURL=pvs6DiscoveryCache.js.map