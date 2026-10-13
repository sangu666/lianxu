import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOutbox } from '../public/sync-outbox.js';
function storage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}
const offline = async () => {
  throw new Error('网络中断');
};
test('失败请求跨实例恢复，同一编号和版本条件重试，成功才清除', async () => {
  const s = storage();
  const a = createOutbox({ storage: s });
  await assert.rejects(a.execute('a', '/me/profile', 'PUT', { expectedRevision: 3 }, offline));
  const original = a.read('a');
  const b = createOutbox({ storage: s });
  let args;
  await b.retry('a', async (...input) => {
    args = input;
    return { ok: true };
  });
  assert.equal(args[3], original.key);
  assert.deepEqual(args[2], { expectedRevision: 3 });
  assert.equal(b.read('a'), null);
});
test('已有待同步项阻止后续修改，其他账户互不读取', async () => {
  const q = createOutbox({ storage: storage() });
  await assert.rejects(q.execute('a', '/me/profile', 'PUT', { expectedRevision: 0 }, offline));
  let sent = false;
  await assert.rejects(
    q.execute('a', '/me/profile', 'PUT', {}, async () => (sent = true)),
    /待同步/,
  );
  assert.equal(sent, false);
  assert.equal(q.read('b'), null);
});
test('409拒绝保留待核对请求，不自动或手动覆盖重试', async () => {
  const q = createOutbox({ storage: storage() });
  await assert.rejects(
    q.execute('a', '/me/profile', 'PUT', {}, async () => {
      const e = new Error('冲突');
      e.status = 409;
      throw e;
    }),
  );
  assert.equal(q.read('a').status, 'blocked');
  await assert.rejects(
    q.retry('a', async () => assert.fail()),
    /拒绝/,
  );
  assert.ok(q.raw('a'));
  await q.discard('a');
  assert.equal(q.read('a'), null);
});
test('本地存储写失败先阻止发送，损坏内容保留可导出', async () => {
  let sent = false;
  const s = storage();
  s.setItem = () => {
    throw new Error('磁盘满');
  };
  const q = createOutbox({ storage: s });
  await assert.rejects(
    q.execute('a', '/me/profile', 'PUT', {}, async () => (sent = true)),
    /磁盘满/,
  );
  assert.equal(sent, false);
  const damaged = storage();
  damaged.setItem('lianxu.account-outbox.v1:a', '{bad');
  const b = createOutbox({ storage: damaged });
  assert.throws(() => b.read('a'), /损坏/);
  assert.equal(b.raw('a'), '{bad');
});
test('服务器响应后本地清除失败仍可用原编号重试，不能产生新请求', async () => {
  const s = storage(),
    original = s.removeItem;
  s.removeItem = () => {};
  const q = createOutbox({ storage: s });
  await assert.rejects(
    q.execute('a', '/me/profile', 'PUT', {}, async () => ({ saved: true })),
    /未清除/,
  );
  const key = q.read('a').key;
  s.removeItem = original;
  await q.retry('a', async (p, m, b, k) => {
    assert.equal(k, key);
    return { saved: true };
  });
  assert.equal(q.read('a'), null);
});
test('共享标签锁使同一账户同时提交只发送一个请求', async () => {
  let chain = Promise.resolve();
  const lock = (name, fn) => {
    const next = chain.then(fn);
    chain = next.catch(() => {});
    return next;
  };
  const s = storage(),
    a = createOutbox({ storage: s, lock }),
    b = createOutbox({ storage: s, lock });
  let sent = 0;
  await Promise.allSettled([
    a.execute('a', '/me/profile', 'PUT', {}, async () => {
      sent++;
      throw new Error('离线');
    }),
    b.execute('a', '/me/profile', 'PUT', {}, async () => {
      sent++;
    }),
  ]);
  assert.equal(sent, 1);
});
test('登录过期或账户切换保留原编号，原账户恢复后可核对成功回执', async () => {
  const q = createOutbox({ storage: storage() });
  await assert.rejects(
    q.execute('a', '/me/profile', 'PUT', {}, async () => {
      const e = new Error('重新登录');
      e.status = 401;
      throw e;
    }),
  );
  const key = q.read('a').key;
  assert.equal(q.read('a').status, 'pending');
  await q.retry('a', async (p, m, b, k) => {
    assert.equal(k, key);
    return { ok: true };
  });
  assert.equal(q.read('a'), null);
});
