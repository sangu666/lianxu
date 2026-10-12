import {
  EQUIPMENT_OPTIONS,
  PATTERN_OPTIONS,
  PREFERENCE_OPTIONS,
  SESSION_MINUTES,
  trainingPreferences,
} from './profile-rules.js';
import { createPlan, createReview, advanceVersion } from './core.js';
import {
  loadState,
  initialState,
  persistState,
  projectLogs,
  STORAGE_KEY,
  LEGACY_KEY,
} from './storage.js';
import { createWorkoutView, downloadText } from './workout-view.js';
// state是当前完整状态；savedRaw用于阻止其他标签页的并发覆盖。
const $ = (selector) => document.querySelector(selector);
let state,
  savedRaw = null,
  loadError = '';
try {
  const loaded = loadState(localStorage);
  state = loaded.state;
  savedRaw = loaded.raw;
} catch (error) {
  state = initialState();
  loadError = `记录读取失败：${error.message}。原记录保留；请下载原始记录并检查，修复后刷新页面。`;
}
state.logs = projectLogs(state.workouts);
let lastGoodState = structuredClone(state); // 保存失败时恢复页面状态，不把未写入的数据显示为已保存。
function commitState(next, { restore = false } = {}) {
  if (loadError && !restore) throw new Error(loadError);
  // 完整恢复已由用户确认：允许用有效备份修复坏数据；普通编辑仍禁止越过冲突检查。
  const raw = persistState(
    localStorage,
    next,
    restore ? localStorage.getItem(STORAGE_KEY) : savedRaw,
  );
  state = structuredClone(next);
  state.logs = projectLogs(state.workouts);
  savedRaw = raw;
  lastGoodState = structuredClone(state);
  loadError = '';
  storageOK = true;
}
const workoutPage = createWorkoutView({
  getState: () => state,
  commit: commitState,
  getPlan: () => plan(),
  getDay: () => selectedDay,
  date: () => date(),
  render: () => render(),
  toast: (message) => toast(message),
});
let pictures = {}, // 三视角照片的临时Object URL，用视角编号0/1/2查找，不写入存储。
  selectedDay = 0, // 正在查看的训练日下标，从0开始，不是星期几。
  storageOK = true; // 最近存储状态；失败时提示数据仅在页面暂存。
