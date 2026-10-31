alter table public.stocks
  add column if not exists shares bigint check (shares >= 0);
