BEGIN;
-- 第四步实现实际写入后更新字段说明；不改写已应用的迁移，不改变结构和记录。
COMMENT ON COLUMN "Workout"."revision" IS '训练修改版本，初始为 1；每次训练事务保存递增。修改与删除提交 expectedRevision，版本不一致返回 409，避免旧页面覆盖新记录。';
COMMENT ON COLUMN "PlanVersion"."snapshot" IS '不可变计划 JSON 快照：version 版本、reason 来源说明、profile 当时资料、adjusted 减量演示、days 当时排课结果；可包含 editablePlan 手动/外部草稿、planOverrides 推荐替代清单。days.actions 保存动作编号、名称、单位、组次、休息和确认提醒。规则模板或用户确认内容，不是真实 AI；旧版本不得覆盖。';
COMMIT;
