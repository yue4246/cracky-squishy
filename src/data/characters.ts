import type { Character } from '../rendering/ClayRenderer';

export type DessertTier = 'starter' | 'base-box' | 'hidden-box';
export type DessertCharacter = Character & { id: string; tier: DessertTier };
export const characters: DessertCharacter[] = [
  { id: 'orange-snail', tier:'hidden-box', name:'橘子蜗牛', image:'橘子蜗牛.png', color:'#ffc678', material:'sugar', coreMaterial:'jelly', shellStrength:.85, filling:'薄糖脆壳 · 橘子果冻芯', authoredDamage:true },
  { id: 'cat-bus', tier:'hidden-box', name:'猫猫校车', image:'猫猫校车.png', color:'#ffe7a5', material:'mochi', coreMaterial:'ice', shellStrength:1, filling:'奶蜡脆壳 · 布丁史莱姆芯', authoredDamage:true },
  { id: 'sneaker-goldfish', tier:'hidden-box', name:'球鞋金鱼', image:'球鞋金鱼.png', color:'#ffb68b', material:'ice', coreMaterial:'jelly', shellStrength:.8, filling:'冰晶脆壳 · 蜜桃果冻芯', authoredDamage:true },
  { id: 'seal-sandwich', tier:'hidden-box', name:'海豹夹心', image:'海豹夹心.png', color:'#fff0d5', material:'bread', coreMaterial:'mochi', shellStrength:1.1, filling:'饼干脆壳 · 棉花糖麻薯芯', authoredDamage:true },
  { id: 'cherry-cat', tier:'hidden-box', name:'樱桃猫猫', image:'樱桃猫猫.png', color:'#e993ae', material:'sugar', coreMaterial:'ice', shellStrength:.9, filling:'红糖晶壳 · 樱桃史莱姆芯', authoredDamage:true },
  { id: 'purple-hamster', tier:'hidden-box', name:'紫薯鼠鼠', image:'紫薯鼠鼠.png', color:'#c9a4cf', material:'chocolate', coreMaterial:'sugar', shellStrength:1.15, coreTexture:'granular', filling:'紫薯巧克力壳 · 颗粒黏土芯', authoredDamage:true },
  { id: 'cream-seal', tier:'hidden-box', name:'奶油海豹球', image:'奶油海豹球.png', color:'#fff0c7', material:'chocolate', coreMaterial:'mochi', shellStrength:.8, filling:'白巧薄壳 · 香草麻薯芯', authoredDamage:true },
  { id: 'hot-dog', tier:'hidden-box', name:'热狗修狗', image:'热狗修狗.png', color:'#f0d3a7', material:'bread', coreMaterial:'bread', shellStrength:1.05, coreTexture:'granular', filling:'烤面包脆壳 · 绵软面团芯', authoredDamage:true },
  { id: 'hamster', tier:'hidden-box', filling: '奶蜡脆壳 · 麻薯内芯', name: '小仓鼠', image: '人脸小仓鼠.png', color: '#f2dfbd', material: 'mochi', coreMaterial:'mochi', authoredDamage: true },
  { id:'bunny-bread', tier:'base-box', name:'小兔面包', image:'小兔面包 v.3.png', color:'#f5b7c4', material:'sugar', coreMaterial:'mochi', shellStrength:.9, filling:'草莓奶蜡壳 · 草莓麻薯芯', authoredDamage:true },
  { id:'little-dumpling', tier:'base-box', name:'小团子', image:'小团子 v.3.png', color:'#fff0d4', material:'sugar', coreMaterial:'mochi', shellStrength:.82, filling:'米糖薄壳 · 糯米麻薯芯', authoredDamage:true },
  { id:'donut', tier:'base-box', name:'甜甜圈', image:'甜甜圈 v.3.png', color:'#f5d49b', material:'chocolate', coreMaterial:'bread', shellStrength:1.05, coreTexture:'granular', filling:'焦糖脆壳 · 奶油面包芯', authoredDamage:true },
  { id:'puppy-bread', tier:'base-box', name:'小狗面包', image:'小狗面包 v.3.png', color:'#ffe09b', material:'chocolate', coreMaterial:'jelly', shellStrength:.92, filling:'白巧奶壳 · 卡仕达软芯', authoredDamage:true },
  { id:'bath-egg', tier:'base-box', name:'浴缸奶龙蛋', image:'浴缸奶龙蛋.png', color:'#ffd54f', material:'sugar', coreMaterial:'jelly', shellStrength:.86, filling:'奶糖薄壳 · 黄色布丁史莱姆芯', authoredDamage:true },
  { id: 'cat-bread', tier:'starter', filling: '奶蜡脆壳 · 麻薯内芯', name: '小猫面包', image: '小猫面包 v.3.png', color: '#efd4b4', material: 'mochi', coreMaterial:'mochi', authoredDamage:true },
  { id: 'watermelon', tier:'starter', filling: '冰晶脆壳 · 柔软内芯', name: '冰皮西瓜捏捏', image: '冰皮西瓜捏捏.png', color: '#f4777e', material: 'ice', coreMaterial:'jelly', authoredDamage: true },
  { id: 'flower-bunny', tier:'starter', filling: '奶蜡脆壳 · 麻薯内芯', name: '花花小兔 v.3', image: '花花小兔 v.3.png', color: '#f2d3cf', material: 'mochi', coreMaterial:'mochi', authoredDamage: true },
  { id: 'sugar-bread', tier:'starter', filling: '薄糖脆壳 · 颗粒内芯', name: '冰糖面包 v.3', image: '面包1 v.3.png', color: '#f2d9ae', material: 'sugar', coreMaterial:'bread', coreTexture: 'granular', authoredDamage: true },
];

// Keep this order stable: local calendar days rotate through the available artwork.
export const dailyCharacters = ['hamster', 'cat-bread', 'watermelon', 'flower-bunny', 'sugar-bread']
  .map(id => characters.find(character => character.id === id)!);

export const starterCharacters = ['cat-bread', 'watermelon', 'flower-bunny', 'sugar-bread']
  .map(id => characters.find(character => character.id === id)!);
export const baseMysteryCharacters = characters.filter(c => c.tier === 'base-box');
export const hiddenMysteryCharacters = characters.filter(c => c.tier === 'hidden-box');
export const mysteryCharacters = [...baseMysteryCharacters,...hiddenMysteryCharacters];
export const isHiddenCharacter = (id: string): boolean => characters.find(c=>c.id===id)?.tier === 'hidden-box';
export const isBoxCharacter = (id: string): boolean => {
  const character = characters.find(c=>c.id===id);
  return !!character && character.tier !== 'starter';
};
