-- Add two-level categories, selectable icons, and starter categories.
alter table public.categories
  add column parent_id uuid references public.categories(id),
  add column icon_key text not null default 'tag' check (char_length(icon_key) between 1 and 50);

alter table public.categories drop constraint if exists categories_user_id_name_direction_key;
alter table public.categories add constraint categories_parent_not_self check (parent_id is null or parent_id <> id);

create unique index categories_root_name_unique
  on public.categories (user_id, direction, lower(name))
  where parent_id is null and deleted_at is null;

create unique index categories_child_name_unique
  on public.categories (user_id, parent_id, lower(name))
  where parent_id is not null and deleted_at is null;

create index categories_parent_idx
  on public.categories (parent_id, sort_order)
  where deleted_at is null;

create or replace function public.validate_category_hierarchy()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  parent_row public.categories%rowtype;
  active_children integer;
begin
  if new.parent_id is null then
    if tg_op = 'UPDATE' and new.direction <> old.direction and exists (
      select 1 from public.categories child
      where child.parent_id = new.id and child.deleted_at is null
    ) then
      raise exception '請先移動或刪除小分類，再變更大分類的收支方向。';
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
    select count(*) into active_children
    from public.categories child
    where child.parent_id = new.parent_id
      and child.deleted_at is null
      and child.id <> new.id;
    if active_children >= 3 then
      raise exception '每個大分類最多 3 個小分類。';
    end if;
  end if;
  return new;
end;
$$;

create trigger categories_validate_hierarchy
before insert or update of parent_id, user_id, direction, deleted_at on public.categories
for each row execute function public.validate_category_hierarchy();

create or replace function public.seed_default_categories(target_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  work_id uuid := gen_random_uuid();
  other_income_id uuid := gen_random_uuid();
  food_id uuid := gen_random_uuid();
  transport_id uuid := gen_random_uuid();
  home_id uuid := gen_random_uuid();
  life_id uuid := gen_random_uuid();
  leisure_id uuid := gen_random_uuid();
begin
  if exists (select 1 from public.categories where user_id = target_user) then return; end if;

  insert into public.categories (id, user_id, name, direction, color, icon_key, sort_order) values
    (work_id, target_user, '工作收入', 'income', '#72e3bc', 'briefcase-business', 10),
    (other_income_id, target_user, '其他收入', 'income', '#7dd3fc', 'wallet-cards', 20),
    (food_id, target_user, '餐飲', 'expense', '#f4b873', 'utensils', 10),
    (transport_id, target_user, '交通', 'expense', '#7dd3fc', 'car', 20),
    (home_id, target_user, '居家帳單', 'expense', '#c4b5fd', 'house', 30),
    (life_id, target_user, '生活健康', 'expense', '#f9a8d4', 'shopping-bag', 40),
    (leisure_id, target_user, '休閒人情', 'expense', '#fca5a5', 'party-popper', 50);

  insert into public.categories (user_id, parent_id, name, direction, color, icon_key, sort_order) values
    (target_user, work_id, '薪資', 'income', '#72e3bc', 'banknote', 11),
    (target_user, work_id, '獎金', 'income', '#72e3bc', 'sparkles', 12),
    (target_user, work_id, '兼職接案', 'income', '#72e3bc', 'laptop', 13),
    (target_user, other_income_id, '投資收益', 'income', '#7dd3fc', 'trending-up', 21),
    (target_user, other_income_id, '回饋退款', 'income', '#7dd3fc', 'rotate-ccw', 22),
    (target_user, other_income_id, '禮金其他', 'income', '#7dd3fc', 'gift', 23),
    (target_user, food_id, '正餐', 'expense', '#f4b873', 'utensils-crossed', 11),
    (target_user, food_id, '飲料咖啡', 'expense', '#f4b873', 'coffee', 12),
    (target_user, food_id, '點心外送', 'expense', '#f4b873', 'cake-slice', 13),
    (target_user, transport_id, '大眾運輸', 'expense', '#7dd3fc', 'bus', 21),
    (target_user, transport_id, '汽機車', 'expense', '#7dd3fc', 'fuel', 22),
    (target_user, transport_id, '計程車共享', 'expense', '#7dd3fc', 'car', 23),
    (target_user, home_id, '房租房貸', 'expense', '#c4b5fd', 'building-2', 31),
    (target_user, home_id, '水電網路', 'expense', '#c4b5fd', 'zap', 32),
    (target_user, home_id, '生活用品', 'expense', '#c4b5fd', 'shopping-basket', 33),
    (target_user, life_id, '服飾', 'expense', '#f9a8d4', 'shirt', 41),
    (target_user, life_id, '3C 用品', 'expense', '#f9a8d4', 'monitor-smartphone', 42),
    (target_user, life_id, '醫療保健', 'expense', '#f9a8d4', 'heart-pulse', 43),
    (target_user, leisure_id, '娛樂', 'expense', '#fca5a5', 'gamepad-2', 51),
    (target_user, leisure_id, '旅行', 'expense', '#fca5a5', 'plane', 52),
    (target_user, leisure_id, '禮物交際', 'expense', '#fca5a5', 'gift', 53);
end;
$$;

revoke all on function public.seed_default_categories(uuid) from public, anon, authenticated;

create or replace function public.ensure_default_categories()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '尚未登入。'; end if;
  perform public.seed_default_categories(auth.uid());
end;
$$;

revoke all on function public.ensure_default_categories() from public, anon;
grant execute on function public.ensure_default_categories() to authenticated;

create or replace function public.soft_delete_category(target_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare
  deleted_time timestamptz := timezone('utc', now());
begin
  if not exists (
    select 1 from public.categories
    where id = target_id and user_id = auth.uid() and deleted_at is null
  ) then raise exception '找不到分類。'; end if;

  update public.categories set deleted_at = deleted_time
  where parent_id = target_id and user_id = auth.uid() and deleted_at is null;
  update public.categories set deleted_at = deleted_time
  where id = target_id and user_id = auth.uid() and deleted_at is null;
end;
$$;

revoke all on function public.soft_delete_category(uuid) from public, anon;
grant execute on function public.soft_delete_category(uuid) to authenticated;

select public.seed_default_categories(id) from auth.users;
