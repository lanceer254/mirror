# Deriv DBot engine integration notes

Reviewed against the upstream `deriv-com/trading-bot-template` source on its `master` branch.

## Confirmed execution path

1. Blockly's `purchase` block generator emits `Bot.purchase('<contract>')`.
2. The DBot interpreter registers `Bot.purchase` as an asynchronous interpreter function.
3. `BotInterface` forwards the call to `tradeEngine.purchase(contract_type)`.
4. The trade engine's purchase implementation checks that it is in the `BEFORE_PURCHASE` state before it submits the Deriv buy request.
5. The DBot run loop returns to the `before` scope for subsequent trades after a `trade_again` block.

## Implemented in the custom fork

In `lanceer254/trading-bot-template` branch `zyntrix-signal-bridge`:

- `BotInterface.purchase` awaits the Zyntrix gate before calling the original `tradeEngine.purchase`.
- The expected market comes from DBot's own `tradeEngine.options.symbol`, not from the untrusted signal.
- The DBot builder opens Zyntrix in a popup. The two windows use a source- and origin-checked HELLO/INIT/READY handshake.
- RUN activates the gate and STOP cancels a pending wait.
- Every purchase call goes through the same gate, including later purchases after `trade_again`.
- A PASS is one-use, no older than 3 seconds, and must match OVER1 / DIGITOVER / prediction 1, the same market, 60 samples, and all four configured thresholds.
- The publisher uses the existing Zyntrix feed and emits at most one signal per live tick. Session ID and increasing tick sequence prevent a single tick from authorizing repeated purchases.

## Remaining verification

- Merge and deploy the Zyntrix publisher PR to GitHub Pages.
- Merge and deploy the DBot fork with a Deriv OAuth client ID registered for its deployment domain.
- Run `npm test -- --runInBand` and `npm run build` in the DBot fork.
- Verify RUN waits, WAIT does not buy, PASS authorizes one purchase, a second purchase waits for a new live tick, market mismatch is rejected, and STOP cancels the wait using a Deriv demo account.

No live-money tests are part of this implementation.
