const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
const enc=new TextEncoder();
const b64=s=>{const a=Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));return a};
const url=a=>btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const join=(...a)=>{const n=new Uint8Array(a.reduce((x,y)=>x+y.length,0));let p=0;for(const v of a){n.set(v,p);p+=v.length}return n};
async function hash(s){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function valid(request,env){const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!/^[a-f0-9]{64}$/.test(token))return null;const h=await hash(env.DIARY_SECRET+':'+token);const row=await env.DB.prepare('SELECT token_hash FROM diary_devices WHERE token_hash=? AND revoked=0 AND expires_at>?').bind(h,new Date().toISOString()).first();return row?h:null}
export async function onRequest({request,env}){
 if(!env.DB||!env.DIARY_SECRET||!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY)return json({error:'Pushinstellingen ontbreken in Cloudflare'},503);
 let owner;try{owner=await valid(request,env)}catch{return json({error:'Database niet bereikbaar'},503)}if(!owner)return json({error:'Niet gekoppeld'},401);
 if(request.method==='GET')return json({publicKey:env.VAPID_PUBLIC_KEY});
 if(request.method!=='POST'&&request.method!=='DELETE')return json({error:'Methode niet toegestaan'},405);
 let data;try{data=await request.json()}catch{return json({error:'Ongeldige gegevens'},400)}
 if(request.method==='DELETE'){
  if(typeof data.endpoint!=='string')return json({error:'Endpoint ontbreekt'},400);
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE token_hash=? AND endpoint=?').bind(owner,data.endpoint).run();return json({ok:true});
 }
 const sub=data.subscription;
 if(!sub||typeof sub.endpoint!=='string'||!sub.endpoint.startsWith('https://')||sub.endpoint.length>2000||!sub.keys||typeof sub.keys.p256dh!=='string'||typeof sub.keys.auth!=='string')return json({error:'Ongeldige pushregistratie'},400);
 try{if(b64(sub.keys.p256dh).length!==65||b64(sub.keys.auth).length!==16)throw Error('invalid')}catch{return json({error:'Ongeldige pushsleutels'},400)}
 const name=data.name==='Marit'?'Marit':data.name==='Jeffrey'?'Jeffrey':'Gezinslid';
 try{await env.DB.prepare('INSERT INTO push_subscriptions(token_hash,endpoint,p256dh,auth,device_name,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET token_hash=excluded.token_hash,p256dh=excluded.p256dh,auth=excluded.auth,device_name=excluded.device_name,updated_at=excluded.updated_at').bind(owner,sub.endpoint,sub.keys.p256dh,sub.keys.auth,name,new Date().toISOString()).run();return json({ok:true,name})}catch{return json({error:'Database tabel push_subscriptions ontbreekt. Voer eerst de SQL migratie uit.'},503)}
}
export async function sendPush(env,senderHash,payload){
 if(!env.VAPID_PRIVATE_KEY||!env.VAPID_PUBLIC_KEY)return;
 const sender=await env.DB.prepare('SELECT device_name FROM push_subscriptions WHERE token_hash=? LIMIT 1').bind(senderHash).first();
 const rows=await env.DB.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE token_hash<>?').bind(senderHash).all();
 const title='Eiwit & Kcal';const who=sender?.device_name||'De ander';
 const body=who+' heeft '+(payload.count>1?payload.count+' voedingsproducten':'voeding')+' toegevoegd aan het dagboek.';
 const msg=JSON.stringify({title,body,url:'/?push=1',tag:'diary-'+payload.opId});
 await Promise.allSettled((rows.results||[]).map(async s=>{
  try{const res=await webpush(s,msg,env);if(res.status===404||res.status===410)await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(s.endpoint).run();if(!res.ok&&res.status!==404&&res.status!==410)console.log('Push response',res.status)}catch(e){console.log('Push error',String(e))}
 }));
}
async function hkdfExtract(salt,ikm){const key=await crypto.subtle.importKey('raw',salt,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,ikm))}
async function hkdfExpand(prk,info,len){const key=await crypto.subtle.importKey('raw',prk,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,join(info,new Uint8Array([1])))).slice(0,len)}
async function webpush(sub,message,env){
 const ua=b64(sub.p256dh),auth=b64(sub.auth),salt=crypto.getRandomValues(new Uint8Array(16));
 const server=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const serverPub=new Uint8Array(await crypto.subtle.exportKey('raw',server.publicKey));
 const clientPub=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:clientPub},server.privateKey,256));
 const prk=await hkdfExtract(auth,shared);
 const ikm=await hkdfExpand(prk,join(enc.encode('WebPush: info\0'),ua,serverPub),32);
 const key=await hkdfExtract(salt,ikm);
 const cek=await hkdfExpand(key,enc.encode('Content-Encoding: aes128gcm\0'),16);
 const nonce=await hkdfExpand(key,enc.encode('Content-Encoding: nonce\0'),12);
 const aes=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['encrypt']);
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},aes,join(enc.encode(message),new Uint8Array([2]))));
 const rs=new Uint8Array([0,0,16,0]);const body=join(salt,rs,new Uint8Array([65]),serverPub,cipher);
 const privateKey=b64(env.VAPID_PRIVATE_KEY),publicKey=b64(env.VAPID_PUBLIC_KEY);
 const x=publicKey.slice(1,33),y=publicKey.slice(33);
 const vapidKey=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:url(x),y:url(y),d:url(privateKey),ext:true}, {name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const endpoint=new URL(sub.endpoint),aud=endpoint.origin;
 const head=url(enc.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
 const claims=url(enc.encode(JSON.stringify({aud,exp:Math.floor(Date.now()/1000)+3600,sub:'mailto:push@eiwit-kcal.pages.dev'})));
 const data=head+'.'+claims;
 const signature=url(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},vapidKey,enc.encode(data))));
 return fetch(sub.endpoint,{method:'POST',headers:{'TTL':'86400','Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream','Authorization':'vapid t='+data+'.'+signature+', k='+env.VAPID_PUBLIC_KEY},body});
}
