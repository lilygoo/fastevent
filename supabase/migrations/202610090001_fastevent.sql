create extension if not exists pgcrypto;

create table if not exists public.fastevent_prices (
  symbol text not null check (symbol = upper(trim(symbol)) and symbol ~ '^[A-Z0-9]+([.-][A-Z0-9]+)*$'),
  price_date date not null,
  raw_close numeric(20, 8) not null check (raw_close > 0),
  adjusted_close numeric(20, 8) not null check (adjusted_close > 0),
  provider text not null,
  fetched_at timestamptz not null default now(),
  primary key (symbol, price_date)
);

create index if not exists fastevent_prices_symbol_date_desc
  on public.fastevent_prices (symbol, price_date desc);

create table if not exists public.fastevent_price_fetches (
  id uuid primary key default gen_random_uuid(),
  symbol text not null check (symbol = upper(trim(symbol))),
  requested_start date not null,
  requested_end date not null check (requested_end >= requested_start),
  provider text not null,
  status text not null check (status in ('success', 'failed')),
  row_count integer not null default 0 check (row_count >= 0),
  error_message text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz not null default now()
);

create index if not exists fastevent_fetches_coverage
  on public.fastevent_price_fetches (symbol, requested_start, requested_end, completed_at desc)
  where status = 'success';

create table if not exists public.fastevent_quote_cache (
  symbol text primary key check (symbol = upper(trim(symbol))),
  price numeric(20, 8) not null check (price > 0),
  quote_as_of timestamptz not null,
  market_state text,
  provider text not null,
  fetched_at timestamptz not null default now()
);

create table if not exists public.fastevent_betas (
  instrument_symbol text not null check (instrument_symbol = upper(trim(instrument_symbol))),
  benchmark_symbol text not null check (benchmark_symbol = upper(trim(benchmark_symbol))),
  beta numeric(20, 12) not null,
  as_of_date date not null,
  aligned_observations integer not null check (aligned_observations >= 0),
  coverage_ratio numeric(12, 8) not null check (coverage_ratio between 0 and 1),
  calculation_version text not null,
  calculated_at timestamptz not null default now(),
  primary key (instrument_symbol, benchmark_symbol),
  check (instrument_symbol <> benchmark_symbol)
);

create table if not exists public.fastevent_studies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists fastevent_studies_name_active_unique
  on public.fastevent_studies (lower(trim(name))) where deleted_at is null;

alter table public.fastevent_prices enable row level security;
alter table public.fastevent_price_fetches enable row level security;
alter table public.fastevent_quote_cache enable row level security;
alter table public.fastevent_betas enable row level security;
alter table public.fastevent_studies enable row level security;

revoke all on table public.fastevent_prices from public, anon, authenticated;
revoke all on table public.fastevent_price_fetches from public, anon, authenticated;
revoke all on table public.fastevent_quote_cache from public, anon, authenticated;
revoke all on table public.fastevent_betas from public, anon, authenticated;
revoke all on table public.fastevent_studies from public, anon, authenticated;

grant select, insert, update, delete on table public.fastevent_prices to service_role;
grant select, insert, update, delete on table public.fastevent_price_fetches to service_role;
grant select, insert, update, delete on table public.fastevent_quote_cache to service_role;
grant select, insert, update, delete on table public.fastevent_betas to service_role;
grant select, insert, update, delete on table public.fastevent_studies to service_role;
