import catalog from './verified-products.json';
const normalize=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
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
async function discover(q,shop){
 // Openbare webzoekresultaten zijn een best-effort ingang, geen officiële supermarkt-API.
 const endpoint='https://www.bing.com/search?format=rss&q='+encodeURIComponent('site:'+shop.domain+' '+q);
 const r=await fetch(endpoint,{headers:{Accept:'application/rss+xml, application/xml, text/xml'},signal:AbortSignal.timeout(4500)});
 if(!r.ok)return [];
 const xml=(await r.text()).slice(0,140000);const urls=[];
 for(const item of xml.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<\/item>/gi)){
  try{const u=new URL(item[1].replace(/&amp;/g,'&'));if((u.hostname===shop.domain||u.hostname==='www.'+shop.domain)&&shop.path.test(u.pathname)){u.search='';urls.push(u)}}catch{}
 }
 return [...new Map(urls.map(u=>[u.href,u])).values()].slice(0,3);
}
async function liveProducts(q,shop){
 try{const urls=await discover(q,shop);return (await Promise.all(urls.map(async url=>{
  try{const r=await fetch(url.href,{headers:{Accept:'text/html'},signal:AbortSignal.timeout(4500)});if(!r.ok)return null;const p=parsePage((await r.text()).slice(0,900000),url,shop.store);return p&&matches(p,q)?p:null}catch{return null}
 })))).filter(Boolean)}catch{return []}
}
function queryTerms(q){return normalize(q).split(' ').filter(w=>w.length>1&&!['ah','albert','heijn','jumbo','plus','picnic','american','amerikaanse','amerikaans','naturel','original'].includes(w)).map(w=>({pancake:'pancake',pancakes:'pancake',pannenkoek:'pancake',pannenkoeken:'pancake'}[w]||w));}
function matches(p,q){const terms=queryTerms(q);const hay=normalize(p.name+' '+p.brand).replace(/pannenkoeken?|pancakes?/g,'pancake');return terms.length>0&&terms.every(t=>hay.includes(t));}
export async function onRequestGet({request}){
 const url=new URL(request.url),q=(url.searchParams.get('q')||'').trim(),filter=url.searchParams.get('store')||'both';
 if(q.length<2)return Response.json({products:[],error:'Vul minimaal twee letters in.'},{status:400});
 const known=catalog.filter(p=>allowed(p.store,filter)&&matches(p,q));
 const active=shops.filter(s=>allowed(s.store,filter));
 const fresh=known.length>=2?[]:(await Promise.all(active.map(s=>liveProducts(q,s)))).flat();
 const unique=new Map();for(const p of [...fresh,...known])unique.set(p.productUrl||p.id,p);
 const products=[...unique.values()].sort((a,b)=>Number(b.verifiedStorePage)-Number(a.verifiedStorePage));
 return Response.json({products,source:'Supermarktproductpagina’s + gecontroleerde catalogus',liveChecked:active.map(x=>x.store),note:'Live zoeken is afhankelijk van toegang tot de websites. Niet gevonden betekent niet dat een winkel het product niet verkoopt.'},{headers:{'Cache-Control':'public, max-age=300'}});
}
