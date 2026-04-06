const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'current.txt');
const ITEMS_FILE = path.join(__dirname, 'items.json');

const DEFAULT_ITEMS = ["Чашка", "Ключи", "Телефон", "Ручка", "Монета"];

// Храним последний выбранный предмет в памяти
let lastItem = null;

// Текущие названия предметов
let items = [...DEFAULT_ITEMS];

// Пытаемся восстановить значение из файла при старте
try {
  if (fs.existsSync(DATA_FILE)) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8').trim();
    const num = Number(raw);
    if (Number.isInteger(num) && num >= 1 && num <= 5) {
      lastItem = num;
    }
  }
} catch (err) {
  // Ошибки чтения не критичны — просто стартуем с null
}

// Пытаемся восстановить список предметов
try {
  if (fs.existsSync(ITEMS_FILE)) {
    const raw = fs.readFileSync(ITEMS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 5) {
      items = parsed.map((v, i) => String(v || DEFAULT_ITEMS[i]));
    }
  }
} catch (err) {
  // Ошибки чтения не критичны — используем дефолт
}

// Простейший CORS — разрешаем все источники
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Статические файлы клиента
app.use(express.static(path.join(__dirname, 'public')));

// Приём команды от админ-панели
app.get('/command', (req, res) => {
  const item = Number(req.query.item);
  if (!Number.isInteger(item) || item < 1 || item > 5) {
    return res.status(400).json({ ok: false, error: 'item должен быть от 1 до 5' });
  }

  lastItem = item;

  // Пишем в файл на случай перезапуска
  fs.writeFile(DATA_FILE, String(item), (err) => {
    if (err) {
      // Ошибка записи не блокирует ответ
      return res.json({ ok: true, saved: false });
    }
    return res.json({ ok: true, saved: true });
  });
});

// Обновление списка предметов (из админки)
// Пример: /setItems?i1=Чашка&i2=Ключи&i3=Телефон&i4=Ручка&i5=Монета
app.get('/setItems', (req, res) => {
  const next = [
    req.query.i1,
    req.query.i2,
    req.query.i3,
    req.query.i4,
    req.query.i5,
  ].map((v, i) => String(v || DEFAULT_ITEMS[i]).trim() || DEFAULT_ITEMS[i]);

  if (next.length !== 5) {
    return res.status(400).json({ ok: false, error: 'Нужно 5 предметов' });
  }

  items = next;

  fs.writeFile(ITEMS_FILE, JSON.stringify(items, null, 2), (err) => {
    if (err) {
      return res.json({ ok: true, saved: false });
    }
    return res.json({ ok: true, saved: true });
  });
});

// Сброс команды — зритель возвращается в ожидание
app.get('/reset', (req, res) => {
  lastItem = null;
  fs.writeFile(DATA_FILE, '', (err) => {
    if (err) {
      return res.json({ ok: true, saved: false });
    }
    return res.json({ ok: true, saved: true });
  });
});

// Отдаём текущий предмет для зрителя
app.get('/getItem', (req, res) => {
  res.json({ item: lastItem });
});

// Отдаём список предметов
app.get('/getItems', (req, res) => {
  res.json({ items });
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
