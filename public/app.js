import {
  createDefaultState,
  normalizeState,
  createPlan,
  createReview,
  advanceVersion,
} from './core.js';
const $ = (s) => document.querySelector(s);
const defaults = createDefaultState();
let state;
try {
  state = normalizeState(JSON.parse(localStorage.getItem('lianxu-source-v1')));
} catch {
  state = createDefaultState();
}
let pictures = {},
  selectedDay = 0,
  storageOK = true;
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
function esc(v) {
  return String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function save() {
  try {
    localStorage.setItem('lianxu-source-v1', JSON.stringify(state));
    return true;
  } catch {
    storageOK = false;
    toast('浏览器无法保存，当前数据仅在本页暂存。');
    return false;
  }
}
let toastTimer;
function toast(t) {
  $('#toast').textContent = t;
  $('#toast').style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#toast').style.display = 'none'), 4500);
}
const date = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const choice = (arr, value) =>
  arr
    .map(
      ([v, t]) =>
        `<option value="${v}" ${String(value) === String(v) ? 'selected' : ''}>${t}</option>`,
    )
    .join('');
const heading = (k, t, s) =>
  `<div class="heading"><div class="eyebrow">${k}</div><h1>${t}</h1><p class="sub">${s}</p></div>`;
function plan() {
  return createPlan(state.profile, state.adjusted);
}
function today() {
  const p = state.profile;
  return (
    heading('YOUR OWN PACE', '让每一次训练，都有方向。', '先建立适合自己的节奏，再一起关注变化。') +
    `<section class="hero"><div><div class="eyebrow">NEXT SESSION / 模板示例</div><h2>${plan()[0].name}<br>从一次稳稳的训练开始</h2><p>${p.equipment === 'home' ? '居家 · 哑铃与自重' : '健身房 · 器械与自由重量'} / 每周 ${p.days} 次 / 版本 ${state.version}</p><button data-go="log">开始记录训练 →</button></div><div class="hero-art"><div class="orbit"></div><svg viewBox="0 0 240 240" aria-hidden="true"><path d="M42 140c24-2 31-64 70-62s42 62 81 24" stroke="#cdebb8" stroke-width="16" stroke-linecap="round" fill="none"/><circle cx="192" cy="102" r="9" fill="#f3ceaa"/><path d="M51 173h132" stroke="#729880" stroke-width="1"/><text x="55" y="202" fill="#dfebdf" font-size="12" letter-spacing="4">KEEP MOVING</text></svg></div></section><div class="metric-grid"><div class="metric"><small>已记训练组数</small><b>${state.logs.length}</b><small>你的本地记录</small></div><div class="metric"><small>最近记录体重</small><b>${state.weights.length ? esc(state.weights.at(-1).value) : '—'}</b><small>${state.weights.length ? 'kg · 你的记录' : '尚未记录'}</small></div><div class="metric"><small>计划训练频率</small><b>${p.days}<small style="display:inline"> 次 / 周</small></b><small>可在资料中修改</small></div></div><div class="grid"><section class="card"><div class="row"><h2>这一周，循序向前</h2><span class="tag">排期示例</span></div><p class="muted">训练日之间安排恢复，具体时间由你决定。</p><div class="week">${['一', '二', '三', '四', '五', '六', '日'].map((d, i) => `<div class="day ${[0, 2, 4, ...(p.days === 4 ? [5] : [])].includes(i) ? 'on' : ''}"><b>周${d}</b>${[0, 2, 4, ...(p.days === 4 ? [5] : [])].includes(i) ? '训练' : '恢复'}</div>`).join('')}</div></section><section class="card"><div class="eyebrow">START WITH YOU</div><h2>身体资料，是计划的起点</h2><p class="muted">经验、设备和你的目标比一张照片更完整。照片可以跳过。</p><button class="secondary" data-go="body">完善我的资料 →</button></section></div>`
  );
}
function body() {
  const p = state.profile;
  return (
    heading(
      'KNOW YOURSELF',
      '先了解你，再决定怎么练。',
      '新手居家和健身房进阶，都从同一份资料开始。',
    ) +
    `<div class="notice">初始值为虚构示例，请按需修改。原型只按经验、设备与频率切换训练模板，不会分析你的照片。</div><div class="grid"><section class="card"><h2>我的基础资料</h2><form id="profile"><div class="form-grid"><label>年龄<input name="age" type="number" min="18" max="100" value="${p.age}" required></label><label>身高 / cm<input name="height" type="number" min="100" max="230" value="${p.height}" required></label><label>体重 / kg<input name="weight" type="number" min="30" max="250" step="0.1" value="${p.weight}" required></label><label>训练经验<select name="experience">${choice(
      [
        ['beginner', '零基础 / 刚开始'],
        ['experienced', '有持续训练经验'],
      ],
      p.experience,
    )}</select></label><label>可用设备<select name="equipment">${choice(
      [
        ['home', '居家：哑铃 + 自重'],
        ['gym', '健身房：器械 + 自由重量'],
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
    )}</select></label></div><p class="muted" style="margin-top:16px">本原型尚未收集伤病、时长和饮食限制；正式版会补齐后再生成个人建议。</p><button type="submit">保存资料并查看模板 →</button></form></section><section class="card"><h2>观察身体，不给身体打分</h2><p>照片反馈会展示可见线条、比例和拍摄局限，再与你的目标一起讨论训练方向。</p><div class="notice warm"><b>体脂范围：暂不可用</b><br>模型尚未验证，原型不输出体脂百分比或肌肉量。</div><p class="muted">身高、体重、力量和伤病都由你提供。图片不是这些资料的替代品。</p></section></div><section class="card"><div class="row"><h2>三视角照片 · 可跳过</h2><span class="tag">仅本页临时预览</span></div><p class="muted">正面、背面、侧面；同一光线和距离，自然站姿，穿贴身运动服，无需露脸。支持 JPEG / PNG / WebP，单张不超过 8 MB。</p><label class="check"><input type="checkbox" id="photo-consent" ${Object.keys(pictures).length ? 'checked' : ''}>我选择在浏览器中预览照片；照片不会上传，刷新页面即清除。</label><div class="photos">${['正面', '背面', '侧面'].map((v, i) => `<div class="photo"><label for="photo${i}">${v}</label><div id="preview${i}">${pictures[i] ? `<img src="${pictures[i]}" alt="${v}照片本地预览">` : bodySVG}</div><input type="file" id="photo${i}" accept="image/jpeg,image/png,image/webp" aria-label="选择${v}照片"><button class="link" data-remove="${i}" ${pictures[i] ? '' : 'disabled'}>删除${v}照片</button></div>`).join('')}</div><p class="muted" style="margin-top:16px">未接入质量检查与 AI，选取照片不会改变分析结果。你也可以直接查看训练模板。</p></section>`
  );
}
function planView() {
  let sessions = plan();
  selectedDay = Math.min(selectedDay, sessions.length - 1);
  const s = sessions[selectedDay];
  return (
    heading(
      'YOUR TRAINING BLUEPRINT',
      '适合你的节奏，才更容易坚持。',
      '这是根据设备、经验和频率切换的规则模板，尚未经过个人 AI 分析。',
    ) +
    `<div class="chips"><span class="chip">${state.profile.experience === 'beginner' ? '新手起步' : '训练进阶'}</span><span class="chip">${state.profile.equipment === 'home' ? '居家训练' : '健身房训练'}</span><span class="chip">每周 ${state.profile.days} 次</span><span class="chip">版本 ${state.version}</span></div><div class="tabs" aria-label="训练日">${sessions.map((s, i) => `<button data-day="${i}" aria-pressed="${i === selectedDay}" class="${i === selectedDay ? 'selected' : ''}">${s.name}</button>`).join('')}</div><div class="grid"><section class="card"><h2>${s.name}</h2>${s.exercises.map((e, i) => `<div class="session"><span class="number">0${i + 1}</span><div class="detail"><h3>${e}</h3><small>${e === '平板支撑' ? `${s.sets} 组 × 20–30 秒` : `${s.sets} 组 × ${s.reps} 次`} · 休息 90–120 秒</small></div></div>`).join('')}<button style="margin-top:22px" data-go="log">记录这一练 →</button></section><section class="card"><h2>为什么这样安排？</h2><p>${state.profile.days === 3 ? '全身训练模板让一周三次都覆盖主要动作模式。' : '上下肢模板把训练量分散到四次训练中。'}</p><p>${state.profile.experience === 'beginner' ? '先熟悉动作和记录方式，再逐步增加训练量。' : '用实际组次与恢复反馈讨论进阶，初始重量仍需自己确认。'}</p><div class="notice">不确定动作是否适合或出现疼痛时，停止相关动作并寻求合适指导。</div><p class="muted">此处组次是交互演示。正式版会结合时长、限制、动作教学与可替代选项。</p></section></div>`
  );
}
function logView() {
  const exercises = plan()[Math.min(selectedDay, plan().length - 1)].exercises;
  return (
    heading(
      'SHOW UP & WRITE IT DOWN',
      '记录你完成的，而不只是计划的。',
      '每组的重量、次数和感受，将成为下一次调整的依据。',
    ) +
    `<div class="grid"><section class="card"><h2>记录一组训练</h2><form id="logform"><label>动作<select name="exercise">${exercises
      .filter((e) => e !== '平板支撑')
      .map((e) => `<option>${e}</option>`)
      .join(
        '',
      )}</select></label><div class="log-grid" style="margin-top:18px"><label>负重 / kg<input name="load" type="number" min="0" max="400" step="0.5" placeholder="例如 10" required></label><label>次数<input name="reps" type="number" min="1" max="100" placeholder="例如 10" required></label><label>剩余次数 RIR<select name="rir">${choice(
      [
        [3, '3 次以上'],
        [2, '2 次'],
        [1, '1 次'],
        [0, '0 次'],
      ],
      2,
    )}</select></label></div><label class="check"><input name="pain" type="checkbox">这组动作出现疼痛或不适</label><button type="submit">保存这一组</button></form><p class="muted" style="margin-top:16px">RIR 指结束时估计还能完成几次。哑铃负重按单只记录；真实产品会为各动作统一约定单位。</p></section><section class="card"><h2>你的本地训练记录</h2>${
      state.logs.length
        ? state.logs
            .slice(-5)
            .reverse()
            .map(
              (l) =>
                `<div class="history"><b>${esc(l.exercise)}</b><br>${esc(l.load)} kg × ${esc(l.reps)} 次 · RIR ${esc(l.rir)} · ${l.pain ? '疼痛反馈' : '无疼痛反馈'}<br><span class="muted">${esc(l.date)} / 版本 ${l.version}</span></div>`,
            )
            .join('')
        : '<div class="empty">还没有记录。<br>保存第一组后，会在这里显示。</div>'
    }</section></div>`
  );
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
  const latest = state.weights.slice(-7);
  return (
    heading(
      'SMALL STEPS, REAL CHANGE',
      '关注趋势，也关注你的感受。',
      '示例调整展示用户确认流程，不替代基于长期记录的真实回顾。',
    ) +
    `<div class="grid"><section class="card"><h2>体重记录</h2><form id="weightform" class="form-grid"><label>日期<input name="date" type="date" max="${date()}" value="${date()}" required></label><label>体重 / kg<input name="value" type="number" min="30" max="250" step="0.1" required placeholder="输入体重"></label><button class="span" type="submit">保存体重</button></form>${latest.length ? `<div class="chart" role="img" aria-label="最近${latest.length}次体重记录，原始数值在下方列表"><!-- 以最近数据的相对变化绘图 -->${latest.map((w) => `<div style="height:${50 + ((Number(w.value) - Math.min(...latest.map((x) => Number(x.value)))) / (Math.max(...latest.map((x) => Number(x.value))) - Math.min(...latest.map((x) => Number(x.value))) || 1)) * 60}%"><span>${esc(w.value)}</span></div>`).join('')}</div><p class="chart-label">相对变化示意；按日期排序，不以柱高代表绝对体重</p>${latest.map((w) => `<div class="history row"><span>${esc(w.date)}</span><b>${esc(w.value)} kg</b></div>`).join('')}` : '<div class="empty" style="margin-top:20px">尚无体重记录，保存后再查看趋势。</div>'}</section><section class="card"><h2>恢复反馈 → 调整提案</h2><p class="muted">用一次手动反馈演示流程。正式版会同时检查训练日志、疼痛与依从性。</p><form id="reviewform"><label>最近训练的恢复感受<select name="fatigue"><option value="good">恢复良好</option><option value="tired">疲劳较明显</option></select></label><button class="secondary" style="margin-top:18px" type="submit">查看演示提案</button></form><div id="proposal"></div>${state.adjusted ? '<div class="notice">已接受减量演示，模板的动态动作减少一组。</div><button class="secondary" id="rollback">恢复基础模板</button>' : ''}</section></div><section class="card"><h2>模板版本记录</h2>${state.history.map((v) => `<div class="history">版本 ${v.version} · ${esc(v.reason)} · ${v.profile.days} 次/周 · ${v.adjusted ? '减量' : '基础模板'}</div>`).join('')}</section><section class="card"><h2>照片变化追踪 · 下一阶段</h2><p class="muted">正式版将展示同条件照片对比和拍摄日期。当前照片只临时预览，没有长期保存或变化分析。</p><button class="secondary" data-go="body">查看拍摄引导 →</button></section>`
  );
}
function render() {
  const route = location.hash.slice(1) || 'today';
  const valid = labels.some(([id]) => id === route) ? route : 'today';
  $('#nav').innerHTML = labels
    .map(
      ([id, t], i) =>
        `<a href="#${id}" class="${id === valid ? 'active' : ''}" ${id === valid ? 'aria-current="page"' : ''}>${icon(i)}${t}</a>`,
    )
    .join('');
  $('#content').innerHTML = { today, body, plan: planView, log: logView, food, progress }[valid]();
  bind();
}
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
      const d = new FormData(e.target);
      const newProfile = {
        age: Number(d.get('age')),
        height: Number(d.get('height')),
        weight: Number(d.get('weight')),
        days: Number(d.get('days')),
        experience: d.get('experience'),
        equipment: d.get('equipment'),
        goal: d.get('goal'),
      };
      state = advanceVersion(state, newProfile, false, '修改资料');
      selectedDay = 0;
      save();
      location.hash = 'plan';
      toast('资料已更新：训练模板按设备、经验和频率切换。');
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
  if ($('#logform'))
    $('#logform').onsubmit = (e) => {
      e.preventDefault();
      const d = new FormData(e.target);
      state.logs.push({
        exercise: d.get('exercise'),
        load: Number(d.get('load')),
        reps: Number(d.get('reps')),
        rir: Number(d.get('rir')),
        pain: d.has('pain'),
        date: date(),
        version: state.version,
      });
      save();
      render();
      toast(
        d.has('pain')
          ? '记录已暂存：出现疼痛时请停止相关动作，回顾不会建议加量。'
          : storageOK
            ? '训练组已保存到本地。'
            : '记录仅在当前页面暂存。',
      );
    };
  if ($('#weightform'))
    $('#weightform').onsubmit = (e) => {
      e.preventDefault();
      const d = new FormData(e.target);
      const item = { date: d.get('date'), value: Number(d.get('value')) };
      const found = state.weights.findIndex((w) => w.date === item.date);
      if (found >= 0) state.weights[found] = item;
      else state.weights.push(item);
      state.weights.sort((a, b) => a.date.localeCompare(b.date));
      save();
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
          save();
          render();
          toast('已建立新的模板版本。');
        };
    };
  if ($('#rollback'))
    $('#rollback').onclick = () => {
      state = advanceVersion(state, state.profile, false, '恢复基础模板');
      save();
      render();
      toast('已恢复基础模板并建立新版本。');
    };
}
$('#clear').onclick = () => {
  if (confirm('清除这个浏览器中的资料、训练、体重记录和临时照片？')) {
    Object.values(pictures).forEach(URL.revokeObjectURL);
    pictures = {};
    state = createDefaultState();
    try {
      localStorage.removeItem('lianxu-source-v1');
    } catch {
      storageOK = false;
    }
    render();
    toast('已清除本地数据，恢复虚构示例资料。');
  }
};
window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
  $('#content').focus({ preventScroll: true });
});
render();
