import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseSharedRule,validateSubmission,submissionId} from '../community-rules.mjs';
import {reviewCommunity,loadCommunity} from '../review-community.mjs';
import worker from '../upload-worker/worker.mjs';
const title=line=>({kind:'title',line});
const season=line=>({kind:'season',line});
const check=(rules,base=[])=>validateSubmission({version:1,rules},base.map(parseSharedRule));
test('protocol: strict data-only grammar, semantic duplicates, limits, cycles and both-sided conflicts',()=>{
  assert.equal(check([title('Ａ.B -> Target'),title('a b -> target')]).duplicate.length,1);
  assert.equal(check([title('A -> B'),title('A -> C')]).conflict.length,2);
  assert.equal(check([title('A -> B'),title('B -> A')]).invalid.length,2);
  assert.equal(check([title('C -> A')],[title('A -> B'),title('B -> C')]).invalid.length,1);
  for(const line of ['A -> A','A -> B -> C','A;X -> B','A\n -> B','-> B'])assert.equal(check([title(line)]).invalid.length,1);
  assert.throws(()=>check(Array(101).fill(title('A -> B'))));
  assert.throws(()=>validateSubmission({version:1,rules:[title('A -> B')],token:'no'}));
  assert.equal(check([{...title('A -> B'),script:'no'}]).invalid.length,1);
});
test('season: ranges, platforms, literal groups and conflicting overlaps',()=>{
  for(const line of ['A S0E1 -> B S1E1','A S1E0 -> B S1E1','A S1E1~E3 -> B S1E1~E2','A S1E1~E3 -> B S1E1','A S1E1 -> B S1E1 @evil','A S1E1 {[group=(.*)]} -> B S1E1'])assert.equal(check([season(line)]).invalid.length,1,line);
  assert.equal(check([season('A S01E1~E3 {[group=Foo|Bar]} -> B S1E4~E6 @qq'),season('A S1E1~E3 {[group=bar|foo]} -> B S1E4~E6 @tencent')]).duplicate.length,1);
  assert.equal(check([season('A S1E1~E3 -> B S1E4~E6'),season('A S1E2~E4 -> C S1E2~E4')]).conflict.length,2);
  assert.equal(check([season('A S1E1 -> B S1E1 @qq'),season('A S1E1 -> C S1E1 @youku')]).accepted.length,2);
});
async function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'community-'));try{fs.mkdirSync(path.join(dir,'submissions'));await fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
async function pending(dir,rules){const id=await submissionId(rules);fs.writeFileSync(path.join(dir,'submissions',id+'.json'),JSON.stringify({version:1,id,status:'pending_review',rules}));return id;}
test('review: pending never published, approval gated, deduped counts, tampering rejected',()=>fixture(async dir=>{
  const id=await pending(dir,[title('Alias -> Target')]);
  assert.deepEqual(loadCommunity(dir),[]);
  assert.equal(reviewCommunity(dir).submissions[0].status,'needs_business_verification');
  assert.throws(()=>reviewCommunity(dir,[id]),/confirm-reviewed/);
  assert.equal(reviewCommunity(dir,[id],true).approved,1);
  assert.equal(loadCommunity(dir).length,1);
  assert.equal(reviewCommunity(dir,[id],true).approved,0);
  const p=path.join(dir,'submissions',id+'.json');const data=JSON.parse(fs.readFileSync(p));data.rules=[title('Wrong -> Other')];fs.writeFileSync(p,JSON.stringify(data));
  assert.throws(()=>reviewCommunity(dir),/哈希/);
}));
test('review: conflicting pending uploads block both without partial approval',()=>fixture(async dir=>{
  const a=await pending(dir,[title('A -> B')]);await pending(dir,[title('A -> C')]);
  const report=reviewCommunity(dir);assert.ok(report.submissions.every(s=>s.status==='blocked'));
  assert.throws(()=>reviewCommunity(dir,[a],true),/冲突/);assert.deepEqual(loadCommunity(dir),[]);
}));
test('review: cross-batch cycles in approved registry are rejected',()=>fixture(async dir=>{
  fs.mkdirSync(path.join(dir,'community'));
  const rules=Array.from({length:100},(_,i)=>title(`a${i} -> a${i+1}`));rules.push(title('a100 -> a0'));
  fs.writeFileSync(path.join(dir,'community/accepted.json'),JSON.stringify({version:1,business_verified:true,rules}));
  assert.throws(()=>loadCommunity(dir),/无效/);
}));
test('converter real CLI excludes pending, includes approved, preserves files on upstream cycle',()=>fixture(async dir=>{
  const root=fileURLToPath(new URL('../',import.meta.url));const source=path.join(dir,'source.txt');fs.writeFileSync(source,'X => Y\n');
  const rules=[title('Alias -> Target'),season('Show S2E1~E2 -> PlatformShow S1E11~E12 @tencent')];const id=await pending(dir,rules);
  const run=()=>spawnSync(process.execPath,[path.join(root,'convert-moviepilot-words.mjs'),source,'--out',dir],{encoding:'utf8'});
  assert.equal(run().status,0);assert.ok(!fs.readFileSync(path.join(dir,'2026.txt'),'utf8').includes('Alias'));
  reviewCommunity(dir,[id],true);const res=run();assert.equal(res.status,0,res.stderr);
  const text=fs.readFileSync(path.join(dir,'2026.txt'),'utf8');assert.match(text,/Alias->Target/);
  assert.match(fs.readFileSync(path.join(dir,'season-candidates.txt'),'utf8'),/PlatformShow/);
  fs.writeFileSync(source,'Target => Alias\n');assert.notEqual(run().status,0);assert.equal(fs.readFileSync(path.join(dir,'2026.txt'),'utf8'),text);
}));
const env={UPLOADS_ENABLED:'true',GITHUB_TOKEN:'secret-fixture',IP_LIMITER:{limit:async()=>({success:true})},WRITE_LIMITER:{limit:async()=>({success:true})}};
const request=(rules=[title('A -> B')],extra={})=>new Request('https://test/api/rules/submit',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'127.0.0.1'},body:JSON.stringify({version:1,rules}),...extra});
test('receiver: health, disabled, method, content-type, rate and streamed-size gates',async()=>{
  assert.equal((await worker.fetch(new Request('https://test/health'),{})).status,200);
  assert.equal((await worker.fetch(request(),{})).status,503);
  assert.equal((await worker.fetch(new Request('https://test/api/rules/submit'),env)).status,405);
  assert.equal((await worker.fetch(request(undefined,{headers:{'cf-connecting-ip':'1','content-type':'text/plain'}}),env)).status,415);
  assert.equal((await worker.fetch(request(),{...env,IP_LIMITER:{limit:async()=>({success:false})}})).status,429);
  assert.equal((await worker.fetch(request(undefined,{body:'x'.repeat(65537)}),env)).status,400);
});
test('receiver: immutable create, retry idempotence, no credentials in stored data or output',async()=>{
  const original=globalThis.fetch;let saved,exists=false;const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});assert.ok(url.startsWith('https://api.github.com/repos/xlmc/danmu-mapping/contents/'));assert.equal(options.headers.Authorization,'Bearer secret-fixture');
    if(url.includes('submissions/')){
      if(options.method==='PUT'){saved=JSON.parse(options.body);assert.equal(saved.sha,undefined);exists=true;return new Response('{}',{status:201});}
      return new Response('{}',{status:exists?200:404});
    }
    return Response.json({encoding:'base64',content:Buffer.from('# empty\n').toString('base64')});
  };
  try {
    const first=await worker.fetch(request(),env);assert.equal(first.status,200);const result=await first.json();assert.equal(result.stored,1);
    const content=JSON.parse(Buffer.from(saved.content,'base64').toString());assert.equal(content.status,'pending_review');assert.equal(content.id,result.id);
    assert.ok(!JSON.stringify(content).includes('secret-fixture'));assert.ok(!JSON.stringify(result).includes('secret-fixture'));
    const retry=await (await worker.fetch(request(),env)).json();assert.equal(retry.status,'already_received');assert.equal(retry.stored,0);assert.equal(calls.filter(c=>c.options.method==='PUT').length,1);
    globalThis.fetch=async()=>{throw new Error('secret-fixture');};const failed=await worker.fetch(request(),env);assert.equal(failed.status,502);assert.ok(!(await failed.text()).includes('secret-fixture'));
  }finally{globalThis.fetch=original;}
});
test('receiver: concurrent 409 create is an immutable retry, not an overwrite',async()=>{
  const original=globalThis.fetch;let lookups=0,writes=0;
  globalThis.fetch=async(url,options)=>{
    if(url.includes('submissions/')){
      if(options.method==='PUT'){writes++;assert.equal(JSON.parse(options.body).sha,undefined);return new Response('{}',{status:409});}
      return new Response('{}',{status:++lookups===1?404:200});
    }
    return Response.json({encoding:'base64',content:Buffer.from('Existing->Target').toString('base64')});
  };
  try {const r=await worker.fetch(request(),env);assert.equal(r.status,200);assert.equal((await r.json()).status,'already_received');assert.equal(writes,1);}finally{globalThis.fetch=original;}
});
test('receiver: all published duplicate/conflict/invalid rules do not cause a write',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.method,'GET');assert.ok(!url.includes('submissions/'));return Response.json({encoding:'base64',content:Buffer.from(url.includes('2026.txt')?'A->B\n':'').toString('base64')});};
  try{const r=await (await worker.fetch(request([title('A -> B'),title('A -> C'),title('X -> X')]),env)).json();assert.equal(r.status,'no_new_rules');assert.equal(r.stored,0);assert.equal(r.conflict.length,2);assert.equal(r.invalid.length,1);assert.equal(calls,2);}finally{globalThis.fetch=original;}
});

test('receiver: safe GitHub status diagnoses auth and permission failures without upstream body or token',async()=>{
  const original=globalThis.fetch;
  try { for(const status of [401,403,404,429,500]) { globalThis.fetch=async()=>new Response('secret-fixture upstream private detail',{status});const response=await worker.fetch(request(),env);assert.equal(response.status,502);const data=await response.json();assert.equal(data.github_status,status);assert.equal(data.error_code,'github_read_baseline');assert.ok(!JSON.stringify(data).includes('secret-fixture'));assert.ok(!JSON.stringify(data).includes('private detail')); } }finally{globalThis.fetch=original;}
});
