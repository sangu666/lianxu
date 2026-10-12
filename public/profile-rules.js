/** 个人训练条件的选项与最小筛选规则；动作教学和完整动作库留待下一阶段。 */
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

// 每项为[名称, 必需设备, 偏好类别, 限制标签]；标签用于筛选，不代表医学禁忌分类。
const candidates = {
  squat: [
    ['高脚杯深蹲', 'dumbbells', 'freeweights', ['squat']],
    ['腿举', 'legPress', 'machines', ['squat']],
    ['自重深蹲', 'bodyweight', 'bodyweight', ['squat']],
  ],
  push: [
    ['哑铃地板卧推', 'dumbbells', 'freeweights', ['push']],
    ['器械推胸', 'chestMachine', 'machines', ['push']],
    ['靠墙俯卧撑', 'bodyweight', 'bodyweight', ['push']],
  ],
  row: [
    ['单臂哑铃划船', 'dumbbells', 'freeweights', ['pull']],
    ['坐姿划船', 'rowMachine', 'machines', ['pull']],
    ['坐姿弹力带划船', 'bands', 'bands', ['pull']],
  ],
  hinge: [
    ['哑铃罗马尼亚硬拉', 'dumbbells', 'freeweights', ['hinge']],
    ['罗马尼亚硬拉', 'barbell', 'freeweights', ['hinge']],
    ['自重髋铰链练习', 'bodyweight', 'bodyweight', ['hinge']],
  ],
  overhead: [['站姿哑铃推举', 'dumbbells', 'freeweights', ['push', 'shoulder']]],
  shoulder: [['哑铃侧平举', 'dumbbells', 'freeweights', ['shoulder']]],
  glute: [['自重臀桥', 'bodyweight', 'bodyweight', ['glute']]],
  curl: [['腿弯举', 'legCurl', 'machines', ['kneeFlexion']]],
  verticalPull: [
    ['高位下拉', 'latPulldown', 'machines', ['pull']],
    ['坐姿弹力带划船', 'bands', 'bands', ['pull']],
    ['单臂哑铃划船', 'dumbbells', 'freeweights', ['pull']],
  ],
  core: [['平板支撑', 'bodyweight', 'bodyweight', ['core']]],
};
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
