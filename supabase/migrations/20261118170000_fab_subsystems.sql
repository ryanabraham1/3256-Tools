-- The team's subsystem list for the fab tracker (null = the built-in list).
-- Onshape imports add each assembly's name to it.
alter table fab_settings add column if not exists subsystems text[];

-- Backfill: parts imported from an assembly before this change, with no subsystem yet,
-- go under the assembly's name ("Document · Assembly" -> "Assembly").
update fab_parts p
set subsystem = trim(regexp_replace(regexp_replace(d.name, '^.* · ', ''), '^\d+\.\s*', ''))
from fab_designs d
where p.design_id = d.id
  and d.element_type = 'assembly'
  and coalesce(trim(p.subsystem), '') = '';

-- ...and those names join the subsystem list.
update fab_settings s
set subsystems = coalesce(s.subsystems, array['Drivebase','Turret','Shooter','Indexer','Intake','Climb','La Tolva (Hopper)','Driverstation','Other'])
  || coalesce((
    select array_agg(distinct n) from (
      select trim(regexp_replace(regexp_replace(d.name, '^.* · ', ''), '^\d+\.\s*', '')) as n
      from fab_designs d where d.element_type = 'assembly'
    ) x
    where n <> '' and lower(n) <> all (
      select lower(v) from unnest(coalesce(s.subsystems, array['Drivebase','Turret','Shooter','Indexer','Intake','Climb','La Tolva (Hopper)','Driverstation','Other'])) v
    )
  ), '{}')
where s.id = 1;
