#!/usr/bin/env node
// 将 MoviePilot 共享识别词文件（Putarku/MoviePilot-Help 等）转换为 danmu_api 剧名映射表格式。
//
// 产出两个文件：
//   1. <outDir>/2026.txt            —— 「原始标题->映射标题」精确映射，供 TITLE_MAPPING_TABLE_URL 使用
//   2. <outDir>/season-candidates.txt —— 季/集修正类规则候选，需人工整理后配置到 AUTO_MATCH_MAPPING_TABLE
//
// 用法：node convert-moviepilot-words.mjs <输入文件1> [输入文件2 ...] [--out <目录>]
//   输入可以是本地路径，也可以是 http(s) URL（GitHub Action 中直接用上游 raw 链接）。
//   本机需代理时请先用 curl 下载为本地文件再传入。

import fs from 'node:fs';
import path from 'node:path';

// ================= 配置 =================
const OUT_DIR = (() => {
  const i = process.argv.indexOf('--out');
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : '.';
})();
const SOURCES = process.argv.slice(2).filter((a, i, arr) => a !== '--out' && arr[i - 1] !== '--out');
const GENERATED_AT = new Date().toISOString().slice(0, 10);

// 左侧含任一字符即视为正则规则（无法作为精确匹配键），转入季集候选清单
const REGEX_META = /[\\()\[\]{}?*+|^$]/;

// 噪声规则黑名单：上游维护者误粘贴的报错文本、编码/音轨标签替换规则
const NOISE_KEY = /^(bad character range|hi10p|ma10p|hevc[\w ]*|chs&jpn|cht&jpn|jpsc&jptc|srtx\d+)/i;
// 目标命中即整条丢弃：字幕组/字幕社/汉化组名归一化、编码标签目标（对多源标题匹配均为噪声）
const NOISE_TARGET = /(字幕[组社]|汉化组|1080p|2160p|x26[45]|hi10p|ma10p|10bit)/i;
// 纯字母键最小长度：低于此长度的短键（DMG/UHA/YUI 类字幕组缩写）误伤风险大于价值
const BARE_ALPHA_MIN = 4;

// 目标标题清理：danmu_api 的 titleMatches 是「源条目名包含查询词」方向，
// 目标名里的年份/季区间/尾缀孤立字母会阻碍 B站、爱优腾芒、renren、dandan、hanjutv
// 各源条目名的包含匹配（如「三体.2024」无法命中条目「三体」）。
// 年份过滤由 match 的 year 参数承担，目标名保持最短通用形态即可。
function cleanTargetTitle(target) {
  return target
    // 尾部年份：.2024 / (2023) / 2011-2019 区间 / 空格年份
    .replace(/[\s._]*\(?(?:19|20)\d{2}\)?(?:\s*-\s*(?:19|20)\d{2}\)?)*$/, '')
    // 尾部季区间：黑镜S01-S05
    .replace(/[\s._]*S\d{1,2}\s*-\s*S\d{1,2}$/i, '')
    // 尾部孤立字母集标：十品官吴山羊.E / .P
    .replace(/[\s._]+[A-Za-z]$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readSource(src) {
  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`拉取失败 ${res.status}: ${src}`);
    return { name: src, text: await res.text() };
  }
  return { name: src, text: fs.readFileSync(src, 'utf-8') };
}

