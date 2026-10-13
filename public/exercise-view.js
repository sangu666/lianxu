import {
  BUILTIN_EXERCISES,
  findBuiltinExercise,
  BODY_LABELS,
  DEVICE_LABELS,
  MUSCLE_LABELS,
  escapeExerciseText as esc,
  searchExercises,
  exerciseDeviceGroup,
  exerciseDisplayName,
} from './exercise-catalog.js';

let remoteDetail = null; // 账户模式使用数据库详情；静态模式继续按需读取公开文字文件。
/** 配置只读动作接口，不涉及个人资料或照片。 */
export function configureExerciseDetails(loader) {
  remoteDetail = loader;
}

/** 共用动作详情正文；外部说明全部转义，来源链接固定，不使用数据里的任意URL。 */
export function exerciseDetailHtml(item, { includeTitle = true } = {}) {
  const community = item.origin === 'community';
  return `${includeTitle ? `<h2 id="exercise-detail-title">${esc(exerciseDisplayName(item))}</h2>` : ''}${community ? `<p class="muted">英文原名：<span lang="en">${esc(item.name)}</span></p>` : ''}<p class="muted">${esc(BODY_LABELS[item.bodyPart] ?? item.bodyPart)} · 主要目标：${esc(MUSCLE_LABELS[item.target] ?? item.target)}</p>
    <div class="notice"><b>主要设备：${esc(DEVICE_LABELS[item.equipment] ?? item.equipment)}</b><p>${community ? '来源只标注主要设备，可能还需要凳子、固定点或其他支撑。计量单位未指定，请勿直接作为训练处方。' : `记录单位：${item.unit === 'seconds' ? '秒' : '次'}；负重使用 kg，自重记 0 kg，哑铃按单只重量记录。请确认场地及支撑安全。`}</p></div>
    ${item.secondaryMuscles.length ? `<p>辅助肌群：${item.secondaryMuscles.map((muscle) => esc(MUSCLE_LABELS[muscle] ?? muscle)).join('、')}</p>` : ''}
    <h3>动作步骤</h3><ol class="exercise-steps">${item.stepsZh.map((step) => `<li>${esc(step)}</li>`).join('')}</ol>
    ${item.mistake ? `<h3>容易忽略的要点</h3><p>${esc(item.mistake)}</p>` : ''}
    ${item.stepsEn.length ? `<details><summary>查看英文原文</summary><ol class="exercise-steps">${item.stepsEn.map((step) => `<li>${esc(step)}</li>`).join('')}</ol></details>` : ''}
    <p class="muted">${community ? '社区数据原文，未经过练序逐项专业审校；部分译文或标签可能不准确。' : '练序编写的基础文字提示，尚未经过专业教练逐项审校。'}这不是个人训练建议；出现疼痛时停止相关动作。</p>
    <p class="muted">编号：${esc(item.id)}${community ? ' · 来源：<a href="https://github.com/hasaneyldrm/exercises-dataset" target="_blank" rel="noopener noreferrer">exercises-dataset</a> · MIT 文字数据，不含图片或 GIF' : ' · 练序模板动作'}</p>`;
}

