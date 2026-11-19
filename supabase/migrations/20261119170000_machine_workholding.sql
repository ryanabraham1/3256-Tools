-- Edge each sheet machine keeps clear on a sheet: clamps / screws on the router,
-- nothing on a laser. The cut plan keeps parts out of it (on top of the global margin).
alter table fab_machines add column if not exists workhold_mm numeric check (workhold_mm is null or workhold_mm >= 0);
