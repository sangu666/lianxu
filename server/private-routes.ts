import { reliableWrite } from './reliable-write.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient, Prisma } from '@prisma/client';
import { validateProfile } from '../public/core.js';
import { activePlanDays } from '../public/plan-document.js';
import { ApiError } from './errors.js';

type AuthHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
interface Pagination {
  page?: number;
  pageSize?: number;
}
const paginationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 24 },
  },
};
const emptyQuery = { type: 'object', additionalProperties: false, properties: {} };
const profileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['age', 'height', 'weight', 'days', 'experience', 'equipment', 'goal'],
  properties: {
    age: { type: 'integer', minimum: 18, maximum: 100 },
    height: { type: 'number', minimum: 100, maximum: 230 },
    weight: { type: 'number', minimum: 30, maximum: 250 },
    days: { type: 'integer', enum: [3, 4] },
    experience: { type: 'string', enum: ['beginner', 'experienced'] },
    equipment: { type: 'string', enum: ['home', 'gym'] },
    goal: { type: 'string', enum: ['habit', 'fatloss', 'muscle'] },
    availableEquipment: {
      type: 'array',
      maxItems: 20,
      uniqueItems: true,
      items: { type: 'string', maxLength: 40 },
    },
    sessionMinutes: { type: 'integer', enum: [20, 30, 45, 60, 90] },
    movementPreference: { type: 'string', enum: ['any', 'machines', 'freeweights', 'bodyweight'] },
    excludedPatterns: {
      type: 'array',
      maxItems: 20,
      uniqueItems: true,
      items: { type: 'string', maxLength: 40 },
    },
    restrictionNotes: { type: 'string', maxLength: 1000 },
  },
};