/** 独立对话框不重建训练页面，查看要点后保留尚未保存的表单输入和键盘焦点。 */
export function showExerciseDetail(item, trigger) {
  document.querySelector('#exercise-detail')?.close();
  const dialog = document.createElement('dialog');
  dialog.id = 'exercise-detail';
  dialog.className = 'exercise-dialog';
  dialog.setAttribute('aria-labelledby', 'exercise-detail-title');
  // 标题与关闭按钮留在顶部，长说明仅滚动正文；关闭入口始终位于右上角。
  dialog.innerHTML = `<header class="exercise-dialog-header"><h2 id="exercise-detail-title">${esc(exerciseDisplayName(item))}</h2><button type="button" class="secondary exercise-close" aria-label="关闭动作详情" title="关闭动作详情" autofocus><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header><div class="exercise-dialog-body">${exerciseDetailHtml(item, { includeTitle: false })}</div>`;
  dialog.querySelector('button').onclick = () => dialog.close();
  dialog.addEventListener(
    'close',
    () => {
      dialog.remove();
      if (trigger?.isConnected) trigger.focus();
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
}

/** 绑定模板动作入口；未知历史名称不冒充已知动作，也不更改旧训练记录。 */
export function bindBuiltinDetails() {
  document.querySelectorAll('[data-exercise-detail]').forEach((button) => {
    button.onclick = async () => {
      const id = button.dataset.exerciseDetail;
      if (remoteDetail) {
        button.disabled = true;
        try {
          const item = await remoteDetail(id);
          if (button.isConnected) showExerciseDetail(item, button);
        } catch (error) {
          button.textContent = `加载失败，点击重试：${error.message}`;
        } finally {
          button.disabled = false;
        }
        return;
      }
      let item = findBuiltinExercise(id);
      if (!item && id.startsWith('hasaneyldrm:')) {
        const label = button.textContent;
        button.disabled = true;
        button.textContent = '正在加载动作说明…';
        try {
          item = (await import('./data/exercises.js')).IMPORTED_EXERCISES.find(
            (entry) => entry.id === id,
          );
        } catch {
          button.textContent = '说明加载失败，点击重试';
        } finally {
          button.disabled = false;
          if (item) button.textContent = label;
        }
      }
      if (item && button.isConnected) showExerciseDetail(item, button);
    };
  });
}

/** 创建动作库页面。1.6 MB 社区文本仅在访问此页时加载，不写入用户备份或存储。
 * @param {{render: Function, isVisible: Function, load?: Function}} options 页面刷新与可见性回调；load供失败场景测试。
 */
export function createExerciseLibrary({
  render,
  isVisible,
  load = () => import('./data/exercises.js'),
}) {
  let rows = null,
    loading = false,
    error = ''; // 与用户健康数据分开的只读目录加载状态。
  let filters = { query: '', body: '', device: '', page: 1 }; // 页号从1开始，筛选改变后回到第一页。
  async function ensureLoaded() {
    if (rows || loading) return;
    loading = true;
    error = '';
    if (isVisible()) render(); // 请求开始即显示加载状态；重入bind时loading会阻止重复请求。
    try {
      const module = await load();
      rows = [...BUILTIN_EXERCISES, ...module.IMPORTED_EXERCISES];
    } catch {
      error = '社区动作资料加载失败，请检查本地服务并重试。';
    } finally {
      loading = false;
      if (isVisible()) render(); // 异步返回时不打断用户已切换到的训练页面。
    }
  }
  function html() {
    const options = (dictionary, selected, values) =>
      `<option value="">全部</option>${values.map((value) => `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(dictionary[value] ?? value)}</option>`).join('')}`;
    const result = searchExercises(rows ?? BUILTIN_EXERCISES, filters);
    return `<div class="heading"><div class="eyebrow">LEARN THE MOVEMENT</div><h1>认识动作，练得更明白。</h1><p class="sub">18 个模板动作 + 1,324 条社区资料。中文名称与步骤，英文原名可在详情中核对。</p></div>
      <section class="card"><form id="exercise-search" class="library-filters"><label>搜索动作<input name="query" type="search" maxlength="100" placeholder="名称、肌群或中文步骤" value="${esc(filters.query)}"></label><label>身体部位<select name="body">${options(BODY_LABELS, filters.body, Object.keys(BODY_LABELS))}</select></label><label>主要设备<select name="device">${options(DEVICE_LABELS, filters.device, [...new Set((rows ?? BUILTIN_EXERCISES).map((item) => exerciseDeviceGroup(item.equipment)))].sort())}</select></label><button type="submit">搜索与筛选</button></form>
      <p class="muted">支持中文和英文搜索；社区资料供查阅，暂不自动用于排课。此版未导入图片、GIF 或视频。</p>
      ${loading ? '<p role="status">正在加载社区动作资料…</p>' : ''}${error ? `<p role="alert">${error}</p><button id="retry-exercises" class="secondary">重新加载资料</button>` : ''}
      <p role="status">找到 ${result.total} 个动作 · 第 ${result.page} / ${result.pages} 页</p></section>
      <div class="library-grid">${result.items.map((item) => `<article class="card exercise-card"><span class="tag">${item.origin === 'builtin' ? '模板动作' : '社区资料'}</span><h2>${esc(exerciseDisplayName(item))}</h2><p>${esc(BODY_LABELS[item.bodyPart] ?? item.bodyPart)} · ${esc(MUSCLE_LABELS[item.target] ?? item.target)}</p><p class="muted">${esc(DEVICE_LABELS[item.equipment] ?? item.equipment)}</p><button class="secondary" data-library-detail="${esc(item.id)}">查看 ${esc(exerciseDisplayName(item))} 的要点</button></article>`).join('') || '<section class="card empty">没有匹配动作，请更换关键词或筛选条件。</section>'}</div>
      <div class="actions library-pages"><button class="secondary" data-library-page="${result.page - 1}" ${result.page === 1 ? 'disabled' : ''}>上一页</button><span>${result.page} / ${result.pages}</span><button class="secondary" data-library-page="${result.page + 1}" ${result.page === result.pages ? 'disabled' : ''}>下一页</button></div>`;
  }
  function bind() {
    document.querySelector('#exercise-search').onsubmit = (event) => {
      event.preventDefault();
      const fields = new FormData(event.target);
      filters = {
        query: fields.get('query'),
        body: fields.get('body'),
        device: fields.get('device'),
        page: 1,
      };
      render();
    };
    document.querySelector('#retry-exercises')?.addEventListener('click', () => {
      void ensureLoaded();
      render();
    });
    document.querySelectorAll('[data-library-page]').forEach(
      (button) =>
        (button.onclick = () => {
          filters.page = Number(button.dataset.libraryPage);
          render();
          document.querySelector('#exercise-search').scrollIntoView({ block: 'start' });
        }),
    );
    document.querySelectorAll('[data-library-detail]').forEach(
      (button) =>
        (button.onclick = () => {
          const item = (rows ?? BUILTIN_EXERCISES).find(
            (entry) => entry.id === button.dataset.libraryDetail,
          );
          if (item) showExerciseDetail(item, button);
        }),
    );
    // 首次加载或点击重试才发起请求，失败后避免每次render都触发无休止重试。
    if (!rows && !loading && !error) void ensureLoaded();
  }
  return { html, bind, ensureLoaded };
}
