import { findBuiltinExercise, DEVICE_LABELS } from './exercise-catalog.js';
import { trainingPreferences, PREFERENCE_OPTIONS } from './profile-rules.js';

// 明确维护同类动作关系，不根据名称相似或肌群相同就判定可替代。
// 垂直拉、推举、臀桥、腿弯举和计时支撑暂没有同类候选，不能随意改成划船或深蹲。
const groups = [
  { label: '蹲类', ids: ['goblet-squat', 'leg-press', 'bodyweight-squat'] },
  { label: '水平推', ids: ['dumbbell-floor-press', 'machine-chest-press', 'wall-push-up'] },
  { label: '水平拉', ids: ['one-arm-dumbbell-row', 'seated-row', 'seated-band-row'] },
  { label: '髋铰链', ids: ['dumbbell-rdl', 'barbell-rdl', 'hip-hinge'] },
];

/** 查询明确替代关系，逐项解释不满足的条件。偏好只排序，不能越过设备与限制。
 * @param {object} profile 当前个人资料。
 * @param {string} currentId 当前动作库稳定ID。
 * @param {string[]} dayNames 当天动作名称，用于防止重复安排。
 * @returns {{options: object[], unavailable: object[], message: string}} 可选项与拒绝理由。
 */
export function replacementOptions(profile, currentId, dayNames) {
  const source = findBuiltinExercise(currentId);
  const group = groups.find((item) => item.ids.some((id) => `lianxu:${id}` === source?.id));
  if (!group)
    return {
      options: [],
      unavailable: [],
      message: '这个动作暂未整理同类替代关系。请保留原动作，或回到资料页调整训练条件。',
    };
  const prefs = trainingPreferences(profile);
  const options = [],
    unavailable = [];
  for (const shortId of group.ids) {
    const item = findBuiltinExercise(`lianxu:${shortId}`);
    if (item.id === source.id) continue;
    const reasons = [];
    if (!prefs.availableEquipment.includes(item.device))
      reasons.push(`未勾选${DEVICE_LABELS[item.device]}设备`);
    if (item.patterns.some((tag) => prefs.excludedPatterns.includes(tag)))
      reasons.push('属于你暂不安排的动作类型');
    if (dayNames.includes(item.name)) reasons.push('当天已有这个动作');
    if (item.unit !== source.unit) reasons.push('记录单位不同');
    if (reasons.length) unavailable.push({ name: item.name, reasons });
    else {
      const preferred =
        prefs.movementPreference !== 'any' && prefs.movementPreference === item.category;
      options.push({
        ...item,
        preferred,
        reason: `同属${group.label}，已满足当前设备与动作限制；记录单位保持次数。${preferred ? `符合“${PREFERENCE_OPTIONS.find(([id]) => id === prefs.movementPreference)[1]}”偏好。` : ''}动作难度与负重不能视为相同，请重新确认起始重量。`,
      });
    }
  }
  options.sort((a, b) => Number(b.preferred) - Number(a.preferred));
  return {
    options,
    unavailable,
    message: options.length
      ? '仅影响这个训练日的新计划，组数和次数目标保持不变。'
      : '当前设备、限制或当天安排下，没有合适的替代动作。请修改资料后再查看。',
  };
}

/** 校验并应用手动替换清单。计划是刚生成的独立对象，不修改传入资料或历史快照。
 * @param {object} profile 这份计划对应的资料快照。
 * @param {object[]} days 规则生成的训练日列表。
 * @param {{dayIndex:number,fromId:string,toId:string}[]} overrides 替换项；缺省兼容旧备份。
 */
export function applyPlanOverrides(profile, days, overrides = []) {
  if (!Array.isArray(overrides) || overrides.length > 16) throw new Error('动作替换清单无效');
  const seen = new Set();
  for (const entry of overrides) {
    if (
      !entry ||
      !Number.isInteger(entry.dayIndex) ||
      !days[entry.dayIndex] ||
      typeof entry.fromId !== 'string' ||
      typeof entry.toId !== 'string'
    )
      throw new Error('动作替换字段无效');
    const key = `${entry.dayIndex}:${entry.fromId}`;
    if (seen.has(key)) throw new Error('动作替换项重复');
    seen.add(key);
    const day = days[entry.dayIndex];
    const source = findBuiltinExercise(entry.fromId);
    const index = source ? day.exercises.indexOf(source.name) : -1;
    if (index < 0) throw new Error('替换的原动作不在基础计划中');
    const candidate = replacementOptions(profile, entry.fromId, day.exercises).options.find(
      (item) => item.id === entry.toId,
    );
    if (!candidate) throw new Error('替代动作不满足设备、限制或同类关系');
    day.exercises[index] = candidate.name;
    day.notes.push(`手动替换：${source.name} → ${candidate.name}。${candidate.reason}`);
  }
  return days;
}
