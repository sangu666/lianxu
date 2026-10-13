import { PLAN_INDEX } from './data/plan-index.js';
import { BUILTIN_EXERCISES, DEVICE_LABELS, exerciseDisplayName } from './exercise-catalog.js';
import { createPlan, advanceVersion } from './core.js';
import { trainingPreferences } from './profile-rules.js';
import { validatePrescription } from './plan-actions.js';

/** 轻量目录供计划验证与全库选择；教学步骤仍按需加载，社区记录单位须由用户明确选择。 */
export const PLAN_CATALOG = [
  ...BUILTIN_EXERCISES,
  ...PLAN_INDEX.map(([id, name, equipment, bodyPart, target]) => ({
    id,
    name,
    equipment,
    bodyPart,
    target,
    unit: 'unspecified',
    origin: 'community',
    stepsZh: [],
  })),
];
const index = new Map(PLAN_CATALOG.map((item) => [item.id, item])); // 按稳定ID查询，不按同名或近似译名合并。
/** 精确查找目录ID；未知编号返回undefined，由导入验证明确拒绝，不做近似匹配。 */
export const findPlanExercise = (id) => index.get(id);

/** 检查已保存的计划文档。旧状态缺少editablePlan时不调用，不向旧对象补默认字段。 */
export function validateEditablePlan(plan) {
  if (
    !plan ||
    !['manual', 'ai-draft'].includes(plan.origin) ||
    typeof plan.title !== 'string' ||
    !plan.title.trim() ||
    plan.title.length > 120 ||
    !Array.isArray(plan.days) ||
    !plan.days.length ||
    plan.days.length > 7
  )
    throw new Error('计划标题、来源或训练日无效（支持1–7天）');
  for (const [dayIndex, day] of plan.days.entries()) {
    if (
      !day ||
      typeof day.name !== 'string' ||
      !day.name.trim() ||
      day.name.length > 120 ||
      !Array.isArray(day.actions) ||
      !day.actions.length ||
      day.actions.length > 20
    )
      throw new Error(`第${dayIndex + 1}天须有名称和1–20个动作`);
    const seen = new Set();
    for (const action of day.actions) {
      const item = findPlanExercise(action?.exerciseId);
      if (!item) throw new Error(`未知动作编号：${String(action?.exerciseId).slice(0, 160)}`);
      if (seen.has(item.id)) throw new Error(`${day.name}存在重复动作：${item.name}`);
      seen.add(item.id);
      if (
        typeof action.name !== 'string' ||
        !action.name.trim() ||
        action.name.length > 120 ||
        typeof action.acknowledged !== 'boolean'
      )
        throw new Error('动作名称或确认标记无效');
      validatePrescription(action, action.unit);
      if (item.unit !== 'unspecified' && action.unit !== item.unit)
        throw new Error(`${item.name}须使用${item.unit === 'seconds' ? '秒数' : '次数'}单位`);
    }
  }
  return plan;
}

/** 读取外部JSON草稿，只接受明确动作ID；标题等外部文本由页面转义，无网络请求。 */
export function parsePlanDraft(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 256 * 1024)
    throw new Error('计划草稿超过256 KB');
  let draft;
  try {
    draft = JSON.parse(text);
  } catch {
    throw new Error('草稿不是有效JSON，请检查括号和逗号');
  }
  if (draft?.format !== 'lianxu-plan-draft' || draft.version !== 1 || !Array.isArray(draft.days))
    throw new Error('请选择练序计划草稿格式，version为1');
  const plan = {
    title: draft.title,
    origin: draft.origin,
    days: draft.days.map((day) => ({
      name: day?.name,
      actions: Array.isArray(day?.actions)
        ? day.actions.map((action) => ({
            exerciseId: action?.exerciseId,
            name: exerciseDisplayName(findPlanExercise(action?.exerciseId) ?? { name: '' }),
            unit: action?.unit,
            sets: action?.sets,
            targetMin: action?.targetMin,
            targetMax: action?.targetMax,
            restSeconds: action?.restSeconds,
            reason: action?.reason ?? '',
            acknowledged: false,
          }))
        : null,
    })),
  };
  validateEditablePlan(plan);
  return plan;
}

