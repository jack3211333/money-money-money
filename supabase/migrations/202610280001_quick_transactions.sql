create table if not exists public.quick_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('income', 'expense')),
  amount bigint not null check (amount > 0),
  account_id uuid not null references public.accounts(id),
  category_id uuid references public.categories(id),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create index if not exists quick_transactions_user_created_idx
  on public.quick_transactions (user_id, created_at desc)
  where deleted_at is null;

create or replace function public.validate_quick_transaction()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if not exists (
    select 1 from public.accounts a
    where a.id = new.account_id and a.user_id = new.user_id
      and a.deleted_at is null and not a.is_archived
  ) then
    raise exception 'Quick transaction account must be active and owned by the user';
  end if;
  if new.category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = new.category_id and c.user_id = new.user_id
      and c.deleted_at is null and c.direction = new.kind
  ) then
    raise exception 'Quick transaction category must be active, owned by the user, and match its kind';
  end if;
  return new;
end;
$$;

drop trigger if exists quick_transactions_validate on public.quick_transactions;
create trigger quick_transactions_validate before insert or update on public.quick_transactions
  for each row execute function public.validate_quick_transaction();

alter table public.quick_transactions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'quick_transactions'
      and policyname = 'owner manages quick transactions'
  ) then
    create policy "owner manages quick transactions" on public.quick_transactions
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end;
$$;

drop trigger if exists quick_transactions_updated_at on public.quick_transactions;
create trigger quick_transactions_updated_at before update on public.quick_transactions
  for each row execute function public.set_updated_at();
