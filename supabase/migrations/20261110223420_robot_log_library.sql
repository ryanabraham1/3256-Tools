-- Shared team-code authorization is enforced in server routes. Neither the
-- browser anon key nor a regular Supabase user may access this table/bucket.
begin;
create table if not exists public.robot_logs (
  sha256 text primary key check (sha256 ~ '^[a-f0-9]{64}$'),
  name text not null check (length(name) between 1 and 200),
  size bigint not null check (size between 12 and 262144000),
  status text not null default 'pending' check (status in ('pending', 'ready')),
  created_at timestamptz not null default now()
);
alter table public.robot_logs enable row level security;
revoke all on public.robot_logs from anon, authenticated;
grant select, insert, update, delete on public.robot_logs to service_role;
create index if not exists robot_logs_ready_created_idx on public.robot_logs (created_at desc) where status = 'ready';
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('robot-logs', 'robot-logs', false, 262144000, array['application/octet-stream'])
on conflict (id) do nothing;
commit;
