import { escapeExerciseText as esc } from './exercise-catalog.js';
import { downloadText } from './workout-view.js';

/** 只重建同步提示，不重建资料/训练表单，避免网络状态变化清空用户输入。 */
export function bindSyncStatus({ api, session, toast }) {
  const panel = document.querySelector('#account-sync');
  if (!panel || !session) return;
  const labels = { '/me/profile': '训练资料', '/me/plans': '计划确认' };
  async function act(button, operation) {
    button.disabled = true;
    try {
      await operation();
    } catch (error) {
      toast(error.message);
      update();
    }
  }
  function update() {
    let item,
      error = '';
    try {
      item = api.getPending();
    } catch (e) {
      error = e.message;
    }
    if (!item && !error) {
      panel.innerHTML = '';
      return;
    }
    const subject = item
      ? (labels[item.path] ?? (item.path.includes('/workouts/') ? '训练记录' : '体重记录'))
      : '待同步记录';
    panel.innerHTML = `<section class="notice warm" role="status"><b>${esc(subject)} · ${error ? '读取失败' : item.status === 'blocked' ? '需要核对' : '待同步，尚未确认保存'}</b><p>${esc(error || item.message || '请求已保留在当前浏览器，重试会沿用同一编号。')}</p><p>刷新后仍保留，仅登录原账户可处理。处理前暂停其他保存；本地请求含个人记录，请妥善保管。${item?.status === 'blocked' ? '请下载请求，刷新核对服务器记录后重新编辑。' : ''}</p><div class="actions">${item?.status === 'pending' ? '<button id="retry-sync">重试同步并刷新</button>' : ''}<button class="secondary" id="export-sync">下载待同步原请求</button><button class="link" id="discard-sync">放弃本地请求并刷新</button></div></section>`;
    panel.querySelector('#retry-sync')?.addEventListener(
      'click',
      (event) =>
        void act(event.target, async () => {
          await api.retryPending();
          location.reload();
        }),
    );
    panel.querySelector('#export-sync').onclick = () => {
      try {
        downloadText(api.getPendingRaw() ?? '{}', 'lianxu-pending-request.json');
      } catch (e) {
        toast(e.message);
      }
    };
    panel.querySelector('#discard-sync').onclick = (event) => {
      if (
        !confirm(
          '仅删除当前浏览器的待同步请求？服务器可能已保存，请先下载请求留存。删除后刷新核对，不删除数据库记录。',
        )
      )
        return;
      void act(event.target, async () => {
        await api.discardPending();
        location.reload();
      });
    };
  }
  api.onSyncChange(update);
  update();
}
