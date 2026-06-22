# Deployment & Course-Day Runbook / デプロイ・当日運用チェックリスト

WFITN Neurovascular Anatomy Course — Zurich. Print this page and keep it at the podium.
このページを印刷して当日の手元に置いてください。

---

## A. Railway deployment (one-time setup) / 初回デプロイ

- [ ] **1. Create the project.** Railway → **New Project → Deploy from GitHub repo** → select
  `Michihiro1966/WFITN-exam-4`, branch `main`.
  Railway プロジェクトを作成し、このリポジトリの `main` ブランチを選択。
- [ ] **2. Add PostgreSQL.** In the project: **+ New → Database → Add PostgreSQL**.
  プロジェクト内に PostgreSQL を追加。
- [ ] **3. Set variables** on the web service (**Variables** tab):

  ```text
  DATABASE_URL=${{Postgres.DATABASE_URL}}
  ADMIN_PASSWORD=<a strong admin password>
  COURSE_NAME=WFITN Neurovascular Anatomy Course Zurich 2026
  EXAM_DURATION_MINUTES=40
  AVATAR_URL=https://avatars.githubusercontent.com/u/269770510?v=4
  ```

- [ ] **4. Generate a public domain.** Service → **Settings → Networking → Generate Domain**.
  公開ドメインを発行。
- [ ] **5. Set the base URL** to the generated domain, then redeploy:

  ```text
  APP_BASE_URL=https://<your-railway-domain>
  ```

- [ ] **6. (Optional) Feedback emails.** Only if you want to *also* email each participant their
  missed questions. **On Railway, use SendGrid — Railway blocks outbound SMTP.** Create a free
  SendGrid account, verify a **Single Sender** (your from address), make an API key, then set
  `SENDGRID_API_KEY` and `SENDGRID_FROM`. (SMTP is supported too but does not work on Railway.)
  メール送信を使う場合：Railway は SMTP をブロックするため **SendGrid** を使用（`SENDGRID_API_KEY` / `SENDGRID_FROM`）。
- [ ] **7. Health check.** Open `https://<domain>/health` → expect `{"ok":true,...}`.

> Database SSL: `${{Postgres.DATABASE_URL}}` uses Railway's private network (no SSL needed). Only if
> you ever switch to a public database URL, add `PGSSLMODE=require`.

---

## B. Pre-course rehearsal (do this a day before) / 事前リハーサル（前日推奨）

- [ ] Open `/admin`, log in with `ADMIN_PASSWORD`, confirm the **QR code** displays and prints.
- [ ] On a phone, scan the QR → register a dummy participant.
- [ ] Confirm the **consent screen** (AI-use warning) appears and the timer starts only after agreeing.
- [ ] Answer a few questions, **Submit**, and confirm the result page shows **score, rank, 偏差値**.
- [ ] Confirm the missed-question review is **hidden** at this point.
- [ ] In `/admin`, press **Publish answers** → confirm the dummy's open result page reveals the review
  (auto-updates within ~15 s) and shows correct answers + explanations.
- [ ] Press **Show aggregated results** → confirm **ranking by score** and **hardest 10 questions**.
- [ ] **Download Excel** → confirm 4 sheets (Scores, Question Stats, Option Rates, Responses).
- [ ] Press **Hide answers** again to reset before the real exam.
- [ ] **Delete dummy data** (see section E) so the cohort statistics start clean.

---

## C. Course day — running the exam / 当日の進行

- [ ] Open `/admin` on the presenter laptop and log in.
- [ ] Make sure **answers are HIDDEN** (status line shows 🔒). Keep them hidden until everyone finishes.
  解説は「非公開（🔒）」のまま開始。全員終了まで公開しない。
- [ ] Project the **QR code** (admin page) on the main screen.
- [ ] Participants scan → register (Given/Family name, gender, institute, years, subspeciality, email)
  → **agree to the AI-use rules** → the 40-minute timer starts per participant.
- [ ] Watch **Registered / Submitted** counts on the admin **Refresh** button as people progress.
- [ ] The exam auto-submits at 40 minutes; participants can also submit early.

---

## D. After the exam — results & awards / 試験後の集計と表彰

- [ ] When everyone has submitted, press **Refresh** in `/admin`.
- [ ] Press **Show aggregated results** → read out the **Top 5** for the awards.
  「成績上位5名」を表彰。
- [ ] Review the **hardest 10 questions** (lowest correct rate) for the debrief discussion.
- [ ] **Download Excel** and save it to a secure institutional location.
- [ ] Press **Publish answers** → every participant's result page now reveals their missed questions
  with correct answers and explanations (open pages update automatically within ~15 s; otherwise reload).
  「Publish answers（公開）」を押すと、全受験者の結果画面に誤答解説が表示される。
- [ ] (Optional) If SMTP is configured, press **Send missed-question feedback emails**.

---

## E. Operational notes / 運用メモ

- **Scoring rule:** a question is correct only when the selected set exactly matches the answer key
  (e.g. if the answer is `b, c`, then `b` alone or `b, c, d` is wrong).
- **Privacy:** never show the `/admin` URL or `ADMIN_PASSWORD` to participants.
- **One device per participant:** the exam token is per-registration; reloading resumes the same timer
  and cannot extend the 40 minutes.
- **Reset the database for a fresh run** (e.g. after rehearsal): in Railway → Postgres → **Data** /
  query, run:

  ```sql
  TRUNCATE responses, participants RESTART IDENTITY CASCADE;
  DELETE FROM settings WHERE key = 'answers_revealed';
  ```

  This clears all registrations, responses, and resets answers to hidden. Question content is in code,
  not in the database, so it is unaffected.
- **Capacity:** ~50–60 concurrent smartphones over WiFi/cellular is well within a single Railway
  service; no special scaling needed.

---

## F. Quick troubleshooting / トラブルシューティング

| Symptom | Cause / Fix |
|---|---|
| App won't start, logs show `DATABASE_URL is not set` | Set `DATABASE_URL=${{Postgres.DATABASE_URL}}` and redeploy. |
| Health check fails / 502 | Confirm the PostgreSQL service is running and `DATABASE_URL` is set; check deploy logs. |
| TLS/SSL connection error to Postgres | You are using a public DB URL — add `PGSSLMODE=require`. |
| QR code points to the wrong URL | Set `APP_BASE_URL` to the generated public domain and redeploy. |
| Feedback-email button is disabled | Email is not configured — set `SENDGRID_API_KEY` (recommended) or the `SMTP_*` variables. |
| Email error "Could not connect / Connection timeout" | Railway blocks outbound SMTP. Switch to SendGrid: set `SENDGRID_API_KEY` + `SENDGRID_FROM` (verified Single Sender) and redeploy. |
| Participants see answers too early | Make sure the admin status shows 🔒 **hidden**; only press **Publish answers** after everyone submits. |
