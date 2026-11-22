-- Work, as the app reads it: the same rows without the raw Linear export copies.
-- data.source.raw (kept for Export) and the full before/after item copies in events are ~70%
-- of the Work tables, and every page load and refresh used to pull them from Supabase only to
-- drop them (lib/work-snapshot.ts) before the browser saw them. Reading these views instead
-- means Supabase never sends them (egress). Export still reads the tables.
--
-- Same columns as the tables, same compaction as compactWorkItem / compactWorkSnapshot.

create or replace view public.work_items_lite with (security_invoker = true) as
select
  id, number, kind, title,
  case when jsonb_typeof(data->'source') = 'object'
    then jsonb_set(data, '{source}', (data->'source') - 'raw')
    else data
  end as data,
  revision, archived, deleted_at, created_at, updated_at
from public.work_items;

create or replace view public.work_events_lite with (security_invoker = true) as
select
  id, item_id, actor, actor_id, type, body, created_at,
  data
    || case when data ? 'before' then jsonb_build_object('before',
         case when jsonb_typeof(data->'before') = 'object'
           then jsonb_build_object('data', jsonb_strip_nulls(jsonb_build_object('status', data#>'{before,data,status}')))
           else 'null'::jsonb end)
       else '{}'::jsonb end
    || case when data ? 'after' then jsonb_build_object('after',
         case when jsonb_typeof(data->'after') = 'object'
           then jsonb_build_object('data', jsonb_strip_nulls(jsonb_build_object('status', data#>'{after,data,status}')))
           else 'null'::jsonb end)
       else '{}'::jsonb end
    || case when jsonb_typeof(data->'source') = 'object'
         then jsonb_build_object('source', (data->'source') - 'raw')
         else '{}'::jsonb end
  as data
from public.work_events;

-- Server only, like the tables (Supabase grants new public views to anon/authenticated by default).
revoke all on public.work_items_lite, public.work_events_lite from anon, authenticated;
grant select on public.work_items_lite, public.work_events_lite to service_role;
