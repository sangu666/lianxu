# 当前架构

当前前端是本地可运行静态原型，后端已增加数据库与账户接口（见本文末尾），第 4 步账户模式已完成前后端接入，不是 Next.js 生产工程。账户模块与读写见 BACKEND-INTEGRATION.md；原浏览器记录需显式备份迁移，见 BACKEND-IMPORTS.md。第六步新增 sync-outbox.js 与 sync-view.js，在浏览器暂存单项失败请求；服务端 reliable-write.ts 与 WriteReceipt 在同一事务里保存业务和回执，见 BACKEND-RELIABILITY.md。

全库编辑增加 `plan-document.js`（轻量目录、逐动作计划文档与草稿解析）、`plan-actions.js`（目标范围校验）及 `plan-editor-view.js`（选择/导入/编辑交互）。`activePlanDays` 统一模板和自定义计划的视图数据；新训练复制动作ID及目标快照，存储校验当前与历史文档。说明见 `PLAN-DRAFTS.md`。

第 5 步新增 `exercise-replacements.js`（明确替代关系、过滤与清单验证）和 `replacement-view.js`（选择与确认弹层）。`createPlan` 接受可选替换清单，`replacePlanExercise` 建立新版本；`storage.js` 同时校验当前与历史清单，旧字段缺省不写入迁移值。说明见 `EXERCISE-REPLACEMENTS.md`。

第 4 步新增 `exercise-catalog.js`（18 个模板动作、稳定编号、搜索与兼容映射）、`exercise-view.js`（查阅页面和独立详情弹层）、`public/data/exercises.js`（1,324 条社区文字资料，按需加载）。社区库不参与自动排课，不写入用户存储或备份。教学及来源边界见 `EXERCISE-LIBRARY.md`。

`public/profile-rules.js` 新增个人训练条件选项、扩展字段校验与最小动作筛选规则；`core.js` 调用它生成规则模板。旧资料缺省的新字段仅在计算与表单显示时推定，读取不会改写历史。字段说明见 `PROFILE-DATA.md`。

`public/app.js`负责路由、全局状态和资料事件；`public/workout-view.js`负责训练页面、确认框和备份交互；`public/workouts.js`负责训练校验、迁移与组操作；`public/storage.js`负责完整状态校验、保存、迁移和备份；`public/core.js`负责资料验证、模板、恢复提案和版本快照；`scripts/serve.mjs`只提供public目录静态资源，无数据API；`scripts/build.mjs`将前端复制到dist。

浏览器记录不进入仓库或构建。存储损坏时提示读取失败并禁止普通写入，保留原始记录下载入口。存储失败时保持最后一次成功状态；不会显示保存成功。其他标签页修改会提示刷新。照片只用Object URL预览，移除或刷新释放，不进行AI分析。

训练与营养数字是交互示例，不是经审查的处方。照片结论目前不可用。

2026-10-13：步骤 1、2 在本仓库增加 TypeScript + Fastify + Prisma + PostgreSQL。`server/app.ts` 提供公开动作只读 API，`server/catalog.ts` 事务导入公开文字，`prisma/schema.prisma` 和迁移定义账户归属、资料、不可变计划版本、训练/动作/组和体重。`scripts/backend-local.mjs` 在本机启动真实数据库和 API。前端仍使用原浏览器存储；随后第 3 步增加账户与部分个人接口，迁移尚未实现。设计与运行说明见 `BACKEND-DESIGN.md`、`BACKEND-SETUP.md`。

后续增加私有对象存储与异步任务。模型适配器与规则校验分开，照片观察独立于身体数据测量，确认后保存不可变计划版本；照片存储与模型供应商尚未确定。

后端第 3 步：`server/passwords.ts` 负责加盐 scrypt 与比较；`server/auth.ts` 负责 Cookie、持久会话、来源/CSRF、限速和账户路由；`server/private-routes.ts` 固定账户归属，提供私有读取及资料事务保存。第三个迁移增加密码哈希、Session 和大小写邮箱唯一索引。账号测试独立于浏览器数据。详细契约见 `BACKEND-ACCOUNTS.md`；前端登录和数据接入仍待第 4 步。
