# 本地后端启动与代码学习

已完成后端步骤 1–6：数据库结构、公开动作 API、账户会话、页面个人记录读写、旧备份迁移预览与确认、写入回执和单项待同步队列。旧浏览器记录不自动上传；使用与学习见 BACKEND-INTEGRATION.md、BACKEND-IMPORTS.md 和 BACKEND-RELIABILITY.md。

## 最快启动

要求 Node.js 22.18 或以上；本机已使用 Node.js 24。Windows PowerShell 若禁止 npm.ps1，请改用 npm.cmd。

```sh
npm ci
npm run backend:local
```

启动器生成 Prisma 客户端，启动真实 PostgreSQL，应用迁移，幂等导入 18 个内置与 1324 个社区文字动作，然后启动 Fastify。

- API：`http://127.0.0.1:3100/api/v1/health`
- 数据库就绪：`http://127.0.0.1:3100/api/v1/ready`
- 动作列表：`http://127.0.0.1:3100/api/v1/exercises`
- 中文搜索：`http://127.0.0.1:3100/api/v1/exercises?q=阿诺德`
- 详情：`http://127.0.0.1:3100/api/v1/exercises/hasaneyldrm%3A2137`

数据库版页面直接打开 http://127.0.0.1:3100/，不需要另启前端。原 `npm start` / 3002 静态预览继续为浏览器存储模式，旧数据未迁移。账户与页面使用说明见 BACKEND-INTEGRATION.md。

终端按 Ctrl+C 关闭后端与数据库，再执行同一命令可重新启动。PostgreSQL 数据文件在 `work/local-postgres/cluster`，随机连接密码在同目录上一级的 connection.json；目录已被 Git 忽略，不要删除、公开或加入仓库。启动器不会自动结束占用端口的其他进程。

数据库固定本机 55432，API 默认 3100。需要修改 API 端口时可在当前终端设置 `API_PORT`。不要把开发数据库用作公网生产数据库。

开发便利启动器使用 `embedded-postgres` 包运行 PostgreSQL 二进制；包装器版本带 beta，限定用于本地开发与测试，不作为生产部署依赖。Windows 正常停止改为使用 pg_ctl，保留数据；异常断电后 PostgreSQL 可能进行恢复，不自动重建或清空目录。

## 已安装标准 PostgreSQL 的方式

创建空的 lianxu 数据库，将 `.env.example` 复制为 `.env` 并填入连接信息；不要把 `.env` 提交到仓库。执行：

```sh
npm run backend:generate
npm run db:migrate
npm run db:seed
npm run backend:start
```

两种方式使用同一份 Prisma 模型、迁移、种子与接口。标准方式需要你自行维护 PostgreSQL 进程；停止 API 不会停止已有数据库服务。当前启动接口仍固定本机地址。

## 验证与审核

```sh
npm run check
npm run format:check
npm run test:backend
```

check 包含现有前端测试、构建、后端类型检查、Prisma 生成与模型验证。test:backend 在 work 下建立独立测试数据库，不连接本地开发数据库；使用虚构账户验证查询、错误、幂等导入、计划不可变、账户复合外键、活跃训练唯一约束、单位和事务回滚。测试数据库保留在忽略目录，便于故障检查。

## 阅读顺序

在 Navicat 中刷新表结构后，可查看全部表和字段的中文注释。完整对照及只读查询见 `BACKEND-FIELDS.md`；第 4 个迁移只补注释，不更改业务数据。

1. `docs/BACKEND-DESIGN.md`：先理解关系与尚未实现的部分。
2. `prisma/schema.prisma`：model 表、字段、relation 外键、unique 唯一约束；中文注释说明单位与职责。
3. `server/db.ts`：连接池与超时。
4. `server/app.ts`：路由输入校验、过滤条件、数据库分页和错误处理。
5. `server/catalog.ts`：公开资料到数据库行的映射，以及事务内幂等 upsert。
6. `prisma/migrations/`：实际 SQL；第二个迁移补充 Prisma 无法直接表达的部分索引与触发器。
7. `server/test/backend.test.ts`：用真实数据库证明关键行为。

本阶段没有新建重复项目、迁移浏览器个人记录、接入模型或发布远程仓库。下一步是第 4 步：登录界面与前端逐模块接入。
