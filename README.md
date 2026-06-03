# WFITN Anatomy Quiz App

A lightweight Railway-ready web app for the WFITN Neurovascular Anatomy Course final quiz.

## Features

- QR-code entry page for smartphone participants
- Participant registration: Given Name, Family Name, gender, email, institute, years post graduation, subspeciality
- 40 neurovascular anatomy MCQs imported from the provided Markdown file
- Each question allows one or two answers, matching the original question wording
- 30-minute client-side timer with automatic submission
- Server-side scoring using exact-match logic
- Immediate personal result page: score, cohort mean, standard deviation, 偏差値
- Admin dashboard: scores, top 5, question-level correct rates, option-selection rates
- Excel export with scores, question stats, option stats, and per-participant responses
- Admin button to send each participant the questions they missed plus explanations by email

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

## Scoring rule

A question is correct only when the participant's selected answer set exactly matches the answer key. For example, if the correct answer is `c, d`, selecting only `c`, selecting `c, e`, or selecting `c, d, e` is incorrect.

## Privacy / operations notes

- Do not publish the admin URL/password in participant materials.
- Export the Excel file after the exam and keep it in a secure institutional location.
- Configure SMTP before using the feedback-email button.
- Test with a few dummy participants before the Zurich course.
