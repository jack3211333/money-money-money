alter table public.accounts
  add column if not exists sort_order integer not null default 0;

-- Preserve the prior account display order (name ascending) on the first run.
-- The all-zero guard makes the data initialization safe to rerun.
with accounts_to_initialize as (
  select user_id
  from public.accounts
  group by user_id
  having count(*) > 1 and min(sort_order) = 0 and max(sort_order) = 0
), ranked_accounts as (
  select a.id, row_number() over (partition by a.user_id order by a.name, a.id) - 1 as sort_order
  from public.accounts a
  join accounts_to_initialize u on u.user_id = a.user_id
)
update public.accounts a
set sort_order = ranked_accounts.sort_order
from ranked_accounts
where a.id = ranked_accounts.id and a.sort_order = 0;

create index if not exists accounts_user_sort_order_idx
  on public.accounts (user_id, sort_order)
  where deleted_at is null;
