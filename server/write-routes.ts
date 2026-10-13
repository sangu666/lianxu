import { reliableWrite } from './reliable-write.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma, type PrismaClient } from '@prisma/client';
import { validateState } from '../public/storage.js';
import { validateWorkoutData, isCalendarDate, type Workout } from '../public/workouts.js';
import { activePlanDays, planWarnings } from '../public/plan-document.js';
import { ApiError } from './errors.js';

type Hook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
const emptyQuery = { type: 'object', additionalProperties: false, properties: {} };
const revision = { type: 'integer', minimum: 0, maximum: 2147483646 };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const conflict = () =>
  new ApiError(
    409,
    'REVISION_CONFLICT',
    '记录已在其他页面更新，请刷新后重新核对；本次修改未保存。',
  );
/** 十进制列只容纳三位小数；拒绝超精度输入，避免数据库静默舍入。 */
function precise(value: number) {
  if (!Number.isFinite(value) || Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-7)
    throw new ApiError(400, 'INVALID_PRECISION', '千克数值最多保留三位小数。');
}
/** 账户行锁串行化计划、训练和体重写入；客户端不得提供 userId。 */
export function registerWriteRoutes(app: FastifyInstance, db: PrismaClient, requireWrite: Hook) {
  app.post<{
    Body: {
      expectedVersion: number;
      expectedRevision: number;
      plan: { adjusted: boolean; reason: string; editablePlan?: unknown; planOverrides?: unknown };
    };
  }>(
    '/api/v1/me/plans',
    {
      preHandler: requireWrite,
      schema: {
        querystring: emptyQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedVersion', 'expectedRevision', 'plan'],
          properties: {
            expectedVersion: revision,
            expectedRevision: revision,
            plan: {
              type: 'object',
              additionalProperties: false,
              required: ['adjusted', 'reason'],
              properties: {
                adjusted: { type: 'boolean' },
                reason: { type: 'string', minLength: 1, maxLength: 200 },
                editablePlan: { type: 'object' },
                planOverrides: { type: 'array', maxItems: 100 },
              },
            },
          },
        },
      },
    },
    async (request) =>
      reliableWrite(db, request, async (tx) => {
        const userId = request.principal!.userId;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
        const profile = await tx.profile.findUnique({ where: { userId } });
        const last = await tx.planVersion.findFirst({
          where: { userId },
          orderBy: { version: 'desc' },
        });
        if (!profile || !last) throw new ApiError(400, 'PROFILE_REQUIRED', '请先保存账户资料。');
        if (
          profile.revision !== request.body.expectedRevision ||
          last.version !== request.body.expectedVersion
        )
          throw conflict();
        const version = last.version + 1;
        const candidate = {
          ...request.body.plan,
          version,
          profile: profile.data,
          schemaVersion: 2,
          workouts: [],
          weights: [],
          history: [],
        };
        try {
          validateState(candidate);
          if (candidate.editablePlan) {
            const plan = candidate.editablePlan as Parameters<typeof planWarnings>[0];
            if (
              planWarnings(plan, candidate.profile).length &&
              plan.days.some((day: { actions: { acknowledged?: boolean }[] }) =>
                day.actions.some((action) => !action.acknowledged),
              )
            )
              throw new Error('未确认计划提醒');
          }
        } catch {
          throw new ApiError(400, 'INVALID_PLAN', '计划或训练条件确认无效，请重新核对草稿。');
        }
        const snapshot = {
          ...request.body.plan,
          version,
          profile: profile.data,
          days: activePlanDays(candidate),
        };
        await tx.planVersion.create({ data: { userId, version, snapshot: json(snapshot) } });
        return { version, snapshot };
      }),
  );
  // 完整训练作为一个事务保存，动作身份和处方快照只在创建时写入。
  app.put<{ Params: { id: string }; Body: { expectedRevision: number; workout: Workout } }>(
    '/api/v1/me/workouts/:id',
    {
      preHandler: requireWrite,
      schema: {
        querystring: emptyQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedRevision', 'workout'],
          properties: { expectedRevision: revision, workout: { type: 'object' } },
        },
      },
    },
    async (request) => {
      const incoming = request.body.workout;
      try {
        validateWorkoutData({ schemaVersion: 2, workouts: [incoming] });
      } catch {
        throw new ApiError(400, 'INVALID_WORKOUT', '训练记录格式无效。');
      }
      if (incoming.id !== request.params.id)
        throw new ApiError(400, 'INVALID_ID', '训练编号不一致。');
      for (const action of incoming.exercises) for (const set of action.sets) precise(set.load);
      return reliableWrite(db, request, async (tx) => {
        const userId = request.principal!.userId;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
        const where = { userId_id: { userId, id: incoming.id } };
        const current = await tx.workout.findUnique({
          where,
          include: { exercises: { orderBy: { position: 'asc' } } },
        });
        if ((current?.revision ?? 0) !== request.body.expectedRevision) throw conflict();
        if (!current) {
          const latest = await tx.planVersion.findFirst({
            where: { userId },
            orderBy: { version: 'desc' },
          });
          const snapshot = latest?.snapshot as
            | {
                days?: {
                  name: string;
                  actions: {
                    exerciseId: string;
                    name: string;
                    unit: string;
                    sets: number;
                    targetMin: number;
                    targetMax: number;
                    restSeconds: number;
                    reason: string;
                  }[];
                }[];
              }
            | undefined;
          const day = snapshot?.days?.find((item) => item.name === incoming.planName);
          if (!latest || latest.version !== incoming.planVersion) throw conflict();
          if (
            !day ||
            !day.actions.length ||
            incoming.status !== 'active' ||
            incoming.origin !== 'manual' ||
            incoming.exercises.some((item) => item.sets.length) ||
            incoming.exercises.length !== day.actions.length
          )
            throw new ApiError(400, 'INVALID_START', '新训练必须从当前账户计划开始。');
          day.actions.forEach((action, index) => {
            const item = incoming.exercises[index];
            const { sets, targetMin, targetMax, restSeconds, reason } = action;
            if (
              item.exerciseId !== action.exerciseId ||
              item.name !== action.name ||
              item.unit !== action.unit ||
              !item.prescription ||
              item.prescription.sets !== sets ||
              item.prescription.targetMin !== targetMin ||
              item.prescription.targetMax !== targetMax ||
              item.prescription.restSeconds !== restSeconds ||
              item.prescription.reason !== reason
            )
              throw new ApiError(400, 'INVALID_SNAPSHOT', '动作与当前计划快照不一致。');
          });
        } else {
          if (
            current.planVersion !== incoming.planVersion ||
            current.planName !== incoming.planName ||
            current.origin !== incoming.origin ||
            (current.startedAt?.toISOString() ?? null) !== incoming.startedAt ||
            (current.status === 'completed' &&
              (incoming.status !== 'completed' ||
                (current.completedAt?.toISOString() ?? null) !== incoming.completedAt)) ||
            current.exercises.length !== incoming.exercises.length
          )
            throw new ApiError(
              400,
              'IMMUTABLE_SNAPSHOT',
              '不能修改训练的计划、开始时间或动作快照。',
            );
          current.exercises.forEach((action, index) => {
            const item = incoming.exercises[index];
            // JSON 属性顺序不构成差异，比较处方内固定字段。
            const keys = ['sets', 'targetMin', 'targetMax', 'restSeconds', 'reason'];
            const original = action.prescription as Record<string, unknown> | null;
            const next = item.prescription as Record<string, unknown> | undefined;
            if (
              action.id !== item.id ||
              action.exerciseId !== item.exerciseId ||
              action.unit !== item.unit ||
              action.name !== item.name ||
              keys.some((key) => (original?.[key] ?? null) !== (next?.[key] ?? null))
            )
              throw new ApiError(
                400,
                'IMMUTABLE_SNAPSHOT',
                '不能修改历史动作身份、名称、单位或目标。',
              );
          });
        }
        if (
          incoming.status === 'active' &&
          (await tx.workout.count({
            where: { userId, status: 'active', id: { not: incoming.id } },
          }))
        )
          throw conflict();
        const data = {
          planVersion: incoming.planVersion,
          planName: incoming.planName,
          date: new Date(incoming.date),
          status: incoming.status,
          startedAt: incoming.startedAt ? new Date(incoming.startedAt) : null,
          completedAt: incoming.completedAt ? new Date(incoming.completedAt) : null,
          notes: incoming.notes,
          origin: incoming.origin,
        };
        if (current)
          await tx.workout.update({
            where,
            data: {
              date: data.date,
              status: data.status,
              completedAt: data.completedAt,
              notes: data.notes,
              revision: { increment: 1 },
            },
          });
        else {
          await tx.workout.create({ data: { ...data, userId, id: incoming.id } });
          for (const [position, action] of incoming.exercises.entries())
            await tx.workoutExercise.create({
              data: {
                userId,
                workoutId: incoming.id,
                id: action.id,
                exerciseId: action.exerciseId,
                name: action.name,
                unit: action.unit,
                position,
                prescription: action.prescription ? json(action.prescription) : Prisma.JsonNull,
              },
            });
        }
        // 组可编辑/删除，动作快照不重建；失败回滚，保留原完整记录。
        await tx.workoutSet.deleteMany({ where: { userId, workoutId: incoming.id } });
        const rows = incoming.exercises.flatMap((action) =>
          action.sets.map((set, position) => ({
            userId,
            workoutId: incoming.id,
            workoutExerciseId: action.id,
            id: set.id,
            position,
            loadKg: set.load,
            value: set.value,
            rir: set.rir,
            pain: set.pain,
          })),
        );
        if (rows.length) await tx.workoutSet.createMany({ data: rows });
        return { revision: (current?.revision ?? 0) + 1 };
      });
    },
  );
  app.delete<{ Params: { id: string }; Body: { expectedRevision: number } }>(
    '/api/v1/me/workouts/:id',
    {
      preHandler: requireWrite,
      schema: {
        querystring: emptyQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['expectedRevision'],
          properties: { expectedRevision: revision },
        },
      },
    },
    async (request) =>
      reliableWrite(db, request, async (tx) => {
        const userId = request.principal!.userId;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
        const deleted = await tx.workout.deleteMany({
          where: { userId, id: request.params.id, revision: request.body.expectedRevision },
        });
        if (!deleted.count) throw conflict();
        return { deleted: true };
      }),
  );
  app.put<{
    Params: { date: string };
    Body: { value: number; expected: { id: string; kg: string } | null };
  }>(
    '/api/v1/me/weights/:date',
    {
      preHandler: requireWrite,
      schema: {
        querystring: emptyQuery,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['value', 'expected'],
          properties: {
            value: { type: 'number', minimum: 30, maximum: 250 },
            expected: {
              anyOf: [
                { type: 'null' },
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'kg'],
                  properties: {
                    id: { type: 'string', maxLength: 160 },
                    kg: { type: 'string', maxLength: 20 },
                  },
                },
              ],
            },
          },
        },
      },
    },
    async (request) => {
      if (!isCalendarDate(request.params.date))
        throw new ApiError(400, 'INVALID_DATE', '日期无效。');
      precise(request.body.value);
      return reliableWrite(db, request, async (tx) => {
        const userId = request.principal!.userId;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
        const date = new Date(request.params.date);
        const rows = await tx.weightEntry.findMany({ where: { userId, date } });
        const old = rows[0];
        const expected = request.body.expected;
        if (
          rows.length > 1 ||
          (old
            ? !expected || old.id !== expected.id || old.kg.toString() !== expected.kg
            : expected !== null)
        )
          throw conflict();
        const item = old
          ? await tx.weightEntry.update({
              where: { userId_id: { userId, id: old.id } },
              data: { kg: request.body.value },
            })
          : await tx.weightEntry.create({
              data: { userId, id: crypto.randomUUID(), date, kg: request.body.value },
            });
        return { item: { id: item.id, date: request.params.date, kg: item.kg.toString() } };
      });
    },
  );
}
