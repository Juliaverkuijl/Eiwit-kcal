// Cloudflare Pages search endpoint; Open Food Facts community data (not official AH/Jumbo).
export async function onRequestGet({request}) {
 const url=new URL(request.url), q=(url.searchParams.get('q')||'').trim().slice(0,90), store=url.searchParams.get('store')||'both';
 if(q.length<2)return Response.json({error:'Typ minimaal twee letters.'},{status:400});
 const normalize=s=>(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
 const tokens=normalize(q).split(/\s+/).filter(Boolean);
 const fields='code,product_name,product_name_nl,brands,stores,stores_tags,nutriments,image_front_small_url,image_front_url,image_small_url,image_url';
 const variants=[q];if(tokens.length>1)variants.push(tokens.slice(0,-1).join(' '));
 if(tokens.length>1)variants.push(tokens[tokens.length-1]);
 const uniqueVariants=[...new Set(variants)].slice(0,3);
 const hosts=['https://world.openfoodfacts.org/cgi/search.pl','https://nl.openfoodfacts.org/cgi/search.pl'];
 let collected=[], succeeded=false,errors=[];
 for(const term of uniqueVariants){
  const params=new URLSearchParams({search_terms:term,search_simple:'1',action:'process',json:'1',page_size:'100',fields});
  for(const host of hosts){try{
   const response=await fetch(host+'?'+params,{headers:{Accept:'application/json','User-Agent':'EiwitKcal/2.0 (nutrition calculator; contact: support@openfoodfacts.org)'},signal:AbortSignal.timeout(9000)});
   if(!response.ok){errors.push(String(response.status));continue}
   const data=await response.json();if(!Array.isArray(data.products))continue;
   succeeded=true;collected.push(...data.products);break;
  }catch(e){errors.push(e?.message||'Netwerkfout')}}
 }
 if(!succeeded)return Response.json({error:'Voedingsdatabase niet bereikbaar ('+(errors.at(-1)||'onbekend')+'). Probeer later opnieuw.'},{status:503});
 const seen=new Set();const products=[];
 for(const p of collected){const name=p.product_name_nl||p.product_name||'';if(!name)continue;
  const stores=normalize([...(p.stores_tags||[]),p.stores||''].join(' '));
  const ah=/albert heijn|(^| )ah( |$)/.test(stores),jumbo=/(^| )jumbo( |$)/.test(stores);
  if(!(store==='ah'?ah:store==='jumbo'?jumbo:ah||jumbo))continue;
  const n=p.nutriments||{},protein=Number(n.proteins_100g),raw=n['energy-kcal_100g'];
  const kcal=raw!=null?Number(raw):n['energy-kj_100g']!=null?Number(n['energy-kj_100g'])/4.184:NaN;
  if(n.proteins_100g==null||!Number.isFinite(protein)||!Number.isFinite(kcal)||protein<0||kcal<0)continue;
  const key=p.code||normalize(name+' '+p.brands);if(seen.has(key))continue;seen.add(key);
  const title=normalize(name+' '+(p.brands||'')),words=title.split(' ');
  let score=0;if(title===normalize(q))score+=100;if(title.startsWith(normalize(q)))score+=50;
  for(const t of tokens){if(words.includes(t))score+=22;else if(words.some(w=>w.startsWith(t)))score+=12;else if(title.includes(t))score+=5;else score-=18}
  if(p.image_front_small_url||p.image_front_url)score+=2;
  products.push({code:p.code,name,brand:p.brands||'',image:p.image_front_small_url||p.image_front_url||p.image_small_url||p.image_url||null,protein,kcal,score});
 }
 products.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'nl'));
 return Response.json({products:products.slice(0,40).map(({score,...p})=>p)},{headers:{'Cache-Control':'public, max-age=180'}});
}
