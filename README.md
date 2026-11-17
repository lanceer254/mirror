# Zyntrix — Data Analysis Engine

Zyntrix is an analysis-only market-data workbench for Deriv synthetic indices. It collects public tick history, transforms last digits into statistical features, ranks markets for a selected EVEN or ODD contract, and records later outcomes for local validation.

## Architecture

- **Data source:** Deriv public market-data WebSocket. No account login, OAuth, trading token, or order execution is used.
- **Live monitor:** One selected market streams ticks continuously and keeps a rolling 1,000-tick display buffer.
- **On-demand comparison:** ANALYZE requests up to 1,000 recent ticks from each of the ten configured volatility indices, one history request at a time on a separate public WebSocket.
- **Analysis engine:** analysis-engine.js is deterministic, dependency-free JavaScript and runs locally in the browser.
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
- Forward outcome tracking at the next tick and the next 5/10 ticks where timestamped future observations are available.

Only measured target-parity deviation, rolling-window agreement/stability, and sample coverage contribute to the ranking score. Transition, entropy, streak, and price-movement features remain visible diagnostics until forward validation demonstrates that they add predictive value.

## Interpretation

The score is a **relative historical evidence index**, not a probability of winning and not a prediction that the next digit will match the selected contract. Multiple-window agreement does not make overlapping windows independent samples. The multiple-market adjustment reduces false discoveries when scanning many markets, but it does not prove predictive value.

The local outcome ledger is an empirical check. A next-tick hit rate is only meaningful after a sufficiently large, representative sample and must be compared with the 50% parity baseline. Do not treat a small sample as proof of an edge.

## Tests

Requires Node.js 20 or later; no third-party packages are needed.

~~~sh
node --test analysis-engine.test.cjs
~~~

## Privacy and operating boundaries

- No Groq, Gemini, or other model API is called.
- No API keys or secrets are required by the static app.
- No Deriv account connection or trading capability is included.
- Signal history is stored locally in the browser only. Clearing site data removes that local validation history.
