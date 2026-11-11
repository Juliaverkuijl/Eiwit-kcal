// Barcode lookup using the same Open Food Facts record for all nutrients.
export async function onRequestGet({request}) {
 const code=new URL(request.url).searchParams.get('code')||'';
 if(!/^\d{8,14}$/.test(code))return Response.json({error:'Ongeldige barcode'}, {status:400});
 try {
  const r=await fetch('https://world.openfoodfacts.org/api/v2/product/'+encodeURIComponent(code)+'.json?fields=code,product_name,brands,stores,quantity,serving_size,image_front_small_url,nutriments', {headers:{'User-Agent':'EiwitKcal/1.0 (barcode lookup)'}});
  if(!r.ok)throw Error('Productdatabase tijdelijk niet beschikbaar');
  const d=await r.json(),p=d.product,n=p?.nutriments||{};
  if(!p||d.status!==1||!p.product_name)return Response.json({error:'Barcode niet gevonden in Open Food Facts'}, {status:404});
  const numeric=k=>n[k]===undefined||n[k]===null?null:Number.isFinite(Number(n[k]))&&Number(n[k])>=0?Number(n[k]):null;
  const protein=numeric('proteins_100g'),kcal=numeric('energy-kcal_100g');
  if(protein===null||kcal===null)return Response.json({error:'Product gevonden, maar eiwit of kcal ontbreken. Voeg het handmatig toe.'},{status:422});
  return Response.json({product:{id:p.code,code:p.code,name:p.product_name,brand:p.brands||'',store:p.stores||'Open Food Facts',protein,kcal,fat:numeric('fat_100g'),sugar:numeric('sugars_100g'),carbs:numeric('carbohydrates_100g'),nutritionSource:'Open Food Facts (barcode)',image:p.image_front_small_url||'',quantity:p.quantity||'',portion:null}});
 }catch(e){return Response.json({error:e.message||'Barcode opzoeken mislukt'},{status:503})}
}
