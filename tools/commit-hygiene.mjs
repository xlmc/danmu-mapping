import { spawnSync } from 'node:child_process';

function git(...args) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr || `git ${args[0]} failed`);
  return r.stdout;
}
const ci = process.argv.includes('--ci');
const install = process.argv.includes('--install');
if (install) {
  const current = spawnSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
  if (current.status !== 0 && current.status !== 1) throw new Error(current.stderr);
  if (current.stdout.trim() && current.stdout.trim() !== '.githooks') {
    throw new Error('Existing core.hooksPath found; integrate the hook manually instead of overwriting it.');
  }
  git('config', '--local', 'core.hooksPath', '.githooks');
  console.log('Commit hygiene hook enabled for this checkout.');
} else {
  const files = git(...(ci ? ['ls-files', '-z'] : ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']))
    .split('\0').filter(Boolean);
  const temporary = p => /^(?:work|outputs|\.ai-work|tmp-test-data)\//.test(p);
  const recordPath = p => /(?:^|\/)(?:AI[-_]?(?:WORK[-_]?)?(?:LOG|RECORDS?)|CHATGPT[-_]?(?:LOG|HISTORY)|CODEX[-_]?(?:LOG|HISTORY)|CONVERSATION[-_]?LOG)\.(?:md|txt|json|jsonl)$/i.test(p);
  const fixture = p => /(?:^|\/)(?:tests|fixtures|__tests__)(?:\/|$)/.test(p) || /\.test\.[cm]?js$/.test(p);
  const productionData = p => /^(?:Word|Source|config)\//.test(p);
  const synthetic = /上传链路验收测试\d*|仅用于链路验收请勿接纳/;
  const recordHeading = /^\s*#{1,6}\s*(?:AI 工作记录|AI 对话记录|Codex 任务记录|ChatGPT 对话记录|一次性验收记录)\s*$/im;
  let blocked = false;
  for (const p of files) {
    if (temporary(p)) {
      if (!ci) {
        // Only change the index; preserve the working file, including on an unborn branch.
        git('update-index', '--force-remove', '--', p);
      }
      console.error(`${ci ? 'Forbidden tracked temporary file' : 'Removed from staging; local file preserved'}: ${p}`);
      blocked = true;
      continue;
    }
    if (recordPath(p)) {
      console.error(`AI work record must not be committed: ${p}`);
      blocked = true;
      continue;
    }
    if (fixture(p) || (!productionData(p) && !/\.(?:md|txt)$/i.test(p))) continue;
    const content = git('show', `:${p}`);
    if (!fixture(p) && productionData(p) && synthetic.test(content)) {
      console.error(`Synthetic upload verification rule found: ${p}`);
      blocked = true;
    }
    if (/\.(?:md|txt)$/i.test(p) && !fixture(p) && recordHeading.test(content)) {
      console.error(`Possible AI/one-off work record; review and exclude it: ${p}`);
      blocked = true;
    }
  }
  if (blocked) {
    console.error('Commit hygiene check failed. Review staging and commit again; no working files were deleted.');
    process.exitCode = 1;
  } else console.log('Commit hygiene check passed.');
}