function convertLine(rawLine, stats, mappings, candidates) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#') || line.startsWith('//')) return;

  const arrowIdx = line.indexOf('=>');
  if (arrowIdx === -1) return; // 裸屏蔽词行（general.txt 类），精确映射表无法表达
  const left = line.slice(0, arrowIdx).trim();
  let right = line.slice(arrowIdx + 2);
  if (!left) return;

  // 集数偏移标记（需在裁剪前检测）
  const epOffset = right.match(/>>\s*EP([+-]\d+)/);

  // 裁剪 MoviePilot 专有后缀：&& 优先级词 / <> 排除词 / >> 集数偏移（从首个标记处截断）
  right = right.replace(/\s*&&[\s\S]*$|\s*<>[\s\S]*$|\s*>>[\s\S]*$/, '');

  // 剥离 TMDB 锚点 {[tmdbid=...;type=tv;s=2]}，折叠多余空格
  right = right.replace(/\{\[[^\]}]*\]\}/g, '').replace(/\s+/g, ' ').trim();

  // 右侧结尾季数标记（空格或点连接），先取出再剥离
  const seasonTail = right.match(/[\s.](S\d{1,2})$/);
  const rightSeason = seasonTail?.[1];
  if (seasonTail) right = right.slice(0, right.length - seasonTail[0].length).trim();

  // 噪声规则黑名单：误粘贴文本/编码标签键、字幕组与编码标签目标、过短纯字母键
  if (NOISE_KEY.test(left) || NOISE_TARGET.test(right)
      || (/^[A-Za-z]+$/.test(left) && left.length < BARE_ALPHA_MIN)) {
    stats.noise++;
    return;
  }

  // 目标清理为最短通用形态（去年份/季区间/尾缀字母），适配多源包含匹配
  right = cleanTargetTitle(right);

  // 锚定残留：目标为纯 ASCII 且是左侧的子串（如 Pokemon.Best.Wishes.2010->Pokemon、
  // OVERLORD II->OVERLORD），这是 TMDB 锚点剥离后的残留词，对弹幕源搜索无意义，
  // 罗马数字季标归一类的规则也在此列（正确做法是走 AUTO_MATCH 季路由）
  if (/^[\x20-\x7E]+$/.test(right) && left.toLowerCase().includes(right.toLowerCase())) {
    stats.anchorResidue++;
    return;
  }

  const leftSeason = left.match(/[\s._-](S\d{1,2})\b/i)?.[1]?.toUpperCase();
  const plainLeft = !REGEX_META.test(left);

  // 分类一：季数错位 / 集数偏移 / 正则条件——标题映射表无法表达，进候选清单
  if (!plainLeft || epOffset || (rightSeason && leftSeason && rightSeason !== leftSeason)) {
    candidates.push({
      reason: !plainLeft ? '正则条件（左侧含正则语法）'
        : epOffset ? `集数偏移 ${epOffset[1]}`
        : `季数错位 ${leftSeason}→${rightSeason}`,
      raw: line,
      title: right || left,
    });
    stats.seasonCandidates++;
    return;
  }

  // 分类二：清洗后右侧为空 = 纯 TMDB 锚定规则（无可用的标题信息）
  if (!right) { stats.anchorOnly++; return; }

  // 分类三：清洗后右侧与左侧相同 = 自我锚定，对弹幕搜索无意义
  if (right === left) { stats.identity++; return; }

  // 正常标题映射（同一左侧只保留首条，重复的记数）
  if (mappings.has(left)) { stats.duplicates++; return; }
  mappings.set(left, right);
  stats.mappings++;
}

// ================= 裸标题变体 =================
// match 场景下文件名先被解析为 title+season+year（如 Moving.S01E01.2023 → "Moving"+S1+2023），
// 带 S01/年份后缀的键会因精确匹配失败而漏映射，裸标题落入聚合搜索后容易错配同年份的
// 同名/近名词（实测 Moving.S01E01 错配“搬到京都”别名 Moving in Kyoto）。
// 因此为每个带季/年尾缀的键额外生成剥除后的裸键变体；多键剥出同一裸键但目标不同时
// 视为歧义跳过（如 Psycho.Detective 2017/2019 两季）；目标本身含季区间（S01-S05）的跳过，
// 这类目标只适合 search 场景原样使用，不适合作为 match 裸键的落点。
const SEASON_RANGE_TARGET = /S\d{1,2}\s*-\s*S\d{1,2}/;

function stripTrailingSeasonOrYear(key) {
  let prev = null;
  let cur = key;
  while (prev !== cur) {
    prev = cur;
    cur = cur
      .replace(/[\s._-]+S\d{1,2}$/i, '')
      .replace(/[\s._-]+(?:19|20)\d{2}$/, '')
      .trim();
  }
  return cur;
}

