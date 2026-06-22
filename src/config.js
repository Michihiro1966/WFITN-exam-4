'use strict';

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const parseIntWithFallback = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const config = {
  port: process.env.PORT || 3000,
  databaseUrl: process.env.DATABASE_URL || '',
  adminPassword: process.env.ADMIN_PASSWORD || 'change-me',
  appBaseUrl: process.env.APP_BASE_URL || '',
  courseName: process.env.COURSE_NAME || 'WFITN Neurovascular Anatomy Course Zurich 2026',
  avatarUrl: process.env.AVATAR_URL || 'https://avatars.githubusercontent.com/u/269770510?v=4',
  examDurationMinutes: parseIntWithFallback(process.env.EXAM_DURATION_MINUTES, 40),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseIntWithFallback(process.env.SMTP_PORT, 587),
    secure: parseBool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'WFITN Anatomy Course <no-reply@example.com>'
  },
  sendgrid: {
    apiKey: process.env.SENDGRID_API_KEY || '',
    // The from address must be a verified Single Sender (or domain) in SendGrid.
    // Falls back to SMTP_FROM so a single SMTP_FROM works for both transports.
    from: process.env.SENDGRID_FROM || process.env.SMTP_FROM || 'WFITN Anatomy Course <no-reply@example.com>'
  },
  nodeEnv: process.env.NODE_ENV || 'production'
};

config.examDurationSeconds = config.examDurationMinutes * 60;
config.smtp.enabled = Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
config.sendgrid.enabled = Boolean(config.sendgrid.apiKey && config.sendgrid.from);
// SendGrid (HTTPS) is preferred because Railway blocks outbound SMTP ports.
config.emailEnabled = config.sendgrid.enabled || config.smtp.enabled;

module.exports = { config };
