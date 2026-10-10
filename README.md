# FastEvent

FastEvent is a private Next.js event-study workspace. It aligns an instrument and benchmark by joint trading sessions, compares a current event with historical episodes, and supports raw, excess, and beta-adjusted cumulative adjusted-close returns.

The production app is implemented beside the frozen visual reference at `UI/prototype/event_alignment_demo_v8.html`. The prototype is not a data source and remains unchanged.

## Local setup

Requirements: Node.js 22+, npm, and a Supabase project.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Without Supabase variables, the app uses an in-memory seeded study library and can still fetch market data, but prices, quotes, studies, and beta records will not survive a process restart.

## Database

Apply the SQL files in `supabase/migrations/` to the existing Supabase project in filename order. The migrations create only these service-role-only tables:

- `fastevent_prices`
- `fastevent_price_fetches`
- `fastevent_quote_cache`
- `fastevent_betas`
- `fastevent_studies`
- `fastevent_study_results`

No Price Tracker or Risk Lens table is referenced. FastEvent price rows are retained indefinitely in v1.

Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` only in the server environment, then seed the shared study:

```bash
npm run bootstrap
```

The command inserts or updates the approved ARR study and is safe to rerun. It does not insert chart-derived returns or beta values. Prices and beta are populated through the normal study load/run path.

## Calculation rules

- All return paths and beta estimates use adjusted closes.
- Beta uses 365 trailing calendar days of daily simple returns and OLS with an intercept.
- A beta requires at least 200 aligned observations and 90% benchmark coverage.
- A cached beta is fresh through exactly 30 calendar days; it refreshes only on study creation or saved-study load.
- A failed refresh falls back to an older beta with a warning. With no beta, raw and excess inputs remain available and beta-adjusted values are null.
- A non-trading Day 0 maps to the next joint instrument/benchmark session.
- Every saved-study run persists raw, excess, and beta-adjusted event paths together in `fastevent_study_results`; changing the displayed lens does not require a market-data refresh.
- The current study defaults its as-of date to today in U.S. Eastern time and warns when the latest joint price is older.

## API

- `POST /api/event-studies/run`
- `POST /api/market-data/quote`
- `GET/POST /api/studies`
- `GET/PATCH/DELETE /api/studies/[id]`

Updates and deletes require the current `revision`; stale writes receive HTTP 409.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

## Vercel deployment

1. Import this repository as a Vercel Next.js project.
2. Add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` as encrypted server environment variables for each intended environment.
3. Add the optional cache/version variables from `.env.example` if the defaults should be overridden.
4. In Vercel project settings, enable Deployment Protection / Vercel Authentication for production and preview deployments.
5. Deploy, apply the Supabase migration once, and run `npm run bootstrap` with production environment variables.

Do not create a `NEXT_PUBLIC_` Supabase secret. Yahoo access is isolated behind the server-only provider interface in `lib/market-provider.ts` so a licensed provider can replace it later.

More detail is in `UI/docs/` and sample contracts are in `UI/fixtures/`.
