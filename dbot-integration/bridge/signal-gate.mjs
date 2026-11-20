export const SIGNAL_PROTOCOL_VERSION = 1;
export const SIGNAL_MESSAGE_TYPE = 'ZYNTRIX_SIGNAL';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * One-use, fail-closed gate for messages sent by the embedded Zyntrix window.
 * PASS messages received before RUN or while no purchase is waiting are discarded.
 */
export class ZyntrixSignalGate {
    constructor({ expectedOrigin, expectedSource, expectedMarket, maxAgeMs = 3000, now = () => Date.now() }) {
        if (typeof expectedOrigin !== 'string' || !expectedOrigin) throw new TypeError('expectedOrigin is required');
        if (!expectedSource) throw new TypeError('expectedSource is required');
        if (typeof expectedMarket !== 'string' || !expectedMarket) throw new TypeError('expectedMarket is required');
        if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new TypeError('maxAgeMs must be positive');
        this.expectedOrigin = expectedOrigin;
        this.expectedSource = expectedSource;
        this.expectedMarket = expectedMarket;
        this.maxAgeMs = maxAgeMs;
        this.now = now;
        this.active = false;
        this.waiter = null;
        this.consumedIds = new Set();
        this.lastStatus = 'WAIT';
    }

    startRun() {
        this.active = true;
        this.lastStatus = 'WAIT';
        this.cancelWaiter();
    }

    stopRun() {
        this.active = false;
        this.lastStatus = 'WAIT';
        this.cancelWaiter();
    }

    cancelWaiter() {
        if (this.waiter) {
            const waiter = this.waiter;
            this.waiter = null;
            waiter.resolve(null);
        }
    }

    waitForPass() {
        if (!this.active) return Promise.resolve(null);
        if (this.waiter) return this.waiter.promise;
        let resolve;
        const promise = new Promise(r => { resolve = r; });
        this.waiter = { promise, resolve };
        return promise;
    }

    handleMessage(event) {
        if (!event || event.origin !== this.expectedOrigin || event.source !== this.expectedSource) {
            return { accepted: false, reason: 'UNTRUSTED_SOURCE' };
        }
        const message = event.data;
        if (!isRecord(message) || message.type !== SIGNAL_MESSAGE_TYPE || message.version !== SIGNAL_PROTOCOL_VERSION) {
            this.lastStatus = 'WAIT';
            return { accepted: false, reason: 'INVALID_ENVELOPE' };
        }
        if (message.status === 'WAIT') {
            this.lastStatus = 'WAIT';
            return { accepted: true, status: 'WAIT' };
        }
        if (message.status !== 'PASS') {
            this.lastStatus = 'WAIT';
            return { accepted: false, reason: 'INVALID_STATUS' };
        }
        const validation = this.validatePass(message);
        if (!validation.ok) {
            this.lastStatus = 'WAIT';
            return { accepted: false, reason: validation.reason };
        }
        if (!this.active || !this.waiter) {
            return { accepted: false, reason: 'NO_ACTIVE_PURCHASE_WAIT' };
        }
        if (this.consumedIds.has(message.signalId)) {
            this.lastStatus = 'WAIT';
            return { accepted: false, reason: 'DUPLICATE_SIGNAL' };
        }
        this.consumedIds.add(message.signalId);
        if (this.consumedIds.size > 1000) {
            this.consumedIds.delete(this.consumedIds.values().next().value);
        }
        this.lastStatus = 'PASS';
        const waiter = this.waiter;
        this.waiter = null;
        waiter.resolve(Object.freeze({
            signalId: message.signalId,
            marketSymbol: message.marketSymbol,
            contractType: message.contractType,
            prediction: message.prediction,
            sentAt: message.sentAt,
        }));
        return { accepted: true, status: 'PASS', signalId: message.signalId };
    }

    validatePass(message) {
        if (typeof message.signalId !== 'string' || message.signalId.length < 8 || message.signalId.length > 128) {
            return { ok: false, reason: 'INVALID_SIGNAL_ID' };
        }
        if (message.marketSymbol !== this.expectedMarket) return { ok: false, reason: 'MARKET_MISMATCH' };
        if (message.strategy !== 'OVER1' || message.contractType !== 'DIGITOVER' || message.prediction !== 1) {
            return { ok: false, reason: 'CONTRACT_MISMATCH' };
        }
        if (message.windowSize !== 60) return { ok: false, reason: 'INVALID_SAMPLE_SIZE' };
        const metrics = ['over0Pct', 'over1Pct', 'over2Pct', 'over3Pct'];
        if (metrics.some(key => !Number.isFinite(message[key]) || message[key] < 0 || message[key] > 100)) {
            return { ok: false, reason: 'INVALID_METRICS' };
        }
        if (message.over0Pct < 95 || message.over1Pct < 85 || message.over2Pct < 75 || message.over3Pct < 65) {
            return { ok: false, reason: 'THRESHOLDS_NOT_MET' };
        }
        if (!Number.isFinite(message.sentAt)) return { ok: false, reason: 'INVALID_TIMESTAMP' };
        const age = this.now() - message.sentAt;
        if (age < -1000 || age > this.maxAgeMs) return { ok: false, reason: 'STALE_OR_FUTURE_SIGNAL' };
        return { ok: true };
    }
}
