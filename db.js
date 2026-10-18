const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

if (!fs.existsSync(path.dirname(cfg.dbPath))) fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
const db = new Database(cfg.dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  konayo TEXT UNIQUE NOT NULL,
  token TEXT UNIQUE NOT NULL,
  device_id TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL,
  quiz_score INTEGER DEFAULT NULL,
  quiz_completed_at INTEGER,
  faction TEXT DEFAULT NULL,
  points INTEGER DEFAULT 0,
  case_submitted INTEGER DEFAULT 0,
  rest_submitted INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS quiz_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  choice INTEGER,
  correct INTEGER,
  answered_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS case_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  answer TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rest_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  prompt TEXT,
  response TEXT NOT NULL,
  allow_publish INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS points_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  points INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

const defaults = {
  rule_quiz_per_correct: '1',
  rule_faction_light: '0',
  rule_faction_dark: '0',
  rule_faction_immortal: '10',
  rule_case: '0',
  rule_rest: '0',
  event_title: 'نظام الصياد — HUNTER SYSTEM',
  event_active: '1',
  factions_awarded: '0',
};
for (const [k, v] of Object.entries(defaults)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
}

function getSetting(key, def = '') {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : def;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}
function addPoints(participantId, reason, points) {
  if (!points) return;
  const now = Date.now();
  db.prepare('UPDATE participants SET points = points + ? WHERE id = ?').run(points, participantId);
  db.prepare('INSERT INTO points_log (participant_id, reason, points, created_at) VALUES (?,?,?,?)').run(participantId, reason, points, now);
}

module.exports = { db, getSetting, setSetting, addPoints };