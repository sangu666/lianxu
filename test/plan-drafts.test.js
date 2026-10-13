import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_CATALOG,
  activePlanDays,
  parsePlanDraft,
  acceptEditablePlan,
  draftFromState,
  validateEditablePlan,
} from '../public/plan-document.js';
import { IMPORTED_EXERCISES } from '../public/data/exercises.js';
import {
  initialState,
  serializeState,
  parseBackup,
  loadState,
  STORAGE_KEY,
  persistState,
} from '../public/storage.js';
import { createWorkout, validateWorkoutData, previousExercise } from '../public/workouts.js';
import { advanceVersion, createReview } from '../public/core.js';

const action = (patch = {}) => ({
  exerciseId: 'hasaneyldrm:2137',
  unit: 'reps',
  sets: 3,
  targetMin: 8,
  targetMax: 12,
  restSeconds: 90,
  reason: '草稿安排理由',
  ...patch,
});
const draft = (patch = {}) => ({
  format: 'lianxu-plan-draft',
  version: 1,
  title: '测试草稿',
  origin: 'ai-draft',
  days: [{ name: '练习日', actions: [action()] }],
  ...patch,
});
const parsed = () => parsePlanDraft(JSON.stringify(draft()));

test('whole catalog index covers all IDs and preserves distinct movements with the same display name', () => {
  assert.equal(PLAN_CATALOG.length, 1342);
  assert.equal(new Set(PLAN_CATALOG.map((item) => item.id)).size, 1342);
  for (const item of IMPORTED_EXERCISES)
    assert.equal(PLAN_CATALOG.find((entry) => entry.id === item.id).name, item.nameZh);
});

test('draft parser resolves known IDs and rejects guessing, malformed JSON or oversize input', () => {
  assert.equal(parsed().days[0].actions[0].name, '哑铃阿诺德推举');
  assert.throws(() => parsePlanDraft('{bad}'), /JSON/);
  assert.throws(() => parsePlanDraft('中'.repeat(100000)), /256/);
  assert.throws(
    () =>
      parsePlanDraft(
        JSON.stringify(
          draft({ days: [{ name: '未知', actions: [action({ exerciseId: 'arbitrary-name' })] }] }),
        ),
      ),
    /未知动作编号/,
  );
});

test('units and per-action targets are explicit, bounded, and time actions cannot inherit repetition units', () => {
  for (const patch of [
    { unit: 'unspecified' },
    { targetMin: 13, targetMax: 12 },
    { sets: 11 },
    { restSeconds: -1 },
    { targetMax: 101 },
    { sets: '3' },
    { exerciseId: 'lianxu:plank', unit: 'reps' },
  ]) {
    assert.throws(() =>
      parsePlanDraft(JSON.stringify(draft({ days: [{ name: '边界', actions: [action(patch)] }] }))),
    );
  }
  assert.equal(
    parsePlanDraft(
      JSON.stringify(
        draft({
          days: [
            {
              name: '计时',
              actions: [
                action({
                  exerciseId: 'lianxu:plank',
                  unit: 'seconds',
                  targetMin: 20,
                  targetMax: 30,
                }),
              ],
            },
          ],
        }),
      ),
    ).days[0].actions[0].unit,
    'seconds',
  );
});

test('drafts reject duplicate actions, empty days and excessive action lists', () => {
  for (const actions of [[], [action(), action()], Array.from({ length: 21 }, () => action())])
    assert.throws(() =>
      parsePlanDraft(JSON.stringify(draft({ days: [{ name: '重复', actions }] }))),
    );
});

test('preview requires explicit acknowledgement and accepting preserves records and prior versions', () => {
  const state = initialState(),
    before = structuredClone(state);
  const plan = parsed();
  assert.throws(() => acceptEditablePlan(state, plan), /核对/);
  assert.throws(
    () => acceptEditablePlan(state, plan, { acknowledge: true, expectedVersion: 9 }),
    /已变化/,
  );
  const next = acceptEditablePlan(state, plan, { acknowledge: true });
  assert.equal(next.version, 2);
  assert.equal(next.editablePlan.origin, 'ai-draft');
  assert.equal(next.editablePlan.days[0].actions[0].acknowledged, true);
  assert.deepEqual(next.workouts, before.workouts);
  assert.deepEqual(next.history[0], before.history[0]);
  assert.deepEqual(state, before);
  assert.equal(plan.days[0].actions[0].acknowledged, false);
  assert.notEqual(next.editablePlan, next.history.at(-1).editablePlan);
});

