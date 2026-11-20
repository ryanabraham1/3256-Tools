-- Machining tracker: CAD / CAM review stages and deburring, plus how many of an
-- in-progress part are done (the progress slider).
alter table fab_parts drop constraint if exists fab_parts_status_check;
alter table fab_parts add constraint fab_parts_status_check check (status in
  ('not_started', 'cad_done', 'cad_revise', 'have_cam', 'cam_revise', 'in_progress', 'needs_deburring',
   'outsourced', 'spares_needed', 'spares_finished', 'finished', 'not_needed'));

alter table fab_parts add column if not exists done_qty int not null default 0 check (done_qty >= 0);
