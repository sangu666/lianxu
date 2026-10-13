BEGIN;
CREATE TABLE "WriteReceipt" (
  "userId" UUID NOT NULL,
  "key" UUID NOT NULL,
  "digest" CHAR(64) NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WriteReceipt_pkey" PRIMARY KEY ("userId", "key"),
  CONSTRAINT "WriteReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
COMMENT ON TABLE "WriteReceipt" IS '成功写入回执；与业务修改同事务提交，用于响应丢失后的安全重试';
COMMENT ON COLUMN "WriteReceipt"."userId" IS '所属账户 UUID；归属固定从登录会话获取';
COMMENT ON COLUMN "WriteReceipt"."key" IS '客户端随机请求 UUID；重试沿用，不是业务记录编号';
COMMENT ON COLUMN "WriteReceipt"."digest" IS '方法、路径与规范化请求体 SHA-256，64 位；同编号不同内容拒绝';
COMMENT ON COLUMN "WriteReceipt"."result" IS '首次成功响应 JSON；重复请求返回原响应，不再次写入';
COMMENT ON COLUMN "WriteReceipt"."createdAt" IS '首次成功提交时刻（带时区）；回执保留至账户删除';
COMMIT;