function* keyVariants(key) {
  // 剥季/年裸键：覆盖 match 解析剥离季/年后的形态
  const bare = stripTrailingSeasonOrYear(key);
  if (bare && bare !== key) yield bare;
  // 点号→空格：danmu_api 的 match 会把文件名点号规范化为空格（3.Body.Problem → 3 Body Problem），
  // 而映射表是零归一化的全名精确匹配，点号键在 match 场景永远失配，需同时提供空格形态；
  // 点号键保留供 search 场景（用户手输完整资源名）
  if (key.includes('.')) {
    yield key.replace(/\./g, ' ');
    if (bare && bare !== key && bare.includes('.')) yield bare.replace(/\./g, ' ');
  }
}

function deriveBareKeyVariants(mappings, stats) {
  const variants = new Map();
  const ambiguous = new Set();
  for (const [key, target] of mappings) {
    for (const variant of keyVariants(key)) {
      if (!variant || mappings.has(variant)) continue;
      if (SEASON_RANGE_TARGET.test(target)) continue;
      if (variants.has(variant) && variants.get(variant) !== target) {
        ambiguous.add(variant);
        continue;
      }
      variants.set(variant, target);
    }
  }
  for (const variant of ambiguous) variants.delete(variant);
  for (const [variant, target] of variants) mappings.set(variant, target);
  stats.bareVariants = variants.size;
  stats.bareAmbiguous = ambiguous.size;
}

async function main() {
  const stats = { mappings: 0, seasonCandidates: 0, anchorOnly: 0, identity: 0, duplicates: 0, bareVariants: 0, bareAmbiguous: 0, noise: 0, anchorResidue: 0 };
  const mappings = new Map();
  const candidates = [];

  for (const src of SOURCES) {
    const { name, text } = await readSource(src);
    for (const line of text.split(/\r?\n/)) convertLine(line, stats, mappings, candidates);
  }

  deriveBareKeyVariants(mappings, stats);

  const header = [
    `# danmu_api 剧名映射表（由 MoviePilot 共享识别词自动转换）`,
    `# 转换日期: ${GENERATED_AT} | 规则数: ${stats.mappings + stats.bareVariants}（原始 ${stats.mappings} + 裸标题变体 ${stats.bareVariants}）`,
    `# 用法: danmu_api 环境变量 TITLE_MAPPING_TABLE_URL 填本文件的 raw 直链`,
    `# 季/集修正类规则不在此文件，见 season-candidates.txt（配置到 AUTO_MATCH_MAPPING_TABLE）`,
  ].join('\n');

  const mappingText = header + '\n\n' + [...mappings.entries()].map(([k, v]) => `${k}->${v}`).join('\n') + '\n';
  const candidatesText = [
    `# 季/集修正规则候选（自动提取，需人工核对后使用）`,
    `# 生成日期: ${GENERATED_AT} | 共 ${candidates.length} 条`,
    `# 使用方式: 按官方 AUTO_MATCH_MAPPING_TABLE 语法改写后配置到本地环境变量，`,
    `#           语法: 剧名 S源季E源集 -> 剧名 S目标季E目标集（集数范围用 ~，如 E01~E12）`,
    `# 以下按原因分组，== 原始规则 == 后附提取出的目标标题/季数/偏移信息`,
    '',
    ...candidates.map(c => `# [${c.reason}] ${c.raw}\n#   → 目标: ${c.title}`),
  ].join('\n') + '\n';

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, '2026.txt'), mappingText);
  fs.writeFileSync(path.join(OUT_DIR, 'season-candidates.txt'), candidatesText);

  console.log(`规则统计: 标题映射 ${stats.mappings} | 裸标题变体 +${stats.bareVariants}（歧义跳过 ${stats.bareAmbiguous}） | 季集候选 ${stats.seasonCandidates} | 噪声跳过 ${stats.noise} | 锚定残留跳过 ${stats.anchorResidue} | 纯锚定跳过 ${stats.anchorOnly} | 自我锚定跳过 ${stats.identity} | 重复跳过 ${stats.duplicates}`);
  console.log(`输出: ${path.join(OUT_DIR, '2026.txt')} / ${path.join(OUT_DIR, 'season-candidates.txt')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
