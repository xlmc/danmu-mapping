import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { collapseTitleAliases, expandRuleAliases, findRuleConflicts, parseRuntimeRule, proposeMoviePilotRule } from '../rule-tools.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

test('上游别名链只按明确映射折叠，循环不猜测标准名', () => {
  const map = new Map([['Jade Dynasty Ⅱ', '诛仙动画'], ['诛仙动画', '诛仙'], ['甲', '乙'], ['乙', '甲']]);
  collapseTitleAliases(map);
  assert.equal(map.get('Jade Dynasty Ⅱ'), '诛仙');
  assert.equal(map.get('甲'), '乙');
});

test('四部国漫的别名保持季集、范围、发布组和目标平台', () => {
  const aliases = new Map([['Tomb.of.Fallen.Gods', '神墓'], ['IMMORTALITY', '永生'],
    ['A.Will.Eternal', '一念永恒'], ['Yi.Nian.Yong.Heng', '一念永恒'], ['Jade.Dynasty', '诛仙']]);
  const original = ['神墓 S02E1~E27 -> 神墓 辰南觉醒 S01E17~E43 @youku',
    '永生 S04E1~E16 -> 永生 S01E41~E56 @bilibili',
    '一念永恒 S01E107~E165 -> 一念永恒 第3季 S01E1~E59 @tencent',
    '诛仙 S01E27~E52 {[group=ADWeb]} -> 诛仙 第2季 S01E1~E26 @tencent'];
  const expanded = expandRuleAliases(original, aliases).map(parseRuntimeRule);
  for (const [alias, chinese] of aliases) {
    const a = expanded.find(rule => rule.sourceTitle === alias);
    const b = expanded.find(rule => rule.sourceTitle === chinese);
    assert.deepEqual({ ...a, sourceTitle: chinese }, b);
  }
  assert.deepEqual(findRuleConflicts(expandRuleAliases(original, aliases)), []);
});

test('季号限定的标题不会扩成全季别名', () => {
  const lines = ['目标 S01E1~E2 -> 平台目标 S01E11~E12'];
  assert.equal(expandRuleAliases(lines, new Map([['英文 S02', '目标']])).length, 1);
});

test('冲突检查容许独立平台/发布组与开放转折，拒绝同条件矛盾区间', () => {
  assert.equal(findRuleConflicts(['作品 S01E1~E3 -> 目标 S01E1~E3',
    '作品 S01E2~E4 -> 目标 S01E12~E14']).length, 1);
  assert.equal(findRuleConflicts(['作品 S01E1~E3 {[group=ADWeb|HHWEB]} -> 目标 S01E1~E3 @qq',
    '作品 S01E2~E4 {[group=ADWeb]} -> 目标 S01E12~E14 @tencent']).length, 1);
  assert.deepEqual(findRuleConflicts(['作品 S01E1 -> 目标 S01E1',
    '作品 S01E10 -> 目标 S02E1',
    '作品 S01E1~E3 {[group=ADWeb]} -> 目标 S01E11~E13',
    '作品 S01E1~E3 -> 目标 S01E21~E23 @tencent']), []);
});

test('范围必须有效、等长且两端都有界', () => {
  for (const line of ['作品 S00E1 -> 目标 S01E1', '作品 S01E0 -> 目标 S01E1',
    '作品 S01E1~E3 -> 目标 S01E1~E2', '作品 S01E1~E3 -> 目标 S01E1']) {
    assert.equal(parseRuntimeRule(line), null);
  }
});

