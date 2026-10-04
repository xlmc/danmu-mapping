// Data-only protocol shared with the upload receiver. Never evaluate uploaded expressions.
export const MAX_RULES = 100;
export const MAX_BYTES = 65536;
export const titleKey = value => String(value).normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const platforms = new Set(['tencent','youku','iqiyi','imgo','bilibili','migu','sohu','leshi','hongguo','bahamut','dandan']);
const aliases = {qq:'tencent',qiyi:'iqiyi',bilibili1:'bilibili'};
const titleValid = s => s.length > 0 && s.length <= 240 && !!titleKey(s) && !/[\x00-\x1f\x7f]|->|=>|\{\[/.test(s);
const groupKey = s => [...new Set(s.split(/[|,]/).map(titleKey).filter(Boolean))].sort().join('|');
export function parseSharedRule(input) {
  if (!input || !['title','season'].includes(input.kind) || typeof input.line !== 'string'
      || Object.keys(input).some(k => !['kind','line'].includes(k))) throw new Error('规则只允许 kind 和 line');
  const line = input.line.trim();
  if (!line || line.length > 1024 || /[\x00-\x1f\x7f]/.test(line)) throw new Error('规则为空、过长或包含控制字符');
  if (input.kind === 'title') {
    const parts = line.split('->').map(s => s.trim());
    if (parts.length !== 2 || !parts.every(titleValid) || /;/.test(line)) throw new Error('标题规则格式须为 原始标题 -> 目标标题');
    const [sourceTitle,targetTitle] = parts;
    if (titleKey(sourceTitle) === titleKey(targetTitle)) throw new Error('标题规则没有实际映射效果');
    return {kind:'title',sourceTitle,targetTitle,line:`${sourceTitle} -> ${targetTitle}`,
      key:`title:${titleKey(sourceTitle)}`, value:titleKey(targetTitle)};
  }
  const m = line.match(/^(.+?)\s+S(\d+)E(\d+)(?:~E?(\d+))?(?:\s+\{\[group=([^\]}]+)\]\})?\s*->\s*(.+?)\s+S(\d+)E(\d+)(?:~E?(\d+))?(?:\s+@([\w-]+))?$/i);
  if (!m) throw new Error('季集规则格式不支持');
  const [,sourceTitle,season,start,end,group='',targetTitle,targetSeason,targetStart,targetEnd,rawPlatform=''] = m;
  if (![sourceTitle,targetTitle].every(titleValid) || !/^[\p{L}\p{N}_. ,|\-]*$/u.test(group)) throw new Error('标题或发布组包含不支持的内容');
  const platform = aliases[rawPlatform.toLowerCase()] || rawPlatform.toLowerCase();
  if (platform && !platforms.has(platform)) throw new Error('未知目标平台');
  const r = {kind:'season',sourceTitle,season:+season,start:+start,end:end===undefined?null:+end,
    group:groupKey(group),targetTitle,targetSeason:+targetSeason,targetStart:+targetStart,
    targetEnd:targetEnd===undefined?null:+targetEnd,platform};
  if (![r.season,r.targetSeason].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=999)
      || ![r.start,r.targetStart,...(r.end===null?[]:[r.end]),...(r.targetEnd===null?[]:[r.targetEnd])].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=9999)
      || (r.end===null)!==(r.targetEnd===null)
      || (r.end!==null&&(r.end<r.start||r.targetEnd<r.targetStart||r.end-r.start!==r.targetEnd-r.targetStart))) throw new Error('季集范围无效或两侧长度不同');
  r.line = `${sourceTitle} S${r.season}E${r.start}${r.end===null?'':`~E${r.end}`}${r.group?` {[group=${r.group}]}`:''} -> ${targetTitle} S${r.targetSeason}E${r.targetStart}${r.targetEnd===null?'':`~E${r.targetEnd}`}${platform?` @${platform}`:''}`;
  r.key = `season:${titleKey(sourceTitle)}:${r.season}:${r.start}:${r.end}:${r.group}:${platform}`;
  r.value = `${titleKey(targetTitle)}:${r.targetSeason}:${r.targetStart-r.start}`;
  return r;
}
export function rulesConflict(a,b) {
  if (a.kind!==b.kind) return false;
  if (a.kind==='title') return a.key===b.key&&a.value!==b.value;
  const groupsOverlap = !a.group&&!b.group || (a.group&&b.group&&a.group.split('|').some(g=>b.group.split('|').includes(g)));
  return titleKey(a.sourceTitle)===titleKey(b.sourceTitle)&&a.season===b.season&&a.platform===b.platform
    && !!groupsOverlap && Math.max(a.start,b.start)<=Math.min(a.end??Infinity,b.end??Infinity) && a.value!==b.value;
}
export function validateSubmission(payload, existing=[]) {
  if (!payload || payload.version!==1 || !Array.isArray(payload.rules) || !payload.rules.length || payload.rules.length>MAX_RULES
      || Object.keys(payload).some(k=>!['version','rules'].includes(k))) throw new Error('上传格式错误：version=1，rules 为 1~100 条规则');
  const result = {accepted:[],duplicate:[],conflict:[],invalid:[]};
  const parsed=[];
  payload.rules.forEach((input,index)=>{try {parsed.push({index,rule:parseSharedRule(input)});} catch(e) {result.invalid.push({index,reason:e.message});}});
  const graph = new Map();
  for (const r of [...existing,...parsed.map(p=>p.rule)].filter(r=>r.kind==='title')) {
    if(!graph.has(r.key.slice(6))) graph.set(r.key.slice(6),new Set());
    graph.get(r.key.slice(6)).add(r.value);
  }
  const cycle = r => {
    const source=r.key.slice(6), queue=[r.value],seen=new Set();
    while(queue.length) {const n=queue.pop();if(n===source)return true;if(seen.has(n))continue;seen.add(n);for(const target of graph.get(n)||[])queue.push(target);}
    return false;
  };
  const seen=new Set(existing.map(r=>r.key+'\0'+r.value));
  for(const {index,rule:r} of parsed) {
    if([...existing,...parsed.filter(p=>p.index!==index).map(p=>p.rule)].some(other=>rulesConflict(r,other))) {result.conflict.push({index,reason:'同条件规则指向不同目标或重叠区间偏移不同'});continue;}
    if(r.kind==='title'&&cycle(r)) {result.invalid.push({index,reason:'标题映射构成循环'});continue;}
    const key=r.key+'\0'+r.value;
    if(seen.has(key)) {result.duplicate.push({index});continue;}
    seen.add(key);result.accepted.push({kind:r.kind,line:r.line});
  }
  return result;
}
export function parsePublishedRules(titleText,seasonText) {
  const result=[];
  for(const [kind,text] of [['title',titleText],['season',seasonText]]) for(const line of text.split(/\r?\n/)) {
    if(!line.trim()||/^\s*(#|\/\/)/.test(line))continue;
    try {result.push(parseSharedRule({kind,line}));} catch {} // Legacy unsupported rules stay outside this limited sharing grammar.
  }
  return result;
}
export function canonicalSubmission(rules) {
  return JSON.stringify({version:1,rules:[...rules].sort((a,b)=>(a.kind+'\0'+a.line).localeCompare(b.kind+'\0'+b.line,'en'))});
}
export async function submissionId(rules) {
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalSubmission(rules)));
  return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
