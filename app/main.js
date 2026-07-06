const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, Notification } = require('electron');

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
let quitting = false;
app.on('before-quit', () => { quitting = true; });

// ── 数据 I/O ──────────────────────────────────────────────────────────────────
// 本地时区日期（不能用 toISOString：UTC+8 下 0-8 点会返回昨天）
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
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
      // records 类型清洗：防手工编辑/损坏文件把非法值带进渲染层
      data.today.records = (Array.isArray(data.today.records) ? data.today.records : []).map(r => ({
        id: r.id,
        ml: Math.max(0, Number(r.ml) || 0),
        type: typeof r.type === 'string' ? r.type : 'water',
        time: typeof r.time === 'string' ? r.time.slice(0, 5) : '',
      }));
    } else {
      data = defaultData();
    }
  } catch (e) {
    console.error('loadData failed, backing up corrupt file:', e);
    try {
      if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, DATA_FILE + '.corrupt-' + Date.now());
    } catch (e2) { console.error('backup corrupt file failed:', e2); }
    data = defaultData();
  }
}

// 原子写：先写临时文件再 rename，避免写一半崩溃留下半截 JSON
function saveData() {
  try {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { console.error('saveData failed:', e); }
}

// ── 日期翻转 ──────────────────────────────────────────────────────────────────
// 返回是否发生了翻转，调用方据此决定要不要广播
function checkDate() {
  const today = todayStr();
  if (data.today.date === today) return false;
  // 归档昨天
  const prev = data.today;
  if (prev.records.length > 0 || prev.total > 0) {
    data.history.push({ date: prev.date, total: prev.total, goal: data.settings.dailyGoal });
    if (data.history.length > 365) data.history.shift();
  }
  updateStreakOnRollover(prev, today);
  data.today = { date: today, total: 0, records: [] };
  saveData();
  return true;
}

function updateStreakOnRollover(prev, today) {
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
  // 归档日和今天间隔超过1天=中间有整天没喝水，连续中断
  const gapDays = Math.round((new Date(today) - new Date(prev.date)) / 86400000);
  if (gapDays > 1) data.stats.streak = 0;
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
    if (checkDate()) broadcastState(); // 跨日自动翻转，不等用户操作
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
    if (data.settings.enableToast && Notification.isSupported()) {
      new Notification({ title: '喝水小助手 💧', body: text.replace('\n', '，') }).show();
    }
  }, ms);
}

// 跨日翻转不依赖提醒间隔：每分钟轻量检查一次（提醒间隔可长达4小时）
setInterval(() => { if (data && checkDate()) broadcastState(); }, 60000);

// ── IPC 处理器 ────────────────────────────────────────────────────────────────
ipcMain.handle('get-state', () => getFullState());

let recSeq = 0; // 同毫秒连点时保证 id 不撞
ipcMain.handle('add-water', (_, ml, type) => {
  checkDate();
  ml = parseInt(ml, 10);
  if (!Number.isFinite(ml) || ml <= 0) return getFullState(); // 非法值不落记录
  ml = Math.min(9999, ml);
  const record = { id: Date.now() + '-' + (recSeq++), ml, type: typeof type === 'string' ? type : 'water', time: fmtTime(new Date()) };
  data.today.total += ml;
  data.today.records.push(record);
  checkAchievements();
  saveData();
  broadcastState();
  return getFullState();
});

ipcMain.handle('delete-record', (_, id) => {
  checkDate();
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
  checkDate();
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

// 设置白名单校验：渲染端的 clamp 只当 UX，主进程是最后防线
function cleanNum(v, min, max, dft) { v = parseInt(v, 10); return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : dft; }
function cleanTime(v, dft) { return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : dft; }
ipcMain.handle('update-settings', (_, obj) => {
  if (!obj || typeof obj !== 'object') return getFullState();
  const s = data.settings;
  const pick = (k) => obj[k] !== undefined ? obj[k] : s[k];
  const next = {
    dailyGoal: cleanNum(pick('dailyGoal'), 500, 6000, 2000),
    intervalMinutes: cleanNum(pick('intervalMinutes'), 10, 240, 60),
    activeStart: cleanTime(pick('activeStart'), '08:00'),
    activeEnd: cleanTime(pick('activeEnd'), '22:00'),
    cupSizes: (Array.isArray(pick('cupSizes')) ? pick('cupSizes') : [100, 200, 300, 500]).map(x => cleanNum(x, 1, 9999, 100)).slice(0, 5),
    nickname: String(pick('nickname') || '老婆sama').slice(0, 20),
    edgeSnap: !!pick('edgeSnap'),
    enableToast: !!pick('enableToast'),
    enableSound: !!pick('enableSound'),
    autoLaunch: !!pick('autoLaunch'),
  };
  const prevInterval = s.intervalMinutes;
  const prevAuto = s.autoLaunch;
  data.settings = next;
  saveData();
  if (next.intervalMinutes !== prevInterval) startTimer();
  if (next.autoLaunch !== prevAuto) applyAutoLaunch(next.autoLaunch);
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
      nodeIntegration: false,
      sandbox: true,
    },
  });
  floatWin.loadFile(path.join(__dirname, 'floating.html'));
  floatWin.setIgnoreMouseEvents(false);

  // 吸边：拖动结束后靠近屏幕左右边缘（40px内）自动贴边
  floatWin.on('moved', () => {
    if (!data || !data.settings.edgeSnap) return;
    const wa = screen.getPrimaryDisplay().workArea;
    const b = floatWin.getBounds();
    let x = b.x;
    if (b.x - wa.x < 40) x = wa.x;
    else if (wa.x + wa.width - (b.x + b.width) < 40) x = wa.x + wa.width - b.width;
    const y = Math.max(wa.y, Math.min(wa.y + wa.height - b.height, b.y));
    if (x !== b.x || y !== b.y) floatWin.setBounds({ ...b, x, y });
  });
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
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWin.loadFile(path.join(__dirname, 'index.html'));
  // 平时关窗=隐藏后台；系统关机/注销（before-quit）时放行，避免被判无响应
  mainWin.on('close', (e) => {
    if (!quitting) { e.preventDefault(); mainWin.hide(); }
  });
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
