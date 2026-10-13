import {
  PLAN_CATALOG,
  activePlanDays,
  findPlanExercise,
  draftFromState,
  parsePlanDraft,
  planWarnings,
  acceptEditablePlan,
} from './plan-document.js';
import {
  BODY_LABELS,
  DEVICE_LABELS,
  exerciseDeviceGroup,
  escapeExerciseText as esc,
  searchExercises,
} from './exercise-catalog.js';
import { bindBuiltinDetails } from './exercise-view.js';
import { downloadText } from './workout-view.js';

/** 共享弹层：固定右上角关闭，正文滚动，取消后恢复原触发按钮焦点。 */
function editorDialog(title, label, trigger) {
  const dialog = document.createElement('dialog');
  dialog.className = 'exercise-dialog plan-editor-dialog';
  dialog.setAttribute('aria-labelledby', 'plan-editor-title');
  dialog.innerHTML = `<header class="exercise-dialog-header"><h2 id="plan-editor-title">${esc(title)}</h2><button type="button" class="secondary exercise-close" aria-label="${esc(label)}" autofocus><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header><div class="exercise-dialog-body"></div>`;
  dialog.querySelector('.exercise-close').onclick = () => dialog.close();
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
  return dialog;
}
const targetLabel = (action) =>
  `${action.sets}组 × ${action.targetMin}–${action.targetMax}${action.unit === 'seconds' ? '秒' : '次'} · 休息${action.restSeconds}秒`;
const warningsHtml = (warnings) =>
  warnings.length
    ? `<div class="notice warm"><b>请核对后再保存</b><ul>${warnings.map((warning) => `<li>${esc(warning)}</li>`).join('')}</ul></div><label class="check"><input name="acknowledge" type="checkbox">我已核对以上设备、单位与训练条件提醒</label>`
    : '';

