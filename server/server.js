// Сервер «МВД предупреждает»: раздаёт сайт, хранит подписчиков и новости,
// каждую новую новость сразу отправляет push-уведомлением всем подписчикам.
const express = require('express');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 80;
const DATA = process.env.DATA_DIR || '/data';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin2026';
const TZ = process.env.TZ_NAME || 'Europe/Moscow'; // Новороссийск живёт по московскому времени
const ROOT = path.join(__dirname, '..');

fs.mkdirSync(DATA, { recursive: true });

/* ---------- хранилище (файл JSON в /data) ---------- */
const DBF = path.join(DATA, 'db.json');
let db = { subs: [], news: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DBF, 'utf8'))); } catch (e) {}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DBF + '.tmp', JSON.stringify(db));
    fs.renameSync(DBF + '.tmp', DBF);
  }, 200);
}

/* ---------- ключи VAPID: создаются один раз и живут в /data ---------- */
const VF = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(VF, 'utf8')); } catch (e) {
  vapid = webpush.generateVAPIDKeys();
  fs.writeFileSync(VF, JSON.stringify(vapid));
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:noreply@example.com', vapid.publicKey, vapid.privateKey);

/* ---------- время ---------- */
const hhmm = (d = new Date()) => new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

/* ---------- отправка ---------- */
const latestNews = () => db.news.filter(n => !n.status || n.status === 'pub')
  .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.ts || 0) - (a.ts || 0))[0];

async function sendTo(sub, payload) {
  if (!sub.subscription) return false;
  try {
    await webpush.sendNotification(sub.subscription, JSON.stringify(payload), { TTL: 6 * 3600 });
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) { sub.subscription = null; save(); } // подписка больше не действует
    console.error('push error', sub.id, e.statusCode || e.message);
    return false;
  }
}
const newsPayload = n => ({ title: '⚠ МВД предупреждает', body: n.title, url: './index.html#news/' + n.id, tag: 'news-' + n.id });

// Каждая новая опубликованная новость сразу уходит всем подписчикам
async function sendAll(n) {
  let sent = 0, total = 0;
  for (const s of db.subs) if (s.push !== false && s.subscription) { total++; if (await sendTo(s, newsPayload(n))) sent++; }
  console.log('push', n.id, sent + '/' + total);
  return { sent, total };
}

// Раз в 30 секунд: запланированные материалы, время которых пришло, публикуем и рассылаем
setInterval(async () => {
  const now = Date.now();
  for (const n of db.news) if (n.status === 'scheduled' && n.publishAt && Date.parse(n.publishAt) <= now) {
    n.status = 'pub'; n.ts = Date.parse(n.publishAt); n.date = ymd(new Date(n.publishAt)); save();
    if (n.type === 'news' || n.text) await sendAll(n);
  }
}, 30 * 1000);

/* ---------- API ---------- */
const app = express();
app.use(express.json({ limit: '15mb' }));
const isAdmin = req => String(req.get('x-admin-login') || '').trim().toLowerCase() === ADMIN_LOGIN.toLowerCase() && String(req.get('x-admin-pass') || '').trim() === ADMIN_PASS;
const admin = (req, res, next) => isAdmin(req) ? next() : res.status(401).json({ error: 'auth' });
const normPh = p => String(p || '').replace(/\D/g, '').slice(-10);
const clean = s => { const { subscription, ...rest } = s; return { ...rest, hasPush: !!subscription }; };

app.get('/api/health', (req, res) => res.json({ ok: true, time: hhmm(), subs: db.subs.length }));
app.get('/api/vapid', (req, res) => res.json({ key: vapid.publicKey }));

// подписчик: регистрация, настройки, подписка браузера
app.post('/api/subscribe', (req, res) => {
  const b = req.body || {};
  if (!b.id || !b.phone) return res.status(400).json({ error: 'id/phone' });
  const ph = normPh(b.phone);
  let s = db.subs.find(x => x.id === b.id) || db.subs.find(x => normPh(x.phone) === ph);
  if (!s) { s = { id: b.id, date: ymd() }; db.subs.push(s); }
  for (const k of ['name', 'birth', 'phone', 'district', 'time', 'push']) if (b[k] !== undefined) s[k] = b[k];
  if (b.subscription && b.subscription.endpoint) s.subscription = b.subscription;
  save();
  res.json({ ok: true, id: s.id, hasPush: !!s.subscription });
});
app.post('/api/login', (req, res) => {
  const ph = normPh((req.body || {}).phone);
  const s = ph.length === 10 && db.subs.find(x => normPh(x.phone) === ph);
  s ? res.json(clean(s)) : res.status(404).json({ error: 'not found' });
});
app.post('/api/test-push', async (req, res) => {
  const s = db.subs.find(x => x.id === (req.body || {}).id);
  const n = latestNews();
  if (!s || !n) return res.status(404).json({ error: 'not found' });
  res.json({ ok: await sendTo(s, newsPayload(n)) });
});

// новости
app.get('/api/news', (req, res) => res.json(db.news.filter(n => !n.status || n.status === 'pub')));
app.post('/api/admin/login', (req, res) => res.json({ ok: isAdmin(req) }));
app.get('/api/admin/news', admin, (req, res) => res.json(db.news));
app.put('/api/admin/news', admin, async (req, res) => {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'array' });
  const isPub = n => !n.status || n.status === 'pub';
  const before = new Set(db.news.filter(isPub).map(n => n.id));
  db.news = req.body; save();
  const fresh = db.news.filter(n => isPub(n) && !before.has(n.id) && (n.type === 'news' || n.text));
  const first = before.size === 0; // первая загрузка — не рассылаем старые новости
  let result = null;
  if (!first) for (const n of fresh) result = await sendAll(n);
  res.json({ ok: true, count: db.news.length, sent: result });
});
app.get('/api/admin/subs', admin, (req, res) => res.json(db.subs.map(clean)));
app.delete('/api/admin/subs/:id', admin, (req, res) => { db.subs = db.subs.filter(s => s.id !== req.params.id); save(); res.json({ ok: true }); });
app.post('/api/admin/push-now', admin, async (req, res) => {
  const n = latestNews(); if (!n) return res.status(404).json({ error: 'no news' });
  res.json({ ok: true, ...(await sendAll(n)) });
});

/* ---------- сайт ---------- */
app.use(['/server', '/.git', '/Dockerfile', '/amvera.yml'], (req, res) => res.sendStatus(404));
app.use(express.static(ROOT, { index: 'index.html', extensions: ['html'] }));

app.listen(PORT, () => console.log(`МВД предупреждает: порт ${PORT}, данные ${DATA}, время ${hhmm()} (${TZ})`));
