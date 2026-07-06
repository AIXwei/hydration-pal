const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } = require('electron');

// 单实例锁：重复启动时退出新实例，把已有实例的主窗口带到前台
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}
app.on('second-instance', () => {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.show();
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

// 禁用 GPU 硬件加速，避免在部分 Windows 环境下渲染失败
app.disableHardwareAcceleration();
const path = require('path');
const fs = require('fs');

// ── 元数据 ────────────────────────────────────────────────────────────────────
const LEVELS = [
  { level: 1, name: '奶猫', xp: 0 },
  { level: 2, name: '小猫', xp: 7 },
  { level: 3, name: '活力猫', xp: 20 },
  { level: 4, name: '猫咪', xp: 40 },
  { level: 5, name: '大猫', xp: 70 },
  { level: 6, name: '猫猫勇士', xp: 110 },
  { level: 7, name: '猫猫大师', xp: 160 },
];
const DRINKS = [
  { id: 'water', name: '水', emoji: '💧', factor: 1 },
  { id: 'tea', name: '茶', emoji: '🍵', factor: 0.9 },
  { id: 'juice', name: '果汁', emoji: '🧃', factor: 0.7 },
  { id: 'milk', name: '牛奶', emoji: '🥛', factor: 1 },
  { id: 'coffee', name: '咖啡', emoji: '☕', factor: 0.5 },
];
const BADGES = [
  { id: 'first_drop', name: '第一滴水', icon: '💧', desc: '首次记录喝水' },
  { id: 'goal_3', name: '达标三连', icon: '🎯', desc: '累计达标3天' },
  { id: 'goal_10', name: '达标大师', icon: '🏆', desc: '累计达标10天' },
  { id: 'week_streak', name: '周冠军', icon: '🌟', desc: '连续7天达标' },
  { id: 'early_bird', name: '早起鸟儿', icon: '🐦', desc: '早上8点前喝水' },
  { id: 'big_gulp', name: '大口喝', icon: '🌊', desc: '单次喝500ml以上' },
  { id: 'hundred_days', name: '百日坚持', icon: '👑', desc: '累计达标100天' },
];

// ── 运行时状态 ────────────────────────────────────────────────────────────────
const DATA_FILE = path.join(app.getPath('userData'), 'data.json');
let data = null;
let snoozeUntil = 0;
let reminderTimer = null;
let mainWin = null;
let floatWin = null;
let tray = null;

// ── 数据 I/O ──────────────────────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtTime(d) {
  return d.toTimeString().slice(0, 5);
}

function defaultData() {
  return {
    settings: {
      dailyGoal: 2000,
      intervalMinutes: 60,
      activeStart: '08:00',
      activeEnd: '22:00',
      cupSizes: [100, 200, 300, 500],
      nickname: '老婆sama',
      edgeSnap: true,
      enableToast: false,
      enableSound: false,
      autoLaunch: false,
    },
    today: { date: todayStr(), total: 0, records: [] },
    history: [],
    stats: { streak: 0, bestStreak: 0, totalAchieved: 0, badges: [] },
  };
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      // merge missing keys
      const def = defaultData();
      if (!data.settings) data.settings = def.settings;
      else Object.keys(def.settings).forEach(k => { if (data.settings[k] === undefined) data.settings[k] = def.settings[k]; });
      if (!data.today) data.today = def.today;
      if (!data.history) data.history = [];
      if (!data.stats) data.stats = def.stats;
    } else {
      data = defaultData();
    }
  } catch { data = defaultData(); }
}

function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8'); } catch {}
}

// ── 日期翻转 ──────────────────────────────────────────────────────────────────
function checkDate() {
  const today = todayStr();
  if (data.today.date !== today) {
    // 归档昨天
    const prev = data.today;
    if (prev.records.length > 0 || prev.total > 0) {
      data.history.push({ date: prev.date, total: prev.total, goal: data.settings.dailyGoal });
      if (data.history.length > 365) data.history.shift();
    }
    updateStreakOnRollover(prev);
    data.today = { date: today, total: 0, records: [] };
    saveData();
  }
}

