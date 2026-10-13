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

Apply the SQL files in `supabase/migrations/` to the existing Supabase project in filename order. The migrations create only FastEvent-owned, service-role-only tables. The current path uses:

- `fastevent_prices`
- `fastevent_price_fetches`
- `fastevent_quote_cache`
- `fastevent_studies`
- `fastevent_beta_estimates`
- `fastevent_study_runs`
- `fastevent_study_run_events`
- `fastevent_study_return_points`

The legacy `fastevent_betas` and `fastevent_study_results` tables remain for one rollback window, but current application code never reads or writes them.

No Price Tracker or Risk Lens table is referenced. FastEvent price rows are retained indefinitely in v1.

Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` only in the server environment, then seed the shared study:

```bash
npm run bootstrap
```

The command inserts or updates the approved ARR study and is safe to rerun. It does not insert chart-derived returns or beta values. Prices, event-specific betas, and normalized runs are populated through the normal study load/run path.

## Calculation rules

- All return paths and beta estimates use adjusted closes.
- Beta uses 365 trailing calendar days of daily simple returns and OLS with an intercept.
- A beta requires at least 200 aligned observations and 90% benchmark coverage.
- Every episode gets its own beta. Its estimation window ends on the joint session immediately before that episode's canonical D-10 session.
- Beta estimates are immutable and cached by instrument, benchmark, estimation cutoff, and calculation version.
- Beta-adjusted performance is daily CAR: each day's instrument return minus beta times benchmark return, summed from D+1 forward (or backwards before D0). D0 is exactly zero.
- If an episode has no valid beta, its raw and excess paths remain available and its beta-adjusted values are null.
- A non-trading Day 0 maps to the next joint instrument/benchmark session.
- Every saved-study revision persists an immutable normalized D-10 through D+50 run; changing the displayed lens does not require a market-data refresh.
- The current study defaults its as-of date to today in U.S. Eastern time and warns when the latest joint price is older.
- EOD mode uses finalized daily bars only. A same-day daily bar becomes final at 4:15 p.m. Eastern.
- Latest mode is explicit: on weekdays from 9:30 a.m. through 4:00 p.m. Eastern, **Pull latest** accepts only same-day positive quotes no more than two minutes old and no more than two minutes apart. Quotes receive the latest finalized EOD adjustment factor and are never written to `fastevent_prices`.

## API

- `POST /api/event-studies/run`
- `POST /api/market-data/quote`
- `GET/POST /api/studies`
- `GET/PATCH/DELETE /api/studies/[id]`
- `POST /api/jobs/daily-refresh` (Bearer `FASTEVENT_JOB_SECRET`)

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
4. Set `FASTEVENT_JOB_SECRET` in Vercel.
5. In Vercel project settings, enable Deployment Protection / Vercel Authentication for production and preview deployments.
6. Apply all Supabase migrations, deploy, and run `npm run bootstrap` followed by `npm run recalculate-runs` with production environment variables.
7. In GitHub Actions, set `FASTEVENT_JOB_URL` to the deployed `/api/jobs/daily-refresh` URL, `FASTEVENT_JOB_SECRET` to the same job secret, and `VERCEL_AUTOMATION_BYPASS_SECRET` to a Vercel protection-bypass secret. The workflow runs weekdays at 23:00 UTC and can also be started manually.

Do not create a `NEXT_PUBLIC_` Supabase secret. Yahoo access is isolated behind the server-only provider interface in `lib/market-provider.ts` so a licensed provider can replace it later.

More detail is in `UI/docs/` and sample contracts are in `UI/fixtures/`.
