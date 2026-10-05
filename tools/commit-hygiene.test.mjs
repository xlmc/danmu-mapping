import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const script = fileURLToPath(new URL('./commit-hygiene.mjs', import.meta.url));
function repo(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'commit-hygiene-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  git('init', '-q'); git('config', 'user.name', 'test'); git('config', 'user.email', 'test@example.invalid');
  const put = (p, text) => { mkdirSync(dirname(join(cwd,p)), { recursive: true }); writeFileSync(join(cwd,p), text); };
  const check = (...args) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  return { cwd, git, put, check };
}
test('temporary staged files are excluded, retained locally, and commit is paused on unborn HEAD', t => {
  const r = repo(t); r.put('outputs/a space.txt', 'scratch'); r.put('src.js', 'export const x=1;'); r.git('add', '.');
  assert.equal(r.check().status, 1);
  assert.equal(existsSync(join(r.cwd,'outputs/a space.txt')), true);
  assert.deepEqual(r.git('diff','--cached','--name-only').trim().split('\n'), ['src.js']);
  assert.equal(r.check().status, 0);
});
test('partial staging preserved and all known temporary directories excluded', t => {
  const r = repo(t); r.put('src.js','first'); r.git('add','.'); r.git('commit','-qm','initial');
  r.put('src.js','staged'); r.git('add','src.js'); r.put('src.js','unstaged');
  for(const d of ['work','.ai-work','tmp-test-data']) { r.put(`${d}/x.txt`,'scratch'); r.git('add',`${d}/x.txt`); }
  assert.equal(r.check().status,1);
  assert.equal(r.git('show',':src.js'),'staged');
  assert.equal(readFileSync(join(r.cwd,'src.js'),'utf8'),'unstaged');
});
test('normal regression fixtures and Agent titles are accepted', t => {
  const r=repo(t); r.put('tests/fixtures/rule.txt','上传链路验收测试20261004');
  r.put('Word/2026.txt','Agent Backkom => 贝肯熊'); r.put('README.md','# 功能说明\n测试用法'); r.git('add','.');
  assert.equal(r.check().status,0); assert.equal(r.check('--ci').status,0);
});
test('synthetic production mappings and AI record files/headings are rejected', t => {
  for(const [p,s] of [['Word/submissions/a.json','{"title":"仅用于链路验收请勿接纳"}'],['Source/rules.txt','上传链路验收测试20261004'],['docs/AI-WORK-LOG.md','notes'],['docs/notes.md','# AI 对话记录']]) {
    const r=repo(t); r.put(p,s); r.git('add','.'); assert.equal(r.check().status,1,p); assert.equal(r.check('--ci').status,1,p);
  }
});
test('CI blocks tracked temporary data without mutating the index', t => {
  const r=repo(t); r.put('outputs/report.txt','scratch'); r.git('add','.');
  assert.equal(r.check('--ci').status,1); assert.equal(r.git('ls-files').trim(),'outputs/report.txt');
});
test('installer preserves an existing custom hook path', t => {
  const r=repo(t); r.git('config','core.hooksPath','custom-hooks'); assert.notEqual(r.check('--install').status,0);
  assert.equal(r.git('config','--get','core.hooksPath').trim(),'custom-hooks');
});
test('real pre-commit hook blocks junk, then permits clean commit', t => {
  const r=repo(t); r.put('.githooks/pre-commit',`#!/bin/sh\nexec node "${script.replace(/\\/g,'/')}"\n`);
  chmodSync(join(r.cwd,'.githooks/pre-commit'), 0o755);
  assert.equal(r.check('--install').status,0);
  r.put('outputs/example.txt','temporary'); r.put('feature.js','export default true;'); r.git('add','.');
  r.git('update-index','--chmod=+x','.githooks/pre-commit');
  const commit=()=>spawnSync('git',['commit','-qm','feature'],{cwd:r.cwd,encoding:'utf8'});
  assert.notEqual(commit().status,0); assert.equal(existsSync(join(r.cwd,'outputs/example.txt')),true);
  assert.equal(commit().status,0);
});
