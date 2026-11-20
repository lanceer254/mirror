# Zyntrix × Deriv DBot Integration

This branch is an isolated development workspace for the Zyntrix–DBot integration. The existing `main` branch and the live Zyntrix website are not changed by this work.

## Product direction

- Use Deriv's official Trading Bot Template as the technical foundation for a custom-hosted DBot-style application.
- Preserve the familiar Deriv Blockly workspace and the user's Full Margin strategy flow.
- Keep Zyntrix analysis-only. It may publish an OVER 1 signal; it must never submit or execute orders.
- DBot remains the only trade executor and must wait for a fresh, valid Zyntrix signal after RUN.
- Keep the Zyntrix live tick feed as the source of analysis. Do not add a second Zyntrix tick subscription.

## Signal contract (initial proposal)

A signal message must include:
- protocol version;
- status: `PASS` or `WAIT`;
- market symbol;
- strategy: `DIGITOVER`;
- prediction: `1`;
- sample size: `60`;
- timestamp and unique signal ID.

DBot must reject a signal if the origin is not allow-listed, the payload is malformed, the market differs from the configured DBot market, the signal is stale, or its ID has already been consumed. A `WAIT` message, disconnection, market mismatch, stale signal, or missing signal must leave the bot waiting and must never trigger a purchase.

## Execution safety requirements

1. RUN starts in a waiting state; it must not buy immediately.
2. Every purchase, including purchases after a win or a `trade_again` loop, requires a new one-use PASS signal.
3. A signal is consumed before the purchase is dispatched; it cannot authorize a second purchase.
4. Loss-stop behavior and the user's existing Full Margin stake logic must be preserved unless the user explicitly requests a change.
5. The uploaded XML's current settings are the baseline: market `1HZ100V`, one-tick duration, prediction `1`, `DIGITOVER`, and `max_trades = 3`. Do not silently change them.
6. No live-money test. Verify the wait gate and execution path in a safe test/demo setup first.
7. Never put Deriv passwords, OTPs, API tokens, or OAuth secrets in source code or chat.

## Implementation sequence

- [ ] Review the official template's license, app architecture, Blockly blocks, interpreter, and purchase lifecycle.
- [ ] Establish the custom DBot project without changing Zyntrix's production branch.
- [ ] Implement and unit-test a strict signal receiver and one-use gate.
- [ ] Add a Blockly wait-for-signal block or equivalent runtime gate at every purchase boundary.
- [ ] Connect Zyntrix to the receiver using a strict origin-checked message bridge.
- [ ] Verify WAIT, stale signal, duplicate signal, disconnect, market mismatch, first trade, and post-win re-entry behavior.
- [ ] Configure OAuth only after a deployment domain is chosen; credentials remain user-controlled.

## Upstream source and license

The planned upstream is `deriv-com/trading-bot-template`. Its repository declares the MIT License (Copyright 2024 deriv.com). Any copied or modified portions must retain the upstream copyright and license notice. The upstream README describes this as a white-label starter/template, not a ready-deployed finished product.
