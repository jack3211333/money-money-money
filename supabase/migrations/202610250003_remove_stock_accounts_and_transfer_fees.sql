-- Stocks are independent assets; transfer fees are categorized expense rows
-- inside their transfer group and are written atomically with the transfer.
begin;

-- Retire the stock account kind and detach every existing stock record.
alter table public.stocks alter column account_id drop not null;
update public.stocks set account_id = null where account_id is not null;
update public.accounts set kind = 'bank' where kind = 'stock';
alter table public.accounts drop constraint accounts_kind_check;
alter table public.accounts
  add constraint accounts_kind_check check (kind in ('cash', 'bank', 'stored_value'));

-- Existing transfers remain unchanged and therefore have no fee row.
alter table public.transactions
  add column is_transfer_fee boolean not null default false;
alter table public.transactions drop constraint transactions_check;
alter table public.transactions add constraint transactions_transfer_shape_check check (
  (kind in ('transfer_in', 'transfer_out') and transfer_group_id is not null and category_id is null and not is_transfer_fee)
  or (kind in ('income', 'expense') and transfer_group_id is null and not is_transfer_fee)
  or (kind = 'expense' and transfer_group_id is not null and category_id is not null and is_transfer_fee)
);
create unique index transactions_one_transfer_fee_idx
  on public.transactions (transfer_group_id)
  where is_transfer_fee and deleted_at is null;

create or replace function public.save_transfer(
  p_group_id uuid,
  p_transaction_date date,
  p_amount bigint,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_note text,
  p_transfer_fee bigint,
  p_fee_category_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  owner_id uuid := auth.uid();
  matching_accounts integer;
begin
  if owner_id is null then raise exception '尚未登入。'; end if;
  if p_group_id is null or p_transaction_date is null or p_amount is null or p_amount <= 0 then
    raise exception '轉帳資料不完整或金額無效。';
  end if;
  if p_from_account_id is null or p_to_account_id is null or p_from_account_id = p_to_account_id then
    raise exception '轉出與轉入帳戶必須不同。';
  end if;
  if p_transfer_fee is null or p_transfer_fee < 0 then raise exception '手續費不可小於 0。'; end if;
  if p_transfer_fee > 0 and p_fee_category_id is null then raise exception '找不到手續費分類。'; end if;
  if exists (
    select 1 from public.transactions
    where transfer_group_id = p_group_id and user_id <> owner_id
  ) then
    raise exception '無法修改這筆轉帳。';
  end if;

  select count(*) into matching_accounts
  from public.accounts
  where id in (p_from_account_id, p_to_account_id)
    and user_id = owner_id and deleted_at is null and not is_archived;
  if matching_accounts <> 2 then raise exception '請選擇有效的轉帳帳戶。'; end if;

  if p_transfer_fee > 0 and not exists (
    select 1
    from public.categories child
    join public.categories parent on parent.id = child.parent_id
    where child.id = p_fee_category_id
      and child.user_id = owner_id and child.name = '手續費'
      and child.direction = 'expense' and child.deleted_at is null
      and parent.user_id = owner_id and parent.name = '金融/政府'
      and parent.direction = 'expense' and parent.deleted_at is null
  ) then
    raise exception '手續費必須使用「金融/政府 › 手續費」分類。';
  end if;

  update public.transactions
  set deleted_at = timezone('utc', now())
  where transfer_group_id = p_group_id and user_id = owner_id and deleted_at is null;

  insert into public.transactions
    (user_id, transaction_date, amount, kind, account_id, category_id, transfer_group_id, is_transfer_fee, note)
  values
    (owner_id, p_transaction_date, p_amount, 'transfer_out', p_from_account_id, null, p_group_id, false, coalesce(p_note, '')),
    (owner_id, p_transaction_date, p_amount, 'transfer_in', p_to_account_id, null, p_group_id, false, coalesce(p_note, ''));

  if p_transfer_fee > 0 then
    insert into public.transactions
      (user_id, transaction_date, amount, kind, account_id, category_id, transfer_group_id, is_transfer_fee, note)
    values
      (owner_id, p_transaction_date, p_transfer_fee, 'expense', p_from_account_id, p_fee_category_id, p_group_id, true, coalesce(p_note, ''));
  end if;
end;
$$;

revoke all on function public.save_transfer(uuid, date, bigint, uuid, uuid, text, bigint, uuid) from public, anon;
grant execute on function public.save_transfer(uuid, date, bigint, uuid, uuid, text, bigint, uuid) to authenticated;

commit;
