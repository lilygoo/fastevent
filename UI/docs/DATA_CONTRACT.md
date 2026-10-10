# Data contract

The canonical TypeScript contracts live in `lib/types.ts`; request validation lives in `lib/validation.ts`.

## Study definition

A definition includes `name`, fixed-list `instrument` and `benchmark`, `lens`, `preDays`, `postDays`, `asOf`, `priceMode`, one `currentEvent`, 1–12 `historicalEvents`, and display preferences. Each event has an ID, label, requested Day 0, active flag, and zero or more milestones. Each milestone has its own ID, label, date, and active flag.

The instrument and benchmark must differ. Historical Day 0 values precede current Day 0. As-of cannot precede current Day 0. Milestones cannot precede their owning Day 0 or follow as-of.

## Run response

`POST /api/event-studies/run` returns the validated definition, beta metadata or null, `betaAvailable`, aligned event series, historical distribution, outcome rows, data/quote timestamps, price status, and warnings. Each event includes requested and effective Day 0. Each point includes relative day, market date, selected-lens value, raw cumulative return, and benchmark cumulative return.

## Persistence

`fastevent_prices` stores raw and adjusted EOD close by symbol/date. `fastevent_price_fetches` records provider attempts. `fastevent_quote_cache` stores the latest explicit quote pull. `fastevent_betas` stores one upserted record per ordered instrument/benchmark pair. `fastevent_studies` stores JSON definitions and optimistic revisions.

All tables have RLS enabled, no browser-facing grants, and service-role access only.
