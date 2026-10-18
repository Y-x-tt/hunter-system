const express = require('express');
const crypto = require('crypto');
const path = require('path');
const cfg = require('./config');
const { db, getSetting, setSetting, addPoints } = require('./db');
const { sendTelegram } = require('./telegram');
const QUESTIONS = require('./questions');

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_TOKEN = crypto.createHash('sha256').update('admin:' + cfg.adminPassword).digest('hex');

// ===== Helpers =====
function auth(req, res, next) {
  const t = req.headers['x-auth-token'];
  if (!t) return res.status(401).json({ error: 'unauthorized' });
  const p = db.prepare('SELECT * FROM participants WHERE token = ?').get(t);
  if (!p) return res.status(401).json({ error: 'unauthorized' });
  req.participant = p;
  next();
}
function adminAuth(req, res, next) {
  if ((req.headers['x-admin-token'] || '') !== ADMIN_TOKEN) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// ===== Register =====
app.post('/api/register', (req, res) => {
  const { konayo, deviceId } = req.body || {};
  if (!konayo || String(konayo).trim().length < 2) return res.status(400).json({ error: 'اسم غير صالح' });
  const name = String(konayo).trim();
  if (db.prepare('SELECT id FROM participants WHERE konayo = ?').get(name))
    return res.status(409).json({ error: 'هذا الاسم مسجل مسبقًا' });
  if (deviceId && db.prepare('SELECT id FROM participants WHERE device_id = ?').get(deviceId))
    return res.status(409).json({ error: 'هذا الجهاز سجّل مسبقًا' });

  const token = crypto.randomBytes(24).toString('hex');
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
  const ipHash = crypto.createHash('sha256').update(ip + cfg.ipSalt).digest('hex');
  const now = Date.now();
  db.prepare('INSERT INTO participants (konayo, token, device_id, ip_hash, created_at) VALUES (?,?,?,?,?)')
    .run(name, token, deviceId || null, ipHash, now);
  sendTelegram(`🆕 تسجيل جديد في نظام الصياد\nالاسم: ${name}\nالتوقيت: ${new Date(now).toLocaleString('ar-EG')}`);
  res.json({ token, konayo: name });
});

app.get('/api/me', auth, (req, res) => {
  const p = req.participant;
  res.json({
    konayo: p.konayo,
    quiz_score: p.quiz_score,
    faction: p.faction,
    points: p.points,
    case_submitted: !!p.case_submitted,
    rest_submitted: !!p.rest_submitted,
    event_title: getSetting('event_title', 'نظام الصياد'),
    event_active: getSetting('event_active', '1') === '1',
  });
});

// ===== Quiz =====
app.get('/api/quiz/state', auth, (req, res) => {
  const p = req.participant;
  if (p.quiz_score !== null) return res.json({ done: true, score: p.quiz_score });
  const count = db.prepare('SELECT COUNT(*) c FROM quiz_answers WHERE participant_id=?').get(p.id).c;
  res.json({ done: false, currentIndex: count, total: QUESTIONS.length });
});

app.get('/api/quiz/question/:idx', auth, (req, res) => {
  const p = req.participant;
  if (p.quiz_score !== null) return res.status(400).json({ error: 'finished' });
  const idx = parseInt(req.params.idx, 10);
  if (isNaN(idx) || idx < 0 || idx >= QUESTIONS.length) return res.status(400).json({ error: 'invalid' });
  const exists = db.prepare('SELECT id FROM quiz_answers WHERE participant_id=? AND question_id=?').get(p.id, idx);
  if (exists) return res.json({ already: true });
  const q = QUESTIONS[idx];
  res.json({ index: idx, total: QUESTIONS.length, question: q.q, options: q.options, seconds: cfg.quizSeconds });
});

app.post('/api/quiz/answer', auth, (req, res) => {
  const p = req.participant;
  if (p.quiz_score !== null) return res.status(400).json({ error: 'finished' });
  const { index, choice } = req.body || {};
  const q = QUESTIONS[index];
  if (!q) return res.status(400).json({ error: 'invalid' });
  if (db.prepare('SELECT id FROM quiz_answers WHERE participant_id=? AND question_id=?').get(p.id, index))
    return res.json({ ok: true });

  const isCorrect = choice !== null && choice !== undefined && Number(choice) === q.answer;
  db.prepare('INSERT INTO quiz_answers (participant_id, question_id, choice, correct, answered_at) VALUES (?,?,?,?,?)')
    .run(p.id, index, choice ?? null, isCorrect ? 1 : 0, Date.now());

  const count = db.prepare('SELECT COUNT(*) c FROM quiz_answers WHERE participant_id=?').get(p.id).c;
  if (count >= QUESTIONS.length) {
    const score = db.prepare('SELECT SUM(correct) s FROM quiz_answers WHERE participant_id=?').get(p.id).s || 0;
    db.prepare('UPDATE participants SET quiz_score=?, quiz_completed_at=? WHERE id=?').run(score, Date.now(), p.id);
    const per = parseInt(getSetting('rule_quiz_per_correct', '1'), 10);
    addPoints(p.id, `اختبار الأنمي (${score} صحيحة)`, score * per);
    sendTelegram(`🎯 أنهى ${p.konayo} اختبار الأنمي\nالنتيجة: ${score}/${QUESTIONS.length}`);
    return res.json({ done: true, score });
  }
  res.json({ done: false });
});

app.get('/api/quiz/result', auth, (req, res) => {
  const p = req.participant;
  if (p.quiz_score === null) return res.status(400).json({ error: 'not finished' });
  const total = db.prepare('SELECT COUNT(*) c FROM participants WHERE quiz_score IS NOT NULL').get().c;
  const above = db.prepare('SELECT COUNT(*) c FROM participants WHERE quiz_score > ?').get(p.quiz_score).c;
  res.json({ score: p.quiz_score, outOf: QUESTIONS.length, rank: above + 1, totalParticipants: total });
});

// ===== Faction =====
app.post('/api/faction', auth, (req, res) => {
  const p = req.participant;
  if (p.faction) return res.status(400).json({ error: 'already chosen' });
  const { choice } = req.body || {};
  if (!['light', 'dark', 'immortal'].includes(choice)) return res.status(400).json({ error: 'invalid' });
  db.prepare('UPDATE participants SET faction=? WHERE id=?').run(choice, p.id);
  if (choice === 'immortal') {
    const pts = parseInt(getSetting('rule_faction_immortal', '10'), 10);
    addPoints(p.id, 'الانضمام إلى فصيل الخالدين', pts);
  }
  const ar = choice === 'light' ? 'النور' : choice === 'dark' ? 'الظلام' : 'الخالدون';
  sendTelegram(`⚔️ انضمام فصيل\nالاسم: ${p.konayo}\nالفصيل: ${ar}`);
  res.json({ ok: true, faction: choice });
});

app.get('/api/faction/stats', (req, res) => {
  const l = db.prepare("SELECT COUNT(*) c FROM participants WHERE faction='light'").get().c;
  const d = db.prepare("SELECT COUNT(*) c FROM participants WHERE faction='dark'").get().c;
  const total = l + d;
  if (total === 0) return res.json({ light: 50, dark: 50 });
  const light = Math.round((l / total) * 100);
  res.json({ light, dark: 100 - light });
});

// ===== Case =====
app.post('/api/case/submit', auth, (req, res) => {
  const p = req.participant;
  if (p.case_submitted) return res.status(400).json({ error: 'already submitted' });
  const { answer } = req.body || {};
  if (!answer || answer.trim().length < 20) return res.status(400).json({ error: 'الإجابة قصيرة جدًا' });
  db.prepare('INSERT INTO case_submissions (participant_id, answer, created_at) VALUES (?,?,?)')
    .run(p.id, answer.trim(), Date.now());
  db.prepare('UPDATE participants SET case_submitted=1 WHERE id=?').run(p.id);
  const per = parseInt(getSetting('rule_case', '0'), 10);
  addPoints(p.id, 'تقديم حل القضية', per);
  sendTelegram(`🔍 حل القضية من ${p.konayo}\n\n${answer.trim().slice(0, 3500)}`);
  res.json({ ok: true });
});

// ===== Rest =====
app.post('/api/rest/submit', auth, (req, res) => {
  const p = req.participant;
  if (p.rest_submitted) return res.status(400).json({ error: 'already submitted' });
  const { prompt, response, allowPublish } = req.body || {};
  if (!response || response.trim().length < 5) return res.status(400).json({ error: 'الرد قصير جدًا' });
  const allow = allowPublish ? 1 : 0;
  db.prepare('INSERT INTO rest_submissions (participant_id, prompt, response, allow_publish, status, created_at) VALUES (?,?,?,?,?,?)')
    .run(p.id, String(prompt || '').slice(0, 2000), response.trim(), allow, allow ? 'pending' : 'rejected', Date.now());
  db.prepare('UPDATE participants SET rest_submitted=1 WHERE id=?').run(p.id);
  if (allow) sendTelegram(`☕ استراحة المحارب من ${p.konayo}\n\n${response.trim().slice(0, 2500)}`);
  res.json({ ok: true, published: !!allow });
});

// ===== Points =====
app.get('/api/points', auth, (req, res) => {
  const p = db.prepare('SELECT points FROM participants WHERE id=?').get(req.participant.id);
  const log = db.prepare('SELECT reason, points, created_at FROM points_log WHERE participant_id=? ORDER BY id DESC').all(req.participant.id);
  res.json({ points: p.points, log });
});

app.get('/api/rules', (req, res) => {
  res.json({
    quiz_per_correct: parseInt(getSetting('rule_quiz_per_correct', '1'), 10),
    faction_light: parseInt(getSetting('rule_faction_light', '0'), 10),
    faction_dark: parseInt(getSetting('rule_faction_dark', '0'), 10),
    faction_immortal: parseInt(getSetting('rule_faction_immortal', '10'), 10),
    case_points: parseInt(getSetting('rule_case', '0'), 10),
    rest_points: parseInt(getSetting('rule_rest', '0'), 10),
    event_title: getSetting('event_title', 'نظام الصياد'),
  });
});

// ===== Admin =====
app.post('/api/admin/login', (req, res) => {
  if (!req.body || req.body.password !== cfg.adminPassword) return res.status(401).json({ error: 'كلمة مرور خاطئة' });
  res.json({ token: ADMIN_TOKEN });
});

app.get('/api/admin/participants', adminAuth, (req, res) => {
  const rows = db.prepare(`SELECT id, konayo, created_at, quiz_score, quiz_completed_at, faction, points,
    case_submitted, rest_submitted FROM participants ORDER BY id DESC`).all();
  res.json(rows);
});

app.get('/api/admin/ranking', adminAuth, (req, res) => {
  const rows = db.prepare(`SELECT konayo, quiz_score, quiz_completed_at FROM participants
    WHERE quiz_score IS NOT NULL ORDER BY quiz_score DESC, quiz_completed_at ASC`).all();
  res.json(rows);
});

app.get('/api/admin/factions', adminAuth, (req, res) => {
  const l = db.prepare("SELECT COUNT(*) c FROM participants WHERE faction='light'").get().c;
  const d = db.prepare("SELECT COUNT(*) c FROM participants WHERE faction='dark'").get().c;
  const m = db.prepare("SELECT COUNT(*) c FROM participants WHERE faction='immortal'").get().c;
  res.json({ light: l, dark: d, immortal: m, total: l + d + m });
});

app.get('/api/admin/cases', adminAuth, (req, res) => {
  res.json(db.prepare(`SELECT cs.id, p.konayo, cs.answer, cs.created_at
    FROM case_submissions cs JOIN participants p ON p.id = cs.participant_id
    ORDER BY cs.id DESC`).all());
});

app.get('/api/admin/rest', adminAuth, (req, res) => {
  res.json(db.prepare(`SELECT rs.id, p.konayo, rs.prompt, rs.response, rs.allow_publish, rs.status, rs.created_at
    FROM rest_submissions rs JOIN participants p ON p.id = rs.participant_id
    ORDER BY rs.id DESC`).all());
});

app.post('/api/admin/rest/:id/status', adminAuth, (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ error: 'invalid' });
  db.prepare('UPDATE rest_submissions SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ ok: true });
});

