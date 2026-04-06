const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const DEFAULT_ITEMS = ["Чашка", "Ключи", "Телефон", "Ручка", "Монета"];

// Простое хранение сессий в памяти (для теста)
const userSessions = new Map(); // token -> userId
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
          adminUser: 'admin',
          adminPass: 'admin123',
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

function getUserIdByViewerSlug(slug) {
  const entry = Object.entries(store.users).find(([, u]) => u.viewerSlug === slug);
  return entry ? entry[0] : null;
}

function isValidSlug(s) {
  return typeof s === 'string' && /^[a-zA-Z0-9_-]{3,32}$/.test(s);
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

function requireUserAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies.user_auth;
  const adminSlug = req.params.adminSlug;
  const userId = getUserIdByAdminSlug(adminSlug);
  if (!token || !userId) return res.status(401).json({ ok: false });
  const mapped = userSessions.get(token);
  if (mapped !== userId) return res.status(401).json({ ok: false });
  next();
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

// ===== HTML routes =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/u/:viewerSlug', (req, res) => {
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
  res.json({ item: user ? user.lastItem : null });
});

app.get('/api/u/:viewerSlug/getItems', (req, res) => {
  const user = getUserByViewerSlug(req.params.viewerSlug) || store.users.default;
  res.json({ items: user ? user.items : DEFAULT_ITEMS });
});

// ===== API: admin =====
app.post('/api/a/:adminSlug/login', (req, res) => {
  const user = getUserByAdminSlug(req.params.adminSlug);
  if (!user) return res.status(404).json({ ok: false });

  const { username, password } = req.body || {};
  if (username !== user.adminUser || password !== user.adminPass) {
    return res.status(401).json({ ok: false });
  }

  const token = issueToken();
  const userId = getUserIdByAdminSlug(req.params.adminSlug);
  userSessions.set(token, userId);
  res.setHeader('Set-Cookie', `user_auth=${token}; Path=/; HttpOnly`);
  res.json({ ok: true });
});

app.post('/api/a/:adminSlug/command', requireUserAuth, (req, res) => {
  const userId = getUserIdByAdminSlug(req.params.adminSlug);
  const user = store.users[userId];
  const item = Number(req.body && req.body.item);
  if (!Number.isInteger(item) || item < 1 || item > 5) {
    return res.status(400).json({ ok: false, error: 'item должен быть от 1 до 5' });
  }
  user.lastItem = item;
  saveUsers(store);
  res.json({ ok: true });
});

app.post('/api/a/:adminSlug/reset', requireUserAuth, (req, res) => {
  const userId = getUserIdByAdminSlug(req.params.adminSlug);
  const user = store.users[userId];
  user.lastItem = null;
  saveUsers(store);
  res.json({ ok: true });
});

app.get('/api/a/:adminSlug/getItems', requireUserAuth, (req, res) => {
  const userId = getUserIdByAdminSlug(req.params.adminSlug);
  const user = store.users[userId];
  res.json({ items: user.items });
});

app.post('/api/a/:adminSlug/setItems', requireUserAuth, (req, res) => {
  const userId = getUserIdByAdminSlug(req.params.adminSlug);
  const user = store.users[userId];
  const next = req.body && req.body.items;
  if (!Array.isArray(next) || next.length !== 5) {
    return res.status(400).json({ ok: false, error: 'Нужно 5 предметов' });
  }
  user.items = next.map((v, i) => String(v || DEFAULT_ITEMS[i]).trim() || DEFAULT_ITEMS[i]);
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
    adminUser: u.adminUser,
    items: u.items,
  }));
  res.json({ ok: true, users: list });
});

app.post('/api/master/create-user', requireMasterAuth, (req, res) => {
  const { viewerSlug, adminSlug, adminUser, adminPass, items } = req.body || {};

  if (!isValidSlug(viewerSlug) || !isValidSlug(adminSlug)) {
    return res.status(400).json({ ok: false, error: 'Некорректный slug' });
  }
  if (!adminUser || !adminPass) {
    return res.status(400).json({ ok: false, error: 'Нужны логин и пароль' });
  }

  if (getUserByViewerSlug(viewerSlug) || getUserByAdminSlug(adminSlug)) {
    return res.status(400).json({ ok: false, error: 'Slug уже занят' });
  }

  const userId = viewerSlug;
  store.users[userId] = {
    viewerSlug,
    adminSlug,
    adminUser,
    adminPass,
    items: Array.isArray(items) && items.length === 5 ? items : [...DEFAULT_ITEMS],
    lastItem: null,
  };

  saveUsers(store);
  res.json({ ok: true, userId });
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
