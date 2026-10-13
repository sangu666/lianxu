# 第 3 步：账户、会话与数据隔离

第 3 步账户接口已在第 4 步接入页面，新增计划、训练与体重写入；完整使用与契约见 BACKEND-INTEGRATION.md。未登录为浏览器模式，登录后仅读取当前账户数据库记录，旧 localStorage 未自动迁移。下文保留第三步接口及实现背景。

## 已实现的接口

基础地址 `http://127.0.0.1:3100/api/v1`。账户及个人接口响应带 Cache-Control: no-store。

| 方法 | 路径               | 功能                                                        |
| ---- | ------------------ | ----------------------------------------------------------- |
| POST | /auth/register     | 邮箱与密码注册，创建会话并登录；成功 201                    |
| POST | /auth/login        | 验证密码，创建新会话；成功 200                              |
| POST | /auth/logout       | 撤销当前会话并清除 Cookie                                   |
| GET  | /me                | 当前账户公开字段、CSRF token 和绝对过期时间                 |
| GET  | /me/profile        | 当前资料和 revision；未填写返回 profile:null、revision:0    |
| PUT  | /me/profile        | 保存完整资料，校验 expectedRevision，同时建立新规则计划版本 |
| GET  | /me/plans          | 只读计划历史，分页                                          |
| GET  | /me/plans/:version | 当前账户指定版本快照                                        |
| GET  | /me/workouts       | 当前账户训练摘要，分页                                      |
| GET  | /me/workouts/:id   | 当前账户训练、动作和组快照                                  |
| GET  | /me/weights        | 当前账户体重，分页                                          |

分页默认 24、最多 100，page 从 1 开始。记录与资料归属只来自服务端会话，不接受 userId 字段；私有查询中的多余参数拒绝为 400。客户端猜到别人的训练 ID 或计划版本仍查不到；不存在及不属于当前账户的详情统一 404。相同训练 ID 可在两个账户中独立存在。

第三步先以资料写入验证账户与并发保存；第四步已扩展计划确认、训练组与体重写入，见 BACKEND-INTEGRATION.md，备份迁移仍未实现。

## 请求契约

注册和登录请求为 application/json：

```json
{ "email": "demo@example.test", "password": "请使用自己的长密码" }
```

邮箱去除首尾空格并转小写；密码要求 12–128 个字符，不裁剪空格，UTF-8 最多 512 字节。数据库大小写不敏感唯一索引防止重复账户。邮箱尚未验证，不作为可信身份或找回凭据。重复注册返回 409；错误密码和不存在账户统一 401，不返回密码、哈希或令牌。

成功响应包含 user.id / user.email、csrfToken、expiresAt，并设置 Cookie。原始会话令牌只在 HttpOnly Cookie 中，不写 localStorage，也不在 JSON 响应中返回。前端接入时必须携带 Cookie；同源请求默认可携带，跨源场景目前未启用 CORS。

所有 POST/PUT 写请求必须携带精确匹配 APP_ORIGIN 的 Origin。登录后的资料保存和退出还需要 `X-CSRF-Token`，使用登录响应或 GET /me 返回的值。来源或 CSRF 不符返回 403；未登录、被撤销或过期返回 401。命令行客户端也必须明确传这些头。

```json
{
  "expectedRevision": 0,
  "profile": {
    "age": 28,
    "height": 175,
    "weight": 75,
    "days": 3,
    "experience": "beginner",
    "equipment": "home",
    "goal": "habit"
  }
}
```

以上资料为虚构示例。第一次保存使用 revision 0；之后使用 GET /me/profile 返回的 revision。可附加既有设备、时间、偏好、排除类型与备注字段，字段与枚举沿用 PROFILE-DATA.md。保存返回 profile、revision、planVersion。

同账户写入在事务中锁定账户行，检查 revision，然后新增计划版本和保存资料。并发同版本请求只能一项成功，另一项 409；不得自动用新 revision 重试覆盖，应刷新并让用户确认。资料变更生成规则模板快照、重置当前手动计划，旧计划和已有训练保持原样。当前快照明确不是 AI 生成结果。

训练详情和体重接口使用十进制字符串输出 loadKg / kg，避免序列化精度歧义；前端接入时再按约定映射为录入数值。date 是 YYYY-MM-DD，起止时刻为 ISO UTC 或 null。

## 实现选择与限制

- 密码使用 Node.js 异步 scrypt，每个密码独立随机 16 字节盐，N=131072、r=8、p=1，64 字节结果；固定成本版本前缀。哈希比较使用 timingSafeEqual，不存在账户也执行相同成本计算。[Node.js 官方说明](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)。
- 会话令牌为 32 字节密码学随机值，数据库只存 SHA-256。七天绝对过期，不随访问延期；退出删除当前行，重新登录替换浏览器中同账户旧令牌。
- 每账户最多五个会话，超出撤销最早的；单调 sequence 排序避免同一毫秒创建时随机撤销。登录和会话清理同一事务执行。
- Cookie 使用 HttpOnly、SameSite=Strict、Path=/api/v1。本机 HTTP 开发不启用 Secure；NODE_ENV=production 时必须配置 HTTPS APP_ORIGIN，使用 Secure 和 __Secure- 前缀。
- 注册/登录按真实连接 IP 每路由每分钟最多 10 次；其余账户接口 120 次。未启用 trustProxy，伪造 X-Forwarded-For 不能绕过。限速计数在内存中，重启清零，仅适合当前单机开发；多实例上线前需共享限速存储。
- 同时最多两项密码哈希计算，满载返回 429 并提示稍后重试，避免无上限占用内存。
- 后端仍只监听 127.0.0.1；生产开放、邮箱验证、密码重置、账户删除和多因素认证未实现。

旧模型中 email/passwordHash 为空的虚构账户保留，不发放默认密码，也不能登录。没有向真实用户发送邮件，没有将账户样例写入开发数据库。

## 启动、验证与学习

执行 `npm run backend:local` 应用全部迁移，3100 现在同源提供页面与 API。标准 PostgreSQL 模式按 BACKEND-SETUP.md 执行 db:migrate。APP_ORIGIN 默认与本地页面/API 地址一致。

```sh
npm run check
npm run format:check
npm run test:backend
```

账户测试在独立数据库中注册两个虚构账户，验证哈希、伪造/过期/退出会话、来源和 CSRF、两账户隔离、同 ID 训练、资料并发冲突、旧快照、请求限速与 Secure Cookie。测试启动器还重启 PostgreSQL 核对记录和会话数量。第四步新增页面与客户端集成验收，见 BACKEND-INTEGRATION.md；账户登录后不自动上传原浏览器资料。

建议学习顺序：`server/passwords.ts`（密码与成本）→ `server/auth.ts`（会话、Cookie 和校验）→ `server/private-routes.ts`（所有权和事务）→ `server/test/accounts.test.ts`（通过行为验证安全边界）。数据库变更见 `prisma/schema.prisma` 和 `202610130003_accounts/migration.sql`。
