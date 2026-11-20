import test from 'node:test';
import assert from 'node:assert/strict';
import { ZyntrixSignalGate, SIGNAL_MESSAGE_TYPE, SIGNAL_PROTOCOL_VERSION } from './signal-gate.mjs';

const source = {};
let now = 1_800_000_000_000;
const makeGate = () => new ZyntrixSignalGate({
    expectedOrigin: 'https://lanceer254.github.io',
    expectedSource: source,
    expectedMarket: '1HZ100V',
    now: () => now,
});
const pass = (overrides = {}) => ({
    type: SIGNAL_MESSAGE_TYPE,
    version: SIGNAL_PROTOCOL_VERSION,
    status: 'PASS',
    signalId: 'signal-12345678',
    marketSymbol: '1HZ100V',
    strategy: 'OVER1',
    contractType: 'DIGITOVER',
    prediction: 1,
    windowSize: 60,
    over0Pct: 96,
    over1Pct: 86,
    over2Pct: 76,
    over3Pct: 66,
    sentAt: now,
    ...overrides,
});
const event = data => ({ origin: 'https://lanceer254.github.io', source, data });

test('ignores messages from untrusted origins or windows', async () => {
    const gate = makeGate();
    gate.startRun();
    const waiting = gate.waitForPass();
    assert.equal(gate.handleMessage({ ...event(pass()), origin: 'https://evil.example' }).reason, 'UNTRUSTED_SOURCE');
    assert.equal(gate.handleMessage({ ...event(pass()), source: {} }).reason, 'UNTRUSTED_SOURCE');
    gate.stopRun();
    assert.equal(await waiting, null);
});

test('does not accept or replay PASS messages received before RUN or before a purchase waits', async () => {
    const gate = makeGate();
    assert.equal(gate.handleMessage(event(pass())).reason, 'NO_ACTIVE_PURCHASE_WAIT');
    gate.startRun();
    assert.equal(gate.handleMessage(event(pass())).reason, 'DUPLICATE_SIGNAL');
    const early = pass({ signalId: 'signal-before-wait-1234' });
    assert.equal(gate.handleMessage(event(early)).reason, 'NO_ACTIVE_PURCHASE_WAIT');
    const waiting = gate.waitForPass();
    assert.equal(gate.handleMessage(event(early)).reason, 'DUPLICATE_SIGNAL');
    gate.stopRun();
    assert.equal(await waiting, null);
});

test('releases exactly one waiting purchase for a fresh valid PASS', async () => {
    const gate = makeGate();
    gate.startRun();
    const waiting = gate.waitForPass();
    assert.equal(gate.handleMessage(event(pass())).accepted, true);
    assert.equal((await waiting).signalId, 'signal-12345678');
    assert.equal(gate.waiter, null);
});

test('WAIT never releases a waiting purchase', async () => {
    const gate = makeGate();
    gate.startRun();
    const waiting = gate.waitForPass();
    gate.handleMessage(event({ type: SIGNAL_MESSAGE_TYPE, version: 1, status: 'WAIT' }));
    assert.ok(gate.waiter);
    gate.stopRun();
    assert.equal(await waiting, null);
});

test('rejects stale signals, mismatched markets, and failed thresholds', () => {
    const gate = makeGate();
    gate.startRun();
    gate.waitForPass();
    assert.equal(gate.handleMessage(event(pass({ sentAt: now - 4000 }))).reason, 'STALE_OR_FUTURE_SIGNAL');
    assert.equal(gate.handleMessage(event(pass({ marketSymbol: 'R_100' }))).reason, 'MARKET_MISMATCH');
    assert.equal(gate.handleMessage(event(pass({ over1Pct: 84.99 }))).reason, 'THRESHOLDS_NOT_MET');
});

test('rejects duplicate signal IDs and wrong contract types', async () => {
    const gate = makeGate();
    gate.startRun();
    const waiting = gate.waitForPass();
    gate.handleMessage(event(pass()));
    await waiting;
    const nextWaiting = gate.waitForPass();
    assert.equal(gate.handleMessage(event(pass())).reason, 'DUPLICATE_SIGNAL');
    gate.stopRun();
    assert.equal(await nextWaiting, null);
    assert.equal(gate.validatePass(pass({ contractType: 'DIGITMATCH' })).reason, 'CONTRACT_MISMATCH');
});

test('stopping DBot cancels a pending wait without purchasing', async () => {
    const gate = makeGate();
    gate.startRun();
    const waiting = gate.waitForPass();
    gate.stopRun();
    assert.equal(await waiting, null);
    assert.equal(gate.active, false);
});
