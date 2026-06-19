/* =====================================================================
   Pharma Pulse — live interactive training Q&A / polling tool
   A self-hosted "Slido-style" app for Operations Pharmacy.
   Node.js + Express + Socket.io, JSON-file storage (no DB needed).
   ===================================================================== */

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
// Change this in your hosting environment (set ADMIN_PASS).
const ADMIN_PASS = process.env.ADMIN_PASS || 'pharmacy123';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

app.use(express.json({ limit: '256kb' }));

// Don't serve source / data files statically.
const BLOCKED = new Set(['/server.js', '/package.json', '/package-lock.json', '/data.json', '/render.yaml', '/.gitignore', '/README.md', '/DEPLOY.md']);
app.use((req, res, next) => {
  if (BLOCKED.has(req.path)) return res.status(404).send('Not found');
  next();
});
app.use(express.static(__dirname));

/* ----------------------------- storage ----------------------------- */
function blankData() {
  return {
    title: 'Operations Pharmacy — Training',
    questions: [],
    staff: [],
    responses: {},            // { questionId: [ {id, name, value, ts} ] }
    state: { activeQuestionId: null, accepting: false }
  };
}

let data = blankData();

function load() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = Object.assign(blankData(), JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    }
  } catch (e) {
    console.error('Could not read data file, starting fresh:', e.message);
    data = blankData();
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
    catch (e) { console.error('Save failed:', e.message); }
  }, 150);
}

const id = () => crypto.randomBytes(6).toString('hex');

