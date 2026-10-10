create table if not exists public.fastevent_study_results (
  study_id uuid primary key references public.fastevent_studies(id) on delete cascade,
  study_revision integer not null check (study_revision > 0),
  as_of_date date not null,
  price_date date not null,
  price_status text not null check (price_status in ('eod', 'latest')),
  quote_as_of timestamptz,
  beta_calculated_at timestamptz,
  calculation_version text not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  calculated_at timestamptz not null default now()
);

create index if not exists fastevent_study_results_calculated_at_desc
  on public.fastevent_study_results (calculated_at desc);

alter table public.fastevent_study_results enable row level security;

revoke all on table public.fastevent_study_results from public, anon, authenticated;
grant select, insert, update, delete on table public.fastevent_study_results to service_role;
