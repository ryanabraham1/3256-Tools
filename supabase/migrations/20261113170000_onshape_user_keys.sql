-- Onshape API keys per person: syncing designs and exporting STEP files bill
-- against the signed-in person's own Onshape API allowance instead of one
-- shared key. The secret is encrypted by the app before it gets here. Locked
-- down like the other tables: the app uses the service role only.
begin;

create table if not exists public.onshape_keys (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  access_key  text not null check (length(access_key) between 1 and 200),
  secret_enc  text not null,
  updated_at  timestamptz not null default now()
);

alter table public.onshape_keys enable row level security;
revoke all on public.onshape_keys from anon, authenticated;

commit;
