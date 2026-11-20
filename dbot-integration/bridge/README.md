# Signal bridge prototype

This folder contains the first isolated, tested component for the Zyntrix × DBot bridge.

## Contract

DBot accepts messages only from the exact configured Zyntrix origin **and** the exact embedded iframe window. A PASS is eligible only when DBot is already running and a purchase is actively waiting. A pre-RUN PASS is discarded.

A valid PASS must match:
- market `1HZ100V` (initial baseline; DBot market must later be bound to the actual workspace selection);
- strategy `OVER1`, contract `DIGITOVER`, prediction `1`;
- exactly 60 samples;
- OVER 0 >=95%, OVER 1 >=85%, OVER 2 >=75%, OVER 3 >=65%;
- a timestamp no more than 3 seconds old.

Each signal ID can authorize only one waiting purchase. WAIT, invalid data, stale data, wrong origin/window, market mismatch, or stopping DBot cannot authorize a purchase.

## Current status

This module is a tested prototype only. It is **not yet wired into Deriv's DBot interpreter or the Zyntrix page**. The next implementation step is to integrate the gate into the official template's `Bot.purchase` path, and connect RUN/STOP lifecycle events, before enabling any trading.

## Tests

Run with Node.js 22 or 24:

```sh
node --test signal-gate.test.mjs
```
