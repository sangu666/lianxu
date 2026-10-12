import { validateTrainingPreferences, selectExercises } from './profile-rules.js';

/** 原型核心规则：管理资料、规则模板和版本快照。训练数值是演示，尚未验证为个人处方。 */
/** 每次返回独立的初始对象；以下身高体重都是虚构示例，不是用户资料。 */
export function createDefaultState() {
  return {
    profile: {
      height: 175, // 身高，单位cm。
      weight: 75, // 体重，单位kg。
      age: 28, // 年龄，单位岁；原型只覆盖成年人。
      experience: 'beginner', // beginner新手；experienced有持续训练经验。
      equipment: 'home', // home哑铃居家；gym健身房。
      days: 3, // 每周计划训练次数，当前支持3或4次。
      goal: 'habit', // habit习惯；fatloss减脂；muscle增肌，当前只记录目标。
    },
    logs: [], // v0.1每组记录列表；新版训练结构定义在workouts.js，尚未接入界面。
    weights: [], // 体重记录，每项为{ date: 日期, value: kg数值 }。
    version: 1, // 当前计划版本号，不是数据格式或软件版本。
    adjusted: false, // 是否接受了减量演示。
    history: [
      // 历次计划的资料快照，用于解释当时的安排。
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

/** 检查资料是否处于原型支持的范围；profile是基础资料对象。 */
export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new Error('缺少资料');
  // key字段名、min最小值、max最大值，用同一段检查处理三个数值字段。
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
  validateTrainingPreferences(profile);
  return profile;
}

/**
 * input是浏览器读回的v0.1数据；校验通过后深复制，避免共享可变对象。
 * 旧版损坏时回到示例状态。这种回退不用于新版迁移，新版遇到坏数据会明确报错。
 */
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
    const state = structuredClone(input); // 校验后的独立副本，不直接修改读入对象。
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

/** 根据经验、频率、具体设备、时间和动作限制筛选规则模板；adjusted表示演示减量。 */
export function createPlan(profile, adjusted = false) {
  validateProfile(profile);
  const home = profile.equipment === 'home'; // 是否使用居家动作清单。
  const novice = profile.experience === 'beginner'; // 是否采用新手组次。
  // names是训练日名称，upper/lower分别是上肢和下肢的备选动作。
  const names =
    profile.days === 3 ? ['全身 A', '全身 B', '全身 C'] : ['上肢 A', '下肢 A', '上肢 B', '下肢 B'];
  const sets = Math.max(1, (novice ? 2 : 3) - (adjusted ? 1 : 0)); // 每动作组数，最低保留1组。
  return names.map((name, index) => ({
    name,
    ...selectExercises(
      profile,
      profile.days === 3
        ? ['squat', 'push', 'row', 'hinge']
        : index % 2 === 0
          ? ['push', 'row', home ? 'overhead' : 'verticalPull', 'shoulder']
          : ['squat', 'hinge', home ? 'glute' : 'curl', 'core'],
      sets,
    ),
    sets,
    reps: novice ? '8–12' : '6–12',
  }));
}

/** fatigue是恢复反馈：tired明显疲劳，good恢复良好；疼痛记录优先阻止自动调整。 */
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

/** 用新资料建立下一版计划；保留原组记录和历史，不把旧数据改成新版本。 */
export function advanceVersion(state, profile, adjusted, reason) {
  validateProfile(profile);
  if (typeof adjusted !== 'boolean' || typeof reason !== 'string') throw new Error('无效版本');
  const next = structuredClone(state); // next是新状态；原state保持不变，便于比较和测试。
  next.profile = structuredClone(profile);
  next.adjusted = adjusted;
  next.version += 1;
  next.history ??= [];
  next.history.push({ version: next.version, profile: structuredClone(profile), adjusted, reason });
  return next;
}
