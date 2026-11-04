create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  last_success_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  deleted_at timestamptz
);

create unique index if not exists push_subscriptions_active_endpoint_uidx
  on public.push_subscriptions (endpoint) where deleted_at is null;
create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id) where deleted_at is null;
alter table public.push_subscriptions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'owner manages push subscriptions') then
    create policy "owner manages push subscriptions" on public.push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'push_subscriptions_updated_at' and tgrelid = 'public.push_subscriptions'::regclass) then
    create trigger push_subscriptions_updated_at before update on public.push_subscriptions for each row execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'project_url')
    or not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
    raise exception 'Vault secrets project_url and cron_secret must be configured first';
  end if;
  perform cron.schedule('daily-budget-morning', '0 22 * * *',
    $command$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/daily-budget-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body := '{"kind":"morning"}'::jsonb
    );$command$);
  perform cron.schedule('daily-budget-evening', '0 15 * * *',
    $command$select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/daily-budget-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body := '{"kind":"evening"}'::jsonb
    );$command$);
end $$;
