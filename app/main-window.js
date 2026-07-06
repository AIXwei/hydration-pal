// 主窗口逻辑:今日页(杯子/养成/饮品/流水)+ 成就页(打卡/柱状图/勋章)+ 设置。
const wapi = window.api;
const $ = (id) => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';
let st = null;
let meta = { badges: [], drinks: [{ id: 'water', name: '水', emoji: '💧', factor: 1 }], levels: [] };
function drinkEmoji(type) {
  const d = meta.drinks.find(x => x.id === type);
  return d ? d.emoji : '💧';
}
function drinkName(type) {
  const d = meta.drinks.find(x => x.id === type);
  return d ? d.name : '水';
}

// ── 水位动画驱动 ──
// SVG attribute 不吃 CSS transition，用 rAF 统一驱动：
// 水位指数平滑补间 + 待机正弦漂浮 + 底部椭圆随水展开
const POOL_BOT = 700, POOL_TOP = 207, WH = POOL_BOT - POOL_TOP;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let curWY = POOL_BOT;    // 当前显示水位（素材坐标），启动时从空杯涨到当前值
let targetWY = POOL_BOT;
let targetP = 0;

function animTick(now) {
  // 补间：每帧走剩余距离的一段，收敛快且无需管理动画状态
  curWY += (targetWY - curWY) * (reduceMotion ? 1 : 0.10);
  if (Math.abs(targetWY - curWY) < 0.1) curWY = targetWY;

  const hasWater = targetP > 0 && curWY < POOL_BOT - 0.5;
  // 待机漂浮：水面±3、猫相对水面再±4（相位差制造荡漾感），周期约3秒
  const bobW = (reduceMotion || !hasWater) ? 0 : Math.sin(now / 480) * 3;
  const bobC = (reduceMotion || !hasWater) ? 0 : Math.sin(now / 480 + 0.9) * 4;

  const y = curWY + bobW;
  const waterH = Math.ceil(Math.max(0, POOL_BOT - y) * 745 / 665);
  $('water').setAttribute('y', y);
  $('water').setAttribute('height', waterH);

  // water_crop.png 顶部约65px是气泡/透明区，实际波浪面在图像 y≈65
  const waveSvgY = y + 65 * waterH / 745;
  if (targetP > 0 && targetP < 1) $('cat-2').setAttribute('y', Math.round(waveSvgY - 445 + bobC));
  if (targetP >= 1) $('cat-3').setAttribute('y', Math.round(-197 + bobC));

  requestAnimationFrame(animTick);
}
requestAnimationFrame(animTick);

