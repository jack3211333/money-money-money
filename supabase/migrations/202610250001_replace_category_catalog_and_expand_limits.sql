-- Replace each user's active category catalog with the requested taxonomy.
-- Existing transaction and recurring-rule classifications are intentionally reset.

create or replace function public.validate_category_hierarchy()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  parent_row public.categories%rowtype;
  active_children integer;
  active_roots integer;
  root_limit integer;
begin
  if new.parent_id is null then
    if tg_op = 'UPDATE' and new.direction <> old.direction and exists (
      select 1 from public.categories child
      where child.parent_id = new.id and child.deleted_at is null
    ) then
      raise exception '請先移動或刪除小分類，再變更大分類的收支方向。';
    end if;

    if new.deleted_at is null then
      root_limit := case when new.direction = 'expense' then 20 else 15 end;
      select count(*) into active_roots
      from public.categories root
      where root.user_id = new.user_id
        and root.direction = new.direction
        and root.parent_id is null
        and root.deleted_at is null
        and root.id <> new.id;
      if active_roots >= root_limit then
        raise exception '% 大分類最多 % 個。', case when new.direction = 'expense' then '支出' else '收入' end, root_limit;
      end if;
    end if;
    return new;
  end if;

  select * into parent_row from public.categories where id = new.parent_id;
  if not found or parent_row.deleted_at is not null then
    raise exception '找不到有效的大分類。';
  end if;
  if parent_row.parent_id is not null then
    raise exception '分類最多只能有大分類與小分類兩層。';
  end if;
  if parent_row.user_id <> new.user_id then
    raise exception '大小分類必須屬於同一使用者。';
  end if;
  if parent_row.direction <> new.direction then
    raise exception '小分類必須與大分類的收支方向相同。';
  end if;
  if new.deleted_at is null then
    if parent_row.direction = 'income' then
      raise exception '收入分類只能使用大分類。';
    end if;
    select count(*) into active_children
    from public.categories child
    where child.parent_id = new.parent_id
      and child.deleted_at is null
      and child.id <> new.id;
    if active_children >= 20 then
      raise exception '每個支出大分類最多 20 個小分類。';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.populate_default_categories(target_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  category_spec record;
  parent_id uuid;
  child_index integer;
begin
  for category_spec in
    select * from (values
      ('飲食', 'expense', 10, '#f4b873', array['早餐','午餐','晚餐','宵夜','零食/點心','飲料','酒類','水果','下午茶']::text[]),
      ('交通', 'expense', 20, '#f4b873', array['加油','停車','火車','高鐵','捷運','輕軌','計程車','公車','Ubike','機票','船票','租車','維修保養','導航王','罰單','Etag']::text[]),
      ('娛樂', 'expense', 30, '#f4b873', array['電影','展覽','音樂','遊戲','運動','博弈','健身','出遊']::text[]),
      ('訂閱', 'expense', 40, '#f4b873', array['Netflix','Disney+','YouTube','YouTube Music','iCloud']::text[]),
      ('購物', 'expense', 50, '#f4b873', array['市場','衣物','鞋子','配件','包包','美妝保養','電子產品']::text[]),
      ('金融/政府', 'expense', 60, '#f4b873', array['稅金','保險','股票','貸款','手續費']::text[]),
      ('個人', 'expense', 70, '#f4b873', array['手機費','捐款']::text[]),
      ('醫療', 'expense', 80, '#f4b873', array['門診','牙齒保健','藥品','醫療用品','住院','手術','健檢']::text[]),
      ('家居家庭', 'expense', 90, '#f4b873', array['日用品','水費','電費','燃料費','網路費','房租','修繕費','家具','家電','孝親費','寵物']::text[]),
      ('學習', 'expense', 100, '#f4b873', array['書籍','課程','教材','證書','文具']::text[]),
      ('人情往來', 'expense', 110, '#f4b873', array['送禮','紅包','借款','還款']::text[]),
      ('其它', 'expense', 120, '#f4b873', array['呆帳']::text[]),
      ('薪資', 'income', 10, '#72e3bc', array[]::text[]),
      ('獎金', 'income', 20, '#72e3bc', array[]::text[]),
      ('投資', 'income', 30, '#72e3bc', array[]::text[]),
      ('博弈', 'income', 40, '#72e3bc', array[]::text[]),
      ('借款', 'income', 50, '#72e3bc', array[]::text[]),
      ('還款', 'income', 60, '#72e3bc', array[]::text[]),
      ('補助', 'income', 70, '#72e3bc', array[]::text[])
    ) as specs(name, direction, sort_order, color, children)
  loop
    insert into public.categories (user_id, name, direction, color, icon_key, sort_order)
    values (target_user, category_spec.name, category_spec.direction, category_spec.color, 'tag', category_spec.sort_order)
    returning id into parent_id;

    if cardinality(category_spec.children) > 0 then
      for child_index in 1..cardinality(category_spec.children) loop
        insert into public.categories (user_id, parent_id, name, direction, color, icon_key, sort_order)
        values (target_user, parent_id, category_spec.children[child_index], category_spec.direction, category_spec.color, 'tag', category_spec.sort_order + child_index);
      end loop;
    end if;
  end loop;
end;
$$;

revoke all on function public.populate_default_categories(uuid) from public, anon, authenticated;

create or replace function public.seed_default_categories(target_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.categories where user_id = target_user) then return; end if;
  perform public.populate_default_categories(target_user);
end;
$$;

revoke all on function public.seed_default_categories(uuid) from public, anon, authenticated;

-- Clear assignments before retiring categories so all historical rows become uncategorized.
update public.transactions set category_id = null where category_id is not null;
update public.recurring_rules set category_id = null where category_id is not null;

-- Retire children first because the hierarchy trigger requires an active parent while validating children.
update public.categories
set deleted_at = timezone('utc', now())
where parent_id is not null and deleted_at is null;

update public.categories
set deleted_at = timezone('utc', now())
where parent_id is null and deleted_at is null;

select public.populate_default_categories(id) from auth.users;
