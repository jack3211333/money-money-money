-- 每月淨資產快照：每位使用者每月一筆，由 App 在連線時寫入本月實際值，並推算補齊過去月份。
create table if not exists public.net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  snapshot_month date not null check (extract(day from snapshot_month) = 1),
  cash bigint not null,
  stocks bigint not null check (stocks >= 0),
  liabilities bigint not null check (liabilities >= 0),
  net_worth bigint not null,
  is_estimated boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  constraint net_worth_snapshots_total check (net_worth = cash + stocks - liabilities),
  constraint net_worth_snapshots_user_month_key unique (user_id, snapshot_month)
);

create index if not exists net_worth_snapshots_user_month_idx
  on public.net_worth_snapshots (user_id, snapshot_month)
  where deleted_at is null;

alter table public.net_worth_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'net_worth_snapshots'
      and policyname = 'owner manages net worth snapshots'
  ) then
    create policy "owner manages net worth snapshots" on public.net_worth_snapshots
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end;
$$;

create or replace trigger net_worth_snapshots_updated_at before update on public.net_worth_snapshots
  for each row execute function public.set_updated_at();
