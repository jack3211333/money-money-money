-- Preserve each stock's value as of migration time, then retire share and cost tracking.
update public.stocks
set valuation_amount = round(
      coalesce(valuation_amount, total_cost)::numeric
      * power(
          1 + annual_return_bps::numeric / 10000,
          greatest(
            0,
            (extract(year from age(current_date, coalesce(valuation_date, created_at::date)))::integer * 12)
              + extract(month from age(current_date, coalesce(valuation_date, created_at::date)))::integer
          ) / 12.0
        )
    )::bigint,
    valuation_date = current_date;

alter table public.stocks drop constraint stocks_check;
alter table public.stocks alter column valuation_amount set not null;
alter table public.stocks alter column valuation_date set not null;
alter table public.stocks drop column shares;
alter table public.stocks drop column total_cost;
