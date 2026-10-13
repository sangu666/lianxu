import Fastify from 'fastify';
import type { PrismaClient, Prisma } from '@prisma/client';
import { registerAccounts, type AuthOptions } from './auth.js';
import { ApiError } from './errors.js';

/** 查询参数以来源原始标签筛选；空值代表不过滤，页大小最多 100 条。 */
interface CatalogQuery {
  q?: string;
  bodyPart?: string;
  equipment?: string;
  origin?: 'builtin' | 'community';
  page?: number;
  pageSize?: number;
}

const querySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    q: { type: 'string', maxLength: 100 },
    bodyPart: { type: 'string', maxLength: 80 },
    equipment: { type: 'string', maxLength: 80 },
    origin: { type: 'string', enum: ['builtin', 'community'] },
    page: { type: 'integer', minimum: 1, maximum: 100000, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 24 },
  },
} as const;

/** 构建公共目录与账户 API；连接池由调用者管理，便于真实数据库集成测试。 */
export function buildApp(db: PrismaClient, authOptions: AuthOptions = {}) {
  const app = Fastify({
    bodyLimit: 262144,
    logger: false,
    ajv: { customOptions: { removeAdditional: false } },
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ApiError) {
      if (error.statusCode === 429) reply.header('Retry-After', '60');
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    }
    if (
      error &&
      typeof error === 'object' &&
      'statusCode' in error &&
      [400, 413, 415, 429].includes(Number(error.statusCode))
    ) {
      const status = Number(error.statusCode);
      return reply.code(status).send({
        error: {
          code: status === 429 ? 'RATE_LIMITED' : 'INVALID_REQUEST',
          message: status === 429 ? '请求过于频繁，请稍后重试。' : '请求格式不正确。',
        },
      });
    }
    if (error && typeof error === 'object' && 'validation' in error && error.validation) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_REQUEST', message: '请求格式不正确。' } });
    }
    // 不把连接字符串、SQL 或服务器堆栈返回给客户端。
    return reply
      .code(503)
      .send({ error: { code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试。' } });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }),
  );

  app.get('/api/v1/health', async () => ({ status: 'ok', stage: 'local-accounts' }));
  app.get('/api/v1/ready', async () => {
    await db.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'postgresql' };
  });
  app.get<{ Querystring: CatalogQuery }>(
    '/api/v1/exercises',
    { schema: { querystring: querySchema } },
    async (request) => {
      const { q = '', bodyPart, equipment, origin, page = 1, pageSize = 24 } = request.query;
      const term = q.trim();
      // PostgreSQL 的 LIKE 将 %、_ 当通配符；搜索框按字面匹配，避免意外返回全库。
      const literalTerm = term.replace(/[\\%_]/g, '\\$&');
      const where: Prisma.ExerciseWhereInput = {
        ...(bodyPart ? { bodyPart } : {}),
        ...(equipment ? { equipment } : {}),
        ...(origin ? { origin } : {}),
        ...(term
          ? {
              OR: ['nameZh', 'nameEn', 'id', 'target'].map((key) => ({
                [key]: { contains: literalTerm, mode: 'insensitive' },
              })),
            }
          : {}),
      };
      // 同一数据库快照内取得总数和分页，避免导入更新时两者不一致。
      const [total, items] = await db.$transaction(
        [
          db.exercise.count({ where }),
          db.exercise.findMany({
            where,
            orderBy: { id: 'asc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
              id: true,
              nameZh: true,
              nameEn: true,
              bodyPart: true,
              equipment: true,
              target: true,
              unit: true,
              origin: true,
            },
          }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      return {
        items,
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      };
    },
  );
  app.get('/api/v1/exercise-filters', async () => {
    const [parts, equipment] = await Promise.all([
      db.exercise.findMany({
        distinct: ['bodyPart'],
        select: { bodyPart: true },
        orderBy: { bodyPart: 'asc' },
      }),
      db.exercise.findMany({
        distinct: ['equipment'],
        select: { equipment: true },
        orderBy: { equipment: 'asc' },
      }),
    ]);
    return {
      bodyParts: parts.map((row) => row.bodyPart),
      equipment: equipment.map((row) => row.equipment),
      origins: ['builtin', 'community'],
    };
  });
  app.get<{ Params: { id: string } }>(
    '/api/v1/exercises/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', minLength: 1, maxLength: 100 } },
        },
      },
    },
    async (request, reply) => {
      const item = await db.exercise.findUnique({ where: { id: request.params.id } });
      if (!item)
        return reply
          .code(404)
          .send({ error: { code: 'EXERCISE_NOT_FOUND', message: '未找到这个动作。' } });
      return { item };
    },
  );
  app.register(async (scope) => {
    await registerAccounts(scope, db, authOptions);
  });
  return app;
}
