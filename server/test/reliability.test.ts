import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../db.js';
import { buildApp } from '../app.js';
import { initialState } from '../../public/storage.js';
import { createAccountApi } from '../../public/account-api.js';
import { createWorkout } from '../../public/workouts.js';
const db = createDatabase(process.env.DATABASE_URL ?? '');
const app = buildApp(db);
const origin = 'http://127.0.0.1:3100';
let address = 1;
async function account() {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    remoteAddress: `192.0.2.${address++}`,
    headers: { origin },
    payload: {
      email: `reliable-${randomUUID()}@example.test`,
      password: 'Fake-reliable-password!',
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  return {
    id: r.json().user.id,
    cookie: String(r.headers['set-cookie']).split(';')[0],
    csrf: r.json().csrfToken,
  };
}
const headers = (a: Awaited<ReturnType<typeof account>>, key?: string) => ({
  origin,
  cookie: a.cookie,
  'x-account-id': a.id,
  'x-csrf-token': a.csrf,
  ...(key ? { 'idempotency-key': key } : {}),
});
const profile = () => ({
  profile: initialState().profile,
  expectedRevision: 0,
  expectedVersion: 0,
});
after(async () => {
  await app.close();
  await db.$disconnect();
});
test('并发同编号只写一次、重复内容键顺序不变；同编号不同内容拒绝', async () => {
  const a = await account(),
    key = randomUUID(),
    payload = profile();
  const send = () =>
    app.inject({ method: 'PUT', url: '/api/v1/me/profile', headers: headers(a, key), payload });
  const results = await Promise.all([send(), send()]);
  assert.equal(results[0].statusCode, 200, results[0].body);
  assert.equal(results[1].statusCode, 200);
  assert.deepEqual(results[0].json(), results[1].json());
  assert.equal(await db.planVersion.count({ where: { userId: a.id } }), 1);
  assert.equal(await db.writeReceipt.count({ where: { userId: a.id } }), 1);
  const edited = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/profile',
    headers: headers(a, key),
    payload: { ...payload, profile: { ...payload.profile, height: 180 } },
  });
  assert.equal(edited.statusCode, 409);
  assert.equal(edited.json().error.code, 'REQUEST_KEY_REUSED');
  const reordered = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/profile',
    headers: headers(a, key),
    payload: { expectedVersion: 0, expectedRevision: 0, profile: payload.profile },
  });
  assert.equal(reordered.statusCode, 200);
});
test('回执账户隔离，退出/伪造来源不能读取；无效请求编号拒绝', async () => {
  const a = await account(),
    b = await account(),
    key = randomUUID();
  for (const user of [a, b]) {
    const r = await app.inject({
      method: 'PUT',
      url: '/api/v1/me/profile',
      headers: headers(user, key),
      payload: profile(),
    });
    assert.equal(r.statusCode, 200);
  }
  assert.equal(await db.writeReceipt.count({ where: { key } }), 2);
  const wrong = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/profile',
    headers: { ...headers(a, key), origin: 'http://evil.test' },
    payload: profile(),
  });
  assert.equal(wrong.statusCode, 403);
  const malformed = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/profile',
    headers: headers(a, 'bad'),
    payload: profile(),
  });
  assert.equal(malformed.statusCode, 400);
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: headers(a),
    payload: {},
  });
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/me/profile',
        headers: headers(a, key),
        payload: profile(),
      })
    ).statusCode,
    401,
  );
});
test('业务写入后回执失败整批回滚，重试原编号可成功', async () => {
  const a = await account(),
    key = randomUUID();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION reject_receipt_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key = '${key}'::uuid THEN RAISE EXCEPTION 'test'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER reject_receipt_test BEFORE INSERT ON "WriteReceipt" FOR EACH ROW EXECUTE FUNCTION reject_receipt_test()',
  );
  try {
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/me/profile',
          headers: headers(a, key),
          payload: profile(),
        })
      ).statusCode,
      503,
    );
    assert.equal(await db.profile.count({ where: { userId: a.id } }), 0);
    assert.equal(await db.planVersion.count({ where: { userId: a.id } }), 0);
    assert.equal(await db.writeReceipt.count({ where: { userId: a.id } }), 0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER reject_receipt_test ON "WriteReceipt"');
    await db.$executeRawUnsafe('DROP FUNCTION reject_receipt_test()');
  }
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/me/profile',
        headers: headers(a, key),
        payload: profile(),
      })
    ).statusCode,
    200,
  );
});
test('资料、计划、训练、组、体重和删除的响应丢失，跨客户端恢复同一请求且不重复写入', async () => {
  const a = await account();
  let drop = false;
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k),
  };
  const fetcher = async (url: unknown, options: RequestInit = {}) => {
    const r = await app.inject({
      method: options.method as 'GET' | 'PUT' | 'POST' | 'DELETE',
      url: String(url),
      headers: { origin, cookie: a.cookie, ...(options.headers as Record<string, string>) },
      ...(options.body ? { payload: String(options.body) } : {}),
    });
    if (drop && options.method !== 'GET') {
      drop = false;
      assert.equal(r.statusCode, 200, r.body);
      throw new Error('响应已丢失');
    }
    return new Response(r.body, { status: r.statusCode });
  };
  let client = createAccountApi(fetcher, { storage });
  await client.restore();
  async function lost(path: string, method: string, body: unknown) {
    drop = true;
    await assert.rejects(client.request(path, method, body), /连接失败/);
    const key = client.getPending()!.key;
    client = createAccountApi(fetcher, { storage });
    await client.restore();
    assert.equal(client.getPending()!.key, key);
    await client.retryPending();
    assert.equal(client.getPending(), null);
  }
  await lost('/me/profile', 'PUT', profile());
  await lost('/me/plans', 'POST', {
    expectedVersion: 1,
    expectedRevision: 1,
    plan: { adjusted: true, reason: '虚构重试' },
  });
  let loaded = await client.load();
  const day = (await client.request('/me/plans/2')).item.snapshot.days[0];
  const workout = createWorkout({
    id: randomUUID(),
    date: '2026-10-13',
    startedAt: new Date().toISOString(),
    planVersion: 2,
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
  await lost(`/me/workouts/${workout.id}`, 'PUT', { expectedRevision: 0, workout });
  loaded = await client.load();
  const updated = loaded.state.workouts[0];
  updated.exercises[0].sets.push({ id: randomUUID(), load: 10.125, value: 8, rir: 2, pain: false });
  await lost(`/me/workouts/${workout.id}`, 'PUT', { expectedRevision: 1, workout: updated });
  assert.equal(await db.workoutSet.count({ where: { userId: a.id } }), 1);
  assert.equal((await db.workout.findFirstOrThrow({ where: { userId: a.id } })).revision, 2);
  await lost('/me/weights/2026-10-13', 'PUT', { value: 72.125, expected: null });
  await lost(`/me/workouts/${workout.id}`, 'DELETE', { expectedRevision: 2 });
  assert.equal(await db.workout.count({ where: { userId: a.id } }), 0);
  assert.equal(await db.weightEntry.count({ where: { userId: a.id } }), 1);
  assert.equal(await db.planVersion.count({ where: { userId: a.id } }), 2);
  assert.equal(await db.writeReceipt.count({ where: { userId: a.id } }), 6);
});
test('离线旧请求遇另一页面新修改返回冲突，不覆盖，队列进入待核对', async () => {
  const a = await account();
  const r = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/profile',
    headers: headers(a, randomUUID()),
    payload: profile(),
  });
  assert.equal(r.statusCode, 200);
  const stale = {
    ...profile(),
    profile: { ...profile().profile, height: 190 },
    expectedRevision: 0,
  };
  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/profile',
    headers: headers(a, randomUUID()),
    payload: stale,
  });
  assert.equal(response.statusCode, 409);
  assert.equal((await db.profile.findUniqueOrThrow({ where: { userId: a.id } })).revision, 1);
  assert.equal(await db.writeReceipt.count({ where: { userId: a.id } }), 1);
});
