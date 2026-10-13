import { findBuiltinExercise } from './exercise-catalog.js';
import {
  createWorkout,
  putWorkoutSet,
  removeWorkoutSet,
  finishWorkout,
  changeWorkout,
  previousExercise,
} from './workouts.js';
import { mergeBackup, parseBackup, serializeState } from './storage.js';

// 用户文本必须转义后再放进HTML；导入内容也属于用户文本。
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const id = () => crypto.randomUUID(); // 随机ID只在UI事件发生时生成，核心逻辑仍可确定性测试。
const summary = (set, unit) =>
  `${set.load} kg × ${set.value} ${unit === 'seconds' ? '秒' : '次'} · RIR ${set.rir === 3 ? '3+' : set.rir}${set.pain ? ' · 疼痛反馈' : ''}`;

/** 通过下载保存备份，不上传至任何远程服务器。 */
export function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 页面只负责显示与事件；commit先保存，保存成功后才替换当前状态。 */
export function createWorkoutView({
  getState,
  commit,
  getPlan,
  getDay,
  date,
  render,
  toast,
  isAccount = () => false,
}) {
  let viewedWorkoutId = null; // 当前打开的训练历史；为空时优先显示进行中的训练。
  let viewedExerciseId = null; // 当前正在录入或编辑的动作实例。
  let editingSetId = null; // 非空表示正在编辑已有组，防止误新增一组。
  let pendingConfirmation = null; // 页面内确认框，保留取消入口和键盘焦点。
  let pendingImport = null; // 导入预览阶段暂存，点击确认前不改任何数据。
  const currentWorkout = () => {
    const workouts = getState().workouts;
    return (
      workouts.find((item) => item.id === viewedWorkoutId) ??
      workouts.find((item) => item.status === 'active')
    );
  };
  const update = (data) => commit({ ...getState(), ...data });
  const act = (action) => async (event) => {
    event?.preventDefault();
    try {
      await action(event);
    } catch (error) {
      const output = document.querySelector('#workout-error');
      if (output) output.textContent = error.message;
      toast(error.message);
    }
  };

  function confirmAction(message, action) {
    pendingConfirmation = { message, action };
    render();
  }

  function html() {
    const state = getState();
    const workout = currentWorkout();
    const exercise =
      workout?.exercises.find((item) => item.id === viewedExerciseId) ?? workout?.exercises[0];
    const editing = exercise?.sets.find((set) => set.id === editingSetId);
    const previous = exercise
      ? previousExercise(state, exercise.exerciseId, exercise.unit, workout.id)
      : null;
    return `<div class="heading"><div class="eyebrow">SHOW UP & WRITE IT DOWN</div><h1>把这一练，完整记下来。</h1><p class="sub">保存每一组，刷新后继续。完成的训练也可以回看和修正。</p></div>
      <p id="workout-error" class="error-text" role="alert"></p>
      <div class="grid"><section class="card">${
        workout
          ? `
        <div class="row"><h2>${escape(workout.planName)}</h2><span class="tag">${workout.status === 'active' ? '进行中' : '已完成'}</span></div>
        <p class="muted">${escape(workout.date)} · 计划版本 ${workout.planVersion}${workout.startedAt ? ` · ${new Date(workout.startedAt).toLocaleTimeString('zh-CN')} 开始${workout.completedAt ? ` · ${new Date(workout.completedAt).toLocaleTimeString('zh-CN')} 结束 · ${Math.round((Date.parse(workout.completedAt) - Date.parse(workout.startedAt)) / 60000)} 分钟` : ''}` : ' · 旧版归档，无起止时间'}</p>
        <label>选择动作<select id="workout-exercise">${workout.exercises.map((item) => `<option value="${escape(item.id)}" ${item.id === exercise?.id ? 'selected' : ''}>${escape(item.name)}（${item.sets.length}组）</option>`).join('')}</select></label>
        ${
          exercise
            ? `<div class="notice"><b>上次成绩</b><p>${previous ? `${previous.date}：${previous.sets.map((set) => escape(summary(set, exercise.unit))).join('；')}` : '暂无同动作、同单位的已完成记录。'}</p>${previous ? '<button class="secondary" id="reuse-set">沿用上次最后一组</button>' : ''}</div>
        ${findBuiltinExercise(exercise.exerciseId) || findBuiltinExercise(exercise.name) || exercise.exerciseId.startsWith('hasaneyldrm:') ? `<button type="button" class="secondary" data-exercise-detail="${escape(exercise.exerciseId.startsWith('hasaneyldrm:') ? exercise.exerciseId : ((findBuiltinExercise(exercise.exerciseId) ?? findBuiltinExercise(exercise.name))?.id ?? exercise.exerciseId))}">查看动作要点</button>` : '<p class="muted">这个历史动作暂未整理教学说明。</p>'}${exercise.prescription ? `<p class="muted">计划目标：${exercise.prescription.sets} 组 × ${exercise.prescription.targetMin}–${exercise.prescription.targetMax} ${exercise.unit === 'seconds' ? '秒' : '次'} · 休息 ${exercise.prescription.restSeconds} 秒</p>` : ''}<form id="workout-set"><h3>${editing ? '编辑这一组' : '记录新的一组'}</h3><div class="log-grid">
        <label>负重 / kg<input name="load" type="number" min="0" max="400" step="0.1" value="${editing?.load ?? ''}" required></label>
        <label>${exercise.unit === 'seconds' ? '时长 / 秒' : '次数'}<input name="value" type="number" min="1" max="${exercise.unit === 'seconds' ? 3600 : 100}" value="${editing?.value ?? ''}" required></label>
        <label>剩余次数 RIR<select name="rir">${[3, 2, 1, 0].map((value) => `<option value="${value}" ${value === (editing?.rir ?? 2) ? 'selected' : ''}>${value === 3 ? '3 次以上' : `${value} 次`}</option>`).join('')}</select></label></div>
        <label class="check"><input name="pain" type="checkbox" ${editing?.pain ? 'checked' : ''}>这组动作出现疼痛或不适</label>
        <div class="actions"><button type="submit">${editing ? '保存修改' : '保存这一组'}</button>${editing ? '<button type="button" class="secondary" id="cancel-edit">取消编辑</button>' : ''}</div></form>
        <p class="muted">自重动作按0 kg记录；哑铃按单只重量记录。计时动作使用秒数。RIR 3表示3次及以上；疼痛时停止相关动作。</p>
        ${exercise.sets.map((set, index) => `<div class="history"><b>第 ${index + 1} 组</b><p>${escape(summary(set, exercise.unit))}</p><div class="actions"><button class="secondary" data-edit-set="${escape(set.id)}">编辑第 ${index + 1} 组</button><button class="link" data-delete-set="${escape(set.id)}">删除第 ${index + 1} 组</button></div></div>`).join('') || '<div class="empty">这个动作还没有保存的组。</div>'}`
            : '<div class="empty">没有动作记录。</div>'
        }
        <form id="workout-notes"><label>训练日期<input name="date" type="date" max="${date()}" value="${workout.date}" required></label><label>训练备注<textarea name="notes" maxlength="2000" rows="3">${escape(workout.notes)}</textarea></label><button class="secondary" type="submit">保存日期和备注</button></form>
        <div class="actions">${workout.status === 'active' ? '<button id="finish-workout">完成这次训练</button>' : ''}<button class="link" id="delete-workout">删除这次训练</button></div>
        `
          : `<h2>开始一次训练</h2><form id="start-workout"><label>选择训练日<select name="day">${getPlan()
              .map(
                (day, index) =>
                  `<option value="${index}" ${index === getDay() ? 'selected' : ''}>${escape(day.name)}</option>`,
              )
              .join(
                '',
              )}</select></label><button style="margin-top:16px" type="submit">开始训练</button></form><p class="muted">若所选训练日没有可安排动作，请先修改资料。开始后保留当时的动作清单和计划版本，后续换计划不会改写记录。</p>`
      }</section>
        <section class="card"><div class="row"><h2>训练历史</h2><button id="current-workout" class="secondary">${state.workouts.some((item) => item.status === 'active') ? '返回进行中的训练' : '开始新训练'}</button></div>
        ${
          state.workouts
            .toSorted(
              (a, b) =>
                b.date.localeCompare(a.date) ||
                (b.startedAt ?? '').localeCompare(a.startedAt ?? ''),
            )
            .map(
              (item) =>
                `<div class="history"><b>${escape(item.date)} · ${escape(item.planName)}</b><p>${item.exercises.reduce((total, action) => total + action.sets.length, 0)} 组 · ${item.status === 'active' ? '进行中' : '已完成'}</p><button class="secondary" data-view-workout="${escape(item.id)}">查看训练 ${escape(item.date)} ${escape(item.planName)}</button></div>`,
            )
            .join('') || '<div class="empty">保存的训练会显示在这里。</div>'
        }</section></div>
        <section class="card"><h2>备份与恢复</h2>${isAccount() ? '<p class="notice">账户备份可预览与确认迁移；已有记录不覆盖，原浏览器记录保留。</p>' : ''}<p class="muted">完整备份包含资料、训练、体重和计划历史，不包含照片。请妥善保管下载文件。</p><div class="actions"><button id="export-backup">导出完整备份</button>${isAccount() ? '<button id="account-import" class="secondary">迁移旧备份到账户</button>' : ''}${isAccount() ? '' : '<label>选择 JSON 备份<input id="import-backup" type="file" accept=".json,application/json"></label>'}</div>
        ${pendingImport ? `<div class="notice"><b>导入预览：${pendingImport.workouts.length} 次训练，${pendingImport.weights.length} 条体重记录</b><p>合并只添加训练；同ID同内容会跳过，冲突会拒绝。完整恢复会替换所有资料与记录。</p><div class="actions"><button id="merge-backup">确认合并训练</button><button class="secondary" id="replace-backup">完整恢复备份</button><button class="link" id="cancel-import">取消导入</button></div></div>` : ''}</section>${pendingConfirmation ? `<dialog id="workout-confirm" aria-labelledby="confirm-title"><h2 id="confirm-title">确认操作</h2><p>${escape(pendingConfirmation.message)}</p><div class="actions"><button id="cancel-action" class="secondary" autofocus>取消操作</button><button id="confirm-action">确认继续</button></div></dialog>` : ''}`;
  }

  function bind() {
    const $ = (selector) => document.querySelector(selector);
    const workout = currentWorkout();
    const exercise =
      workout?.exercises.find((item) => item.id === viewedExerciseId) ?? workout?.exercises[0];
    if ($('#start-workout'))
      $('#start-workout').onsubmit = act(async (event) => {
        if (getState().workouts.some((item) => item.status === 'active'))
          throw new Error('请先完成当前训练');
        const day = getPlan()[Number(new FormData(event.target).get('day'))];
        if (!day?.exercises.length)
          throw new Error('当前训练日没有可用动作，请先修改个人资料中的设备或动作限制');
        const fresh = createWorkout({
          id: id(),
          date: date(),
          startedAt: new Date().toISOString(),
          planVersion: getState().version,
          planName: day.name,
          exercises: day.actions.map((action) => ({
            id: id(),
            exerciseId: action.exerciseId,
            name: action.name,
            unit: action.unit,
            prescription: {
              sets: action.sets,
              targetMin: action.targetMin,
              targetMax: action.targetMax,
              restSeconds: action.restSeconds,
              reason: action.reason,
            }, // 开始时的计划目标快照，与实际完成的sets分开。
          })),
        });
        await update({ workouts: [...getState().workouts, fresh] });
        viewedWorkoutId = fresh.id;
        viewedExerciseId = null;
        editingSetId = null;
        render();
      });
    if ($('#workout-exercise'))
      $('#workout-exercise').onchange = () => {
        viewedExerciseId = $('#workout-exercise').value;
        editingSetId = null;
        render();
      };
    if ($('#workout-set'))
      $('#workout-set').onsubmit = act(async (event) => {
        const fields = new FormData(event.target); // FormData读取的数字是字符串，需要显式转换。
        const set = {
          id: editingSetId ?? id(),
          load: Number(fields.get('load')),
          value: Number(fields.get('value')),
          rir: Number(fields.get('rir')),
          pain: fields.has('pain'),
        };
        await update(putWorkoutSet(getState(), workout.id, exercise.id, set, editingSetId));
        editingSetId = null;
        render();
        toast(set.pain ? '已保存疼痛反馈，请停止相关动作。' : '训练组已保存。');
      });
    document.querySelectorAll('[data-edit-set]').forEach(
      (button) =>
        (button.onclick = () => {
          editingSetId = button.dataset.editSet;
          render();
        }),
    );
    document.querySelectorAll('[data-delete-set]').forEach(
      (button) =>
        (button.onclick = act(async () => {
          confirmAction('删除这组记录？', async () => {
            await update(
              removeWorkoutSet(getState(), workout.id, exercise.id, button.dataset.deleteSet),
            );
            editingSetId = null;
            render();
          });
        })),
    );
    if ($('#cancel-edit'))
      $('#cancel-edit').onclick = () => {
        editingSetId = null;
        render();
      };
    if ($('#reuse-set'))
      $('#reuse-set').onclick = act(async () => {
        const last = previousExercise(
          getState(),
          exercise.exerciseId,
          exercise.unit,
          workout.id,
        ).sets.at(-1);
        const form = $('#workout-set');
        form.elements.load.value = last.load;
        form.elements.value.value = last.value;
        form.elements.rir.value = last.rir;
        // 疼痛反馈属于这次实际体验，不沿用上次勾选；复用只填表，不自动保存。
        form.elements.pain.checked = false;
        toast('已填入上次成绩，请按本次实际完成情况修改后保存。');
      });
    if ($('#workout-notes'))
      $('#workout-notes').onsubmit = act(async (event) => {
        const fields = new FormData(event.target);
        await update(
          changeWorkout(getState(), workout.id, (item) => {
            item.date = fields.get('date');
            item.notes = fields.get('notes');
          }),
        );
        render();
        toast('日期和备注已保存。');
      });
    if ($('#finish-workout'))
      $('#finish-workout').onclick = act(async () => {
        confirmAction('完成这次训练？尚未点击保存的表单内容不会计入。', async () => {
          await update(finishWorkout(getState(), workout.id, new Date().toISOString()));
          render();
          toast('这次训练已完成。');
        });
      });
    if ($('#delete-workout'))
      $('#delete-workout').onclick = act(async () => {
        confirmAction('删除这次训练及全部组记录？建议先导出备份。', async () => {
          await update({ workouts: getState().workouts.filter((item) => item.id !== workout.id) });
          viewedWorkoutId = null;
          viewedExerciseId = null;
          editingSetId = null;
          render();
        });
      });
    document.querySelectorAll('[data-view-workout]').forEach(
      (button) =>
        (button.onclick = () => {
          viewedWorkoutId = button.dataset.viewWorkout;
          viewedExerciseId = null;
          editingSetId = null;
          render();
        }),
    );
    $('#current-workout').onclick = () => {
      viewedWorkoutId = null;
      viewedExerciseId = null;
      editingSetId = null;
      render();
    };
    $('#export-backup').onclick = act(() =>
      downloadText(
        JSON.stringify(
          {
            format: 'lianxu-backup',
            version: 2,
            exportedAt: new Date().toISOString(),
            state: JSON.parse(serializeState(getState())),
          },
          null,
          2,
        ),
        `lianxu-${date()}.json`,
      ),
    );
    if ($('#import-backup'))
      $('#import-backup').onchange = async (event) => {
        try {
          if (isAccount()) throw new Error('请使用“迁移旧备份到账户”入口，先预览再确认。');
          const file = event.target.files[0];
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) throw new Error('备份超过5 MB');
          pendingImport = parseBackup(await file.text());
          render();
        } catch (error) {
          pendingImport = null;
          $('#workout-error').textContent = error.message;
          toast(error.message);
        }
      };
    if ($('#merge-backup'))
      $('#merge-backup').onclick = act(async () => {
        const result = mergeBackup(getState(), pendingImport);
        await commit(result.state);
        pendingImport = null;
        render();
        toast(`添加 ${result.added} 次训练，跳过 ${result.skipped} 次重复训练。`);
      });
    if ($('#replace-backup'))
      $('#replace-backup').onclick = act(async () => {
        confirmAction(
          '用备份替换所有当前资料、训练、体重和计划历史？请先备份当前记录。',
          async () => {
            await commit(pendingImport, { restore: true });
            pendingImport = null;
            viewedWorkoutId = null;
            editingSetId = null;
            viewedExerciseId = null;
            render();
            toast('完整备份已恢复。');
          },
        );
      });
    if ($('#workout-confirm')) {
      const dialog = $('#workout-confirm');
      dialog.showModal();
      const cancel = () => {
        pendingConfirmation = null;
        render();
      };
      dialog.oncancel = (event) => {
        event.preventDefault();
        cancel();
      };
      $('#cancel-action').onclick = cancel;
      $('#confirm-action').onclick = act(async () => {
        const action = pendingConfirmation.action;
        pendingConfirmation = null;
        render();
        await action();
      });
    }
    if ($('#cancel-import'))
      $('#cancel-import').onclick = () => {
        pendingImport = null;
        render();
      };
  }
  return { html, bind };
}
