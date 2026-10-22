# 資料表結構

Migrations：

- `supabase/migrations/202610230001_initial_finance_schema.sql`
- `supabase/migrations/202610230002_hierarchical_category_icons.sql`

| 資料表 | 用途 |
| --- | --- |
| `accounts` | 現金、銀行、股票帳戶；起始餘額與封存狀態。 |
| `categories` | 兩層收入／支出分類；`parent_id` 為空時是大分類，否則是小分類；`icon_key` 儲存圖示。 |
| `transactions` | 收入、支出及成對轉帳；轉帳以 `transfer_group_id` 連結。 |
| `liabilities` | 貸款或分期負債：本金、年利率、期數、起始日。 |
| `stocks` | 股票帳戶、代號、股數、總成本、年化報酬率、手動市值修正。 |
| `recurring_rules` | 僅供推演的固定收支／轉帳。 |
| `investment_plans` | 僅供推演的每月股票持續投入。 |

所有表均有 UUID `id`、`user_id`、`created_at`、`updated_at`、`deleted_at`。金額使用 `bigint`（TWD 整數元）；股數使用 `numeric(20,6)`。所有表均啟用 RLS，政策限定 `auth.uid() = user_id`。

`categories` 只允許大分類與小分類兩層，大小分類必須同一使用者且收支方向相同。資料庫 trigger 限制每個有效大分類最多 3 個有效小分類。預設模板為收入 2 大／6 小與支出 5 大／15 小；只有在帳號完全沒有分類記錄時才會建立。
