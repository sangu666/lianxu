import { activePlanDays, findPlanExercise } from './plan-document.js';
import { openPlanPicker } from './plan-editor-view.js';
import { escapeExerciseText as esc, DEVICE_LABELS } from './exercise-catalog.js';
import { replacementOptions } from './exercise-replacements.js';
import { replacePlanExercise } from './core.js';

/** 绑定当前计划的替换入口。选择框只暂存候选，点击明确的确认按钮才写入新版本。
 * @param {{getState:Function,commit:Function,render:Function,toast:Function}} options 通过已有保存入口保持失败回滚与跨页冲突检查。
 */
export function bindReplacementButtons({ getState, commit, render, toast }) {
  document.querySelectorAll('[data-replace-exercise]').forEach((trigger) => {
    trigger.onclick = () => {
      const state = getState();
      const dayIndex = Number(trigger.dataset.replaceDay); // 从0开始的训练日，不是星期几。
      const currentId = trigger.dataset.replaceExercise;
      const item = findPlanExercise(currentId);
      const day = activePlanDays(state)[dayIndex];
      const position = Number(trigger.dataset.replacePosition);
      const candidates = replacementOptions(state.profile, currentId, day.exercises);
      const version = state.version; // 固定打开时的版本，确认时再次核对，避免过期选择。
      const dialog = document.createElement('dialog');
      dialog.className = 'exercise-dialog replacement-dialog';
      dialog.setAttribute('aria-labelledby', 'replacement-title');
      dialog.innerHTML = `<header class="exercise-dialog-header"><h2 id="replacement-title">替换${esc(item.name)}</h2><button type="button" class="secondary exercise-close" aria-label="关闭动作替换" autofocus><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header><div class="exercise-dialog-body"><div class="actions"><span class="tag">推荐替代</span><button type="button" class="secondary" id="choose-all-actions">从全部动作中选择</button></div><p>${esc(candidates.message)}</p><div class="notice">确认后建立新计划版本。进行中的训练继续使用开始时的动作清单；下次开始训练才使用替换结果。新动作不沿用原动作的重量成绩。</div><p class="error-text" role="alert" id="replacement-error"></p>${candidates.options.map((candidate) => `<section class="replacement-option"><h3>${esc(candidate.name)}${candidate.preferred ? ' · 符合偏好' : ''}</h3><p class="muted">设备：${esc(DEVICE_LABELS[candidate.device])} · 记录单位：次</p><p>${esc(candidate.reason)}</p><button type="button" data-confirm-replacement="${esc(candidate.id)}">${state.editablePlan ? '设置目标并替换为' : '确认替换为'}${esc(candidate.name)}</button></section>`).join('')}${candidates.unavailable.length ? `<details><summary>为什么其他动作不可选？</summary><ul>${candidates.unavailable.map((candidate) => `<li>${esc(candidate.name)}：${esc(candidate.reasons.join('；'))}</li>`).join('')}</ul></details>` : ''}<p class="muted">替代关系是规则演示，不能证明难度、刺激或安全性等同；不判断疾病和康复需求。</p></div>`;
      dialog.querySelector('.exercise-close').onclick = () => dialog.close();
      dialog.querySelector('#choose-all-actions').onclick = () => {
        dialog.close();
        openPlanPicker({ getState, commit, render, toast }, dayIndex, position, trigger);
      };
      dialog.addEventListener(
        'close',
        () => {
          dialog.remove();
          if (trigger.isConnected) trigger.focus();
        },
        { once: true },
      );
      dialog.querySelectorAll('[data-confirm-replacement]').forEach((button) => {
        button.onclick = async () => {
          try {
            if (getState().editablePlan) {
              dialog.close();
              openPlanPicker(
                { getState, commit, render, toast },
                dayIndex,
                position,
                trigger,
                false,
                button.dataset.confirmReplacement,
              );
              return;
            }
            const next = replacePlanExercise(
              getState(),
              dayIndex,
              currentId,
              button.dataset.confirmReplacement,
              version,
            );
            await commit(next); // 保存成功后才关闭弹层；失败时保留候选和错误，当前计划不变。
            dialog.close();
            render();
            document
              .querySelector(
                `[data-replace-exercise="${button.dataset.confirmReplacement}"][data-replace-day="${dayIndex}"]`,
              )
              ?.focus();
            toast(`已保存计划版本 ${next.version}，下次新训练使用替换动作。`);
          } catch (error) {
            dialog.querySelector('#replacement-error').textContent = error.message;
          }
        };
      });
      document.body.append(dialog);
      dialog.showModal();
    };
  });
}
