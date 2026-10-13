import { canonicalExerciseId, findBuiltinExercise } from './exercise-catalog.js';
import { validatePrescription } from './plan-actions.js';

/**
 * v0.2训练数据模块：创建、校验、迁移记录，不负责页面显示或浏览器存储。
 * 输入有问题时抛出错误，避免把坏记录悄悄变成空列表。
 */
// 数据格式版本号，和计划版本planVersion不同：前者决定如何读数据，后者标记用了哪份计划。
export const WORKOUT_SCHEMA_VERSION = 2;

/**
 * 一组训练的数据。VS Code悬停字段时可以看到这些说明。
 * @typedef {Object} WorkoutSet
 * @property {string} id 训练组唯一ID。
 * @property {number} load 负重，单位kg。
 * @property {number} value 实际次数或秒数，由所属动作的unit决定。
 * @property {number} rir 估计剩余次数，0/1/2/3，3代表3次及以上。
 * @property {boolean} pain 是否报告疼痛或不适。
 */

/**
 * 一次训练中的动作实例。
 * @typedef {Object} WorkoutExercise
 * @property {{sets: number, targetMin: number, targetMax: number, restSeconds: number, reason: string}} [prescription] 开始训练时复制的目标快照；实际成绩仍存入 sets。
 * @property {string} id 本次动作实例ID，用于定位编辑。
 * @property {string} exerciseId 跨训练比较用的动作标识，不是本次实例ID。
 * @property {string} name 记录当时的动作名称。
 * @property {'reps'|'seconds'} unit value的单位：次数或秒数。
 * @property {WorkoutSet[]} sets 实际完成的组列表，空数组表示还没有记录组。
 */

/**
 * 一次训练的完整记录。
 * @typedef {Object} Workout
 * @property {number} [revision] 数据库训练修改版本，用于拒绝旧页面覆盖；原浏览器记录没有此字段。
 * @property {string} id 本次训练唯一ID。
 * @property {string} date 本地训练日期，格式YYYY-MM-DD。
 * @property {number} planVersion 当时采用的计划版本。
 * @property {string} planName 当时的计划名称。
 * @property {'active'|'completed'} status 进行中或已完成。
 * @property {string|null} startedAt ISO UTC开始时间；旧版归档为null。
 * @property {string|null} completedAt ISO UTC结束时间；未完成或旧版归档为null。
 * @property {string} notes 用户备注或迁移局限说明。
 * @property {'manual'|'legacy'} origin 用户新建或旧数据归档。
 * @property {WorkoutExercise[]} exercises 本次训练中的动作列表。
 */

/** condition是需要满足的条件；不满足时把message作为错误说明交给调用方。 */
function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

/** 检查YYYY-MM-DD是真实日期，防止2026-02-30等字符串被当作有效记录。 */
export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // timestamp是距1970年起点的毫秒数；统一用UTC转换，避免本地时区改变日期。
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  // 转回原格式再比较：JavaScript可能把不存在的日期自动顺延到下个月。
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

/** 起止时间统一采用ISO UTC格式，例如2026-10-12T03:00:00.000Z。 */
function isTimestamp(value) {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

/** maxLength限制字符数；allowEmpty只为备注等可留空字段开放。 */
function isText(value, maxLength, allowEmpty = false) {
  return (
    typeof value === 'string' &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0)
  );
}

/** set是一组实际完成的数据；unit决定value表示次数还是秒数。 */
function validateSet(set, unit) {
  requireValue(set && typeof set === 'object', '训练组格式无效');
  requireValue(Number.isFinite(set.load) && set.load >= 0 && set.load <= 400, '负重无效');
  // 原型录入边界：计时动作最多3600秒，计次动作最多100次；不是推荐训练量。
  const maxValue = unit === 'seconds' ? 3600 : 100;
  requireValue(
    Number.isInteger(set.value) && set.value >= 1 && set.value <= maxValue,
    '次数或秒数无效',
  );
  requireValue([0, 1, 2, 3].includes(set.rir), 'RIR 无效');
  requireValue(typeof set.pain === 'boolean', '疼痛反馈无效');
}

