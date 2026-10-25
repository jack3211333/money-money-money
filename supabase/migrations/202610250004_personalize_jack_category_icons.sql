-- Apply a coherent icon and color system only to jack3211333@gmail.com's active categories.
do $$
declare
  target_user uuid;
begin
  select id into target_user from auth.users where email = 'jack3211333@gmail.com';
  if target_user is null then
    raise exception 'Target user was not found';
  end if;

  update public.categories
  set
    color = case name
      when '飲食' then '#f4b873' when '交通' then '#60a5fa' when '娛樂' then '#c084fc'
      when '訂閱' then '#34d399' when '購物' then '#f472b6' when '金融/政府' then '#fbbf24'
      when '個人' then '#fb7185' when '醫療' then '#22c55e' when '家居家庭' then '#a78bfa'
      when '學習' then '#38bdf8' when '人情往來' then '#fb923c' when '其它' then '#94a3b8'
      when '薪資' then '#60a5fa' when '獎金' then '#fbbf24' when '投資' then '#34d399'
      when '博弈' then '#c084fc' when '借款' then '#fb923c' when '還款' then '#22c55e'
      when '補助' then '#38bdf8' else color end,
    icon_key = case name
      when '飲食' then 'utensils' when '交通' then 'car' when '娛樂' then 'party-popper'
      when '訂閱' then 'laptop' when '購物' then 'shopping-bag' when '金融/政府' then 'landmark'
      when '個人' then 'circle-ellipsis' when '醫療' then 'stethoscope' when '家居家庭' then 'house'
      when '學習' then 'graduation-cap' when '人情往來' then 'gift' when '其它' then 'circle-ellipsis'
      when '薪資' then 'banknote' when '獎金' then 'sparkles' when '投資' then 'trending-up'
      when '博弈' then 'circle-dollar-sign' when '借款' then 'hand-coins' when '還款' then 'rotate-ccw'
      when '補助' then 'badge-dollar-sign' else icon_key end
  where user_id = target_user and parent_id is null and deleted_at is null;

  update public.categories child
  set
    color = parent.color,
    icon_key = case child.name
      when '早餐' then 'coffee' when '午餐' then 'utensils-crossed' when '晚餐' then 'utensils-crossed'
      when '宵夜' then 'soup' when '零食/點心' then 'cake-slice' when '飲料' then 'coffee'
      when '酒類' then 'beer' when '水果' then 'apple' when '下午茶' then 'coffee'
      when '加油' then 'fuel' when '停車' then 'car' when '火車' then 'train-front'
      when '高鐵' then 'train-front' when '捷運' then 'tram-front' when '輕軌' then 'tram-front'
      when '計程車' then 'car' when '公車' then 'bus' when 'Ubike' then 'bike'
      when '機票' then 'plane' when '船票' then 'plane' when '租車' then 'car'
      when '維修保養' then 'wrench' when '導航王' then 'car' when '罰單' then 'receipt-text' when 'Etag' then 'receipt-text'
      when '電影' then 'film' when '展覽' then 'party-popper' when '音樂' then 'music'
      when '遊戲' then 'gamepad-2' when '運動' then 'dumbbell' when '健身' then 'dumbbell'
      when '出遊' then 'plane' when '社交' then 'gift'
      when 'Netflix' then 'film' when 'Disney+' then 'film' when 'YouTube' then 'monitor-smartphone'
      when 'YouTube Music' then 'music' when 'iCloud' then 'laptop'
      when '市場' then 'shopping-basket' when '衣物' then 'shirt' when '鞋子' then 'shirt'
      when '配件' then 'shopping-bag' when '包包' then 'shopping-bag' when '美妝保養' then 'scissors'
      when '電子產品' then 'monitor-smartphone'
      when '稅金' then 'receipt-text' when '保險' then 'shield-check' when '股票' then 'trending-up'
      when '貸款' then 'hand-coins' when '手續費' then 'receipt-text' when '信用卡' then 'credit-card'
      when '無卡分期' then 'wallet-cards'
      when '手機費' then 'smartphone' when '捐款' then 'heart-pulse' when '菸' then 'cigarette'
      when '門診' then 'stethoscope' when '牙齒保健' then 'heart-pulse' when '藥品' then 'pill'
      when '醫療用品' then 'heart-pulse' when '住院' then 'building-2' when '手術' then 'stethoscope' when '健檢' then 'heart-pulse'
      when '日用品' then 'shopping-basket' when '水費' then 'zap' when '電費' then 'zap'
      when '燃料費' then 'fuel' when '網路費' then 'wifi' when '房租' then 'building-2'
      when '修繕費' then 'wrench' when '家具' then 'house' when '家電' then 'house-plug'
      when '孝親費' then 'heart-pulse' when '寵物' then 'paw-print'
      when '書籍' then 'book-open' when '課程' then 'graduation-cap' when '教材' then 'book-open'
      when '證書' then 'graduation-cap' when '文具' then 'book-open'
      when '送禮' then 'gift' when '紅包' then 'gift' when '借款' then 'hand-coins' when '還款' then 'rotate-ccw'
      when '呆帳' then 'circle-ellipsis' else child.icon_key end
  from public.categories parent
  where child.parent_id = parent.id and child.user_id = target_user and child.deleted_at is null and parent.deleted_at is null;
end $$;
