import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccountApi } from '../public/account-api.js';
import { initialState } from '../public/storage.js';

test('静态版没有账户接口时仍可恢复浏览器模式；数据库失败不得冒充未登录', async () => {
  assert.equal(
    await createAccountApi(async () => new Response('Not found', { status: 404 })).restore(),
    null,
  );
  await assert.rejects(
    createAccountApi(
      async () =>
        new Response(JSON.stringify({ error: { message: '数据库不可用' } }), { status: 503 }),
    ).restore(),
    /数据库不可用/,
  );
});
test('网络失败和409冲突保持原状态，账户身份和CSRF仅通过请求头发送', async () => {
  const requests = [];
  const api = createAccountApi(async (url, options) => {
    requests.push({ url, options });
    if (url === '/api/v1/auth/login')
      return Response.json({ user: { id: 'account-a' }, csrfToken: 'csrf' });
    return Response.json({ error: { message: '其他页面已修改' } }, { status: 409 });
  });
  await api.authenticate('login', 'a@example.test', 'Demo-password!');
  const state = initialState(),
    original = structuredClone(state);
  await assert.rejects(
    api.save(
      state,
      { ...state, weights: [{ date: '2026-10-13', value: 70 }] },
      { profileRevision: 1, weights: [] },
    ),
    /其他页面/,
  );
  assert.deepEqual(state, original);
  assert.equal(requests[1].options.headers['X-Account-Id'], 'account-a');
  assert.equal(requests[1].options.headers['X-CSRF-Token'], 'csrf');
  assert.equal(requests[1].options.credentials, 'same-origin');
  const offline = createAccountApi(async () => {
    throw new Error('模拟网络中断');
  });
  await assert.rejects(
    offline.save(
      state,
      { ...state, weights: [{ date: '2026-10-13', value: 70 }] },
      { profileRevision: 1, weights: [] },
    ),
    /连接失败.*刷新核对/,
  );
  assert.deepEqual(state, original);
});
test('批量替换记录被拒绝，不发送部分写入', async () => {
  let called = false;
  const api = createAccountApi(async () => {
    called = true;
    throw new Error('不得调用');
  });
  const state = initialState();
  await assert.rejects(
    api.save(
      state,
      {
        ...state,
        weights: [
          { date: '2026-10-13', value: 70 },
          { date: '2026-10-14', value: 71 },
        ],
      },
      { profileRevision: 1, weights: [] },
    ),
    /一次保存一项/,
  );
  assert.equal(called, false);
});
