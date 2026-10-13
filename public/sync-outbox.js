const prefix = 'lianxu.account-outbox.v1:';
const memory = new Map(); // 测试环境无浏览器时使用；真实页面必须使用持久存储，失败则不发送。
const testLocks = new Map(); // 非浏览器测试也串行化同账户，模拟 Web Locks 的共享互斥。
const memoryStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
};
/** 只暂存已支持幂等回执的业务写入；登录密码、照片和迁移原文不进入队列。 */
export const isReliablePath = (path, method) =>
  (path === '/me/profile' && method === 'PUT') ||
  (path === '/me/plans' && method === 'POST') ||
  (/^\/me\/workouts\/[^/?]+$/.test(path) && ['PUT', 'DELETE'].includes(method)) ||
  (/^\/me\/weights\/\d{4}-\d{2}-\d{2}$/.test(path) && method === 'PUT');

/** 每账户最多一个未完成请求，保存原请求和版本条件，不在重试时重新生成或放宽条件。
 * @param {object} options storage 用于跨刷新持久化；lock 用于跨标签互斥；notify 只更新同步提示。
 */
export function createOutbox({
  storage = typeof window === 'undefined'
    ? memoryStorage
    : {
        getItem: (k) => window.localStorage.getItem(k),
        setItem: (k, v) => window.localStorage.setItem(k, v),
        removeItem: (k) => window.localStorage.removeItem(k),
      },
  lock,
  notify = () => {},
  uuid = () => crypto.randomUUID(),
} = {}) {
  const exclusive =
    lock ??
    ((name, operation) => {
      if (typeof navigator !== 'undefined' && navigator.locks)
        return navigator.locks.request(name, operation);
      if (typeof window !== 'undefined')
        throw new Error('此浏览器缺少跨页面同步锁，未发送修改，请使用当前 Edge/Chrome。');
      const pending = (testLocks.get(name) ?? Promise.resolve()).then(operation);
      testLocks.set(
        name,
        pending.catch(() => {}),
      );
      return pending;
    });
  function read(accountId) {
    const raw = storage.getItem(prefix + accountId);
    if (!raw) return null;
    try {
      const item = JSON.parse(raw);
      if (
        item.schema !== 1 ||
        item.accountId !== accountId ||
        !/^[0-9a-f-]{36}$/i.test(item.key) ||
        !isReliablePath(item.path, item.method) ||
        !['pending', 'blocked'].includes(item.status) ||
        !item.body ||
        typeof item.body !== 'object'
      )
        throw new Error();
      return item;
    } catch {
      throw new Error('待同步记录损坏，原内容保留；请先下载原始请求并核对。');
    }
  }
  function put(accountId, item) {
    const raw = JSON.stringify(item);
    if (raw.length > 1024 * 1024) throw new Error('待同步请求超过 1 MB，未发送修改。');
    storage.setItem(prefix + accountId, raw);
    if (storage.getItem(prefix + accountId) !== raw)
      throw new Error('待同步记录保存失败，未发送修改。');
    notify();
  }
  async function send(accountId, item, transport) {
    try {
      const result = await transport(item.path, item.method, item.body, item.key);
      if (read(accountId)?.key !== item.key)
        throw new Error('待同步请求在其他页面变化，请刷新核对。');
      storage.removeItem(prefix + accountId);
      if (storage.getItem(prefix + accountId) !== null)
        throw new Error('服务器已响应，但本地待同步记录未清除；请重试核对。');
      notify();
      return result;
    } catch (error) {
      // 登录失效或账户切换先停止本次发送，重新登录原账户后仍能用原编号核对回执。
      // 业务冲突/坏输入为 blocked；网络、503、429 与认证恢复均不放宽原版本条件。
      if (read(accountId)?.key === item.key) {
        const needsLogin =
          error.status === 401 || ['ACCOUNT_CHANGED', 'CSRF_REJECTED'].includes(error.code);
        item.status =
          error.status >= 400 && error.status < 500 && error.status !== 429 && !needsLogin
            ? 'blocked'
            : 'pending';
        item.message = error.message;
        put(accountId, item);
      }
      throw error;
    }
  }
  return {
    read,
    raw: (accountId) => storage.getItem(prefix + accountId),
    /** 必须先成功暂存再发送；已有未完成请求时拒绝产生后续依赖修改。 */
    execute: (accountId, path, method, body, transport) =>
      exclusive(prefix + accountId, async () => {
        if (read(accountId))
          throw new Error('还有一项待同步修改，请先重试或核对处理，再保存新修改。');
        const item = {
          schema: 1,
          accountId,
          key: uuid(),
          path,
          method,
          body: structuredClone(body),
          createdAt: new Date().toISOString(),
          status: 'pending',
          message: '',
        };
        put(accountId, item);
        return send(accountId, item, transport);
      }),
    retry: (accountId, transport) =>
      exclusive(prefix + accountId, async () => {
        const item = read(accountId);
        if (!item) return null;
        if (item.status === 'blocked')
          throw new Error('这项请求被服务器拒绝，请下载请求并核对，不会自动覆盖重试。');
        return send(accountId, item, transport);
      }),
    /** 放弃仅删除本地请求；响应丢失时服务器可能已保存，随后必须重载事实。 */
    discard: (accountId) =>
      exclusive(prefix + accountId, async () => {
        storage.removeItem(prefix + accountId);
        if (storage.getItem(prefix + accountId) !== null) throw new Error('待同步记录无法清除。');
        notify();
      }),
  };
}
