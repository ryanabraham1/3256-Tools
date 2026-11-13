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

-- The team's pit checklist (Unnamed Dumper Pit Checklist 26-27); edit in Pit → Setup.
insert into public.pit_items (phase, section, title, how, critical, sort)
select * from (values
  ('pre_match', 'Essential (unpowered)', 'Bumpers right color', '', true, 10),
  ('pre_match', 'Essential (unpowered)', 'Bumpers cone and nuts all the way in', '', true, 20),
  ('pre_match', 'Essential (unpowered)', 'Battery strapped in & connector ziptied', '', true, 30),
  ('pre_match', 'Essential (unpowered)', 'Robot code deployed', '', true, 40),
  ('pre_match', 'Essential (unpowered)', 'Turning Intake rollers, Indexer, Feeder, Shooter', '', true, 50),
  ('pre_match', 'Essential (unpowered)', 'Indexer, hood, and intake reset', '', true, 60),
  ('pre_match', 'Essential (unpowered)', 'Cameras connected', '', true, 70),
  ('pre_match', 'General', 'Check all 4 swerve modules tread', '', false, 80),
  ('pre_match', 'General', 'Check swerve modules rotate and drive (by hand)', '', false, 90),
  ('pre_match', 'General', 'Check all key swerve bolts tight (fork bolts, ratio swap bolt)', '', false, 100),
  ('pre_match', 'General', 'Ensure bumper mounts intact', '', false, 110),
  ('pre_match', 'General', 'Check for things under robot that might catch on the bump', '', false, 120),
  ('pre_match', 'General', 'Battery backup in cart + sticky note', '', false, 130),
  ('pre_match', 'General', 'Motor temperatures OK (8 drivebase motors, all mechanism motors)', '', false, 140),
  ('pre_match', 'General', 'Ensure Anker is in cart', '', false, 150),
  ('pre_match', 'General', 'Ensure Driver in cart', '', false, 160),
  ('pre_match', 'General', 'Tether ethernet', '', false, 170),
  ('pre_match', 'General', 'Check robot code booted', '', false, 180),
  ('pre_match', 'General', 'Communications and robot code are GREEN', '', false, 190),
  ('pre_match', 'General', 'Connect controllers, joysticks GREEN', '', false, 200),
  ('pre_match', 'General', 'Make sure controllers are correct', '', false, 210),
  ('pre_match', 'General', 'DS laptop is plugged into Anker', '', false, 220),
  ('pre_match', 'General', 'Robot turned off before leaving pit', '', false, 230),
  ('pre_match', 'Electrical', 'Check battery voltage and internal resistance, enter data into form', '', false, 240),
  ('pre_match', 'Electrical', 'Check camera mount + connections', '', false, 250),
  ('pre_match', 'Electrical', 'Check coproc connections + case', '', false, 260),
  ('pre_match', 'Electrical', 'Check both can loops', '', false, 270),
  ('pre_match', 'Electrical', 'Check intake andersons and can wire secure + strain relieved', '', false, 280),
  ('pre_match', 'Electrical', 'Shooter wires and sheathing intact, not contacting rollers', '', false, 290),
  ('pre_match', 'Electrical', 'Check shooter molexs, molex to intake', '', false, 300),
  ('pre_match', 'Electrical', 'Check USB and ethernet hot glued', '', false, 310),
  ('pre_match', 'Electrical', 'Check CANivore USB and power connections', '', false, 320),
  ('pre_match', 'Electrical', 'Tug check key subsystem connections (make sure all connections are strain relieved)', '', false, 330),
  ('pre_match', 'Electrical', 'Check PDH, breaker, SB120 standoffs secure and connections fully covered', '', false, 340),
  ('pre_match', 'Electrical', 'All motors show up in PhoenixTunerX', '', false, 350),
  ('pre_match', 'Electrical', 'Tug check random wires, strain relieve and hot glue as needed (DO NOT tug check after power-off/checking CAN)', '', false, 360),
  ('pre_match', 'Hopper', 'Check deployment is smooth and doesn''t catch', '', false, 370),
  ('pre_match', 'Hopper', 'Check panels are not fully cracked', '', false, 380),
  ('pre_match', 'Hopper', 'Check front panel doesn''t flex enough to leak balls/trap balls', '', false, 390),
  ('pre_match', 'Hopper', 'Check mounting bolts are tight', '', false, 400),
  ('pre_match', 'Hopper', 'Check net is secure', '', false, 410),
  ('pre_match', 'Hopper', 'Shake the hopper on the pins to ensure the hopper doesn’t fall off', '', false, 420),
  ('pre_match', 'Intake', 'ENSURE HARDSTOP HOLES ARE ALIGNED RIGHT BY NUT STRIPS ON WHITE 3DP', '', true, 430),
  ('pre_match', 'Intake', 'ENSURE IGUS IS TO THE SIDE & NOT IN THE WAY OF KICKER BAR', '', true, 440),
  ('pre_match', 'Intake', 'Check 3DP kicker bar guide is properly attached', '', false, 450),
  ('pre_match', 'Intake', 'Check/patch cat tongue; must be flat and well attached', '', false, 460),
  ('pre_match', 'Intake', 'Ensure kicker bar screws are tightened', '', false, 470),
  ('pre_match', 'Intake', 'ENSURE SCREWS FOR MAIN ROLLER ARE TIGHT', '', true, 480),
  ('pre_match', 'Intake', 'Turn all rollers by hand', '', false, 490),
  ('pre_match', 'Intake', 'Ensure belts are on pulleys', '', false, 500),
  ('pre_match', 'Intake', 'Ensure pulleys & flanges are intact', '', false, 510),
  ('pre_match', 'Intake', 'ENSURE MOTORS ARE NOT LOOSE', '', true, 520),
  ('pre_match', 'Intake', 'Clean rollers with IPA, Simple Green', '', false, 530),
  ('pre_match', 'Intake', 'Check if pulleys are cracking', '', false, 540),
  ('pre_match', 'Intake', 'Check if main roller is cracking', '', false, 550),
  ('pre_match', 'Intake', 'Check if bearings are secure', '', false, 560),
  ('pre_match', 'Intake', 'Check that intake polycarb zip ties secure', '', false, 570),
  ('pre_match', 'Shooter', 'Ensure shaft screws are tightened', '', false, 580),
  ('pre_match', 'Shooter', 'Turn main roller by hand, checking that it is not off center', '', false, 590),
  ('pre_match', 'Shooter', 'Test gear by lifting and lowering hood and making sure it stays aligned', '', false, 600),
  ('pre_match', 'Shooter', 'Check that both hood plates are aligned by putting it in lowered position and ensuring they’re the same height', '', false, 610),
  ('pre_match', 'Shooter', 'Check wear on hood rollers', '', false, 620),
  ('pre_match', 'Shooter', 'Ensure belts are on pulleys', '', false, 630),
  ('pre_match', 'Shooter', 'Check wear on belts', '', false, 640),
  ('pre_match', 'Shooter', 'Ensure Motors are secure', '', false, 650),
  ('pre_match', 'Shooter', 'Check hood motor and geartrain did not jump off washer', '', false, 660),
  ('pre_match', 'Shooter', 'Check shooter mounting bolts are tight', '', false, 670),
  ('pre_match', 'Shooter', 'Ensure bearings are in the plate and not backing out', '', false, 680),
  ('pre_match', 'Shooter', 'Check that the mini rollers are taped together', '', false, 690),
  ('pre_match', 'Feeder', 'Check if motors are secure', '', false, 700),
  ('pre_match', 'Feeder', 'Check if rollers are cracked', '', false, 710),
  ('pre_match', 'Feeder', 'Ensure all belts are on pulleys', '', false, 720),
  ('pre_match', 'Feeder', 'Ensure bearings are in the plate and not backing out', '', false, 730),
  ('pre_match', 'Feeder', 'Check if mounting bolts are tight', '', false, 740),
  ('pre_match', 'Feeder', 'Check wear on belts', '', false, 750),
  ('pre_match', 'Feeder', 'Check if bottom roller hubs (connecting to indexer) are breaking / melting', '', false, 760),
  ('pre_match', 'Feeder', 'All pulleys are secured in rollers', '', false, 770),
  ('pre_match', 'Feeder', 'Ensure that all pulleys are functional (not melted or cracked)', '', false, 780),
  ('pre_match', 'Feeder', 'Turn last indexer roller and bottom feeder roller to make sure the connection between indexer and feeder is secure', '', false, 790),
  ('pre_match', 'Feeder', 'Shake main feeder plate to make sure its not wobbling', '', false, 800),
  ('pre_match', 'Indexer', 'LEAN THE INDEXER AGAINST INTAKE/KICKER BAR (has to be before match starts)', '', true, 810),
  ('pre_match', 'Indexer', 'Check pulleys are not broken', '', false, 820),
  ('pre_match', 'Indexer', 'Check pulleys are not melted', '', false, 830),
  ('pre_match', 'Indexer', 'Check belts are on pulleys', '', false, 840),
  ('pre_match', 'Indexer', 'CHECK DEPLOYMENT', '', true, 850),
  ('pre_match', 'Indexer', 'Ensure motors are secure', '', false, 860),
  ('pre_match', 'Indexer', 'Ensure rollers DON’T SPIN INDEPENDENTLY of hubs', '', false, 870),
  ('pre_match', 'Indexer', 'Ensure NO CRACKS in polycarb', '', false, 880),
  ('pre_match', 'Indexer', 'Ensure spacing is proper/ideal', '', false, 890),
  ('pre_match', 'Indexer', 'Clean wheels and rollers', '', false, 900),
  ('pre_match', 'Indexer', 'Ensure hubs are not broken', '', false, 910),
  ('pre_match', 'Powered Systems Check', 'RSL on', '', false, 920),
  ('pre_match', 'Powered Systems Check', 'Swerve CANCoder lights GREEN', '', false, 930),
  ('pre_match', 'Powered Systems Check', 'Radio light solid GREEN', '', false, 940),
  ('pre_match', 'Powered Systems Check', 'RIO light solid GREEN', '', false, 950),
  ('pre_match', 'Powered Systems Check', 'CANivore lights GREEN', '', false, 960),
  ('pre_match', 'Powered Systems Check', 'Rotate robot (cart manually), verify Pigeon is good', '', false, 970),
  ('pre_match', 'Powered Systems Check', 'Ensure operator controller is connected to driver station', '', false, 980),
  ('pre_match', 'Powered Systems Check', 'Test cameras connected, detecting tags', '', false, 990),
  ('pre_match', 'Powered Systems Check', 'Enable Robot', '', false, 1000),
  ('pre_match', 'Powered Systems Check', 'Test swerve rotation and translation on cart (CHECK EVERY WHEEL)', '', false, 1010),
  ('pre_match', 'Powered Systems Check', 'Test intake and hopper deploy', '', false, 1020),
  ('pre_match', 'Powered Systems Check', 'Test rollers, feeder, shooter (all modes), kicker bar deploy, intake & outtake balls', '', false, 1030)
) as v(phase, section, title, how, critical, sort)
where not exists (select 1 from public.pit_items);

commit;
