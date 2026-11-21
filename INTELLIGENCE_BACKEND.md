# Zyntrix Intelligence Integration

This branch adds a persistent market-data and validation backend to the existing GitHub Pages frontend.

## Components
- Cloudflare Worker: `zyntrix-intelligence-api`
- Cloudflare D1: `zyntrix-intelligence` (APAC primary region)
- D1 schema: `migrations/0001_initial.sql`
- Frontend remains static and does not receive Cloudflare credentials.

## API
- `GET /health`
- `GET /api/markets`
- `POST /api/ingest` — up to 250 validated, deduplicated ticks per batch.
- `GET /api/summary`
- `GET /api/ticks?market=R_100&limit=1000&since=...`
- `GET /api/contracts?market=R_100`
- `POST /api/contracts/snapshot`
- `POST /api/observations`
- `POST /api/observations/resolve`
- `GET /api/validation`
- `POST /api/collector/session`

## Data model
Raw ticks are immutable and deduplicated by market, epoch and quote. Signal observations are stored separately from their outcomes. Contract quote snapshots preserve the exact raw proposal response for audit. Validation runs store train/test time ranges, sample counts, hit rates, Wilson confidence intervals, baseline and expected value.

## Collection
On startup, the collector requests up to the latest 5,000 ticks from Deriv history for each of the ten markets, then subscribes to all ten live tick streams. The dashboard must remain open for continued live collection. The frontend integration subscribes to the ten supported markets and posts batches to the Worker. Collection is therefore browser-session-driven; no always-on collector is claimed by this initial backend. Missed periods are detectable from tick timestamps and can be backfilled from Deriv history where available.

## Security and operations
The public ingest route validates market names, timestamps, payload size and digit values, and deduplicates repeated events. It does not accept account tokens or trading credentials. For production abuse protection, place a Cloudflare Turnstile/rate-limit policy in front of ingestion before making the collector broadly public. Do not put secrets in GitHub Pages.


## Deployment smoke check

The repository quality workflow probes the deployed `/health` endpoint and requires the API to report a connected D1 binding and all ten configured markets before the integration is merged.


Last integration verification: 2026-11-21.

## Five-tick entry engine

- Frontend engine: `entry-engine.js`; tests: `entry-engine.test.cjs`.
- `POST` order execution is not implemented; the scanner is signal/research only.
- `GET /api/ticks` supplies up to 5,000 archived rows per market to the browser scanner.
- Every market is assessed separately. The scanner's 5-tick terminal-digit model is trained on the first 70% of each market's history; an inner chronological slice selects the probability margin, and the final 30% is held out for evaluation.
- Outcomes are sampled at non-overlapping 5-tick intervals. Candidate families: DIGITOVER, DIGITUNDER, DIGITMATCH, DIGITDIFF, DIGITEVEN, DIGITODD.
- Sequence qualification requires at least 20 holdout signals, a Wilson 95% lower bound above the theoretical baseline, and at least one run of five consecutive holdout wins.
- A fresh Deriv proposal is requested for the candidate at the configured stake and currency. Entry is shown only if the 95% lower-bound win probability times gross payout exceeds the ask price. This is a conservative quote-time check, not a promise of future execution price.
- If no candidate passes, the correct output is NO ENTRY.
