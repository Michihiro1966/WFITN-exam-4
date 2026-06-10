# WFITN Anatomy Quiz App

A lightweight Railway-ready web app for the WFITN Neurovascular Anatomy Course final quiz.

## Features

- QR-code entry page for smartphone participants
- Participant registration: Given Name, Family Name, gender, email, institute, years post graduation, subspeciality
- 40 neurovascular anatomy MCQs imported from the provided Markdown file (`cerebrovascular_MCQ_select1or2_variant_R4.md`)
- Each question allows one or two answers, matching the original question wording
- Rules/consent gate before the exam: an explicit warning not to use AI or any external help; the 30-minute timer starts only after the participant agrees
- 30-minute timer (anchored to the server-side start time) with automatic submission
- Server-side scoring using exact-match logic
- Immediate personal result page: score, **rank within the cohort**, cohort mean, 偏差値. The review of missed questions (correct answers + explanations) is shown only after the administrator publishes the answers, so early submitters cannot see the key while others are still taking the exam. Open result pages pick up the published answers automatically.
- Admin dashboard: summary, top 5, a **"Publish answers" toggle** that releases the missed-question review to participants, an on-demand **ranking by score** and **hardest 10 questions (lowest correct rate)**, full question correct rates and option-selection rates
- Excel export with scores, question stats, option stats, and per-participant responses
- Optional admin button to also email each participant the questions they missed plus explanations (requires SMTP)

## Railway deployment

1. Create a new GitHub repository and upload this folder.
2. In Railway, create a **New Project → Deploy from GitHub repo**.
3. Add a **PostgreSQL** service to the same Railway project.
4. In the web app service, open **Variables** and set:

   ```text
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ADMIN_PASSWORD=<your strong password>
   COURSE_NAME=WFITN Neurovascular Anatomy Course Zurich 2026
   AVATAR_URL=https://avatars.githubusercontent.com/u/269770510?v=4
   EXAM_DURATION_MINUTES=30
   ```

5. After Railway gives the app a public domain, set:

   ```text
   APP_BASE_URL=https://<your-railway-domain>
   ```

6. For feedback emails, set SMTP variables:

   ```text
   SMTP_HOST=smtp.example.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=...
   SMTP_PASS=...
   SMTP_FROM="WFITN Anatomy Course <no-reply@example.com>"
   ```

7. Open:

   - Participant entry: `/`
   - Admin page: `/admin`
   - Health check: `/health`

## Local development

You need Node.js 20+ and a PostgreSQL database.

```bash
npm install
cp .env.example .env
# edit .env and set DATABASE_URL + ADMIN_PASSWORD
npm run dev
```

The app automatically creates the required PostgreSQL tables on startup.

Validate the question bank (40 questions, 5 options each, 1–2 correct answers) at any time:

```bash
npm run validate
```

The active question bank in `data/questions.json` is generated from the Markdown source. To regenerate it after editing the Markdown:

```bash
npm run build:questions
```

## Project structure

```text
src/      Express server, config, PostgreSQL access, scoring, question validator
public/   Participant and admin web pages (static, served at /)
data/     questions.json — the 40-question bank used for scoring and feedback
cerebrovascular_MCQ_select1or2_variant_R4.md   Active source of the questions (R4 variant set)
cerebrovascular_MCQ_select1or2_revised_R3.md   Previous question set (kept for reference)
```

## Scoring rule

A question is correct only when the participant's selected answer set exactly matches the answer key. For example, if the correct answer is `c, d`, selecting only `c`, selecting `c, e`, or selecting `c, d, e` is incorrect.

## Privacy / operations notes

- Do not publish the admin URL/password in participant materials.
- Export the Excel file after the exam and keep it in a secure institutional location.
- Configure SMTP before using the feedback-email button.
- Test with a few dummy participants before the Zurich course.
