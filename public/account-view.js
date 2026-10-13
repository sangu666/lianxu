import { escapeExerciseText as esc } from './exercise-catalog.js';

/** 显示明确的数据归属：未登录为浏览器模式，登录后仅显示当前账户数据库记录。 */
export function accountPanelHtml(session, error, metadata) {
  if (error)
    return `<section class="notice warm" role="alert"><b>账户服务未连接</b><p>${esc(error)}</p><a href="http://127.0.0.1:3100/">打开数据库版练序</a><p>原浏览器记录保留。启动本地后端后再刷新；静态版仍可通过原端口使用。</p></section>`;
  return `<section class="account-panel card"><div><b>${session ? esc(session.user.email) : '浏览器模式'}</b><p class="muted">${session ? '账户记录保存到本机 PostgreSQL，旧浏览器记录需手动迁移。' : '当前记录仅存在这个浏览器。登录后使用独立账户记录。'}</p>${session && !metadata?.profileRevision ? '<p>账户还没有训练资料，请先到<a href="#body">身体与资料</a>填写并保存；当前数值为虚构示例。</p>' : ''}</div><button class="secondary" id="account-entry">${session ? '退出账户' : '登录 / 注册'}</button></section>`;
}

/** 原生对话框管理键盘焦点与 Escape；错误在表单内展示，失败不会关窗或清除输入。 */
export function bindAccountPanel({ api, session, toast }) {
  const trigger = document.querySelector('#account-entry');
  if (!trigger) return;
  trigger.onclick = async () => {
    if (session) {
      if (
        !confirm(
          '退出当前账户？已保存记录保留在数据库，未提交表单输入将清除；待同步请求保留，重新登录原账户后可处理。',
        )
      )
        return;
      trigger.disabled = true;
      try {
        await api.logout();
        location.reload();
      } catch (error) {
        trigger.disabled = false;
        toast(error.message);
      }
      return;
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'exercise-dialog account-dialog';
    dialog.setAttribute('aria-labelledby', 'account-title');
    dialog.innerHTML = `<header class="exercise-dialog-header"><h2 id="account-title">进入你的训练空间</h2><button type="button" class="secondary exercise-close" aria-label="关闭登录">×</button></header><div class="exercise-dialog-body"><p>账户模式将新记录存入本机数据库。已有浏览器资料和训练不会自动上传。</p><form id="account-form"><label>邮箱<input name="email" type="email" maxlength="254" autocomplete="username" required autofocus></label><label>密码<input name="password" type="password" minlength="12" maxlength="128" autocomplete="current-password" required></label><p class="muted">密码至少 12 个字符。当前暂不支持邮箱验证与密码找回。</p><label class="check"><input name="register" type="checkbox">我没有账户，需要注册</label><p class="error-text" id="account-error" role="alert"></p><button type="submit">登录</button><p id="account-status" role="status"></p></form></div>`;
    dialog.querySelector('.exercise-close').onclick = () => dialog.close();
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove();
        trigger.focus();
      },
      { once: true },
    );
    const form = dialog.querySelector('form');
    form.elements.register.onchange = () => {
      form.querySelector('[type=submit]').textContent = form.elements.register.checked
        ? '注册并登录'
        : '登录';
      form.elements.password.autocomplete = form.elements.register.checked
        ? 'new-password'
        : 'current-password';
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      const fields = new FormData(form),
        button = form.querySelector('[type=submit]');
      button.disabled = true;
      dialog.querySelector('#account-status').textContent = '正在验证账户…';
      dialog.querySelector('#account-error').textContent = '';
      try {
        await api.authenticate(
          fields.has('register') ? 'register' : 'login',
          fields.get('email'),
          fields.get('password'),
        );
        location.reload(); // 新页面从会话加载，避免当前旧记录或临时照片进入新账户。
      } catch (error) {
        dialog.querySelector('#account-error').textContent = error.message;
        dialog.querySelector('#account-status').textContent = '';
        button.disabled = false;
      }
    };
    document.body.append(dialog);
    dialog.showModal();
  };
}
