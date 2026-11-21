# Zyntrix — Data Analysis Engine

Zyntrix is an analysis-only market-data workbench for Deriv synthetic indices. It collects public tick history, transforms last digits into statistical features, ranks markets for Over and Under contracts only, and records later outcomes for local validation.

## Architecture

- **Data source:** Deriv public market-data WebSocket. No account login, OAuth, trading token, or order execution is used.
- **Live monitor:** One selected market streams ticks continuously and keeps a rolling 1,000-tick display buffer.
- **On-demand comparison:** ANALYZE requests up to 1,000 recent ticks from each of the ten configured volatility indices, one history request at a time on a separate public WebSocket.
- **Analysis engine:** \`analysis-engine.js\` is deterministic, dependency-free JavaScript and runs locally in the browser.
- **Validation ledger:** Signal snapshots and subsequently observed outcomes are kept in this browser's localStorage. They are not uploaded to a server and do not sync between devices.
- **Deployment:** GitHub Pages serves the static app. No Cloudflare Worker or AI service is required.

## Statistical features

- Last-digit frequency distribution for digits 0–9.
- Shannon entropy and chi-square distance from a uniform ten-digit distribution.
- EVEN/ODD frequencies and rolling windows of 50, 100, 250, 500, and 1,000 observations.
- One-sided parity z-score, 95% Wilson interval, and a conservative Bonferroni adjustment for comparing up to ten markets.
- Agreement and stability across rolling windows.
- Parity and identical-digit run lengths.
- EVEN/ODD transition matrix and conditional transition sample support.
- Adjacent-window change detection.
- Tick-return movement and dispersion, reported as context rather than a parity predictor.
- Cross-market ranking for the selected contract using target-parity deviation, multi-window agreement, sample coverage, and stability.
- A diagnostic panel exposing digit counts, entropy, uniformity chi-square, parity transitions, streaks, recent-window shifts, and tick-return dispersion.

Only measured target-parity deviation and stability contribute to the ranking score. Transition, entropy, streak, and price-movement features remain visible diagnostics until forward validation demonstrates that they add predictive value.
- Forward outcome tracking at the next tick and the next 5/10 ticks where timestamped future observations are available.

## Interpretation

The score is a **relative historical evidence index**, not a probability of winning and not a prediction that the next digit will match the selected contract. Multiple-window agreement does not make overlapping windows independent samples. The multiple-market adjustment reduces false discoveries when scanning many markets, but it does not prove predictive value.

The local outcome ledger is an empirical check. A next-tick hit rate is only meaningful after a sufficiently large, representative sample and must be compared with the 50% parity baseline. Do not treat a small sample as proof of an edge.

## Tests

Requires Node.js 20 or later; no third-party packages are needed.

\`\`\`sh
node --test analysis-engine.test.cjs
\`\`\`

## Privacy and operating boundaries

- No Groq, Gemini, or other model API is called.
- No API keys or secrets are required by the static app.
- No Deriv account connection or trading capability is included.
- Signal history is stored locally in the browser only. Clearing site data removes that local validation history.


## OVER 1 live gate

- The live gate uses exactly the latest 60 digits from the currently selected live-display market.
- It evaluates OVER 0 >= 95%, OVER 1 >= 85%, OVER 2 >= 75%, and OVER 3 >= 65% together on that same 60-tick sample.
- Every incoming tick triggers a fresh evaluation; if any threshold fails, the status immediately returns to WAIT.
- The default D-Circles window is 60 ticks. The gate waits if another window is selected, the feed is offline, or fewer than 60 valid digits are available.
- The gate only displays a signal. It does not submit Deriv orders. DBot and Zyntrix market selections must currently be matched manually; there is no automatic cross-page DBot market bridge in this version.
- These historical frequencies are descriptive and do not guarantee the next tick's outcome.

## Persistent intelligence integration

The `zyntrix-full-scale-integration` branch adds a Cloudflare Worker API and D1 archive for the ten configured volatility indices. On startup, the browser collector requests the latest 5,000 ticks for each market, subscribes to all ten markets independently of the selected display market, and batches timestamped ticks to the archive. It also stores Deriv contract-availability snapshots.

The dashboard includes a chronological train/holdout validation lab. It selects thresholds using the earlier training segment, evaluates non-overlapping forward outcomes on a later holdout, and reports sample size, hit rate, baseline, and a Wilson 95% interval. A holdout result is not treated as a validated edge unless its lower confidence bound exceeds the contract baseline and the minimum holdout sample is met. Contract payout/expected value remains unavailable until actual proposal prices and settlement details are captured.

**Collection is browser-session-driven:** the dashboard must remain open for live tick collection. The API does not claim to run an always-on Deriv collector. The current integration is analysis and research only; it does not log in to a Deriv account or place trades.

See [INTELLIGENCE_BACKEND.md](INTELLIGENCE_BACKEND.md) for API routes, storage design, and operating notes.

## Automatic five-tick Over/Under cross-market scanner

The dashboard includes a five-tick AutoScan across all ten configured indices. Each market is evaluated independently. The engine tests digit Over and Under candidates only using a five-step conditional digit-transition model with Bayesian shrinkage. It selects a confidence threshold on an inner chronological validation slice, then evaluates it on a later untouched holdout using non-overlapping five-tick outcomes.

A candidate is sequence-qualified only when the holdout's 95% Wilson lower bound exceeds the contract's theoretical hit-rate baseline, the holdout has at least 20 independent signals, and at least one five-win consecutive sequence is observed. The scanner then requests a live five-tick Deriv proposal at the entered stake/currency. It only displays ENTRY QUALIFIED when the proposal's conservative expected value, calculated using the holdout lower confidence bound, is positive. Otherwise it displays NO ENTRY. It never places an order.

This is a strict research filter. Current data coverage and candidate counts can produce no entry; the scanner does not relax the gates to force a signal. Contract proposal currency must match the user's Deriv account currency.
