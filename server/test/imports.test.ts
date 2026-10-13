import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../db.js';
import { buildApp } from '../app.js';
import { initialState } from '../../public/storage.js';
import { createWorkout } from '../../public/workouts.js';
import { acceptEditablePlan, draftFromState, parsePlanDraft } from '../../public/plan-document.js';

// 全部账户、身体资料和备份为虚构；测试启动器使用独立数据库，不读取开发个人记录。
const db = createDatabase(process.env.DATABASE_URL ?? '');
const app = buildApp(db);
const origin = 'http://127.0.0.1:3100';
let address = 1;
type Account = { id: string; cookie: string; csrf: string };
async function account(): Promise<Account> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    remoteAddress: `192.0.2.${address++}`,
    headers: { origin },
    payload: { email: `import-${randomUUID()}@example.test`, password: 'Demo-password-2026!' },
  });
  assert.equal(response.statusCode, 201, response.body);
  const cookie = String(response.headers['set-cookie']).split(';')[0];
  return { id: response.json().user.id, cookie, csrf: response.json().csrfToken };
}
const headers = (a: Account) => ({
  origin,
  cookie: a.cookie,
  'x-csrf-token': a.csrf,
  'x-account-id': a.id,
});
function fixture() {
  const state = initialState();
  const workout = createWorkout({
    id: randomUUID(),
    date: '2026-10-12',
    startedAt: '2026-10-12T02:00:00.000Z',
    planVersion: 1,
    planName: '历史计时训练',
    exercises: [
      {
        id: randomUUID(),
        exerciseId: 'legacy:unknown-motion',
        name: '旧版未知计时动作',
        unit: 'seconds',
      },
    ],
  });
  workout.origin = 'legacy';
  workout.status = 'completed';
  workout.startedAt = null;
  workout.completedAt = null;
  workout.exercises[0].sets = [{ id: randomUUID(), load: 0, value: 35, rir: 3, pain: true }];
  state.workouts = [workout];
  state.weights = [{ date: '2026-10-12', value: 72.125 }];
  return state;
}
function text(state: ReturnType<typeof initialState>, extra = {}) {
  return JSON.stringify({
    format: 'lianxu-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    state,
    ...extra,
  });
}
async function preview(a: Account, state: ReturnType<typeof initialState>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/me/imports/preview',
    headers: headers(a),
    payload: { text: text(state) },
  });
}
async function confirm(a: Account, id: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/me/imports/${id}/confirm`,
    headers: headers(a),
    payload: { acknowledge: true },
  });
}
async function counts(a: Account) {
  return {
    plans: await db.planVersion.count({ where: { userId: a.id } }),
    workouts: await db.workout.count({ where: { userId: a.id } }),
    sets: await db.workoutSet.count({ where: { userId: a.id } }),
    weights: await db.weightEntry.count({ where: { userId: a.id } }),
    profiles: await db.profile.count({ where: { userId: a.id } }),
  };
}
after(async () => {
  await app.close();
  await db.$disconnect();
});

test('空账户预览不改业务数据；确认保留稳定ID、秒数、未知动作、疼痛和空起止时间', async () => {
  const a = await account(),
    state = fixture();
  const response = await preview(a, state);
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(await counts(a), { plans: 0, workouts: 0, sets: 0, weights: 0, profiles: 0 });
  const job = response.json();
  assert.equal(job.summary.keepCurrent, false);
  assert.ok(job.summary.warnings.length >= 2);
  const done = await confirm(a, job.id);
  assert.equal(done.statusCode, 200, done.body);
  const rows = (await app.inject({ url: '/api/v1/me/workout-records', headers: headers(a) })).json()
    .items;
  assert.equal(rows[0].id, state.workouts[0].id);
  assert.equal(rows[0].exercises[0].exerciseId, 'legacy:unknown-motion');
  assert.equal(rows[0].exercises[0].unit, 'seconds');
  assert.equal(rows[0].exercises[0].sets[0].value, 35);
  assert.equal(rows[0].exercises[0].sets[0].pain, true);
  assert.equal(rows[0].startedAt, null);
  assert.equal(rows[0].completedAt, null);
  const stored = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(stored.payload, null);
  assert.equal(stored.status, 'confirmed');
});
test('并发重复确认只有一次写入；重新导出时刻与JSON空白不制造第二份导入', async () => {
  const a = await account(),
    state = fixture(),
    p = await preview(a, state);
  assert.equal(p.statusCode, 200, p.body);
  const responses = await Promise.all([confirm(a, p.json().id), confirm(a, p.json().id)]);
  assert.deepEqual(
    responses.map((r) => r.statusCode),
    [200, 200],
  );
  assert.equal(responses.filter((r) => r.json().repeated === false).length, 1);
  const again = await preview(a, state);
  assert.equal(again.json().status, 'confirmed');
  assert.equal(again.json().id, p.json().id);
  assert.deepEqual(await counts(a), { plans: 1, workouts: 1, sets: 1, weights: 1, profiles: 1 });
});
test('已有账户追加备份历史但保持当前资料和计划，重映射来源版本而不更改已有快照', async () => {
  const a = await account(),
    source = fixture(),
    profile = { ...source.profile, height: 190 };
  const save = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/profile',
    headers: headers(a),
    payload: { profile, expectedRevision: 0, expectedVersion: 0 },
  });
  assert.equal(save.statusCode, 200);
  const old = await db.planVersion.findUniqueOrThrow({
    where: { userId_version: { userId: a.id, version: 1 } },
  });
  const p = await preview(a, source);
  assert.equal(p.statusCode, 200, p.body);
  assert.equal(p.json().summary.keepCurrent, true);
  assert.deepEqual(p.json().summary.versions, [{ from: 1, to: 2 }]);
  const done = await confirm(a, p.json().id);
  assert.equal(done.statusCode, 200, done.body);
  assert.equal((await db.profile.findUniqueOrThrow({ where: { userId: a.id } })).revision, 2);
  assert.equal(
    ((await db.profile.findUniqueOrThrow({ where: { userId: a.id } })).data as { height: number })
      .height,
    190,
  );
  assert.deepEqual(
    (await db.planVersion.findUniqueOrThrow({ where: { id: old.id } })).snapshot,
    old.snapshot,
  );
  assert.equal((await db.workout.findFirstOrThrow({ where: { userId: a.id } })).planVersion, 2);
  assert.equal(
    (
      await db.planVersion.findFirstOrThrow({
        where: { userId: a.id },
        orderBy: { version: 'desc' },
      })
    ).version,
    3,
  );
});
test('预览后账户资料变化拒绝确认，重新预览产生新编号；旧编号不能再确认', async () => {
  const a = await account(),
    state = fixture(),
    p = await preview(a, state);
  await app.inject({
    method: 'PUT',
    url: '/api/v1/me/profile',
    headers: headers(a),
    payload: { profile: state.profile, expectedRevision: 0 },
  });
  assert.equal((await confirm(a, p.json().id)).statusCode, 409);
  assert.equal(await db.workout.count({ where: { userId: a.id } }), 0);
  const fresh = await preview(a, state);
  assert.notEqual(fresh.json().id, p.json().id);
  assert.equal((await confirm(a, p.json().id)).statusCode, 404);
  assert.equal((await confirm(a, fresh.json().id)).statusCode, 200);
});
test('同ID不同内容、同日不同体重、两份活跃训练阻止预览，不覆盖已有记录', async () => {
  const a = await account(),
    state = fixture(),
    p = await preview(a, state);
  assert.equal((await confirm(a, p.json().id)).statusCode, 200);
  const subset = structuredClone(state);
  subset.weights = [];
  const duplicate = await preview(a, subset);
  assert.equal(duplicate.statusCode, 200, duplicate.body);
  assert.equal(duplicate.json().summary.skipped.workouts, 1);
  assert.equal(duplicate.json().summary.added.workouts, 0);
  subset.workouts = [];
  subset.weights = state.weights;
  const duplicateWeight = await preview(a, subset);
  assert.equal(duplicateWeight.statusCode, 200, duplicateWeight.body);
  assert.equal(duplicateWeight.json().summary.skipped.weights, 1);
  const edited = structuredClone(state);
  edited.workouts[0].exercises[0].sets[0].value = 36;
  assert.equal((await preview(a, edited)).statusCode, 409);
  const weight = structuredClone(state);
  weight.workouts = [];
  weight.weights[0].value = 73;
  assert.equal((await preview(a, weight)).statusCode, 409);
  const active = fixture();
  active.weights = [];
  active.workouts[0].origin = 'manual';
  active.workouts[0].status = 'active';
  active.workouts[0].startedAt = '2026-10-12T02:00:00.000Z';
  const first = await preview(a, active);
  assert.equal((await confirm(a, first.json().id)).statusCode, 200);
  const another = structuredClone(active);
  another.workouts[0].id = randomUUID();
  another.workouts[0].exercises[0].id = randomUUID();
  another.workouts[0].exercises[0].sets[0].id = randomUUID();
  assert.equal((await preview(a, another)).statusCode, 409);
  assert.equal(
    (
      await db.workoutSet.findFirstOrThrow({
        where: { userId: a.id, workoutId: state.workouts[0].id },
      })
    ).value,
    35,
  );
});
test('两账户任务隔离、显式确认、取消和过期清理', async () => {
  const a = await account(),
    b = await account(),
    p = await preview(a, fixture());
  assert.equal((await confirm(b, p.json().id)).statusCode, 404);
  const missingAck = await app.inject({
    method: 'POST',
    url: `/api/v1/me/imports/${p.json().id}/confirm`,
    headers: headers(a),
    payload: { acknowledge: false },
  });
  assert.equal(missingAck.statusCode, 400);
  await app.inject({
    method: 'DELETE',
    url: `/api/v1/me/imports/${p.json().id}`,
    headers: headers(b),
  });
  assert.equal(await db.importJob.count({ where: { id: p.json().id } }), 1);
  await db.importJob.update({ where: { id: p.json().id }, data: { expiresAt: new Date(0) } });
  assert.equal((await confirm(a, p.json().id)).statusCode, 410);
  const restarted = buildApp(db);
  await restarted.inject({ url: '/api/v1/health' });
  const expired = await db.importJob.findUniqueOrThrow({ where: { id: p.json().id } });
  assert.equal(expired.status, 'expired');
  assert.equal(expired.payload, null);
  await restarted.close();
  await app.inject({
    method: 'DELETE',
    url: `/api/v1/me/imports/${p.json().id}`,
    headers: headers(a),
  });
  assert.equal(await db.importJob.count({ where: { id: p.json().id } }), 0);
  assert.equal((await counts(a)).workouts, 0);
});
test('自定义计划及旧训练版本分别保留，嵌套私有扩展明确拒绝', async () => {
  const a = await account();
  const original = fixture();
  const plan = parsePlanDraft(JSON.stringify(draftFromState(original)));
  const state = acceptEditablePlan(original, plan, { acknowledge: true });
  const p = await preview(a, state);
  assert.equal(p.statusCode, 200, p.body);
  assert.equal((await confirm(a, p.json().id)).statusCode, 200);
  const saved = await db.planVersion.findUniqueOrThrow({
    where: { userId_version: { userId: a.id, version: 2 } },
  });
  assert.deepEqual((saved.snapshot as Record<string, unknown>).editablePlan, state.editablePlan);
  assert.equal((await db.workout.findFirstOrThrow({ where: { userId: a.id } })).planVersion, 1);
  const unknown = structuredClone(state);
  Object.assign(unknown.editablePlan!, { photos: ['不能存入'] });
  assert.equal((await preview(a, unknown)).statusCode, 400);
});
test('超精度、缺失版本、未支持隐私字段拒绝，不截断或伪造资料', async () => {
  const a = await account(),
    state = fixture();
  const precision = structuredClone(state);
  precision.weights[0].value = 72.1234;
  assert.equal((await preview(a, precision)).statusCode, 400);
  const missing = structuredClone(state);
  missing.workouts[0].planVersion = 99;
  assert.equal((await preview(a, missing)).statusCode, 400);
  const unknown = { ...state, photos: ['不应存入数据库'] };
  assert.equal((await preview(a, unknown)).statusCode, 400);
  assert.deepEqual(await counts(a), { plans: 0, workouts: 0, sets: 0, weights: 0, profiles: 0 });
});
test('数据库后半段写入失败时整批回滚，原预览保持待确认，不留下半份训练或计划', async () => {
  const a = await account(),
    state = fixture();
  state.weights[0].id = 'force-import-rollback';
  const p = await preview(a, state);
  assert.equal(p.statusCode, 200, p.body);
  await db.$executeRawUnsafe(
    `CREATE FUNCTION reject_import_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = 'force-import-rollback' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER reject_import_test BEFORE INSERT ON "WeightEntry" FOR EACH ROW EXECUTE FUNCTION reject_import_test()',
  );
  try {
    assert.equal((await confirm(a, p.json().id)).statusCode, 503);
    assert.deepEqual(await counts(a), { plans: 0, workouts: 0, sets: 0, weights: 0, profiles: 0 });
    assert.equal(
      (await db.importJob.findUniqueOrThrow({ where: { id: p.json().id } })).status,
      'pending',
    );
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER reject_import_test ON "WeightEntry"');
    await db.$executeRawUnsafe('DROP FUNCTION reject_import_test()');
  }
  assert.equal((await confirm(a, p.json().id)).statusCode, 200);
});
