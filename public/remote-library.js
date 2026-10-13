import { BODY_LABELS, DEVICE_LABELS, escapeExerciseText as esc } from './exercise-catalog.js';
import { bindBuiltinDetails } from './exercise-view.js';

/** 数据库动作库按页加载，旧请求序号阻止慢响应覆盖用户刚选择的筛选条件。 */
export function createRemoteLibrary({ api, render }) {
  let filters = { q: '', bodyPart: '', equipment: '', page: 1 },
    result = null,
    choices = null,
    error = '',
    loading = false,
    serial = 0;
  async function load() {
    const ticket = ++serial;
    loading = true;
    error = '';
    render();
    const selected = { ...filters }; // 固定本次查询，避免筛选字典加载期间读到下次条件。
    try {
      if (!choices) choices = await api.request('/exercise-filters');
      const params = new URLSearchParams({ page: String(selected.page), pageSize: '24' });
      for (const key of ['q', 'bodyPart', 'equipment'])
        if (selected[key]) params.set(key, selected[key]);
      const data = await api.request(`/exercises?${params}`);
      if (ticket === serial) result = data;
    } catch (failure) {
      if (ticket === serial) error = failure.message;
    } finally {
      if (ticket === serial) {
        loading = false;
        if (location.hash === '#library') render();
      }
    }
  }
  function html() {
    const options = (values, labels, current) =>
      '<option value="">全部</option>' +
      (values ?? [])
        .map(
          (value) =>
            `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(labels[value] ?? value)}</option>`,
        )
        .join('');
    return `<div class="heading"><div class="eyebrow">LEARN THE MOVEMENT</div><h1>认识动作，练得更明白。</h1><p class="sub">数据库动作库 · 中文文字说明 · 暂无 GIF / 视频</p></div><section class="card"><form id="remote-search" class="library-filters"><label>搜索动作<input name="q" type="search" maxlength="100" value="${esc(filters.q)}"></label><label>身体部位<select name="bodyPart">${options(choices?.bodyParts, BODY_LABELS, filters.bodyPart)}</select></label><label>主要设备<select name="equipment">${options(choices?.equipment, DEVICE_LABELS, filters.equipment)}</select></label><button type="submit">搜索</button></form><p role="status">${loading ? '正在加载动作…' : result ? `找到 ${result.pagination.total} 个动作` : '等待加载'}</p>${error ? `<p class="error-text" role="alert">${esc(error)}</p><button id="remote-retry" class="secondary">重试</button>` : ''}</section><div class="library-grid">${(error || loading ? [] : (result?.items ?? [])).map((item) => `<article class="card exercise-card"><span class="tag">${item.origin === 'builtin' ? '模板动作' : '社区资料'}</span><h2>${esc(item.nameZh)}</h2><p>${esc(BODY_LABELS[item.bodyPart] ?? item.bodyPart)} · ${esc(DEVICE_LABELS[item.equipment] ?? item.equipment)}</p><button class="secondary" data-exercise-detail="${esc(item.id)}">查看动作要点</button></article>`).join('')}${!loading && !error && result?.pagination.total === 0 ? '<p class="empty">没有匹配动作，请调整筛选。</p>' : ''}</div>${result && !loading && !error ? `<div class="actions"><button class="secondary" id="remote-prev" ${filters.page <= 1 ? 'disabled' : ''}>上一页</button><span>${filters.page} / ${Math.max(1, result.pagination.totalPages)}</span><button class="secondary" id="remote-next" ${filters.page >= result.pagination.totalPages ? 'disabled' : ''}>下一页</button></div>` : ''}`;
  }
  function bind() {
    document.querySelector('#remote-search').onsubmit = (event) => {
      event.preventDefault();
      const fields = new FormData(event.target);
      filters = {
        q: fields.get('q'),
        bodyPart: fields.get('bodyPart'),
        equipment: fields.get('equipment'),
        page: 1,
      };
      void load();
    };
    document.querySelector('#remote-retry')?.addEventListener('click', () => void load());
    document.querySelector('#remote-prev')?.addEventListener('click', () => {
      filters.page--;
      void load();
    });
    document.querySelector('#remote-next')?.addEventListener('click', () => {
      filters.page++;
      void load();
    });
    bindBuiltinDetails();
    if (!result && !loading && !error) void load();
  }
  return { html, bind };
}
