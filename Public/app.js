/* ===== الحالة العامة ===== */
const state = {
  token: localStorage.getItem('hs_token') || null,
  me: null,
  quizIndex: 0,
  quizTimer: null,
  quizSecondsLeft: 0,
  selectedChoice: null,
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const api = async (path, opts = {}) => {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers['x-auth-token'] = state.token;
  const r = await fetch(path, { ...opts, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'خطأ'), { status: r.status, data });
  return data;
};

function getDeviceId() {
  let d = localStorage.getItem('hs_device');
  if (!d) {
    d = crypto.getRandomValues(new Uint32Array(4)).join('-');
    localStorage.setItem('hs_device', d);
  }
  return d;
}

/* ===== بوابة الدخول ===== */
$('#startBtn').addEventListener('click', async () => {
  const val = $('#konayoInput').value.trim();
  if (val.length < 2) return alert('اكتب اسم كونايو صحيحًا');
  const btn = $('#startBtn');
  btn.disabled = true; btn.textContent = 'جارٍ التسجيل...';
  try {
    const res = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({ konayo: val, deviceId: getDeviceId() })
    });
    state.token = res.token;
    localStorage.setItem('hs_token', res.token);
    await bootApp();
  } catch (e) {
    alert(e.message);
    btn.disabled = false; btn.textContent = 'بدء الدخول ⟶';
  }
});

/* ===== التهيئة ===== */
async function bootApp() {
  if (!state.token) return;
  try {
    state.me = await api('/api/me');
  } catch (e) {
    localStorage.removeItem('hs_token');
    state.token = null;
    return;
  }
  $('#gate').classList.add('hidden');
  $('#topbar').classList.remove('hidden');
  $('#tabs').classList.remove('hidden');
  $('#main').classList.remove('hidden');
  $('#restBtn').classList.remove('hidden');
  $('#userName').textContent = state.me.konayo;

  // شاشة الترحيب
  const welcome = document.createElement('div');
  welcome.className = 'card';
  welcome.style.borderColor = 'rgba(79,209,232,.5)';
  welcome.innerHTML = `<h2>مرحبًا، ${state.me.konayo} 🌌</h2>
    <p>تم تسجيلك في نظام الصياد. ابدأ من اختبار الأنمي، ثم اختر فصيلك، وحلّ القضية.</p>`;
  const main = $('#main');
  main.insertBefore(welcome, main.firstChild);
  setTimeout(() => welcome.remove(), 8000);

  initQuiz();
  initFaction();
  initCase();
  initPoints();
  loadRest();
}

/* ===== التبويبات ===== */
$$('#tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('#tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab-panel').forEach(p => p.classList.add('hidden'));
    $('#tab-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'faction') refreshFactionStats();
    if (btn.dataset.tab === 'points') loadPoints();
  });
});

/* ===== الاختبار ===== */
async function initQuiz() {
  const st = await api('/api/quiz/state');
  if (st.done) return showQuizResult();
  state.quizIndex = st.currentIndex;
  $('#quizStartBtn').onclick = () => {
    $('#quizIntro').classList.add('hidden');
    $('#quizBox').classList.remove('hidden');
    loadQuestion(state.quizIndex);
  };
}

async function loadQuestion(idx) {
  clearInterval(state.quizTimer);
  const data = await api('/api/quiz/question/' + idx);
  if (data.already) return loadQuestion(idx + 1);
  state.selectedChoice = null;
  state.quizIndex = idx;
  $('#qCount').textContent = `سؤال ${idx + 1} من ${data.total}`;
  $('#qText').textContent = data.question;
  $('#qProgress').style.width = ((idx) / data.total * 100) + '%';
  const optBox = $('#qOptions');
  optBox.innerHTML = '';
  data.options.forEach((opt, i) => {
    const b = document.createElement('button');
    b.className = 'opt';
    b.textContent = opt;
    b.onclick = () => {
      $$('#qOptions .opt').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      state.selectedChoice = i;
    };
    optBox.appendChild(b);
  });

  state.quizSecondsLeft = data.seconds;
  updateTimer();
  state.quizTimer = setInterval(() => {
    state.quizSecondsLeft--;
    updateTimer();
    if (state.quizSecondsLeft <= 0) {
      clearInterval(state.quizTimer);
      submitAnswer();
    }
  }, 1000);
}

function updateTimer() {
  const el = $('#qTimer');
  el.textContent = state.quizSecondsLeft;
  el.classList.toggle('warn', state.quizSecondsLeft <= 5);
}

async function submitAnswer() {
  clearInterval(state.quizTimer);
  try {
    const res = await api('/api/quiz/answer', {
      method: 'POST',
      body: JSON.stringify({ index: state.quizIndex, choice: state.selectedChoice })
    });
    if (res.done) return showQuizResult();
    loadQuestion(state.quizIndex + 1);
  } catch (e) {
    console.error(e);
    loadQuestion(state.quizIndex + 1);
  }
}

async function showQuizResult() {
  $('#quizIntro').classList.add('hidden');
  $('#quizBox').classList.add('hidden');
  $('#quizResult').classList.remove('hidden');
  const r = await api('/api/quiz/result');
  $('#scoreBig').textContent = `${r.score} / ${r.outOf}`;
  $('#scoreSub').textContent = `ترتيبك: ${r.rank} من ${r.totalParticipants} مشاركًا أكملوا الاختبار`;
}