function updateStreakOnRollover(prev) {
  const reached = prev.total >= data.settings.dailyGoal;
  if (reached) {
    data.stats.streak = (data.stats.streak || 0) + 1;
    data.stats.totalAchieved = (data.stats.totalAchieved || 0) + 1;
    if (data.stats.streak > (data.stats.bestStreak || 0)) data.stats.bestStreak = data.stats.streak;
    checkBadgeCondition('goal_3', data.stats.totalAchieved >= 3);
    checkBadgeCondition('goal_10', data.stats.totalAchieved >= 10);
    checkBadgeCondition('week_streak', data.stats.streak >= 7);
    checkBadgeCondition('hundred_days', data.stats.totalAchieved >= 100);
  } else {
    data.stats.streak = 0;
  }
}

// ── 猫咪成长 ──────────────────────────────────────────────────────────────────
function computeCat() {
  const xp = data.stats.totalAchieved || 0;
  let lv = LEVELS[0];
  for (const l of LEVELS) { if (xp >= l.xp) lv = l; else break; }
  const idx = LEVELS.indexOf(lv);
  const next = LEVELS[idx + 1];
  const progress = next ? (xp - lv.xp) / (next.xp - lv.xp) : 1;
  const accessories = ['bow', 'hat', 'scarf', 'crown', 'wings'];
  const accessory = lv.level >= 3 ? accessories[Math.min(lv.level - 3, accessories.length - 1)] : null;
  return { level: lv.level, name: lv.name, accessory, progress, nextName: next ? next.name : null };
}

// ── 成就检查 ──────────────────────────────────────────────────────────────────
function checkBadgeCondition(id, cond) {
  if (cond && !(data.stats.badges || []).includes(id)) {
    data.stats.badges = data.stats.badges || [];
    data.stats.badges.push(id);
    const b = BADGES.find(x => x.id === id);
    if (b) broadcast('reminder', { type: 'badge', text: '解锁勋章：' + b.name + ' ' + b.icon });
  }
}

function checkAchievements() {
  const recs = data.today.records;
  checkBadgeCondition('first_drop', recs.length >= 1);
  if (recs.length > 0) {
    const last = recs[recs.length - 1];
    checkBadgeCondition('big_gulp', last.ml >= 500);
    const h = new Date().getHours();
    if (h < 8) checkBadgeCondition('early_bird', true);
  }
  const prev = data.today.total - ((recs[recs.length - 1] || {}).ml || 0);
  const goal = data.settings.dailyGoal;
  if (prev < goal && data.today.total >= goal) {
    broadcast('reminder', { type: 'celebrate', text: '🎉 今天达标啦！猫猫超开心！' });
  }
}

// ── 全量状态 ──────────────────────────────────────────────────────────────────
function getFullState() {
  checkDate();
  return {
    ...data,
    _cat: computeCat(),
    _snoozeUntil: snoozeUntil,
    _now: Date.now(),
    _meta: { badges: BADGES, drinks: DRINKS, levels: LEVELS },
  };
}

// ── 广播 ──────────────────────────────────────────────────────────────────────
function broadcast(channel, payload) {
  [mainWin, floatWin].forEach(w => {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  });
}

function broadcastState() {
  broadcast('stateChanged', getFullState());
}

// ── 提醒定时器 ────────────────────────────────────────────────────────────────
function startTimer() {
  if (reminderTimer) clearInterval(reminderTimer);
  const ms = Math.max(10, data.settings.intervalMinutes || 60) * 60 * 1000;
  reminderTimer = setInterval(() => {
    if (snoozeUntil && Date.now() < snoozeUntil) return;
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = (data.settings.activeStart || '08:00').split(':').map(Number);
    const [eh, em] = (data.settings.activeEnd || '22:00').split(':').map(Number);
    if (mins < sh * 60 + sm || mins > eh * 60 + em) return;
    const nick = data.settings.nickname || '老婆sama';
    const left = Math.max(0, data.settings.dailyGoal - data.today.total);
    const text = left > 0
      ? `${nick}，该喝水啦 💧\n还差 ${left}ml 达标`
      : `${nick}，今天已经达标啦 🎉`;
    broadcast('reminder', { type: 'reminder', text });
  }, ms);
}

// ── IPC 处理器 ────────────────────────────────────────────────────────────────
ipcMain.handle('get-state', () => getFullState());

