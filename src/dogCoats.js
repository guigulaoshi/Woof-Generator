// 中华田园犬的花色定义。
//
// 狗的“毛色”几乎从来不是整只均匀一色。绝大多数家犬的
// 深色只长在背上那一块（鞍背 / 背毯），脸下半、胸口、四肢和腹部保持浅色。
// 所以这里把颜色拆成三层，UI 的主色盘只驱动 saddle：
//
//   saddle —— 背上那块皮（用户可调的主色）
//   under  —— 腹部 / 胸口 / 口吻 / 四肢内侧的浅底色
//   accent —— 眉点、脸颊、袜子、尾尖这些点缀色
//
// kind 决定 saddle 怎么铺在身上：
//   saddle   背中央一块，肩到臀，向体侧包一部分（黑背 / 赤红）
//   blanket  背毯，包到体侧更低，也盖住头顶（狼青）
//   solid    整只都是 saddle 色，只有腹部提亮（大黄 / 奶白 / 墨黑）
//   patched  白底上散落的大色块（花斑）
//   tanPoints 深色主体 + 眉点 / 脸颊 / 四肢的 accent（铁包金，也叫四眼狗）
//   brindle  底色上竖向虎斑纹（虎斑）
//
// 这一组只收中华田园犬真实存在的色型：大麦町那种规则小圆斑、暹罗式的
// 重点色都不属于这里，收进来只会让"随机遇见一只小狗"跑偏。
export const DOG_COATS = [
  {
    id: 'yellow', name: '大黄', kind: 'solid',
    saddle: '#d99850', under: '#f5e3c2', accent: '#f7efdd',
    socks: 0.35, blaze: 0.4, tailTip: 0.5,
  },
  {
    id: 'blackBack', name: '黑背', kind: 'saddle',
    saddle: '#3b352f', under: '#c98a48', accent: '#e6c48d',
    socks: 0.5, blaze: 0.55, tailTip: 0.45,
  },
  {
    id: 'ironGold', name: '铁包金', kind: 'tanPoints',
    saddle: '#2b2622', under: '#2f2a25', accent: '#b8763a',
    socks: 0.2, blaze: 0.25, tailTip: 0.2,
  },
  {
    id: 'wolfGrey', name: '狼青', kind: 'blanket',
    saddle: '#6e737b', under: '#d8d2c4', accent: '#3c3b3a',
    socks: 0.55, blaze: 0.5, tailTip: 0.4,
  },
  {
    id: 'redDog', name: '赤红', kind: 'saddle',
    saddle: '#c9662f', under: '#f6ecd8', accent: '#f9f3e6',
    socks: 0.85, blaze: 0.9, tailTip: 0.95, saddleWrap: 1.42, saddleStart: 0.16,
  },
  {
    id: 'patchy', name: '花斑', kind: 'patched',
    saddle: '#7a4a2c', under: '#f6f1e5', accent: '#3a3229',
    socks: 0.95, blaze: 0.95, tailTip: 0.85,
  },
  {
    id: 'brindle', name: '虎斑', kind: 'brindle',
    saddle: '#8a5a2c', under: '#e7cfa6', accent: '#40342a',
    socks: 0.5, blaze: 0.45, tailTip: 0.4,
  },
  {
    id: 'milkWhite', name: '奶白', kind: 'solid',
    saddle: '#f1ebdd', under: '#fdfaf2', accent: '#e6dcc6',
    socks: 0.1, blaze: 0.2, tailTip: 0.15,
  },
  {
    id: 'inkBlack', name: '墨黑', kind: 'solid',
    saddle: '#33312f', under: '#454240', accent: '#f2ece0',
    socks: 0.45, blaze: 0.5, tailTip: 0.35,
  },
];

export const DOG_EYE_COLORS = [
  { id: 'darkBrown', name: '深褐', color: '#4a3122' },
  { id: 'amber', name: '琥珀', color: '#c07c22' },
  { id: 'hazel', name: '榛', color: '#96702f' },
  { id: 'iceBlue', name: '冰蓝', color: '#79b3d4' },
  { id: 'green', name: '橄榄绿', color: '#6f8f4a' },
  { id: 'gold', name: '金', color: '#d2a032' },
];

// 中华田园犬的身体语言：坐、趴、邀玩、作揖。
export const DOG_POSES = [
  { id: 'standing', name: '站立' },
  { id: 'sit', name: '端坐' },
  { id: 'sphinx', name: '趴卧' },
  { id: 'playBow', name: '邀玩趴' },
  { id: 'beg', name: '作揖' },
];

// 耳型是狗最强的辨识特征，独立于耳朵大小。
export const DOG_EAR_TYPES = [
  { id: 'prick', name: '立耳' },
  { id: 'floppy', name: '垂耳' },
  { id: 'semi', name: '折耳' },
];

// 耳尖形状和耳型是两回事：同样是立耳，有收成尖三角的，也有顶端浑圆的。
export const DOG_EAR_TIPS = [
  { id: 'pointed', name: '尖耳' },
  { id: 'round', name: '圆耳' },
];
