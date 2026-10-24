# 資料表結構

Migrations：

- `supabase/migrations/202610230001_initial_finance_schema.sql`
- `supabase/migrations/202610230002_hierarchical_category_icons.sql`
- `supabase/migrations/202610240001_account_icons.sql`
- `supabase/migrations/202610240002_simplify_stock_valuation.sql`
- `supabase/migrations/202610240003_liability_payments_and_stock_plan_cleanup.sql`
- `supabase/migrations/202610240004_forecast_events.sql`
- `supabase/migrations/202610250001_replace_category_catalog_and_expand_limits.sql`

| 資料表 | 用途 |
| --- | --- |
| `accounts` | 現金、銀行、股票帳戶；起始餘額、封存狀態與可為空的 `icon_key`。 |
| `categories` | 兩層收入／支出分類；`parent_id` 為空時是大分類，否則是小分類；`icon_key` 儲存圖示。 |
| `transactions` | 收入、支出及成對轉帳；轉帳以 `transfer_group_id` 連結。 |
| `liabilities` | 貸款或分期負債：本金、年利率、整數元月繳款、期數、起始日。分期使用 0% 利率及自訂月繳款。 |
| `stocks` | 股票帳戶、代號、目前市值基準日期與年化報酬率；不記錄股數或總成本。 |
| `recurring_rules` | 僅供推演的固定收支／轉帳。 |
| `investment_plans` | 僅供推演的每月股票持續投入。 |
| `forecast_events` | 僅供推演的一次性收入或支出；記錄日期、項目、金額及現金／銀行帳戶。 |

所有表均有 UUID `id`、`user_id`、`created_at`、`updated_at`、`deleted_at`。金額使用 `bigint`（TWD 整數元）；所有表均啟用 RLS，政策限定 `auth.uid() = user_id`。

`categories` 只允許大分類與小分類兩層，大小分類必須同一使用者且收支方向相同。收入只允許大分類。資料庫 trigger 限制每位使用者最多 20 個支出大分類、15 個收入大分類，且每個支出大分類最多 20 個有效小分類。預設模板為 12 個支出大分類及文件指定的小分類、7 個收入大分類；只有帳號完全沒有分類記錄時才會建立。202610250001 migration 將既有有效分類軟刪除並建立新模板，並將所有交易及固定收支的 `category_id` 設為空值。

`accounts.icon_key` 可為空，既有帳戶不回填圖標。帳戶圖標使用獨立的 `account-icon-1` 至 `account-icon-13` key；圖片為本機靜態資產，並非使用者上傳資料。

`stocks.valuation_amount` 與 `valuation_date` 必填，代表目前市值基準及其日期。新增股票時以輸入市值和新增日作為基準；編輯時可留空不修正，或輸入一次性修正值並以修正當日作為新基準。估值與推演依年化報酬率計算。202610240002 migration 將既有股票截至套用日的推算市值回填為新基準，再移除 `shares` 與 `total_cost`。

`liabilities.monthly_payment` 必填且為正整數 TWD。貸款年利率與月繳款按本息平均攤還公式互算；既有月繳款由原年利率回填。分期不顯示年利率，固定使用 0%；migration 將既有分期利率設為 0%，月繳款回填為本金除以期數的整數元。刪除股票時，資料庫 trigger 會軟刪除同一使用者對應的有效 `investment_plans`；推演亦只採用仍有效股票的計畫。

`forecast_events` 含 `name`、`kind`（income／expense）、`amount`、`account_id` 與 `event_date`。指定日期落在推演的未來 12 個月且未早於當日時，只計入該月一次；不建立真實交易。每筆資料具 `user_id`、時間欄位、軟刪除與 RLS。