test('MoviePilot 偏移只生成带原始条件的审核候选，不扩大不连续区间', () => {
  const eternal = proposeMoviePilotRule('IMMORTALITY.S01(?=.*E(4[1-9]|5[0-6]).*ADWeb) => IMMORTALITY.S04 && S04 <> 2022 >> EP-40');
  assert.equal(eternal[0].suggestedRule, 'IMMORTALITY S1E41~E56 {[group=ADWeb]} -> IMMORTALITY S4E1~E16');
  assert.equal(eternal[0].status, 'needs-platform-verification');
  const tomb = proposeMoviePilotRule('神墓.Tomb.of.Fallen.Gods.S01E(1[7-9]|[3-9][0-9])(?=.*HHWEB) => 神墓.S02E\\1 && S02 <> 2022 >> EP-16');
  assert.equal(tomb.length, 2);
  assert.ok(tomb.every(item => !item.suggestedRule.includes('E20')));
  const open = proposeMoviePilotRule('A.Will.Eternal.S03 => A.Will.Eternal.S01 && S01 <> 2024 >> EP+106');
  assert.equal(open[0].bounded, false);
  assert.equal(open[0].suggestedRule, 'A.Will.Eternal S3E1 -> A.Will.Eternal S1E107');
});

function conversion(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danmu-mapping-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'Word'));
    const invoke = inputs => spawnSync(process.execPath, [path.join(root, 'convert-moviepilot-words.mjs'), ...inputs, '--out', 'Word'],
      { cwd: dir, encoding: 'utf8' });
    run(dir, invoke);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('真实入口：人工别名优先，偏移不发布，报告与缓存重跑保持一致', () => conversion((dir, invoke) => {
  fs.writeFileSync(path.join(dir, 'upstream.txt'), 'Jade.Dynasty => 旧标题\nIMMORTALITY.S01(?=.*E(4[1-9]|5[0-6]).*ADWeb) => IMMORTALITY.S04 && S04 <> 2022 >> EP-40\n');
  fs.writeFileSync(path.join(dir, 'my-words.txt'), 'Jade.Dynasty => 诛仙\n');
  fs.writeFileSync(path.join(dir, 'Word/auto-match-draft.txt'), '诛仙 S02E1~E26 -> 诛仙 第2季 S01E1~E26 @tencent\n');
  const first = invoke(['upstream.txt', 'my-words.txt']);
  assert.equal(first.status, 0, first.stderr);
  const title = fs.readFileSync(path.join(dir, 'Word/2026.txt'), 'utf8');
  const season = fs.readFileSync(path.join(dir, 'Word/season-candidates.txt'), 'utf8');
  assert.match(title, /Jade Dynasty->诛仙/);
  assert.match(season, /Jade\.Dynasty S2E1~E26 -> 诛仙 第2季 S1E1~E26 @tencent/);
  assert.doesNotMatch(season, /IMMORTALITY/);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'Word/conversion-report.json')));
  assert.equal(report.titleConflicts.length, 1);
  assert.equal(report.pending[0].source, 'upstream.txt');
  assert.equal(report.pending[0].proposals.length, 1);
  const second = invoke(['upstream.txt', 'my-words.txt']);
  assert.match(second.stdout, /复用缓存/);
  assert.equal(fs.readFileSync(path.join(dir, 'Word/season-candidates.txt'), 'utf8'), season);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'Word/conversion-report.json'))), report);
}));

test('人工冲突阻止覆盖旧运行时表，失败时仍输出报告', () => conversion((dir, invoke) => {
  fs.writeFileSync(path.join(dir, 'source.txt'), '英文标题 => 中文标题\n');
  fs.writeFileSync(path.join(dir, 'Word/2026.txt'), 'old-title');
  fs.writeFileSync(path.join(dir, 'Word/season-candidates.txt'), 'old-season');
  fs.writeFileSync(path.join(dir, 'Word/auto-match-draft.txt'), '作品 S01E1~E3 -> 目标 S01E1~E3\n作品 S01E2~E4 -> 目标 S01E12~E14\n');
  assert.equal(invoke(['source.txt']).status, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'Word/2026.txt'), 'utf8'), 'old-title');
  assert.equal(fs.readFileSync(path.join(dir, 'Word/season-candidates.txt'), 'utf8'), 'old-season');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'Word/conversion-report.json'))).seasonConflicts.length, 1);
}));
