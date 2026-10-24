# 資料表結構

Migrations：

- `supabase/migrations/202610230001_initial_finance_schema.sql`
- `supabase/migrations/202610230002_hierarchical_category_icons.sql`
- `supabase/migrations/202610240001_account_icons.sql`
- `supabase/migrations/202610240002_simplify_stock_valuation.sql`

| 資料表 | 用途 |
| --- | --- |
| `accounts` | 現金、銀行、股票帳戶；起始餘額、封存狀態與可為空的 `icon_key`。 |
| `categories` | 兩層收入／支出分類；`parent_id` 為空時是大分類，否則是小分類；`icon_key` 儲存圖示。 |
| `transactions` | 收入、支出及成對轉帳；轉帳以 `transfer_group_id` 連結。 |
| `liabilities` | 貸款或分期負債：本金、年利率、期數、起始日。 |
| `stocks` | 股票帳戶、代號、目前市值基準日期與年化報酬率；不記錄股數或總成本。 |
| `recurring_rules` | 僅供推演的固定收支／轉帳。 |
| `investment_plans` | 僅供推演的每月股票持續投入。 |

所有表均有 UUID `id`、`user_id`、`created_at`、`updated_at`、`deleted_at`。金額使用 `bigint`（TWD 整數元）；所有表均啟用 RLS，政策限定 `auth.uid() = user_id`。

`categories` 只允許大分類與小分類兩層，大小分類必須同一使用者且收支方向相同。資料庫 trigger 限制每個有效大分類最多 3 個有效小分類。預設模板為收入 2 大／6 小與支出 5 大／15 小；只有在帳號完全沒有分類記錄時才會建立。

`accounts.icon_key` 可為空，既有帳戶不回填圖標。帳戶圖標使用獨立的 `account-icon-1` 至 `account-icon-4` key；圖片為本機靜態資產，並非使用者上傳資料。

`stocks.valuation_amount` 與 `valuation_date` 必填，代表目前市值基準及其日期。新增股票時以輸入市值和新增日作為基準；編輯時可留空不修正，或輸入一次性修正值並以修正當日作為新基準。估值與推演依年化報酬率計算。202610240002 migration 將既有股票截至套用日的推算市值回填為新基準，再移除 `shares` 與 `total_cost`。