/** 从整个目录选择或编辑动作；position为空代表新增，编号始终来自目录，计量目标由用户确认。 */
export function openPlanPicker(
  { getState, commit, render, toast },
  dayIndex,
  position,
  trigger,
  editOnly = false,
  preferredId,
) {
  const initial = getState(),
    expectedVersion = initial.version;
  const days = activePlanDays(initial),
    original = days[dayIndex]?.actions[position];
  const dialog = editorDialog(
    position === null ? '从全库新增动作' : '从全库选择动作',
    '关闭全库选动作',
    trigger,
  );
  const body = dialog.querySelector('.exercise-dialog-body');
  let filters = { query: '', body: '', device: '', page: 1 };
  function choose(item) {
    // 不同单位不沿用旧目标；社区的新动作不猜单位，必须明确选择。
    const unit =
      item.unit === 'unspecified'
        ? item.id === original?.exerciseId
          ? original.unit
          : ''
        : item.unit;
    const sameUnit = unit && unit === original?.unit;
    const min = sameUnit ? original.targetMin : '',
      max = sameUnit ? original.targetMax : '';
    body.innerHTML = `<button type="button" class="link" id="picker-back">返回动作列表</button><h3>${esc(item.name)}</h3><p>${esc(DEVICE_LABELS[item.equipment] ?? item.equipment)}</p><form id="action-target"><div class="form-grid"><label>记录单位<select name="unit" required>${item.unit === 'unspecified' ? `<option value="">请选择单位</option><option value="reps" ${unit === 'reps' ? 'selected' : ''}>次数</option><option value="seconds" ${unit === 'seconds' ? 'selected' : ''}>秒数</option>` : `<option value="${unit}">${unit === 'seconds' ? '秒数' : '次数'}</option>`}</select></label><label>计划组数<input name="sets" type="number" min="1" max="10" value="${original?.sets ?? 2}" required></label><label>目标下限<input name="targetMin" type="number" min="1" max="${unit === 'seconds' ? 3600 : 100}" value="${min}" required></label><label>目标上限<input name="targetMax" type="number" min="1" max="${unit === 'seconds' ? 3600 : 100}" value="${max}" required></label><label>休息 / 秒<input name="restSeconds" type="number" min="0" max="600" value="${original?.restSeconds ?? 90}" required></label></div><label>安排理由<textarea name="reason" maxlength="1000" rows="2">${esc(item.id === original?.exerciseId ? original.reason : `手动选择${item.name}`)}</textarea></label><p class="muted">跨动作类型允许选择；更换单位需重新填写目标。新动作不沿用原动作的重量成绩。确认仅影响后续新训练。</p><div id="target-warnings"></div><p id="target-error" class="error-text" role="alert"></p><button type="submit">确认保存动作与目标</button></form>`;
    body.querySelector('#picker-back').onclick = drawList;
    const form = body.querySelector('form');
    const proposed = () => {
      const fields = new FormData(form);
      const plan = parsePlanDraft(JSON.stringify(draftFromState(getState())));
      const action = {
        exerciseId: item.id,
        name: item.name,
        unit: fields.get('unit'),
        sets: Number(fields.get('sets')),
        targetMin: Number(fields.get('targetMin')),
        targetMax: Number(fields.get('targetMax')),
        restSeconds: Number(fields.get('restSeconds')),
        reason: fields.get('reason'),
        acknowledged: false,
      };
      if (position === null) plan.days[dayIndex].actions.push(action);
      else plan.days[dayIndex].actions[position] = action;
      plan.origin = 'manual';
      return plan;
    };
    const extraWarnings = [];
    const source = findPlanExercise(original?.exerciseId);
    if (source && source.bodyPart !== item.bodyPart)
      extraWarnings.push('新动作的身体部位分类与原动作不同，请核对训练目的。');
    if (original && (!unit || unit !== original.unit))
      extraWarnings.push('记录单位可能改变，请重新确认目标，不照搬旧次数或秒数。');
    body.querySelector('#target-warnings').innerHTML = warningsHtml([
      ...extraWarnings,
      ...planWarnings(proposed(), getState().profile),
    ]);
    form.elements.unit.onchange = () => {
      for (const name of ['targetMin', 'targetMax']) {
        form.elements[name].value = '';
        form.elements[name].max = form.elements.unit.value === 'seconds' ? 3600 : 100;
      }
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      try {
        const plan = proposed(),
          acknowledge = new FormData(form).has('acknowledge');
        if (extraWarnings.length && !acknowledge) throw new Error('请先核对动作类型与单位变化提醒');
        const next = acceptEditablePlan(getState(), plan, {
          expectedVersion,
          acknowledge,
          reason: `${position === null ? '新增' : '编辑/替换'}动作：${item.name}`,
        });
        await commit(next);
        dialog.close();
        render();
        toast(`已保存计划版本 ${next.version}，后续新训练使用新动作。`);
      } catch (error) {
        body.querySelector('#target-error').textContent = error.message;
      }
    };
  }
  function drawList() {
    const result = searchExercises(PLAN_CATALOG, filters);
    const options = (dictionary, value, keys) =>
      `<option value="">全部</option>${keys.map((key) => `<option value="${esc(key)}" ${value === key ? 'selected' : ''}>${esc(dictionary[key] ?? key)}</option>`).join('')}`;
    body.innerHTML = `<p>全部 ${PLAN_CATALOG.length} 个动作都可选择；选择后核对设备、单位和目标，不限同类动作。</p><form id="picker-search" class="form-grid"><label>搜索全库动作<input type="search" name="query" value="${esc(filters.query)}" maxlength="100"></label><label>部位<select name="body">${options(BODY_LABELS, filters.body, Object.keys(BODY_LABELS))}</select></label><label>设备<select name="device">${options(DEVICE_LABELS, filters.device, [...new Set(PLAN_CATALOG.map((item) => exerciseDeviceGroup(item.equipment)))].sort())}</select></label><button type="submit">搜索全库</button></form><p role="status">找到 ${result.total} 个动作 · 第${result.page}/${result.pages}页</p>${result.items.map((item) => `<section class="replacement-option"><span class="tag">${item.origin === 'builtin' ? '模板动作' : '社区资料'}</span><h3>${esc(item.name)}</h3><small>动作编号：${esc(item.id)}</small><p>${esc(BODY_LABELS[item.bodyPart] ?? item.bodyPart)} · ${esc(DEVICE_LABELS[item.equipment] ?? item.equipment)}</p><div class="actions"><button type="button" class="secondary" data-pick-action="${esc(item.id)}" aria-label="选择${esc(item.name)}（${esc(item.id)}）">选择${esc(item.name)}</button><button type="button" class="link" data-exercise-detail="${esc(item.id)}">查看要点</button></div></section>`).join('') || '<p>没有匹配动作，请修改关键词或筛选条件。</p>'}<div class="actions"><button class="secondary" data-picker-page="${result.page - 1}" ${result.page === 1 ? 'disabled' : ''}>上一页</button><button class="secondary" data-picker-page="${result.page + 1}" ${result.page === result.pages ? 'disabled' : ''}>下一页</button></div>`;
    body.querySelector('form').onsubmit = (event) => {
      event.preventDefault();
      const fields = new FormData(event.target);
      filters = {
        query: fields.get('query'),
        body: fields.get('body'),
        device: fields.get('device'),
        page: 1,
      };
      drawList();
    };
    body
      .querySelectorAll('[data-pick-action]')
      .forEach(
        (button) => (button.onclick = () => choose(findPlanExercise(button.dataset.pickAction))),
      );
    body.querySelectorAll('[data-picker-page]').forEach(
      (button) =>
        (button.onclick = () => {
          filters.page = Number(button.dataset.pickerPage);
          drawList();
          body.scrollTop = 0;
        }),
    );
    bindBuiltinDetails();
  }
  if (preferredId) choose(findPlanExercise(preferredId));
  else if (editOnly && original) choose(findPlanExercise(original.exerciseId));
  else drawList();
}

