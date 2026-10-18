require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  adminPassword: process.env.ADMIN_PASSWORD || 'hunter-admin-2024',
  tgToken: process.env.TELEGRAM_BOT_TOKEN || '8892400344:AAHJemJgvaQXJ8996Sso76VtIPLDd607Kt8',
  tgAdmin: process.env.TELEGRAM_ADMIN_ID || '8571408433',
  dbPath: process.env.DB_PATH || './data/hunter.db',
  ipSalt: process.env.IP_SALT || 'hunter-default-salt',
  quizSeconds: 15,
};