/**
 * data格式：{ schemaVersion: 2, workouts: [训练对象, ...] }。
 * 校验成功返回原对象；失败抛错。不修改对象，不过滤或丢弃记录。
 */
export function validateWorkoutData(data) {
  requireValue(data?.schemaVersion === WORKOUT_SCHEMA_VERSION, '不支持的训练数据版本');
  requireValue(Array.isArray(data.workouts), '训练列表无效');
  requireValue(data.workouts.length <= 10000, '训练记录过多');
  // ids保存已经见过的ID。Set适合检查重复，覆盖训练、动作实例和训练组三层。
  const ids = new Set();
  // registerId是局部函数：统一检查ID格式与重复情况，避免三层分别写一套规则。
  const registerId = (id) => {
    requireValue(isText(id, 160) && !ids.has(id), '记录 ID 无效或重复');
    ids.add(id);
  };
  // activeCount统计尚未完成的训练，防止刷新后出现两份互相冲突的进行中记录。
  let activeCount = 0;
  for (const workout of data.workouts) {
    requireValue(workout && typeof workout === 'object', '训练格式无效');
    registerId(workout.id);
    requireValue(isCalendarDate(workout.date), '训练日期无效');
    requireValue(Number.isInteger(workout.planVersion) && workout.planVersion >= 1, '计划版本无效');
    requireValue(isText(workout.planName, 120), '计划名称无效');
    requireValue(['active', 'completed'].includes(workout.status), '训练状态无效');
    requireValue(['manual', 'legacy'].includes(workout.origin), '训练来源无效');
    requireValue(isText(workout.notes, 2000, true), '训练备注无效');
    requireValue(
      Array.isArray(workout.exercises) && workout.exercises.length <= 100,
      '动作列表无效',
    );
    // legacy是旧记录归档：没有可靠时间依据，所以必须保留null，不能补造时间。
    if (workout.origin === 'legacy') {
      requireValue(workout.status === 'completed', '旧版归档不能作为进行中的训练');
      requireValue(
        workout.startedAt === null && workout.completedAt === null,
        '旧版记录没有时间依据',
      );
    } else {
      requireValue(isTimestamp(workout.startedAt), '开始时间无效');
      if (workout.status === 'completed') {
        requireValue(isTimestamp(workout.completedAt), '结束时间无效');
        // 前面已统一ISO UTC格式，因此这里按字符串比较也能判断时间先后。
        requireValue(workout.completedAt >= workout.startedAt, '结束时间早于开始时间');
      } else {
        requireValue(workout.completedAt === null, '未完成的训练不能有结束时间');
      }
    }
    if (workout.status === 'active') activeCount += 1;
    for (const exercise of workout.exercises) {
      requireValue(exercise && typeof exercise === 'object', '动作格式无效');
      registerId(exercise.id);
      requireValue(isText(exercise.exerciseId, 160) && isText(exercise.name, 120), '动作标识无效');
      requireValue(['reps', 'seconds'].includes(exercise.unit), '动作单位无效');
      if (exercise.prescription !== undefined)
        validatePrescription(exercise.prescription, exercise.unit);
      requireValue(Array.isArray(exercise.sets) && exercise.sets.length <= 1000, '训练组列表无效');
      for (const set of exercise.sets) {
        validateSet(set, exercise.unit);
        registerId(set.id);
      }
    }
  }
  requireValue(activeCount <= 1, '同时只能有一次进行中的训练');
  return data;
}

/**
 * 创建一次进行中的训练。调用方提供时间和ID，同样的输入就有同样的结果，方便测试。
 * exercises是动作清单：id定位本次动作，exerciseId用于跨训练比较，name保留名称快照。
 * @param {Object} input 创建所需的数据，由调用方提供。
 * @param {string} input.id 本次训练唯一ID。
 * @param {string} input.date 用户所在地日期。
 * @param {string} input.startedAt ISO UTC开始时间。
 * @param {number} input.planVersion 当前计划版本。
 * @param {string} input.planName 当前计划名称。
 * @param {Array<Omit<WorkoutExercise, 'sets'>>} input.exercises 动作清单，不包含实际完成的组。
 * @returns {Workout} 校验通过的新训练记录。
 */
