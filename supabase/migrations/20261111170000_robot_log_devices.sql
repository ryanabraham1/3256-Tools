-- Per-device upload tokens for Mayhem desktop. Only a SHA-256 of each token is stored; the
-- token itself is shown once when created. Like robot_logs, only server routes (service role)
-- may read or write this table.
begin;
create table if not exists public.robot_log_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.robot_log_devices enable row level security;
revoke all on public.robot_log_devices from anon, authenticated;
grant select, insert, update on public.robot_log_devices to service_role;

alter table public.robot_logs
  add column if not exists device_id uuid references public.robot_log_devices (id) on delete set null;
commit;