function render() {
  if (!st) return;
  const goal = st.settings.dailyGoal || 2000;
  const total = st.today.total || 0;
  const p = Math.max(0, Math.min(1, total / goal));

  // 更新动画目标，实际水位/猫位置由 animTick 逐帧逼近
  targetP = p;
  targetWY = POOL_BOT - p * WH;

  // 三阶段猫：opacity 淡入淡出（CSS transition），不再 display 硬切
  const c1 = $('cat-1'), c2 = $('cat-2'), c3 = $('cat-3');
  c1.style.opacity = p <= 0 ? '1' : '0';
  c2.style.opacity = (p > 0 && p < 1) ? '1' : '0';
  c3.style.opacity = p >= 1 ? '1' : '0';

  $('pctbig').textContent = Math.round(p * 100) + '%';
  $('curml').textContent = total;
  $('goalml').textContent = goal;
  $('goaltip').textContent = p >= 1 ? '今天喝够啦,猫猫超开心 🎉' : `还差 ${Math.max(0, goal - total)} ml 达标`;

  // 暂停条
  const paused = st._snoozeUntil && st._snoozeUntil > (st._now || Date.now());
  const sb = $('snoozebar');
  sb.classList.toggle('on', !!paused);
  if (paused) {
    const mins = Math.round((st._snoozeUntil - (st._now || Date.now())) / 60000);
    $('snoozetext').textContent = mins > 90 ? '提醒已暂停(到今天结束)' : `提醒已暂停,约 ${mins} 分钟后恢复`;
  }

  // 今日流水
  const list = $('loglist');
  list.innerHTML = '';
  if (!st.today.records.length) {
    list.innerHTML = '<div class="empty">今天还没喝水记录,点上面的杯子记一笔吧~</div>';
  } else {
    [...st.today.records].reverse().forEach(r => {
      const row = document.createElement('div');
      row.className = 'log-item';
      const isWater = (r.type || 'water') === 'water';
      row.innerHTML = `<span class="de">${drinkEmoji(r.type || 'water')}</span>` +
        `<span class="ml">+${r.ml} ml</span>` +
        `<span class="ty">${isWater ? '' : drinkName(r.type)}</span>` +
        `<span class="tm">${r.time}</span>`;
      const del = document.createElement('button');
      del.className = 'del'; del.textContent = '🗑';
      del.onclick = () => wapi.deleteRecord(r.id);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  renderStats();
}

function renderStats() {
  const calGoal = st.settings.dailyGoal || 2000;
  const nowD = new Date();
  const curYear = nowD.getFullYear(), curMonth = nowD.getMonth();
  const monthPrefix = curYear + '-' + String(curMonth + 1).padStart(2, '0') + '-';
  let monthCount = 0;
  for (const h of (st.history || [])) {
    if (h.date.startsWith(monthPrefix) && h.total >= (h.goal || calGoal)) monthCount++;
  }
  if (st.today.date.startsWith(monthPrefix) && st.today.total >= calGoal) monthCount++;
  $('month-num').textContent = monthCount;

  // 最近7天柱状图(history 末尾 + 今天)
  const days = [];
  const hist = st.history || [];
  hist.slice(-6).forEach(h => days.push({ date: h.date, total: h.total, goal: h.goal || 2000 }));
  days.push({ date: st.today.date, total: st.today.total, goal: st.settings.dailyGoal });
  while (days.length < 7) days.unshift(null);
  const tail = days.slice(-7);

  const MAXBAR = 55;
  const chart = $('chart');
  chart.innerHTML = '<div class="goal-line" style="bottom:' + (MAXBAR + 20) + 'px"></div>';
  tail.forEach(d => {
    const col = document.createElement('div');
    col.className = 'col';
    const bar = document.createElement('div');
    bar.className = 'b';
    let pct = 0, ok = false, label = '';
    if (d) {
      pct = Math.max(0, Math.min(1, d.total / (d.goal || 2000)));
      ok = d.total >= (d.goal || 2000) && d.total > 0;
      label = d.date.slice(5).replace('-', '/');
    }
    const h_px = d ? Math.max(3, pct * MAXBAR) : 3;
    bar.style.height = h_px + 'px';
    if (ok) bar.classList.add('ok');
    if (!d) bar.style.opacity = '0.25';
    const dd = document.createElement('div');
    dd.className = 'd'; dd.textContent = label || '—';
    col.appendChild(bar); col.appendChild(dd);
    if (d && d.total > 0) {
      const lbl = document.createElement('span');
      lbl.className = 'bar-label';
      lbl.textContent = d.total >= 1000 ? (d.total / 1000).toFixed(1) + 'L' : String(d.total);
      if (h_px >= 22) {
        lbl.classList.add('inside');
        lbl.style.bottom = (15 + Math.floor(h_px / 2) - 5) + 'px';
      } else {
        lbl.classList.add('above');
        lbl.style.bottom = (h_px + 18) + 'px';
      }
      col.appendChild(lbl);
    }
    chart.appendChild(col);
  });

  // 喝水日历
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  $('cal-title').textContent = year + '年' + (month + 1) + '月';
  const calAchieved = new Map();
  for (const h of (st.history || [])) {
    calAchieved.set(h.date, h.total >= (h.goal || calGoal));
  }
  calAchieved.set(st.today.date, st.today.total >= calGoal);
  const calGrid = $('cal-grid');
  calGrid.innerHTML = '';
  ['日','一','二','三','四','五','六'].forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-dow'; el.textContent = d;
    calGrid.appendChild(el);
  });
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayNum = now.getDate();
  for (let i = 0; i < firstDow; i++) {
    const el = document.createElement('div'); el.className = 'cal-day empty';
    calGrid.appendChild(el);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const isToday = day === todayNum;
    const isFuture = day > todayNum;
    const isAchieved = calAchieved.get(dateStr) === true;
    const el = document.createElement('div');
    let cls = 'cal-day';
    if (isAchieved) cls += ' achieved';
    if (isToday) cls += ' today';
    if (isFuture) cls += ' future';
    el.className = cls;
    el.textContent = isAchieved ? '🐾' : String(day);
    el.title = dateStr;
    calGrid.appendChild(el);
  }

  // 连续达标
  $('streak-num').textContent = st.stats.streak || 0;
  $('best-num').textContent = st.stats.bestStreak || 0;
}

// Tab
function switchTab(which) {
  $('tab-today').classList.toggle('on', which === 'today');
  $('tab-stats').classList.toggle('on', which === 'stats');
  $('page-today').style.display = which === 'today' ? '' : 'none';
  $('page-stats').style.display = which === 'stats' ? '' : 'none';
}
$('tab-today').onclick = () => switchTab('today');
$('tab-stats').onclick = () => switchTab('stats');

// 设置抽屉
function openDrawer() { fillSettings(); $('drawer').classList.add('open'); }
function closeDrawer() { $('drawer').classList.remove('open'); }
function fillSettings() {
  const s = st.settings;
  $('s_goal').value = s.dailyGoal; $('s_interval').value = s.intervalMinutes;
  $('s_start').value = s.activeStart; $('s_end').value = s.activeEnd;
  $('s_cups').value = (s.cupSizes || []).join(','); $('s_nick').value = s.nickname;
  $('s_snap').checked = s.edgeSnap !== false;
  $('s_toast').checked = !!s.enableToast; $('s_sound').checked = !!s.enableSound; $('s_auto').checked = !!s.autoLaunch;
}
function clamp(v, min, max, dft) { if (isNaN(v)) return dft; return Math.max(min, Math.min(max, v)); }
function saveSettings() {
  let cups = $('s_cups').value.split(',').map(x => parseInt(x.trim(), 10)).filter(x => !isNaN(x) && x > 0).slice(0, 5);
  if (!cups.length) cups = [100, 200, 300, 500];
  wapi.updateSettings({
    dailyGoal: clamp(parseInt($('s_goal').value, 10), 500, 6000, 2000),
    intervalMinutes: clamp(parseInt($('s_interval').value, 10), 10, 240, 60),
    activeStart: $('s_start').value || '08:00',
    activeEnd: $('s_end').value || '22:00',
    cupSizes: cups,
    nickname: ($('s_nick').value || '老婆sama').trim(),
    edgeSnap: $('s_snap').checked,
    enableToast: $('s_toast').checked,
    enableSound: $('s_sound').checked,
    autoLaunch: $('s_auto').checked
  }).then(() => { closeDrawer(); showToast('已保存 ✓'); });
}

function showToast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(showToast._t); showToast._t = setTimeout(() => t.classList.remove('show'), 1800);
}

