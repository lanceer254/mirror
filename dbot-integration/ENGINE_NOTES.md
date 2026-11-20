# Deriv DBot engine integration notes

Reviewed against the upstream `deriv-com/trading-bot-template` source on its `master` branch.

## Confirmed execution path

1. Blockly's `purchase` block generator emits `Bot.purchase('<contract>')`.
2. The DBot interpreter registers `Bot.purchase` as an asynchronous interpreter function.
3. `BotInterface` currently forwards that call to `tradeEngine.purchase(contract_type)`.
4. The trade engine's purchase implementation checks that it is in the `BEFORE_PURCHASE` state before it submits the Deriv buy request.
5. The DBot run loop returns to the `before` scope for subsequent trades after a `trade_again` block.

## Integration decision

The strongest gate is at the Bot interface / trade-engine purchase boundary, not merely a decorative Blockly block. The interface can await a Promise from the signal gate before it calls the existing trade engine purchase method. The interpreter already wraps `Bot.purchase` as an asynchronous function, so this is a viable integration point.

This gate must run for **every** purchase call. That covers the first trade and later `trade_again` cycles. RUN must activate a fresh waiting session; STOP must cancel a pending wait. A PASS received before a purchase is waiting is discarded and cannot be replayed later.

## Still required before integration is complete

- Import and instantiate the gate in the actual custom DBot source.
- Bind the expected market to the live Blockly trade-definition symbol, rather than trusting a symbol sent by Zyntrix.
- Embed the existing Zyntrix page and retain its existing live feed; pass the exact iframe `contentWindow` and origin to the gate.
- Wire RUN/STOP and iframe disconnect handling to the gate lifecycle.
- Run upstream build, lint, and test suites after integration.
- Verify the purchase boundary in Demo mode with no live-money trades.

## Prototype test status

The standalone gate prototype has a 7-case Node.js test suite authored. Test execution has not yet been verified in this environment. Cases cover trusted source/origin, pre-RUN and pre-wait replay rejection, fresh PASS, WAIT, stale signal, market mismatch, thresholds, duplicate IDs, contract mismatch, and STOP cancellation.
