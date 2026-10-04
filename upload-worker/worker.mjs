import { MAX_BYTES, validateSubmission, parsePublishedRules, submissionId } from '../community-rules.mjs';
const REPO='xlmc/danmu-mapping';
const BRANCH='main';
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra}});
const enabled=env=>env.UPLOADS_ENABLED==='true'&&!!env.GITHUB_TOKEN&&!!env.IP_LIMITER&&!!env.WRITE_LIMITER;
async function readBody(request) {
  if(Number(request.headers.get('content-length'))>MAX_BYTES)throw new Error('请求超过 64 KiB');
  if(!request.body)throw new Error('缺少请求内容');
  const reader=request.body.getReader();let size=0;const parts=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw new Error('请求超过 64 KiB');}parts.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
async function github(env,path,method='GET',body) {
  return fetch(`https://api.github.com/repos/${REPO}/${path}`,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{
    Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'danmu-rule-submissions',
    ...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
async function baseline(env) {
  const texts=[];
  for(const path of ['Word/2026.txt','Word/season-candidates.txt']) {
    const r=await github(env,`contents/${path}?ref=${BRANCH}`);if(!r.ok)throw new Error('现有规则读取失败');
    const file=await r.json();if(file.encoding!=='base64'||typeof file.content!=='string')throw new Error('现有规则格式不支持');
    texts.push(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));
  }
  return parsePublishedRules(...texts);
}
function base64(text) {const bytes=new TextEncoder().encode(text);let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return btoa(binary);}
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(path==='/health'&&['GET','HEAD'].includes(request.method)) {
      const r=json({ok:true,service:'danmu-rules-upload',uploads_enabled:enabled(env)});
      return request.method==='HEAD'?new Response(null,{status:200,headers:r.headers}):r;
    }
    if(path!=='/api/rules/submit')return json({success:false,error:'not_found'},404);
    if(request.method!=='POST')return json({success:false,error:'method_not_allowed'},405,{Allow:'POST'});
    // Fail closed: no writes without explicit enablement, secret AND rate-limit bindings.
    if(!enabled(env))return json({success:false,error:'共享上传暂未启用'},503);
    const ip=request.headers.get('cf-connecting-ip');
    if(!ip)return json({success:false,error:'缺少来源信息'},400);
    if(!(await env.IP_LIMITER.limit({key:ip})).success)return json({success:false,error:'上传过于频繁，请稍后重试'},429,{'Retry-After':'60'});
    if(!(await env.WRITE_LIMITER.limit({key:'submissions'})).success)return json({success:false,error:'接收繁忙，请稍后重试'},429,{'Retry-After':'60'});
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return json({success:false,error:'仅接受 JSON'},415);
    let payload;
    try {payload=await readBody(request);validateSubmission(payload);} catch {return json({success:false,error:'上传格式错误或请求过大'},400);}
    try {
      const checked=validateSubmission(payload,await baseline(env));
      const id=await submissionId(checked.accepted);
      const filePath=`Word/submissions/${id}.json`;
      const response={success:true,id:checked.accepted.length?id:null,status:checked.accepted.length?'pending_review':'no_new_rules',stored:checked.accepted.length,
        duplicate:checked.duplicate.length,conflict:checked.conflict,invalid:checked.invalid};
      if(!checked.accepted.length)return json(response);
      const exists=await github(env,`contents/${filePath}?ref=${BRANCH}`);
      if(exists.ok)return json({...response,status:'already_received',stored:0,duplicate:checked.duplicate.length+checked.accepted.length});
      if(exists.status!==404)throw new Error('无法检查重复提交');
      const content=JSON.stringify({version:1,id,status:'pending_review',received_at:new Date().toISOString(),rules:checked.accepted},null,2)+'\n';
      const written=await github(env,`contents/${filePath}`,'PUT',{message:`Collect shared rules ${id.slice(0,12)}`,branch:BRANCH,content:base64(content)});
      if(!written.ok) {
        // A concurrent/retried create must never overwrite an existing file.
        if([409,422].includes(written.status)) {
          const retry=await github(env,`contents/${filePath}?ref=${BRANCH}`);
          if(retry.ok)return json({...response,status:'already_received',stored:0,duplicate:checked.duplicate.length+checked.accepted.length});
        }
        throw new Error('规则保存失败');
      }
      return json(response);
    } catch {return json({success:false,error:'共享服务暂不可用，请稍后重试；本地规则未改变'},502);}
  }
};
