alter table public.fastevent_prices
  add column if not exists is_final boolean not null default true;

create table if not exists public.fastevent_beta_estimates (
  instrument_symbol text not null check (instrument_symbol = upper(trim(instrument_symbol))),
  benchmark_symbol text not null check (benchmark_symbol = upper(trim(benchmark_symbol))),
  estimation_cutoff date not null,
  beta numeric(20, 12) not null,
  aligned_observations integer not null check (aligned_observations >= 0),
  coverage_ratio numeric(12, 8) not null check (coverage_ratio between 0 and 1),
  calculation_version text not null,
  calculated_at timestamptz not null default now(),
  primary key (instrument_symbol, benchmark_symbol, estimation_cutoff, calculation_version),
  check (instrument_symbol <> benchmark_symbol)
);

create table if not exists public.fastevent_study_runs (
  id uuid primary key default gen_random_uuid(),
  study_id uuid not null references public.fastevent_studies(id) on delete cascade,
  study_revision integer not null check (study_revision > 0),
  as_of_date date not null,
  data_as_of date not null,
  price_status text not null check (price_status in ('eod', 'latest')),
  quote_as_of timestamptz,
  market_data_provider text not null,
  calculation_version text not null,
  input_fingerprint text not null check (length(input_fingerprint) = 64),
  warnings text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (study_id, study_revision, input_fingerprint)
);

create index if not exists fastevent_study_runs_latest
  on public.fastevent_study_runs (study_id, study_revision, created_at desc);

create table if not exists public.fastevent_study_run_events (
  run_id uuid not null references public.fastevent_study_runs(id) on delete cascade,
  event_id text not null,
  ordinal integer not null check (ordinal >= 0),
  label text not null,
  requested_day0 date not null,
  effective_day0 date not null,
  is_current boolean not null,
  is_active boolean not null,
  beta numeric(20, 12),
  beta_estimation_cutoff date,
  beta_aligned_observations integer,
  beta_coverage_ratio numeric(12, 8),
  beta_calculation_version text,
  beta_calculated_at timestamptz,
  primary key (run_id, event_id)
);

create index if not exists fastevent_run_events_order
  on public.fastevent_study_run_events (run_id, ordinal);

create table if not exists public.fastevent_study_return_points (
  run_id uuid not null,
  event_id text not null,
  relative_day integer not null check (relative_day between -10 and 50),
  price_date date not null,
  source text not null check (source in ('eod', 'latest')),
  instrument_adjusted_price numeric(20, 8) not null check (instrument_adjusted_price > 0),
  benchmark_adjusted_price numeric(20, 8) not null check (benchmark_adjusted_price > 0),
  instrument_daily_return numeric(20, 12),
  benchmark_daily_return numeric(20, 12),
  abnormal_daily_return numeric(20, 12),
  raw_return numeric(20, 12) not null,
  benchmark_return numeric(20, 12) not null,
  excess_return numeric(20, 12) not null,
  beta_adjusted_return numeric(20, 12),
  primary key (run_id, event_id, relative_day),
  foreign key (run_id, event_id) references public.fastevent_study_run_events(run_id, event_id) on delete cascade
);

create index if not exists fastevent_return_points_date
  on public.fastevent_study_return_points (run_id, price_date);

alter table public.fastevent_beta_estimates enable row level security;
alter table public.fastevent_study_runs enable row level security;
alter table public.fastevent_study_run_events enable row level security;
alter table public.fastevent_study_return_points enable row level security;

revoke all on table public.fastevent_beta_estimates from public, anon, authenticated;
revoke all on table public.fastevent_study_runs from public, anon, authenticated;
revoke all on table public.fastevent_study_run_events from public, anon, authenticated;
revoke all on table public.fastevent_study_return_points from public, anon, authenticated;

grant select, insert, update, delete on table public.fastevent_beta_estimates to service_role;
grant select, insert, update, delete on table public.fastevent_study_runs to service_role;
grant select, insert, update, delete on table public.fastevent_study_run_events to service_role;
grant select, insert, update, delete on table public.fastevent_study_return_points to service_role;