export function createWorkout({ id, date, startedAt, planVersion, planName, exercises }) {
  /** @type {Workout} */
  const workout = {
    id, // 本次训练的唯一标识；未来修改、删除都通过它定位。
    date, // 用户所在地的训练日期，格式YYYY-MM-DD。
    planVersion, // 训练开始时采用的计划版本，后续换计划不会改写它。
    planName, // 当时的计划名称，如“全身 A”。
    status: 'active', // active进行中；completed已完成。
    startedAt, // 实际开始时刻，采用ISO UTC格式。
    completedAt: null, // null表示还没有完成时间，不代表零点。
    notes: '', // 用户填写的训练备注，最多2000字符。
    origin: 'manual', // manual新建训练；legacy由旧版记录迁移。
    // 深复制动作清单，避免后续编辑影响原计划；新训练没有实际完成的组。
    exercises: exercises.map((exercise) => ({ ...structuredClone(exercise), sets: [] })),
  };
  validateWorkoutData({ schemaVersion: WORKOUT_SCHEMA_VERSION, workouts: [workout] });
  return workout;
}

/**
 * logs是v0.1的扁平组记录列表，一条log代表一组，不是一整次训练。
 * 原数据无法区分同日同版本的多次训练，只能按日期＋版本归档并明确标注局限。
 */
export function migrateLegacyLogs(logs) {
  requireValue(Array.isArray(logs), '旧版训练列表无效');
  // groups用归档键查找训练对象；Map保持首次出现的顺序，不会重新排列原始组。
  const groups = new Map();
  // index是旧组在原列表的位置，用它生成稳定ID；数值相同的两组仍保留两个ID。
  logs.forEach((log, index) => {
    requireValue(log && typeof log === 'object', '旧版训练组格式无效');
    requireValue(isCalendarDate(log.date), '旧版训练日期无效');
    requireValue(Number.isInteger(log.version) && log.version >= 1, '旧版计划版本无效');
    requireValue(isText(log.exercise, 120), '旧版动作名称无效');
    const key = `${log.date}-v${log.version}`; // 如2026-10-12-v1，不同计划版本分开归档。
    if (!groups.has(key)) {
      groups.set(key, {
        id: `legacy-workout-${key}`,
        date: log.date,
        planVersion: log.version,
        planName: '旧版训练归档',
        status: 'completed',
        startedAt: null,
        completedAt: null,
        notes: '按日期和计划版本归档；原始记录没有训练起止时间，同日多次训练可能合并。',
        origin: 'legacy',
        exercises: [],
      });
    }
    const workout = groups.get(key); // 当前旧组所属的训练归档。
    // 同一归档内找对应动作；exercise可能尚不存在，因此使用let以便下面赋值。
    let exercise = workout.exercises.find((item) => item.name === log.exercise);
    if (!exercise) {
      const exerciseIndex = workout.exercises.length; // 新动作在此归档中的位置，从0开始。
      exercise = {
        id: `${workout.id}-exercise-${exerciseIndex}`,
        // 暂用名称识别旧动作；有正式动作库后须明确映射，不能自动合并未知动作。
        exerciseId: `legacy-name:${log.exercise}`,
        name: log.exercise,
        unit: 'reps',
        sets: [],
      };
      workout.exercises.push(exercise);
    }
    exercise.sets.push({
      id: `legacy-set-${index}`,
      load: log.load, // 负重，单位kg；哑铃在旧界面按单只记录。
      value: log.reps, // 旧版只记录次数；新版用unit区分次数与秒数。
      rir: log.rir, // 估计还能完成的次数；3在本原型表示3次及以上。
      pain: log.pain, // true表示用户报告了疼痛或不适，不是医学诊断。
    });
  });
  // 把Map中的归档对象转成数组，便于JSON保存；所有旧组都处理完后再校验整体。
  const data = { schemaVersion: WORKOUT_SCHEMA_VERSION, workouts: [...groups.values()] };
  validateWorkoutData(data);
  return data;
}

