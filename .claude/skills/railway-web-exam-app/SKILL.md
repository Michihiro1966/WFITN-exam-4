---
name: railway-web-exam-app
description: >-
  Build and deploy a smartphone-friendly web exam/quiz app — QR registration,
  timed multiple-choice (select 1 or 2), exact-match scoring, instant
  rank/偏差値, an admin dashboard (ranking, hardest questions, Excel export),
  gated answer review, and emailed per-participant feedback — using Node/Express
  + PostgreSQL on Railway. Use this when creating an online timed exam, quiz, or
  survey for an event/course, OR when deploying a Node+Postgres app to Railway
  and hitting deploy/healthcheck/SMTP problems. Captures the working patterns and
  the Railway gotchas (DATABASE_URL, manual deploy, SMTP blocked → SendGrid).
---

# Railway web exam/quiz app — build & deploy playbook

A field-tested recipe for a ~50-participant, smartphone-based timed exam. Born from
the WFITN Neurovascular Anatomy Course (Zurich 2026) app. Use the patterns and,
especially, the **Railway gotchas** — most of the pain was deployment, not code.

## When to use
- Building an online **timed MCQ exam / quiz / survey** people take on their phones.
- Need: QR entry, registration, a countdown, server-side scoring, live ranking,
  an admin view, Excel export, and/or emailed feedback.
