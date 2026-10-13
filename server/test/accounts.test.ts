import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createDatabase } from '../db.js';
import { buildApp } from '../app.js';

// 两个账号和全部资料均为虚构；只运行在 backend-tests 创建的独立数据库。
const db = createDatabase(process.env.DATABASE_URL ?? '');
const origin = 'http://127.0.0.1:3100';
const clock = new Date();
const app = buildApp(db, { now: () => clock });
const password = 'Demo-password-2026!';
const emailA = `alpha-${randomUUID()}@example.test`;
const emailB = `beta-${randomUUID()}@example.test`;
let a: { user: { id: string; email: string }; csrfToken: string; cookie: string };
let b: typeof a;
const profile = {
  age: 28,
  height: 175,
  weight: 75,
  days: 3,
  experience: 'beginner',
  equipment: 'home',
  goal: 'habit',
  restrictionNotes: '虚构账户甲的备注',
};
function sessionCookie(response: { headers: Record<string, unknown> }) {
  const header = response.headers['set-cookie'];
  return (Array.isArray(header) ? header[0] : String(header)).split(';')[0];
}
const headers = (account: typeof a) => ({
  origin,
  cookie: account.cookie,
  'x-csrf-token': account.csrfToken,
});

before(async () => {
  for (const [email, assign] of [
    [
      emailA,
      (value: typeof a) => {
        a = value;
      },
    ],
    [
      emailB,
      (value: typeof b) => {
        b = value;
      },
    ],
  ] as const) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload: { email, password },
    });
    assert.equal(response.statusCode, 201);
    assign({ ...response.json(), cookie: sessionCookie(response) });
  }
});
after(async () => {
  await app.close();
  await db.$disconnect();
});

test('注册只存加盐密码哈希与会话哈希，Cookie 有保护且响应不含秘密', async () => {
  const userA = await db.user.findUniqueOrThrow({ where: { id: a.user.id } });
  const userB = await db.user.findUniqueOrThrow({ where: { id: b.user.id } });
  assert.ok(userA.passwordHash?.startsWith('scrypt-v1$'));
  assert.notEqual(userA.passwordHash, userB.passwordHash);
  assert.equal(userA.passwordHash?.includes(password), false);
  const token = a.cookie.split('=')[1];
  const stored = await db.session.findUniqueOrThrow({
    where: { tokenHash: createHash('sha256').update(token).digest('hex') },
  });
  assert.notEqual(stored.tokenHash, token);
  const me = await app.inject({ url: '/api/v1/me', headers: { cookie: a.cookie } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.id, a.user.id);
  assert.equal(me.headers['cache-control'], 'no-store');
  assert.equal(me.body.includes('passwordHash'), false);
  assert.equal(me.body.includes(token), false);
});

test('未登录、伪造、损坏会话无法读取任何个人接口', async () => {
  for (const url of [
    '/api/v1/me',
    '/api/v1/me/profile',
    '/api/v1/me/plans',
    '/api/v1/me/workouts',
    '/api/v1/me/weights',
  ]) {
    assert.equal((await app.inject(url)).statusCode, 401);
    assert.equal(
      (await app.inject({ url, headers: { cookie: `lianxu_session=${'a'.repeat(43)}` } }))
        .statusCode,
      401,
    );
  }
  assert.equal(
    (await app.inject({ url: '/api/v1/me', headers: { cookie: 'lianxu_session=broken' } }))
      .statusCode,
    401,
  );
  assert.equal((await app.inject('/api/v1/exercises')).statusCode, 200);
});

test('重复邮箱大小写归一，错误密码和不存在邮箱使用一致错误', async () => {
  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    headers: { origin },
    payload: { email: ` ${emailA.toUpperCase()} `, password },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(await db.user.count({ where: { email: emailA } }), 1);
  const wrong = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email: emailA, password: 'Wrong-password-2026!' },
  });
  const missing = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email: 'missing@example.test', password },
  });
  assert.equal(wrong.statusCode, 401);
  assert.deepEqual(wrong.json(), missing.json());
  assert.equal(wrong.headers['set-cookie'], undefined);
});

