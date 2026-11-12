const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
async function sha(s){const bytes=new TextEncoder().encode(s);const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
const KEYS=new Set(['julia-nutrient-product-overrides-v1','julia-preferred-product-barcodes-v1','julia-growth-measurements-v1','julia-analysis-settings-v1','julia-growth-reference-v1']);
export async function onRequest({request,env}){
 if(!env.DB||!env.DIARY_SECRET)return json({error:'Database niet ingesteld'},503);
 const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!/^[a-f0-9]{64}$/.test(token))return json({error:'Niet gekoppeld'},401);
 try{
 const hash=await sha(env.DIARY_SECRET+':'+token);const device=await env.DB.prepare('SELECT token_hash FROM diary_devices WHERE token_hash=? AND revoked=0 AND expires_at>?').bind(hash,new Date().toISOString()).first();if(!device)return json({error:'Koppeling verlopen'},401);
 if(request.method==='GET'){
  const result=await env.DB.prepare("SELECT op_id,entry_id,value,seq FROM diary_operations WHERE type='shared' ORDER BY seq ASC LIMIT 10000").all();
  return json({ops:(result.results||[]).filter(r=>KEYS.has(r.entry_id)).map(r=>({opId:r.op_id,key:r.entry_id,value:JSON.parse(r.value),seq:r.seq}))});
 }
 if(request.method==='POST'){
  const raw=await request.text();if(raw.length>160000)return json({error:'Te veel gegevens'},413);let body;try{body=JSON.parse(raw)}catch{return json({error:'Ongeldige JSON'},400)}
  if(!Array.isArray(body.ops)||body.ops.length>20)return json({error:'Ongeldige wijzigingen'},400);
  const stmts=[];for(const op of body.ops){if(!op||!KEYS.has(op.key)||typeof op.opId!=='string'||!/^[0-9a-f-]{36}$/i.test(op.opId))return json({error:'Ongeldige sleutel'},400);const value=JSON.stringify(op.value);if(!value||value.length>5500)return json({error:'Te grote gegevensgroep'},413);stmts.push(env.DB.prepare("INSERT OR IGNORE INTO diary_operations(op_id,type,date_key,entry_id,value) VALUES(?,'shared','',?,?)").bind(op.opId,op.key,value))}
  if(stmts.length)await env.DB.batch(stmts);return json({ok:true});
 }
 return json({error:'Methode niet toegestaan'},405);
 }catch(e){return json({error:'Synchronisatiedatabase niet beschikbaar'},500)}
}
