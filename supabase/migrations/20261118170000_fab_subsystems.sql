-- The team's subsystem list for the fab tracker (null = the built-in list).
-- Onshape imports add each assembly's name to it.
alter table fab_settings add column if not exists subsystems text[];
