import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';

// N/r/p 是固定的 scrypt 成本；最多同时执行两次，限制本地开发进程的内存占用。
const COST = { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 };
let activeHashes = 0;
const DUMMY_HASH = `scrypt-v1$${'00'.repeat(16)}$${'00'.repeat(64)}`;

/** 异步计算密码哈希，单位为 64 字节；满载返回可重试错误，不排无限队列。 */
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (activeHashes >= 2) throw new ApiError(429, 'AUTH_BUSY', '登录服务繁忙，请稍后重试。');
  activeHashes += 1;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, COST, (error, key) => (error ? reject(error) : resolve(key)));
    });
  } finally {
    activeHashes -= 1;
  }
}

/** 为每个账户生成独立随机盐；版本前缀用于以后升级算法，不裁剪密码空格。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt-v1$${salt.toString('hex')}$${(await derive(password, salt)).toString('hex')}`;
}

/** 不存在账户也执行同成本计算；固定长度常量时间比较，避免直接字符串比较。 */
export async function verifyPassword(
  password: string,
  saved: string | null | undefined,
): Promise<boolean> {
  const valid = typeof saved === 'string' && /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(saved);
  const [, salt, expected] = (valid ? saved : DUMMY_HASH).split('$');
  const key = await derive(password, Buffer.from(salt, 'hex'));
  return timingSafeEqual(key, Buffer.from(expected, 'hex')) && valid;
}
