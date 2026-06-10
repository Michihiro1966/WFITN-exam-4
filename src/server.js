'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');

const { config } = require('./config');
const { initDb, query, transaction } = require('./db');
const {
  questions,
  normalizeSelection,
  scoreAnswers,
  cohortStats,
  deviationValue,
  publicQuestions
} = require('./scoring');

const app = express();
const ADMIN_COOKIE = 'wfitn_admin';

app.set('trust proxy', true);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

function adminToken() {
  return crypto.createHmac('sha256', config.adminPassword).update('wfitn-admin-session').digest('hex');
}

function isProductionRequest(req) {
  return config.nodeEnv === 'production' && req.secure;
}

function requireAdmin(req, res, next) {
  if (req.cookies[ADMIN_COOKIE] === adminToken()) return next();
  return res.status(401).json({ error: 'Admin login required.' });
}

function getBaseUrl(req) {
  if (config.appBaseUrl) return config.appBaseUrl.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function safeText(value, max = 200) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalizeEmail(value) {
  return safeText(value, 254).toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatOptionList(keys) {
  return normalizeSelection(keys).join(', ');
}

async function getParticipant(id) {
  const result = await query('SELECT * FROM participants WHERE id=$1', [id]);
  return result.rows[0] || null;
}

async function getSetting(key, fallback = null) {
  const result = await query('SELECT value FROM settings WHERE key=$1', [key]);
  return result.rows[0] ? result.rows[0].value : fallback;
}

async function setSetting(key, value) {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
    [key, String(value)]
  );
}

async function answersRevealed() {
  return (await getSetting('answers_revealed', 'false')) === 'true';
}

async function getSubmittedScores() {
  const result = await query(
    'SELECT score FROM participants WHERE submitted_at IS NOT NULL AND score IS NOT NULL ORDER BY submitted_at ASC'
  );
  return result.rows.map(row => Number(row.score));
}

async function getParticipantResult(id) {
  const participant = await getParticipant(id);
  if (!participant || !participant.submitted_at) return null;
  const scores = await getSubmittedScores();
  const stats = cohortStats(scores);
  const myScore = Number(participant.score);
  // Standard competition ranking: 1 + number of participants who scored higher.
  const rank = scores.filter(s => s > myScore).length + 1;

  // The missed-question review (correct answers + explanations) is only sent to
  // participants once the administrator has published the answers, so that early
  // submitters cannot see the answer key while others are still taking the exam.
  const revealed = await answersRevealed();
  const review = [];
  let missedCount = 0;
  if (revealed) {
    const responseRows = await query(
      'SELECT question_id, selected, is_correct FROM responses WHERE participant_id=$1 ORDER BY question_id ASC',
      [id]
    );
    for (const question of questions) {
      const row = responseRows.rows.find(r => Number(r.question_id) === question.id);
      const selected = row ? normalizeSelection(row.selected) : [];
      const isCorrect = row ? row.is_correct : false;
      if (!isCorrect) {
        review.push({
          id: question.id,
          section: question.section,
          prompt: question.prompt,
          options: question.options,
          selectCount: question.selectCount,
          selected,
          correct: normalizeSelection(question.correct),
          explanation: question.explanation
        });
      }
    }
    missedCount = review.length;
  }

  return {
    participant: {
      givenName: participant.given_name,
      familyName: participant.family_name,
      institute: participant.institute,
      submittedAt: participant.submitted_at,
      lateSeconds: participant.late_seconds || 0
    },
    score: participant.score,
    total: participant.total,
    percent: participant.total ? participant.score / participant.total : 0,
    cohortN: scores.length,
    rank,
    mean: stats.mean,
    sd: stats.sd,
    deviation: deviationValue(myScore, stats.mean, stats.sd),
    answersRevealed: revealed,
    missedCount: revealed ? missedCount : (participant.total - participant.score),
    review
  };
}

async function buildAdminSummary() {
  const participantsResult = await query(`
    SELECT id, given_name, family_name, gender, email, institute, years_post_graduation,
           subspeciality, started_at, submitted_at, score, total, late_seconds, feedback_sent_at
    FROM participants
    ORDER BY submitted_at ASC NULLS LAST, created_at ASC
  `);

  const submitted = participantsResult.rows.filter(row => row.submitted_at && row.score !== null);
  const scores = submitted.map(row => Number(row.score));
  const stats = cohortStats(scores);

  const participants = participantsResult.rows.map(row => ({
    id: row.id,
    givenName: row.given_name,
    familyName: row.family_name,
    gender: row.gender,
    email: row.email,
    institute: row.institute,
    yearsPostGraduation: row.years_post_graduation,
    subspeciality: row.subspeciality,
    startedAt: row.started_at,
    submittedAt: row.submitted_at,
    score: row.score,
    total: row.total,
    lateSeconds: row.late_seconds || 0,
    feedbackSentAt: row.feedback_sent_at,
    percent: row.total ? row.score / row.total : null,
    deviation: row.score !== null ? deviationValue(Number(row.score), stats.mean, stats.sd) : null
  }));

  const top5 = participants
    .filter(p => p.submittedAt && p.score !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(a.submittedAt) - new Date(b.submittedAt);
    })
    .slice(0, 5);

  const responseResult = await query(`
    SELECT question_id, is_correct, selected
    FROM responses
    ORDER BY question_id ASC
  `);

  const questionStats = questions.map(question => {
    const rows = responseResult.rows.filter(row => Number(row.question_id) === question.id);
    const correctCount = rows.filter(row => row.is_correct).length;
    const optionCounts = { a: 0, b: 0, c: 0, d: 0, e: 0 };
    rows.forEach(row => {
      const selected = normalizeSelection(row.selected);
      selected.forEach(key => { optionCounts[key] += 1; });
    });
    return {
      id: question.id,
      section: question.section,
      prompt: question.prompt,
      correct: question.correct,
      submissions: rows.length,
      correctCount,
      correctRate: rows.length ? correctCount / rows.length : 0,
      optionCounts
    };
  });

  return {
    courseName: config.courseName,
    avatarUrl: config.avatarUrl,
    registeredCount: participants.length,
    submittedCount: submitted.length,
    mean: stats.mean,
    sd: stats.sd,
    participants,
    top5,
    questionStats,
    smtpEnabled: config.smtp.enabled,
    answersRevealed: await answersRevealed()
  };
}

