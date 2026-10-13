/** 名称本地化词表：仅为查阅提供中文显示名，不改变动作ID、英文原名或训练快照。
 * 常见动作优先按整段术语翻译，剩余限定词按最长匹配组合；未知词会阻止导入。
 * 新增来源或修订译名时先查看英文步骤，避免把卧推、推举、臂屈伸混为同一动作。
 */
const phraseText = `
side lying=侧卧
v bar=三角把手
v sit=折体坐姿
v up=两头起
l sit=直角支撑
l pull up=直角引体向上
straight arm=直臂
lying one arm press=仰卧单臂卧推
lying press=仰卧卧推
calf press=蹬式提踵
chest fly=夹胸飞鸟
cross body=跨体
rear lunge=后撤弓步
arm blaster=手臂固定架
exercise ball=健身球
on exercise ball=健身球上
on stability ball=健身球上
arm slingers hanging bent knee legs=悬吊屈膝举腿
arm slingers hanging straight legs=悬吊直腿举腿
arms apart circular toe touch=分臂绕环触脚尖
arms overhead full sit up=双臂过顶全幅度仰卧起坐
assisted chest dip=辅助胸肌双杠臂屈伸
hanging knee raise=悬垂举膝
hanging leg raise=悬垂举腿
lying leg raise=仰卧举腿
lying leg curl=俯卧腿弯举
leg raise=举腿
knee raise=举膝
with throw down=配合同伴向下推腿
with lateral throw down=配合同伴侧向推腿
assisted prone hamstring=辅助俯卧腘绳肌拉伸
assisted motion russian twist=辅助俄罗斯转体
bent knee=屈膝
straight legs=直腿
straight leg=直腿
biceps curl=肱二头肌弯举
bicep curl=肱二头肌弯举
seated row=坐姿划船
upright row=直立划船
split squat=分腿蹲
rear delt=肩后束
back extension=背部挺身
hip extension=髋伸展
hip abduction=髋外展
hip adduction=髋内收
toe touch=触脚尖
face pull=面拉
standing calf raise=站姿提踵
seated calf raise=坐姿提踵
reverse fly=反向飞鸟
hammer press=锤式推举
with rope=绳把式
bench press=卧推
floor press=地板卧推
military press=军式推举
french press=法式臂屈伸
arnold press=阿诺德推举
cuban press=古巴推举
push press=借力推举
leg press=腿举
pallof press=帕洛夫抗旋转推
chest press=推胸
shoulder press=肩上推举
hip thrusts=臀推
hip thrust=臀推
good morning=早安式体前屈
romanian deadlift=罗马尼亚硬拉
stiff legged deadlift=直腿硬拉
skull crusher=仰卧臂屈伸
skullcrusher=仰卧臂屈伸
triceps extension=肱三头肌臂屈伸
tricep extension=肱三头肌臂屈伸
triceps pushdown=肱三头肌下压
rear delt row=后束划船
rear delt raise=后束平举
rear delt fly=后束飞鸟
lateral raise=侧平举
front raise=前平举
calf raise=提踵
calf raises=提踵
leg curl=腿弯举
leg extension=腿屈伸
wrist curl=腕弯举
reverse wrist curl=反向腕弯举
hammer curl=锤式弯举
preacher curl=牧师凳弯举
concentration curl=集中弯举
spider curl=蜘蛛弯举
zottman curl=佐特曼弯举
drag curl=拖拉式弯举
lat pulldown=高位下拉
straight arm pulldown=直臂下拉
close grip=窄握
wide grip=宽握
neutral grip=中立握
reverse grip=反握
mixed grip=混合握
one arm=单臂
single arm=单臂
two arm=双臂
both arms=双臂
one leg=单腿
single leg=单腿
two legs=双腿
both legs=双腿
one hand=单手
single hand=单手
two hands=双手
body weight=自重
resistance band=弹力带
stability ball=健身球
medicine ball=药球
bosu ball=半圆平衡球
ez barbell=曲杆杠铃
olympic barbell=奥林匹克杠铃
trap bar=六角杠铃
smith machine=史密斯机
leverage machine=杠杆器械
stationary bike=固定单车
elliptical machine=椭圆机
upper body ergometer=上肢功率车
stepmill machine=楼梯机
ski ergometer=滑雪功率机
push up=俯卧撑
push ups=俯卧撑
pull up=引体向上
pull ups=引体向上
chin up=反握引体向上
chin ups=反握引体向上
sit up=仰卧起坐
sit ups=仰卧起坐
step up=踏台阶
step ups=踏台阶
muscle up=双力臂
turkish get up=土耳其起立
get up=起立
mountain climber=登山跑
dead bug=死虫式
bird dog=鸟狗式
air bike=空中蹬车
bicycle crunch=自行车卷腹
russian twist=俄罗斯转体
glute bridge=臀桥
glute ham raise=臀腿挺身
hip hinge=髋铰链
windmill=风车式
side bend=侧屈
bent over=俯身
lying on=仰卧于
seated on=坐于
standing on=站于
on bench=凳上
on floor=地面
on wall=墙面
to chest=至胸前
behind neck=颈后
behind the head=脑后
behind head=脑后
behind back=背后
around the world=环绕式
full range motion=全幅度
range of motion=动作幅度
back pov=背面视角
side pov=侧面视角
upper chest=上胸
lower back=下背
hip flexors=髋屈肌
hip flexor=髋屈肌
rectus femoris=股直肌
tibialis anterior=胫骨前肌
shoulder flexor=肩屈肌
and=与
`;

// 不常见的人名、姿势和原库拼写保留可辨识的中文音译；整名纠错放在overrides中。
const wordText = `
a=
ab=腹部
abdominal=腹部
abduction=外展
abductor=外展肌
above=上方
across=交叉
adduction=内收
adductor=内收肌
advanced=进阶
against=靠
air=空中
all=全部
alternate=交替
alternating=交替
angle=角度
angled=斜角
ankle=脚踝
ankles=脚踝
anti=抗
apart=分开
archer=弓箭手式
arm=手臂
arms=双臂
arnold=阿诺德
around=环绕
assisted=辅助
astride=跨坐
attachment=附件
back=背部
backward=向后
balance=平衡
ball=球
band=弹力带
bar=杆
barbell=杠铃
bars=双杠
basic=基础
battling=战绳
bear=熊式
behind=后方
bench=凳上
benches=双凳
bend=屈曲
bends=屈曲
bent=屈曲
between=之间
bicep=肱二头肌
biceps=肱二头肌
bicycle=自行车式
big=大幅度
bike=单车
blaster=固定架
board=板上
body=身体
bodyweight=自重
bosu=半圆平衡球
both=双侧
bottoms=底朝上
bowling=保龄球式
box=跳箱
boxing=拳击
bradford=布拉德福德
breeding=飞鸟
bridge=桥式
bug=虫式
burpee=波比跳
butt=臀部
butterfly=蝴蝶式
cable=绳索
cage=框架
calf=小腿
calves=小腿
cambered=弯杆
can=罐式
captains=船长椅
carry=行走搬运
caster=施法式
cat=猫式
catch=接球
chair=椅上
chest=胸部
chin=下巴
circles=绕环
circular=绕环
clap=击掌
clasped=交握
clean=翻举
climb=攀爬
climber=攀爬式
clock=时钟式
close=窄距
closer=更窄距
cobra=眼镜蛇式
cocoons=团身卷腹
concentration=集中
contralateral=对侧
cossack=哥萨克式
crab=螃蟹式
crawl=爬行
cross=交叉
crossover=交叉
crossovers=交叉
crunch=卷腹
crunches=卷腹
crusher=臂屈伸
cuban=古巴式
curl=弯举
curls=弯举
curtsey=屈膝礼式
cycle=骑行
dead=死虫
deadlift=硬拉
decline=下斜
deep=深幅度
degrees=度
delt=三角肌
deltoid=三角肌
depresor=下压
depth=深度
diagonal=斜向
diamond=钻石式
dip=臂屈伸
dips=臂屈伸
dog=犬式
donkey=驴式
double=双侧
down=向下
drag=拖拉
drive=推进
drop=落下
dumbbell=哑铃
dumbbells=哑铃
dynamic=动态
elbow=肘部
elevated=垫高
elevator=升降式
elliptical=椭圆机
equipment=器械
ergometer=功率机
exercise=练习
extended=伸展
extension=伸展
external=外旋
ez=曲杆
face=面部
facing=面向
fallout=前倾支撑
farmers=农夫
feet=双脚
female=女性示范
femoral=股部
femoris=股肌
figure=数字式
finger=手指
fixed=固定
flag=旗帜式
flat=平板
flexion=屈曲
flexor=屈肌
flip=翻转
floor=地面
flutter=交替打腿
fly=飞鸟
flyes=飞鸟
forth=向前
forward=向前
fours=四点支撑
frankenstein=弗兰肯斯坦式
french=法式
frog=蛙式
from=由
front=前侧
full=全幅度
get=起身
gironda=吉隆达
glute=臀部
glutes=臀肌
gluteus=臀肌
goblet=高脚杯
good=早安式
gorilla=大猩猩式
gravity=重力
greatest=综合
grip=握
gripless=无握把
gripper=握力器
groin=腹股沟
ground=地面
guillotine=颈前
hack=哈克
half=半幅度
ham=腘绳肌
hammer=锤式
hamstring=腘绳肌
hand=单手
handle=把手
hands=双手
handstand=倒立
hang=悬挂
hanging=悬垂
head=头部
heel=脚跟
high=高位
hindu=印度式
hip=髋部
hook=钩式
hops=小跳
horizontal=水平
hug=抱膝
hyght=海特式
hyper=挺身
hyperextension=背部挺身
impossible=高难度
in=内侧
inchworm=毛毛虫式
incline=上斜
inner=内侧
inside=内侧
intermediate=中阶
internal=内旋
into=至
inverse=反向
inverted=反向
iron=铁十字式
isometric=等长
jack=开合
jackknife=折刀式
janda=扬达式
jefferson=杰弗逊式
jerk=挺举
jm=杰姆式
judo=柔道式
jump=跳跃
jumps=跳跃
kayak=划艇式
keens=膝盖
kettlebell=壶铃
kick=踢腿
kickback=后伸
kickbacks=后伸
kicks=踢腿
kipping=借力
knee=膝部
kneeling=跪姿
knees=双膝
knife=折刀式
korean=韩式
l=直角
landmine=地雷杆
lat=背阔肌
lateral=侧向
lean=倾斜
left=左侧
leg=腿部
legged=腿
legs=双腿
lever=器械
lift=抬举
lifting=抬举
london=伦敦式
low=低位
lower=下部
lunge=弓步
lying=仰卧
machine=器械
major=大肌
male=男性示范
maltese=马耳他式
march=踏步
medicine=药球
middle=中部
military=军式
mixed=混合
modified=改良式
monster=怪兽步
morning=体前屈
motion=动作
mountain=登山式
multiple=多段
muscle=肌肉
narrow=窄距
neck=颈部
negative=离心
neutral=中立
oblique=腹斜肌
of=的
off=离地
olympic=奥林匹克
on=上
one=单侧
otis=奥蒂斯式
out=外侧
outer=外侧
outside=外侧
outstretched=伸直
over=俯身
overhand=正握
overhead=过顶
pad=垫上
pallof=帕洛夫
palm=掌心
palms=双掌
parallel=平行
pass=传球
peacher=牧师凳
pec=胸肌
pectoralis=胸肌
pelvic=骨盆
pendlay=潘德雷式
peroneals=腓骨肌
pike=屈体
pin=定位销
pirate=海盗式
piriformis=梨状肌
pistol=手枪式
planche=俄式挺身
plank=平板支撑
platform=平台
plus=加强版
plyo=增强式
point=点支撑
pose=式
position=姿势
posterior=后侧
potty=蹲坐式
pov=视角
power=爆发式
preacher=牧师凳
press=推举
presses=推举
prisoner=囚徒式
pro=进阶
pronate=旋前
pronated=正握
pronation=旋前
prone=俯卧
pull=拉
pulldown=下拉
pulley=滑轮
pullover=直臂上拉
push=推
pushdown=下压
pyramid=金字塔式
quad=股四头肌
quads=股四头肌
quarter=四分之一幅度
quick=快速
rack=架上
raise=抬举
raised=抬高
raises=抬举
range=幅度
reach=伸手
rear=后侧
reclining=斜躺
rectus=直肌
release=释放
renegade=叛逆者式
reps=次
resistance=阻力
response=反应式
retractor=回缩
revers=反向
reverse=反向
reversed=反向
ring=吊环
rocking=摇摆
rocky=洛基式
roller=滚筒
rollerer=滚轴
rollerout=前滚
romanian=罗马尼亚
rope=绳
ropes=绳
rotary=旋转
rotate=旋转
rotation=旋转
rotational=旋转
round=环绕
row=划船
run=跑步
runners=跑者式
russian=俄罗斯
saw=锯式
scapula=肩胛
scapular=肩胛
scissor=剪刀式
scott=斯科特式
seated=坐姿
seesaw=跷跷板式
self=自主
semi=半幅度
sequence=连续式
short=短幅度
shoulder=肩部
shrug=耸肩
side=侧向
single=单侧
sissy=西西式
sit=坐姿
sitted=坐姿
skater=滑冰式
ski=滑雪式
skier=滑雪式
skin=绕肩
skull=仰卧
slam=砸球
sled=滑橇器械
sledge=大锤
slide=滑动
slingers=悬吊抬腿
smith=史密斯机
snatch=抓举
speed=快速
spell=施法式
sphinx=狮身人面式
spider=蜘蛛式
spine=脊柱
split=分腿
sprint=冲刺
sprints=冲刺
squad=股四头肌
squat=深蹲
squats=深蹲
squatting=蹲姿
squeeze=挤压
stability=稳定
stabilization=稳定
staircase=楼梯
stalder=斯塔尔德式
stance=站距
standing=站姿
star=星式
stationary=固定
step=踏步
stepbox=踏步箱
stepmill=楼梯机
sternum=胸骨
stiff=直
stirrups=脚蹬
stork=鹳式
straddle=分腿
straight=直
strap=绑带
straps=绑带
stretch=拉伸
stride=跨步
style=式
sumo=相扑
superman=超人式
supinated=反握
supination=旋后
supine=仰卧
supper=抬举
support=支撑
supported=支撑式
suspended=悬吊
svend=斯文德式
swimmer=游泳式
swing=摆动
sz=曲杆
t=丁字式
tap=点触
tate=泰特式
tennis=网球
the=
thibaudeau=蒂博多式
three=三
through=穿过
throw=投掷
thruster=深蹲推举
thrusts=挺髋
tibialis=胫骨肌
tilt=倾斜
tire=轮胎
to=至
toe=脚尖
touch=触碰
touchers=触碰
towel=毛巾
trainer=训练器
trap=斜方肌
treadmill=跑步机
tricep=肱三头肌
triceps=肱三头肌
tuck=团身
turkish=土耳其
twin=双侧
twist=转体
twisted=转体
twisting=转体
twists=转体
two=双侧
under=下方
underhand=反握
unilateral=单侧
up=向上
upper=上部
upright=直立
ups=向上
upward=向上
v=变式
variation=变式
vertical=垂直
w=双折臂式
waiter=侍者式
walk=行走
walking=行走
wall=靠墙
weighted=负重
wheel=健腹轮
wide=宽距
wind=风车式
windmill=风车式
wipers=雨刷式
with=配合
world=环绕
wrist=手腕
y=斜举臂式
yoga=瑜伽
zercher=泽奇式
zottman=佐特曼
`;

// 整名例外用于自然中文表述及原库错拼修正；不同变式仍保留独立编号。
const overrides = {
  '3/4 sit-up': '四分之三幅度仰卧起坐',
  '45° side bend': '四十五度侧屈',
  'all fours squad stretch': '四点跪姿股四头肌拉伸',
  'alternate heel touchers': '交替触踵卷腹',
  'alternate lateral pulldown': '交替侧向下拉',
  'dumbbell goblet squat': '哑铃高脚杯深蹲',
  'dumbbell lateral raise': '哑铃侧平举',
  'dumbbell front raise': '哑铃前平举',
  'dumbbell arnold press': '哑铃阿诺德推举',
  'dumbbell incline breeding': '上斜哑铃飞鸟',
  'dumbbell peacher hammer curl': '牧师凳哑铃锤式弯举',
  'barbell bench press': '杠铃卧推',
  'barbell full squat': '杠铃全幅度深蹲',
  'barbell bent over row': '杠铃俯身划船',
  'barbell romanian deadlift': '杠铃罗马尼亚硬拉',
  'dumbbell romanian deadlift': '哑铃罗马尼亚硬拉',
  'cable pulldown': '绳索高位下拉',
  'cable seated row': '坐姿绳索划船',
  'cable pushdown': '绳索肱三头肌下压',
  'lever chest press': '器械推胸',
  'lever seated row': '器械坐姿划船',
  'lever lying leg curl': '器械俯卧腿弯举',
  'lever seated leg curl': '器械坐姿腿弯举',
  'low glute bridge on floor': '地面低位臀桥',
  'hug keens to chest': '仰卧抱膝至胸',
  cocoons: '团身卷腹',
  inchworm: '毛毛虫爬行',
  burpee: '波比跳',
  'jumping jack': '开合跳',
  'mountain climber': '登山跑',
  'push-up': '俯卧撑',
  'pull-up': '引体向上',
  'chin-up': '反握引体向上',
  'sit-up': '仰卧起坐',
  'air bike': '仰卧空中蹬车',
  'barbell rollerout': '杠铃前滚收腹',
  'barbell standing ab rollerout': '站姿杠铃前滚收腹',
  'wheel rollerout': '健腹轮前滚',
  'standing wheel rollerout': '站姿健腹轮前滚',
  'wrist rollerer': '手腕卷轴训练',
  'spell caster': '哑铃斜向转体',
  'calf push stretch with hands against wall': '靠墙小腿拉伸',
  'lying leg-hip raise': '仰卧举腿抬髋',
  'l-sit on floor': '地面直角支撑',
  'v-sit on floor': '地面折体坐姿',
  'push and pull bodyweight': '自重推拉练习',
  'sled calf press on leg press': '腿举机提踵',
  'sled one leg calf press on leg press': '腿举机单腿提踵',
};