test('export/import and full backup/refresh retain custom plans, prescriptions and source; old states remain untouched', () => {
  const old = initialState();
  assert.ok(!('editablePlan' in JSON.parse(serializeState(old))));
  const next = acceptEditablePlan(old, parsed(), { acknowledge: true });
  const exported = draftFromState(next);
  assert.equal(
    parsePlanDraft(JSON.stringify(exported)).days[0].actions[0].exerciseId,
    'hasaneyldrm:2137',
  );
  assert.ok(!('profile' in exported));
  const raw = serializeState(next);
  const restored = loadState({ getItem: (key) => (key === STORAGE_KEY ? raw : null) }).state;
  assert.deepEqual(restored.editablePlan, next.editablePlan);
  const backedUp = parseBackup(
    JSON.stringify({ format: 'lianxu-backup', version: 2, state: restored }),
  );
  assert.deepEqual(activePlanDays(backedUp), activePlanDays(next));
});

test('workouts snapshot library ID, unit and prescription without inheriting another action performance', () => {
  const state = acceptEditablePlan(initialState(), parsed(), { acknowledge: true });
  const planned = activePlanDays(state)[0].actions[0];
  const workout = createWorkout({
    id: 'workout-draft',
    date: '2026-10-13',
    startedAt: '2026-10-13T01:00:00.000Z',
    planVersion: state.version,
    planName: '练习日',
    exercises: [
      {
        id: 'action-draft',
        exerciseId: planned.exerciseId,
        name: planned.name,
        unit: planned.unit,
        prescription: {
          sets: planned.sets,
          targetMin: planned.targetMin,
          targetMax: planned.targetMax,
          restSeconds: planned.restSeconds,
          reason: planned.reason,
        },
      },
    ],
  });
  state.workouts.push(workout);
  const original = structuredClone(workout);
  const changed = advanceVersion(state, { ...state.profile, weight: 76 }, false, '重建规则');
  assert.deepEqual(changed.workouts[0], original);
  assert.ok(!changed.editablePlan);
  assert.equal(previousExercise(state, 'lianxu:goblet-squat', 'reps'), null);
  workout.exercises[0].prescription.targetMax = 500;
  assert.throws(() => validateWorkoutData({ schemaVersion: 2, workouts: [workout] }), /计划目标/);
});

test('custom plan feedback does not claim template deload can apply to custom targets', () => {
  const state = acceptEditablePlan(initialState(), parsed(), { acknowledge: true });
  assert.equal(createReview(state, 'tired').kind, 'blocked');
  assert.ok(createReview(state, 'tired').reason.includes('逐动作'));
});

test('invalid custom history and failed/concurrent saves never overwrite the existing stored plan', () => {
  const state = initialState(),
    raw = serializeState(state);
  const next = acceptEditablePlan(state, parsed(), { acknowledge: true });
  next.history.at(-1).editablePlan.days[0].actions[0].exerciseId = 'missing';
  assert.throws(() => serializeState(next), /未知/);
  const valid = acceptEditablePlan(state, parsed(), { acknowledge: true });
  let saved = raw;
  const storage = {
    getItem: () => saved,
    setItem: (_key, value) => {
      if (value !== raw) throw new Error('写入失败');
      saved = value;
    },
  };
  assert.throws(() => persistState(storage, valid, raw), /写入失败/);
  assert.equal(saved, raw);
  assert.throws(() => persistState(storage, valid, 'stale'), /另一页面/);
  assert.equal(saved, raw);
  const invalid = parsed();
  invalid.days[0].actions[0].acknowledged = 'yes';
  assert.throws(() => validateEditablePlan(invalid), /确认标记/);
});