/* ===== الفصيل ===== */
async function initFaction() {
  await refreshFactionStats();
  const me = state.me;
  if (me.faction) {
    $('#factionChoose').innerHTML = `<h2>فصيلك</h2>
      <p style="font-size:1.1rem;color:var(--gold-hi)">${me.faction === 'light' ? 'فصيل النور' : me.faction === 'dark' ? 'فصيل الظلام' : 'فصيل الخالدين'}</p>
      ${me.faction === 'immortal' ? '<p class="muted">لقد اخترت عدم الانحياز، وانضممت إلى فصيل الخالدين.</p>' : ''}`;
    return;
  }
  $$('.f-btn').forEach(b => b.onclick = () => chooseFaction(b.dataset.f));
  $('#neutralBtn').onclick = () => $('#neutralModal').classList.remove('hidden');
  $('#neutralBack').onclick = () => $('#neutralModal').classList.add('hidden');
  $('#neutralConfirm').onclick = async () => {
    $('#neutralModal').classList.add('hidden');
    await chooseFaction('immortal');
  };
}

async function chooseFaction(choice) {
  try {
    const r = await api('/api/faction', { method: 'POST', body: JSON.stringify({ choice }) });
    state.me.faction = r.faction;
    if (choice === 'immortal') {
      $('#factionChoose').innerHTML = `<h2>🎉 تهانينا!</h2>
        <p>انضممت إلى <b>فصيل الخالدين</b>. حصلت على نقاطه الخاصة.</p>
        <p class="muted">لن يظهر لك أي معلومات إضافية عن الخالدين — هذا الفصيل يعمل في الظل.</p>`;
    } else {
      $('#factionChoose').innerHTML = `<h2>تم اختيار الفصيل</h2>
        <p>انضممت إلى <b>${choice === 'light' ? 'فصيل النور' : 'فصيل الظلام'}</b>.</p>`;
    }
    await refreshFactionStats();
  } catch (e) { alert(e.message); }
}

async function refreshFactionStats() {
  const s = await api('/api/faction/stats');
  $('#ratioLight').style.width = s.light + '%';
  $('#ratioDark').style.width = s.dark + '%';
  $('#pctLight').textContent = s.light + '%';
  $('#pctDark').textContent = s.dark + '%';
}

/* ===== القضية ===== */
function initCase() {
  if (state.me.case_submitted) {
    $('#caseSubmitBtn').disabled = true;
    $('#caseSubmitBtn').textContent = 'تم إرسال استنتاجك ✓';
    $('#caseStatus').textContent = 'استنتاجك وصل إلى المدير. شكرًا لمشاركتك.';
  }
  $('#caseSubmitBtn').onclick = async () => {
    const answer = $('#caseAnswer').value.trim();
    if (answer.length < 20) return alert('اكتب استنتاجًا أطول (20 حرفًا على الأقل).');
    try {
      await api('/api/case/submit', { method: 'POST', body: JSON.stringify({ answer }) });
      $('#caseSubmitBtn').disabled = true;
      $('#caseSubmitBtn').textContent = 'تم الإرسال ✓';
      $('#caseStatus').textContent = 'وصل استنتاجك إلى المدير.';
    } catch (e) { alert(e.message); }
  };
}

/* ===== النقاط ===== */
async function loadPoints() {
  const data = await api('/api/points');
  const rules = await api('/api/rules');
  $('#myPoints').textContent = data.points;
  $('#pointsLog').innerHTML = data.log.length
    ? data.log.map(l => `<div style="display:flex;justify-content:space-between;padding:.4rem 0;border-bottom:1px dashed rgba(255,255,255,.08)">
        <span>${l.reason}</span>
        <b style="color:var(--gold-hi)">${l.points > 0 ? '+' : ''}${l.points}</b>
      </div>`).join('')
    : '<span class="muted">لا توجد نقاط بعد.</span>';
  $('#rulesBox').innerHTML = `
    <div style="display:flex;justify-content:space-between;padding:.35rem 0"><span>كل إجابة صحيحة</span><b>${rules.quiz_per_correct}</b></div>
    <div style="display:flex;justify-content:space-between;padding:.35rem 0"><span>الانضمام لفصيل الخالدين</span><b>${rules.faction_immortal}</b></div>
    <div style="display:flex;justify-content:space-between;padding:.35rem 0"><span>نقاط فصيل النور (تُعلن بعد الحرب)</span><b>${rules.faction_light}</b></div>
    <div style="display:flex;justify-content:space-between;padding:.35rem 0"><span>نقاط فصيل الظلام (تُعلن بعد الحرب)</span><b>${rules.faction_dark}</b></div>
    <div style="display:flex;justify-content:space-between;padding:.35rem 0"><span>حل القضية الجنائية</span><b>${rules.case_points}</b></div>
  `;
}

/* ===== استراحة المحارب ===== */
function loadRest() {
  const modal = $('#restModal');
  $('#restBtn').onclick = () => modal.classList.remove('hidden');
  $('#restClose').onclick = () => modal.classList.add('hidden');

  const send = async (allow) => {
    const response = $('#restResponse').value.trim();
    if (response.length < 5) return alert('الصق الرد كاملًا أولًا.');
    try {
      await api('/api/rest/submit', {
        method: 'POST',
        body: JSON.stringify({ prompt: '', response, allowPublish: allow })
      });
      $('#restStatus').textContent = allow ? 'تم إرسال ردك للمراجعة قبل النشر ✓' : 'لم يتم النشر. شكرًا لمشاركتك.';
      $('#restAllow').disabled = true;
      $('#restDeny').disabled = true;
    } catch (e) { alert(e.message); }
  };
  $('#restAllow').onclick = () => send(true);
  $('#restDeny').onclick = () => send(false);
}

/* ===== تشغيل ===== */
if (state.token) bootApp();
else $('#gate').classList.remove('hidden');