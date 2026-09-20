# The Roster — deployment guide

This folder is ready to deploy to Vercel. No secrets are stored in any of
these files, so it's safe to commit to GitHub or share.

## Files
- `package.json` — dependency manifest
- `api/roster.js` — serverless API (reads/writes the database)
- `public/index.html` — the app itself
- `SETUP.md` — how to connect the Tally intake forms

## Deploy

1. Push this folder to a GitHub repo (or drag-and-drop deploy on vercel.com).
2. Import it as a new Vercel project.
3. **Before the first real use**, go to the project's
   **Settings → Environment Variables** and add these:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | **Required.** Your Neon Postgres connection string |
   | `ROSTER_PIN_CEO` | **Required.** The CEO's passcode |
   | `ROSTER_PIN_WEB_MANAGER` | **Required.** The Web Manager's passcode |
   | `RESEND_API_KEY` | *(optional)* API key from your Resend account (resend.com), for email notifications |
   | `FROM_EMAIL` | *(optional)* sender address — defaults to Resend's shared test address if unset |
   | `TALLY_API_KEY` | *(optional)* Tally API key, for the Intake tab — see **SETUP.md** |
   | `MEMBER_ENROLLMENT_FORM_URL` | *(optional)* share link of the Member Enrollment form, used in invite emails |

   Set them for the **Production** environment (and Preview, if you want
   preview deployments to work too).
4. Redeploy (or trigger a new deployment) so the environment variables take
   effect.

Without `DATABASE_URL` and the two passcodes set, the app will load but every request will
fail with a clear "Server is missing DATABASE_URL or the passcodes" error —
so it's easy to tell if a step was missed.

## Changing the passcode later

Passcodes are never stored in code — only in the `ROSTER_PIN_CEO` and
`ROSTER_PIN_WEB_MANAGER` environment variables. To reset one, edit that
variable's value in Vercel project **Settings → Environment Variables**, then
redeploy so the change takes effect. No file edits needed. (`ROSTER_PIN`, a
single shared passcode, still works only if neither role-specific variable is
set.)

## Database schema

The database needs these tables: `employees` (displayed as "Members" in the
app — includes `member_code` and `location` columns), `leave_requests`,
`performance_notes`, `projects`, `project_handovers`, `receipts`,
`testimonials`, `kyc_records`, and `services`, plus the sequences
`member_code_seq` and `receipt_code_seq`. If you're pointing
this at a fresh Neon database, ask Claude for the schema SQL again, or reuse
the Neon project already set up for this app. The old `attendance` table/
feature has been removed entirely.

## Email notifications

- Creating a project emails the assigned member automatically.
- Handing a project over emails the new member (without naming the previous
  one), and — if left checked in the handover dialog — also emails the
  previous member that their project moved on (without naming who it went
  to).
- Inviting a member emails them a welcome note with a link to the enrollment
  form (never the portal passcode).
- If `RESEND_API_KEY` isn't set, the app still works — emails are just
  silently skipped.

## New in this version

- **Receipts** — generate a numbered receipt (PDF, downloads automatically)
  and keep a searchable record of every one issued.
- **Testimonials** — log client feedback with an optional rating; the page
  shows a running count and average.
- **Services** — maintain the service catalog (pre-seeded with Samskar's six
  current services).
- **Projects** now carry client name, service, budget, location, and event
  date.
- **Intake** — pulls live responses from four Tally forms (bookings, KYC,
  member enrollment, existing customer) with one-click actions to turn a
  response into a project, a KYC record, or a new member. Existing-customer
  responses are checked against your receipts and KYC records and marked
  verified, partly matched, or not found. The forms are already created; see
  **SETUP.md** — you only need to add a `TALLY_API_KEY` (plus
  `MEMBER_ENROLLMENT_FORM_URL` for invite emails).
