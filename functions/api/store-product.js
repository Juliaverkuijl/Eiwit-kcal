const approved = [
  {host:'www.ah.nl',pattern:/^\/producten\/product\/wi\d+\/[a-z0-9-]+\/?$/i,store:'Albert Heijn'},
  {host:'www.jumbo.com',pattern:/^\/producten\/[a-z0-9-]+\/?$/i,store:'Jumbo'}
];
const num = s => {const v=Number(String(s??'').replace(',','.'));return Number.isFinite(v)&&v>=0?v:null};
const strip = s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function jsonld(html){const found=[];for(const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{const o=JSON.parse(m[1]);const nodes=Array.isArray(o)?o:[o];for(const n of nodes)found.push(...(n['@graph']||[n]));}catch{}}return found.find(n=>String(n['@type']||'').toLowerCase().includes('product'))||{};}
function extract(html,store,url){const ld=jsonld(html);let name=strip(ld.name||'');if(!name){const m=html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);name=strip(m?.[1])}
 if(!name)return null;
 const body=strip(html);
 // Restrict all nutrition parsing to a nutrition section. Never infer missing values.
 const marker=store==='Jumbo'?'Voedingswaarden':'Voedingswaarden';
 const pos=body.indexOf(marker);if(pos<0)return null;
 const nutrition=body.slice(pos,pos+2500);
 const extractNumber=(regex)=>num(nutrition.match(regex)?.[1]);
 const protein=extractNumber(/Eiwitten?\s*(?:\|\s*)?(\d+(?:[.,]\d+)?)\s*g/i);
 const kcal=extractNumber(/(?:Energie[^\n]{0,100}?|\b)(\d+(?:[.,]\d+)?)\s*kcal/i);
 const fat=extractNumber(/(?:Vetten?|Vet)\s*(?:\|\s*)?(\d+(?:[.,]\d+)?)\s*g/i);
 const carbs=extractNumber(/Koolhydraten\s*(?:\|\s*)?(\d+(?:[.,]\d+)?)\s*g/i);
 const sugar=extractNumber(/(?:waarvan\s+suikers|Suikers)\s*(?:\|\s*)?(\d+(?:[.,]\d+)?)\s*g/i);
 if(protein===null||kcal===null||protein>100||kcal>1000)return null;
 const quantity=name.match(/\b(\d+)\s*g\b/i)?.[0]||'';
 return {id:store+':'+url.pathname,name,brand:strip(ld.brand?.name||ld.brand||''),store,protein,kcal,fat,sugar,carbs,quantity,image:typeof ld.image==='string'?ld.image:(Array.isArray(ld.image)?ld.image[0]:null),productUrl:url.href,nutritionSource:store+'-productpagina (automatisch uitgelezen; controleer etiket)',verifiedStorePage:true,dutchMarket:true,dutchLanguage:true};
}
export async function onRequestGet({request}){
 let url;try{url=new URL(new URL(request.url).searchParams.get('url')||'')}catch{return Response.json({error:'Ongeldige productlink.'},{status:400})}
 const source=approved.find(a=>url.protocol==='https:'&&url.hostname===a.host&&a.pattern.test(url.pathname));
 if(!source)return Response.json({error:'Alleen rechtstreekse productlinks van AH en Jumbo worden ondersteund.'},{status:400});
 url.search='';url.hash='';
 try{const r=await fetch(url.href,{headers:{'Accept':'text/html','User-Agent':'Mozilla/5.0 (compatible; EiwitKcal/1.0)'},signal:AbortSignal.timeout(8000),redirect:'manual'});
 if(r.status>=300&&r.status<400)throw Error('De supermarkt verwijst door naar een andere pagina; automatisch volgen is om veiligheidsredenen uitgeschakeld.');
 if(r.status===403||r.status===429)throw Error('De supermarkt blokkeert automatische toegang (HTTP '+r.status+').');
 if(!r.ok)throw Error('Supermarktwebsite antwoordt met '+r.status);
 const contentType=r.headers.get('content-type')||'';if(!contentType.includes('text/html'))throw Error('Geen productpagina ontvangen');
 const html=(await r.text()).slice(0,1200000);const product=extract(html,source.store,url);
 if(!product)throw Error('Voedingswaarden niet betrouwbaar te herkennen. Gebruik de verpakking of handmatige invoer.');
 return Response.json({product},{headers:{'Cache-Control':'public, max-age=1800'}});
 }catch(e){return Response.json({error:'Automatisch ophalen niet gelukt: '+e.message},{status:502})}
}
