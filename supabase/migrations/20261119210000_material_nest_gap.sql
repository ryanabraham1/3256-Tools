-- Space between parts in the cut plan, per stock material (thick plate on the
-- router wants room for tabs). Null = the team default from the Machines page.
alter table fab_materials add column if not exists nest_gap_mm numeric check (nest_gap_mm is null or nest_gap_mm >= 0);
