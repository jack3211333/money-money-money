# Money Money Money — 專案記憶

## 開始前必讀

**每次開始工作前，先讀 `AGENTS.md` 與 `docs/` 下的所有檔案。** 文件是跨對話的唯一專案記憶來源。

## 專案目標

建立可長期使用的個人記帳 PWA。採手機優先、深色介面，可部署在雲端並以 Supabase 跨裝置同步。

## 技術選型

- 前端：Vite、React、TypeScript、原生 PWA manifest/service worker。
- 雲端：Supabase Auth（Email＋密碼）與 Postgres；資料表啟用 RLS。
- 部署：GitHub + Vercel，自動部署。
- 金額：TWD 整數元，不使用浮點數。

## 目錄結構

- `src/`：畫面、商業計算、資料存取層。
- `src/data/`：Repository 介面與 Supabase 實作；UI 不可直接呼叫 Supabase。
- `supabase/migrations/`：唯一的資料庫結構來源。
- `docs/`：進度、決定、資料表說明和路線圖。

## 開發規則

1. 一次完成一個可驗證功能；完成後說明驗證方式。
2. 每個完成的功能，必須將程式、migration 與 `docs/PROGRESS.md` 及必要的 `docs/DECISIONS.md`、`docs/SCHEMA.md` 一起放在同一個清楚的 Git commit；不得把同一功能的程式與進度文件拆成不同 commit，也不得另建文件專用 commit 記錄該功能或部署結果。完成並更新相關文件後再一次提交；部署狀態在該次工作中確認，不為補記狀態另拆版本。
3. 金鑰只可放本機 `.env` 與部署平台環境變數，絕不可放入程式碼或 Git；`.env` 必須被忽略。
4. 所有資料庫變更必須新增 migration SQL，絕不只在 Supabase 後台手改；每次 migration 後同步更新 `docs/SCHEMA.md`。
5. 所有使用者資料均須有 `user_id`、時間欄位與軟刪除欄位，並受 RLS 保護。