/** 只生成提醒，不限制用户跨类型选动作。资料限制、设备、社区单位及频率差异需显式确认。 */
export function planWarnings(plan, profile) {
  const prefs = trainingPreferences(profile),
    warnings = [];
  if (plan.days.length !== profile.days)
    warnings.push(
      `计划有${plan.days.length}个训练日，资料中填写${profile.days}次/周，请核对排期。`,
    );
  const deviceMap = {
    'body weight': 'bodyweight',
    dumbbell: 'dumbbells',
    barbell: 'barbell',
    band: 'bands',
    'resistance band': 'bands',
  };
  for (const day of plan.days)
    for (const action of day.actions) {
      const item = findPlanExercise(action.exerciseId),
        prefix = `${day.name} · ${action.name}`;
      const device = item.device ?? deviceMap[item.equipment];
      if (!device || !prefs.availableEquipment.includes(device))
        warnings.push(
          `${prefix}：请确认能使用${DEVICE_LABELS[item.equipment] ?? item.equipment}及所需支撑。`,
        );
      if (item.patterns?.some((tag) => prefs.excludedPatterns.includes(tag)))
        warnings.push(`${prefix}：属于你暂不安排的动作类型。`);
      if (item.origin === 'community')
        warnings.push(
          `${prefix}：社区资料未标注记录单位，当前${action.unit === 'seconds' ? '选择秒数' : action.unit === 'reps' ? '选择次数' : '尚未选择单位'}，请核对；设备标签可能不完整${prefs.excludedPatterns.length ? '，暂不能自动核对你的动作限制' : ''}。`,
        );
    }
  return [...new Set(warnings)];
}

/** 同一页面统一取得当前计划，模板转换只是计算值，不在读取时写入存储。 */
export function activePlanDays(state) {
  if (state.editablePlan) {
    validateEditablePlan(state.editablePlan);
    return structuredClone(state.editablePlan.days).map((day) => ({
      ...day,
      exercises: day.actions.map((action) => action.name),
      notes: ['逐动作确认的计划；时长按目标和休息粗估，不保证实际完成时间。'],
      estimatedMinutes: Math.ceil(
        (300 +
          day.actions.reduce(
            (sum, action) =>
              sum +
              action.sets *
                ((action.unit === 'seconds' ? action.targetMax : action.targetMax * 3) +
                  action.restSeconds),
            0,
          )) /
          60,
      ),
    }));
  }
  return createPlan(state.profile, state.adjusted, state.planOverrides).map((day) => ({
    ...day,
    actions: day.exercises.map((name) => {
      const item = BUILTIN_EXERCISES.find((entry) => entry.name === name);
      const [targetMin, targetMax] =
        item.unit === 'seconds' ? [20, 30] : day.reps.split('–').map(Number);
      return {
        exerciseId: item.id,
        name,
        unit: item.unit,
        sets: day.sets,
        targetMin,
        targetMax,
        restSeconds: 90,
        reason: '规则模板演示',
        acknowledged: false,
      };
    }),
  }));
}

/** 把确认后的草稿存为新版本；保存由调用方负责，训练记录及旧历史保持原样。 */
export function acceptEditablePlan(
  state,
  plan,
  { expectedVersion = state.version, acknowledge = false, reason = '确认计划草稿' } = {},
) {
  if (state.version !== expectedVersion) throw new Error('计划已变化，请重新检查草稿');
  validateEditablePlan(plan);
  const warnings = planWarnings(plan, state.profile);
  if (warnings.length && !acknowledge) throw new Error('请先勾选已核对设备、单位和训练条件提醒');
  const copy = structuredClone(plan);
  for (const day of copy.days) for (const action of day.actions) action.acknowledged = acknowledge;
  const next = advanceVersion(state, state.profile, false, reason);
  next.editablePlan = copy;
  next.history.at(-1).editablePlan = structuredClone(copy);
  return next;
}

/** 从当前计划生成标准草稿，可下载交给外部AI编辑；不包含身体资料、照片或训练成绩。 */
export function draftFromState(state) {
  return {
    format: 'lianxu-plan-draft',
    version: 1,
    title: state.editablePlan?.title ?? '我的训练计划',
    origin: state.editablePlan?.origin ?? 'manual',
    days: activePlanDays(state).map(({ name, actions }) => ({
      name,
      actions: actions.map(
        ({ exerciseId, unit, sets, targetMin, targetMax, restSeconds, reason }) => ({
          exerciseId,
          unit,
          sets,
          targetMin,
          targetMax,
          restSeconds,
          reason,
        }),
      ),
    })),
  };
}