app.get('/api/admin/settings', adminAuth, (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  res.json(out);
});

app.post('/api/admin/settings', adminAuth, (req, res) => {
  const allowed = ['rule_quiz_per_correct', 'rule_faction_light', 'rule_faction_dark',
    'rule_faction_immortal', 'rule_case', 'rule_rest', 'event_title', 'event_active'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) setSetting(k, req.body[k]);
  }
  res.json({ ok: true });
});

// توزيع نقاط الفصائل بعد انتهاء الحرب — مرة واحدة فقط
app.post('/api/admin/award-factions', adminAuth, (req, res) => {
  if (getSetting('factions_awarded', '0') === '1')
    return res.status(400).json({ error: 'تم التوزيع مسبقًا' });
  const pl = parseInt(getSetting('rule_faction_light', '0'), 10);
  const pd = parseInt(getSetting('rule_faction_dark', '0'), 10);
  const members = db.prepare("SELECT id, faction FROM participants WHERE faction IN ('light','dark')").all();
  for (const m of members) {
    const pts = m.faction === 'light' ? pl : pd;
    if (pts) addPoints(m.id, `نقاط فصيل ${m.faction === 'light' ? 'النور' : 'الظلام'}`, pts);
  }
  setSetting('factions_awarded', '1');
  sendTelegram(`🏆 تم توزيع نقاط الفصائل\nالنور: ${pl} | الظلام: ${pd}`);
  res.json({ ok: true, awarded: members.length });
});

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(cfg.port, () => {
  console.log(`🔥 HUNTER SYSTEM running on http://localhost:${cfg.port}`);
  console.log(`   Admin panel: http://localhost:${cfg.port}/admin.html`);
});