test('精确来源和 CSRF 检查阻止跨站登录、资料写入与退出', async () => {
  for (const badOrigin of [
    undefined,
    'https://untrusted.example',
    'http://127.0.0.1:3100.evil.example',
  ]) {
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: badOrigin ? { origin: badOrigin } : {},
          payload: { email: emailA, password },
        })
      ).statusCode,
      403,
    );
  }
  for (const extra of [
    { origin },
    { origin, 'x-csrf-token': '0'.repeat(64) },
    { origin: 'https://untrusted.example', 'x-csrf-token': a.csrfToken },
  ]) {
    const requestHeaders = { cookie: a.cookie, ...extra };
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/me/profile',
          headers: requestHeaders,
          payload: { profile, expectedRevision: 0 },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: requestHeaders }))
        .statusCode,
      403,
    );
  }
  assert.equal(
    (await app.inject({ url: '/api/v1/me', headers: { cookie: a.cookie } })).statusCode,
    200,
  );
  assert.equal(await db.profile.count({ where: { userId: a.user.id } }), 0);
});

test('两账户资料保存和模板版本独立，不能在请求中指定他人归属', async () => {
  assert.equal(
    (await app.inject({ url: '/api/v1/me/profile', headers: headers(a) })).json().profile,
    null,
  );
  const first = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/profile',
    headers: headers(a),
    payload: { profile, expectedRevision: 0 },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().planVersion, 1);
  const second = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/profile',
    headers: headers(b),
    payload: {
      profile: { ...profile, weight: 62, restrictionNotes: '虚构账户乙的备注' },
      expectedRevision: 0,
    },
  });
  assert.equal(second.statusCode, 200);
  for (const payload of [
    { profile, expectedRevision: 1, userId: b.user.id },
    { profile: { ...profile, userId: b.user.id }, expectedRevision: 1 },
  ]) {
    assert.equal(
      (await app.inject({ method: 'PUT', url: '/api/v1/me/profile', headers: headers(a), payload }))
        .statusCode,
      400,
    );
  }
  assert.equal(
    (await app.inject({ url: '/api/v1/me/profile?userId=' + b.user.id, headers: headers(a) }))
      .statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/me/profile', headers: headers(a) })).json().profile.weight,
    75,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/me/profile', headers: headers(b) })).json().profile.weight,
    62,
  );
  const plans = (await app.inject({ url: '/api/v1/me/plans', headers: headers(a) })).json();
  assert.equal(plans.pagination.total, 1);
  assert.equal(plans.items[0].snapshot.profile.restrictionNotes, profile.restrictionNotes);
  assert.ok(plans.items[0].snapshot.days[0].actions.length > 0);
});

test('训练和体重只查询当前账户；同 ID 不串数据，他人独有 ID 返回404', async () => {
  for (const account of [a, b]) {
    await db.workout.create({
      data: {
        userId: account.user.id,
        id: 'shared-training-id',
        planVersion: 1,
        planName: account === a ? '甲的虚构训练' : '乙的虚构训练',
        date: new Date('2026-10-13'),
        status: 'completed',
        origin: 'legacy',
      },
    });
    await db.weightEntry.create({
      data: {
        userId: account.user.id,
        id: 'shared-weight-id',
        date: new Date('2026-10-13'),
        kg: account === a ? 75 : 62,
      },
    });
  }
  await db.workout.create({
    data: {
      userId: b.user.id,
      id: 'only-b-training',
      planVersion: 1,
      planName: '乙独有',
      date: new Date('2026-10-13'),
      status: 'completed',
      origin: 'legacy',
    },
  });
  const own = await app.inject({
    url: '/api/v1/me/workouts/shared-training-id',
    headers: headers(a),
  });
  assert.equal(own.json().item.planName, '甲的虚构训练');
  assert.equal(own.body.includes('乙'), false);
  assert.equal(
    (await app.inject({ url: '/api/v1/me/workouts', headers: headers(a) })).json().items[0].date,
    '2026-10-13',
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/me/workouts/only-b-training', headers: headers(a) }))
      .statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/me/workouts', headers: headers(a) })).json().pagination.total,
    1,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/me/workouts', headers: headers(b) })).json().pagination.total,
    2,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/me/weights', headers: headers(a) })).json().items[0].kg,
    '75',
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/me/weights', headers: headers(b) })).json().items[0].kg,
    '62',
  );
  await db.planVersion.create({
    data: { userId: b.user.id, version: 9, snapshot: { title: '乙独有计划' } },
  });
  assert.equal(
    (await app.inject({ url: '/api/v1/me/plans/9', headers: headers(a) })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/me/plans/9', headers: headers(b) })).statusCode,
    200,
  );
});

test('并发资料写入一项成功、一项冲突，旧计划和旧训练不变；坏输入不写入', async () => {
  const responses = await Promise.all(
    [76, 77].map((weight) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/me/profile',
        headers: headers(a),
        payload: { profile: { ...profile, weight }, expectedRevision: 1 },
      }),
    ),
  );
  assert.deepEqual(responses.map((row) => row.statusCode).sort(), [200, 409]);
  assert.equal(await db.planVersion.count({ where: { userId: a.user.id } }), 2);
  const old = (await app.inject({ url: '/api/v1/me/plans/1', headers: headers(a) })).json().item;
  assert.equal(old.snapshot.profile.weight, 75);
  assert.equal(
    (
      await app.inject({ url: '/api/v1/me/workouts/shared-training-id', headers: headers(a) })
    ).json().item.planVersion,
    1,
  );
  const bad = await app.inject({
    method: 'PUT',
    url: '/api/v1/me/profile',
    headers: headers(a),
    payload: {
      profile: { ...profile, availableEquipment: ['unknown-device'] },
      expectedRevision: 2,
    },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(await db.planVersion.count({ where: { userId: a.user.id } }), 2);
  assert.equal(
    (await app.inject({ url: '/api/v1/me/profile', headers: headers(b) })).json().revision,
    1,
  );
});

test('后端应用重新创建后会话仍有效，读取不返回会话哈希', async () => {
  const restarted = buildApp(db, { now: () => clock });
  try {
    const me = await restarted.inject({ url: '/api/v1/me', headers: { cookie: b.cookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.id, b.user.id);
    assert.equal(me.body.includes('tokenHash'), false);
  } finally {
    await restarted.close();
  }
});

test('密码长度和额外字段校验；登录限速不会被转发头绕过', async () => {
  const limited = buildApp(db);
  try {
    let response;
    for (let index = 0; index < 11; index++) {
      response = await limited.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin, 'x-forwarded-for': `198.51.100.${index}` },
        payload: { email: emailA, password: 'short', userId: b.user.id },
      });
      assert.equal(response.statusCode, index < 10 ? 400 : 429);
    }
    assert.equal(response!.body.includes(password), false);
  } finally {
    await limited.close();
  }
});

