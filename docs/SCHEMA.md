# 資料表結構

此文件記錄 Money Money Money 1.2 的 Supabase schema 與 migration 沿革。1.1 延續既有 schema，股數欄位 migration 已列於下方；後續僅在有新需求時規劃資料庫變更。

Migrations：

> 2026-10-28 離線交易功能沒有資料庫 schema 或 migration 變更；快照、待同步交易與失敗通知僅儲存在各裝置 IndexedDB。
> 2026-10-28 `202610280001_quick_transactions.sql`：已套用；新增使用者隔離的快速交易選項資料表及索引，並確認 RLS、政策與 trigger 已建立。
> 2026-10-28 20:12（台北時間）`202610280002_account_sort_order.sql`：已套用；為帳戶新增 `sort_order`，以既有名稱順序初始化並新增使用者排序索引。已查驗欄位、索引存在，且 accounts RLS 啟用、擁有者政策仍有效。
> 2026-11-01（台北時間；使用者回報已套用，實際時間未提供）`202611010001_add_stock_shares.sql`：新增可空的 `stocks.shares` bigint 欄位，並限制股數不得小於 0；既有資料不回填。
> 2026-11-04（使用者回報已套用，實際時間未提供）`202611040001_push_notifications.sql`：新增具 RLS 的推播訂閱表與有效 endpoint 唯一索引、更新時間 trigger，並從 Vault 設定每日台灣時間 06:00／23:00 的 pg_cron 工作；migration 不包含任何專案 URL 或密鑰值。
> 2026-11-09 20:48（台北時間）`202611090001_net_worth_snapshots.sql`：已透過 Supabase Management API 套用，重複執行無誤；新增 `net_worth_snapshots`，`(user_id, snapshot_month)` 唯一、RLS 政策、`updated_at` trigger 與索引均已查驗存在。
> 2026-11-10（台北時間）信用卡帳戶 migration `202611100001_credit_card_accounts.sql` 曾套用，後依使用者要求退版至 0e20fc0 並退回資料庫：刪除其 trigger、函式、索引與 `forecast_events.account_id`／`auto_amount` 欄位，`accounts_kind_check` 恢復為 `cash`／`bank`／`stored_value`（已軟刪除的測試信用卡帳戶改為 `bank`）。資料還原：恢復國泰世華 2026-11-03 的 14,071 元支出，軟刪除同日轉帳至信用卡的轉帳組。退回前備份於 `backup.*_20261110` 與 `backup.*_20261110_rollback`。目前 schema 與本文件其餘內容一致。

> 2026-11-10（台北時間）iPhone 小工具沒有資料庫 schema 或 migration 變更；新增只讀 Edge Function `widget-summary` 讀取既有資料表。
> 2026-11-10（台北時間）Excel 財務報表沒有資料庫 schema 或 migration 變更；只讀取 App 已載入的資料。
> 2026-11-10 19:54（台北時間）`202611100002_daily_stock_price_update.sql`：已透過 Supabase Management API 套用，重複執行無誤；新增 pg_cron 工作 `daily-stock-price-update`（`0 10 * * 1-5`，台灣時間週一至週五 18:00）以 Vault 的 `project_url`、`cron_secret` 呼叫 Edge Function `stock-price-update`；無資料表結構變更。已查驗工作為 active。套用前備份 `backup.stocks_20261110_price_job`。
> 2026-11-13 22:13（台北時間）`202611130001_stock_price_updated_at.sql`：已透過 Supabase Management API 套用，重複執行無誤；新增可空的 `stocks.price_updated_at` timestamptz（市值更新時間），並將 `daily-stock-price-update` 的 pg_net 等待上限由 60 秒放寬為 140 秒（原本 11/11–11/13 的排程呼叫皆逾時未更新）。已查驗欄位存在、stocks RLS 啟用、排程 active。套用前備份 `backup.stocks_20261113_price_time`。

