import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkout,
  putWorkoutSet,
  removeWorkoutSet,
  finishWorkout,
  previousExercise,
  changeWorkout,
} from '../public/workouts.js';
import {
  initialState,
  loadState,
  persistState,
  STORAGE_KEY,
  LEGACY_KEY,
  serializeState,
  parseBackup,
  mergeBackup,
} from '../public/storage.js';

// 用内存模拟浏览器存储；故意制造失败，验证页面不会误报保存成功。
function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}
function activeState() {
  const state = initialState();
  state.workouts.push(
    createWorkout({
      id: 'w1',
      date: '2026-10-12',
      startedAt: '2026-10-12T03:00:00.000Z',
      planName: '全身 A',
      planVersion: 1,
      exercises: [{ id: 'e1', exerciseId: 'squat', name: '深蹲', unit: 'reps' }],
    }),
  );
  return state;
}
const set = { id: 's1', load: 10, value: 12, rir: 2, pain: false };

test('add, edit, delete and finish retain identity and do not mutate input', () => {
  const original = activeState();
  const added = putWorkoutSet(original, 'w1', 'e1', set);
  const edited = putWorkoutSet(added, 'w1', 'e1', { ...set, value: 8, pain: true }, 's1');
  assert.equal(edited.workouts[0].exercises[0].sets[0].value, 8);
  assert.equal(edited.workouts[0].exercises[0].sets[0].id, 's1');
  assert.equal(original.workouts[0].exercises[0].sets.length, 0);
  const completed = finishWorkout(edited, 'w1', '2026-10-12T04:00:00.000Z');
  assert.equal(completed.workouts[0].status, 'completed');
  assert.equal(
    removeWorkoutSet(completed, 'w1', 'e1', 's1').workouts[0].exercises[0].sets.length,
    0,
  );
  assert.throws(() => finishWorkout(original, 'w1', '2026-10-12T04:00:00.000Z'), /至少/);
  assert.throws(() => putWorkoutSet(original, 'w1', 'missing', set), /动作/);
  assert.throws(() => removeWorkoutSet(added, 'w1', 'e1', 'missing'), /记录/);
});

test('last performance uses completed sessions with matching identity and units, not active or own records', () => {
  const completed = finishWorkout(
    putWorkoutSet(activeState(), 'w1', 'e1', set),
    'w1',
    '2026-10-12T04:00:00.000Z',
  );
  assert.equal(previousExercise(completed, 'squat', 'reps', 'other').sets[0].load, 10);
  assert.equal(previousExercise(completed, 'squat', 'seconds', 'other'), null);
  assert.equal(previousExercise(completed, 'squat', 'reps', 'w1'), null);
  assert.equal(previousExercise(activeState(), 'squat', 'reps', 'other'), null);
});

test('bad notes or calendar dates fail without mutating original session', () => {
  const state = activeState();
  assert.throws(() =>
    changeWorkout(state, 'w1', (workout) => {
      workout.notes = 'a'.repeat(2001);
    }),
  );
  assert.throws(() =>
    changeWorkout(state, 'w1', (workout) => {
      workout.date = '2026-02-30';
    }),
  );
  assert.equal(state.workouts[0].date, '2026-10-12');
});

test('viewing an older session never uses a later session as previous performance', () => {
  const state = finishWorkout(
    putWorkoutSet(activeState(), 'w1', 'e1', set),
    'w1',
    '2026-10-12T04:00:00.000Z',
  );
  const later = structuredClone(state.workouts[0]);
  later.id = 'w2';
  later.exercises[0].id = 'e2';
  later.exercises[0].sets[0].id = 's2';
  later.startedAt = '2026-10-12T05:00:00.000Z';
  later.completedAt = '2026-10-12T06:00:00.000Z';
  state.workouts.push(later);
  assert.equal(previousExercise(state, 'squat', 'reps', 'w1'), null);
  assert.equal(previousExercise(state, 'squat', 'reps', 'w2').sets[0].load, 10);
});

