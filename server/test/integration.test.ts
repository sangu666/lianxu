import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../db.js';
import { buildApp } from '../app.js';
import { registerFrontend } from '../frontend.js';
import { createWorkout } from '../../public/workouts.js';
import { createAccountApi } from '../../public/account-api.js';

// 独立数据库和虚构账户；客户端通过真实 Fastify 路由验证字段映射与保存闭环。
const db = createDatabase(process.env.DATABASE_URL ?? '');
const app = buildApp(db);
registerFrontend(app);
const origin = 'http://127.0.0.1:3100';
let cookie = '';
const client = createAccountApi(async (url, options) => {
  const response = await app.inject({
    method: options!.method as 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: String(url),
    headers: { origin, cookie, ...(options!.headers as Record<string, string>) },
    ...(options!.body ? { payload: String(options!.body) } : {}),
  });
  const setCookie = response.headers['set-cookie'];
  if (setCookie) cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0];
  return new Response(response.body, {
    status: response.statusCode,
    headers: response.headers as Record<string, string>,
  });
});
let metadata: Awaited<ReturnType<typeof client.load>>;
const commit = async (next: typeof metadata.state, options = {}) => {
  metadata = await client.save(metadata.state, next, metadata, options);
};
before(async () => {
  await client.authenticate(
    'register',
    `integration-${randomUUID()}@example.test`,
    'Demo-password-2026!',
  );
  metadata = await client.load();
});
after(async () => {
  await app.close();
  await db.$disconnect();
});

test('数据库页面同源可用，私有源码/密钥不可访问，未保存资料禁止开始训练', async () => {
  assert.equal((await app.inject('/')).statusCode, 200);
  assert.equal((await app.inject('/account-api.js')).statusCode, 200);
  for (const path of ['/server/auth.ts', '/.env', '/work/local-postgres/connection.json'])
    assert.equal((await app.inject(path)).statusCode, 404);
  await assert.rejects(
    commit({ ...metadata.state, weights: [{ date: '2026-10-13', value: 70 }] }),
    /先.*保存账户资料/,
  );
});
test('资料事务保存后客户端版本从示例转为数据库版本，刷新恢复', async () => {
  await commit(metadata.state, { profile: true });
  assert.equal(metadata.profileRevision, 1);
  assert.equal(metadata.state.version, 1);
  assert.equal(metadata.state.history.length, 1);
  metadata = await client.load();
  assert.equal(metadata.state.profile.height, 175);
});
test('客户端开始、逐组保存、完成、刷新和删除训练；旧版本和动作处方不改变', async () => {
  const snapshot = await client.request('/me/plans/1');
  const day = snapshot.item.snapshot.days[0];
  const workout = createWorkout({
    id: randomUUID(),
    date: '2026-10-13',
    startedAt: new Date().toISOString(),
    planVersion: 1,
    planName: day.name,
    exercises: day.actions.map(
      (action: {
        exerciseId: string;
        name: string;
        unit: 'reps' | 'seconds';
        sets: number;
        targetMin: number;
        targetMax: number;
        restSeconds: number;
        reason: string;
      }) => ({
        id: randomUUID(),
        exerciseId: action.exerciseId,
        name: action.name,
        unit: action.unit,
        prescription: {
          sets: action.sets,
          targetMin: action.targetMin,
          targetMax: action.targetMax,
          restSeconds: action.restSeconds,
          reason: action.reason,
        },
      }),
    ),
  });
  await commit({ ...metadata.state, workouts: [workout] });
  assert.equal(metadata.state.workouts[0].revision, 1);
  const next = structuredClone(metadata.state);
  next.workouts[0].exercises[0].sets.push({
    id: randomUUID(),
    load: 12.125,
    value: 8,
    rir: 2,
    pain: false,
  });
  await commit(next);
  const saved = structuredClone(metadata.state.workouts[0]);
  metadata = await client.load();
  assert.deepEqual(metadata.state.workouts[0], saved);
  const tampered = structuredClone(saved);
  tampered.exercises[0].unit = 'seconds';
  await assert.rejects(
    client.request(`/me/workouts/${saved.id}`, 'PUT', {
      expectedRevision: saved.revision,
      workout: tampered,
    }),
    /快照|单位/,
  );
  await client.discardPending(); // 明确拒绝的测试请求先核对并清理，下一项操作才可保存。
  const finish = structuredClone(metadata.state);
  finish.workouts[0].status = 'completed';
  finish.workouts[0].completedAt = new Date().toISOString();
  await commit(finish);
  const done = metadata.state.workouts[0];
  await assert.rejects(
    client.request(`/me/workouts/${done.id}`, 'PUT', { expectedRevision: 1, workout: done }),
    /其他页面/,
  );
  await client.discardPending(); // 明确拒绝的测试请求先核对并清理，下一项操作才可保存。
  await commit({ ...metadata.state, workouts: [] });
  assert.equal((await client.load()).state.workouts.length, 0);
});
test('体重十进制映射、同日条件更新和超精度拒绝', async () => {
  await commit({ ...metadata.state, weights: [{ date: '2026-10-13', value: 70.125 }] });
  const original = metadata.weights[0];
  assert.equal(metadata.state.weights[0].id, original.id);
  await commit({ ...metadata.state, weights: [{ date: '2026-10-13', value: 71 }] });
  await assert.rejects(
    client.request('/me/weights/2026-10-13', 'PUT', {
      value: 72,
      expected: { id: original.id, kg: original.kg },
    }),
    /其他页面/,
  );
  await client.discardPending(); // 明确拒绝的测试请求先核对并清理，下一项操作才可保存。
  await assert.rejects(
    client.request('/me/weights/2026-10-14', 'PUT', { value: 72.1234, expected: null }),
    /三位小数/,
  );
  await client.discardPending(); // 明确拒绝的测试请求先核对并清理，下一项操作才可保存。
  assert.equal((await client.load()).state.weights[0].value, 71);
  assert.equal((await client.load()).state.weights[0].id, original.id);
});
test('计划确认并发只有一个成功，旧资料页面不能覆盖新手动计划', async () => {
  const payload = {
    expectedVersion: 1,
    expectedRevision: 1,
    plan: { adjusted: true, reason: '虚构减量演示' },
  };
  const results = await Promise.allSettled([
    client.request('/me/plans', 'POST', payload),
    client.request('/me/plans', 'POST', payload),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  await client.discardPending();
  await assert.rejects(
    client.request('/me/profile', 'PUT', {
      profile: metadata.state.profile,
      expectedRevision: 1,
      expectedVersion: 1,
    }),
    /计划已.*更新/,
  );
  await client.discardPending(); // 明确拒绝的测试请求先核对并清理，下一项操作才可保存。
  metadata = await client.load();
  assert.equal(metadata.state.version, 2);
  assert.equal(metadata.state.history[0].adjusted, false);
  assert.equal(metadata.state.adjusted, true);
});
test('跨标签账户切换阻止读取和写入；缺少CSRF禁止写入', async () => {
  const owner = client.getSession()!.user.id;
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email: `other-${randomUUID()}@example.test`, password: 'Demo-password-2026!' },
  });
  assert.equal(response.statusCode, 201);
  const otherCookie = String(response.headers['set-cookie']).split(';')[0];
  assert.equal(
    (
      await app.inject({
        url: '/api/v1/me/profile',
        headers: { cookie: otherCookie, 'x-account-id': owner },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/me/weights/2026-10-13',
        headers: { origin, cookie: otherCookie },
        payload: { value: 65, expected: null },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/me/weights', headers: { cookie: otherCookie } })).json().items
      .length,
    0,
  );
});