/**
 * input可以是旧版{ logs: [...] }或新版数据集合。
 * 新版只校验并深复制，不再迁移，所以重复调用不会增加组或改变ID。
 * 拒绝未知未来版本，防止旧程序误读新格式。
 */
export function migrateWorkoutData(input) {
  requireValue(input && typeof input === 'object', '训练数据无效');
  if (input.schemaVersion === WORKOUT_SCHEMA_VERSION) {
    validateWorkoutData(input);
    return structuredClone(input);
  }
  requireValue(
    input.schemaVersion === undefined || input.schemaVersion === 1,
    '不支持的训练数据版本',
  );
  return migrateLegacyLogs(input.logs);
}

/** 每次修改先复制、再校验，原记录保持不变；UI保存成功后才采用返回值。 */
export function changeWorkout(data, workoutId, change) {
  validateWorkoutData(data);
  const next = structuredClone(data);
  const workout = next.workouts.find((item) => item.id === workoutId);
  requireValue(workout, '找不到这次训练');
  change(workout);
  validateWorkoutData(next);
  return next;
}

/** 新增或编辑一组；setId为空表示新增，非空表示精确修改已有组。 */
export function putWorkoutSet(data, workoutId, exerciseId, set, setId = null) {
  return changeWorkout(data, workoutId, (workout) => {
    const exercise = workout.exercises.find((item) => item.id === exerciseId);
    requireValue(exercise, '找不到这个动作');
    if (setId === null) exercise.sets.push(structuredClone(set));
    else {
      const index = exercise.sets.findIndex((item) => item.id === setId);
      requireValue(index >= 0, '找不到这组记录');
      exercise.sets[index] = { ...structuredClone(set), id: setId };
    }
  });
}

export function removeWorkoutSet(data, workoutId, exerciseId, setId) {
  return changeWorkout(data, workoutId, (workout) => {
    const exercise = workout.exercises.find((item) => item.id === exerciseId);
    requireValue(exercise, '找不到这个动作');
    const index = exercise.sets.findIndex((item) => item.id === setId);
    requireValue(index >= 0, '找不到这组记录');
    exercise.sets.splice(index, 1);
  });
}

export function finishWorkout(data, workoutId, completedAt) {
  return changeWorkout(data, workoutId, (workout) => {
    requireValue(workout.status === 'active', '训练已经完成');
    requireValue(
      workout.exercises.some((exercise) => exercise.sets.length),
      '至少记录一组后才能完成',
    );
    workout.status = 'completed';
    workout.completedAt = completedAt;
  });
}

/** 只查已完成且有组的训练；排除自己，按日期和完成时间寻找最近一次。 */
export function previousExercise(data, exerciseId, unit, excludeWorkoutId) {
  const current = data.workouts.find((item) => item.id === excludeWorkoutId);
  const workouts = data.workouts
    .filter((item) => {
      if (item.status !== 'completed' || item.id === excludeWorkoutId) return false;
      if (!current) return true;
      if (item.date !== current.date) return item.date < current.date;
      // 查看历史时不能把后来的一练显示为“上次”；同日旧归档没有时间依据，跳过。
      return (
        item.completedAt !== null &&
        current.startedAt !== null &&
        item.completedAt <= current.startedAt
      );
    })
    .toSorted(
      (a, b) =>
        b.date.localeCompare(a.date) || (b.completedAt ?? '').localeCompare(a.completedAt ?? ''),
    );
  for (const workout of workouts) {
    const exercise = workout.exercises.find(
      (item) =>
        canonicalExerciseId(item.exerciseId) === canonicalExerciseId(exerciseId) &&
        item.unit === unit &&
        item.sets.length,
    );
    if (exercise) return { date: workout.date, sets: structuredClone(exercise.sets) };
  }
  return null;
}

/** 新训练使用动作库稳定ID；未知旧名称仍保留原标识，避免错误合并。 */
export function exerciseIdentity(name) {
  return findBuiltinExercise(name)?.id ?? `legacy-name:${name}`;
}
