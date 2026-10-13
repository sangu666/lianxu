import { defineConfig } from 'prisma/config';

// CLI 与后端统一使用 DATABASE_URL；本地启动器通过进程传入，不将密码写入源码。
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:55432/lianxu',
  },
});
