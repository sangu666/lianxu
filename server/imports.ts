import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma, type PrismaClient } from '@prisma/client';
import { parseBackup } from '../public/storage.js';
import { validateWorkoutData, type Workout } from '../public/workouts.js';
import { activePlanDays } from '../public/plan-document.js';
import { ApiError } from './errors.js';

type Hook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
type Snapshot = {
  version: number;
  reason: string;
  profile: Record<string, unknown>;
  adjusted: boolean;
  editablePlan?: unknown;
  planOverrides?: unknown;
  days?: unknown;
  sourceVersion?: number;
  importId?: string;
};
type Source = {
  schemaVersion: number;
  profile: Record<string, unknown>;
  version: number;
  adjusted: boolean;
  editablePlan?: unknown;
  planOverrides?: unknown;
  history: Snapshot[];
  workouts: Workout[];
  weights: { id?: string; date: string; value: number }[];
};
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
/** 排序对象键并删除 undefined，保证 JSON 键顺序、导出时刻不产生虚假的不同记录。 */
function canonical(value: unknown): string {
  const stable = (item: unknown): unknown =>
    item instanceof Date
      ? item.toISOString()
      : item instanceof Prisma.Decimal
        ? item.toString()
        : Array.isArray(item)
          ? item.map(stable)
          : item && typeof item === 'object'
            ? Object.fromEntries(
                Object.entries(item)
                  .filter(([, v]) => v !== undefined)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([k, v]) => [k, stable(v)]),
              )
            : item;
  return JSON.stringify(stable(value));
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const fail = (message: string) => {
  throw new ApiError(400, 'INVALID_IMPORT', message);
};
const conflict = (message: string) => {
  throw new ApiError(409, 'IMPORT_CONFLICT', message);
};
/** 拒绝不可解释的私有扩展（尤其照片/密钥），不将任意 JSON 当作备份存入数据库。 */
function keys(value: object, allowed: string[], label: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    fail(`${label}包含未支持字段；请使用练序导出的备份，不会丢弃字段后强行导入。`);
}
const profileKeys = [
  'height',
  'weight',
  'age',
  'experience',
  'equipment',
  'days',
  'goal',
  'availableEquipment',
  'sessionMinutes',
  'movementPreference',
  'excludedPatterns',
  'restrictionNotes',
];
function precise(value: number) {
  if (Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-7)
    fail('千克数值超过三位小数，不能无损写入数据库；请保留原备份。');
}
/** 嵌套计划也限制字段，避免借扩展属性保存未支持的照片或密钥。 */
function planKeys(item: { editablePlan?: unknown; planOverrides?: unknown }) {
  if (item.editablePlan) {
    const plan = item.editablePlan as { days: { actions: object[] }[] };
    keys(plan, ['title', 'origin', 'days'], '自定义计划');
    for (const day of plan.days) {
      keys(day, ['name', 'actions'], '计划训练日');
      for (const action of day.actions)
        keys(
          action,
          [
            'exerciseId',
            'name',
            'unit',
            'sets',
            'targetMin',
            'targetMax',
            'restSeconds',
            'reason',
            'acknowledged',
          ],
          '计划动作',
        );
    }
  }
  for (const override of (item.planOverrides ?? []) as object[])
    keys(override, ['dayIndex', 'fromId', 'toId'], '动作替换');
}
/** 校验 v2 全量备份，保留缺省字段和历史动作，不猜失落版本、不转换秒数。 */
function sourceFrom(text: string): Source {
  let source: Source;
  try {
    source = structuredClone(parseBackup(text));
  } catch (error) {
    fail(error instanceof Error ? error.message : '备份格式无效。');
  }
  source = source!;
  keys(
    source,
    [
      'schemaVersion',
      'profile',
      'version',
      'adjusted',
      'editablePlan',
      'planOverrides',
      'history',
      'workouts',
      'weights',
      'logs',
    ],
    '备份',
  );
  delete (source as Source & { logs?: unknown }).logs;
  keys(source.profile, profileKeys, '当前资料');
  planKeys(source);
  const seen = new Set<number>();
  for (const item of source.history) {
    keys(
      item,
      [
        'version',
        'reason',
        'profile',
        'adjusted',
        'editablePlan',
        'planOverrides',
        'days',
        'sourceVersion',
        'importId',
      ],
      '计划历史',
    );
    keys(item.profile, profileKeys, '历史资料');
    planKeys(item);
    if (seen.has(item.version)) fail('备份中的计划版本重复。');
    seen.add(item.version);
    const days = activePlanDays(item);
    if (item.days !== undefined && canonical(item.days) !== canonical(days))
      fail('历史排课快照与当前解析不一致，不能静默更改；请保留备份。');
  }
  source.history.sort((a, b) => a.version - b.version);
  const latest = source.history.at(-1);
  if (
    !latest ||
    latest.version !== source.version ||
    canonical(planFacts(latest)) !== canonical(planFacts(source))
  )
    fail('当前计划与历史快照不一致或缺失，不能推测原版本。');
  for (const workout of source.workouts) {
    keys(
      workout,
      [
        'id',
        'planVersion',
        'planName',
        'date',
        'status',
        'startedAt',
        'completedAt',
        'notes',
        'origin',
        'exercises',
        'revision',
      ],
      '训练',
    );
    delete workout.revision;
    if (!seen.has(workout.planVersion))
      fail(`训练 ${workout.id} 缺少对应计划版本 ${workout.planVersion}；不会伪造历史资料。`);
    for (const action of workout.exercises) {
      keys(action, ['id', 'exerciseId', 'name', 'unit', 'prescription', 'sets'], '训练动作');
      if (action.prescription)
        keys(
          action.prescription,
          ['sets', 'targetMin', 'targetMax', 'restSeconds', 'reason'],
          '目标快照',
        );
      for (const set of action.sets) {
        keys(set, ['id', 'load', 'value', 'rir', 'pain'], '训练组');
        precise(set.load);
      }
    }
  }
  const weightIds = new Set<string>();
  for (const weight of source.weights) {
    keys(weight, ['id', 'date', 'value'], '体重');
    precise(weight.value);
    if (
      weight.id !== undefined &&
      (typeof weight.id !== 'string' ||
        !weight.id.trim() ||
        weight.id.length > 160 ||
        weightIds.has(weight.id))
    )
      fail('体重稳定编号无效或重复。');
    if (weight.id) weightIds.add(weight.id);
  }
  return source;
}
/** 版本号与来源说明不参与计划内容比较；历史资料、动作目标与设备限制必须一致。 */
function planFacts(item: Omit<Snapshot, 'reason'>) {
  return {
    profile: item.profile,
    adjusted: item.adjusted,
    editablePlan: item.editablePlan,
    planOverrides: item.planOverrides ?? [],
    days: item.days ?? activePlanDays(item),
  };
}
function workoutFacts(item: Workout) {
  const { planVersion: _version, revision: _revision, ...facts } = item;
  return facts;
}
/** 只读取该账户；指纹覆盖资料、所有历史版本、训练组与体重，检测预览后的任何业务修改。 */
async function baseline(tx: Prisma.TransactionClient, userId: string) {
  const profile = await tx.profile.findUnique({ where: { userId } });
  const plans = await tx.planVersion.findMany({ where: { userId }, orderBy: { version: 'asc' } });
  const rows = await tx.workout.findMany({
    where: { userId },
    orderBy: { id: 'asc' },
    include: {
      exercises: {
        orderBy: { position: 'asc' },
        include: { sets: { orderBy: { position: 'asc' } } },
      },
    },
  });
  const weights = await tx.weightEntry.findMany({ where: { userId }, orderBy: { id: 'asc' } });
  const workouts = rows.map((row) => ({
    id: row.id,
    planVersion: row.planVersion,
    planName: row.planName,
    date: row.date.toISOString().slice(0, 10),
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    notes: row.notes,
    origin: row.origin,
    exercises: row.exercises.map((action) => ({
      id: action.id,
      exerciseId: action.exerciseId,
      name: action.name,
      unit: action.unit,
      ...(action.prescription !== null ? { prescription: action.prescription } : {}),
      sets: action.sets.map((set) => ({
        id: set.id,
        load: Number(set.loadKg),
        value: set.value,
        rir: set.rir,
        pain: set.pain,
      })),
    })),
  }));
  return {
    profile,
    plans,
    workouts,
    weights,
    fingerprint: digest({ profile, plans, rows, weights }),
  };
}
/** 将来源版本映射到新的账户版本；已有账户最后复制当前版本以继续使用，不覆盖旧版本。 */
function prepare(source: Source, current: Awaited<ReturnType<typeof baseline>>) {
  if (Boolean(current.profile) !== Boolean(current.plans.length))
    conflict('账户资料与计划不完整，请先核对数据库；没有写入。');
  let version = current.plans.at(-1)?.version ?? 0;
  const mapping = new Map(source.history.map((item) => [item.version, ++version]));
  const added: Workout[] = [];
  let skippedWorkouts = 0;
  for (const item of source.workouts) {
    const old = current.workouts.find((row) => row.id === item.id);
    if (old) {
      const existingPlan = current.plans.find((plan) => plan.version === old.planVersion)
        ?.snapshot as Snapshot | undefined;
      const incomingPlan = source.history.find((plan) => plan.version === item.planVersion)!;
      if (
        !existingPlan ||
        canonical(workoutFacts(old as Workout)) !== canonical(workoutFacts(item)) ||
        canonical(planFacts(existingPlan)) !== canonical(planFacts(incomingPlan))
      )
        conflict(`训练编号 ${item.id} 已存在但内容不同；不会覆盖。`);
      skippedWorkouts++;
    } else added.push({ ...item, planVersion: mapping.get(item.planVersion)! });
  }
  try {
    validateWorkoutData({ schemaVersion: 2, workouts: [...current.workouts, ...added] });
  } catch {
    conflict('合并后有重复记录编号或两份进行中训练；请先完成训练或核对备份。');
  }
  const weights: { id: string; date: string; value: number }[] = [];
  let skippedWeights = 0;
  for (const item of source.weights) {
    const id = item.id ?? `import-weight-${digest({ date: item.date, value: item.value })}`;
    const sameId = current.weights.find((row) => row.id === id);
    const sameDate = current.weights.filter(
      (row) => row.date.toISOString().slice(0, 10) === item.date,
    );
    if (sameId) {
      if (sameId.date.toISOString().slice(0, 10) !== item.date || Number(sameId.kg) !== item.value)
        conflict(`体重编号 ${id} 已存在但内容不同；不会覆盖。`);
      skippedWeights++;
    } else if (sameDate.length) {
      if (!item.id && sameDate.length === 1 && Number(sameDate[0].kg) === item.value)
        skippedWeights++;
      else conflict(`${item.date} 已有另一条体重记录；不会自动合并测量或覆盖数值。`);
    } else weights.push({ ...item, id });
  }
  const warnings: string[] = [];
  if (source.history.some((item) => item.days === undefined))
    warnings.push(
      '旧历史未保存完整排课结果，将按现有规则补齐兼容展示；原训练动作和目标快照保持不变。',
    );
  if (source.workouts.some((item) => item.origin === 'legacy'))
    warnings.push('旧版归档的起止时间继续为空，不补造时间。');
  if (source.weights.some((item) => !item.id))
    warnings.push('旧体重没有编号，将分配确定性编号；同日同值已有记录跳过。');
  return {
    added,
    weights,
    mapping,
    summary: {
      source: {
        plans: source.history.length,
        workouts: source.workouts.length,
        weights: source.weights.length,
        sets: source.workouts.reduce(
          (n, w) => n + w.exercises.reduce((m, a) => m + a.sets.length, 0),
          0,
        ),
      },
      added: {
        plans: source.history.length + (current.profile ? 1 : 0),
        workouts: added.length,
        weights: weights.length,
        sets: added.reduce((n, w) => n + w.exercises.reduce((m, a) => m + a.sets.length, 0), 0),
      },
      skipped: { workouts: skippedWorkouts, weights: skippedWeights },
      keepCurrent: Boolean(current.profile),
      versions: [...mapping].map(([from, to]) => ({ from, to })),
      currentVersion: current.profile ? version + 1 : mapping.get(source.version),
      warnings,
    },
  };
}