ipcMain.handle('add-water', (_, ml, type) => {
  checkDate();
  ml = Math.max(1, Math.min(9999, parseInt(ml) || 0));
  const record = { id: Date.now(), ml, type: type || 'water', time: fmtTime(new Date()) };
  data.today.total += ml;
  data.today.records.push(record);
  checkAchievements();
  saveData();
  broadcastState();
  return getFullState();
});

ipcMain.handle('delete-record', (_, id) => {
  const idx = data.today.records.findIndex(r => r.id === id);
  if (idx >= 0) {
    data.today.total = Math.max(0, data.today.total - data.today.records[idx].ml);
    data.today.records.splice(idx, 1);
    saveData();
    broadcastState();
  }
  return getFullState();
});

ipcMain.handle('undo-last', () => {
  if (data.today.records.length > 0) {
    const last = data.today.records.pop();
    data.today.total = Math.max(0, data.today.total - last.ml);
    saveData();
    broadcastState();
  }
  return getFullState();
});

// 应用开机自启设置到系统
function applyAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    args: [],
  });
}

ipcMain.handle('update-settings', (_, obj) => {
  const prev = data.settings.intervalMinutes;
  const prevAuto = data.settings.autoLaunch;
  data.settings = { ...data.settings, ...obj };
  if (obj.cupSizes) data.settings.cupSizes = obj.cupSizes.slice(0, 5);
  saveData();
  if (data.settings.intervalMinutes !== prev) startTimer();
  if (data.settings.autoLaunch !== prevAuto) applyAutoLaunch(data.settings.autoLaunch);
  broadcastState();
  return getFullState();
});

ipcMain.handle('resume', () => {
  snoozeUntil = 0;
  broadcastState();
  return getFullState();
});

ipcMain.handle('open-main', () => {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.show();
    mainWin.focus();
  }
  return true;
});

// 自定义窗口控制（无边框窗口）
ipcMain.handle('win-minimize', () => { if (mainWin) mainWin.minimize(); });
ipcMain.handle('win-maximize', () => {
  if (!mainWin) return;
  if (mainWin.isMaximized()) mainWin.unmaximize();
  else mainWin.maximize();
});
ipcMain.handle('win-close', () => { if (mainWin) mainWin.hide(); });

// ── 创建窗口 ──────────────────────────────────────────────────────────────────
function createFloatWin() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  floatWin = new BrowserWindow({
    width: 170, height: 260,
    x: width - 190, y: Math.floor(height / 2) - 130,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  floatWin.loadFile(path.join(__dirname, 'floating.html'));
  floatWin.setIgnoreMouseEvents(false);
}

function createMainWin() {
  mainWin = new BrowserWindow({
    width: 420, height: 650,
    minWidth: 380, minHeight: 560,
    show: true,
    autoHideMenuBar: true,
    title: ' ',
    backgroundColor: '#fdeef7',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  mainWin.loadFile(path.join(__dirname, 'index.html'));
  mainWin.on('close', (e) => { e.preventDefault(); mainWin.hide(); });
}

function createTray() {
  let icon;
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } else {
    // 16×16 粉色占位图标
    const buf = Buffer.alloc(16 * 16 * 4);
    for (let i = 0; i < buf.length; i += 4) { buf[i] = 255; buf[i+1] = 107; buf[i+2] = 157; buf[i+3] = 255; }
    icon = nativeImage.createFromBuffer(buf, { width: 16, height: 16 });
  }
  tray = new Tray(icon);
  tray.setToolTip('喝水提醒猫');
  const ctx = Menu.buildFromTemplate([
    { label: '打开主界面', click: () => { mainWin.show(); mainWin.focus(); } },
    { label: '暂停提醒(1小时)', click: () => { snoozeUntil = Date.now() + 3600000; broadcastState(); } },
    { type: 'separator' },
    { label: '退出', click: () => { app.exit(0); } },
  ]);
  tray.setContextMenu(ctx);
  tray.on('click', () => { mainWin.show(); mainWin.focus(); });
}

// ── 启动 ──────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  loadData();
  checkDate();
  applyAutoLaunch(data.settings.autoLaunch);
  createMainWin();
  createFloatWin();
  createTray();
  startTimer();

  // 主窗口就绪后置顶一次，确保可见
  mainWin.once('ready-to-show', () => { mainWin.focus(); });
});

app.on('window-all-closed', () => { /* 保持后台运行 */ });
app.on('activate', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });
