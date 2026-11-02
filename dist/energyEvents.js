"use strict";
// Decides when to send ElectricalEnergyMeasurement (cluster 0x91) updates.
//
// Homebridge routes every electricalEnergyMeasurement update through matter.js
// setMeasurement(), which emits a CumulativeEnergyMeasured and/or
// PeriodicEnergyMeasured event for each field present, whether or not the
// value changed. Sending both fields on every poll therefore records a pair of
// events every ~10 s, nearly all of them repeats (an unchanged total, or a
// zero-energy period). This scheduler returns only the fields that carry
// new information:
//
// - Cumulative energy: sent when any direction's total has changed since the
//   last one sent, or CUMULATIVE_HEARTBEAT_MS has passed (heartbeat).
// - Periodic energy: per-poll deltas are summed, and one period covering the
//   whole span since the previous period is sent every PERIODIC_PERIOD_MS.
//   A period is sent early when a direction that was idle (zero energy in its
//   last reported period) starts accumulating energy, e.g. at sunrise or when
//   the grid flips from export to import, so new activity shows up promptly.
//
// Pure (no Homebridge dependency, injectable clock) so it can be unit-tested.
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnergyEventScheduler = exports.PERIODIC_PERIOD_MS = exports.CUMULATIVE_HEARTBEAT_MS = void 0;
exports.kWhToMilliWh = kWhToMilliWh;
exports.CUMULATIVE_HEARTBEAT_MS = 15 * 60 * 1000;
exports.PERIODIC_PERIOD_MS = 15 * 60 * 1000;
/** Matter expresses energy in milliwatt-hours; PVS6 readings are in kWh. */
function kWhToMilliWh(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(Math.max(0, n) * 1000000) : 0;
}
const CUMULATIVE_KEY = { imported: 'cumulativeEnergyImported', exported: 'cumulativeEnergyExported' };
const PERIODIC_KEY = { imported: 'periodicEnergyImported', exported: 'periodicEnergyExported' };
class EnergyEventScheduler {
    constructor(kinds, now = Date.now) {
        this.kinds = kinds;
        this.now = now;
        // Cumulative: last totals sent (mWh) and when.
        this.lastCumulativeMilliWh = {};
        this.lastCumulativeTime = null;
        // Periodic: previous reading (kWh) per direction, the energy summed since
        // the current period started, and whether each direction's last reported
        // period was empty.
        this.previousKWh = {};
        this.accumulatedKWh = { imported: 0, exported: 0 };
        this.idle = { imported: true, exported: true };
        this.periodStart = null;
    }
    /**
     * Feed the latest lifetime readings (kWh, one per direction this meter
     * reports). Returns the cluster fields to send, or null if nothing is due.
     */
    next(readingsKWh) {
        const now = this.now();
        const fragment = {};
        // Cumulative: changed or heartbeat due. All directions are sent together
        // so the event carries a consistent snapshot.
        const totals = this.kinds.map(k => [k, kWhToMilliWh(readingsKWh[k] ?? 0)]);
        const changed = totals.some(([k, mWh]) => this.lastCumulativeMilliWh[k] !== mWh);
        const heartbeatDue = this.lastCumulativeTime === null || now - this.lastCumulativeTime >= exports.CUMULATIVE_HEARTBEAT_MS;
        if (changed || heartbeatDue) {
            for (const [k, mWh] of totals) {
                fragment[CUMULATIVE_KEY[k]] = { energy: mWh };
                this.lastCumulativeMilliWh[k] = mWh;
            }
            this.lastCumulativeTime = now;
        }
        // Periodic: the first reading only sets the baseline.
        if (this.periodStart === null) {
            for (const k of this.kinds) {
                this.previousKWh[k] = readingsKWh[k] ?? 0;
            }
            this.periodStart = now;
        }
        else {
            for (const k of this.kinds) {
                const reading = readingsKWh[k] ?? 0;
                // Ignore decreases (counter reset/glitch) rather than reporting negative energy.
                this.accumulatedKWh[k] += Math.max(0, reading - (this.previousKWh[k] ?? reading));
                this.previousKWh[k] = reading;
            }
            const periodOver = now - this.periodStart >= exports.PERIODIC_PERIOD_MS;
            const becameActive = this.kinds.some(k => this.idle[k] && kWhToMilliWh(this.accumulatedKWh[k]) > 0);
            if (periodOver || becameActive) {
                const startTimestamp = Math.floor(this.periodStart / 1000);
                const endTimestamp = Math.floor(now / 1000);
                for (const k of this.kinds) {
                    const energy = kWhToMilliWh(this.accumulatedKWh[k]);
                    fragment[PERIODIC_KEY[k]] = { energy, startTimestamp, endTimestamp };
                    this.idle[k] = energy === 0;
                    this.accumulatedKWh[k] = 0;
                }
                this.periodStart = now;
            }
        }
        return Object.keys(fragment).length > 0 ? fragment : null;
    }
}
exports.EnergyEventScheduler = EnergyEventScheduler;
//# sourceMappingURL=energyEvents.js.map