app.get('/health', (req, res) => {
  res.json({ ok: true, courseName: config.courseName, durationMinutes: config.examDurationMinutes });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.post('/api/admin/login', (req, res) => {
  const password = String(req.body.password || '');
  if (password !== config.adminPassword) {
    return res.status(401).json({ error: 'Invalid admin password.' });
  }
  res.cookie(ADMIN_COOKIE, adminToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProductionRequest(req),
    maxAge: 1000 * 60 * 60 * 12
  });
  res.json({ ok: true });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  res.clearCookie(ADMIN_COOKIE);
  res.json({ ok: true });
});

app.get('/api/admin/summary', requireAdmin, async (req, res, next) => {
  try {
    res.json(await buildAdminSummary());
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/reveal', requireAdmin, async (req, res, next) => {
  try {
    const reveal = req.body.reveal === true || String(req.body.reveal).toLowerCase() === 'true';
    await setSetting('answers_revealed', reveal ? 'true' : 'false');
    res.json({ ok: true, answersRevealed: reveal });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/qr.png', requireAdmin, async (req, res, next) => {
  try {
    const url = `${getBaseUrl(req)}/`;
    const buffer = await QRCode.toBuffer(url, { width: 900, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

app.post('/api/register', async (req, res, next) => {
  try {
    const givenName = safeText(req.body.givenName, 100);
    const familyName = safeText(req.body.familyName, 100);
    const gender = safeText(req.body.gender, 40);
    const email = normalizeEmail(req.body.email);
    const institute = safeText(req.body.institute, 200);
    const yearsPostGraduation = Number.parseInt(req.body.yearsPostGraduation, 10);
    const subspeciality = safeText(req.body.subspeciality, 200);

    if (!givenName || !familyName || !gender || !email || !institute || !subspeciality) {
      return res.status(400).json({ error: 'Please complete all required fields.' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!Number.isInteger(yearsPostGraduation) || yearsPostGraduation < 0 || yearsPostGraduation > 80) {
      return res.status(400).json({ error: 'Years post graduation must be an integer between 0 and 80.' });
    }

    const id = crypto.randomUUID();
    await query(
      `INSERT INTO participants
       (id, given_name, family_name, gender, email, institute, years_post_graduation, subspeciality)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, givenName, familyName, gender, email, institute, yearsPostGraduation, subspeciality]
    );

    res.json({ ok: true, token: id, examUrl: `/exam.html?token=${encodeURIComponent(id)}` });
  } catch (error) {
    next(error);
  }
});

app.get('/api/me', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    const participant = await getParticipant(token);
    if (!participant) return res.status(404).json({ error: 'Participant not found.' });
    res.json({
      id: participant.id,
      givenName: participant.given_name,
      familyName: participant.family_name,
      startedAt: participant.started_at,
      submittedAt: participant.submitted_at,
      durationSeconds: config.examDurationSeconds,
      courseName: config.courseName,
      avatarUrl: config.avatarUrl
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/start', async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const participant = await getParticipant(token);
    if (!participant) return res.status(404).json({ error: 'Participant not found.' });
    if (participant.submitted_at) {
      return res.json({ ok: true, alreadySubmitted: true, startedAt: participant.started_at });
    }
    // Start the timer when the participant accepts the rules; resume the same
    // start time on reload so refreshing cannot extend the allotted 30 minutes.
    if (!participant.started_at) {
      await query('UPDATE participants SET started_at=NOW() WHERE id=$1 AND started_at IS NULL', [token]);
    }
    const updated = await getParticipant(token);
    res.json({ ok: true, startedAt: updated.started_at, durationSeconds: config.examDurationSeconds });
  } catch (error) {
    next(error);
  }
});

app.get('/api/questions', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    const participant = await getParticipant(token);
    if (!participant) return res.status(404).json({ error: 'Participant not found.' });
    res.json({
      courseName: config.courseName,
      durationSeconds: config.examDurationSeconds,
      startedAt: participant.started_at,
      submittedAt: participant.submitted_at,
      questions: publicQuestions()
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/submit', async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const participant = await getParticipant(token);
    if (!participant) return res.status(404).json({ error: 'Participant not found.' });
    if (participant.submitted_at) {
      const result = await getParticipantResult(token);
      return res.json({ ok: true, alreadySubmitted: true, result });
    }

    const answers = req.body.answers || {};
    for (const question of questions) {
      const selected = normalizeSelection(answers[String(question.id)] || []);
      if (selected.length > question.selectCount) {
        return res.status(400).json({ error: `Q${question.id}: select at most ${question.selectCount} answer(s).` });
      }
    }

    const { score, total, details } = scoreAnswers(answers);
    const startedAtMs = participant.started_at ? new Date(participant.started_at).getTime() : Date.now();
    const nowMs = Date.now();
    const elapsedSeconds = Math.max(0, Math.round((nowMs - startedAtMs) / 1000));
    const lateSeconds = Math.max(0, elapsedSeconds - config.examDurationSeconds);

    await transaction(async client => {
      await client.query(
        `UPDATE participants
         SET submitted_at=NOW(), score=$2, total=$3, late_seconds=$4
         WHERE id=$1`,
        [token, score, total, lateSeconds]
      );
      for (const detail of details) {
        await client.query(
          `INSERT INTO responses (participant_id, question_id, selected, is_correct)
           VALUES ($1,$2,$3::jsonb,$4)
           ON CONFLICT (participant_id, question_id)
           DO UPDATE SET selected=$3::jsonb, is_correct=$4`,
          [token, detail.questionId, JSON.stringify(detail.selected), detail.isCorrect]
        );
      }
    });

    const result = await getParticipantResult(token);
    res.json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.get('/api/result', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    const result = await getParticipantResult(token);
    if (!result) return res.status(404).json({ error: 'Result not found or not submitted yet.' });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/export.xlsx', requireAdmin, async (req, res, next) => {
  try {
    const summary = await buildAdminSummary();
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'WFITN Anatomy Quiz App';
    workbook.created = new Date();

    const scoresSheet = workbook.addWorksheet('Scores');
    scoresSheet.columns = [
      { header: 'Rank', key: 'rank', width: 8 },
      { header: 'Given Name', key: 'givenName', width: 18 },
      { header: 'Family Name', key: 'familyName', width: 18 },
      { header: 'Gender', key: 'gender', width: 12 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Institute', key: 'institute', width: 34 },
      { header: 'Years Post Graduation', key: 'yearsPostGraduation', width: 22 },
      { header: 'Subspeciality', key: 'subspeciality', width: 24 },
      { header: 'Score', key: 'score', width: 10 },
      { header: 'Total', key: 'total', width: 10 },
      { header: 'Percent', key: 'percent', width: 12 },
      { header: 'Cohort Mean', key: 'mean', width: 14 },
      { header: 'Cohort SD', key: 'sd', width: 12 },
      { header: '偏差値', key: 'deviation', width: 12 },
      { header: 'Started At', key: 'startedAt', width: 24 },
      { header: 'Submitted At', key: 'submittedAt', width: 24 },
      { header: 'Late Seconds', key: 'lateSeconds', width: 14 },
      { header: 'Feedback Sent At', key: 'feedbackSentAt', width: 24 }
    ];

    const ranked = [...summary.participants]
      .filter(p => p.submittedAt && p.score !== null)
      .sort((a, b) => (b.score - a.score) || (new Date(a.submittedAt) - new Date(b.submittedAt)));
    const rankById = new Map(ranked.map((p, index) => [p.id, index + 1]));

    summary.participants.forEach(participant => {
      scoresSheet.addRow({
        rank: rankById.get(participant.id) || '',
        givenName: participant.givenName,
        familyName: participant.familyName,
        gender: participant.gender,
        email: participant.email,
        institute: participant.institute,
        yearsPostGraduation: participant.yearsPostGraduation,
        subspeciality: participant.subspeciality,
        score: participant.score,
        total: participant.total,
        percent: participant.percent,
        mean: summary.mean,
        sd: summary.sd,
        deviation: participant.deviation,
        startedAt: participant.startedAt,
        submittedAt: participant.submittedAt,
        lateSeconds: participant.lateSeconds,
        feedbackSentAt: participant.feedbackSentAt
      });
    });
    scoresSheet.getRow(1).font = { bold: true };
    scoresSheet.getColumn('percent').numFmt = '0.0%';
    scoresSheet.getColumn('mean').numFmt = '0.00';
    scoresSheet.getColumn('sd').numFmt = '0.00';
    scoresSheet.getColumn('deviation').numFmt = '0.0';

    const qSheet = workbook.addWorksheet('Question Stats');
    qSheet.columns = [
      { header: 'Q', key: 'q', width: 6 },
      { header: 'Section', key: 'section', width: 42 },
      { header: 'Correct Answer', key: 'correct', width: 16 },
      { header: 'Correct Count', key: 'correctCount', width: 14 },
      { header: 'Submissions', key: 'submissions', width: 14 },
      { header: 'Correct Rate', key: 'correctRate', width: 14 },
      { header: 'Prompt', key: 'prompt', width: 100 }
    ];
    summary.questionStats.forEach(item => {
      qSheet.addRow({
        q: `Q${item.id}`,
        section: item.section,
        correct: item.correct.join(', '),
        correctCount: item.correctCount,
        submissions: item.submissions,
        correctRate: item.correctRate,
        prompt: item.prompt
      });
    });
    qSheet.getRow(1).font = { bold: true };
    qSheet.getColumn('correctRate').numFmt = '0.0%';

    const oSheet = workbook.addWorksheet('Option Rates');
    oSheet.columns = [
      { header: 'Q', key: 'q', width: 6 },
      { header: 'Option', key: 'option', width: 10 },
      { header: 'Is Correct Option', key: 'isCorrectOption', width: 18 },
      { header: 'Selected Count', key: 'selectedCount', width: 16 },
      { header: 'Selected Rate', key: 'selectedRate', width: 16 },
      { header: 'Option Text', key: 'optionText', width: 90 }
    ];
    summary.questionStats.forEach(item => {
      const question = questions.find(q => q.id === item.id);
      question.options.forEach(option => {
        const count = item.optionCounts[option.key] || 0;
        oSheet.addRow({
          q: `Q${item.id}`,
          option: option.key,
          isCorrectOption: item.correct.includes(option.key) ? 'Yes' : 'No',
          selectedCount: count,
          selectedRate: item.submissions ? count / item.submissions : 0,
          optionText: option.text
        });
      });
    });
    oSheet.getRow(1).font = { bold: true };
    oSheet.getColumn('selectedRate').numFmt = '0.0%';

    const responsesSheet = workbook.addWorksheet('Responses');
    const responseRows = await query(`
      SELECT p.given_name, p.family_name, p.email, r.question_id, r.selected, r.is_correct
      FROM responses r
      JOIN participants p ON p.id = r.participant_id
      ORDER BY p.family_name, p.given_name, r.question_id
    `);
    responsesSheet.columns = [
      { header: 'Given Name', key: 'givenName', width: 18 },
      { header: 'Family Name', key: 'familyName', width: 18 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Q', key: 'q', width: 6 },
      { header: 'Selected', key: 'selected', width: 16 },
      { header: 'Correct Answer', key: 'correct', width: 16 },
      { header: 'Is Correct', key: 'isCorrect', width: 12 }
    ];
    responseRows.rows.forEach(row => {
      const question = questions.find(q => q.id === Number(row.question_id));
      responsesSheet.addRow({
        givenName: row.given_name,
        familyName: row.family_name,
        email: row.email,
        q: `Q${row.question_id}`,
        selected: normalizeSelection(row.selected).join(', '),
        correct: question ? question.correct.join(', ') : '',
        isCorrect: row.is_correct ? 'Yes' : 'No'
      });
    });
    responsesSheet.getRow(1).font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="wfitn_anatomy_quiz_results.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

function buildFeedbackHtml(participant, resultRows, baseUrl) {
  const wrong = resultRows.filter(row => !row.is_correct);
  const name = `${participant.given_name} ${participant.family_name}`.trim();
  const scoreLine = `Your score was ${participant.score}/${participant.total}.`;

  let html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:820px">
      <h2>${escapeHtml(config.courseName)}</h2>
      <p>Dear ${escapeHtml(name)},</p>
      <p>Thank you for participating in the WFITN anatomy course quiz. ${escapeHtml(scoreLine)}</p>
  `;

  if (!wrong.length) {
    html += '<p><strong>Excellent work — you answered all questions correctly.</strong></p>';
  } else {
    html += '<p>Below are the questions you missed, with the correct answer and explanation.</p>';
    wrong.forEach(row => {
      const question = questions.find(q => q.id === Number(row.question_id));
      if (!question) return;
      const selected = normalizeSelection(row.selected);
      html += `
        <hr style="border:0;border-top:1px solid #e5e7eb;margin:24px 0">
        <h3>Q${question.id}</h3>
        <p><strong>${escapeHtml(question.prompt)}</strong></p>
        <ol type="a">
          ${question.options.map(option => `<li>${escapeHtml(option.text)}</li>`).join('')}
        </ol>
        <p><strong>Your answer:</strong> ${escapeHtml(formatOptionList(selected) || 'No answer')}</p>
        <p><strong>Correct answer:</strong> ${escapeHtml(formatOptionList(question.correct))}</p>
        <div style="background:#f9fafb;border-left:4px solid #1f2937;padding:12px 14px;white-space:pre-wrap">${escapeHtml(question.explanation)}</div>
      `;
    });
  }

  html += `
      <p style="margin-top:28px">Course page: <a href="${escapeHtml(baseUrl)}">${escapeHtml(baseUrl)}</a></p>
      <p>With best regards,<br>WFITN Anatomy Course</p>
    </div>
  `;
  return html;
}

async function sendFeedbackEmail(participant, resultRows, baseUrl) {
  if (!config.smtp.enabled) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM in Railway variables.');
  }
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass }
  });
  const html = buildFeedbackHtml(participant, resultRows, baseUrl);
  await transporter.sendMail({
    from: config.smtp.from,
    to: participant.email,
    subject: `${config.courseName}: your quiz feedback`,
    html
  });
}

app.post('/api/admin/send-feedback', requireAdmin, async (req, res, next) => {
  try {
    if (!config.smtp.enabled) {
      return res.status(400).json({ error: 'SMTP is not configured. Please set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM.' });
    }

    const participantResult = await query(`
      SELECT * FROM participants
      WHERE submitted_at IS NOT NULL AND feedback_sent_at IS NULL
      ORDER BY submitted_at ASC
    `);

    let sent = 0;
    const failures = [];
    const baseUrl = getBaseUrl(req);

    for (const participant of participantResult.rows) {
      try {
        const rows = await query('SELECT question_id, selected, is_correct FROM responses WHERE participant_id=$1 ORDER BY question_id ASC', [participant.id]);
        await sendFeedbackEmail(participant, rows.rows, baseUrl);
        await query('UPDATE participants SET feedback_sent_at=NOW() WHERE id=$1', [participant.id]);
        sent += 1;
      } catch (error) {
        failures.push({ email: participant.email, error: error.message });
      }
    }

    res.json({ ok: failures.length === 0, sent, failures });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: error.message || 'Internal server error.' });
});

initDb()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`${config.courseName} running on port ${config.port}`);
    });
  })
  .catch(error => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });
