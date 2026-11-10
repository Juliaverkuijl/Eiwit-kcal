// Cloudflare Pages Function. Uses Open Food Facts community data, not official retailer catalogues.
export async function onRequestGet({request}) {
  const input = new URL(request.url);
  const q = (input.searchParams.get('q') || '').trim().slice(0,100);
  const store = input.searchParams.get('store') || 'both';
  if(q.length<2) return Response.json({error:'Voer minstens twee letters in.'},{status:400});
  const params = new URLSearchParams({search_terms:q,search_simple:'1',action:'process',json:'1',page_size:'100',fields:'code,product_name,product_name_nl,brands,stores,stores_tags,nutriments'});
  const hosts=['https://nl.openfoodfacts.org/cgi/search.pl','https://world.openfoodfacts.org/cgi/search.pl'];
  let last='';
  for(const host of hosts){
    try {
      const upstream=await fetch(host+'?'+params,{headers:{'Accept':'application/json','User-Agent':'EiwitKcal/1.1 (Cloudflare Pages; personal nutrition calculator)'},signal:AbortSignal.timeout(15000)});
      if(!upstream.ok){last='HTTP '+upstream.status;continue;}
      const data=await upstream.json();
      if(!Array.isArray(data.products)){last='Ongeldig antwoord';continue;}
      const products=data.products.filter(p=>{
        const tags=[...(p.stores_tags||[]),p.stores||''].join(' ').toLowerCase();
        const ah=/albert[ -]?heijn|\bah\b/.test(tags),jumbo=/jumbo/.test(tags);
        return store==='ah'?ah:store==='jumbo'?jumbo:ah||jumbo;
      }).map(p=>{
        const n=p.nutriments||{};
        const protein=n.proteins_100g==null?NaN:Number(n.proteins_100g);
        let kcal=n['energy-kcal_100g']==null?NaN:Number(n['energy-kcal_100g']);
        if(!Number.isFinite(kcal)&&n['energy-kj_100g']!=null)kcal=Number(n['energy-kj_100g'])/4.184;
        return {code:p.code,name:p.product_name_nl||p.product_name||'',brand:p.brands||'',protein,kcal};
      }).filter(p=>p.name&&Number.isFinite(p.protein)&&Number.isFinite(p.kcal)&&p.protein>=0&&p.kcal>=0);
      const unique=[...new Map(products.map(p=>[p.code||p.name,p])).values()].slice(0,35);
      return Response.json({products:unique},{headers:{'Cache-Control':'public, max-age=300'}});
    }catch(e){last=e?.message||'Netwerkfout';}
  }
  return Response.json({error:'Open Food Facts reageert niet ('+last+'). Probeer later opnieuw. De zoekfunctie gebruikt externe gegevens.'},{status:503});
}
