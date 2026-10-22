-- Money Money Money MVP schema. Apply through the Supabase SQL Editor or CLI.
create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('cash', 'bank', 'stock')),
  opening_balance bigint not null default 0,
  currency char(3) not null default 'TWD' check (currency = 'TWD'),
  is_archived boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 80),
  direction text not null check (direction in ('income', 'expense')),
  color text not null default '#7dd3fc',
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  unique (user_id, name, direction)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  transaction_date date not null default current_date,
  amount bigint not null check (amount > 0),
  kind text not null check (kind in ('income', 'expense', 'transfer_in', 'transfer_out')),
  account_id uuid not null references public.accounts(id),
  category_id uuid references public.categories(id),
  transfer_group_id uuid,
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  check ((kind in ('transfer_in', 'transfer_out') and transfer_group_id is not null and category_id is null)
    or (kind in ('income', 'expense') and transfer_group_id is null))
);

create index transactions_user_date_idx on public.transactions (user_id, transaction_date desc) where deleted_at is null;
create index transactions_transfer_group_idx on public.transactions (transfer_group_id) where deleted_at is null;

create table public.liabilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 100),
  kind text not null check (kind in ('loan', 'installment')),
  principal bigint not null check (principal > 0),
  annual_rate_bps integer not null default 0 check (annual_rate_bps between 0 and 100000),
  term_months integer not null check (term_months between 1 and 1200),
  start_date date not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create table public.stocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  account_id uuid not null references public.accounts(id),
  ticker text not null check (char_length(ticker) between 1 and 20),
  shares numeric(20, 6) not null check (shares >= 0),
  total_cost bigint not null check (total_cost >= 0),
  annual_return_bps integer not null default 0 check (annual_return_bps between -10000 and 100000),
  valuation_amount bigint check (valuation_amount >= 0),
  valuation_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  check ((valuation_amount is null and valuation_date is null) or (valuation_amount is not null and valuation_date is not null))
);

create table public.recurring_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 100),
  kind text not null check (kind in ('income', 'expense', 'transfer')),
  amount bigint not null check (amount > 0),
  account_id uuid not null references public.accounts(id),
  target_account_id uuid references public.accounts(id),
  category_id uuid references public.categories(id),
  interval_months integer not null default 1 check (interval_months between 1 and 24),
  day_of_month integer not null default 1 check (day_of_month between 1 and 31),
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz,
  check ((kind = 'transfer' and target_account_id is not null and target_account_id <> account_id and category_id is null)
    or (kind in ('income', 'expense') and target_account_id is null))
);

create table public.investment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name text not null check (char_length(name) between 1 and 100),
  stock_id uuid not null references public.stocks(id),
  funding_account_id uuid not null references public.accounts(id),
  monthly_amount bigint not null check (monthly_amount > 0),
  day_of_month integer not null default 1 check (day_of_month between 1 and 31),
  start_date date not null,
  end_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

-- Every user-owned table is private to its authenticated owner.
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.liabilities enable row level security;
alter table public.stocks enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.investment_plans enable row level security;

create policy "owner manages accounts" on public.accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner manages categories" on public.categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner manages transactions" on public.transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner manages liabilities" on public.liabilities for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner manages stocks" on public.stocks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner manages recurring rules" on public.recurring_rules for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner manages investment plans" on public.investment_plans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger accounts_updated_at before update on public.accounts for each row execute function public.set_updated_at();
create trigger categories_updated_at before update on public.categories for each row execute function public.set_updated_at();
create trigger transactions_updated_at before update on public.transactions for each row execute function public.set_updated_at();
create trigger liabilities_updated_at before update on public.liabilities for each row execute function public.set_updated_at();
create trigger stocks_updated_at before update on public.stocks for each row execute function public.set_updated_at();
create trigger recurring_rules_updated_at before update on public.recurring_rules for each row execute function public.set_updated_at();
create trigger investment_plans_updated_at before update on public.investment_plans for each row execute function public.set_updated_at();
