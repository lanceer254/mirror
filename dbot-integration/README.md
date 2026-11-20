# Zyntrix × Deriv DBot Integration

This branch contains the Zyntrix-side publisher for the DBot signal bridge. It does not change the production `main` branch until this pull request is merged.

## Product direction

- Use Deriv's official Trading Bot Template as the technical foundation for a custom-hosted DBot-style application.
- Preserve the familiar Deriv Blockly workspace and the user's existing Full Margin strategy flow.
- Keep Zyntrix analysis-only. It publishes an OVER 1 signal; it never submits or executes orders.
- DBot remains the only trade executor and waits for a fresh, valid Zyntrix signal after RUN.
- Reuse Zyntrix's existing live tick feed. Do not add a second tick subscription.

## Signal contract

A version 1 message contains:
- type `ZYNTRIX_SIGNAL`, status `PASS` or `WAIT`;
- strategy `OVER1`, contract `DIGITOVER`, prediction `1`;
- Deriv market symbol and sample size;
- OVER 0 >=95%, OVER 1 >=85%, OVER 2 >=75%, OVER 3 >=65% metrics;
- session ID, monotonically increasing live-tick sequence, unique signal ID, and timestamp.

The publisher emits at most one message for each newly received live tick. A PASS is only published when the existing evaluator says all four conditions pass on the latest 60 ticks and the feed is connected. DBot checks the exact popup window and Zyntrix origin, the selected market, contract, sample, thresholds, signal age (3 seconds), signal ID, and live-tick sequence.

## Execution safety

1. RUN activates the gate; the first Blockly purchase waits for a fresh PASS instead of buying immediately.
2. Every later purchase, including a `trade_again` cycle, waits for another one-use PASS.
3. WAIT, missing or closed popup, stale/duplicate/replayed signals, wrong origin/window, wrong market, invalid thresholds, or STOP cannot authorize a purchase.
4. STOP cancels a pending signal wait.
5. Zyntrix remains analysis-only. The Deriv purchase call stays inside DBot.
6. Preserve the uploaded XML baseline unless the user explicitly requests a strategy change: market `1HZ100V`, one-tick duration, prediction `1`, `DIGITOVER`, and `max_trades = 3`.
7. Demo-only end-to-end verification before any live-money use. Never put passwords, OTPs, API tokens, or OAuth secrets in source code or chat.

## Implementation status

- [x] Review official template purchase path and interpreter async support.
- [x] Add origin-checked popup handshake and live-tick signal publisher in this branch.
- [x] Add DBot-side purchase gate, RUN/STOP lifecycle, panel, and payload validation tests in `lanceer254/trading-bot-template` branch `zyntrix-signal-bridge`.
- [ ] Merge this Zyntrix pull request so GitHub Pages serves the publisher.
- [ ] Merge the DBot pull request, configure Deriv OAuth for its deployment domain, and deploy the custom DBot app.
- [ ] Run DBot unit tests/build and complete a browser + Deriv demo-account end-to-end test.

## Related pull requests

- Zyntrix publisher: https://github.com/lanceer254/mirror/pull/7
- DBot purchase gate: https://github.com/lanceer254/trading-bot-template/pull/1

## Upstream source and license

The upstream is `deriv-com/trading-bot-template`. Its repository declares the MIT License (Copyright 2024 deriv.com). Any copied or modified portions must retain the upstream copyright and license notice. The upstream README describes this as a white-label starter/template, not a ready-deployed finished product.
