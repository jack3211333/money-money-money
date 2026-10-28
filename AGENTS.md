# Money Money Money — 專案規範

## 專案狀態

- 正式版本為 **1.01**；功能已完成並驗收，目前沒有進行中或排定的後續功能。
- 專案說明見 `README.md`；完成狀態見 `docs/PROGRESS.md`；決策沿革見 `docs/DECISIONS.md`；資料庫結構見 `docs/SCHEMA.md`。
- 每次開始工作前，閱讀本檔及 `docs/` 下所有文件。修改專案規範或資料庫時，更新對應文件。

## 技術與目錄

- 前端：Vite、React、TypeScript、原生 PWA manifest／service worker。
- 雲端：Supabase Auth（Email＋密碼）、Postgres 與 RLS；部署使用 GitHub 和 Vercel。
- 金額以 TWD 整數元儲存，不使用浮點數。
- `src/` 存放畫面、商業計算與資料存取；`src/data/` 以 Repository 封裝 Supabase；`supabase/migrations/` 是資料庫結構唯一來源。

## 維護規則

1. 一次處理一個範圍清楚的變更，完成後說明驗證方式。
2. 同一功能的程式、migration 與必要文件放在同一個 commit；不另建只補記功能或部署狀態的文件 commit。
3. 金鑰只放本機 `.env` 或部署平台環境變數，不可提交至 Git；`.env` 必須維持忽略狀態。
4. 資料庫變更必須新增 migration，不可只在 Supabase 後台手動修改；每次 migration 後更新 `docs/SCHEMA.md`。
5. 使用者資料須具備 `user_id`、時間欄位、軟刪除欄位並受 RLS 保護。

## Migration 與部署

- Migration 預設只做向後相容的新增：新表、新欄位（nullable 或有預設值）及新索引；需可重複執行並使用 `IF NOT EXISTS`。
- 執行順序固定為「套用 migration → 確認成功 → Git push」。每次 migration 在 `docs/SCHEMA.md` 記錄檔名、套用時間與內容摘要。
- DROP、TRUNCATE、改名、刪欄位、改型別或沒有 `WHERE` 的 UPDATE／DELETE，須先取得使用者同意；同意後先請使用者在 App 匯出 CSV，收到「已備份」才執行。
- Push 後用瀏覽器確認 Vercel 部署為 Ready，並開啟正式網址確認可載入。部署失敗時回滾到上一個成功版本並回報原因。
- 每次完成後以三行以內回報變更、migration 狀態與部署結果。
