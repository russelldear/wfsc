-- Every table in the public schema must have row level security switched on
-- and at least one policy. Catches a future migration that forgets either.

begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(2);

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  '', 'every public table has row level security enabled');

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not exists (select 1 from pg_policies p
                     where p.schemaname = 'public' and p.tablename = c.relname)),
  '', 'every public table has at least one policy');

select * from finish();
rollback;
