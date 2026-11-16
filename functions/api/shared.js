const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
async function sha(s){const bytes=new TextEncoder().encode(s);const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')}
const KEYS=new Set(['julia-nutrient-product-overrides-v1','julia-preferred-product-barcodes-v1','julia-growth-measurements-v1','julia-analysis-settings-v1','julia-growth-reference-v1','julia-product-favorites-v1','julia-product-recent-v1','julia-favorite-meal-groups-v1','eiwitkcal-vaak-gekozen-v1','eiwitkcal-zoekgeschiedenis']);
export async function onRequest({request,env}){
 if(!env.DB||!env.DIARY_SECRET)return json({error:'Database niet ingesteld'},503);
 const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!/^[a-f0-9]{64}$/.test(token))return json({error:'Niet gekoppeld'},401);
 try{
 const hash=await sha(env.DIARY_SECRET+':'+token);const device=await env.DB.prepare('SELECT token_hash FROM diary_devices WHERE token_hash=? AND revoked=0 AND expires_at>?').bind(hash,new Date().toISOString()).first();if(!device)return json({error:'Koppeling verlopen'},401);
 if(request.method==='GET'){
  const raw=new URL(request.url).searchParams.get('after');
  const after=raw===null?0:Number(raw);
  if(!Number.isSafeInteger(after)||after<0)return json({error:'Ongeldige synchronisatiepositie'},400);
  const query=after===0
   ? "SELECT op_id,entry_id,value,seq FROM diary_operations WHERE type='shared' AND seq IN (SELECT MAX(seq) FROM diary_operations WHERE type='shared' GROUP BY entry_id) ORDER BY seq ASC"
   : "SELECT op_id,entry_id,value,seq FROM diary_operations WHERE type='shared' AND seq>? ORDER BY seq ASC LIMIT 301";
  const result=await (after===0?env.DB.prepare(query):env.DB.prepare(query).bind(after)).all();
  const found=result.results||[], page=after===0?found:found.slice(0,300);
  return json({ops:page.filter(r=>KEYS.has(r.entry_id)).map(r=>({opId:r.op_id,key:r.entry_id,value:JSON.parse(r.value),seq:r.seq})),cursor:page.length?page[page.length-1].seq:after,hasMore:after>0&&found.length>300});
 }
 if(request.method==='POST'){
  const raw=await request.text();if(raw.length>160000)return json({error:'Te veel gegevens'},413);let body;try{body=JSON.parse(raw)}catch{return json({error:'Ongeldige JSON'},400)}
  if(!Array.isArray(body.ops)||body.ops.length>20)return json({error:'Ongeldige wijzigingen'},400);
  const stmts=[];for(const op of body.ops){if(!op||!KEYS.has(op.key)||typeof op.opId!=='string'||!/^[0-9a-f-]{36}$/i.test(op.opId))return json({error:'Ongeldige sleutel'},400);const value=JSON.stringify(op.value);if(!value||value.length>65000)return json({error:'Te grote gegevensgroep'},413);stmts.push(env.DB.prepare("INSERT OR IGNORE INTO diary_operations(op_id,type,date_key,entry_id,value) VALUES(?,'shared','',?,?)").bind(op.opId,op.key,value))}
  if(stmts.length)await env.DB.batch(stmts);return json({ok:true});
 }
 return json({error:'Methode niet toegestaan'},405);
 }catch(e){const message=String(e?.message||e||'');console.error('Shared API:',message);if(/exceeded.*(row|read|limit)|daily.*limit|quota/i.test(message))return json({error:'Cloudflare D1 daglimiet bereikt. Probeer na de dagelijkse reset opnieuw.'},503);if(/no such table/i.test(message))return json({error:'Databasetabel ontbreekt.'},503);return json({error:'Synchronisatiedatabase tijdelijk niet beschikbaar'},503)}
}
