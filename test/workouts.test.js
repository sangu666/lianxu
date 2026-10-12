import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkout,
  isCalendarDate,
  migrateLegacyLogs,
  migrateWorkoutData,
  validateWorkoutData,
} from '../public/workouts.js';

const legacySet = (patch = {}) => ({
  date: '2026-10-12',
  version: 1,
  exercise: '高脚杯深蹲',
  load: 10,
  reps: 12,
  rir: 2,
  pain: false,
  ...patch,
});
const newWorkout = () =>
  createWorkout({
    id: 'workout-1',
    date: '2026-10-12',
    startedAt: '2026-10-12T03:00:00.000Z',
    planVersion: 2,
    planName: '全身 A',
    exercises: [{ id: 'exercise-1', exerciseId: 'goblet-squat', name: '高脚杯深蹲', unit: 'reps' }],
  });

test('new workout retains plan identity and starts with no completed sets', () => {
  const workout = newWorkout();
  assert.equal(workout.status, 'active');
  assert.equal(workout.completedAt, null);
  assert.equal(workout.planVersion, 2);
  assert.deepEqual(workout.exercises[0].sets, []);
});

test('migration groups by date and version while preserving set order, pain and duplicates', () => {
  const logs = [
    legacySet(),
    legacySet(),
    legacySet({ exercise: '单臂哑铃划船', pain: true, reps: 8 }),
    legacySet({ version: 2 }),
    legacySet({ date: '2026-10-11' }),
  ];
  const before = structuredClone(logs);
  const data = migrateLegacyLogs(logs);
  assert.equal(data.workouts.length, 3);
  assert.equal(data.workouts[0].exercises.length, 2);
  assert.equal(data.workouts[0].exercises[0].sets.length, 2);
  assert.equal(data.workouts[0].exercises[1].sets[0].pain, true);
  assert.equal(data.workouts[0].exercises[1].sets[0].value, 8);
  assert.equal(
    data.workouts.flatMap((w) => w.exercises).flatMap((e) => e.sets).length,
    logs.length,
  );
  assert.deepEqual(logs, before);
});

test('legacy archives do not invent start or completion times', () => {
  const workout = migrateLegacyLogs([legacySet()]).workouts[0];
  assert.equal(workout.origin, 'legacy');
  assert.equal(workout.startedAt, null);
  assert.equal(workout.completedAt, null);
  assert.match(workout.notes, /同日多次训练可能合并/);
});

test('migration is deterministic and idempotent without shared references', () => {
  const first = migrateWorkoutData({ logs: [legacySet()] });
  assert.deepEqual(first, migrateWorkoutData({ logs: [legacySet()] }));
  const second = migrateWorkoutData(first);
  assert.deepEqual(second, first);
  second.workouts[0].notes = 'changed';
  assert.notEqual(first.workouts[0].notes, second.workouts[0].notes);
});

test('invalid dates, fields and future schemas fail instead of returning empty data', () => {
  for (const patch of [
    { date: '2026-02-30' },
    { version: 0 },
    { exercise: '' },
    { load: Infinity },
    { reps: 1.5 },
    { pain: 'false' },
  ])
    assert.throws(() => migrateLegacyLogs([legacySet(patch)]));
  assert.throws(() => migrateWorkoutData({ schemaVersion: 3, logs: [] }));
  assert.throws(() => migrateWorkoutData(null));
  assert.equal(isCalendarDate('2024-02-29'), true);
  assert.equal(isCalendarDate('2025-02-29'), false);
});

test('unique IDs span sessions, exercise occurrences and sets', () => {
  const data = migrateLegacyLogs([legacySet(), legacySet()]);
  data.workouts[0].exercises[0].sets[1].id = data.workouts[0].id;
  assert.throws(() => validateWorkoutData(data), /ID/);
});

test('only one active workout is allowed and completion cannot precede start', () => {
  const workout = newWorkout();
  const other = newWorkout();
  other.id = 'workout-2';
  other.exercises[0].id = 'exercise-2';
  assert.throws(() => validateWorkoutData({ schemaVersion: 2, workouts: [workout, other] }));
  workout.status = 'completed';
  workout.completedAt = '2026-10-12T02:00:00.000Z';
  assert.throws(() => validateWorkoutData({ schemaVersion: 2, workouts: [workout] }), /早于/);
});

test('time-based exercises retain seconds and validate the correct range', () => {
  const workout = newWorkout();
  workout.exercises[0].unit = 'seconds';
  workout.exercises[0].sets.push({ id: 'set-1', load: 0, value: 120, rir: 2, pain: false });
  const data = { schemaVersion: 2, workouts: [workout] };
  assert.equal(validateWorkoutData(data), data);
  workout.exercises[0].unit = 'reps';
  assert.throws(() => validateWorkoutData(data));
});

test('empty legacy history migrates to an empty versioned collection', () => {
  assert.deepEqual(migrateLegacyLogs([]), { schemaVersion: 2, workouts: [] });
});