/* ------------------------------ auth ------------------------------- */
function requireAdmin(req, res, next) {
  const pass = req.get('x-admin-pass');
  if (pass && pass === ADMIN_PASS) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.post('/api/admin/login', (req, res) => {
  if (req.body && req.body.pass === ADMIN_PASS) return res.json({ ok: true });
  res.status(401).json({ error: 'Wrong password' });
});

/* ----------------------- aggregation helpers ----------------------- */
function aggregate(question) {
  const responses = data.responses[question.id] || [];
  const out = { questionId: question.id, type: question.type, total: responses.length };

  if (question.type === 'mc') {
    const counts = {};
    (question.options || []).forEach(o => { counts[o.id] = 0; });
    responses.forEach(r => { if (counts[r.value] !== undefined) counts[r.value]++; });
    out.options = (question.options || []).map(o => ({
      id: o.id, text: o.text, count: counts[o.id] || 0
    }));
  } else if (question.type === 'words') {
    const map = {};
    responses.forEach(r => {
      const w = String(r.value || '').trim();
      if (!w) return;
      const key = w.toLowerCase();
      if (!map[key]) map[key] = { text: w, count: 0 };
      map[key].count++;
    });
    out.words = Object.values(map).sort((a, b) => b.count - a.count);
  } else if (question.type === 'text') {
    out.entries = responses
      .map(r => ({ name: r.name || 'Anonymous', value: r.value, ts: r.ts }))
      .sort((a, b) => b.ts - a.ts);
  } else if (question.type === 'rating') {
    const max = question.scaleMax || 5;
    const dist = {};
    for (let i = 1; i <= max; i++) dist[i] = 0;
    let sum = 0, n = 0;
    responses.forEach(r => {
      const v = parseInt(r.value, 10);
      if (v >= 1 && v <= max) { dist[v]++; sum += v; n++; }
    });
    out.max = max;
    out.distribution = dist;
    out.average = n ? +(sum / n).toFixed(2) : 0;
    out.total = n;
  }
  return out;
}

function publicQuestion(q) {
  if (!q) return null;
  return {
    id: q.id, type: q.type, text: q.text,
    options: (q.options || []).map(o => ({ id: o.id, text: o.text })),
    scaleMax: q.scaleMax || 5
  };
}

/* --------------------------- public API ---------------------------- */
// What staff phones poll: the currently live question.
app.get('/api/active', (req, res) => {
  const q = data.questions.find(x => x.id === data.state.activeQuestionId) || null;
  res.json({
    title: data.title,
    accepting: data.state.accepting,
    question: data.state.activeQuestionId ? publicQuestion(q) : null
  });
});

app.get('/api/staff', (req, res) => {
  res.json(data.staff.map(s => ({ id: s.id, name: s.name })));
});

// Live results for the presenter screen.
app.get('/api/results/:qid', (req, res) => {
  const q = data.questions.find(x => x.id === req.params.qid);
  if (!q) return res.status(404).json({ error: 'No such question' });
  res.json({ question: publicQuestion(q), results: aggregate(q) });
});

// Presenter bootstrap: current live question + its results in one call.
app.get('/api/present', (req, res) => {
  const q = data.questions.find(x => x.id === data.state.activeQuestionId) || null;
  res.json({
    title: data.title,
    accepting: data.state.accepting,
    question: data.state.activeQuestionId ? publicQuestion(q) : null,
    results: q ? aggregate(q) : null
  });
});

// Staff submitting an answer.
app.post('/api/respond', (req, res) => {
  const { value, name, staffId } = req.body || {};
  const qid = data.state.activeQuestionId;
  if (!qid || !data.state.accepting) return res.status(403).json({ error: 'Not accepting answers right now' });
  const q = data.questions.find(x => x.id === qid);
  if (!q) return res.status(404).json({ error: 'No active question' });
  if (value === undefined || value === null || String(value).trim() === '')
    return res.status(400).json({ error: 'Empty answer' });

  let resolvedName = (name || '').trim();
  if (staffId) {
    const s = data.staff.find(x => x.id === staffId);
    if (s) resolvedName = s.name;
  }

  if (!data.responses[qid]) data.responses[qid] = [];
  const list = data.responses[qid];

  // One answer per identified person per question (overwrite). Anonymous = always new.
  const identity = staffId || (resolvedName ? 'name:' + resolvedName.toLowerCase() : null);
  if (identity) {
    const existing = list.find(r => r.identity === identity);
    if (existing) { existing.value = value; existing.ts = Date.now(); }
    else list.push({ id: id(), identity, name: resolvedName, value, ts: Date.now() });
  } else {
    list.push({ id: id(), identity: null, name: resolvedName, value, ts: Date.now() });
  }

  save();
  io.emit('results-changed', { questionId: qid });
  res.json({ ok: true });
});

/* ---------------------------- admin API ---------------------------- */
app.get('/api/admin/data', requireAdmin, (req, res) => {
  res.json({
    title: data.title,
    questions: data.questions,
    staff: data.staff,
    state: data.state,
    counts: Object.fromEntries(data.questions.map(q => [q.id, (data.responses[q.id] || []).length]))
  });
});

app.put('/api/admin/title', requireAdmin, (req, res) => {
  data.title = String((req.body && req.body.title) || '').slice(0, 120) || data.title;
  save(); io.emit('state-changed');
  res.json({ ok: true, title: data.title });
});

app.post('/api/admin/questions', requireAdmin, (req, res) => {
  const { type, text, options, scaleMax } = req.body || {};
  if (!['mc', 'words', 'text', 'rating'].includes(type))
    return res.status(400).json({ error: 'Bad type' });
  const q = { id: id(), type, text: String(text || '').slice(0, 300) };
  if (type === 'mc') {
    q.options = (options || []).filter(t => String(t).trim())
      .map(t => ({ id: id(), text: String(t).slice(0, 160) }));
    if (q.options.length < 2) return res.status(400).json({ error: 'Need at least 2 options' });
  }
  if (type === 'rating') q.scaleMax = Math.min(10, Math.max(2, parseInt(scaleMax, 10) || 5));
  data.questions.push(q);
  save(); io.emit('state-changed');
  res.json(q);
});

app.put('/api/admin/questions/:qid', requireAdmin, (req, res) => {
  const q = data.questions.find(x => x.id === req.params.qid);
  if (!q) return res.status(404).json({ error: 'Not found' });
  const { text, options, scaleMax } = req.body || {};
  if (text !== undefined) q.text = String(text).slice(0, 300);
  if (q.type === 'mc' && options) {
    q.options = options.filter(t => String(t).trim())
      .map(t => ({ id: id(), text: String(t).slice(0, 160) }));
  }
  if (q.type === 'rating' && scaleMax) q.scaleMax = Math.min(10, Math.max(2, parseInt(scaleMax, 10) || 5));
  save(); io.emit('state-changed');
  res.json(q);
});

app.delete('/api/admin/questions/:qid', requireAdmin, (req, res) => {
  data.questions = data.questions.filter(x => x.id !== req.params.qid);
  delete data.responses[req.params.qid];
  if (data.state.activeQuestionId === req.params.qid) {
    data.state.activeQuestionId = null; data.state.accepting = false;
  }
  save(); io.emit('state-changed');
  res.json({ ok: true });
});

app.post('/api/admin/staff', requireAdmin, (req, res) => {
  const name = String((req.body && req.body.name) || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const s = { id: id(), name };
  data.staff.push(s);
  save(); io.emit('state-changed');
  res.json(s);
});

app.delete('/api/admin/staff/:sid', requireAdmin, (req, res) => {
  data.staff = data.staff.filter(x => x.id !== req.params.sid);
  save(); io.emit('state-changed');
  res.json({ ok: true });
});

// Set which question is live and whether answers are accepted.
app.post('/api/admin/control', requireAdmin, (req, res) => {
  const { activeQuestionId, accepting } = req.body || {};
  if (activeQuestionId !== undefined) {
    data.state.activeQuestionId = activeQuestionId || null;
  }
  if (accepting !== undefined) data.state.accepting = !!accepting;
  save();
  io.emit('state-changed');
  res.json(data.state);
});

// Clear all responses for a question.
app.post('/api/admin/reset/:qid', requireAdmin, (req, res) => {
  data.responses[req.params.qid] = [];
  save();
  io.emit('results-changed', { questionId: req.params.qid });
  res.json({ ok: true });
});

/* ------------------------------ pages ------------------------------ */
const page = f => (req, res) => res.sendFile(path.join(__dirname, f));
app.get('/', page('admin.html'));
app.get('/admin', page('admin.html'));
app.get('/present', page('present.html'));
app.get('/form', page('form.html'));

io.on('connection', () => { /* clients just listen for broadcasts */ });

load();
server.listen(PORT, () => {
  console.log(`Pharma Pulse running on http://localhost:${PORT}`);
  console.log(`Admin password: ${ADMIN_PASS === 'pharmacy123' ? 'pharmacy123 (default — change ADMIN_PASS!)' : '(set via env)'}`);
});
