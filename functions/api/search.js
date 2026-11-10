// Cloudflare Pages Function: server-side proxy for Open Food Facts.
export async function onRequestGet({request}) {
  const input = new URL(request.url);
  const q = (input.searchParams.get('q') || '').trim().slice(0,100);
  const store = input.searchParams.get('store') || 'both';
  if (q.length < 2) return Response.json({error:'Voer minstens twee letters in.'},{status:400});
  const url = new URL('https://world.openfoodfacts.org/cgi/search.pl');
  url.searchParams.set('search_terms',q);
  url.searchParams.set('search_simple','1');
  url.searchParams.set('action','process');
  url.searchParams.set('json','1');
  url.searchParams.set('page_size','80');
  url.searchParams.set('fields','code,product_name,product_name_nl,brands,stores,stores_tags,nutriments');
  try {
    const upstream=await fetch(url.toString(),{headers:{'User-Agent':'EiwitKcalCalculator/1.0 (personal educational app; contact via site owner)','Accept':'application/json'},signal:AbortSignal.timeout(12000)});
    if(!upstream.ok) return Response.json({error:'Voedingsdatabase tijdelijk niet bereikbaar ('+upstream.status+').'},{status:502});
    const data=await upstream.json();
    const products=(data.products||[]).filter(p=>{
      const tags=[...(p.stores_tags||[]),p.stores||''].join(' ').toLowerCase();
      const ah=/albert[ -]?heijn|ah\b/.test(tags),jumbo=/jumbo/.test(tags);
      return (store==='ah'?ah:store==='jumbo'?jumbo:ah||jumbo);
    }).map(p=>{
      const n=p.nutriments||{};
      const protein=Number(n.proteins_100g);
      let kcal=Number(n['energy-kcal_100g']);
      if(!Number.isFinite(kcal)&&Number.isFinite(Number(n['energy-kj_100g'])))kcal=Number(n['energy-kj_100g'])/4.184;
      return {code:p.code,name:p.product_name_nl||p.product_name||'',brand:p.brands||'',protein,kcal};
    }).filter(p=>p.name&&Number.isFinite(p.protein)&&Number.isFinite(p.kcal)&&p.protein>=0&&p.kcal>=0);
    const unique=[...new Map(products.map(p=>[p.code||p.name,p])).values()].slice(0,35);
    return Response.json({products:unique},{headers:{'Cache-Control':'public, max-age=300'}});
  } catch(e) {return Response.json({error:'Verbinding met voedingsdatabase mislukt. Probeer later opnieuw.'},{status:502});}
}
