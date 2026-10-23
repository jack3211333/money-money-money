# Money Money Money

手機優先的個人記帳 PWA，使用 Supabase 雲端同步與 Email＋密碼登入。

## 本機啟動

1. 在此資料夾開啟 PowerShell，執行 `npm install`。
2. 複製 `.env.example`，將副本命名為 `.env`。
3. 依下一節填入 `.env`，不要把它上傳到 Git。
4. 執行 `npm run dev`，再開啟畫面顯示的網址。
5. 正式檢查可執行 `npm run build`。

若要測試帳戶圖標儲存，先在目前 `.env` 指向的 Supabase 專案依序套用尚未執行的 migration，包含 `supabase/migrations/202610240001_account_icons.sql`；現有帳戶會維持未選擇圖標。

## 建立 Supabase（只需一次）

1. 登入 Supabase，按 **New project**，選擇組織、命名並設定資料庫密碼，按 **Create new project**。
2. 專案完成後，到左側 **SQL Editor**，按 **New query**。
3. 依檔名順序開啟 `supabase/migrations/` 下的 SQL，完整複製內容貼進編輯器並按 **Run**。這會建立資料表、RLS 與大小分類，請勿改用後台手建表。
4. 到 **Authentication → URL Configuration**，在 **Site URL** 填本機網址（通常是 `http://localhost:5173`）；部署後再加入 Vercel 網址作為 Redirect URL。
5. 到 **Project Settings → API**，複製 **Project URL** 和 **Publishable key**。將它們只填入本機 `.env`：

```text
VITE_SUPABASE_URL=你的 Project URL
VITE_SUPABASE_PUBLISHABLE_KEY=你的 Publishable key
```

6. 重新執行 `npm run dev`。已登入的舊帳號可在「設定 → 設定登入密碼」設定密碼，再於手機用同一 Email 登入。保留相同帳號，資料才會同步。

密碼登入不會每次寄信；首次註冊與忘記密碼的 Email 流程仍需寄信服務。若目前所有裝置都已登出，可在登入頁點「尚未設定密碼？寄一次登入連結」，待寄信額度恢復後完成一次登入，再設定密碼。

## 驗證清單

1. 在設定新增「現金」、「銀行」與「股票帳戶」；確認帳戶可選擇、更換或清除四款圖標，並確認收入 2 大類、支出 5 大類，大小分類皆可新增、編輯顏色並從 55 個 icon 中選擇。
2. 新增收入、支出與銀行轉現金；確認交易可直接選大分類或小分類、分類 icon 顯示正確，且總覽的帳戶餘額正確。
3. 新增一筆貸款與年利率為 0 的零卡分期，確認負債頁與推演頁顯示剩餘餘額。
4. 新增股票帳戶和股票，填成本、年化報酬率與選填的市值修正；確認總覽淨資產與推演有變化。
5. 新增固定收支與持續投入，確認推演表每月月底顯示資產、現金、股票、負債、淨資產。這些設定不可改變真實交易。
6. 在設定下載 CSV，用 Excel 開啟，確認中文沒有亂碼。

## GitHub 與 Vercel 部署

1. 先在 GitHub 建立空的 private repository，不要勾選 README 或 `.gitignore`。
2. 本機設定一次 Git 作者資料：`git config --global user.name "你的名字"`、`git config --global user.email "你的 Email"`。
3. 依 GitHub 畫面提供的指令加入 remote，推送目前分支。`.env` 不會被推送。
4. 登入 Vercel，按 **Add New → Project**，選取剛建立的 GitHub repository，按 **Import**。
5. 在 Vercel 的 **Environment Variables** 新增與 `.env` 相同的兩個名稱與值；只填 Project URL 和 Publishable key，絕不填 service role key。
6. 按 **Deploy**。完成後回 Supabase 的 **Authentication → URL Configuration**，將 Vercel 網址加到 Redirect URLs，並把它設為 Site URL。
7. 之後每次推送 GitHub，Vercel 都會自動部署。

## 備份

- 日常：設定頁可將交易、帳戶、負債、股票各自匯出為 UTF-8 with BOM CSV，建議每月備份到自己的加密雲端硬碟。
- 完整資料庫：Supabase 專案的 **Database → Backups** 可建立或下載資料庫備份；免費方案可用性依方案而異。重要資料應同時保留 CSV 匯出。

## 安全

每筆資料均綁定登入者 `user_id`，RLS 會阻擋其他帳號存取。Publishable key 可安全放在瀏覽器；`service_role` key 絕不可出現在 `.env` 前端設定、Git 或 Vercel 前端變數。
