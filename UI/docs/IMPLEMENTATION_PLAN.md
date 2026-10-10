# Implementation and operations

The production implementation uses Next.js App Router, server routes, Zod validation, Supabase/PostgreSQL, and a provider-neutral market data interface with a Yahoo implementation.

Deployment order:

1. Apply `supabase/migrations/202610090001_fastevent.sql` to the existing Supabase project.
2. Configure the server-only Supabase URL and secret in Vercel.
3. Deploy the Next.js project and enable Vercel Authentication for preview and production.
4. Run `npm run bootstrap` once with production environment variables.
5. Open the seeded study. This normal load path populates FastEvent prices and calculates the first SOXX/QQQ beta; no chart market values are imported.
6. Run smoke checks for study load, save conflict, raw/excess/beta lenses, non-trading Day 0 mapping, and explicit latest quote.

Changing providers requires another implementation of `MarketDataProvider`; calculation and API contracts do not change. Data-retention work is intentionally deferred: FastEvent price rows are not pruned in v1.
