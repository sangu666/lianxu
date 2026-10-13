import test from 'node:test';
import assert from 'node:assert/strict';
import { replacementOptions } from '../public/exercise-replacements.js';
import { createPlan, replacePlanExercise, advanceVersion } from '../public/core.js';
import {
  initialState,
  serializeState,
  parseBackup,
  persistState,
  STORAGE_KEY,
} from '../public/storage.js';
import { createWorkout, previousExercise } from '../public/workouts.js';

test('available replacements disclose unavailable equipment and never add unreviewed community movements', () => {
  const state = initialState();
  const result = replacementOptions(
    state.profile,
    'lianxu:goblet-squat',
    createPlan(state.profile)[0].exercises,
  );
  assert.deepEqual(
    result.options.map((item) => item.id),
    ['lianxu:bodyweight-squat'],
  );
  assert.ok(result.unavailable[0].reasons[0].includes('腿举'));
  assert.equal(replacementOptions(state.profile, 'lianxu:plank', []).options.length, 0);
  assert.equal(replacementOptions(state.profile, 'lianxu:lat-pulldown', []).options.length, 0);
});

test('preferences reorder eligible candidates but restrictions and duplicates remain hard constraints', () => {
  const state = initialState();
  const profile = {
    ...state.profile,
    availableEquipment: ['bodyweight', 'dumbbells', 'legPress'],
    movementPreference: 'machines',
  };
  assert.equal(
    replacementOptions(profile, 'lianxu:bodyweight-squat', []).options[0].id,
    'lianxu:leg-press',
  );
  assert.equal(
    replacementOptions({ ...profile, excludedPatterns: ['squat'] }, 'lianxu:goblet-squat', [])
      .options.length,
    0,
  );
  const duplicate = replacementOptions(
    { ...profile, availableEquipment: ['bodyweight'] },
    'lianxu:goblet-squat',
    ['自重深蹲'],
  );
  assert.equal(duplicate.options.length, 0);
  assert.ok(duplicate.unavailable.some((item) => item.reasons.includes('当天已有这个动作')));
});

test('replacement affects only one training day, advances version and preserves active and past snapshots', () => {
  const state = initialState();
  state.workouts.push(
    createWorkout({
      id: 'active',
      date: '2026-10-13',
      startedAt: '2026-10-13T01:00:00.000Z',
      planVersion: 1,
      planName: '全身 A',
      exercises: [
        { id: 'occurrence', exerciseId: 'lianxu:goblet-squat', name: '高脚杯深蹲', unit: 'reps' },
      ],
    }),
  );
  const before = structuredClone(state);
  const next = replacePlanExercise(state, 0, 'lianxu:goblet-squat', 'lianxu:bodyweight-squat');
  const plan = createPlan(next.profile, next.adjusted, next.planOverrides);
  assert.equal(next.version, 2);
  assert.equal(plan[0].exercises[0], '自重深蹲');
  assert.equal(plan[1].exercises[0], '高脚杯深蹲');
  assert.equal(plan[0].sets, createPlan(state.profile)[0].sets);
  assert.deepEqual(next.workouts, before.workouts);
  assert.deepEqual(next.history[0], before.history[0]);
  assert.deepEqual(next.history.at(-1).planOverrides, next.planOverrides);
  assert.deepEqual(state, before);
});

test('changing back removes the override and stale choices or unrelated movements cannot be saved', () => {
  const state = initialState();
  const next = replacePlanExercise(state, 0, 'lianxu:goblet-squat', 'lianxu:bodyweight-squat');
  const reset = replacePlanExercise(next, 0, 'lianxu:bodyweight-squat', 'lianxu:goblet-squat');
  assert.deepEqual(reset.planOverrides, []);
  assert.equal(createPlan(reset.profile, false, reset.planOverrides)[0].exercises[0], '高脚杯深蹲');
  assert.throws(
    () => replacePlanExercise(next, 0, 'lianxu:bodyweight-squat', 'lianxu:goblet-squat', 1),
    /计划已变化/,
  );
  assert.throws(
    () => replacePlanExercise(state, 0, 'lianxu:goblet-squat', 'lianxu:plank'),
    /不可替换/,
  );
  assert.throws(
    () => replacePlanExercise(state, 9, 'lianxu:goblet-squat', 'lianxu:bodyweight-squat'),
    /没有这个动作/,
  );
});

test('backups round trip replacements and history while legacy backups keep their original shape', () => {
  const old = initialState();
  assert.ok(!('planOverrides' in JSON.parse(serializeState(old))));
  const next = replacePlanExercise(old, 0, 'lianxu:goblet-squat', 'lianxu:bodyweight-squat');
  const restored = parseBackup(
    JSON.stringify({
      format: 'lianxu-backup',
      version: 2,
      state: JSON.parse(serializeState(next)),
    }),
  );
  assert.deepEqual(restored.planOverrides, next.planOverrides);
  assert.deepEqual(restored.history, next.history);
  assert.deepEqual(
    createPlan(restored.profile, restored.adjusted, restored.planOverrides),
    createPlan(next.profile, next.adjusted, next.planOverrides),
  );
  const invalid = structuredClone(next);
  invalid.history.at(-1).planOverrides[0].toId = 'hasaneyldrm:0001';
  assert.throws(() => serializeState(invalid), /不满足/);
  invalid.planOverrides.push({ ...invalid.planOverrides[0] });
  assert.throws(() => serializeState(invalid), /重复/);
});

test('deload keeps explicit replacements; editing profile resets them without rewriting prior versions', () => {
  const next = replacePlanExercise(
    initialState(),
    0,
    'lianxu:goblet-squat',
    'lianxu:bodyweight-squat',
  );
  const deload = advanceVersion(next, next.profile, true, '减量', next.planOverrides);
  assert.equal(createPlan(deload.profile, true, deload.planOverrides)[0].exercises[0], '自重深蹲');
  const edited = advanceVersion(next, { ...next.profile, sessionMinutes: 30 }, false, '改资料');
  assert.ok(!('planOverrides' in edited));
  assert.deepEqual(edited.history[1].planOverrides, next.history[1].planOverrides);
});

test('replacement exercises do not inherit performance and failed or concurrent writes retain stored plan', () => {
  const state = initialState();
  state.workouts = [
    {
      id: 'old',
      date: '2026-10-12',
      status: 'completed',
      exercises: [
        { exerciseId: 'lianxu:goblet-squat', unit: 'reps', sets: [{ load: 10, value: 12 }] },
      ],
    },
  ];
  assert.equal(previousExercise(state, 'lianxu:bodyweight-squat', 'reps'), null);
  const before = serializeState(initialState());
  let raw = before;
  const storage = {
    getItem: (key) => (key === STORAGE_KEY ? raw : null),
    setItem: (_key, value) => {
      if (value !== before) throw new Error('空间不足');
      raw = value;
    },
  };
  const next = replacePlanExercise(
    initialState(),
    0,
    'lianxu:goblet-squat',
    'lianxu:bodyweight-squat',
  );
  assert.throws(() => persistState(storage, next, before), /空间不足/);
  assert.equal(raw, before);
  assert.throws(() => persistState(storage, next, 'older'), /另一页面/);
  assert.equal(raw, before);
});
