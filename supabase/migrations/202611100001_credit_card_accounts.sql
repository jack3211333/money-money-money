-- 信用卡帳戶：新增帳戶類型 credit_card（初始金額固定 0），並讓推演一次性支出可連結信用卡帳單。
-- 重建 accounts_kind_check 只放寬允許值，不變更既有資料；套用前已備份至 backup.accounts_20261110。
alter table public.accounts drop constraint if exists accounts_kind_check;
alter table public.accounts
  add constraint accounts_kind_check check (kind in ('cash', 'bank', 'stored_value', 'credit_card'));

create or replace function public.validate_credit_card_account()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.kind = 'credit_card' and new.opening_balance <> 0 then
    raise exception '信用卡帳戶的初始金額必須為 0。';
  end if;
  return new;
end;
$$;

create or replace trigger accounts_validate_credit_card before insert or update on public.accounts
  for each row execute function public.validate_credit_card_account();

-- 推演的信用卡帳單：account_id 連結信用卡帳戶；auto_amount=true 時 App 依目前欠款自動更新金額。
alter table public.forecast_events add column if not exists account_id uuid references public.accounts(id);
alter table public.forecast_events add column if not exists auto_amount boolean not null default true;

create index if not exists forecast_events_user_account_date_idx
  on public.forecast_events (user_id, account_id, event_date)
  where account_id is not null;

create or replace function public.validate_forecast_event_account()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.account_id is not null and not exists (
    select 1 from public.accounts a
    where a.id = new.account_id and a.user_id = new.user_id and a.kind = 'credit_card'
  ) then
    raise exception '推演帳單只能連結自己的信用卡帳戶。';
  end if;
  if new.account_id is not null and new.kind <> 'expense' then
    raise exception '信用卡帳單必須是一次性支出。';
  end if;
  return new;
end;
$$;

create or replace trigger forecast_events_validate_account before insert or update on public.forecast_events
  for each row execute function public.validate_forecast_event_account();