$('gear').onclick = openDrawer;
$('closex').onclick = closeDrawer;
$('drawer').querySelector('.drawer-mask').onclick = closeDrawer;
$('save').onclick = saveSettings;

// 改目标弹层
function openGoalPop() {
  const cur = (st && st.settings && st.settings.dailyGoal) || 2000;
  $('goalInput').value = cur;
  syncGoalChips(cur);
  $('goalPop').classList.add('open');
  setTimeout(() => { $('goalInput').focus(); $('goalInput').select(); }, 50);
}
function closeGoalPop() { $('goalPop').classList.remove('open'); }
function syncGoalChips(v) {
  document.querySelectorAll('#goalChips button').forEach(b => {
    b.classList.toggle('on', parseInt(b.dataset.v, 10) === v);
  });
}
$('goalbtn').onclick = openGoalPop;
$('goalCancel').onclick = closeGoalPop;
$('goalPop').onclick = (e) => { if (e.target === $('goalPop')) closeGoalPop(); };
document.querySelectorAll('#goalChips button').forEach(b => {
  b.onclick = () => { $('goalInput').value = b.dataset.v; syncGoalChips(parseInt(b.dataset.v, 10)); };
});
$('goalInput').oninput = () => syncGoalChips(parseInt($('goalInput').value, 10));
$('goalSave').onclick = () => {
  const v = clamp(parseInt($('goalInput').value, 10), 500, 6000, 2000);
  st.settings.dailyGoal = v;
  render();
  wapi.updateSettings({ ...st.settings, dailyGoal: v }).then(() => {
    closeGoalPop(); showToast('目标已改为 ' + v + ' ml 🎯');
  });
};

function addWater(ml) {
  wapi.addWater(ml).then(s => {
    if (s && s.today) { st = s; if (s._meta) meta = s._meta; render(); }
    showToast('+' + ml + ' ml 💧');
  });
}
$('btn-50').onclick  = () => addWater(50);
$('btn-100').onclick = () => addWater(100);
$('btn-200').onclick = () => addWater(200);
$('undo').onclick = () => wapi.undoLast().then(s => { if (s && s.today) { st = s; render(); } });

// 窗口控制
$('win-min').onclick = () => wapi.winMinimize();
$('win-max').onclick = () => wapi.winMaximize();
$('win-close').onclick = () => wapi.winClose();
$('resumebtn').onclick = () => wapi.resume();

// 提示音：WebAudio 双音符水滴声，不依赖音频文件
function playChime() {
  try {
    const ctx = playChime._ctx || (playChime._ctx = new AudioContext());
    [[880, 0], [1320, 0.12]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.3);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.35);
    });
  } catch (e) { /* 音频设备不可用时静默 */ }
}

wapi.onStateChanged(s => { st = s; if (s._meta) meta = s._meta; render(); });
wapi.onReminder(d => {
  if (d.type === 'celebrate') showToast('🎉 ' + d.text);
  else if (d.type === 'levelup') showToast('⬆️ ' + d.text);
  else if (d.type === 'badge') showToast('🏅 ' + d.text);
  if (st && st.settings.enableSound && (d.type === 'reminder' || d.type === 'celebrate')) playChime();
});
wapi.getState().then(s => { st = s; if (s._meta) meta = s._meta; render(); });
