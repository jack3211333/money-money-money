-- Add stored-value accounts and remove account allocation from forecast-only settings.
begin;

alter table public.accounts drop constraint accounts_kind_check;
alter table public.accounts
  add constraint accounts_kind_check check (kind in ('cash', 'bank', 'stock', 'stored_value'));

-- A forecast transfer has no meaning after its source and target accounts are removed.
-- Keep its row as soft-deleted history; active rules may only be income or expense.
update public.recurring_rules
set deleted_at = timezone('utc', now())
where kind = 'transfer' and deleted_at is null;

alter table public.recurring_rules drop constraint recurring_rules_check;
alter table public.recurring_rules
  drop column account_id,
  drop column target_account_id;
alter table public.recurring_rules
  add constraint recurring_rules_active_kind_check
  check (deleted_at is not null or kind in ('income', 'expense'));

alter table public.investment_plans drop column funding_account_id;
alter table public.forecast_events drop column account_id;

commit;
