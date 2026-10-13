import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ApiError } from './errors.js';

/** 对象键排序，数组顺序保留；同样内容的 JSON 排版不改变摘要。 */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}
/** 账户锁、业务操作和成功回执同事务。旧客户端无编号仍可写，但没有安全重试保证。 */
export async function reliableWrite<T>(
  db: PrismaClient,
  request: FastifyRequest,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const userId = request.principal!.userId;
  const key = request.headers['idempotency-key'];
  if (
    key !== undefined &&
    (typeof key !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))
  )
    throw new ApiError(400, 'INVALID_REQUEST_KEY', '请求编号须为 UUID。');
  const hash = createHash('sha256')
    .update(
      JSON.stringify(stable({ method: request.method, path: request.url, body: request.body })),
    )
    .digest('hex');
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
      if (key) {
        const previous = await tx.writeReceipt.findUnique({
          where: { userId_key: { userId, key } },
        });
        if (previous) {
          if (previous.digest !== hash)
            throw new ApiError(
              409,
              'REQUEST_KEY_REUSED',
              '请求编号已用于不同内容，拒绝覆盖；请核对待同步请求。',
            );
          return previous.result as T;
        }
      }
      const result = await operation(tx);
      if (key)
        await tx.writeReceipt.create({
          data: {
            userId,
            key,
            digest: hash,
            result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
          },
        });
      return result;
    },
    { timeout: 15000 },
  );
}
