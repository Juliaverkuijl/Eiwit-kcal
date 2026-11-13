// Zoek aanvullende voedingswaarden in dezelfde productdatabase via de eigen domeinnaam.
export async function onRequestGet({request}) {
 const q=(new URL(request.url).searchParams.get('q')||'').trim().slice(0,100);
 if(q.length<3)return Response.json({products:[],error:'Zoekterm te kort'},{status:400});
 const url=new URL('https://world.openfoodfacts.org/cgi/search.pl');
 for(const [k,v] of Object.entries({search_terms:q,search_simple:'1',action:'process',json:'1',page_size:'40',fields:'code,product_name,brands,nutriments,quantity'}))url.searchParams.set(k,v);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),9000);
 try{
  const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'EiwitKcal/1.1 (nutrition matching)'},signal:controller.signal});
  if(!r.ok)throw Error('Voedingsdatabase niet bereikbaar');
  const data=await r.json();
  return Response.json({products:Array.isArray(data.products)?data.products:[]},{headers:{'Cache-Control':'public, max-age=300'}});
 }catch(e){return Response.json({products:[],error:'Aanvullende voedingswaarden tijdelijk niet beschikbaar'},{status:503});}
 finally{clearTimeout(timer)}
}
