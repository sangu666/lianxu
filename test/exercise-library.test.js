import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeExercises, importExercises } from '../scripts/import-exercises.mjs';
import {
  BUILTIN_EXERCISES,
  PLAN_SLOTS,
  findBuiltinExercise,
  canonicalExerciseId,
  searchExercises,
} from '../public/exercise-catalog.js';
import { IMPORTED_EXERCISES, EXERCISE_SOURCE } from '../public/data/exercises.js';
import { exerciseDetailHtml, createExerciseLibrary } from '../public/exercise-view.js';
import { exerciseIdentity, migrateLegacyLogs, previousExercise } from '../public/workouts.js';
import { translateExerciseName } from '../scripts/exercise-names-zh.mjs';

test('imported catalog has pinned provenance, unique IDs, Chinese instructions and no media fields', () => {
  assert.equal(IMPORTED_EXERCISES.length, 1324);
  assert.equal(EXERCISE_SOURCE.count, 1324);
  assert.equal(new Set(IMPORTED_EXERCISES.map((item) => item.id)).size, 1324);
  for (const item of IMPORTED_EXERCISES) {
    assert.ok(item.stepsZh.length);
    assert.equal(item.unit, 'unspecified');
    assert.ok(!Object.keys(item).some((key) => /gif|image|thumbnail|url/i.test(key)));
  }
});

const sourceRow = {
  id: '0001',
  name: 'barbell bench press',
  body_part: 'back',
  equipment: 'cable',
  target: 'lats',
  secondary_muscles: [],
  instruction_steps: { zh: ['动作说明'], en: ['Instruction'] },
  gif: 'https://example.com/media.gif',
};
test('import rejects duplicate IDs and malformed instructions; whitelist drops media', () => {
  assert.throws(() => normalizeExercises([sourceRow, sourceRow]), /重复/);
  assert.throws(
    () => normalizeExercises([{ ...sourceRow, instruction_steps: { zh: [], en: ['test'] } }]),
    /步骤/,
  );
  assert.equal(normalizeExercises([sourceRow])[0].gif, undefined);
});

test('import refuses modified source before writing the published catalog', async () => {
  const before = await readFile(new URL('../public/data/exercises.js', import.meta.url), 'utf8');
  await assert.rejects(
    importExercises(new URL('../package.json', import.meta.url)),
    /校验|SHA|匹配|版本/,
  );
  assert.equal(
    await readFile(new URL('../public/data/exercises.js', import.meta.url), 'utf8'),
    before,
  );
});

test('all template slots resolve to stable IDs and seconds remains distinct from repetitions', () => {
  assert.equal(BUILTIN_EXERCISES.length, 18);
  for (const ids of Object.values(PLAN_SLOTS))
    for (const id of ids) assert.ok(findBuiltinExercise(`lianxu:${id}`));
  assert.equal(findBuiltinExercise('平板支撑').unit, 'seconds');
  assert.equal(findBuiltinExercise('哑铃侧平举').unit, 'reps');
});

test('legacy history matches exact new identity without rewriting snapshots or merging unknown names', () => {
  const old = migrateLegacyLogs([
    {
      date: '2026-10-11',
      version: 1,
      exercise: '高脚杯深蹲',
      load: 10,
      reps: 12,
      rir: 2,
      pain: false,
    },
  ]);
  const before = structuredClone(old);
  const id = exerciseIdentity('高脚杯深蹲');
  assert.equal(id, 'lianxu:goblet-squat');
  assert.equal(previousExercise(old, id, 'reps')?.sets[0].value, 12);
  assert.equal(previousExercise(old, id, 'seconds'), null);
  assert.deepEqual(old, before);
  assert.equal(canonicalExerciseId('legacy-name:高脚杯深蹲变式'), 'legacy-name:高脚杯深蹲变式');
});

test('Chinese metadata search, equipment filtering, pagination and empty results work together', () => {
  const rows = [...BUILTIN_EXERCISES, ...IMPORTED_EXERCISES];
  const found = searchExercises(rows, { query: '哑铃', body: 'shoulders', device: 'dumbbell' });
  assert.ok(found.total > 24);
  assert.ok(
    found.items.every(
      (item) => item.bodyPart === 'shoulders' && ['dumbbell', 'dumbbells'].includes(item.equipment),
    ),
  );
  assert.equal(searchExercises(rows, { page: 999 }).page, Math.ceil(rows.length / 24));
  assert.equal(searchExercises(rows, { query: '不存在的动作xyz' }).total, 0);
});

test('untrusted names and instructions are escaped in action cards and detail HTML', async () => {
  const malicious = {
    ...IMPORTED_EXERCISES[0],
    name: '<img src=x onerror=alert(1)>',
    nameZh: '<img src=x onerror=alert(1)>',
    stepsZh: ['<script>alert(1)</script>'],
  };
  assert.ok(!exerciseDetailHtml(malicious).includes('<script>'));
  const view = createExerciseLibrary({
    load: async () => ({ IMPORTED_EXERCISES: [malicious] }),
    render() {},
    isVisible: () => true,
  });
  await view.ensureLoaded();
  assert.ok(!view.html().includes('<img src=x'));
  assert.ok(view.html().includes('&lt;img'));
});

test('every community action has a Chinese display name while original English and ID remain available', () => {
  for (const item of IMPORTED_EXERCISES) {
    assert.match(item.nameZh, /[\u4e00-\u9fff]/);
    assert.doesNotMatch(item.nameZh, /[a-z]/i);
    assert.equal(item.nameZh, translateExerciseName(item.name));
    assert.equal(item.id, `hasaneyldrm:${item.sourceId}`);
  }
  const arnold = IMPORTED_EXERCISES.find((item) => item.name === 'dumbbell arnold press');
  assert.ok(
    searchExercises(IMPORTED_EXERCISES, { query: '阿诺德推举' }).items.some(
      (item) => item.id === arnold.id,
    ),
  );
  assert.ok(
    searchExercises(IMPORTED_EXERCISES, { query: 'dumbbell arnold press' }).items.some(
      (item) => item.id === arnold.id,
    ),
  );
  const details = exerciseDetailHtml(arnold);
  assert.ok(details.includes('哑铃阿诺德推举'));
  assert.ok(details.includes('英文原名：'));
  assert.ok(details.includes(arnold.name));
});

test('Chinese naming distinguishes compound movements, grip variants and version numbers', () => {
  assert.equal(translateExerciseName('barbell bench press'), '杠铃卧推');
  assert.equal(translateExerciseName('dumbbell arnold press v. 2'), '哑铃阿诺德推举（变式2）');
  assert.equal(translateExerciseName('lever lying leg curl'), '器械俯卧腿弯举');
  assert.ok(
    translateExerciseName('cable reverse grip triceps pushdown').includes('反握肱三头肌下压'),
  );
  assert.throws(() => translateExerciseName('unknown movement'), /未翻译词/);
});

test('load failure exposes retry, can recover, and does not rerender a different page', async () => {
  let calls = 0,
    renders = 0;
  const view = createExerciseLibrary({
    render: () => renders++,
    isVisible: () => false,
    load: async () => {
      if (++calls === 1) throw new Error('offline');
      return { IMPORTED_EXERCISES };
    },
  });
  await view.ensureLoaded();
  assert.ok(view.html().includes('重新加载资料'));
  await view.ensureLoaded();
  assert.ok(view.html().includes('找到 1342 个动作'));
  assert.equal(renders, 0);
});
