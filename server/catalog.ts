import type { PrismaClient, Prisma } from '@prisma/client';
import { BUILTIN_EXERCISES } from '../public/exercise-catalog.js';
import { IMPORTED_EXERCISES, EXERCISE_SOURCE } from '../public/data/exercises.js';

/** 从仓库公开文字资料生成数据库行；绝不扫描浏览器资料或导入图片/GIF。 */
export function catalogRows(): Prisma.ExerciseCreateManyInput[] {
  // 原型由 JS 元组生成内置目录；在 TS 边界明确目录契约，不把推断出的联合类型向数据库传播。
  interface CatalogItem {
    id: string;
    name: string;
    nameZh?: string;
    bodyPart: string;
    equipment: string;
    target: string;
    secondaryMuscles?: string[];
    stepsZh: string[];
    stepsEn?: string[];
    unit: 'reps' | 'seconds' | 'unspecified';
    origin: string;
    sourceId?: string;
    mistake?: string;
  }
  const items = [...BUILTIN_EXERCISES, ...IMPORTED_EXERCISES] as CatalogItem[];
  return items.map((item) => ({
    id: item.id,
    nameZh: item.nameZh ?? item.name,
    nameEn: item.nameZh ? item.name : '',
    bodyPart: item.bodyPart,
    equipment: item.equipment,
    target: item.target,
    secondaryMuscles: item.secondaryMuscles ?? [],
    stepsZh: item.stepsZh,
    stepsEn: item.stepsEn ?? [],
    unit: item.unit,
    origin: item.origin,
    sourceId: item.sourceId ?? item.id,
    sourceCommit: item.origin === 'community' ? EXERCISE_SOURCE.commit : null,
    mistake: item.mistake ?? null,
  }));
}

/** 幂等更新同一批稳定 ID；整批事务失败则全部回滚，不删除已有数据。 */
export async function seedCatalog(db: PrismaClient): Promise<number> {
  const rows = catalogRows();
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error('公开动作资料包含重复 ID，停止导入。');
  await db.$transaction(
    async (tx) => {
      for (const row of rows) {
        await tx.exercise.upsert({ where: { id: row.id }, create: row, update: row });
      }
    },
    { maxWait: 5000, timeout: 60000 },
  );
  return rows.length;
}
