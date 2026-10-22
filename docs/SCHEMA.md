# 資料表結構

Migration：`supabase/migrations/202610230001_initial_finance_schema.sql`。

| 資料表 | 用途 |
| --- | --- |
| `accounts` | 現金、銀行、股票帳戶；起始餘額與封存狀態。 |
| `categories` | 自訂收入／支出分類。 |
| `transactions` | 收入、支出及成對轉帳；轉帳以 `transfer_group_id` 連結。 |
| `liabilities` | 貸款或分期負債：本金、年利率、期數、起始日。 |
| `stocks` | 股票帳戶、代號、股數、總成本、年化報酬率、手動市值修正。 |
| `recurring_rules` | 僅供推演的固定收支／轉帳。 |
| `investment_plans` | 僅供推演的每月股票持續投入。 |

所有表均有 UUID `id`、`user_id`、`created_at`、`updated_at`、`deleted_at`。金額使用 `bigint`（TWD 整數元）；股數使用 `numeric(20,6)`。所有表均啟用 RLS，政策限定 `auth.uid() = user_id`。
