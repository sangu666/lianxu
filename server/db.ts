import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/** 创建 PostgreSQL 连接池；明确超时，避免数据库不可用时请求无限等待。 */
export function createDatabase(connectionString: string): PrismaClient {
  if (!connectionString) throw new Error('缺少 DATABASE_URL，请先启动本地数据库。');
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 3000,
      query_timeout: 5000,
    }),
  });
}
