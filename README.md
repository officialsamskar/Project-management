# The Roster — deployment guide

This folder is ready to deploy to Vercel. No secrets are stored in any of
these files, so it's safe to commit to GitHub or share.

## Files
- `package.json` — dependency manifest
- `api/roster.js` — serverless API (reads/writes the database)
- `public/index.html` — the app itself
- `api/tally-webhook.js` — receives Tally form submissions and saves them in the database
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
   | `TALLY_API_KEY` | *(optional)* Tally API key, used once to connect the forms — see **SETUP.md** |
| `TALLY_SIGNING_SECRET` | *(optional)* Private string that Tally signs form submissions with — see **SETUP.md** |
   | `MEMBER_ENROLLMENT_FORM_URL` | *(optional)* share link of the Member Enrollment form, used in invite emails |

   Set them for the **Production** environment (and Preview, if you want
   preview deployments to work too).
4. Redeploy (or trigger a new deployment) so the environment variables take
   effect.

Without `DATABASE_URL` and the two passcodes set, the app will load but every request will
fail with a clear "Server is missing DATABASE_URL or the passcodes" error —
so it's easy to tell if a step was missed.

## How sign-in works

There is no name or role to type. Whoever enters the CEO passcode is the CEO,
and whoever enters the Web Manager passcode is the Web Manager. The server
works this out from the passcode itself, and records that role on everything
they add (leave requests, performance notes, receipts), so it can't be faked
from the browser. After 10 wrong passcodes from one device or network, sign-in
is blocked for 15 minutes. Use longer passcodes (6+ digits) where you can.

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
- **Services** — maintain the service catalog (pre-seeded with Samskar's
  starting services).
- **Projects** now carry client name, service, budget, location, and event
  date.
- **Intake** — five Tally forms (bookings, KYC, member enrollment, existing
  customer, leave application). Each submission is saved straight into your Neon database by
  `api/tally-webhook.js`, and the Intake tab reads it from there, with
  one-click actions to turn a response into a project, a KYC record, or a new
  member. Existing-customer responses are checked against your receipts and KYC
  records and marked verified, partly matched, or not found. See **SETUP.md**.