test('refresh restores saved active session and completed groups', () => {
  const storage = memoryStorage();
  const state = putWorkoutSet(activeState(), 'w1', 'e1', set);
  persistState(storage, state, null);
  const reloaded = loadState(storage).state;
  assert.equal(reloaded.workouts[0].status, 'active');
  assert.deepEqual(reloaded.workouts[0].exercises[0].sets, [set]);
});

test('v1 migration preserves legacy raw data and runs only once', () => {
  const storage = memoryStorage();
  const state = initialState();
  state.logs = [
    { exercise: '深蹲', load: 10, reps: 12, rir: 2, pain: false, date: '2026-10-12', version: 1 },
  ];
  delete state.schemaVersion;
  delete state.workouts;
  const raw = JSON.stringify(state);
  storage.setItem(LEGACY_KEY, raw);
  const migrated = loadState(storage);
  assert.equal(migrated.migrated, true);
  assert.equal(storage.getItem(LEGACY_KEY), raw);
  assert.equal(loadState(storage).migrated, false);
  assert.deepEqual(loadState(storage).state.workouts, migrated.state.workouts);
});

test('invalid legacy data and corrupted v2 data remain intact for recovery', () => {
  const storage = memoryStorage();
  storage.setItem(LEGACY_KEY, '{bad json');
  assert.throws(() => loadState(storage));
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(storage.getItem(LEGACY_KEY), '{bad json');
  storage.setItem(STORAGE_KEY, '{bad v2');
  assert.throws(() => loadState(storage));
  assert.equal(storage.getItem(STORAGE_KEY), '{bad v2');
});

test('quota failure leaves prior state intact and concurrent updates are rejected', () => {
  const storage = memoryStorage();
  const before = persistState(storage, initialState(), null);
  const setItem = storage.setItem;
  storage.setItem = () => {
    throw new Error('QuotaExceeded');
  };
  assert.throws(() => persistState(storage, activeState(), before), /Quota/);
  assert.equal(storage.getItem(STORAGE_KEY), before);
  storage.setItem = setItem;
  persistState(storage, activeState(), before);
  assert.throws(() => persistState(storage, initialState(), before), /另一页面/);
});

test('read-back mismatch rolls back the original data', () => {
  const storage = memoryStorage();
  const before = persistState(storage, initialState(), null);
  const setItem = storage.setItem;
  let first = true;
  storage.setItem = (key, value) => {
    setItem(key, first ? '{bad' : value);
    first = false;
  };
  assert.throws(() => persistState(storage, activeState(), before), /核对失败/);
  assert.equal(storage.getItem(STORAGE_KEY), before);
});

test('backup round trip retains profile, weights, history and session data', () => {
  const state = putWorkoutSet(activeState(), 'w1', 'e1', set);
  state.weights.push({ date: '2026-10-12', value: 70 });
  const text = JSON.stringify({
    format: 'lianxu-backup',
    version: 2,
    state: JSON.parse(serializeState(state)),
  });
  const restored = parseBackup(text);
  assert.deepEqual(restored.workouts, state.workouts);
  assert.deepEqual(restored.weights, state.weights);
  assert.deepEqual(restored.profile, state.profile);
  assert.deepEqual(restored.history, state.history);
  assert.equal('logs' in restored, false);
  assert.throws(() => parseBackup(JSON.stringify({ format: 'other', version: 2, state })));
});

test('merging duplicate backup skips identical IDs and rejects changed content or multiple active sessions', () => {
  const state = activeState();
  assert.equal(mergeBackup(state, structuredClone(state)).skipped, 1);
  const conflict = structuredClone(state);
  conflict.workouts[0].notes = 'different';
  assert.throws(() => mergeBackup(state, conflict), /同ID/);
  const second = structuredClone(state);
  second.workouts[0].id = 'w2';
  second.workouts[0].exercises[0].id = 'e2';
  assert.throws(() => mergeBackup(state, second), /一次/);
  assert.equal(state.workouts.length, 1);
});
