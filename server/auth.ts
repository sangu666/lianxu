import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient, Prisma } from '@prisma/client';
import { hashPassword, verifyPassword } from './passwords.js';
import { ApiError } from './errors.js';
import { registerPrivateRoutes } from './private-routes.js';
import { registerWriteRoutes } from './write-routes.js';
import { registerImports } from './imports.js';

/** 登录主体由数据库会话决定；任何客户端提供的 userId 都不作为权限依据。 */
export interface AuthPrincipal {
  userId: string;
  email: string | null;
  tokenHash: string;
  csrfToken: string;
  expiresAt: Date;
}
declare module 'fastify' {
  interface FastifyRequest {
    principal: AuthPrincipal | null;
  }
}

/** 可注入时间用于过期测试；生产仍强制 HTTPS Cookie，当前应用固定本机监听。 */
export interface AuthOptions {
  origin?: string;
  secure?: boolean;
  now?: () => Date;
}
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const credentialsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', minLength: 3, maxLength: 254 },
    password: { type: 'string', minLength: 12, maxLength: 128 },
  },
} as const;
interface Credentials {
  email: string;
  password: string;
}

/** 每次请求只拿最小公开账户字段，不把密码哈希挂到请求或输出对象。 */
export async function registerAccounts(
  app: FastifyInstance,
  db: PrismaClient,
  options: AuthOptions = {},
) {
  const origin = options.origin ?? 'http://127.0.0.1:3100';
  const secure = options.secure ?? false;
  const now = options.now ?? (() => new Date());
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || (secure && parsedOrigin.protocol !== 'https:'))
    throw new Error('账户 origin 配置无效。');
  const cookieName = secure ? '__Secure-lianxu_session' : 'lianxu_session';
  const cookieOptions = { path: '/api/v1', httpOnly: true, sameSite: 'strict' as const, secure };
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => new ApiError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试。'),
  });
  app.decorateRequest('principal', null);
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });

  /** 浏览器写请求必须来自配置的精确来源；不依据可伪造的 Host/转发头扩大范围。 */
  const checkOrigin = async (request: FastifyRequest) => {
    if (request.headers.origin !== origin || request.headers['sec-fetch-site'] === 'cross-site')
      throw new ApiError(403, 'ORIGIN_REJECTED', '请求来源不允许。');
  };
  const requireSession = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers.origin && request.headers.origin !== origin)
      throw new ApiError(403, 'ORIGIN_REJECTED', '请求来源不允许。');
    const token = request.cookies[cookieName];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new ApiError(401, 'UNAUTHENTICATED', '请先登录。');
    const session = await db.session.findUnique({
      where: { tokenHash: digest(token) },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!session || session.expiresAt <= now()) {
      reply.clearCookie(cookieName, cookieOptions);
      if (session) await db.session.deleteMany({ where: { tokenHash: session.tokenHash } });
      throw new ApiError(401, 'UNAUTHENTICATED', '登录已失效，请重新登录。');
    }
    request.principal = {
      userId: session.user.id,
      email: session.user.email,
      tokenHash: session.tokenHash,
      csrfToken: digest(`lianxu-csrf:${token}`),
      expiresAt: session.expiresAt,
    };
    // Cookie 会在标签页之间共享。拒绝旧页面继续把甲的表单写入新登录的乙账户。
    if (request.headers['x-account-id'] && request.headers['x-account-id'] !== session.user.id)
      throw new ApiError(409, 'ACCOUNT_CHANGED', '其他页面切换了账户，请刷新后再操作。');
  };
  const requireWrite = async (request: FastifyRequest, reply: FastifyReply) => {
    await requireSession(request, reply);
    await checkOrigin(request);
    const provided = request.headers['x-csrf-token'];
    const expected = request.principal!.csrfToken;
    if (
      typeof provided !== 'string' ||
      !/^[a-f0-9]{64}$/.test(provided) ||
      !timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))
    )
      throw new ApiError(403, 'CSRF_REJECTED', '请求校验失效，请刷新后重试。');
  };

  const issueSession = async (tx: Prisma.TransactionClient, userId: string, previous?: string) => {
    // 同账户登录串行化，最多五个有效会话；避免同时登录绕过数量限制。
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
    const issuedAt = now();
    if (previous && /^[A-Za-z0-9_-]{43}$/.test(previous)) {
      await tx.session.deleteMany({ where: { tokenHash: digest(previous), userId } });
    }
    await tx.session.deleteMany({ where: { userId, expiresAt: { lte: issuedAt } } });
    const old = await tx.session.findMany({
      where: { userId },
      orderBy: { sequence: 'desc' },
      skip: 4,
    });
    if (old.length)
      await tx.session.deleteMany({
        where: { tokenHash: { in: old.map((row) => row.tokenHash) } },
      });
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(issuedAt.getTime() + SESSION_SECONDS * 1000);
    await tx.session.create({
      data: { tokenHash: digest(token), userId, createdAt: issuedAt, expiresAt },
    });
    return { token, expiresAt, csrfToken: digest(`lianxu-csrf:${token}`) };
  };
  const sendSession = (
    reply: FastifyReply,
    user: { id: string; email: string | null },
    session: Awaited<ReturnType<typeof issueSession>>,
  ) => {
    reply.setCookie(cookieName, session.token, {
      ...cookieOptions,
      maxAge: SESSION_SECONDS,
      expires: session.expiresAt,
    });
    return { user, csrfToken: session.csrfToken, expiresAt: session.expiresAt.toISOString() };
  };
  const normalizeCredentials = ({ email, password }: Credentials) => {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || Buffer.byteLength(password, 'utf8') > 512)
      throw new ApiError(
        400,
        'INVALID_CREDENTIALS',
        '邮箱或密码格式不正确；密码需要 12–128 个字符。',
      );
    return { email: normalized, password };
  };
  const authRoute = {
    schema: {
      body: credentialsSchema,
      querystring: { type: 'object', additionalProperties: false, properties: {} },
    },
    preHandler: checkOrigin,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  };

  app.post<{ Body: Credentials }>('/api/v1/auth/register', authRoute, async (request, reply) => {
    const { email, password } = normalizeCredentials(request.body);
    const passwordHash = await hashPassword(password);
    try {
      const result = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email, passwordHash },
          select: { id: true, email: true },
        });
        const session = await issueSession(tx, user.id);
        return { user, session };
      });
      return reply.code(201).send(sendSession(reply, result.user, result.session));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002')
        throw new ApiError(409, 'ACCOUNT_EXISTS', '该邮箱无法注册，请尝试登录。');
      throw error;
    }
  });
  app.post<{ Body: Credentials }>('/api/v1/auth/login', authRoute, async (request, reply) => {
    const { email, password } = normalizeCredentials(request.body);
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
    if (!(await verifyPassword(password, user?.passwordHash)) || !user)
      throw new ApiError(401, 'LOGIN_FAILED', '邮箱或密码不正确。');
    // 同一事务替换当前同账户会话；失败时保留原登录状态，不产生未返回的孤立会话。
    const session = await db.$transaction((tx) =>
      issueSession(tx, user.id, request.cookies[cookieName]),
    );
    return sendSession(reply, { id: user.id, email: user.email }, session);
  });
  app.post('/api/v1/auth/logout', { preHandler: requireWrite }, async (request, reply) => {
    await db.session.deleteMany({
      where: { tokenHash: request.principal!.tokenHash, userId: request.principal!.userId },
    });
    reply.clearCookie(cookieName, cookieOptions);
    return { status: 'logged-out' };
  });
  app.get(
    '/api/v1/me',
    {
      preHandler: requireSession,
      schema: { querystring: { type: 'object', additionalProperties: false, properties: {} } },
    },
    async (request) => ({
      user: { id: request.principal!.userId, email: request.principal!.email },
      csrfToken: request.principal!.csrfToken,
      expiresAt: request.principal!.expiresAt.toISOString(),
    }),
  );
  registerPrivateRoutes(app, db, requireSession, requireWrite);
  registerWriteRoutes(app, db, requireWrite);
  registerImports(app, db, requireWrite);
}
