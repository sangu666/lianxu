/** 模板动作的稳定编号独立于名称；改显示文字时不应改变历史动作身份。 */
const definitions = [
  [
    'goblet-squat',
    '高脚杯深蹲',
    'dumbbells',
    'freeweights',
    ['squat'],
    'upper legs',
    'quads',
    [
      '双手把哑铃靠近胸前，双脚自然站稳。',
      '屈髋屈膝下蹲，膝盖随脚尖方向移动，保持全脚掌稳定。',
      '在能控制的幅度内下蹲，再平稳站起。',
    ],
    '避免脚跟抬起、膝盖突然内扣或为追求深度失去躯干控制。',
  ],
  [
    'leg-press',
    '腿举',
    'legPress',
    'machines',
    ['squat'],
    'upper legs',
    'quads',
    [
      '调节座椅与安全挡位，背部和骨盆贴住靠垫。',
      '双脚稳放踏板，缓慢屈膝，下降到骨盆仍稳定的位置。',
      '平稳推回，不猛撞或锁死膝关节；按器械说明收回安全挡。',
    ],
    '避免下降时骨盆卷起离开靠垫；不同器械的调节方式不相同。',
  ],
  [
    'bodyweight-squat',
    '自重深蹲',
    'bodyweight',
    'bodyweight',
    ['squat'],
    'upper legs',
    'quads',
    [
      '双脚自然站稳，手臂前伸帮助平衡。',
      '屈髋屈膝下蹲，膝盖随脚尖方向移动。',
      '保持足底稳定，在可控制的幅度内站起。',
    ],
    '避免脚跟抬起或靠突然反弹站起。',
  ],
  [
    'dumbbell-floor-press',
    '哑铃地板卧推',
    'dumbbells',
    'freeweights',
    ['push'],
    'chest',
    'pectorals',
    [
      '在地垫上仰卧并屈膝，稳妥地把哑铃带到胸侧。',
      '前臂保持稳定，向上推起哑铃，避免相互碰撞。',
      '缓慢下降，上臂轻触地面后再次推起；结束时先安全放下哑铃。',
    ],
    '避免上臂撞击地板、手腕过度后折或过大的负重。',
  ],
  [
    'machine-chest-press',
    '器械推胸',
    'chestMachine',
    'machines',
    ['push'],
    'chest',
    'pectorals',
    [
      '调节座位，使把手在胸部附近，背部贴住靠垫。',
      '握稳把手并平稳向前推，不强行锁死肘关节。',
      '缓慢回到可控制的起点，保持肩部稳定。',
    ],
    '避免耸肩、离开靠垫借力；先熟悉器械的安全设置。',
  ],
  [
    'wall-push-up',
    '靠墙俯卧撑',
    'bodyweight',
    'bodyweight',
    ['push'],
    'chest',
    'pectorals',
    [
      '面对稳固墙面站立，双手约在胸部高度撑墙。',
      '身体保持一条直线，屈肘缓慢靠近墙面。',
      '平稳推回；用离墙距离调节难度。',
    ],
    '避免腰部塌陷或用头部先碰墙；需要稳固、可承重的墙面。',
  ],
  [
    'one-arm-dumbbell-row',
    '单臂哑铃划船',
    'dumbbells',
    'freeweights',
    ['pull'],
    'back',
    'upper back',
    [
      '采用稳定的分腿站姿，屈髋并让躯干保持稳定。',
      '单手握哑铃，把肘部朝髋部方向拉起。',
      '缓慢放下，另一侧用相同方式完成。',
    ],
    '避免旋转躯干甩起重量；需要支撑时使用稳固支点，不能依靠不稳定家具。',
  ],
  [
    'seated-row',
    '坐姿划船',
    'rowMachine',
    'machines',
    ['pull'],
    'back',
    'upper back',
    [
      '调节座位，双脚稳固，握住把手。',
      '保持躯干稳定，将把手拉向身体，肘部沿身体两侧移动。',
      '缓慢回放，避免用腰部大幅前后摆动。',
    ],
    '避免耸肩或借躯干后仰拉动过大的重量。',
  ],
  [
    'seated-band-row',
    '坐姿弹力带划船',
    'bands',
    'bands',
    ['pull'],
    'back',
    'upper back',
    [
      '检查弹力带完好，按产品说明使用可靠固定点。',
      '坐稳并保持躯干稳定，把肘部向后拉。',
      '缓慢回放，始终控制弹力带张力。',
    ],
    '避免用松动支点固定；不要把带子拉向面部，磨损的带子应停止使用。',
  ],
  [
    'dumbbell-rdl',
    '哑铃罗马尼亚硬拉',
    'dumbbells',
    'freeweights',
    ['hinge'],
    'upper legs',
    'hamstrings',
    [
      '双手持哑铃站稳，膝盖微屈，重量靠近腿部。',
      '臀部向后移动，躯干随髋部前倾，保持背部稳定。',
      '到可控制的幅度后，伸髋站起，不强求触地。',
    ],
    '避免把动作变成深蹲、弓背或站起时过度后仰。',
  ],
  [
    'barbell-rdl',
    '罗马尼亚硬拉',
    'barbell',
    'freeweights',
    ['hinge'],
    'upper legs',
    'hamstrings',
    [
      '采用安全的起杆方式，握稳杠铃并站稳，膝盖微屈。',
      '臀部向后移动，让杠铃靠近腿部下降，保持背部稳定。',
      '到可控制的幅度后伸髋站起，安全地放回杠铃。',
    ],
    '避免让杠铃远离身体、弓背或追求触地；起杆需要适合的场地。',
  ],
  [
    'hip-hinge',
    '自重髋铰链练习',
    'bodyweight',
    'bodyweight',
    ['hinge'],
    'upper legs',
    'hamstrings',
    [
      '双脚站稳，膝盖微屈，双手放在髋部。',
      '臀部向后移动，感受髋部折叠，躯干随之前倾。',
      '保持背部稳定，再伸髋回到站姿。',
    ],
    '避免主要靠腰部弯曲或把动作变成深蹲。',
  ],
  [
    'standing-dumbbell-press',
    '站姿哑铃推举',
    'dumbbells',
    'freeweights',
    ['push', 'shoulder'],
    'shoulders',
    'delts',
    [
      '双脚站稳，把哑铃稳妥带到肩侧。',
      '保持躯干稳定，在舒适轨迹内向上推起。',
      '缓慢回到肩侧，不用腰部后仰借力。',
    ],
    '避免肋骨过度外翻、腰部后仰或强行超过可控制的幅度。',
  ],
  [
    'lateral-raise',
    '哑铃侧平举',
    'dumbbells',
    'freeweights',
    ['shoulder'],
    'shoulders',
    'delts',
    [
      '双脚站稳，双手持轻哑铃，肘部微屈。',
      '在舒适方向向两侧抬臂，约到肩部高度或较低位置。',
      '缓慢下降，保持肩部和躯干稳定。',
    ],
    '避免耸肩、甩动重量或在疼痛范围内反复抬举。',
  ],
  [
    'glute-bridge',
    '自重臀桥',
    'bodyweight',
    'bodyweight',
    ['glute'],
    'upper legs',
    'glutes',
    [
      '仰卧屈膝，双脚放稳，手臂放在身体两侧。',
      '平稳伸髋抬起骨盆，保持躯干稳定。',
      '缓慢放下，不用腰部过度后仰追求高度。',
    ],
    '避免过度挺腰或抬起时膝盖突然向内移动。',
  ],
  [
    'leg-curl',
    '腿弯举',
    'legCurl',
    'machines',
    ['kneeFlexion'],
    'upper legs',
    'hamstrings',
    [
      '按器械说明调节座位或卧垫，使膝关节对准转轴。',
      '固定身体，缓慢屈膝带动器械。',
      '缓慢回放，不让配重突然落下。',
    ],
    '坐姿与卧姿器械不同；避免身体离开靠垫、甩动或转轴对位不当。',
  ],
  [
    'lat-pulldown',
    '高位下拉',
    'latPulldown',
    'machines',
    ['pull'],
    'back',
    'lats',
    [
      '调节大腿固定垫，坐稳并握住把手。',
      '保持躯干稳定，把肘部向下拉，把手沿身体前方下降。',
      '缓慢回放到可控制的起点。',
    ],
    '避免颈后下拉、剧烈后仰或甩动配重。',
  ],
  [
    'plank',
    '平板支撑',
    'bodyweight',
    'bodyweight',
    ['core'],
    'waist',
    'abs',
    [
      '前臂撑地，肘部大致在肩部下方，脚尖或膝部支撑。',
      '保持躯干稳定和自然呼吸，在可控制的姿势下计时。',
      '姿势难以保持时结束这一组，不为凑秒数继续支撑。',
    ],
    '避免塌腰、臀部过度抬起或屏气。',
  ],
];

/** 模板动作教学由练序编写，属于基础文字提示，尚未经过专业教练逐项审校。 */
export const BUILTIN_EXERCISES = definitions.map(
  ([id, name, device, category, patterns, bodyPart, target, stepsZh, mistake]) => ({
    id: `lianxu:${id}`,
    name,
    device,
    category,
    patterns,
    bodyPart,
    target,
    equipment: device,
    secondaryMuscles: [],
    stepsZh,
    stepsEn: [],
    mistake,
    unit: id === 'plank' ? 'seconds' : 'reps',
    origin: 'builtin',
  }),
);

/** 动作位置使用稳定ID；排列顺序保持原模板的优先级，不让社区库改变自动排课。 */
export const PLAN_SLOTS = {
  squat: ['goblet-squat', 'leg-press', 'bodyweight-squat'],
  push: ['dumbbell-floor-press', 'machine-chest-press', 'wall-push-up'],
  row: ['one-arm-dumbbell-row', 'seated-row', 'seated-band-row'],
  hinge: ['dumbbell-rdl', 'barbell-rdl', 'hip-hinge'],
  overhead: ['standing-dumbbell-press'],
  shoulder: ['lateral-raise'],
  glute: ['glute-bridge'],
  curl: ['leg-curl'],
  verticalPull: ['lat-pulldown', 'seated-band-row', 'one-arm-dumbbell-row'],
  core: ['plank'],
};

