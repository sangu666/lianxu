-- 旧数据保留；密码为空的旧虚构账户不能登录，不生成默认密码。
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
CREATE UNIQUE INDEX "User_email_case_insensitive" ON "User" (lower("email")) WHERE "email" IS NOT NULL;

CREATE TABLE "Session" (
  "tokenHash" CHAR(64) NOT NULL,
  "sequence" BIGSERIAL NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash"),
  CONSTRAINT "Session_expiry_valid" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "Session_hash_valid" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "Session_userId_createdAt_idx" ON "Session" ("userId", "createdAt");
CREATE UNIQUE INDEX "Session_sequence_key" ON "Session" ("sequence");
CREATE INDEX "Session_expiresAt_idx" ON "Session" ("expiresAt");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
