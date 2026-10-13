import { createDatabase } from './db.js';
import { buildApp } from './app.js';
import { registerFrontend } from './frontend.js';

const db = createDatabase(process.env.DATABASE_URL ?? '');
const app = buildApp(db, {
  origin: process.env.APP_ORIGIN ?? `http://127.0.0.1:${process.env.API_PORT ?? 3100}`,
  secure: process.env.NODE_ENV === 'production',
});
// 第一阶段固定回环地址；账户隔离完成前不向局域网或公网开放。
const port = Number(process.env.API_PORT ?? 3100);
registerFrontend(app);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('API_PORT 必须是有效端口。');
const shutdown = async () => {
  await app.close();
  await db.$disconnect();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
try {
  await app.listen({ host: '127.0.0.1', port });
  console.log(`练序本地账户后端：http://127.0.0.1:${port}/api/v1/health`);
} catch {
  await shutdown();
  console.error('后端启动失败，请检查数据库连接和端口是否被占用。');
  process.exitCode = 1;
}
