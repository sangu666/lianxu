import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

/** 检查端口，不自动结束占用端口的进程，避免影响其他项目的数据库。 */
export async function assertPortAvailable(port) {
  const probe = createServer();
  await new Promise((done, reject) => {
    probe.once('error', () => reject(new Error(`本地端口 ${port} 已被占用，请先关闭上一次后端。`)));
    probe.listen(port, '127.0.0.1', () => probe.close(done));
  });
}

/** 启动真实 PostgreSQL；开发包装器不创建系统服务，也不修改全局数据库配置。 */
export async function startLocalPostgres(directory, port) {
  await assertPortAvailable(port);
  const root = resolve(directory);
  await mkdir(root, { recursive: true });
  const configPath = resolve(root, 'connection.json');
  let password;
  try {
    const saved = JSON.parse(await readFile(configPath, 'utf8'));
    if (typeof saved.password !== 'string' || saved.password.length < 32)
      throw new Error('配置无效');
    password = saved.password;
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error('本地连接配置损坏，停止启动；请保留目录并检查 connection.json。');
    password = randomBytes(32).toString('base64url');
    await writeFile(configPath, JSON.stringify({ password }), { flag: 'wx', mode: 0o600 });
  }
  const databaseDir = resolve(root, 'cluster');
  const pg = new EmbeddedPostgres({
    databaseDir,
    port,
    user: 'lianxu_dev',
    password,
    authMethod: 'scram-sha-256',
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog: () => {},
    onError: () => {},
  });
  // 包装器在 Windows 默认强制结束进程；改用 PostgreSQL 自带工具完成正常检查点和关闭。
  const platformPackage =
    process.platform === 'win32' ? 'windows-x64' : `${process.platform}-${process.arch}`;
  const { pg_ctl: pgCtl } = await import(`@embedded-postgres/${platformPackage}`);
  let stopped;
  pg.stop = () => {
    stopped ??= new Promise((done, reject) => {
      const command = spawn(pgCtl, ['stop', '-D', databaseDir, '-m', 'fast', '-w', '-t', '15'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      command.once('error', reject);
      command.once('exit', (code) =>
        code === 0 ? done() : reject(new Error('数据库未正常关闭，请保留目录并检查本地进程。')),
      );
    });
    return stopped;
  };
  let initialized = true;
  try {
    await access(resolve(databaseDir, 'PG_VERSION'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    initialized = false;
  }
  if (!initialized) await pg.initialise();
  await pg.start();
  try {
    const client = pg.getPgClient();
    await client.connect();
    try {
      const result = await client.query("SELECT 1 FROM pg_database WHERE datname = 'lianxu'");
      if (!result.rowCount) await client.query('CREATE DATABASE lianxu');
    } finally {
      await client.end();
    }
  } catch (error) {
    await pg.stop();
    throw error;
  }
  return { pg, connectionString: `postgresql://lianxu_dev:${password}@127.0.0.1:${port}/lianxu` };
}

/** 用当前 Node 执行本地工具；不拼接 shell 命令，密码仅通过子进程环境传递。 */
export function runNode(args, connectionString, options = {}) {
  const child = spawn(process.execPath, args, {
    cwd: resolve('.'),
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  const completed = new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0 ? done() : reject(new Error(`子进程未成功结束（${code ?? signal}）。`)),
    );
  });
  return { child, completed };
}

/** 正式 PostgreSQL 也使用同一份迁移和种子，不依赖本地开发包装器。 */
export async function prepareDatabase(connectionString) {
  await runNode(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], connectionString)
    .completed;
  await runNode(['--import', 'tsx', 'server/seed.ts'], connectionString).completed;
}
