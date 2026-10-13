import { escapeExerciseText as esc } from './exercise-catalog.js';
import { downloadText } from './workout-view.js';

/** 文件先在内存读取；用户点击后端预览才发送到本机服务，确认前不改账户业务数据。 */
export function bindAccountImport({ api, reload, toast }) {
  const trigger = document.querySelector('#account-import');
  if (!trigger) return;
  trigger.onclick = () => {
    const dialog = document.createElement('dialog');
    dialog.className = 'exercise-dialog';
    dialog.setAttribute('aria-labelledby', 'account-import-title');
    dialog.innerHTML = `<header class="exercise-dialog-header"><h2 id="account-import-title">迁移旧备份到当前账户</h2><button type="button" class="secondary exercise-close" aria-label="关闭备份迁移">×</button></header><div class="exercise-dialog-body"><p>先在原浏览器版（例如 3002）“训练记录”中导出完整 JSON 备份，再选择文件。不同端口的旧记录无法直接跨页读取。</p><div class="notice">选择文件仅在页面读取；点击“后端预览”后发送到本机服务，暂存预览 30 分钟。确认前不修改账户资料、计划、训练或体重。原文件和浏览器记录保留，照片不迁移。</div><label>选择完整 JSON 备份<input id="account-import-file" type="file" accept=".json,application/json"></label><p id="import-file-status" role="status"></p><div class="actions"><button id="preview-account-import" disabled>后端预览</button><button class="secondary" id="download-import-original" disabled>保存原始备份副本</button></div><p id="account-import-error" class="error-text" role="alert"></p><div id="account-import-preview"></div></div>`;
    let text = '',
      filename = '',
      job = null,
      busy = false,
      ticket = 0,
      disposed = false; // 关闭事件可能延迟或重复；清理只执行一次，不能依赖后台标签页的动画帧。
    const $ = (selector) => dialog.querySelector(selector);
    /** 清理失败时不伪装已取消；短期任务仍会到期，业务表尚未写入。 */
    async function cancelJob() {
      if (job?.status === 'pending') await api.request(`/me/imports/${job.id}`, 'DELETE');
      job = null;
    }
    $('.exercise-close').onclick = () => {
      if (!busy) dismiss();
    };
    dialog.oncancel = (event) => {
      event.preventDefault();
      if (!busy) dismiss();
    };
    /** 显式关闭立即清理；原生 close 事件作为其他关闭方式的兜底。 */
    function dispose() {
      if (disposed) return;
      disposed = true;
      ticket++;
      void cancelJob().catch((error) => toast(`预览未能立即取消，将到期清理：${error.message}`));
      text = '';
      dialog.remove();
      if (trigger.isConnected) trigger.focus();
    }
    function dismiss() {
      dialog.close();
      dispose();
    }
    dialog.addEventListener('close', dispose, { once: true });
    function waiting(value) {
      busy = value;
      dialog.setAttribute('aria-busy', String(value));
      for (const button of dialog.querySelectorAll('button')) button.disabled = value;
      $('#account-import-file').disabled = value;
      $('#preview-account-import').disabled = value || !text;
      $('#download-import-original').disabled = value || !text;
    }
    $('#account-import-file').onchange = async (event) => {
      const file = event.target.files[0],
        current = ++ticket;
      text = '';
      filename = '';
      $('#account-import-preview').innerHTML = '';
      $('#account-import-error').textContent = '';
      waiting(true);
      try {
        await cancelJob();
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) throw new Error('备份超过 5 MB。');
        const raw = await file.text();
        if (ticket !== current || !dialog.isConnected) return;
        text = raw;
        filename = file.name;
        $('#import-file-status').textContent = `${file.name} · 已在页面读取，尚未发送到后端。`;
      } catch (error) {
        if (dialog.isConnected) $('#account-import-error').textContent = error.message;
      } finally {
        if (dialog.isConnected) waiting(false);
      }
    };
    $('#download-import-original').onclick = () => downloadText(text, `original-${filename}`);
    function previewHtml(summary) {
      return `<h3>导入预览</h3><p>来源：${summary.source.plans} 个计划版本、${summary.source.workouts} 次训练、${summary.source.sets} 组、${summary.source.weights} 条体重。</p><p>预计新增：${summary.added.plans} 个版本、${summary.added.workouts} 次训练、${summary.added.sets} 组、${summary.added.weights} 条体重；跳过 ${summary.skipped.workouts} 次相同训练、${summary.skipped.weights} 条相同体重。</p><div class="notice">${summary.keepCurrent ? '保留账户当前资料和计划，追加旧历史；最后建立一份当前计划副本继续使用。' : '账户尚无资料，将采用备份当前资料和计划。'}稳定训练/动作/组编号与原单位保留，来源版本号会映射到账户新版本。</div><details><summary>查看版本对应</summary><ul>${summary.versions.map((item) => `<li>来源版本 ${item.from} → 账户版本 ${item.to}</li>`).join('')}</ul></details>${summary.warnings.length ? `<div class="notice warm"><ul>${summary.warnings.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}<form id="confirm-account-import"><label class="check"><input name="acknowledge" type="checkbox" required>我已保留原备份，并核对本次新增、跳过和版本对应</label><button type="submit">确认迁移到当前账户</button></form><p class="muted">预览 30 分钟有效；另一页面修改记录后须重新预览。取消或关闭不会写入业务表。</p>`;
    }
    $('#preview-account-import').onclick = async () => {
      if (busy) return;
      waiting(true);
      $('#account-import-error').textContent = '';
      $('#account-import-preview').innerHTML = '';
      $('#import-file-status').textContent = '正在本机后端校验与比较…';
      try {
        job = await api.request('/me/imports/preview', 'POST', { text });
        if (job.status === 'confirmed') {
          $('#account-import-preview').innerHTML =
            '<div class="notice">这份备份已经确认迁移，不会再次添加或覆盖记录。</div>';
          await reload();
        } else {
          $('#account-import-preview').innerHTML = previewHtml(job.summary);
          $('#confirm-account-import').onsubmit = async (event) => {
            event.preventDefault();
            if (busy || !new FormData(event.target).has('acknowledge')) return;
            waiting(true);
            $('#account-import-error').textContent = '';
            try {
              const result = await api.request(`/me/imports/${job.id}/confirm`, 'POST', {
                acknowledge: true,
              });
              job = { ...job, status: 'confirmed' }; // 确认已提交，即便随后读取失败，也不能发取消请求或声称未导入。
              $('#account-import-preview').innerHTML =
                `<div class="notice">${result.repeated ? '此前已确认，无重复写入。' : `迁移成功：新增 ${result.result.added.workouts} 次训练、${result.result.added.sets} 组、${result.result.added.weights} 条体重。`}原备份和浏览器记录仍保留。</div>`;
              await reload();
              toast('账户数据已重新加载，迁移结果可在训练与回顾页面查看。');
            } catch (error) {
              $('#account-import-error').textContent =
                job.status === 'confirmed'
                  ? `迁移已成功，但页面读取失败，请刷新核对：${error.message}`
                  : `${error.message} 若响应丢失，可再次确认同一预览；服务端不会重复写入。`;
            } finally {
              if (dialog.isConnected) waiting(false);
            }
          };
        }
        $('#import-file-status').textContent =
          job.status === 'confirmed' ? '这份备份已确认。' : '后端校验完成；尚未迁移。';
      } catch (error) {
        $('#account-import-error').textContent = error.message;
        $('#import-file-status').textContent =
          job?.status === 'confirmed'
            ? '这份备份已经迁移；页面读取失败，请刷新核对。'
            : '预览未通过，业务记录未修改。';
      } finally {
        if (dialog.isConnected) waiting(false);
      }
    };
    document.body.append(dialog);
    dialog.showModal();
  };
}
