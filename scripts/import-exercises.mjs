import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { translateExerciseName } from './exercise-names-zh.mjs';

export const EXERCISE_SOURCE = {
  repository: 'hasaneyldrm/exercises-dataset',
  commit: '7455efae41b330c265e7cd4b78dfa848e7ce5ebd',
  sha256: '656634224b8977b99a6d765470ee123260d4979715eaa4e7c0b7c8bb0d79f93d',
  license: 'MIT (non-media)',
};

/** 校验固定字段后白名单导入；图片、GIF及其地址不进入产物，文本在页面另做转义。 */
export function normalizeExercises(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 10000)
    throw new Error('动作数据必须是非空数组');
  const ids = new Set(); // 上游编号唯一，不依赖数组位置生成动作身份。
  const text = (value) =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 12000;
  return rows.map((row) => {
    if (!row || !/^\d{4}$/.test(row.id) || ids.has(row.id))
      throw new Error('上游动作编号无效或重复');
    ids.add(row.id);
    for (const key of ['name', 'body_part', 'equipment', 'target'])
      if (!text(row[key])) throw new Error(`动作${row.id}字段无效：${key}`);
    for (const lang of ['zh', 'en']) {
      const steps = row.instruction_steps?.[lang];
      if (
        !Array.isArray(steps) ||
        !steps.length ||
        steps.length > 100 ||
        steps.some((step) => !text(step))
      )
        throw new Error(`动作${row.id}缺少有效${lang}步骤`);
    }
    if (
      !Array.isArray(row.secondary_muscles) ||
      row.secondary_muscles.some((value) => !text(value))
    )
      throw new Error('辅助肌群无效');
    return {
      id: `hasaneyldrm:${row.id}`,
      sourceId: row.id,
      name: row.name,
      nameZh: translateExerciseName(row.name), // 中文仅用于显示和搜索，英文原名与来源编号保持不变。
      bodyPart: row.body_part,
      equipment: row.equipment,
      target: row.target,
      secondaryMuscles: [...row.secondary_muscles],
      stepsZh: [...row.instruction_steps.zh],
      stepsEn: [...row.instruction_steps.en],
      unit: 'unspecified', // 上游没有记录单位，不能把所有动作猜成次数或秒数。
      origin: 'community',
    };
  });
}

/** 离线可复现导入：原文件必须与固定来源提交的SHA256一致，升级来源需要显式修改版本。 */
export async function importExercises(inputPath) {
  const bytes = await readFile(inputPath);
  if (createHash('sha256').update(bytes).digest('hex') !== EXERCISE_SOURCE.sha256)
    throw new Error('来源文件校验和不一致，请核对固定版本');
  const exercises = normalizeExercises(JSON.parse(bytes.toString('utf8')));
  const output = new URL('../public/data/', import.meta.url);
  await mkdir(output, { recursive: true });
  // Prettier只是开发依赖；格式化一次生成产物，浏览器运行不需要安装它。
  const prettier = await import('prettier');
  const config = JSON.parse(
    await readFile(new URL('../.prettierrc.json', import.meta.url), 'utf8'),
  );
  const source = `// 自动生成：仅含MIT非媒体数据。来源、校验和及许可见EXERCISE_SOURCE。\nexport const EXERCISE_SOURCE = ${JSON.stringify({ ...EXERCISE_SOURCE, count: exercises.length })};\nexport const IMPORTED_EXERCISES = ${JSON.stringify(exercises)};\n`;
  await writeFile(
    new URL('exercises.js', output),
    await prettier.format(source, { ...config, parser: 'babel' }),
  );
  // 计划校验只加载名称与分类索引，不让每次启动都加载全部教学步骤。
  const index = exercises.map(({ id, nameZh, equipment, bodyPart, target }) => [
    id,
    nameZh,
    equipment,
    bodyPart,
    target,
  ]);
  await writeFile(
    new URL('plan-index.js', output),
    await prettier.format(
      `// 自动生成的MIT非媒体动作索引；许可同exercises.js。\nexport const PLAN_INDEX = ${JSON.stringify(index)};\n`,
      { ...config, parser: 'babel' },
    ),
  );
  console.log(`已导入${exercises.length}条动作文字资料；不含图片或GIF。`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('请提供原始exercises.json文件路径');
  await importExercises(resolve(process.argv[2]));
}
