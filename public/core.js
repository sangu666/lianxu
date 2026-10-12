/** Pure, deterministic prototype rules. These templates are not validated prescriptions. */
export function createDefaultState() {
  return {
    profile: {
      height: 175,
      weight: 75,
      age: 28,
      experience: 'beginner',
      equipment: 'home',
      days: 3,
      goal: 'habit',
    },
    logs: [],
    weights: [],
    version: 1,
    adjusted: false,
    history: [
      {
        version: 1,
        reason: '虚构示例资料',
        profile: {
          height: 175,
          weight: 75,
          age: 28,
          experience: 'beginner',
          equipment: 'home',
          days: 3,
          goal: 'habit',
        },
        adjusted: false,
      },
    ],
  };
}

export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new Error('缺少资料');
  for (const [key, min, max] of [
    ['age', 18, 100],
    ['height', 100, 230],
    ['weight', 30, 250],
  ]) {
    if (
      typeof profile[key] !== 'number' ||
      !Number.isFinite(profile[key]) ||
      profile[key] < min ||
      profile[key] > max
    )
      throw new Error(`资料字段无效：${key}`);
  }
  if (!Number.isInteger(profile.age) || ![3, 4].includes(profile.days))
    throw new Error('年龄或训练频率无效');
  if (!['beginner', 'experienced'].includes(profile.experience)) throw new Error('训练经验无效');
  if (!['home', 'gym'].includes(profile.equipment)) throw new Error('设备类型无效');
  if (!['habit', 'fatloss', 'muscle'].includes(profile.goal)) throw new Error('目标无效');
  return profile;
}

export function normalizeState(input) {
  try {
    validateProfile(input?.profile);
    if (
      !Array.isArray(input.logs) ||
      !Array.isArray(input.weights) ||
      !Number.isInteger(input.version) ||
      input.version < 1 ||
      typeof input.adjusted !== 'boolean'
    )
      throw new Error('无效记录');
    for (const log of input.logs) {
      if (
        typeof log.exercise !== 'string' ||
        log.exercise.length > 120 ||
        !Number.isFinite(log.load) ||
        log.load < 0 ||
        log.load > 400 ||
        !Number.isInteger(log.reps) ||
        log.reps < 1 ||
        log.reps > 100 ||
        ![0, 1, 2, 3].includes(log.rir) ||
        typeof log.pain !== 'boolean' ||
        typeof log.date !== 'string' ||
        !Number.isInteger(log.version)
      )
        throw new Error('无效训练组');
    }
    for (const weight of input.weights) {
      if (
        !Number.isFinite(weight.value) ||
        weight.value < 30 ||
        weight.value > 250 ||
        typeof weight.date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(weight.date)
      )
        throw new Error('无效体重');
    }
    const state = structuredClone(input);
    if (!Array.isArray(state.history)) state.history = [];
    state.history = state.history.filter((item) => {
      try {
        validateProfile(item.profile);
        return (
          Number.isInteger(item.version) &&
          typeof item.adjusted === 'boolean' &&
          typeof item.reason === 'string'
        );
      } catch {
        return false;
      }
    });
    return state;
  } catch {
    return createDefaultState();
  }
}

export function createPlan(profile, adjusted = false) {
  validateProfile(profile);
  const home = profile.equipment === 'home';
  const novice = profile.experience === 'beginner';
  const names =
    profile.days === 3 ? ['全身 A', '全身 B', '全身 C'] : ['上肢 A', '下肢 A', '上肢 B', '下肢 B'];
  const upper = home
    ? ['哑铃地板卧推', '单臂哑铃划船', '站姿哑铃推举', '哑铃侧平举']
    : ['器械推胸', '坐姿划船', '高位下拉', '哑铃侧平举'];
  const lower = home
    ? ['高脚杯深蹲', '哑铃罗马尼亚硬拉', '自重臀桥', '平板支撑']
    : ['腿举', '罗马尼亚硬拉', '腿弯举', '平板支撑'];
  const sets = Math.max(1, (novice ? 2 : 3) - (adjusted ? 1 : 0));
  return names.map((name, index) => ({
    name,
    exercises:
      profile.days === 3
        ? [lower[0], upper[0], upper[1], lower[1]]
        : index % 2 === 0
          ? [...upper]
          : [...lower],
    sets,
    reps: novice ? '8–12' : '6–12',
  }));
}

export function createReview(state, fatigue) {
  if (state.logs.some((log) => log.pain))
    return { kind: 'blocked', reason: '存在疼痛反馈，暂停自动训练调整' };
  if (fatigue === 'tired' && !state.adjusted)
    return {
      kind: 'deload',
      before: createPlan(state.profile)[0].sets,
      after: createPlan(state.profile, true)[0].sets,
    };
  return { kind: 'maintain' };
}

export function advanceVersion(state, profile, adjusted, reason) {
  validateProfile(profile);
  if (typeof adjusted !== 'boolean' || typeof reason !== 'string') throw new Error('无效版本');
  const next = structuredClone(state);
  next.profile = structuredClone(profile);
  next.adjusted = adjusted;
  next.version += 1;
  next.history ??= [];
  next.history.push({ version: next.version, profile: structuredClone(profile), adjusted, reason });
  return next;
}
