import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../db.js';
import { buildApp } from '../app.js';
import { seedCatalog } from '../catalog.js';

// 此文件只能由独立数据库测试启动器执行，输入数据全部虚构。
const db = createDatabase(process.env.DATABASE_URL ?? '');
const app = buildApp(db);
before(async () => {
  await app.ready();
});
after(async () => {
  await app.close();
  await db.$disconnect();
});

test('真实 PostgreSQL 就绪，公开目录 1342 条且无个人数据', async () => {
  assert.equal((await app.inject('/api/v1/ready')).statusCode, 200);
  assert.equal(await db.exercise.count(), 1342);
  assert.equal(await db.user.count(), 0);
  assert.equal(await db.workout.count(), 0);
});

test('数据库中文/英文搜索、组合筛选、稳定分页与空结果', async () => {
  const first = (await app.inject('/api/v1/exercises?pageSize=10')).json();
  const second = (await app.inject('/api/v1/exercises?page=2&pageSize=10')).json();
  assert.equal(first.pagination.total, 1342);
  assert.equal(first.items.length, 10);
  assert.equal(
    new Set([...first.items, ...second.items].map((item: { id: string }) => item.id)).size,
    20,
  );
  const zh = (await app.inject('/api/v1/exercises?q=' + encodeURIComponent('阿诺德'))).json();
  const en = (await app.inject('/api/v1/exercises?q=arnold')).json();
  assert.ok(zh.items.length > 0);
  assert.deepEqual(
    zh.items.map((item: { id: string }) => item.id),
    en.items.map((item: { id: string }) => item.id),
  );
  const filtered = (
    await app.inject('/api/v1/exercises?bodyPart=shoulders&equipment=dumbbell&origin=community')
  ).json();
  assert.ok(filtered.items.length > 0);
  assert.ok(
    filtered.items.every(
      (item: { bodyPart: string; equipment: string; origin: string }) =>
        item.bodyPart === 'shoulders' &&
        item.equipment === 'dumbbell' &&
        item.origin === 'community',
    ),
  );
  assert.equal(
    (await app.inject('/api/v1/exercises?q=THIS_DOES_NOT_EXIST_12345')).json().pagination.total,
    0,
  );
  assert.deepEqual((await app.inject('/api/v1/exercises?page=100000')).json().items, []);
});

test('参数边界、未知参数和注入文本不会放宽查询', async () => {
  for (const query of [
    'page=0',
    'pageSize=101',
    'page=1.5',
    'origin=private',
    'unknown=1',
    'q=' + 'a'.repeat(101),
  ]) {
    assert.equal((await app.inject('/api/v1/exercises?' + query)).statusCode, 400);
  }
  const result = await app.inject('/api/v1/exercises?q=' + encodeURIComponent("' OR 1=1 --"));
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().pagination.total, 0);
  assert.equal((await app.inject('/api/v1/exercises?q=%25')).json().pagination.total, 0);
});

test('详情保留来源与单位，无媒体；不存在的动作和私有接口返回404', async () => {
  const detail = (await app.inject('/api/v1/exercises/hasaneyldrm%3A0001')).json().item;
  assert.equal(detail.id, 'hasaneyldrm:0001');
  assert.equal(detail.unit, 'unspecified');
  assert.equal(detail.sourceCommit, '7455efae41b330c265e7cd4b78dfa848e7ce5ebd');
  assert.ok(detail.stepsZh.length > 0);
  assert.equal('gifUrl' in detail, false);
  assert.equal((await app.inject('/api/v1/exercises/missing')).statusCode, 404);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/v1/workouts', payload: {} })).statusCode,
    404,
  );
  const filters = (await app.inject('/api/v1/exercise-filters')).json();
  assert.ok(filters.bodyParts.includes('waist'));
  assert.ok(filters.equipment.includes('dumbbell'));
});

test('公开目录可重复导入，不增加数量或改变稳定编号', async () => {
  assert.equal(await seedCatalog(db), 1342);
  assert.equal(await db.exercise.count(), 1342);
});