- Deploying a **Node + PostgreSQL** app to **Railway** (or debugging one that won't
  go live / can't send email).

## Architecture (keep it boring and robust)
- **Backend:** Node + Express. **DB:** PostgreSQL (`pg`). **Frontend:** plain static
  HTML/JS served from `public/` (no build step). Excel via `exceljs`, QR via `qrcode`.
- **Layout must match `package.json`**: if `"start": "node src/server.js"`, the file
  must be at `src/server.js`. A flat upload that doesn't match the start path is the
  #1 cause of `Cannot find module '/app/src/server.js'` on deploy.
- Server listens on `process.env.PORT`. Expose `GET /health` returning
  `{ ok: true, ... }` and point Railway's healthcheck at it.
- Tables created on startup with `CREATE TABLE IF NOT EXISTS`. Keep a tiny
  key/value `settings` table for runtime flags (e.g. "answers published").

## Core product patterns
- **Question bank from Markdown.** Author questions in Markdown, generate
  `data/questions.json` with a small parser (`build_questions.js`), and validate
  (40 Qs, 5 options, 1–2 correct, every Q has an explanation). Cross-check parsed
  answers against the Markdown answer-key table.
- **Exact-match scoring.** A question is correct only when the selected set
  **exactly equals** the answer key (normalize to a sorted unique array). Tell the
  client `selectCount` (1 or 2) and enforce the max both client- and server-side.
- **Never leak the key.** The questions endpoint returns options but **strips
  `correct`**. Answers/explanations are only ever sent on the result endpoint.
- **Consent / anti-AI gate before the timer.** Show a rules screen ("don't use AI;
  you only have N minutes") with an "I agree" checkbox. Start the timer **on
  consent** (`POST /api/start` sets `started_at`), not at registration. Reloading
  resumes the same `started_at` so refreshing can't extend the time. Make
  `started_at` nullable.
- **Server-anchored countdown.** Client computes remaining time from the server
  `started_at + durationSeconds`; auto-submit at zero. Drive the duration from one
  env var (`EXAM_DURATION_MINUTES`) and render it dynamically in the UI (fetch from
  `/health` and `/api/me`) so the displayed minutes always match.
- **Per-participant token** (UUID) in the result URL; no password login for takers.
- **Instant result:** score, **rank** (`1 + count(score > mine)`), cohort mean/SD,
  **偏差値** = `50 + 10*(score-mean)/sd`.
- **Gated answer review (exam integrity).** Missed-question answers + explanations
  are withheld until an admin presses **Publish** (a persisted global flag in
  `settings`). Result pages **poll every ~15 s** and reveal automatically. This
  prevents early finishers from leaking the key to people still taking the exam.
- **Admin dashboard:** summary, **Top 5**, on-demand **ranking by score** and
  **hardest-N (lowest correct-rate) questions**, per-question/option stats, and an
  **Excel export** (scores, question stats, option rates, raw responses).
- **DB reset between runs:**
  ```sql
  TRUNCATE responses, participants RESTART IDENTITY CASCADE;
  DELETE FROM settings WHERE key = 'answers_revealed';
  ```

## Railway deployment — the gotchas that actually cost time
1. **App exits without `DATABASE_URL` → healthcheck fails → "Deployment failed
   during the network process / Healthcheck failure".** Add a **PostgreSQL** service
   in the **same project** and set `DATABASE_URL=${{Postgres.DATABASE_URL}}` (use the
   **Add Reference** picker). Railway's own diagnosis will literally say `DATABASE_URL`.
2. **A stale `railway up` (CLI) deploy can keep serving old code.** If `/health`
   returns `Cannot GET /health` or the UI looks old, the active deploy is an old
   commit. Connect the service **Source** to the GitHub repo + `main` and deploy the
   latest commit. ("Redeploy" re-runs the *same* old commit — not what you want.)
3. **"Auto deploy unavailable."** The repo is connected but pushes don't trigger
   deploys (GitHub App lacks access). Either authorize the Railway GitHub App for the
   repo, or just use the **manual Deploy** button after each change.
4. **Variable changes need a Deploy** ("Apply N changes" → purple **Deploy**). And the
   **admin page caches** whether email is configured — after changing env vars, do a
   **hard reload** of `/admin` or the "Send emails" button stays disabled and a click
   does nothing.
5. **Don't set `PORT` to something Railway doesn't route to.** Reading
   `process.env.PORT` is enough; a manual `PORT` is fine only if it matches.
6. **⚠️ Railway BLOCKS outbound SMTP (ports 25/465/587).** Gmail SMTP times out with
   "Connection timeout" no matter how correct the credentials are — **and trying port
   465 doesn't help.** Do **not** burn time on SMTP. Use an **HTTPS email API** instead.

## Sending email on Railway → use SendGrid (HTTPS), not SMTP
- SMTP is blocked; **SendGrid's HTTPS API (port 443) works.** Implement it with Node's
  built-in `https` module (no new dependency): POST to
  `https://api.sendgrid.com/v3/mail/send` with `Authorization: Bearer <key>` and a
  `personalizations/from/subject/content` body; 2xx = accepted. Add a ~20 s timeout.
- Make the transport configurable: prefer SendGrid when `SENDGRID_API_KEY` is set,
  else fall back to SMTP. Enable the admin button when **either** is configured.
- **Sending to arbitrary recipients without owning a domain:** use SendGrid **Single
  Sender Verification** (verify one from-address, e.g. the course Gmail), then send to
  anyone. `SENDGRID_FROM`'s email **must equal** the verified sender or you get `403`.
  (Note: Resend's free tier needs a *verified domain* to email external recipients —
  worse for this case. SendGrid single-sender or Brevo are easier.)
- **Make bulk send robust:** loop recipients, send one at a time, mark
  `feedback_sent_at` only on success so re-running retries just the failures, and
  return `{ sent, total, failures }`. For SMTP fallback, reuse one **pooled**
  transporter with **timeouts** and `verify()` up front — never reconnect per email
  (that hangs the request on "Sending emails…").

## Gmail specifics (if SMTP is ever usable)
- Gmail rejects the normal account password. Enable **2-Step Verification**, create a
  **16-character App Password** (`myaccount.google.com/apppasswords`), and use it **with
  spaces removed**. (Still blocked on Railway — only relevant off-Railway.)

## Env vars checklist
| Var | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Postgres | `${{Postgres.DATABASE_URL}}` via Add Reference |
| `ADMIN_PASSWORD` | Admin login | strong; never shown to participants |
| `APP_BASE_URL` | QR / email links | the public Railway domain |
| `EXAM_DURATION_MINUTES` | Timer | UI reads it dynamically |
| `COURSE_NAME`, `AVATAR_URL` | Branding | optional |
| `SENDGRID_API_KEY`, `SENDGRID_FROM` | Email (recommended) | from = verified Single Sender |
| `SMTP_*` | Email (off-Railway only) | blocked on Railway |
| `PGSSLMODE` | DB SSL | `require` only for a public DB URL |

## Operational runbook (course day)
1. Keep answers **Hidden (🔒)**. Project the **QR** from `/admin`.
2. Participants scan → register → **agree to rules** → timer starts; auto-submit at the limit.
3. After everyone submits: **Show aggregated results** (ranking + hardest-N), award **Top 5**,
   **Download Excel**.
4. Press **Publish answers** → result pages reveal the review automatically (~15 s).
5. Optionally **Send feedback emails** (SendGrid). Reset the DB before the next run.
6. After the event, revoke any exposed Gmail App Password / SendGrid API key.

## Pre-flight checks
- `/health` returns `{ ok: true, durationMinutes: <N> }`.
- Questions endpoint has **no** `correct` field.
- Rehearse with dummies end-to-end, then **reset the DB** so stats start clean.
- Confirm the admin status shows **🔒 Hidden** before the real exam.