const terms = [...phraseText.trim().split('\n'), ...wordText.trim().split('\n')]
  .map((line) => {
    const [english, chinese] = line.split('=');
    return { english, chinese, words: english.split(' ') };
  })
  .sort((a, b) => b.words.length - a.words.length || b.english.length - a.english.length);

/** 将固定来源的动作名称转换成中文显示名。未识别的词不静默变成英文，需补词表后重试。
 * @param {string} name 上游英文原名。
 * @returns {string} 中文名称，保留角度、姿势限定及变式编号。
 */
export function translateExerciseName(name) {
  const original = name.toLowerCase().trim();
  if (overrides[original]) return overrides[original];
  const version = original.match(/\bv\.?\s*(\d+)\b/);
  const normalized = original
    .replace(/\bv\.?\s*\d+\b/g, '')
    .replace(/[-–]/g, ' ')
    .replace(/в°/g, '°');
  const tokens = normalized.match(/[a-z]+|\d+(?:\/\d+)?|[^a-z\d\s]/g) ?? [];
  let result = '';
  for (let index = 0; index < tokens.length;) {
    const match = terms.find((term) =>
      term.words.every((word, offset) => tokens[index + offset] === word),
    );
    if (match) {
      result += match.chinese;
      index += match.words.length;
    } else if (/^[a-z]+$/.test(tokens[index]))
      throw new Error(`动作名称有未翻译词：${tokens[index]}（${name}）`);
    else {
      result += tokens[index] === '(' ? '（' : tokens[index] === ')' ? '）' : tokens[index];
      index++;
    }
  }
  return (
    result.replace(/\(\)/g, '').replace(/（）/g, '').replace(/\.$/, '') +
    (version ? `（变式${version[1]}）` : '')
  );
}