/** 精确查找编号或已知中文名称；不做模糊匹配，避免把不同动作合并。 */
export function findBuiltinExercise(value) {
  return BUILTIN_EXERCISES.find((item) => item.id === value || item.name === value);
}

/** 仅在读取时把已知旧名称ID映射到新编号，持久化历史快照保持原样。 */
export function canonicalExerciseId(value) {
  const name = value.startsWith('legacy-name:') ? value.slice('legacy-name:'.length) : value;
  return findBuiltinExercise(name)?.id ?? value;
}

export const BODY_LABELS = {
  back: '背部',
  cardio: '有氧',
  chest: '胸部',
  'lower arms': '前臂',
  'lower legs': '小腿',
  neck: '颈部',
  shoulders: '肩部',
  'upper arms': '上臂',
  'upper legs': '大腿与臀部',
  waist: '腰腹',
};
export const MUSCLE_LABELS = {
  abdominals: '腹肌',
  'ankle stabilizers': '踝部稳定肌群',
  ankles: '踝部',
  back: '背部',
  brachialis: '肱肌',
  chest: '胸部',
  core: '核心肌群',
  deltoids: '三角肌',
  feet: '足部',
  'grip muscles': '握力相关肌群',
  groin: '腹股沟',
  hands: '手部',
  'hip flexors': '髋屈肌',
  'inner thighs': '大腿内侧',
  'latissimus dorsi': '背阔肌',
  'lower abs': '下腹部',
  'lower back': '下背部',
  obliques: '腹斜肌',
  quadriceps: '股四头肌',
  'rear deltoids': '三角肌后束',
  rhomboids: '菱形肌',
  'rotator cuff': '肩袖肌群',
  shins: '小腿前侧',
  shoulders: '肩部',
  soleus: '比目鱼肌',
  sternocleidomastoid: '胸锁乳突肌',
  trapezius: '斜方肌',
  'upper chest': '上胸部',
  'wrist extensors': '腕伸肌群',
  'wrist flexors': '腕屈肌群',
  wrists: '腕部',
  abductors: '外展肌',
  abs: '腹肌',
  adductors: '内收肌',
  biceps: '肱二头肌',
  calves: '小腿肌群',
  'cardiovascular system': '心肺系统',
  delts: '三角肌',
  forearms: '前臂肌群',
  glutes: '臀肌',
  hamstrings: '腘绳肌',
  lats: '背阔肌',
  'levator scapulae': '肩胛提肌',
  pectorals: '胸肌',
  quads: '股四头肌',
  'serratus anterior': '前锯肌',
  spine: '脊柱周围肌群',
  traps: '斜方肌',
  triceps: '肱三头肌',
  'upper back': '上背部',
};
export const DEVICE_LABELS = {
  bodyweight: '自重 / 地垫',
  dumbbells: '哑铃',
  bands: '弹力带',
  chestMachine: '推胸器械',
  rowMachine: '划船器械',
  latPulldown: '高位下拉器械',
  legPress: '腿举器械',
  legCurl: '腿弯举器械',
  assisted: '辅助器械',
  band: '弹力带',
  barbell: '杠铃',
  'body weight': '自重',
  'bosu ball': '半圆平衡球',
  cable: '绳索器械',
  dumbbell: '哑铃',
  'elliptical machine': '椭圆机',
  'ez barbell': '曲杆杠铃',
  hammer: '锤',
  kettlebell: '壶铃',
  'leverage machine': '杠杆器械',
  'medicine ball': '药球',
  'olympic barbell': '奥林匹克杠铃',
  'resistance band': '阻力带',
  roller: '滚筒',
  rope: '绳',
  'skierg machine': '滑雪机',
  'sled machine': '滑橇器械',
  'smith machine': '史密斯机',
  'stability ball': '健身球',
  'stationary bike': '固定单车',
  'stepmill machine': '楼梯机',
  tire: '轮胎',
  'trap bar': '六角杠铃',
  'upper body ergometer': '上肢功率车',
  weighted: '额外负重',
  'wheel roller': '健腹轮',
};

