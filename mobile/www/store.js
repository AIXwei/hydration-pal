// 移动版数据层：实现与桌面版 preload window.api 相同的接口，
// 数据存 localStorage，业务逻辑复刻自桌面版主进程 main.js。
// app.js（渲染层）无需感知平台差异。
(function () {
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
  const KEY = 'hydration-data';

  let data = null;
  let snoozeUntil = 0;
  let recSeq = 0;
  const stateListeners = [];
  const reminderListeners = [];

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtTime(d) { return d.toTimeString().slice(0, 5); }

  function defaultData() {
    return {
      settings: {
        dailyGoal: 2000,
        intervalMinutes: 60,
        activeStart: '08:00',
        activeEnd: '22:00',
        cupSizes: [100, 200, 300, 500],
        nickname: '老婆sama',
        enableToast: true,
        enableSound: false,
      },
      today: { date: todayStr(), total: 0, records: [] },
      history: [],
      stats: { streak: 0, bestStreak: 0, totalAchieved: 0, badges: [] },
    };
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        data = JSON.parse(raw);
        const def = defaultData();
        if (!data.settings) data.settings = def.settings;
        else Object.keys(def.settings).forEach(k => { if (data.settings[k] === undefined) data.settings[k] = def.settings[k]; });
        if (!data.today) data.today = def.today;
        if (!data.history) data.history = [];
        if (!data.stats) data.stats = def.stats;
        data.today.records = (Array.isArray(data.today.records) ? data.today.records : []).map(r => ({
          id: r.id,
          ml: Math.max(0, Number(r.ml) || 0),
          type: typeof r.type === 'string' ? r.type : 'water',
          time: typeof r.time === 'string' ? r.time.slice(0, 5) : '',
        }));
      } else {
        data = defaultData();
      }
    } catch (e) { console.error('loadData failed:', e); data = defaultData(); }
  }

  function saveData() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { console.error('saveData failed:', e); }
  }

  function checkDate() {
    const today = todayStr();
    if (data.today.date === today) return false;
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
    const gapDays = Math.round((new Date(today) - new Date(prev.date)) / 86400000);
    if (gapDays > 1) data.stats.streak = 0;
  }

  function computeCat() {
    const xp = data.stats.totalAchieved || 0;
    let lv = LEVELS[0];
    for (const l of LEVELS) { if (xp >= l.xp) lv = l; else break; }
    const idx = LEVELS.indexOf(lv);
    const next = LEVELS[idx + 1];
    const progress = next ? (xp - lv.xp) / (next.xp - lv.xp) : 1;
    return { level: lv.level, name: lv.name, progress, nextName: next ? next.name : null };
  }

  function emitReminder(payload) { reminderListeners.forEach(cb => cb(payload)); }

  function checkBadgeCondition(id, cond) {
    if (cond && !(data.stats.badges || []).includes(id)) {
      data.stats.badges = data.stats.badges || [];
      data.stats.badges.push(id);
      const b = BADGES.find(x => x.id === id);
      if (b) emitReminder({ type: 'badge', text: '解锁勋章：' + b.name + ' ' + b.icon });
    }
  }

  function checkAchievements() {
    const recs = data.today.records;
    checkBadgeCondition('first_drop', recs.length >= 1);
    if (recs.length > 0) {
      const last = recs[recs.length - 1];
      checkBadgeCondition('big_gulp', last.ml >= 500);
      if (new Date().getHours() < 8) checkBadgeCondition('early_bird', true);
    }
    const prev = data.today.total - ((recs[recs.length - 1] || {}).ml || 0);
    const goal = data.settings.dailyGoal;
    if (prev < goal && data.today.total >= goal) {
      emitReminder({ type: 'celebrate', text: '🎉 今天达标啦！猫猫超开心！' });
    }
  }

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

  function broadcast() {
    const s = getFullState();
    stateListeners.forEach(cb => cb(s));
    scheduleNotifications();
  }

  // ── 本地通知（Capacitor LocalNotifications，浏览器里静默降级）──
  async function scheduleNotifications() {
    const LN = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;
    if (!LN) return;
    try {
      const perm = await LN.requestPermissions();
      if (perm.display !== 'granted') return;
      const pending = await LN.getPending();
      if (pending.notifications.length) await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
      if (!data.settings.enableToast) return;

      const interval = Math.max(10, data.settings.intervalMinutes || 60);
      const [sh, sm] = (data.settings.activeStart || '08:00').split(':').map(Number);
      const [eh, em] = (data.settings.activeEnd || '22:00').split(':').map(Number);
      const nick = data.settings.nickname || '老婆sama';
      const now = Date.now();
      const notifs = [];
      let t = new Date(now + interval * 60000);
      let id = 1;
      // 排未来48小时内活跃时段的提醒
      while (t.getTime() < now + 48 * 3600000 && notifs.length < 60) {
        const mins = t.getHours() * 60 + t.getMinutes();
        if (mins >= sh * 60 + sm && mins <= eh * 60 + em) {
          notifs.push({
            id: id++,
            title: '喝水小助手 💧',
            body: `${nick}，该喝水啦`,
            schedule: { at: new Date(t.getTime()) },
          });
        }
        t = new Date(t.getTime() + interval * 60000);
      }
      if (notifs.length) await LN.schedule({ notifications: notifs });
    } catch (e) { console.error('scheduleNotifications failed:', e); }
  }

  // ── 前台提醒定时器（应用打开时的页内提醒）──
  setInterval(() => {
    if (checkDate()) broadcast();
    if (snoozeUntil && Date.now() < snoozeUntil) return;
  }, 60000);

  loadData();
  checkDate();

  window.api = {
    getState: () => Promise.resolve(getFullState()),
    addWater: (ml, type) => {
      checkDate();
      ml = parseInt(ml, 10);
      if (!Number.isFinite(ml) || ml <= 0) return Promise.resolve(getFullState());
      ml = Math.min(9999, ml);
      data.today.total += ml;
      data.today.records.push({ id: Date.now() + '-' + (recSeq++), ml, type: typeof type === 'string' ? type : 'water', time: fmtTime(new Date()) });
      checkAchievements();
      saveData();
      broadcast();
      return Promise.resolve(getFullState());
    },
    deleteRecord: (id) => {
      checkDate();
      const idx = data.today.records.findIndex(r => r.id === id);
      if (idx >= 0) {
        data.today.total = Math.max(0, data.today.total - data.today.records[idx].ml);
        data.today.records.splice(idx, 1);
        saveData();
        broadcast();
      }
      return Promise.resolve(getFullState());
    },
    undoLast: () => {
      checkDate();
      if (data.today.records.length > 0) {
        const last = data.today.records.pop();
        data.today.total = Math.max(0, data.today.total - last.ml);
        saveData();
        broadcast();
      }
      return Promise.resolve(getFullState());
    },
    updateSettings: (obj) => {
      if (obj && typeof obj === 'object') {
        const s = data.settings;
        const pick = (k) => obj[k] !== undefined ? obj[k] : s[k];
        const cleanNum = (v, min, max, dft) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : dft; };
        const cleanTime = (v, dft) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : dft;
        data.settings = {
          dailyGoal: cleanNum(pick('dailyGoal'), 500, 6000, 2000),
          intervalMinutes: cleanNum(pick('intervalMinutes'), 10, 240, 60),
          activeStart: cleanTime(pick('activeStart'), '08:00'),
          activeEnd: cleanTime(pick('activeEnd'), '22:00'),
          cupSizes: (Array.isArray(pick('cupSizes')) ? pick('cupSizes') : [100, 200, 300, 500]).map(x => cleanNum(x, 1, 9999, 100)).slice(0, 5),
          nickname: String(pick('nickname') || '老婆sama').slice(0, 20),
          enableToast: !!pick('enableToast'),
          enableSound: !!pick('enableSound'),
        };
        saveData();
        broadcast();
      }
      return Promise.resolve(getFullState());
    },
    resume: () => { snoozeUntil = 0; broadcast(); return Promise.resolve(getFullState()); },
    openMain: () => Promise.resolve(true),
    winMinimize: () => Promise.resolve(),
    winMaximize: () => Promise.resolve(),
    winClose: () => Promise.resolve(),
    onStateChanged: (cb) => stateListeners.push(cb),
    onReminder: (cb) => reminderListeners.push(cb),
  };

  // 应用回前台时刷新（安卓切回app触发日期检查和通知重排）
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) broadcast();
  });
})();
