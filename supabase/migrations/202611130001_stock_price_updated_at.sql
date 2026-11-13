-- 股票市值更新時間：手動或排程以收盤價更新市值時寫入，供資產頁顯示。
alter table public.stocks add column if not exists price_updated_at timestamptz;

-- 排程逐檔查詢需要較長時間，pg_net 等待上限由 60 秒放寬為 140 秒（同名覆寫，可重複執行）。
do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url')
    or not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
    raise exception 'Vault secrets project_url and cron_secret must be configured first';
  end if;
  perform cron.schedule('daily-stock-price-update', '0 10 * * 1-5',
    $command$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/stock-price-update',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 140000
    );$command$);
end $$;