- `supabase/migrations/202610230001_initial_finance_schema.sql`
- `supabase/migrations/202610230002_hierarchical_category_icons.sql`
- `supabase/migrations/202610240001_account_icons.sql`
- `supabase/migrations/202610240002_simplify_stock_valuation.sql`
- `supabase/migrations/202610240003_liability_payments_and_stock_plan_cleanup.sql`
- `supabase/migrations/202610240004_forecast_events.sql`
- `supabase/migrations/202610250001_replace_category_catalog_and_expand_limits.sql`
- `supabase/migrations/202610250002_forecast_without_funding_accounts.sql`
- `supabase/migrations/202610250003_remove_stock_accounts_and_transfer_fees.sql`
- `supabase/migrations/202610250004_personalize_jack_category_icons.sql`
- `supabase/migrations/202610280001_quick_transactions.sql`
- `supabase/migrations/202610280002_account_sort_order.sql`
- `supabase/migrations/202611010001_add_stock_shares.sql`
- `supabase/migrations/202611040001_push_notifications.sql`（使用者回報已套用）
- `supabase/migrations/202611090001_net_worth_snapshots.sql`
- `supabase/migrations/202611100002_daily_stock_price_update.sql`
- `supabase/migrations/202611130001_stock_price_updated_at.sql`

| 資料表 | 用途 |
| --- | --- |
| `accounts` | 現金、銀行、儲值卡；起始餘額、封存狀態、可為空的 `icon_key` 與使用者自訂 `sort_order`。 |
| `categories` | 兩層收入／支出分類；`parent_id` 為空時是大分類，否則是小分類；`icon_key` 儲存圖示。 |
| `transactions` | 收入、支出及成對轉帳；轉帳以 `transfer_group_id` 連結。轉帳手續費另存同群組、帶有 `is_transfer_fee` 標記的支出資料。 |
| `quick_transactions` | 使用者自訂的收入／支出預填選項；保存金額、帳戶、可選分類與備註，不會建立帳本交易。 |
| `push_subscriptions` | Web Push endpoint 與加密金鑰；以 `user_id`、時間欄位、軟刪除及 RLS 管理，僅保留有效 endpoint 唯一性；保存最近成功推播時間。 |
| `liabilities` | 貸款或分期負債：本金、年利率、整數元月繳款、期數、起始日。分期使用 0% 利率及自訂月繳款。 |
| `stocks` | 可為空的舊帳戶關聯、代號、選填股數、目前市值基準日期、市值更新時間 `price_updated_at` 與年化報酬率；不記錄總成本。股票帳戶關聯已移除，既有股票的 `account_id` 清空。 |
| `recurring_rules` | 僅供推演的固定收入或支出；保留可選分類，不分配至帳戶。 |
| `investment_plans` | 僅供推演的每月股票持續投入；連結股票，不指定扣款帳戶。 |
| `forecast_events` | 僅供推演的一次性收入或支出；記錄日期、項目與金額，不分配至帳戶。 |
| `net_worth_snapshots` | 每位使用者每月一筆淨資產快照：現金、股票、負債、淨資產（TWD 整數元）與是否為推算值。 |

所有表均有 UUID `id`、`user_id`、`created_at`、`updated_at`、`deleted_at`。金額使用 `bigint`（TWD 整數元）；所有表均啟用 RLS，政策限定 `auth.uid() = user_id`。

`categories` 只允許大分類與小分類兩層，大小分類必須同一使用者且收支方向相同。收入只允許大分類。資料庫 trigger 限制每位使用者最多 20 個支出大分類、15 個收入大分類，且每個支出大分類最多 20 個有效小分類。預設模板為 12 個支出大分類及文件指定的小分類、7 個收入大分類；只有帳號完全沒有分類記錄時才會建立。202610250001 migration 將既有有效分類軟刪除並建立新模板，並將所有交易及固定收支的 `category_id` 設為空值。

`accounts.icon_key` 可為空，既有帳戶不回填圖標。帳戶圖標使用獨立的 `account-icon-1` 至 `account-icon-14` key；圖片為本機靜態資產，並非使用者上傳資料。`account-icon-14` 為 LINE Pay 圖示。

`accounts.sort_order` 為使用者專屬整數順序，總覽、設定與帳戶選單共用此順序；設定頁可排序封存帳戶，但封存帳戶不出現在交易選單。`202610280002` 依既有名稱升冪順序初始化，新增帳戶由 Repository 指派目前末端的下一個值。

