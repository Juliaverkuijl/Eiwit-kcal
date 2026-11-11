const reply=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const enc=new TextEncoder();
async function sha(s){const d=await crypto.subtle.digest('SHA-256',enc.encode(s));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function onRequest({request,env}){
 if(!env.DB||!env.DIARY_SECRET)return reply({error:'Database of geheim ontbreekt'},503);
 const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
 if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'Dit apparaat is niet gekoppeld'},401);
 const hash=await sha(env.DIARY_SECRET+':'+token);
 try{
  const device=await env.DB.prepare('SELECT token_hash FROM diary_devices WHERE token_hash=? AND revoked=0 AND expires_at>?').bind(hash,new Date().toISOString()).first();
  if(!device)return reply({error:'Koppeling verlopen of ingetrokken'},401);
  const id=await sha(env.DIARY_SECRET+':julia');
  if(request.method==='GET'){
   const row=await env.DB.prepare('SELECT revision,payload FROM shared_diary WHERE id=?').bind(id).first();
   return reply(row?{revision:row.revision,data:JSON.parse(row.payload)}:{revision:0,data:{diary:{}}});
  }
  if(request.method==='PUT'){
   const raw=await request.text();if(raw.length>1000000)return reply({error:'Dagboek te groot'},413);
   let body;try{body=JSON.parse(raw)}catch{return reply({error:'Ongeldige JSON'},400)}
   if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||!body.data||typeof body.data.diary!=='object'||Array.isArray(body.data.diary))return reply({error:'Ongeldig verzoek'},400);
   const payload=JSON.stringify(body.data),now=new Date().toISOString();
   if(body.expectedRevision===0){
    const r=await env.DB.prepare('INSERT OR IGNORE INTO shared_diary(id,revision,payload,updated_at) VALUES(?,1,?,?)').bind(id,payload,now).run();
    if(r.meta.changes)return reply({revision:1});
   }else{
    const r=await env.DB.prepare('UPDATE shared_diary SET revision=revision+1,payload=?,updated_at=? WHERE id=? AND revision=?').bind(payload,now,id,body.expectedRevision).run();
    if(r.meta.changes)return reply({revision:body.expectedRevision+1});
   }
   return reply({error:'Andere telefoon heeft gegevens gewijzigd; maak eerst een back-up'},409);
  }
  return reply({error:'Methode niet toegestaan'},405);
 }catch{return reply({error:'Databasefout of ontbrekende tabel'},500)}
}
