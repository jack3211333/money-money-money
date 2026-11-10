-- 每個交易日台灣時間 18:00（UTC 10:00，週一至週五）呼叫 stock-price-update，
-- 以 TWSE／TPEx 收盤價更新已填股數的股票市值。cron.schedule 以同名覆寫，可重複執行。
create extension if not exists pg_cron;
create extension if not exists pg_net;

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
      timeout_milliseconds := 60000
    );$command$);
end $$;