test('不可变计划版本、跨账户引用和单账户活跃训练约束', async () => {
  const user = await db.user.create({ data: {} });
  const other = await db.user.create({ data: {} });
  await db.planVersion.create({
    data: {
      userId: user.id,
      version: 1,
      snapshot: { title: '虚构计划', actions: [{ unit: 'seconds', targetMin: 20 }] },
    },
  });
  await assert.rejects(
    db.planVersion.update({
      where: { userId_version: { userId: user.id, version: 1 } },
      data: { snapshot: { title: '覆盖' } },
    }),
  );
  const base = {
    userId: user.id,
    id: randomUUID(),
    planVersion: 1,
    planName: '虚构计划',
    date: new Date('2026-10-13'),
    status: 'active' as const,
    startedAt: new Date('2026-10-13T01:00:00Z'),
    origin: 'manual',
  };
  await db.workout.create({ data: base });
  await assert.rejects(db.workout.create({ data: { ...base, id: randomUUID() } }));
  await assert.rejects(
    db.workout.create({ data: { ...base, userId: other.id, id: randomUUID() } }),
  );
  await db.planVersion.create({
    data: { userId: user.id, version: 2, snapshot: { title: '虚构新计划' } },
  });
  assert.equal(
    (await db.workout.findUniqueOrThrow({ where: { userId_id: { userId: user.id, id: base.id } } }))
      .planVersion,
    1,
  );
});

test('训练单位与事务失败回滚由真实数据库验证', async () => {
  const user = await db.user.create({ data: {} });
  await db.planVersion.create({
    data: { userId: user.id, version: 1, snapshot: { title: '虚构秒数动作' } },
  });
  const workoutId = randomUUID();
  await db.workout.create({
    data: {
      userId: user.id,
      id: workoutId,
      planVersion: 1,
      planName: '虚构',
      date: new Date('2026-10-13'),
      status: 'active',
      origin: 'manual',
    },
  });
  await assert.rejects(
    db.workoutExercise.create({
      data: {
        userId: user.id,
        workoutId,
        id: 'bad',
        exerciseId: 'legacy:name',
        name: '未知旧动作',
        unit: 'unspecified',
        position: 0,
      },
    }),
  );
  await db.workoutExercise.create({
    data: {
      userId: user.id,
      workoutId,
      id: 'valid',
      exerciseId: 'lianxu:plank',
      name: '平板支撑快照',
      unit: 'seconds',
      position: 0,
      prescription: { sets: 2, targetMin: 20, targetMax: 30, restSeconds: 60 },
    },
  });
  await assert.rejects(
    db.$transaction([
      db.workoutSet.create({
        data: {
          userId: user.id,
          workoutId,
          workoutExerciseId: 'valid',
          id: 'one',
          position: 0,
          loadKg: 0,
          value: 25,
        },
      }),
      db.workoutSet.create({
        data: {
          userId: user.id,
          workoutId,
          workoutExerciseId: 'valid',
          id: 'two',
          position: 1,
          loadKg: -1,
          value: 25,
        },
      }),
    ]),
  );
  assert.equal(await db.workoutSet.count({ where: { userId: user.id } }), 0);
  await db.workoutSet.create({
    data: {
      userId: user.id,
      workoutId,
      workoutExerciseId: 'valid',
      id: 'saved',
      position: 0,
      loadKg: 0,
      value: 25,
      rir: 2,
    },
  });
  assert.equal(
    (await db.workoutExercise.findFirstOrThrow({ where: { userId: user.id } })).unit,
    'seconds',
  );
});

test('数据库不可用时返回503，不泄漏连接和堆栈', async () => {
  const unavailable = createDatabase('postgresql://fake:secret@127.0.0.1:1/missing');
  const broken = buildApp(unavailable);
  try {
    assert.equal((await broken.inject('/api/v1/health')).statusCode, 200);
    for (const url of ['/api/v1/ready', '/api/v1/exercises']) {
      const response = await broken.inject(url);
      assert.equal(response.statusCode, 503);
      assert.equal(response.body.includes('secret'), false);
      assert.equal(response.body.includes('stack'), false);
    }
  } finally {
    await broken.close();
    await unavailable.$disconnect();
  }
});
