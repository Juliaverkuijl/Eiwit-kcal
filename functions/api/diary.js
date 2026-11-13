import {sendPush} from './push.js';
const reply=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const enc=new TextEncoder();async function sha(s){const d=await crypto.subtle.digest('SHA-256',enc.encode(s));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s);
export async function onRequest({request,env,context}){
 if(!env.DB||!env.DIARY_SECRET)return reply({error:'Cloudflare database ontbreekt'},503);
 const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'Telefoon niet gekoppeld'},401);
 try{const hash=await sha(env.DIARY_SECRET+':'+token);const device=await env.DB.prepare('SELECT token_hash FROM diary_devices WHERE token_hash=? AND revoked=0 AND expires_at>?').bind(hash,new Date().toISOString()).first();if(!device)return reply({error:'Koppeling verlopen'},401);
 const id=await sha(env.DIARY_SECRET+':julia');
 if(request.method==='GET'){
  const [legacy,rows]=await Promise.all([env.DB.prepare('SELECT payload FROM shared_diary WHERE id=?').bind(id).first(),env.DB.prepare('SELECT op_id,type,date_key,entry_id,value FROM diary_operations ORDER BY seq ASC LIMIT 10000').all()]);
  return reply({data:legacy?JSON.parse(legacy.payload):{diary:{}},ops:(rows.results||[]).map(x=>({opId:x.op_id,type:x.type,date:x.date_key,id:x.entry_id,value:JSON.parse(x.value)}))});
 }
 if(request.method==='POST'){
  const raw=await request.text();if(raw.length>200000)return reply({error:'Te veel gegevens'},413);let body;try{body=JSON.parse(raw)}catch{return reply({error:'Ongeldige JSON'},400)}
  if(!Array.isArray(body.ops)||body.ops.length>60)return reply({error:'Ongeldige wijzigingen'},400);
  const stmts=[];const newItems=[];for(const op of body.ops){if(!op||typeof op.opId!=='string'||!/^[0-9a-f-]{36}$/i.test(op.opId)||!['upsert','delete','closed','settings'].includes(op.type)||typeof op.date!=='string'||typeof op.id!=='string'||(op.type!=='settings'&&!validDate(op.date)))return reply({error:'Ongeldige registratie'},400);const val=JSON.stringify(op.value??null);if(val.length>6000||op.id.length>120)return reply({error:'Registratie te groot'},413);if(op.type==='upsert'&&op.value?.name){const seen=await env.DB.prepare("SELECT op_id FROM diary_operations WHERE op_id=? OR (type='upsert' AND date_key=? AND entry_id=?) LIMIT 1").bind(op.opId,op.date,op.id).first();if(!seen)newItems.push(op)}stmts.push(env.DB.prepare('INSERT OR IGNORE INTO diary_operations(op_id,type,date_key,entry_id,value) VALUES(?,?,?,?,?)').bind(op.opId,op.type,op.date,op.id,val))}
  if(stmts.length)await env.DB.batch(stmts);if(newItems.length){const job=sendPush(env,hash,{count:newItems.length,opId:newItems[0].opId}).catch(e=>console.log('Push verzending mislukt',String(e)));if(context?.waitUntil)context.waitUntil(job);else await job}return reply({ok:true});
 }
 return reply({error:'Methode niet toegestaan'},405);
 }catch(e){const message=String(e?.message||e||'');console.error('Diary API:',message);if(/exceeded.*(row|read|limit)|daily.*limit|quota/i.test(message))return reply({error:'Cloudflare D1 daglimiet bereikt. Synchronisatie hervat na reset van de limiet.'},503);if(/no such table/i.test(message))return reply({error:'Databasetabel ontbreekt: '+(message.match(/no such table:\s*([\w]+)/i)?.[1]||'onbekend')},503);return reply({error:'Database tijdelijk niet beschikbaar. Probeer later opnieuw.'},503)}
}
