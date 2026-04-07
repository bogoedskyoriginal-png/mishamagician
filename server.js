const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const GENERATED_FILE = path.join(DATA_DIR, 'generated.json');

const DEFAULT_ITEMS = ["Чашка", "Ключи", "Телефон", "Ручка", "Монета"];
const MAX_ITEMS = 20;

// Простое хранение сессий в памяти (для теста)
const masterSessions = new Set(); // token

app.use(express.json());

// Простейший CORS — разрешаем все источники
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Статические файлы клиента
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) {
    const initial = {
      master: { username: 'master', password: 'master123' },
      users: {
        default: {
          viewerSlug: 'default',
          adminSlug: 'default',
          items: [...DEFAULT_ITEMS],
          lastItem: null,
        },
      },
    };
    fs.writeFileSync(USERS_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.users) parsed.users = {};
    return parsed;
  } catch (err) {
    return { master: { username: 'master', password: 'master123' }, users: {} };
  }
}

function saveUsers(data) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

let store = loadUsers();
let generatedSlugs = new Set();
const RESERVED_SLUGS = new Set(['a', 'master', 'admin.html', 'index.html', 'u']);

function getUserByViewerSlug(slug) {
  return Object.values(store.users).find(u => u.viewerSlug === slug) || null;
}

function getUserByAdminSlug(slug) {
  return Object.values(store.users).find(u => u.adminSlug === slug) || null;
}

function getUserIdByAdminSlug(slug) {
  const entry = Object.entries(store.users).find(([, u]) => u.adminSlug === slug);
  return entry ? entry[0] : null;
}

function isValidSlug(s) {
  return typeof s === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(s);
}

function normalizeItems(list) {
  if (!Array.isArray(list)) return null;
  const trimmed = list
    .map((v) => String(v || '').trim())
    .filter((v) => v.length > 0);
  if (trimmed.length < 1) return null;
  return trimmed.slice(0, MAX_ITEMS);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const pairs = header.split(';').map(v => v.trim()).filter(Boolean);
  const out = {};
  for (const p of pairs) {
    const i = p.indexOf('=');
    if (i === -1) continue;
    out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
  }
  return out;
}

function requireMasterAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies.master_auth;
  if (!token || !masterSessions.has(token)) return res.status(401).json({ ok: false });
  next();
}

function issueToken() {
  return crypto.randomBytes(16).toString('hex');
}

function loadGenerated() {
  ensureDataDir();
  if (!fs.existsSync(GENERATED_FILE)) {
    const seeds = new Set();
    Object.values(store.users).forEach((u) => {
      if (u.viewerSlug) seeds.add(String(u.viewerSlug));
      if (u.adminSlug) seeds.add(String(u.adminSlug));
    });
    fs.writeFileSync(GENERATED_FILE, JSON.stringify({ slugs: Array.from(seeds) }, null, 2));
    return seeds;
  }
  try {
    const raw = fs.readFileSync(GENERATED_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed.slugs) ? parsed.slugs : [];
    const set = new Set(list.map((v) => String(v)));
    Object.values(store.users).forEach((u) => {
      if (u.viewerSlug) set.add(String(u.viewerSlug));
      if (u.adminSlug) set.add(String(u.adminSlug));
    });
    return set;
  } catch (err) {
    return new Set();
  }
}

function saveGenerated() {
  ensureDataDir();
  fs.writeFileSync(GENERATED_FILE, JSON.stringify({ slugs: Array.from(generatedSlugs) }, null, 2));
}

function reserveSlug(slug) {
  if (!slug) return;
  generatedSlugs.add(String(slug));
  saveGenerated();
}

function slugExists(slug) {
  return !!getUserByViewerSlug(slug) || !!getUserByAdminSlug(slug) || generatedSlugs.has(slug);
}

function generateSlug(length, mode) {
  const len = Math.max(1, Math.min(5, Number(length) || 5));
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const charset = mode === 'digits' ? digits : mode === 'letters' ? letters : letters + digits;
  const maxCombos = Math.pow(charset.length, len);
  const usedCount = generatedSlugs.size;
  if (usedCount >= maxCombos) {
    return null;
  }

  for (let i = 0; i < 1000; i += 1) {
    const bytes = crypto.randomBytes(len);
    let out = '';
    for (let j = 0; j < len; j += 1) {
      out += charset[bytes[j] % charset.length];
    }
    if (RESERVED_SLUGS.has(out)) continue;
    if (!slugExists(out)) return out;
  }
  return null;
}

generatedSlugs = loadGenerated();
saveGenerated();

// ===== HTML routes =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/u/:viewerSlug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ЧПУ для зрителя: https://domain.com/SLUG (без /u/)
app.get('/:viewerSlug', (req, res, next) => {
  const slug = req.params.viewerSlug;
  // Резервируем системные пути
  if (RESERVED_SLUGS.has(slug)) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/a/:adminSlug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/master', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'master.html'));
});

