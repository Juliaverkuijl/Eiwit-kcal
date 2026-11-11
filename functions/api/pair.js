const reply=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const enc=new TextEncoder();
async function sha(s){const d=await crypto.subtle.digest('SHA-256',enc.encode(s));return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function equal(a,b){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0}
export async function onRequest({request,env}){
 if(!env.DB||!env.DIARY_ACCESS_CODE||!env.DIARY_SECRET)return reply({error:'Cloudflare database of geheime instellingen ontbreken'},503);
 if(request.method==='POST'){
  let raw;try{raw=await request.text();if(raw.length>2048)return reply({error:'Ongeldig verzoek'},400)}catch{return reply({error:'Ongeldig verzoek'},400)}
  let data;try{data=JSON.parse(raw)}catch{return reply({error:'Ongeldig verzoek'},400)}
  const code=typeof data.code==='string'?data.code:'';
  if(code.length<12||code.length>256)return reply({error:'Koppelcode ongeldig'},401);
  const [provided,expected]=await Promise.all([sha(code),sha(env.DIARY_ACCESS_CODE)]);
  if(!equal(provided,expected))return reply({error:'Onjuiste koppelcode'},401);
  const token=[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const tokenHash=await sha(env.DIARY_SECRET+':'+token);
  const expires=new Date(Date.now()+365*24*3600*1000).toISOString();
  try{await env.DB.prepare('INSERT INTO diary_devices(token_hash,expires_at) VALUES(?,?)').bind(tokenHash,expires).run()}
  catch{return reply({error:'Apparaattabel ontbreekt of databasefout'},503)}
  return reply({token,expiresAt:expires});
 }
 if(request.method==='DELETE'){
  const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  if(!/^[a-f0-9]{64}$/.test(token))return reply({error:'Niet gekoppeld'},401);
  const hash=await sha(env.DIARY_SECRET+':'+token);
  try{await env.DB.prepare('UPDATE diary_devices SET revoked=1 WHERE token_hash=?').bind(hash).run();return reply({ok:true})}
  catch{return reply({error:'Databasefout'},500)}
 }
 return reply({error:'Methode niet toegestaan'},405);
}
