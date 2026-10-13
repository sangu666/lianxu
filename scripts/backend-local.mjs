import { startLocalPostgres, prepareDatabase, runNode } from './local-postgres.mjs';

// 固定开发端口，与前端 3002 分开；随机密码和数据库文件仅保存在忽略目录。
const { pg, connectionString } = await startLocalPostgres('work/local-postgres', 55432);
let child;
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  child?.kill();
  await pg.stop();
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
try {
  await prepareDatabase(connectionString);
  if (!stopping) {
    console.log('本地 PostgreSQL 已就绪，数据保存在 work/local-postgres（不进入 Git）。');
    const api = runNode(['--import', 'tsx', 'server/start.ts'], connectionString);
    child = api.child;
    await api.completed;
  }
} catch (error) {
  if (!stopping) {
    console.error(error.message);
    process.exitCode = 1;
  }
} finally {
  await shutdown();
}
