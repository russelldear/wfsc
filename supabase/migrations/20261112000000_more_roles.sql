-- Stage 4: access management. New roles, in their own migration because a
-- new enum value cannot be used in the same transaction that adds it.
--   admin: can grant and remove access.
--   coach: view-only access to skate school classes and progress.
alter type public.app_role add value if not exists 'admin';
alter type public.app_role add value if not exists 'coach';
