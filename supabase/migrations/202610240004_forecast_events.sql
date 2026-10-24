-- One-time income and expenses used only by the forecast.
create table public.forecast_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 100),
  kind text not null check (kind in ('income', 'expense')),
  amount bigint not null check (amount > 0),
  account_id uuid not null references public.accounts(id),
  event_date date not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create index forecast_events_user_date_idx on public.forecast_events (user_id, event_date) where deleted_at is null;
alter table public.forecast_events enable row level security;
create policy "owner manages forecast events" on public.forecast_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create trigger forecast_events_updated_at before update on public.forecast_events for each row execute function public.set_updated_at();
