BEGIN;
CREATE TABLE "ImportJob" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "digest" CHAR(64) NOT NULL,
  "fingerprint" CHAR(64) NOT NULL,
  "payload" JSONB,
  "status" VARCHAR(20) NOT NULL CHECK ("status" IN ('pending','confirmed','expired')),
  "result" JSONB NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImportJob_userId_digest_key" ON "ImportJob"("userId", "digest");
CREATE INDEX "ImportJob_status_expiresAt_idx" ON "ImportJob"("status", "expiresAt");
COMMENT ON TABLE "ImportJob" IS '账户备份迁移预览及确认凭据；预览不写业务表，成功后保留摘要用于防止重复导入。';
COMMENT ON COLUMN "ImportJob"."id" IS '预览编号（UUID 主键）；确认与取消按此编号定位，必须属于登录账户。';
COMMENT ON COLUMN "ImportJob"."userId" IS '所属账户编号，关联 User.id；删除用户时级联清理。';
COMMENT ON COLUMN "ImportJob"."digest" IS '规范化备份事实 SHA-256，忽略导出时刻与训练 revision；同账户唯一，重复确认不重复导入。';
COMMENT ON COLUMN "ImportJob"."fingerprint" IS '预览时账户业务数据指纹；确认前重新核对，变化返回冲突，不覆盖另一页面修改。';
COMMENT ON COLUMN "ImportJob"."payload" IS '已校验的待导入 JSON；pending 时暂存，确认、取消或过期后清理，不包含照片。';
COMMENT ON COLUMN "ImportJob"."status" IS 'pending 待确认、confirmed 已确认、expired 已过期；不是训练状态。';
COMMENT ON COLUMN "ImportJob"."result" IS '条数、版本对应及确认摘要，不包含个人资料、密码或照片。';
COMMENT ON COLUMN "ImportJob"."expiresAt" IS '30 分钟预览截止时刻；到期不能确认，后台每分钟清理过期内容。';
COMMENT ON COLUMN "ImportJob"."createdAt" IS '预览创建时刻，带时区时间戳，默认数据库当前时间。';
COMMIT;