`accounts.kind` 允許 `cash`、`bank` 與 `stored_value`（儲值卡）；儲值卡與現金、銀行一樣計入總現金與淨資產。`202610250002` migration 移除 `recurring_rules.account_id`、`target_account_id`、`investment_plans.funding_account_id` 與 `forecast_events.account_id`。既有固定轉帳先軟刪除；有效固定設定只允許收入與支出。推演收支直接加減總現金，股票持續投入減少總現金並增加所選股票市值。`202610250003` 移除股票帳戶類型，並清空舊股票的帳戶關聯。

`transactions.is_transfer_fee` 預設為 `false`。有手續費的轉帳使用同一個 `transfer_group_id` 寫入一筆 `kind='expense'`、`is_transfer_fee=true` 的支出，帳戶為轉出帳戶，分類為「金融/政府 › 手續費」。手續費為 0 時不建立該支出資料；既有轉帳因沒有手續費資料列而視為 0。`save_transfer` RPC 在單一資料庫交易中軟刪除舊群組資料並重建轉帳與可選手續費，且確認帳戶、分類及群組屬於目前使用者。

`202610250004` 只更新 `jack3211333@gmail.com` 的有效分類外觀設定：依分類名稱寫入 Lucide `icon_key`，並把每個支出大分類及其小分類設為同一 `color`。未變更分類名稱、層級、交易關聯或其他使用者資料。

`stocks.valuation_amount` 與 `valuation_date` 必填，代表目前市值基準及其日期。估值與推演依年化報酬率計算。202610240002 migration 將既有股票截至套用日的推算市值回填為新基準，再移除當時的 `shares` 與 `total_cost`。`202611010001` 重新加入可空的 `shares`（bigint，限制大於等於 0），用於收盤價更新時計算持倉市值。App 新增／編輯股票時要求抓取收盤價並輸入股數，自動計算整數元市值、以操作當天作為估值日期；資產頁亦可批次更新已有股數的股票；另由 pg_cron 每個交易日台灣時間 18:00 呼叫 `stock-price-update`，以 TWSE／TPEx 當日收盤價（查不到時退回最近一日）自動更新所有使用者已填股數的股票，估值日期採行情資料日期，且不覆蓋估值日期較新的手動估值。`price_updated_at` 於手動抓價儲存、批次更新或排程以收盤價確認時寫入當下時間（排程即使市值未變也會寫入），資產頁顯示為「市值更新時間」；收盤價日期與更新時間的日期不同時一併顯示收盤價日期。年化報酬率仍可手動設定。

`liabilities.monthly_payment` 必填且為正整數 TWD。貸款年利率與月繳款按本息平均攤還公式互算；既有月繳款由原年利率回填。分期不顯示年利率，固定使用 0%；migration 將既有分期利率設為 0%，月繳款回填為本金除以期數的整數元。刪除股票時，資料庫 trigger 會軟刪除同一使用者對應的有效 `investment_plans`；推演亦只採用仍有效股票的計畫。

`forecast_events` 含 `name`、`kind`（income／expense）、`amount` 與 `event_date`。指定日期落在推演的未來 12 個月且未早於當日時，只計入該月一次；不建立真實交易。每筆資料具 `user_id`、時間欄位、軟刪除與 RLS。

`quick_transactions` 僅允許 `income`／`expense`，金額為正整數，關聯帳戶與可選分類，並保存備註。資料以 `user_id`、建立／更新時間與 `deleted_at` 管理，RLS 限制使用者僅能存取自己的快速選項。選取選項只會預填交易表單；使用者按儲存前不會建立交易。202610280001 migration 新增此表與有效資料索引。

`push_subscriptions` 只由登入者管理自己的訂閱；endpoint 有效資料使用部分唯一索引，關閉通知會軟刪除。202611040001 另啟用 pg_cron／pg_net，工作以 Vault 的 `project_url`、`cron_secret` 呼叫 `daily-budget-push`，不在 migration 保存秘密值；使用者已回報套用。

`net_worth_snapshots` 的 `snapshot_month` 必須是當月 1 日，`(user_id, snapshot_month)` 為唯一限制（供 App upsert）；`stocks`、`liabilities` 不得為負，`net_worth` 必須等於 `cash + stocks - liabilities`。`is_estimated=true` 代表依月底推算的補齊值（股票以目前估值基準估算），會隨補記交易更新；`false` 為 App 實際記錄的本月值，跨月後不再覆蓋。
