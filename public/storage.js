import { createDefaultState, validateProfile, createPlan } from './core.js';
import { isCalendarDate, migrateLegacyLogs, validateWorkoutData } from './workouts.js';
import { validateEditablePlan } from './plan-document.js';

// v2采用独立存储键；首次迁移不会删除v1，避免迁移后失去原始记录。
export const STORAGE_KEY = 'lianxu-source-v2';
export const LEGACY_KEY = 'lianxu-source-v1';

/** logs仅是旧页面回顾所需的计算结果，不作为新版存储的事实来源。 */
export function projectLogs(workouts) {
  return workouts.flatMap((workout) =>
    workout.exercises.flatMap((exercise) =>
      exercise.sets.map((set) => ({
        exercise: exercise.name,
        load: set.load,
        reps: set.value,
        rir: set.rir,
        pain: set.pain,
        date: workout.date,
        version: workout.planVersion,
      })),
    ),
  );
}

/** 校验完整备份；资料和体重也需要校验，不能只验证训练列表。 */
export function validateState(state) {
  validateWorkoutData(state);
  validateProfile(state.profile);
  if (state.editablePlan !== undefined) validateEditablePlan(state.editablePlan);
  if (state.planOverrides !== undefined)
    createPlan(state.profile, state.adjusted, state.planOverrides);
  if (!Number.isInteger(state.version) || state.version < 1 || typeof state.adjusted !== 'boolean')
    throw new Error('计划资料无效');
  if (!Array.isArray(state.weights) || !Array.isArray(state.history))
    throw new Error('体重或版本历史格式无效');
  for (const weight of state.weights) {
    if (
      !isCalendarDate(weight?.date) ||
      !Number.isFinite(weight.value) ||
      weight.value < 30 ||
      weight.value > 250
    )
      throw new Error('体重记录无效');
  }
  if (new Set(state.weights.map((item) => item.date)).size !== state.weights.length)
    throw new Error('体重日期重复');
  for (const item of state.history) {
    validateProfile(item?.profile);
    if (item.editablePlan !== undefined) validateEditablePlan(item.editablePlan);
    if (item.planOverrides !== undefined)
      createPlan(item.profile, item.adjusted, item.planOverrides);
    if (
      !Number.isInteger(item.version) ||
      item.version < 1 ||
      typeof item.adjusted !== 'boolean' ||
      typeof item.reason !== 'string'
    )
      throw new Error('计划历史无效');
  }
  return state;
}

export function initialState() {
  return {
    ...createDefaultState(),
    schemaVersion: 2,
    workouts: /** @type {import('./workouts.js').Workout[]} */ ([]),
  };
}

/** 去掉重复的计算字段logs，确保导出与存储只有一份真实训练数据。 */
export function serializeState(state) {
  validateState(state);
  const copy = structuredClone(state);
  delete copy.logs;
  return JSON.stringify(copy);
}

/** 写入后读回校验；失败时恢复原值。storage由调用方传入，测试可模拟容量不足。 */
export function persistState(storage, state, expectedRaw) {
  const before = storage.getItem(STORAGE_KEY);
  if (expectedRaw !== undefined && before !== expectedRaw)
    throw new Error('另一页面修改了记录，请刷新后再操作');
  const raw = serializeState(state);
  try {
    storage.setItem(STORAGE_KEY, raw);
    const saved = storage.getItem(STORAGE_KEY);
    if (saved !== raw) throw new Error('记录写入后核对失败');
    validateState(JSON.parse(saved));
    return raw;
  } catch (error) {
    try {
      if (before === null) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, before);
    } catch {
      /* 存储不可用时也保留页面上的原状态，不伪装成功。 */
    }
    throw error;
  }
}

export function loadState(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw !== null) return { state: validateState(JSON.parse(raw)), raw, migrated: false };
  const legacyRaw = storage.getItem(LEGACY_KEY);
  if (legacyRaw === null) return { state: initialState(), raw: null, migrated: false };
  const legacy = JSON.parse(legacyRaw);
  const { logs, ...metadata } = legacy;
  const state = { ...metadata, ...migrateLegacyLogs(logs) };
  state.history ??= [];
  validateState(state);
  return { state, raw: persistState(storage, state, null), migrated: true };
}

export function parseBackup(text) {
  if (text.length > 5 * 1024 * 1024) throw new Error('备份超过5 MB');
  const backup = JSON.parse(text);
  if (backup?.format !== 'lianxu-backup' || backup.version !== 2)
    throw new Error('不是支持的练序v0.2备份');
  return validateState(backup.state);
}

/** 按ID合并训练。相同内容跳过，同ID不同内容拒绝；合并不覆盖当前资料与体重。 */
export function mergeBackup(current, incoming) {
  validateState(current);
  validateState(incoming);
  const next = structuredClone(current);
  let skipped = 0;
  // 深层排序用于判断内容相同，不能因JSON字段顺序不同制造冲突。
  const stable = (value) =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, stable(value[key])]),
          )
        : value;
  for (const workout of incoming.workouts) {
    const existing = next.workouts.find((item) => item.id === workout.id);
    if (!existing) next.workouts.push(structuredClone(workout));
    else if (JSON.stringify(stable(existing)) === JSON.stringify(stable(workout))) skipped += 1;
    else throw new Error('存在同ID不同内容的训练，请选择完整恢复或另存备份');
  }
  validateState(next);
  return { state: next, added: next.workouts.length - current.workouts.length, skipped };
}
