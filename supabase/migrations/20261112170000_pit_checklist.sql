-- Pit checklist: the checks the pit crew runs (start of day, pre-match, post-match,
-- end of day), a record of every run — what was checked, what turned up a problem,
-- what was missed — and every problem at a competition, on the checklist or not,
-- for the post-competition review. Locked down like the other tables: the app
-- uses the service role only.
begin;

create table if not exists public.pit_events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 120),
  starts_on   date,
  ends_on     date,
  -- the competition new runs and problems attach to (at most one)
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index if not exists pit_events_one_active on public.pit_events (active) where active;

create table if not exists public.pit_items (
  id          uuid primary key default gen_random_uuid(),
  phase       text not null check (phase in ('morning', 'pre_match', 'post_match', 'end_of_day')),
  section     text not null default '',           -- 'Electrical', 'Drivetrain', …
  title       text not null check (length(title) between 1 and 200),
  how         text not null default '',           -- what "checked" means
  critical    boolean not null default false,     -- most important: shown first, flagged in review
  sort        int not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.pit_runs (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid references public.pit_events (id) on delete set null,
  phase         text not null check (phase in ('morning', 'pre_match', 'post_match', 'end_of_day')),
  label         text not null default '',         -- 'Q12', 'Saturday', …
  started_by    text not null default '',
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  completed_by  text not null default ''
);
create index if not exists pit_runs_started_idx on public.pit_runs (started_at desc);

-- One row per item per run. Finishing a run writes 'missed' for every item nobody checked.
create table if not exists public.pit_checks (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.pit_runs (id) on delete cascade,
  item_id     uuid not null references public.pit_items (id) on delete cascade,
  status      text not null check (status in ('ok', 'issue', 'missed', 'na')),
  note        text not null default '',
  checked_by  text not null default '',
  checked_at  timestamptz not null default now(),
  unique (run_id, item_id)
);
create index if not exists pit_checks_item_idx on public.pit_checks (item_id);

create table if not exists public.pit_problems (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid references public.pit_events (id) on delete set null,
  -- the check it relates to; null = something the checklist doesn't cover
  item_id      uuid references public.pit_items (id) on delete set null,
  run_id       uuid references public.pit_runs (id) on delete set null,
  title        text not null check (length(title) between 1 and 200),
  details      text not null default '',
  area         text not null default '',          -- subsystem / area
  match_label  text not null default '',
  severity     text not null default 'minor' check (severity in ('minor', 'major', 'critical')),
  status       text not null default 'open' check (status in ('open', 'fixed', 'wont_fix')),
  fix          text not null default '',          -- what was done at the event
  follow_up    text not null default '',          -- what to change before next time
  reported_by  text not null default '',
  occurred_at  timestamptz not null default now(),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists pit_problems_occurred_idx on public.pit_problems (occurred_at desc);

alter table public.pit_events   enable row level security;
alter table public.pit_items    enable row level security;
alter table public.pit_runs     enable row level security;
alter table public.pit_checks   enable row level security;
alter table public.pit_problems enable row level security;
revoke all on public.pit_events, public.pit_items, public.pit_runs, public.pit_checks, public.pit_problems from anon, authenticated;
grant select, insert, update, delete on public.pit_events, public.pit_items, public.pit_runs, public.pit_checks, public.pit_problems to service_role;

-- Same "changed" ping on the board topic so every phone in the pit stays in sync.
create trigger pit_events_changed after insert or update or delete on public.pit_events
  for each statement execute function notify_board_changed();
create trigger pit_items_changed after insert or update or delete on public.pit_items
  for each statement execute function notify_board_changed();
create trigger pit_runs_changed after insert or update or delete on public.pit_runs
  for each statement execute function notify_board_changed();
create trigger pit_checks_changed after insert or update or delete on public.pit_checks
  for each statement execute function notify_board_changed();
create trigger pit_problems_changed after insert or update or delete on public.pit_problems
  for each statement execute function notify_board_changed();

-- A starter checklist to edit in Pit → Setup.
insert into public.pit_items (phase, section, title, how, critical, sort)
select * from (values
  ('morning',    'Electrical', 'Batteries on chargers',            'Every match battery charging or charged.', false, 10),
  ('morning',    'Software',   'Code deployed is the code we want', 'Check the branch/commit on the driver station.', true, 20),
  ('morning',    'Mechanical', 'Bolt check, full robot',           'Torque-check every bolt you can reach; mark with paint pen.', false, 30),
  ('pre_match',  'Electrical', 'Fresh battery in and strapped',    'Battery from the board''s "grab next"; strap tight, leads not pinched.', true, 10),
  ('pre_match',  'Electrical', 'Main breaker on, all breakers seated', '', true, 20),
  ('pre_match',  'Electrical', 'Radio powered and ethernet secure', 'Tug-test the ethernet and barrel jack.', true, 30),
  ('pre_match',  'Mechanical', 'Bumpers on, right colour',          'Alliance colour from the match schedule; latches closed.', true, 40),
  ('pre_match',  'Mechanical', 'Nothing loose',                     'Shake test: chains, belts, wires, mechanisms.', false, 50),
  ('pre_match',  'Software',   'Auto selected',                     'Confirm the auto with the drive coach.', true, 60),
  ('post_match', 'Electrical', 'Battery off robot onto charger',    'Log it on the battery board.', false, 10),
  ('post_match', 'Mechanical', 'Walk-around for damage',            'Bent parts, cracked plates, loose bolts, frayed wires.', false, 20),
  ('post_match', 'Software',   'Pull logs / note anything weird',   '', false, 30),
  ('end_of_day', 'Electrical', 'All batteries charging',            '', false, 10),
  ('end_of_day', 'Mechanical', 'Repairs for tomorrow written down', 'Log open problems here before leaving.', false, 20)
) as v(phase, section, title, how, critical, sort)
where not exists (select 1 from public.pit_items);

commit;