create or replace function public.fastevent_store_study_run(
  p_study_id uuid,
  p_study_revision integer,
  p_as_of_date date,
  p_data_as_of date,
  p_price_status text,
  p_quote_as_of timestamptz,
  p_market_data_provider text,
  p_calculation_version text,
  p_input_fingerprint text,
  p_warnings text[],
  p_events jsonb,
  p_points jsonb
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_run_id uuid;
  v_item jsonb;
begin
  if not exists (
    select 1 from public.fastevent_studies
    where id = p_study_id and revision = p_study_revision and deleted_at is null
  ) then
    raise exception 'The saved study changed before its calculated run could be stored.';
  end if;

  insert into public.fastevent_study_runs (
    study_id, study_revision, as_of_date, data_as_of, price_status, quote_as_of,
    market_data_provider, calculation_version, input_fingerprint, warnings
  ) values (
    p_study_id, p_study_revision, p_as_of_date, p_data_as_of, p_price_status, p_quote_as_of,
    p_market_data_provider, p_calculation_version, p_input_fingerprint, coalesce(p_warnings, '{}')
  ) on conflict (study_id, study_revision, input_fingerprint) do nothing
  returning id into v_run_id;

  if v_run_id is null then
    select id into v_run_id from public.fastevent_study_runs
    where study_id = p_study_id and study_revision = p_study_revision and input_fingerprint = p_input_fingerprint;
    return v_run_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_events)
  loop
    insert into public.fastevent_study_run_events (
      run_id, event_id, ordinal, label, requested_day0, effective_day0, is_current, is_active,
      beta, beta_estimation_cutoff, beta_aligned_observations, beta_coverage_ratio,
      beta_calculation_version, beta_calculated_at
    ) values (
      v_run_id, v_item->>'event_id', (v_item->>'ordinal')::integer, v_item->>'label',
      (v_item->>'requested_day0')::date, (v_item->>'effective_day0')::date,
      (v_item->>'is_current')::boolean, (v_item->>'is_active')::boolean,
      nullif(v_item->>'beta', '')::numeric, nullif(v_item->>'beta_estimation_cutoff', '')::date,
      nullif(v_item->>'beta_aligned_observations', '')::integer, nullif(v_item->>'beta_coverage_ratio', '')::numeric,
      nullif(v_item->>'beta_calculation_version', ''), nullif(v_item->>'beta_calculated_at', '')::timestamptz
    );
  end loop;

  for v_item in select value from jsonb_array_elements(p_points)
  loop
    insert into public.fastevent_study_return_points (
      run_id, event_id, relative_day, price_date, source, instrument_adjusted_price,
      benchmark_adjusted_price, instrument_daily_return, benchmark_daily_return, abnormal_daily_return,
      raw_return, benchmark_return, excess_return, beta_adjusted_return
    ) values (
      v_run_id, v_item->>'event_id', (v_item->>'relative_day')::integer, (v_item->>'price_date')::date,
      v_item->>'source', (v_item->>'instrument_adjusted_price')::numeric, (v_item->>'benchmark_adjusted_price')::numeric,
      nullif(v_item->>'instrument_daily_return', '')::numeric, nullif(v_item->>'benchmark_daily_return', '')::numeric,
      nullif(v_item->>'abnormal_daily_return', '')::numeric, (v_item->>'raw_return')::numeric,
      (v_item->>'benchmark_return')::numeric, (v_item->>'excess_return')::numeric,
      nullif(v_item->>'beta_adjusted_return', '')::numeric
    );
  end loop;
  return v_run_id;
end;
$$;

revoke all on function public.fastevent_store_study_run(uuid, integer, date, date, text, timestamptz, text, text, text, text[], jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.fastevent_store_study_run(uuid, integer, date, date, text, timestamptz, text, text, text, text[], jsonb, jsonb) to service_role;

update public.fastevent_studies
set definition = jsonb_set(
    jsonb_set(definition, '{preDays}', to_jsonb(least(10, greatest(0, coalesce((definition->>'preDays')::integer, 0))))),
    '{postDays}', to_jsonb(least(50, greatest(5, coalesce((definition->>'postDays')::integer, 5))))
  ),
  revision = revision + 1,
  updated_at = now()
where deleted_at is null
  and (coalesce((definition->>'preDays')::integer, 0) > 10 or coalesce((definition->>'postDays')::integer, 5) > 50);
