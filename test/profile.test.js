import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState, createPlan, advanceVersion, validateProfile } from '../public/core.js';
import { trainingPreferences, PATTERN_OPTIONS } from '../public/profile-rules.js';
import {
  initialState,
  serializeState,
  parseBackup,
  loadState,
  STORAGE_KEY,
} from '../public/storage.js';
import { createWorkout } from '../public/workouts.js';

const profile = (patch = {}) => ({ ...createDefaultState().profile, ...patch });
const backup = (state) => JSON.stringify({ format: 'lianxu-backup', version: 2, state });

test('old v2 profiles and backups remain byte-preserved when read; derived defaults do not change history', () => {
  const state = initialState();
  const raw = serializeState(state);
  const loaded = loadState({ getItem: (key) => (key === STORAGE_KEY ? raw : null) });
  assert.equal(loaded.raw, raw);
  assert.equal(trainingPreferences(loaded.state.profile).sessionMinutes, 60);
  createPlan(loaded.state.profile);
  assert.deepEqual(loaded.state, JSON.parse(raw));
  assert.deepEqual(parseBackup(backup(state)), state);
  assert.equal('availableEquipment' in loaded.state.history[0].profile, false);
});

test('explicit equipment overrides assumed gym equipment and unavailable pull is disclosed', () => {
  const days = createPlan(profile({ equipment: 'gym', availableEquipment: ['bodyweight'] }));
  for (const day of days) {
    assert.deepEqual(day.exercises, ['自重深蹲', '靠墙俯卧撑', '自重髋铰链练习']);
    assert.ok(day.notes.some((note) => note.includes('水平拉未安排')));
  }
});

test('preference changes eligible choices but cannot bypass explicit devices or excluded patterns', () => {
  const devices = ['bodyweight', 'dumbbells', 'chestMachine', 'rowMachine', 'legPress'];
  const machines = createPlan(
    profile({ availableEquipment: devices, movementPreference: 'machines' }),
  )[0];
  assert.deepEqual(machines.exercises.slice(0, 3), ['腿举', '器械推胸', '坐姿划船']);
  const free = createPlan(
    profile({ equipment: 'gym', availableEquipment: devices, movementPreference: 'freeweights' }),
  )[0];
  assert.deepEqual(free.exercises.slice(0, 3), ['高脚杯深蹲', '哑铃地板卧推', '单臂哑铃划船']);
  const excluded = createPlan(
    profile({
      availableEquipment: devices,
      movementPreference: 'machines',
      excludedPatterns: ['push', 'pull'],
    }),
  )[0];
  assert.ok(!excluded.exercises.some((name) => /卧推|推胸|俯卧撑|划船/.test(name)));
});

test('short time budgets visibly reduce exercises and never report exceeding the selected budget', () => {
  for (const experience of ['beginner', 'experienced']) {
    const short = createPlan(profile({ experience, sessionMinutes: 20 }))[0];
    const normal = createPlan(profile({ experience, sessionMinutes: 60 }))[0];
    assert.ok(short.exercises.length < normal.exercises.length);
    assert.ok(short.estimatedMinutes <= 20);
    assert.ok(short.notes.some((note) => note.includes('未覆盖全部模板')));
  }
});

test('empty equipment and excluded movement lists return explicit empty plans rather than unsafe fallback', () => {
  for (const patch of [
    { availableEquipment: [] },
    { excludedPatterns: PATTERN_OPTIONS.map(([id]) => id) },
  ]) {
    for (const day of createPlan(profile(patch))) {
      assert.deepEqual(day.exercises, []);
      assert.equal(day.estimatedMinutes, 0);
      assert.ok(day.notes.some((note) => note.includes('没有可安排动作')));
    }
  }
});

test('push exclusions remove overhead pushing; shoulder exclusions still allow horizontal pushing', () => {
  const pushExcluded = createPlan(profile({ days: 4, excludedPatterns: ['push'] }))[0];
  assert.ok(!pushExcluded.exercises.includes('站姿哑铃推举'));
  const shoulderExcluded = createPlan(profile({ days: 4, excludedPatterns: ['shoulder'] }))[0];
  assert.ok(shoulderExcluded.exercises.includes('哑铃地板卧推'));
  assert.ok(!shoulderExcluded.exercises.some((name) => /推举|侧平举/.test(name)));
});

test('invalid extension fields are rejected both in profile saves and backup history', () => {
  for (const patch of [
    { availableEquipment: null },
    { availableEquipment: ['unknown'] },
    { availableEquipment: ['dumbbells', 'dumbbells'] },
    { excludedPatterns: ['unknown'] },
    { excludedPatterns: 'push' },
    { excludedPatterns: ['push', 'push'] },
    { sessionMinutes: 0 },
    { sessionMinutes: '30' },
    { sessionMinutes: 31 },
    { movementPreference: 'unknown' },
    { restrictionNotes: null },
    { restrictionNotes: 'a'.repeat(1001) },
  ]) {
    assert.throws(() => validateProfile(profile(patch)));
    const state = initialState();
    Object.assign(state.history[0].profile, patch);
    assert.throws(() => parseBackup(backup(state)));
  }
});

test('profile edits and full backup round trip preserve an existing active workout snapshot', () => {
  const state = initialState();
  state.workouts.push(
    createWorkout({
      id: 'session',
      date: '2026-10-12',
      startedAt: '2026-10-12T03:00:00.000Z',
      planVersion: 1,
      planName: '全身 A',
      exercises: [{ id: 'exercise', exerciseId: 'squat', name: '高脚杯深蹲', unit: 'reps' }],
    }),
  );
  const prefs = {
    availableEquipment: ['bodyweight'],
    sessionMinutes: 30,
    movementPreference: 'bodyweight',
    excludedPatterns: ['squat'],
    restrictionNotes: '虚构测试：设备需预约',
  };
  const next = advanceVersion(state, profile(prefs), false, '更新训练条件');
  assert.deepEqual(next.workouts, state.workouts);
  assert.equal(next.workouts[0].planVersion, 1);
  assert.equal(next.version, 2);
  assert.deepEqual(next.history[1].profile.availableEquipment, ['bodyweight']);
  const restored = parseBackup(backup(JSON.parse(serializeState(next))));
  assert.deepEqual(restored.profile, next.profile);
  assert.deepEqual(restored.workouts, state.workouts);
  next.profile.availableEquipment.push('bands');
  assert.deepEqual(next.history[1].profile.availableEquipment, ['bodyweight']);
  assert.equal('availableEquipment' in state.profile, false);
});

test('free-text notes do not alter generated actions and rule selection does not mutate inputs', () => {
  const p = profile({
    availableEquipment: ['bodyweight', 'dumbbells'],
    restrictionNotes: '虚构测试文字，不能作为筛选指令',
  });
  const before = structuredClone(p);
  assert.deepEqual(createPlan(p), createPlan({ ...p, restrictionNotes: '' }));
  assert.deepEqual(p, before);
});
