import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { startLocalPostgres, prepareDatabase, runNode } from './local-postgres.mjs';

// 每轮独立数据库，只生成虚构账户；绝不连接开发数据库或浏览器个人记录。
await mkdir('work', { recursive: true });
const directory = await mkdtemp(resolve('work/backend-test-'));
const probe = createServer();
await new Promise((done) => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
let { pg, connectionString } = await startLocalPostgres(directory, port);
try {
  await prepareDatabase(connectionString);
  await runNode(['--import', 'tsx', '--test', 'server/test/backend.test.ts'], connectionString)
    .completed;
  await runNode(['--import', 'tsx', '--test', 'server/test/accounts.test.ts'], connectionString)
    .completed;
  await runNode(['--import', 'tsx', '--test', 'server/test/integration.test.ts'], connectionString)
    .completed;
  await runNode(['--import', 'tsx', '--test', 'server/test/imports.test.ts'], connectionString)
    .completed;
  await runNode(['--import', 'tsx', '--test', 'server/test/reliability.test.ts'], connectionString)
    .completed;
  const readCounts = async () => {
    const client = pg.getPgClient('lianxu', '127.0.0.1');
    await client.connect();
    try {
      return (
        await client.query(
          'SELECT (SELECT count(*) FROM "Exercise") AS exercises, (SELECT count(*) FROM "WorkoutSet") AS sets, (SELECT count(*) FROM "User") AS users, (SELECT count(*) FROM "Session") AS sessions, (SELECT count(*) FROM "WriteReceipt") AS receipts',
        )
      ).rows[0];
    } finally {
      await client.end();
    }
  };
  const before = await readCounts();
  await pg.stop();
  ({ pg, connectionString } = await startLocalPostgres(directory, port));
  const after = await readCounts();
  if (
    JSON.stringify(before) !== JSON.stringify(after) ||
    after.exercises !== '1342' ||
    Number(after.sets) < 1
  ) {
    throw new Error('数据库重启后数据核对失败。');
  }
  console.log('数据库正常关闭并重启：公开动作、虚构账户、会话和组记录均保留。');
} finally {
  await pg.stop();
}