/** 绑定草稿导入、下载、目标编辑和新增动作入口。外部AI仅是文件来源标签，不会调用AI。 */
export function bindPlanEditor(options) {
  const { getState, commit, render, toast } = options;
  document
    .querySelector('#export-plan-draft')
    ?.addEventListener('click', () =>
      downloadText(JSON.stringify(draftFromState(getState()), null, 2), 'lianxu-plan-draft.json'),
    );
  document
    .querySelectorAll('[data-add-plan-action]')
    .forEach(
      (button) =>
        (button.onclick = () =>
          openPlanPicker(options, Number(button.dataset.addPlanAction), null, button)),
    );
  document
    .querySelectorAll('[data-edit-target]')
    .forEach(
      (button) =>
        (button.onclick = () =>
          openPlanPicker(
            options,
            Number(button.dataset.editDay),
            Number(button.dataset.editTarget),
            button,
            true,
          )),
    );
  document.querySelector('#import-plan-draft')?.addEventListener('click', (event) => {
    const expectedVersion = getState().version;
    const dialog = editorDialog('导入计划草稿', '关闭计划草稿导入', event.currentTarget);
    const body = dialog.querySelector('.exercise-dialog-body');
    let pending = null;
    body.innerHTML = `<p>粘贴或选择练序格式JSON。先检查、预览，再确认加入计划；这不是已接入的AI分析。</p><div class="actions"><button class="secondary" id="download-plan-example">下载格式示例</button><button class="secondary" id="download-plan-ids">下载动作编号清单</button></div><label>选择草稿文件<input id="draft-file" type="file" accept=".json,application/json"></label><form id="draft-parse"><label>计划草稿 JSON<textarea name="draft" rows="8" maxlength="262144" required spellcheck="false"></textarea></label><button type="submit">检查并预览草稿</button></form><p class="error-text" role="alert" id="draft-error"></p><div id="draft-preview"></div>`;
    const input = body.querySelector('textarea');
    const invalidate = () => {
      pending = null;
      body.querySelector('#draft-preview').innerHTML = '';
    };
    input.oninput = () => {
      fileRead++;
      invalidate();
    }; // 文本修改后旧预览立即失效，不能确认一份与文本不同的草稿。
    body.querySelector('#download-plan-example').onclick = () =>
      downloadText(
        JSON.stringify(
          {
            format: 'lianxu-plan-draft',
            version: 1,
            title: '格式演示，非个人处方',
            origin: 'manual',
            days: [
              {
                name: '示例训练日',
                actions: [
                  {
                    exerciseId: 'lianxu:plank',
                    unit: 'seconds',
                    sets: 2,
                    targetMin: 20,
                    targetMax: 30,
                    restSeconds: 90,
                    reason: '仅用于演示JSON结构',
                  },
                ],
              },
            ],
          },
          null,
          2,
        ),
        'lianxu-plan-example.json',
      );
    body.querySelector('#download-plan-ids').onclick = () =>
      downloadText(
        JSON.stringify(
          PLAN_CATALOG.map(({ id, name, equipment, unit }) => ({
            id,
            name,
            equipment: DEVICE_LABELS[equipment] ?? equipment,
            unit,
          })),
          null,
          2,
        ),
        'lianxu-exercise-ids.json',
      );
    let fileRead = 0; // 丢弃已经关闭弹层或被后一次选文件替代的异步读取。
    body.querySelector('#draft-file').onchange = async (event) => {
      const file = event.target.files[0],
        token = ++fileRead;
      invalidate();
      if (!file) return;
      try {
        if (file.size > 256 * 1024) throw new Error('计划草稿超过256 KB');
        const text = await file.text();
        if (dialog.isConnected && token === fileRead) {
          invalidate();
          input.value = text;
        }
      } catch (error) {
        if (dialog.isConnected) body.querySelector('#draft-error').textContent = error.message;
      }
    };
    body.querySelector('#draft-parse').onsubmit = (event) => {
      event.preventDefault();
      invalidate();
      body.querySelector('#draft-error').textContent = '';
      try {
        pending = parsePlanDraft(input.value);
        const warnings = planWarnings(pending, getState().profile);
        body.querySelector('#draft-preview').innerHTML =
          `<h3>${esc(pending.title)}</h3><p>来源：${pending.origin === 'ai-draft' ? '外部AI草稿，未经练序模型验证' : '手动草稿'}。确认后替换当前整份计划，旧训练与版本保留。</p>${pending.days.map((day) => `<h3>${esc(day.name)}</h3><ul>${day.actions.map((action) => `<li>${esc(action.name)} · ${esc(targetLabel(action))}${action.reason ? `<p>${esc(action.reason)}</p>` : ''}</li>`).join('')}</ul>`).join('')}<form id="confirm-draft">${warningsHtml(warnings)}<button type="submit">确认导入并建立新版本</button></form>`;
        body.querySelector('#confirm-draft').onsubmit = async (event) => {
          event.preventDefault();
          try {
            const next = acceptEditablePlan(getState(), pending, {
              expectedVersion,
              acknowledge: new FormData(event.target).has('acknowledge'),
            });
            await commit(next);
            dialog.close();
            render();
            toast(`已导入计划版本 ${next.version}，后续新训练生效。`);
          } catch (error) {
            body.querySelector('#draft-error').textContent = error.message;
          }
        };
      } catch (error) {
        body.querySelector('#draft-error').textContent = error.message;
      }
    };
  });
}
