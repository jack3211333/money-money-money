# 目前進度

## 已完成

- Vite + React + TypeScript 深色手機優先 PWA、可安裝 manifest 與離線 app shell。
- Supabase migration：完整資料表、時間欄位、軟刪除、更新時間 trigger、RLS。
- 資料存取層與 Email 魔法連結登入／登出。
- 帳戶／分類、收支／轉帳、負債／分期、股票、總覽、CSV 匯出、12 個月推演頁。
- 已通過 `npm run build` 正式建置檢查。

## 未完成

- 需由使用者建立 Supabase 專案、套用 migration、設定 `.env`，再做實機驗收與部署。

## 下一步

依 README 完成 Supabase 設定，使用本機資料驗證完整流程，再連接 GitHub 與 Vercel。

## 已知問題

- 尚未建立 Supabase 專案與 `.env`，因此登入與雲端資料尚不可用。
- Git 作者姓名與 Email 已設定；初始提交正在建立中。