// ===== API: viewer =====
app.get('/api/u/:viewerSlug/getItem', (req, res) => {
  const user = getUserByViewerSlug(req.params.viewerSlug) || store.users.default;
  const item = user ? user.lastItem : null;
  // Одноразовое потребление команды, чтобы избежать старых предсказаний
  if (user && item !== null) {
    user.lastItem = null;
    saveUsers(store);
  }
  res.json({ item });
});

app.get('/api/u/:viewerSlug/getItems', (req, res) => {
  const user = getUserByViewerSlug(req.params.viewerSlug) || store.users.default;
  res.json({ items: user ? user.items : DEFAULT_ITEMS });
});

// ===== API: admin (доступ по секретной ссылке /a/SLUG) =====
app.post('/api/a/:adminSlug/command', (req, res) => {
  const userId = getUserIdByAdminSlug(req.params.adminSlug);
  const user = store.users[userId];
  if (!user) return res.status(404).json({ ok: false });

  let item = Number(req.body && req.body.item);
  const max = Array.isArray(user.items) && user.items.length > 0 ? user.items.length : DEFAULT_ITEMS.length;
  if (!Number.isInteger(item) || item < 1) {
    return res.status(400).json({ ok: false, error: `item должен быть от 1 до ${max}` });
  }
  if (item > max) item = max;
  user.lastItem = item;
  saveUsers(store);
  res.json({ ok: true });
});

app.post('/api/a/:adminSlug/reset', (req, res) => {
  const userId = getUserIdByAdminSlug(req.params.adminSlug);
  const user = store.users[userId];
  if (!user) return res.status(404).json({ ok: false });

  user.lastItem = null;
  saveUsers(store);
  res.json({ ok: true });
});

app.get('/api/a/:adminSlug/getItems', (req, res) => {
  const userId = getUserIdByAdminSlug(req.params.adminSlug);
  const user = store.users[userId];
  if (!user) return res.status(404).json({ ok: false });

  res.json({ items: user.items });
});

app.post('/api/a/:adminSlug/setItems', (req, res) => {
  const userId = getUserIdByAdminSlug(req.params.adminSlug);
  const user = store.users[userId];
  if (!user) return res.status(404).json({ ok: false });

  const next = normalizeItems(req.body && req.body.items);
  if (!next) {
    return res.status(400).json({ ok: false, error: 'Нужно минимум 1 предмет' });
  }
  user.items = next;
  saveUsers(store);
  res.json({ ok: true });
});

// ===== API: master =====
app.post('/api/master/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== store.master.username || password !== store.master.password) {
    return res.status(401).json({ ok: false });
  }
  const token = issueToken();
  masterSessions.add(token);
  res.setHeader('Set-Cookie', `master_auth=${token}; Path=/; HttpOnly`);
  res.json({ ok: true });
});

app.get('/api/master/list-users', requireMasterAuth, (req, res) => {
  const list = Object.entries(store.users).map(([id, u]) => ({
    id,
    viewerSlug: u.viewerSlug,
    adminSlug: u.adminSlug,
    items: u.items,
  }));
  res.json({ ok: true, users: list });
});

app.post('/api/master/create-user', requireMasterAuth, (req, res) => {
  const raw = req.body || {};
  const viewerSlug = String(raw.viewerSlug || '').trim().toLowerCase();
  const adminSlug = String(raw.adminSlug || '').trim().toLowerCase();

  if (!isValidSlug(viewerSlug) || !isValidSlug(adminSlug)) {
    return res.status(400).json({ ok: false, error: 'Некорректный slug' });
  }

  if (RESERVED_SLUGS.has(viewerSlug) || RESERVED_SLUGS.has(adminSlug)) {
    return res.status(400).json({ ok: false, error: 'Slug зарезервирован' });
  }

  if (getUserByViewerSlug(viewerSlug) || getUserByAdminSlug(adminSlug)) {
    return res.status(400).json({ ok: false, error: 'Slug уже занят' });
  }

  const userId = viewerSlug;
  store.users[userId] = {
    viewerSlug,
    adminSlug,
    items: [...DEFAULT_ITEMS],
    lastItem: null,
  };

  reserveSlug(viewerSlug);
  reserveSlug(adminSlug);
  saveUsers(store);
  res.json({ ok: true, userId });
});

app.post('/api/master/generate-slug', requireMasterAuth, (req, res) => {
  const { length, mode } = req.body || {};
  const safeMode = mode === 'digits' || mode === 'letters' || mode === 'mixed' ? mode : 'letters';
  const slug = generateSlug(length, safeMode);
  if (!slug) {
    return res.status(400).json({ ok: false, error: 'Не удалось сгенерировать slug' });
  }
  reserveSlug(slug);
  res.json({ ok: true, slug });
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
