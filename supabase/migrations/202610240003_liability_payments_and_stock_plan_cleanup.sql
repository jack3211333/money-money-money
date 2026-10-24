alter table public.liabilities add column monthly_payment bigint;

update public.liabilities
set annual_rate_bps = case when kind = 'installment' then 0 else annual_rate_bps end,
    monthly_payment = greatest(1, round(
      case
        when kind = 'installment' or annual_rate_bps = 0
          then principal::numeric / term_months
        else
          principal::numeric
            * (annual_rate_bps::numeric / 10000 / 12)
            * power(1 + annual_rate_bps::numeric / 10000 / 12, term_months)
            / (power(1 + annual_rate_bps::numeric / 10000 / 12, term_months) - 1)
      end
    ))::bigint;

alter table public.liabilities alter column monthly_payment set not null;
alter table public.liabilities add constraint liabilities_monthly_payment_check check (monthly_payment > 0);

update public.investment_plans as plan
set deleted_at = stock.deleted_at,
    updated_at = timezone('utc', now())
from public.stocks as stock
where plan.stock_id = stock.id
  and plan.user_id = stock.user_id
  and plan.deleted_at is null
  and stock.deleted_at is not null;

create or replace function public.soft_delete_stock_investment_plans()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    update public.investment_plans
    set deleted_at = new.deleted_at,
        updated_at = timezone('utc', now())
    where stock_id = new.id
      and user_id = new.user_id
      and deleted_at is null;
  end if;
  return new;
end;
$$;

revoke all on function public.soft_delete_stock_investment_plans() from public;

create trigger stocks_soft_delete_investment_plans
after update of deleted_at on public.stocks
for each row
when (old.deleted_at is null and new.deleted_at is not null)
execute function public.soft_delete_stock_investment_plans();
