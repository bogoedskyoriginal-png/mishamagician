<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

session_start();

$DATA_DIR = __DIR__ . '/data';
$USERS_FILE = $DATA_DIR . '/users.json';
$GENERATED_FILE = $DATA_DIR . '/generated.json';

$DEFAULT_ITEMS = ["Чашка", "Ключи", "Телефон", "Ручка", "Монета"];
$MAX_ITEMS = 20;
$RESERVED_SLUGS = ['a', 'master', 'admin.html', 'index.html', 'u'];
$MASTER_USER = 'nerycrp';
$MASTER_PASS = '0f73AdZzDqZZp';

function ensureDataDir($dir) {
  if (!is_dir($dir)) {
    mkdir($dir, 0777, true);
  }
}

function loadUsers($file, $defaultItems, $masterUser, $masterPass) {
  if (!file_exists($file)) {
    $initial = [
      'master' => ['username' => $masterUser, 'password' => $masterPass],
      'users' => [
        'default' => [
          'viewerSlug' => 'default',
          'adminSlug' => 'default',
          'items' => $defaultItems,
          'lastItem' => null,
          'lastItemAt' => 0,
        ],
      ],
    ];
    file_put_contents($file, json_encode($initial, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    return $initial;
  }
  $raw = file_get_contents($file);
  $parsed = json_decode($raw, true);
  if (!is_array($parsed)) {
    return ['master' => ['username' => $masterUser, 'password' => $masterPass], 'users' => []];
  }
  if (!isset($parsed['users']) || !is_array($parsed['users'])) {
    $parsed['users'] = [];
  }
  if (!isset($parsed['master']) || !is_array($parsed['master'])) {
    $parsed['master'] = ['username' => $masterUser, 'password' => $masterPass];
  } else {
    $oldUser = $parsed['master']['username'] ?? '';
    $oldPass = $parsed['master']['password'] ?? '';
    if ($oldUser === 'master' && $oldPass === 'master123') {
      $parsed['master']['username'] = $masterUser;
      $parsed['master']['password'] = $masterPass;
      saveUsers($file, $parsed);
    }
  }
  return $parsed;
}

function saveUsers($file, $data) {
  file_put_contents($file, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
}

function loadGenerated($file, $store) {
  $set = [];
  if (file_exists($file)) {
    $raw = file_get_contents($file);
    $parsed = json_decode($raw, true);
    if (is_array($parsed) && isset($parsed['slugs']) && is_array($parsed['slugs'])) {
      foreach ($parsed['slugs'] as $s) $set[(string)$s] = true;
    }
  }
  if (isset($store['users']) && is_array($store['users'])) {
    foreach ($store['users'] as $u) {
      if (!empty($u['viewerSlug'])) $set[(string)$u['viewerSlug']] = true;
      if (!empty($u['adminSlug'])) $set[(string)$u['adminSlug']] = true;
    }
  }
  return $set;
}

function saveGenerated($file, $set) {
  $list = array_keys($set);
  file_put_contents($file, json_encode(['slugs' => $list], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
}

function readJsonBody() {
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $data = json_decode($raw, true);
  return is_array($data) ? $data : [];
}

function isValidSlug($s) {
  return is_string($s) && preg_match('/^[a-z0-9_-]{1,32}$/i', $s);
}

function normalizeItems($list, $max) {
  if (!is_array($list)) return null;
  $trimmed = [];
  foreach ($list as $v) {
    $t = trim((string)$v);
    if ($t !== '') $trimmed[] = $t;
  }
  if (count($trimmed) < 1) return null;
  return array_slice($trimmed, 0, $max);
}

function getUserByViewerSlug($store, $slug) {
  foreach ($store['users'] as $u) {
    if ($u['viewerSlug'] === $slug) return $u;
  }
  return null;
}

function getUserByAdminSlug($store, $slug) {
  foreach ($store['users'] as $u) {
    if ($u['adminSlug'] === $slug) return $u;
  }
  return null;
}

function getUserIdByAdminSlug($store, $slug) {
  foreach ($store['users'] as $id => $u) {
    if ($u['adminSlug'] === $slug) return $id;
  }
  return null;
}

function slugExists($store, $generatedSet, $slug) {
  return getUserByViewerSlug($store, $slug) !== null || getUserByAdminSlug($store, $slug) !== null || isset($generatedSet[$slug]);
}

function generateSlug($length, $generatedSet, $store, $reserved) {
  $len = max(1, min(5, (int)$length));
  $letters = 'abcdefghijklmnopqrstuvwxyz';
  $digits = '0123456789';
  $charset = $letters . $digits;
  $maxCombos = pow(strlen($charset), $len);
  if (count($generatedSet) >= $maxCombos) return null;

  for ($i = 0; $i < 1000; $i++) {
    $out = '';
    for ($j = 0; $j < $len; $j++) {
      $out .= $charset[random_int(0, strlen($charset) - 1)];
    }
    if (in_array($out, $reserved, true)) continue;
    if (!slugExists($store, $generatedSet, $out)) return $out;
  }
  return null;
}

ensureDataDir($DATA_DIR);
$store = loadUsers($USERS_FILE, $DEFAULT_ITEMS, $MASTER_USER, $MASTER_PASS);
$changed = false;
foreach ($store['users'] as $uid => $u) {
  if (!isset($store['users'][$uid]['lastItemAt'])) {
    $store['users'][$uid]['lastItemAt'] = 0;
    $changed = true;
  }
}
if ($changed) {
  saveUsers($USERS_FILE, $store);
}
$generated = loadGenerated($GENERATED_FILE, $store);
saveGenerated($GENERATED_FILE, $generated);

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$body = readJsonBody();

function requireMaster() {
  if (empty($_SESSION['master_auth'])) {
    http_response_code(401);
    echo json_encode(['ok' => false]);
    exit;
  }
}

switch ($action) {
  case 'viewer_get_item': {
    $slug = strtolower(trim((string)($_GET['viewerSlug'] ?? 'default')));
    $user = getUserByViewerSlug($store, $slug);
    if (!$user) { http_response_code(404); echo json_encode(['ok' => false, 'error' => 'Slug not found']); break; }
    $item = $user ? $user['lastItem'] : null;
    $itemAt = $user && isset($user['lastItemAt']) ? (int)$user['lastItemAt'] : 0;
    if ($item !== null && $itemAt <= 0) {
      $item = null;
    }
    if ($user && $item !== null) {
      $id = null;
      foreach ($store['users'] as $uid => $u) {
        if ($u['viewerSlug'] === $user['viewerSlug']) { $id = $uid; break; }
      }
      if ($id !== null) {
        $store['users'][$id]['lastItem'] = null;
        $store['users'][$id]['lastItemAt'] = 0;
        saveUsers($USERS_FILE, $store);
      }
    } elseif ($user && $item === null) {
      $id = null;
      foreach ($store['users'] as $uid => $u) {
        if ($u['viewerSlug'] === $user['viewerSlug']) { $id = $uid; break; }
      }
      if ($id !== null && (!isset($store['users'][$id]['lastItemAt']) || $store['users'][$id]['lastItemAt'] > 0)) {
        $store['users'][$id]['lastItemAt'] = 0;
        saveUsers($USERS_FILE, $store);
      }
    }
    echo json_encode(['item' => $item]);
    break;
  }
  case 'viewer_init': {
    $slug = strtolower(trim((string)($_GET['viewerSlug'] ?? 'default')));
    $user = getUserByViewerSlug($store, $slug);
    if (!$user) { http_response_code(404); echo json_encode(['ok' => false, 'error' => 'Slug not found']); break; }
    $id = null;
    foreach ($store['users'] as $uid => $u) {
      if ($u['viewerSlug'] === $user['viewerSlug']) { $id = $uid; break; }
    }
    if ($id !== null) {
      $store['users'][$id]['lastItem'] = null;
      $store['users'][$id]['lastItemAt'] = 0;
      saveUsers($USERS_FILE, $store);
    }
    echo json_encode(['ok' => true]);
    break;
  }
  case 'viewer_get_items': {
    $slug = strtolower(trim((string)($_GET['viewerSlug'] ?? 'default')));
    $user = getUserByViewerSlug($store, $slug);
    if (!$user) { http_response_code(404); echo json_encode(['ok' => false, 'error' => 'Slug not found']); break; }
    $items = $user['items'];
    echo json_encode(['items' => $items]);
    break;
  }
  case 'admin_command': {
    $slug = strtolower(trim((string)($_GET['adminSlug'] ?? '')));
    $userId = getUserIdByAdminSlug($store, $slug);
    if ($userId === null) { http_response_code(404); echo json_encode(['ok' => false]); break; }
    $user = $store['users'][$userId];
    $item = (int)($body['item'] ?? 0);
    $max = is_array($user['items']) && count($user['items']) ? count($user['items']) : count($DEFAULT_ITEMS);
    if ($item < 1) { http_response_code(400); echo json_encode(['ok' => false, 'error' => "item должен быть от 1 до $max"]); break; }
    if ($item > $max) $item = $max;
    $store['users'][$userId]['lastItem'] = $item;
    $store['users'][$userId]['lastItemAt'] = time();
    saveUsers($USERS_FILE, $store);
    echo json_encode(['ok' => true]);
    break;
  }
  case 'admin_reset': {
    $slug = strtolower(trim((string)($_GET['adminSlug'] ?? '')));
    $userId = getUserIdByAdminSlug($store, $slug);
    if ($userId === null) { http_response_code(404); echo json_encode(['ok' => false]); break; }
    $store['users'][$userId]['lastItem'] = null;
    $store['users'][$userId]['lastItemAt'] = 0;
    saveUsers($USERS_FILE, $store);
    echo json_encode(['ok' => true]);
    break;
  }
  case 'admin_get_items': {
    $slug = strtolower(trim((string)($_GET['adminSlug'] ?? '')));
    $userId = getUserIdByAdminSlug($store, $slug);
    if ($userId === null) { http_response_code(404); echo json_encode(['ok' => false]); break; }
    echo json_encode(['items' => $store['users'][$userId]['items']]);
    break;
  }
  case 'admin_set_items': {
    $slug = strtolower(trim((string)($_GET['adminSlug'] ?? '')));
    $userId = getUserIdByAdminSlug($store, $slug);
    if ($userId === null) { http_response_code(404); echo json_encode(['ok' => false]); break; }
    $next = normalizeItems($body['items'] ?? null, $MAX_ITEMS);
    if (!$next) { http_response_code(400); echo json_encode(['ok' => false, 'error' => 'Нужно минимум 1 предмет']); break; }
    $store['users'][$userId]['items'] = $next;
    saveUsers($USERS_FILE, $store);
    echo json_encode(['ok' => true]);
    break;
  }
  case 'master_login': {
    $username = (string)($body['username'] ?? '');
    $password = (string)($body['password'] ?? '');
    if ($username !== $store['master']['username'] || $password !== $store['master']['password']) {
      http_response_code(401);
      echo json_encode(['ok' => false]);
      break;
    }
    $_SESSION['master_auth'] = true;
    echo json_encode(['ok' => true]);
    break;
  }
  case 'master_list_users': {
    requireMaster();
    $list = [];
    foreach ($store['users'] as $id => $u) {
      $list[] = [
        'id' => $id,
        'viewerSlug' => $u['viewerSlug'],
        'adminSlug' => $u['adminSlug'],
        'items' => $u['items'],
      ];
    }
    echo json_encode(['ok' => true, 'users' => $list]);
    break;
  }
  case 'master_create_user': {
    requireMaster();
    $viewerSlug = strtolower(trim((string)($body['viewerSlug'] ?? '')));
    if (!isValidSlug($viewerSlug)) { http_response_code(400); echo json_encode(['ok' => false, 'error' => 'Некорректный slug']); break; }
    if (in_array($viewerSlug, $RESERVED_SLUGS, true)) { http_response_code(400); echo json_encode(['ok' => false, 'error' => 'Slug зарезервирован']); break; }
    if (slugExists($store, $generated, $viewerSlug)) { http_response_code(400); echo json_encode(['ok' => false, 'error' => 'Slug уже занят']); break; }
    $store['users'][$viewerSlug] = [
      'viewerSlug' => $viewerSlug,
      'adminSlug' => $viewerSlug,
      'items' => $DEFAULT_ITEMS,
      'lastItem' => null,
      'lastItemAt' => 0,
    ];
    $generated[$viewerSlug] = true;
    saveUsers($USERS_FILE, $store);
    saveGenerated($GENERATED_FILE, $generated);
    echo json_encode(['ok' => true, 'userId' => $viewerSlug]);
    break;
  }
  case 'master_delete_user': {
    requireMaster();
    $id = strtolower(trim((string)($body['id'] ?? '')));
    if ($id === '' || !isset($store['users'][$id])) { http_response_code(404); echo json_encode(['ok' => false]); break; }
    if ($id === 'default') { http_response_code(400); echo json_encode(['ok' => false, 'error' => 'Нельзя удалить default']); break; }
    $viewerSlug = $store['users'][$id]['viewerSlug'] ?? '';
    $adminSlug = $store['users'][$id]['adminSlug'] ?? '';
    unset($store['users'][$id]);
    saveUsers($USERS_FILE, $store);
    if ($viewerSlug !== '') unset($generated[$viewerSlug]);
    if ($adminSlug !== '') unset($generated[$adminSlug]);
    saveGenerated($GENERATED_FILE, $generated);
    echo json_encode(['ok' => true]);
    break;
  }
  case 'master_apply_defaults': {
    requireMaster();
    foreach ($store['users'] as $id => $u) {
      if ($id === 'default') continue;
      $store['users'][$id]['items'] = $DEFAULT_ITEMS;
    }
    saveUsers($USERS_FILE, $store);
    echo json_encode(['ok' => true]);
    break;
  }
  case 'master_generate_slug': {
    requireMaster();
    $slug = generateSlug(5, $generated, $store, $RESERVED_SLUGS);
    if (!$slug) { http_response_code(400); echo json_encode(['ok' => false, 'error' => 'Не удалось сгенерировать slug']); break; }
    $generated[$slug] = true;
    saveGenerated($GENERATED_FILE, $generated);
    echo json_encode(['ok' => true, 'slug' => $slug]);
    break;
  }
  default:
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Unknown action']);
    break;
}
?>
