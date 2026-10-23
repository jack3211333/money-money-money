-- Account icons are optional. Existing accounts retain no selected icon.
alter table public.accounts
  add column icon_key text
  check (icon_key is null or char_length(icon_key) between 1 and 50);
