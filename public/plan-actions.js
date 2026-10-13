/** 校验计划目标，而非实际完成组。次数/秒数与训练记录使用相同上限，避免创建无法记录的目标。
 * @param {object} action 组数、目标下上限、休息秒数和说明。
 * @param {'reps'|'seconds'} unit 明确的记录单位，不接受未知单位。
 */
export function validatePrescription(action, unit) {
  if (!action || !['reps', 'seconds'].includes(unit)) throw new Error('请选择次数或秒数单位');
  const limit = unit === 'seconds' ? 3600 : 100;
  for (const [key, min, max] of [
    ['sets', 1, 10],
    ['targetMin', 1, limit],
    ['targetMax', 1, limit],
    ['restSeconds', 0, 600],
  ]) {
    if (!Number.isInteger(action[key]) || action[key] < min || action[key] > max)
      throw new Error(`计划目标无效：${key}（${min}–${max}）`);
  }
  if (action.targetMin > action.targetMax) throw new Error('目标下限不能大于上限');
  if (typeof action.reason !== 'string' || action.reason.length > 1000)
    throw new Error('动作说明须为1000字以内文字');
  return action;
}