test('登录创建新令牌、最多五个会话；退出立即撤销旧令牌', async () => {
  let latest = a;
  const issued: string[] = [];
  const rotated = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin, cookie: a.cookie },
    payload: { email: emailA, password },
    remoteAddress: '127.0.0.2',
  });
  assert.equal(rotated.statusCode, 200);
  assert.notEqual(sessionCookie(rotated), a.cookie);
  assert.equal(
    (await app.inject({ url: '/api/v1/me', headers: { cookie: a.cookie } })).statusCode,
    401,
  );
  for (let index = 0; index < 6; index++) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { email: emailA.toUpperCase(), password },
      remoteAddress: '127.0.0.2',
    });
    assert.equal(response.statusCode, 200);
    const cookieHeader = String(response.headers['set-cookie']);
    assert.ok(cookieHeader.includes('HttpOnly'));
    assert.ok(cookieHeader.includes('SameSite=Strict'));
    assert.ok(cookieHeader.includes('Path=/api/v1'));
    latest = { ...response.json(), cookie: sessionCookie(response) };
    issued.push(latest.cookie);
  }
  assert.equal(new Set(issued).size, 6);
  assert.equal(await db.session.count({ where: { userId: a.user.id } }), 5);
  assert.equal(
    (await app.inject({ url: '/api/v1/me', headers: { cookie: issued[0] } })).statusCode,
    401,
  );
  const logout = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: headers(latest),
  });
  assert.equal(logout.statusCode, 200);
  assert.equal(
    (await app.inject({ url: '/api/v1/me', headers: { cookie: latest.cookie } })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/v1/me/profile',
        headers: headers(latest),
        payload: { profile, expectedRevision: 2 },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/me', headers: { cookie: b.cookie } })).statusCode,
    200,
  );
});

test('会话绝对过期后返回401并清理；生产 Cookie 强制 Secure', async () => {
  const future = buildApp(db, { now: () => new Date(clock.getTime() + 8 * 24 * 60 * 60 * 1000) });
  try {
    const expired = await future.inject({ url: '/api/v1/me', headers: { cookie: b.cookie } });
    assert.equal(expired.statusCode, 401);
    assert.ok(String(expired.headers['set-cookie']).includes('Max-Age=0'));
  } finally {
    await future.close();
  }
  const secure = buildApp(db, { origin: 'https://lianxu.example', secure: true, now: () => clock });
  try {
    const response = await secure.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://lianxu.example' },
      payload: { email: emailB, password },
    });
    assert.equal(response.statusCode, 200);
    assert.ok(String(response.headers['set-cookie']).includes('__Secure-lianxu_session='));
    assert.ok(String(response.headers['set-cookie']).includes('; Secure'));
  } finally {
    await secure.close();
  }
});