/** 所有外部文本在进入HTML前转义；数据集内容不能当作网页代码执行。 */
export function escapeExerciseText(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

/** 中文名称优先用于界面；原英文name保留供来源核对和英文搜索，不承担身份匹配职责。 */
export function exerciseDisplayName(item) {
  return item.nameZh ?? item.name;
}

/** 搜索设备同义项归一化；仅用于目录筛选，不改变上游元数据或个人排课条件。 */
export function exerciseDeviceGroup(value) {
  return (
    {
      dumbbell: 'dumbbells',
      band: 'bands',
      'resistance band': 'bands',
      'body weight': 'bodyweight',
    }[value] ?? value
  );
}

/** 返回筛选后的分页结果；页号从1开始，每页最多24条，避免渲染千条教学文本。 */
export function searchExercises(exercises, { query = '', body = '', device = '', page = 1 } = {}) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matched = exercises.filter(
    (item) =>
      (!body || item.bodyPart === body) &&
      (!device || exerciseDeviceGroup(item.equipment) === exerciseDeviceGroup(device)) &&
      words.every((word) =>
        [
          item.nameZh,
          item.name,
          item.id,
          BODY_LABELS[item.bodyPart],
          MUSCLE_LABELS[item.target],
          DEVICE_LABELS[item.equipment],
          ...item.stepsZh,
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(word),
      ),
  );
  const pages = Math.max(1, Math.ceil(matched.length / 24));
  const current = Math.max(1, Math.min(pages, Number.isFinite(page) ? Math.floor(page) : 1));
  return {
    total: matched.length,
    pages,
    page: current,
    items: matched.slice((current - 1) * 24, current * 24),
  };
}
