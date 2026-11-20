# Signal bridge prototype

This folder preserves the original standalone gate prototype and its Node.js tests as a design reference. The production-facing implementation for the custom DBot fork is in `lanceer254/trading-bot-template` branch `zyntrix-signal-bridge`.

The integrated version uses a popup rather than an iframe because the popup can be opened by a user click and its exact `WindowProxy` can be verified by DBot. It performs an origin-checked HELLO/INIT/READY handshake before sending signals.

## Integrated contract

- type `ZYNTRIX_SIGNAL`, protocol version 1;
- status `PASS` or `WAIT`;
- strategy `OVER1`, contract `DIGITOVER`, prediction `1`;
- selected market, 60-tick sample, and four threshold metrics;
- unique session ID, per-session live tick sequence, signal ID, and timestamp;
- PASS expires after 3 seconds and can authorize only one currently waiting purchase.

DBot obtains its expected market from its own Blockly trade-definition symbol. Zyntrix cannot choose or override the DBot market. Wrong origin/window, stale or replayed signals, WAIT, mismatch, or STOP cannot authorize a purchase.

## Verification status

The Zyntrix branch quality workflow passed its analysis-engine tests and dashboard JavaScript syntax/markup checks. DBot payload validation tests have been authored but have not yet been executed in this environment. Full integration still requires both pull requests to be merged, DBot to be deployed with its own Deriv OAuth client ID, and an end-to-end browser test with a Deriv demo account.
