# WFSC Members

Membership database for the club. Committee members sign in with Google to
add, view, edit and renew members, and export them to CSV in the same columns
as the old Google Sheet.

**This repository is public. Never commit real member data**, including in
test files, seed data, screenshots or issues.

## How it fits together

```
Browser (React, static files on GitHub Pages)
   │  Supabase JS client, signed in with Google
   ▼
Supabase (Postgres + Auth)
   └─ row level security decides what each signed-in user can do
```

- There is no application server. The browser talks to Supabase directly.
  The Supabase URL and anon/publishable key in the built site are public by
  design. **Security comes from the row level security policies** in
  `supabase/migrations`, and `supabase/tests` checks them.
- Signing in grants nothing. A user sees data only after an administrator
  gives them the `committee` role (see "First administrator" below).
- Every change to people, contacts and memberships is written to `audit_log`
  by database triggers, with who made it.

### Data model

| Table | Purpose |
|---|---|
| `person` | One row per human. Members (and, later, skaters) are people. |
| `contact` | Parents, guardians and emergency contacts for a person. |
| `person_ethnicity` | Zero or more Stats NZ ethnic groups per person. |
| `person_other_club` | Other clubs a person belongs to. |
| `membership` | One paid membership for one season (1 Oct to 30 Sep), individual or family. |
| `membership_member` | Who a membership covers, with their member type and card-issued date. A person has at most one membership per season. |
| `member_type` | Club-managed list of member types. |
| `user_role` | Who can use the app. |
| `audit_log` | Change history. |

Membership status is not stored: a person is current if their latest
membership's expiry date (30 September) has not passed. **Renew** creates
the next season's membership for the same people.

## Environments

| | Site | Database |
|---|---|---|
| Production | https://guid.nz/wfsc/ | Supabase project `wfsc` |
| Staging | https://guid.nz/wfsc/staging/ | Supabase project `wfsc-staging`, made-up data only |

## Releasing

1. Merge to `main`. The **Deploy** workflow runs the tests, applies
   migrations and seed data to staging, and publishes the staging site.
2. Check the staging site.
3. Run **Deploy** manually (Actions → Deploy → Run workflow) with
   **Release this commit to production** ticked, then approve the
   `production` job. It applies migrations to production and moves the
   `production` branch to that commit; the production site is rebuilt from
   that branch.

## Local development

Requires Node 22.22 or later.

```bash
npm install
cp .env.example .env.local   # then fill in a Supabase project's URL and anon key
npm run dev
```

Checks (all run in CI):

```bash
npm run lint
npm run typecheck
npm test                     # unit tests
npx supabase start           # needs Docker; applies migrations and seed
npx supabase test db         # database security tests
```

Without Docker, the database tests can run against a plain Postgres 16+ with
pgTAP installed: `PGHOST=... PGUSER=postgres npm run test:db:plain`.

### Changing the database

Add a new file to `supabase/migrations/` (never edit one that has been
deployed). The first migration revokes default access, so **each new table
needs explicit grants and row level security policies**, and a test in
`supabase/tests/`. Update `src/lib/types.ts` to match.

## One-time setup

### GitHub repository

- Settings → Pages → Source: **GitHub Actions**.
- Settings → Environments:
  - `staging`: deployment branches limited to `main`. Secrets:
    `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` (staging's).
  - `production`: deployment branches limited to `main`, required reviewer:
    you. Secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`
    (production's).
- Settings → Secrets and variables → Actions → **Variables** (not secret):
  `STAGING_PROJECT_REF`, `STAGING_SUPABASE_ANON_KEY`,
  `PRODUCTION_PROJECT_REF`, `PRODUCTION_SUPABASE_ANON_KEY`.

`SUPABASE_ACCESS_TOKEN` comes from the Supabase dashboard (account → access
tokens). If scoped tokens are offered, limit it to database write access for
these two projects.

### Google sign-in

1. In Google Cloud, create an OAuth client of type **Web application** with
   these authorised redirect URIs:
   - `https://<staging-ref>.supabase.co/auth/v1/callback`
   - `https://<production-ref>.supabase.co/auth/v1/callback`
2. Set the OAuth consent screen to External and publish it. The app only
   asks for basic profile and email.
3. In each Supabase project: Authentication → Providers → Google: enable,
   and paste the client ID and secret.
4. In each Supabase project: Authentication → URL configuration:
   - Production: Site URL `https://guid.nz/wfsc/`
   - Staging: Site URL `https://guid.nz/wfsc/staging/`, and add
     `http://localhost:5173/` to the redirect URLs for local development.

### First administrator

Sign in once on the site, then in that project's Supabase SQL editor run:

```sql
insert into public.user_role (user_id, role)
select id, 'committee' from auth.users where email = 'your.address@example.com';
```

### After importing existing members

So new membership numbers continue after the highest imported one:

```sql
select setval('public.membership_number_seq',
              (select max(membership_number) from public.person));
```

## Privacy notes

- Gender and ethnicity are optional, offer "Prefer not to say", and are
  collected for NZIFSA and Sport NZ reporting.
- The CSV export contains personal information. Store and share it carefully.
- `audit_log` keeps copies of changed rows. People cannot be deleted in this
  stage; when deletion is added, it must also remove their audit entries.
