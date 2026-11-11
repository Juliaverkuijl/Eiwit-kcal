import catalog from './verified-products.json';
const normalize=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const aliases={amerikaanse:'',amerikaans:'',american:'',pancakes:'pancake',pannenkoeken:'pancake',pannenkoek:'pancake',pannekoeken:'pancake',pannekoek:'pancake',cracottes:'cracotte',cracotte:'cracotte',knackebrod:'cracotte',knackebrood:'cracotte'};
const words=s=>normalize(s).split(' ').map(w=>Object.hasOwn(aliases,w)?aliases[w]:w).filter(Boolean);
const shops=[
 {store:'Albert Heijn',domain:'ah.nl',path:/^\/producten\/product\/wi\d+\//},
 {store:'Jumbo',domain:'jumbo.com',path:/^\/producten\/[^/]+\/?$/},
 {store:'PLUS',domain:'plus.nl',path:/^\/product\//},
];
const allowed=(store,filter)=>filter==='both'||filter==='all'||filter==='off'||filter==='ah'&&store==='Albert Heijn'||filter==='jumbo'&&store==='Jumbo'||filter==='plus'&&store==='PLUS'||filter==='picnic'&&store==='Picnic';
const numeric=s=>{const n=Number(String(s||'').replace(',','.'));return Number.isFinite(n)&&n>=0?n:null};
const plain=s=>String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
function parsePage(html,url,store){
 const body=plain(html);const at=body.toLowerCase().indexOf('voedingswaarden');if(at<0)return null;
 const segment=body.slice(at,at+2600);const ah=store==='Albert Heijn';
 const get=(r)=>numeric(segment.match(r)?.[1]);
 const protein=get(/\bEiwitten?\s*(?:\|\s*)?(\d+(?:[.,]\d+)?)\s*(?:g|gram)\b/i);
 const kcal=ah?get(/\bEnergie\s*(?:\|\s*)?[\d.,]+\s*kJ\s*\(\s*(\d+(?:[.,]\d+)?)\s*kcal/i):get(/\bEnergie\s*(?:KC|kcal)\s*(?:\|\s*)?(\d+(?:[.,]\d+)?)\s*(?:KC|kcal)?/i)??get(/\b(\d+(?:[.,]\d+)?)\s*kcal/i);
 if(protein===null||kcal===null||protein>100||kcal>1000)return null;
 const name=plain(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'');if(!name)return null;
 const fat=get(/\bVet\s*(?:\|\s*)?(\d+(?:[.,]\d+)?)\s*(?:g|gram)\b/i);
 const carbs=get(/\bKoolhydraten\s*(?:\|\s*)?(\d+(?:[.,]\d+)?)\s*(?:g|gram)\b/i);
 const sugar=get(/\b(?:waarvan\s+suikers|Suikers)\s*(?:\|\s*)?(\d+(?:[.,]\d+)?)\s*(?:g|gram)\b/i);
 const quantity=body.match(/(?:inhoud en gewicht|per (?:set|zak|doos|pak))[^.]{0,150}?(\d+(?:[.,]\d+)?)\s*(?:g|gram)\b/i)?.[1];
 return {id:store+':'+url.pathname,name,brand:'',store,protein,kcal,fat,sugar,carbs,quantity:quantity?quantity+' g':'',productUrl:url.href,nutritionSource:store+'-productpagina (live uitgelezen; controleer etiket)',verifiedStorePage:true};
}
// Zoek via twee onafhankelijke publieke indexen. Geen officiële assortiment-API.
const timeout=ms=>AbortSignal.timeout(ms);
async function discover(q,shop){
 const query='site:'+shop.domain+' '+q;
 const endpoints=[
  'https://www.bing.com/search?format=rss&q='+encodeURIComponent(query),
  'https://www.google.com/search?q='+encodeURIComponent(query)+'&num=12'
 ];
 const candidates=[];
 await Promise.all(endpoints.map(async endpoint=>{
  try{
   const r=await fetch(endpoint,{headers:{Accept:'text/html, application/rss+xml, application/xml', 'User-Agent':'Mozilla/5.0 (compatible; EiwitKcalSearch/1.0)'},signal:timeout(3500)});
   if(!r.ok)return;
   const body=(await r.text()).slice(0,220000);
   // RSS <link>, gewone zoeklinks en gecodeerde Google /url?q= links.
   for(const match of body.matchAll(/(?:<link>\s*|href=["']|\/url\?q=)(https?(?:%3A%2F%2F|:\/\/)[^"'<\s&]+|https?[^"'<\s]+)(?:["'<\s&]|$)/gi))candidates.push(match[1]);
   for(const match of body.matchAll(/https?:\/\/(?:www\.)?(?:ah\.nl|jumbo\.com|plus\.nl)\/[^"'<\s&]+/gi))candidates.push(match[0]);
  }catch{}
 }));
 const urls=new Map();
 for(const raw of candidates){
  try{
   const value=raw.replace(/&amp;/g,'&').replace(/&#38;/g,'&');
   const u=new URL(decodeURIComponent(value));
   if((u.hostname===shop.domain||u.hostname==='www.'+shop.domain)&&shop.path.test(u.pathname)){
    u.search='';u.hash='';urls.set(u.href,u);
   }
  }catch{}
 }
 return [...urls.values()].slice(0,8);
}
async function liveProducts(q,shop){
 const urls=await discover(q,shop);
 const results=await Promise.all(urls.map(async url=>{
  try{
   const r=await fetch(url.href,{headers:{Accept:'text/html'},signal:timeout(4000)});
   if(!r.ok)return null;
   const p=parsePage((await r.text()).slice(0,900000),url,shop.store);
   return p&&matches(p,q)?p:null;
  }catch{return null}
 }));
 return results.filter(Boolean);
}
function matches(p,q){const terms=words(q).filter(w=>w.length>1&&!['ah','albert','heijn','jumbo','plus','picnic'].includes(w));const hay=words(p.name+' '+p.brand);return terms.length>0&&terms.every(t=>hay.some(h=>h===t||h.startsWith(t)||t.startsWith(h)&&h.length>=3));}
export async function onRequestGet({request}){
 const url=new URL(request.url),q=(url.searchParams.get('q')||'').trim(),filter=url.searchParams.get('store')||'both';
 if(q.length<2)return Response.json({products:[],error:'Vul minimaal twee letters in.'},{status:400});
 const known=catalog.filter(p=>allowed(p.store,filter)&&matches(p,q));
 const active=shops.filter(s=>allowed(s.store,filter));
 // Zoek altijd live, ook wanneer de vaste catalogus al resultaten heeft.
 // Variaties per supermarkt parallel, zodat één trage bron niet alles blokkeert.
 const terms=[...new Set([q,words(q).join(' '),...words(q).filter(w=>w.length>=4)])].filter(Boolean).slice(0,3);
 const fresh=(await Promise.all(active.flatMap(shop=>terms.map(term=>liveProducts(term,shop).catch(()=>[]))))).flat().filter(p=>matches(p,q));
 const unique=new Map();for(const p of [...fresh,...known])unique.set(p.productUrl||p.id,p);
 const products=[...unique.values()].sort((a,b)=>Number(b.verifiedStorePage)-Number(a.verifiedStorePage));
 return Response.json({products,source:'Supermarktproductpagina’s + gecontroleerde catalogus (zoekversie 3)',liveChecked:active.map(x=>x.store),note:'Live zoeken is afhankelijk van toegang tot de websites. Niet gevonden betekent niet dat een winkel het product niet verkoopt.'},{headers:{'Cache-Control':'public, max-age=600'}});
}
