import { createDatabase } from './db.js';
import { seedCatalog } from './catalog.js';

const db = createDatabase(process.env.DATABASE_URL ?? '');
try {
  console.log(`公开动作资料导入完成：${await seedCatalog(db)} 条。`);
} finally {
  await db.$disconnect();
}
