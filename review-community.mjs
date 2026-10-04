#!/usr/bin/env node
import crypto from 'node:crypto';
// Upload != approval. Only --approve + --confirm-reviewed may add rules to the published community registry.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSharedRule, parsePublishedRules, validateSubmission, canonicalSubmission } from './community-rules.mjs';
const read = p => fs.existsSync(p) ? fs.readFileSync(p,'utf8') : '';
export function loadCommunity(word) {
  const file=path.join(word,'community','accepted.json');
  if(!fs.existsSync(file))return [];
  if(fs.statSync(file).size>8*1024*1024)throw new Error('社区规则清单过大');
  const data=JSON.parse(read(file));
  if(data.version!==1||data.business_verified!==true||!Array.isArray(data.rules)||data.rules.length>10000)throw new Error('社区规则缺少人工业务核验声明');
  const result=validateSubmissionBatches(data.rules);
  if(result.invalid.length||result.conflict.length)throw new Error('已接纳社区规则无效或相互冲突');
  return data.rules.map(parseSharedRule);
}
function validateSubmissionBatches(rules,existing=[]) {
  const all={accepted:[],duplicate:[],conflict:[],invalid:[]};
  for(let i=0;i<rules.length;i+=100) {
    const check=validateSubmission({version:1,rules:rules.slice(i,i+100)},existing);
    for(const k of Object.keys(all))all[k].push(...check[k]);
    existing=[...existing,...check.accepted.map(parseSharedRule)];
  }
  // Check across batches including cycles and conflicts in both directions.
  for(const rule of all.accepted) {
    const parsed=parseSharedRule(rule);
    const check=validateSubmission({version:1,rules:[rule]},existing.filter(r=>r.key!==parsed.key||r.value!==parsed.value));
    all.conflict.push(...check.conflict);all.invalid.push(...check.invalid);
  }
  return all;
}
export function reviewCommunity(word,approve=[],confirmed=false) {
  if(approve.length&&!confirmed)throw new Error('接纳前必须显式确认已核对作品、平台和季集关系：--confirm-reviewed');
  if(!approve.every(id=>/^[a-f0-9]{64}$/.test(id)))throw new Error('提交编号必须是 64 位十六进制哈希');
  const published=parsePublishedRules(read(path.join(word,'2026.txt')),read(path.join(word,'season-candidates.txt')));
  const community=loadCommunity(word);
  const dir=path.join(word,'submissions');
  const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).sort():[];
  const submissions=[];
  for(const name of files) {
    const raw=read(path.join(dir,name));if(Buffer.byteLength(raw)>131072)throw new Error('提交文件过大');
    const data=JSON.parse(raw);
    if(data.version!==1||data.id!==name.slice(0,-5)||data.status!=='pending_review')throw new Error('提交文件元数据无效');
    const validation=validateSubmission({version:1,rules:data.rules});
    if(validation.invalid.length||validation.conflict.length||validation.duplicate.length)throw new Error('提交文件不是规范有效规则集');
    const hash=crypto.createHash('sha256').update(canonicalSubmission(validation.accepted)).digest('hex');
    if(hash!==data.id)throw new Error('提交哈希与内容不一致');
    submissions.push({id:data.id,rules:data.rules,initial:validation});
  }
  const parsedPending=submissions.flatMap(s=>s.initial.accepted.map(parseSharedRule));
  const base=[...published,...community];
  const reports=submissions.map(s=>{
    const ownKeys=new Set(s.initial.accepted.map(r=>{const p=parseSharedRule(r);return p.key+'\0'+p.value;}));
    // Same-content pending rules are duplicates, not conflicts. All different targets participate in conflict checks.
    const otherPending=parsedPending.filter(r=>!ownKeys.has(r.key+'\0'+r.value));
    const result=validateSubmission({version:1,rules:s.rules},[...base,...otherPending]);
    return {id:s.id,status:result.invalid.length||result.conflict.length?'blocked':result.accepted.length?'needs_business_verification':'duplicate_only',...result};
  });
  // Fail the entire requested approval atomically; never partially accept a bad batch.
  const chosen=approve.map(id=>{const r=reports.find(s=>s.id===id);if(!r)throw new Error('提交编号不存在');if(r.invalid.length||r.conflict.length)throw new Error('提交存在无效或冲突规则，不能接纳');return r;});
  const toAdd=chosen.flatMap(s=>s.accepted);
  let added=0;
  if(toAdd.length) {
    // A shared pending rule may occur in multiple submissions. Deduplicate the approval union.
    const check=validateSubmissionBatches(toAdd,base);
    if(check.conflict.length||check.invalid.length)throw new Error('接纳批次存在冲突或无效规则');
    added=check.accepted.length;
    const accepted=[...community.map(r=>({kind:r.kind,line:r.line})),...check.accepted];
    const data={version:1,business_verified:true,rules:accepted};
    const out=path.join(word,'community','accepted.json');fs.mkdirSync(path.dirname(out),{recursive:true});
    fs.writeFileSync(out+'.tmp',JSON.stringify(data,null,2)+'\n');fs.renameSync(out+'.tmp',out);
  }
  return {published:published.length,pending:reports.filter(r=>r.status==='needs_business_verification').length,total_submissions:reports.length,approved:added,submissions:reports};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2), wi=args.indexOf('--word');
    const word=wi>=0?args[wi+1]:'Word';
    const ai=args.indexOf('--approve');const ids=ai>=0?(args[ai+1]||'').split(/[\s,]+/).filter(Boolean):[];
    const report=reviewCommunity(word,ids,args.includes('--confirm-reviewed'));
    const ri=args.indexOf('--report');if(ri>=0)fs.writeFileSync(args[ri+1],JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