// labels每项为[路由名, 显示名称]；paths按相同顺序保存导航SVG图标路径。
const labels = [
  ['today', '今日概览'],
  ['body', '身体与资料'],
  ['plan', '训练计划'],
  ['log', '训练记录'],
  ['food', '饮食建议'],
  ['progress', '进展回顾'],
];
const paths = [
  'M3 10 12 3l9 7v11H3Z M9 21v-8h6v8',
  'M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M5 21v-4a7 7 0 0 1 14 0v4',
  'M5 3h14v18H5Z M8 8h8 M8 12h8 M8 16h5',
  'M4 8v8 M7 5v14 M7 12h10 M17 5v14 M20 8v8',
  'M5 3v6a3 3 0 0 0 6 0V3 M8 3v18 M18 3v18 M18 3c-4 3-4 8 0 8',
  'M3 20h18 M5 16l5-5 4 2 6-9',
];
const icon = (i) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[i]}"/></svg>`;
const bodySVG = `<svg viewBox="0 0 100 180" fill="none" aria-hidden="true"><circle cx="50" cy="20" r="14" stroke="currentColor" stroke-width="2"/><path d="M30 45Q50 34 70 45L87 96 76 101 63 67 61 105 70 165 55 165 50 119 45 165 30 165 39 105 37 67 24 101 13 96Z" stroke="currentColor" stroke-width="2"/></svg>`;
/** 把用户文本中的HTML特殊字符转义，防止备注或名称被当成网页标签执行。 */
function esc(v) {
  return String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
/** 旧页面的资料和体重更新也通过新版保存入口；失败时恢复最后一次成功状态。 */
function save() {
  try {
    commitState(state);
    return true;
  } catch (error) {
    state = structuredClone(lastGoodState);
    storageOK = false;
    toast(`未保存：${error.message}`);
    return false;
  }
}
let toastTimer; // 提示关闭计时器；新提示出现时取消旧计时器，避免提前消失。
function toast(t) {
  $('#toast').textContent = t;
  $('#toast').style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').style.display = 'none'), 4500);
}
// 当前原型按上海时区生成YYYY-MM-DD日期；后续多地区使用时需支持用户时区。
const date = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
// arr是[选项值, 显示文本]列表；value是当前选中值，返回select中的option标签。
const choice = (arr, value) =>
  arr
    .map(
      ([v, t]) =>
        `<option value="${v}" ${String(value) === String(v) ? 'selected' : ''}>${t}</option>`,
    )
    .join('');
const heading = (k, t, s) =>
  `<div class="heading"><div class="eyebrow">${k}</div><h1>${t}</h1><p class="sub">${s}</p></div>`;
/** 可选清单使用原生复选框；名称由固定选项定义，勾选值从已校验资料读取。 */
function checkboxOptions(name, options, selected) {
  return options
    .map(
      ([value, label]) =>
        `<label class="option-check"><input type="checkbox" name="${name}" value="${value}" ${selected.includes(value) ? 'checked' : ''}><span>${label}</span></label>`,
    )
    .join('');
}
/** 获取当前资料对应的规则模板，不调用AI。 */
function plan() {
  return createPlan(state.profile, state.adjusted);
}
/** 以下视图函数返回HTML字符串；由render统一放入内容区。 */
function today() {
  const p = state.profile; // p是profile的简写，代表当前基础资料。
  // 周一是统计起点；使用上海日期与UTC日历运算，避免电脑时区改变周边界。
  const todayDate = date();
  const weekStart = new Date(`${todayDate}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  const weekStartDate = weekStart.toISOString().slice(0, 10);
  const completedThisWeek = state.workouts.filter(
    (item) => item.status === 'completed' && item.date >= weekStartDate && item.date <= todayDate,
  ).length; // 本周已完成训练次数，不含进行中的训练。
  const progressPercent = Math.min(100, (completedThisWeek / p.days) * 100);
  return (
    heading('YOUR OWN PACE', '今天，循序向前。', '让每一次认真，都成为看得见的进步。') +
    `<section class="hero"><div><div class="eyebrow">YOUR NEXT SESSION · 规则模板</div><h2>${plan()[0].name}</h2><p>${p.equipment === 'home' ? '居家训练' : '健身房训练'} / 每周 ${p.days} 次 / 版本 ${state.version}</p><button data-go="log">进入训练记录 →</button></div><div class="hero-art"><div class="activity-ring" style="--progress:${progressPercent}%" role="img" aria-label="本周完成 ${completedThisWeek} 次训练，计划每周 ${p.days} 次"><div class="ring-center"><span>本周完成</span><strong>${completedThisWeek}<small> / ${p.days}</small></strong><span>次训练</span></div></div></div></section><div class="metric-grid"><div class="metric"><small>已记训练组数</small><b>${state.logs.length}</b><small>你的本地记录</small></div><div class="metric"><small>最近记录体重</small><b>${state.weights.length ? esc(state.weights.at(-1).value) : '—'}</b><small>${state.weights.length ? 'kg · 你的记录' : '尚未记录'}</small></div><div class="metric"><small>计划训练频率</small><b>${p.days}<small style="display:inline"> 次 / 周</small></b><small>可在资料中修改</small></div></div><div class="grid"><section class="card"><div class="row"><h2>这一周，循序向前</h2><span class="tag">排期示例</span></div><p class="muted">训练日之间安排恢复，具体时间由你决定。</p><div class="week">${['一', '二', '三', '四', '五', '六', '日'].map((d, i) => `<div class="day ${[0, 2, 4, ...(p.days === 4 ? [5] : [])].includes(i) ? 'on' : ''}"><b>周${d}</b>${[0, 2, 4, ...(p.days === 4 ? [5] : [])].includes(i) ? '训练' : '恢复'}</div>`).join('')}</div></section><section class="card"><div class="eyebrow">START WITH YOU</div><h2>身体资料，是计划的起点</h2><p class="muted">经验、设备和你的目标比一张照片更完整。照片可以跳过。</p><button class="secondary" data-go="body">完善我的资料 →</button></section></div>`
  );
}
function body() {
  const p = state.profile; // 此页面用于展示和编辑基础资料。
  const prefs = trainingPreferences(p); // 旧资料缺省字段仅用于显示，保存后才进入新版本快照。
  return (
    heading(
      'KNOW YOURSELF',
      '先了解你，再决定怎么练。',
      '新手居家和健身房进阶，都从同一份资料开始。',
    ) +
    `<div class="notice">初始值为虚构示例，请按需修改。原型按明确资料筛选规则模板，不会分析你的照片或解读伤病备注。</div><div class="grid"><section class="card"><h2>我的基础资料</h2><form id="profile"><div class="form-grid"><label>年龄<input name="age" type="number" min="18" max="100" value="${p.age}" required></label><label>身高 / cm<input name="height" type="number" min="100" max="230" value="${p.height}" required></label><label>体重 / kg<input name="weight" type="number" min="30" max="250" step="0.1" value="${p.weight}" required></label><label>训练经验<select name="experience">${choice(
      [
        ['beginner', '零基础 / 刚开始'],
        ['experienced', '有持续训练经验'],
      ],
      p.experience,
    )}</select></label><label>训练环境<select name="equipment">${choice(
      [
        ['home', '居家'],
        ['gym', '健身房'],
      ],
      p.equipment,
    )}</select></label><label>每周训练<select name="days">${choice(
      [
        [3, '每周 3 次'],
        [4, '每周 4 次'],
      ],
      p.days,
    )}</select></label><label class="span">当前目标<select name="goal">${choice(
      [
        ['habit', '建立训练习惯'],
        ['fatloss', '减脂与改善线条'],
        ['muscle', '增肌与提升表现'],
      ],
      p.goal,
    )}</select></label></div><fieldset class="profile-section"><legend>训练条件</legend><div class="form-grid"><label>单次可用时间<select name="sessionMinutes">${choice(
      SESSION_MINUTES.map((value) => [value, `${value} 分钟`]),
      prefs.sessionMinutes,
    )}</select></label><label>动作偏好<select name="movementPreference">${choice(PREFERENCE_OPTIONS, prefs.movementPreference)}</select></label></div><h3 class="field-title">具体可用设备</h3><p class="muted">只勾选你能使用的设备；改变训练环境不会自动改变此清单。旧资料的设备是推定值，请核对。</p><div class="option-grid">${checkboxOptions('availableEquipment', EQUIPMENT_OPTIONS, prefs.availableEquipment)}</div></fieldset><fieldset class="profile-section"><legend>动作限制与备注</legend><p class="muted">勾选当前暂不安排的动作类型。规则只按这些明确选项筛选，不判断疾病或康复方案。</p><div class="option-grid">${checkboxOptions('excludedPatterns', PATTERN_OPTIONS, prefs.excludedPatterns)}</div><label class="field-title">补充备注 · 可选<textarea name="restrictionNotes" rows="3" maxlength="1000" placeholder="例如：有些设备需预约；备注仅保存，不自动解读">${esc(prefs.restrictionNotes)}</textarea></label><p class="muted">备注仅在本地与备份中保留，不会自动转为动作限制；请勿填写不必要的隐私信息。</p></fieldset><p id="profile-error" class="error-text" role="alert" tabindex="-1"></p><p class="muted">时长是粗略预算，模板可能因条件缺项。饮食限制与营养计算尚未实现。</p><button type="submit">保存资料并查看模板 →</button></form></section><section class="card"><h2>观察身体，不给身体打分</h2><p>照片反馈会展示可见线条、比例和拍摄局限，再与你的目标一起讨论训练方向。</p><div class="notice warm"><b>体脂范围：暂不可用</b><br>模型尚未验证，原型不输出体脂百分比或肌肉量。</div><p class="muted">身高、体重、力量和伤病都由你提供。图片不是这些资料的替代品。</p></section></div><section class="card"><div class="row"><h2>三视角照片 · 可跳过</h2><span class="tag">仅本页临时预览</span></div><p class="muted">正面、背面、侧面；同一光线和距离，自然站姿，穿贴身运动服，无需露脸。支持 JPEG / PNG / WebP，单张不超过 8 MB。</p><label class="check"><input type="checkbox" id="photo-consent" ${Object.keys(pictures).length ? 'checked' : ''}>我选择在浏览器中预览照片；照片不会上传，刷新页面即清除。</label><div class="photos">${['正面', '背面', '侧面'].map((v, i) => `<div class="photo"><label for="photo${i}">${v}</label><div id="preview${i}">${pictures[i] ? `<img src="${pictures[i]}" alt="${v}照片本地预览">` : bodySVG}</div><input type="file" id="photo${i}" accept="image/jpeg,image/png,image/webp" aria-label="选择${v}照片"><button class="link" data-remove="${i}" ${pictures[i] ? '' : 'disabled'}>删除${v}照片</button></div>`).join('')}</div><p class="muted" style="margin-top:16px">未接入质量检查与 AI，选取照片不会改变分析结果。你也可以直接查看训练模板。</p></section>`
  );
}
function planView() {
  let sessions = plan(); // sessions是本周各训练日模板，不是已完成的训练记录。
  selectedDay = Math.min(selectedDay, sessions.length - 1);
  const s = sessions[selectedDay]; // s是当前选中的训练日，包含名称、动作和组次。
  return (
    heading(
      'YOUR TRAINING BLUEPRINT',
      '适合你的节奏，才更容易坚持。',
      '这是按设备、时长、偏好和动作限制筛选的规则模板，尚未经过个人 AI 分析。',
    ) +
    `<div class="chips"><span class="chip">${state.profile.experience === 'beginner' ? '新手起步' : '训练进阶'}</span><span class="chip">${state.profile.equipment === 'home' ? '居家训练' : '健身房训练'}</span><span class="chip">每周 ${state.profile.days} 次</span><span class="chip">每次 ${trainingPreferences(state.profile).sessionMinutes} 分钟</span><span class="chip">版本 ${state.version}</span></div><div class="tabs" aria-label="训练日">${sessions.map((s, i) => `<button data-day="${i}" aria-pressed="${i === selectedDay}" class="${i === selectedDay ? 'selected' : ''}">${s.name}</button>`).join('')}</div><div class="grid"><section class="card"><div class="row"><h2>${s.name}</h2><span class="tag">粗估 ${s.estimatedMinutes} 分钟</span></div>${s.notes.length ? `<div class="notice warm"><b>模板缺项与时间说明</b><ul>${s.notes.map((note) => `<li>${esc(note)}</li>`).join('')}</ul></div>` : ''}${s.exercises.map((e, i) => `<div class="session"><span class="number">0${i + 1}</span><div class="detail"><h3>${e}</h3><small>${e === '平板支撑' ? `${s.sets} 组 × 20–30 秒` : `${s.sets} 组 × ${s.reps} 次`} · 休息 90–120 秒</small></div></div>`).join('')}<button style="margin-top:22px" data-go="log" ${s.exercises.length ? '' : 'disabled'}>记录这一练 →</button></section><section class="card"><h2>为什么这样安排？</h2><p>${state.profile.days === 3 ? '基础全身模板原有蹲、推、拉和髋铰链位置；筛选后的缺项会在左侧说明。' : '基础上下肢模板分散到四次训练；筛选后的缺项会在左侧说明。'}</p><p>${state.profile.experience === 'beginner' ? '先熟悉动作和记录方式，再逐步增加训练量。' : '用实际组次与恢复反馈讨论进阶，初始重量仍需自己确认。'}</p><div class="notice">不确定动作是否适合或出现疼痛时，停止相关动作并寻求合适指导。</div><p class="muted">此处组次是交互演示，时长是粗略预算。动作教学与更完整的替代库尚未实现。</p></section></div>`
  );
}
function logView() {
  return workoutPage.html();
}
function food() {
  return (
    heading(
      'FUEL YOUR PROGRESS',
      '吃得有章法，也留一点弹性。',
      '正式版将结合你的资料、活动水平和饮食限制计算目标。',
    ) +
    `<div class="notice warm">以下全部为界面示例，未计算你的个人目标。不要把示例数值作为自己的饮食计划。</div><div class="metric-grid"><div class="metric"><small>示例日热量</small><b>2,200</b><small>kcal · 未个性化</small></div><div class="metric"><small>示例蛋白质</small><b>140</b><small>g · 未个性化</small></div><div class="metric"><small>示例餐次</small><b>3 + 1</b><small>三餐与加餐</small></div></div><section class="card"><h2>三餐结构 · 示例</h2><div class="nutrition"><div class="meal"><span class="eyebrow">BREAKFAST</span><strong>早餐</strong><p>燕麦、鸡蛋、牛奶<br>份量需要按个人目标调整</p><span class="tag">蛋白质 + 谷物</span></div><div class="meal"><span class="eyebrow">LUNCH</span><strong>午餐</strong><p>米饭、鸡肉、时蔬<br>注意油与酱料的份量</p><span class="tag">主食 + 蛋白质 + 蔬菜</span></div><div class="meal"><span class="eyebrow">DINNER</span><strong>晚餐</strong><p>土豆、豆腐、蔬菜<br>不适合的食物可以替换</p><span class="tag">可替换的餐食组合</span></div></div></section><section class="card"><h2>生成个人饮食计划之前</h2><p class="muted">需要补齐活动水平、饮食偏好、过敏与健康限制等资料；当前原型尚未实现营养计算和食物替换。</p></section>`
  );
}
function progress() {
  const latest = state.weights.slice(-7); // 最近7次体重记录，用于趋势图和明细。
  return (
    heading(
      'SMALL STEPS, REAL CHANGE',
      '关注趋势，也关注你的感受。',
      '示例调整展示用户确认流程，不替代基于长期记录的真实回顾。',
    ) +
    `<div class="grid"><section class="card"><h2>体重记录</h2><form id="weightform" class="form-grid"><label>日期<input name="date" type="date" max="${date()}" value="${date()}" required></label><label>体重 / kg<input name="value" type="number" min="30" max="250" step="0.1" required placeholder="输入体重"></label><button class="span" type="submit">保存体重</button></form>${latest.length ? `<div class="chart" role="img" aria-label="最近${latest.length}次体重记录，原始数值在下方列表"><!-- 以最近数据的相对变化绘图 -->${latest.map((w) => `<div style="height:${50 + ((Number(w.value) - Math.min(...latest.map((x) => Number(x.value)))) / (Math.max(...latest.map((x) => Number(x.value))) - Math.min(...latest.map((x) => Number(x.value))) || 1)) * 60}%"><span>${esc(w.value)}</span></div>`).join('')}</div><p class="chart-label">相对变化示意；按日期排序，不以柱高代表绝对体重</p>${latest.map((w) => `<div class="history row"><span>${esc(w.date)}</span><b>${esc(w.value)} kg</b></div>`).join('')}` : '<div class="empty" style="margin-top:20px">尚无体重记录，保存后再查看趋势。</div>'}</section><section class="card"><h2>恢复反馈 → 调整提案</h2><p class="muted">用一次手动反馈演示流程。正式版会同时检查训练日志、疼痛与依从性。</p><form id="reviewform"><label>最近训练的恢复感受<select name="fatigue"><option value="good">恢复良好</option><option value="tired">疲劳较明显</option></select></label><button class="secondary" style="margin-top:18px" type="submit">查看演示提案</button></form><div id="proposal"></div>${state.adjusted ? '<div class="notice">已接受减量演示，模板的动态动作减少一组。</div><button class="secondary" id="rollback">恢复基础模板</button>' : ''}</section></div><section class="card"><h2>模板版本记录</h2>${state.history.map((v) => `<div class="history">版本 ${v.version} · ${esc(v.reason)} · ${v.profile.days} 次/周 · ${v.adjusted ? '减量' : '基础模板'}</div>`).join('')}</section><section class="card"><h2>照片变化追踪 · 下一阶段</h2><p class="muted">正式版将展示同条件照片对比和拍摄日期。当前照片只临时预览，没有长期保存或变化分析。</p><button class="secondary" data-go="body">查看拍摄引导 →</button></section>`
  );
}
/** 从URL的#后读取页面名，生成导航和内容，然后为新生成的元素绑定事件。 */
function render() {
  const route = location.hash.slice(1) || 'today'; // 去掉URL片段开头的#，得到页面名。
  const valid = labels.some(([id]) => id === route) ? route : 'today'; // 未知页面回到首页。
  $('#nav').innerHTML =
    labels
      .map(
        ([id, t], i) =>
          `<a href="#${id}" class="nav-${id} ${id === valid ? 'active' : ''}" ${id === valid ? 'aria-current="page"' : ''}>${icon(i)}<span>${t}</span></a>`,
      )
      .join('') +
    // 手机保留四个高频页面，第五项使用原生details呈现低频入口，支持键盘操作。
    `<details class="mobile-more"><summary class="${['body', 'food'].includes(valid) ? 'active' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg><span>更多</span></summary><div class="more-menu"><a href="#body" ${valid === 'body' ? 'aria-current="page"' : ''}>${icon(1)}身体与资料</a><a href="#food" ${valid === 'food' ? 'aria-current="page"' : ''}>${icon(4)}饮食建议</a></div></details>`;
  $('#content').innerHTML =
    (loadError
      ? `<div class="notice warm" role="alert">${esc(loadError)}<button id="download-raw" class="secondary">下载原始记录</button></div>`
      : '') + { today, body, plan: planView, log: logView, food, progress }[valid]();
  if ($('#download-raw'))
    $('#download-raw').onclick = () => {
      try {
        downloadText(
          localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY) ?? '{}',
          'lianxu-raw-recovery.json',
        );
      } catch (error) {
        toast(error.message);
      }
    };
  bind();
}
/** 绑定当前页面事件；render重建元素后，旧元素上的事件不会自动保留。 */
function bind() {
  document
    .querySelectorAll('[data-go]')
    .forEach((b) => (b.onclick = () => (location.hash = b.dataset.go)));
  document.querySelectorAll('[data-day]').forEach(
    (b) =>
      (b.onclick = () => {
        selectedDay = Number(b.dataset.day);
        render();
      }),
  );
  if ($('#profile'))
    $('#profile').onsubmit = (e) => {
      e.preventDefault();
      const d = new FormData(e.target); // d收集提交表单的字段；e.target就是提交的form。
      const newProfile = {
        // 表单值通常是字符串，数值字段用Number转换后交给核心模块校验。
        age: Number(d.get('age')),
        height: Number(d.get('height')),
        weight: Number(d.get('weight')),
        days: Number(d.get('days')),
        experience: d.get('experience'),
        equipment: d.get('equipment'),
        goal: d.get('goal'),
        availableEquipment: d.getAll('availableEquipment'), // 多选设备的稳定编号列表。
        sessionMinutes: Number(d.get('sessionMinutes')), // 单位分钟。
        movementPreference: d.get('movementPreference'),
        excludedPatterns: d.getAll('excludedPatterns'), // 明确排除标签，不从备注猜测。
        restrictionNotes: d.get('restrictionNotes').trim(),
      };
      try {
        state = advanceVersion(state, newProfile, false, '修改资料与训练条件');
        selectedDay = 0;
        if (!save()) return;
        location.hash = 'plan';
        toast('资料已保存，模板已按设备、时长、偏好和限制更新。');
      } catch (error) {
        $('#profile-error').textContent = error.message;
        $('#profile-error').focus();
      }
    };
  for (let i = 0; i < 3; i++) {
    const input = $(`#photo${i}`);
    if (input)
      input.onchange = () => {
        const file = input.files[0];
        if (!file) return;
        if (!$('#photo-consent').checked) {
          input.value = '';
          toast('请先选择同意本地照片预览。');
          return;
        }
        if (
          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
          file.size > 8 * 1024 * 1024
        ) {
          input.value = '';
          toast('请选择 8 MB 以内的 JPEG、PNG 或 WebP 图片。');
          return;
        }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          if (pictures[i]) URL.revokeObjectURL(pictures[i]);
          pictures[i] = url;
          $(`#preview${i}`).innerHTML =
            `<img src="${url}" alt="${['正面', '背面', '侧面'][i]}照片本地预览">`;
          $(`[data-remove="${i}"]`).disabled = false;
          toast('照片仅在本页预览，没有上传或进行 AI 分析。');
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          input.value = '';
          toast('图片无法解码，请换一张图片。');
        };
        img.src = url;
      };
  }
  document.querySelectorAll('[data-remove]').forEach(
    (b) =>
      (b.onclick = () => {
        const i = b.dataset.remove;
        URL.revokeObjectURL(pictures[i]);
        delete pictures[i];
        $(`#preview${i}`).innerHTML = bodySVG;
        $(`#photo${i}`).value = '';
        b.disabled = true;
        toast('照片预览已删除。');
      }),
  );
  if ($('#photo-consent'))
    $('#photo-consent').onchange = (e) => {
      if (!e.target.checked) {
        Object.values(pictures).forEach(URL.revokeObjectURL);
        pictures = {};
        render();
        toast('已清除全部临时照片。');
      }
    };
  if ($('#current-workout')) workoutPage.bind();
  if ($('#weightform'))
    $('#weightform').onsubmit = (e) => {
      e.preventDefault();
      const d = new FormData(e.target); // 体重表单提交值。
      const item = { date: d.get('date'), value: Number(d.get('value')) }; // 本次日期与kg数值。
      const found = state.weights.findIndex((w) => w.date === item.date); // 已有同日记录的位置，-1表示没有。
      if (found >= 0) state.weights[found] = item;
      else state.weights.push(item);
      state.weights.sort((a, b) => a.date.localeCompare(b.date));
      if (!save()) return;
      render();
      toast(storageOK ? '体重已保存，同日记录可覆盖修改。' : '体重仅在当前页面暂存。');
    };
  if ($('#reviewform'))
    $('#reviewform').onsubmit = (e) => {
      e.preventDefault();
      const tired = new FormData(e.target).get('fatigue') === 'tired';
      const review = createReview(state, tired ? 'tired' : 'good');
      const pain = review.kind === 'blocked';
      $('#proposal').innerHTML = pain
        ? '<div class="notice warm">记录中存在疼痛反馈。先停止相关动作并处理不适，本演示不提供自动训练调整。</div>'
        : review.kind === 'deload'
          ? `<div class="notice"><b>演示提案：降低训练量</b><br>基础模板 ${plan()[0].sets} 组 → ${state.profile.experience === 'beginner' ? 1 : 2} 组，保留动作。<br>依据：你刚刚选择了明显疲劳；真实提案需要更多日志支持。</div><button id="accept">接受演示调整</button>`
          : '<div class="notice">演示结论：保持当前模板。真实回顾需结合多次训练记录。</div>';
      if ($('#accept'))
        $('#accept').onclick = () => {
          state = advanceVersion(state, state.profile, true, '接受减量演示');
          if (!save()) return;
          render();
          toast('已建立新的模板版本。');
        };
    };
  if ($('#rollback'))
    $('#rollback').onclick = () => {
      state = advanceVersion(state, state.profile, false, '恢复基础模板');
      if (!save()) return;
      render();
      toast('已恢复基础模板并建立新版本。');
    };
}
$('#clear').onclick = () => {
  if (!confirm('清空当前新版资料与训练记录？建议先导出备份。旧版原始记录保留在独立存储键。'))
    return;
  try {
    commitState(initialState());
    Object.values(pictures).forEach(URL.revokeObjectURL);
    pictures = {};
    render();
    toast('已清空新版数据，旧版原始记录仍保留。');
  } catch (error) {
    toast(`未清空：${error.message}`);
  }
};
// 另一标签页保存后，当前页面暂时禁止写入，避免静默覆盖别人的修改。
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY && event.newValue !== savedRaw) {
    loadError = '另一页面修改了记录，请刷新后继续。';
    render();
  }
});
// 更多菜单点击外部或按Escape即可收起；监听只注册一次，不随页面重绘重复绑定。
document.addEventListener('click', (event) => {
  if (!event.target.closest('.mobile-more')) $('.mobile-more')?.removeAttribute('open');
});
document.addEventListener('keydown', (event) => {
  const menu = $('.mobile-more[open]');
  if (event.key === 'Escape' && menu) {
    menu.removeAttribute('open');
    menu.querySelector('summary').focus();
  }
});
window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
  $('#content').focus({ preventScroll: true });
});
render();
