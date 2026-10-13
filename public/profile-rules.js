import { PLAN_SLOTS, findBuiltinExercise } from './exercise-catalog.js';

/** 个人训练条件的选项与筛选规则；自动排课只使用已整理的模板动作。 */
export const EQUIPMENT_OPTIONS = [
  ['bodyweight', '自重 / 地垫'],
  ['dumbbells', '哑铃'],
  ['barbell', '杠铃'],
  ['bands', '弹力带'],
  ['chestMachine', '推胸器械'],
  ['rowMachine', '划船器械'],
  ['latPulldown', '高位下拉器械'],
  ['legPress', '腿举器械'],
  ['legCurl', '腿弯举器械'],
];
export const PATTERN_OPTIONS = [
  ['squat', '蹲类动作'],
  ['hinge', '髋铰链 / 硬拉类'],
  ['push', '推类动作'],
  ['pull', '拉类动作'],
  ['shoulder', '肩部抬举 / 推举'],
  ['core', '核心支撑类'],
  ['glute', '臀桥类'],
  ['kneeFlexion', '腿弯举类'],
];
export const PREFERENCE_OPTIONS = [
  ['any', '无偏好，优先沿用模板'],
  ['machines', '优先器械'],
  ['freeweights', '优先自由重量'],
  ['bodyweight', '优先自重'],
];
export const SESSION_MINUTES = [20, 30, 45, 60, 90]; // 单次可用时间，单位分钟。

/** 旧资料缺少新字段时按旧模板设备推定显示值；不修改读入对象或历史快照。 */
export function trainingPreferences(profile) {
  return {
    availableEquipment:
      profile.availableEquipment ??
      (profile.equipment === 'home'
        ? ['bodyweight', 'dumbbells']
        : [
            'bodyweight',
            'dumbbells',
            'barbell',
            'chestMachine',
            'rowMachine',
            'latPulldown',
            'legPress',
            'legCurl',
          ]),
    sessionMinutes: profile.sessionMinutes ?? 60,
    movementPreference: profile.movementPreference ?? 'any',
    excludedPatterns: profile.excludedPatterns ?? [],
    restrictionNotes: profile.restrictionNotes ?? '', // 仅保存的用户备注，不用于医疗判断或文本推断。
  };
}

/** 新字段可缺省以兼容v0.1/v0.2；一旦提供，必须是受支持的明确值。 */
export function validateTrainingPreferences(profile) {
  for (const [key, options] of [
    ['availableEquipment', EQUIPMENT_OPTIONS],
    ['excludedPatterns', PATTERN_OPTIONS],
  ]) {
    if (profile[key] === undefined) continue;
    const values = profile[key];
    if (
      !Array.isArray(values) ||
      values.length > options.length ||
      new Set(values).size !== values.length ||
      values.some((value) => !options.some(([id]) => id === value))
    )
      throw new Error(key === 'availableEquipment' ? '可用设备清单无效' : '动作限制清单无效');
  }
  if (profile.sessionMinutes !== undefined && !SESSION_MINUTES.includes(profile.sessionMinutes))
    throw new Error('单次训练时长无效');
  if (
    profile.movementPreference !== undefined &&
    !PREFERENCE_OPTIONS.some(([id]) => id === profile.movementPreference)
  )
    throw new Error('动作偏好无效');
  if (
    profile.restrictionNotes !== undefined &&
    (typeof profile.restrictionNotes !== 'string' || profile.restrictionNotes.length > 1000)
  )
    throw new Error('补充备注须为1000字以内的文字');
}

// 从统一目录读取筛选字段，避免设备、名称和动作标签在不同模块中各自维护。
const candidates = Object.fromEntries(
  Object.entries(PLAN_SLOTS).map(([slot, ids]) => [
    slot,
    ids.map((id) => {
      const item = findBuiltinExercise(`lianxu:${id}`);
      return [item.name, item.device, item.category, item.patterns];
    }),
  ]),
);
const slotLabels = {
  squat: '蹲类',
  push: '水平推',
  row: '水平拉',
  hinge: '髋铰链',
  overhead: '肩部推举',
  shoulder: '肩部抬举',
  glute: '臀桥',
  curl: '腿弯举',
  verticalPull: '垂直拉',
  core: '核心支撑',
};
const gymDefaults = { squat: '腿举', push: '器械推胸', row: '坐姿划船', hinge: '罗马尼亚硬拉' };

/**
 * 按明确条件选择动作。优先级：限制与设备 > 用户偏好 > 原模板；不能匹配时保留缺项说明。
 * @param {object} profile 已校验的个人资料。
 * @param {string[]} slots 当天模板的动作位置。
 * @param {number} sets 每个动作的演示组数。
 * @returns {{exercises: string[], notes: string[], estimatedMinutes: number}} 筛选结果与粗略时长。
 */
export function selectExercises(profile, slots, sets) {
  const prefs = trainingPreferences(profile);
  const exercises = [],
    notes = [];
  for (const slot of slots) {
    const available = candidates[slot].filter(([, device]) =>
      prefs.availableEquipment.includes(device),
    );
    const unrestricted = available.filter(
      ([, , , tags]) => !tags.some((tag) => prefs.excludedPatterns.includes(tag)),
    );
    const eligible = unrestricted.filter(([name]) => !exercises.includes(name));
    const score = ([name, , category]) =>
      (prefs.movementPreference !== 'any' && category === prefs.movementPreference ? 10 : 0) +
      (profile.equipment === 'gym' && gymDefaults[slot] === name ? 1 : 0);
    const best = eligible.toSorted((a, b) => score(b) - score(a))[0];
    if (best) exercises.push(best[0]);
    else {
      const reason = !available.length
        ? '当前设备清单没有匹配动作'
        : !unrestricted.length
          ? '已选择暂不安排这类动作'
          : '候选动作已在当天安排';
      notes.push(`${slotLabels[slot]}未安排：${reason}。`);
    }
  }
  // 粗略预算为热身5分钟 + 每组3分钟（含休息），不是实际计时或保证完成时长。
  const maxExercises = Math.max(1, Math.floor((prefs.sessionMinutes - 5) / (sets * 3)));
  if (exercises.length > maxExercises) {
    notes.push(
      `按${prefs.sessionMinutes}分钟预算保留前${maxExercises}个动作；未覆盖全部模板，请增加时长或调整条件。`,
    );
    exercises.splice(maxExercises);
  }
  if (!exercises.length) notes.push('当前条件没有可安排动作，请修改资料后再开始新训练。');
  return {
    exercises,
    notes,
    estimatedMinutes: exercises.length ? 5 + exercises.length * sets * 3 : 0,
  };
}