/** 预览只写短期任务表；确认在一个事务中写入全部业务数据并核对结果，重复确认读取原回执。 */
export function registerImports(app: FastifyInstance, db: PrismaClient, requireWrite: Hook) {
  const cleanup = () =>
    db.importJob.updateMany({
      where: { status: 'pending', expiresAt: { lte: new Date() } },
      data: { status: 'expired', payload: Prisma.DbNull },
    });
  let timer: ReturnType<typeof setInterval>;
  app.addHook('onReady', async () => {
    await cleanup().catch(() => {});
    timer = setInterval(() => {
      void cleanup().catch(() => {});
    }, 60000);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
  });
  const query = { type: 'object', additionalProperties: false, properties: {} };
  const params = {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', format: 'uuid' } },
  };
  app.post<{ Body: { text: string } }>(
    '/api/v1/me/imports/preview',
    {
      bodyLimit: 11 * 1024 * 1024,
      preHandler: requireWrite,
      schema: {
        querystring: query,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['text'],
          properties: { text: { type: 'string', maxLength: 5 * 1024 * 1024 } },
        },
      },
    },
    async (request) => {
      if (Buffer.byteLength(request.body.text, 'utf8') > 5 * 1024 * 1024) fail('备份超过 5 MB。');
      const source = sourceFrom(request.body.text),
        hash = digest(source),
        userId = request.principal!.userId;
      return db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
          const previous = await tx.importJob.findUnique({
            where: { userId_digest: { userId, digest: hash } },
          });
          if (previous?.status === 'confirmed')
            return {
              id: previous.id,
              status: 'confirmed',
              result: previous.result,
              repeated: true,
            };
          const current = await baseline(tx, userId),
            prepared = prepare(source, current);
          // 每次重新预览创建新编号，旧对话框不能确认新预览；仅保留一个待确认原文，限制暂存体积。
          await tx.importJob.deleteMany({ where: { userId, status: { not: 'confirmed' } } });
          const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
          const job = await tx.importJob.create({
            data: {
              userId,
              digest: hash,
              fingerprint: current.fingerprint,
              payload: asJson(source),
              status: 'pending',
              result: asJson(prepared.summary),
              expiresAt,
            },
          });
          return {
            id: job.id,
            status: 'pending',
            expiresAt: expiresAt.toISOString(),
            summary: prepared.summary,
          };
        },
        { timeout: 15000 },
      );
    },
  );
  app.post<{ Params: { id: string }; Body: { acknowledge: boolean } }>(
    '/api/v1/me/imports/:id/confirm',
    {
      preHandler: requireWrite,
      schema: {
        querystring: query,
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['acknowledge'],
          properties: { acknowledge: { const: true } },
        },
      },
    },
    async (request) =>
      db.$transaction(
        async (tx) => {
          const userId = request.principal!.userId;
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
          const job = await tx.importJob.findFirst({ where: { id: request.params.id, userId } });
          if (!job) throw new ApiError(404, 'NOT_FOUND', '没有找到本账户的预览。');
          if (job.status === 'confirmed')
            return { id: job.id, status: 'confirmed', result: job.result, repeated: true };
          if (job.status !== 'pending' || job.expiresAt <= new Date())
            throw new ApiError(410, 'IMPORT_EXPIRED', '预览已过期，请重新预览。');
          const current = await baseline(tx, userId);
          if (current.fingerprint !== job.fingerprint)
            conflict('预览后账户数据已变化，请重新预览再确认；没有写入。');
          const source = sourceFrom(
            JSON.stringify({ format: 'lianxu-backup', version: 2, state: job.payload }),
          );
          const prepared = prepare(source, current);
          for (const item of source.history) {
            const version = prepared.mapping.get(item.version)!;
            await tx.planVersion.create({
              data: {
                userId,
                version,
                snapshot: asJson({
                  ...item,
                  version,
                  sourceVersion: item.version,
                  importId: job.id,
                  days: item.days ?? activePlanDays(item),
                }),
              },
            });
          }
          if (current.profile) {
            const latest = current.plans.at(-1)!;
            await tx.planVersion.create({
              data: {
                userId,
                version: prepared.summary.currentVersion!,
                snapshot: asJson({
                  ...(latest.snapshot as Snapshot),
                  version: prepared.summary.currentVersion,
                  reason: '导入历史后保留当前计划',
                }),
              },
            });
            await tx.profile.update({ where: { userId }, data: { revision: { increment: 1 } } });
          } else
            await tx.profile.create({
              data: { userId, data: asJson(source.profile), revision: 1 },
            });
          for (const item of prepared.added) {
            await tx.workout.create({
              data: {
                userId,
                id: item.id,
                planVersion: item.planVersion,
                planName: item.planName,
                date: new Date(item.date),
                status: item.status,
                startedAt: item.startedAt ? new Date(item.startedAt) : null,
                completedAt: item.completedAt ? new Date(item.completedAt) : null,
                notes: item.notes,
                origin: item.origin,
              },
            });
            for (const [position, action] of item.exercises.entries()) {
              await tx.workoutExercise.create({
                data: {
                  userId,
                  workoutId: item.id,
                  id: action.id,
                  exerciseId: action.exerciseId,
                  name: action.name,
                  unit: action.unit,
                  position,
                  prescription: action.prescription ? asJson(action.prescription) : Prisma.JsonNull,
                },
              });
              if (action.sets.length)
                await tx.workoutSet.createMany({
                  data: action.sets.map((set, position) => ({
                    userId,
                    workoutId: item.id,
                    workoutExerciseId: action.id,
                    id: set.id,
                    position,
                    loadKg: set.load,
                    value: set.value,
                    rir: set.rir,
                    pain: set.pain,
                  })),
                });
            }
          }
          if (prepared.weights.length)
            await tx.weightEntry.createMany({
              data: prepared.weights.map((item) => ({
                userId,
                id: item.id,
                date: new Date(item.date),
                kg: item.value,
              })),
            });
          // 提交前对照来源检查每个训练的单位、ID、组次与十进制数值；失败整批回滚。
          const after = await baseline(tx, userId);
          for (const item of prepared.added) {
            const saved = after.workouts.find((row) => row.id === item.id);
            if (!saved || canonical(saved) !== canonical(item))
              throw new ApiError(503, 'IMPORT_VERIFY_FAILED', '写入核对失败，整批已回滚。');
          }
          for (const item of prepared.weights) {
            const saved = after.weights.find((row) => row.id === item.id);
            if (
              !saved ||
              saved.date.toISOString().slice(0, 10) !== item.date ||
              Number(saved.kg) !== item.value
            )
              throw new ApiError(503, 'IMPORT_VERIFY_FAILED', '体重核对失败，整批已回滚。');
          }
          const result = { ...prepared.summary, confirmedAt: new Date().toISOString() };
          await tx.importJob.update({
            where: { id: job.id },
            data: { status: 'confirmed', payload: Prisma.DbNull, result: asJson(result) },
          });
          return { id: job.id, status: 'confirmed', result, repeated: false };
        },
        { timeout: 30000 },
      ),
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/me/imports/:id',
    { preHandler: requireWrite, schema: { querystring: query, params } },
    async (request) => {
      await db.importJob.deleteMany({
        where: {
          id: request.params.id,
          userId: request.principal!.userId,
          status: { not: 'confirmed' },
        },
      });
      return { cancelled: true };
    },
  );
}