/** 所有私有查询固定带登录 userId；URL/请求体中的账户编号不能扩大查询范围。 */
export function registerPrivateRoutes(
  app: FastifyInstance,
  db: PrismaClient,
  requireSession: AuthHook,
  requireWrite: AuthHook,
) {
  const read = { preHandler: requireSession, schema: { querystring: emptyQuery } };
  app.get('/api/v1/me/profile', read, async (request) => {
    const profile = await db.profile.findUnique({
      where: { userId: request.principal!.userId },
      select: { data: true, revision: true },
    });
    return profile
      ? { profile: profile.data, revision: profile.revision }
      : { profile: null, revision: 0 };
  });
  app.put<{
    Body: { profile: Record<string, unknown>; expectedRevision: number; expectedVersion?: number };
  }>(
    '/api/v1/me/profile',
    {
      preHandler: requireWrite,
      schema: {
        querystring: emptyQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['profile', 'expectedRevision'],
          properties: {
            profile: profileSchema,
            expectedRevision: { type: 'integer', minimum: 0, maximum: 2147483646 },
            expectedVersion: { type: 'integer', minimum: 0, maximum: 2147483646 },
          },
        },
      },
    },
    async (request) => {
      const userId = request.principal!.userId;
      const { profile, expectedRevision } = request.body;
      try {
        validateProfile(profile);
      } catch {
        throw new ApiError(400, 'INVALID_PROFILE', '训练资料或设备选项无效。');
      }
      return reliableWrite(db, request, async (tx) => {
        // 串行化同账户资料/计划更新；检查版本后一次提交，失败不产生半份计划。
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
        const current = await tx.profile.findUnique({ where: { userId } });
        if ((current?.revision ?? 0) !== expectedRevision)
          throw new ApiError(409, 'REVISION_CONFLICT', '资料已在其他页面更新，请刷新后重试。');
        const last = await tx.planVersion.findFirst({
          where: { userId },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const version = (last?.version ?? 0) + 1;
        if (
          request.body.expectedVersion !== undefined &&
          request.body.expectedVersion !== (last?.version ?? 0)
        )
          throw new ApiError(409, 'REVISION_CONFLICT', '计划已在其他页面更新，请刷新后重新核对。');
        // 保存的是规则模板结果；不声称为真实 AI。更改资料清除当前手动计划，旧版本保留。
        const snapshot = JSON.parse(
          JSON.stringify({
            version,
            reason: '账户资料保存（规则模板）',
            profile,
            adjusted: false,
            days: activePlanDays({ profile, version, adjusted: false }),
          }),
        ) as Prisma.InputJsonValue;
        await tx.planVersion.create({ data: { userId, version, snapshot } });
        const saved = await tx.profile.upsert({
          where: { userId },
          create: { userId, data: profile as Prisma.InputJsonValue, revision: 1 },
          update: { data: profile as Prisma.InputJsonValue, revision: { increment: 1 } },
          select: { data: true, revision: true },
        });
        return { profile: saved.data, revision: saved.revision, planVersion: version, snapshot };
      });
    },
  );

  app.get<{ Querystring: Pagination }>(
    '/api/v1/me/plans',
    { preHandler: requireSession, schema: { querystring: paginationSchema } },
    async (request) => {
      const { page = 1, pageSize = 24 } = request.query;
      const where = { userId: request.principal!.userId };
      const [total, items] = await db.$transaction(
        [
          db.planVersion.count({ where }),
          db.planVersion.findMany({
            where,
            orderBy: { version: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: { version: true, snapshot: true, createdAt: true },
          }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      return { items, pagination: { page, pageSize, total } };
    },
  );
  app.get<{ Params: { version: number } }>(
    '/api/v1/me/plans/:version',
    {
      preHandler: requireSession,
      schema: {
        querystring: emptyQuery,
        params: {
          type: 'object',
          required: ['version'],
          properties: { version: { type: 'integer', minimum: 1, maximum: 2147483647 } },
        },
      },
    },
    async (request) => {
      const item = await db.planVersion.findUnique({
        where: {
          userId_version: { userId: request.principal!.userId, version: request.params.version },
        },
        select: { version: true, snapshot: true, createdAt: true },
      });
      if (!item) throw new ApiError(404, 'NOT_FOUND', '未找到这份计划。');
      return { item };
    },
  );
  app.get<{ Querystring: Pagination }>(
    '/api/v1/me/workouts',
    { preHandler: requireSession, schema: { querystring: paginationSchema } },
    async (request) => {
      const { page = 1, pageSize = 24 } = request.query;
      const where = { userId: request.principal!.userId };
      const [total, items] = await db.$transaction(
        [
          db.workout.count({ where }),
          db.workout.findMany({
            where,
            orderBy: [{ date: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
              id: true,
              date: true,
              planName: true,
              planVersion: true,
              status: true,
              startedAt: true,
              completedAt: true,
              revision: true,
            },
          }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      return {
        items: items.map((item) => ({ ...item, date: item.date.toISOString().slice(0, 10) })),
        pagination: { page, pageSize, total },
      };
    },
  );
  // 刷新一次按页读取完整训练，避免每个训练再请求详情触发账户限速。
  app.get<{ Querystring: Pagination }>(
    '/api/v1/me/workout-records',
    { preHandler: requireSession, schema: { querystring: paginationSchema } },
    async (request) => {
      const { page = 1, pageSize = 24 } = request.query;
      const where = { userId: request.principal!.userId };
      const [total, rows] = await db.$transaction(
        [
          db.workout.count({ where }),
          db.workout.findMany({
            where,
            orderBy: [{ date: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: {
              exercises: {
                orderBy: { position: 'asc' },
                include: { sets: { orderBy: { position: 'asc' } } },
              },
            },
          }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      return { items: rows.map(workoutRecord), pagination: { page, pageSize, total } };
    },
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/me/workouts/:id',
    {
      preHandler: requireSession,
      schema: {
        querystring: emptyQuery,
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1, maxLength: 160 } },
        },
      },
    },
    async (request) => {
      const item = await db.workout.findUnique({
        where: { userId_id: { userId: request.principal!.userId, id: request.params.id } },
        include: {
          exercises: {
            orderBy: { position: 'asc' },
            include: { sets: { orderBy: { position: 'asc' } } },
          },
        },
      });
      if (!item) throw new ApiError(404, 'NOT_FOUND', '未找到这次训练。');
      return { item: workoutRecord(item) };
    },
  );
  app.get<{ Querystring: Pagination }>(
    '/api/v1/me/weights',
    { preHandler: requireSession, schema: { querystring: paginationSchema } },
    async (request) => {
      const { page = 1, pageSize = 24 } = request.query;
      const where = { userId: request.principal!.userId };
      const [total, rows] = await db.$transaction(
        [
          db.weightEntry.count({ where }),
          db.weightEntry.findMany({
            where,
            orderBy: [{ date: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
          date: row.date.toISOString().slice(0, 10),
          kg: row.kg.toString(),
        })),
        pagination: { page, pageSize, total },
      };
    },
  );
}

/** 私有训练输出只取公开业务字段，十进制千克用字符串保留精度。 */
function workoutRecord(
  item: Prisma.WorkoutGetPayload<{ include: { exercises: { include: { sets: true } } } }>,
) {
  return {
    id: item.id,
    date: item.date.toISOString().slice(0, 10),
    planName: item.planName,
    planVersion: item.planVersion,
    status: item.status,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    notes: item.notes,
    origin: item.origin,
    revision: item.revision,
    exercises: item.exercises.map((action) => ({
      id: action.id,
      exerciseId: action.exerciseId,
      name: action.name,
      unit: action.unit,
      prescription: action.prescription,
      sets: action.sets.map((set) => ({
        id: set.id,
        loadKg: set.loadKg.toString(),
        value: set.value,
        rir: set.rir,
        pain: set.pain,
      })),
    })),
  };
}
