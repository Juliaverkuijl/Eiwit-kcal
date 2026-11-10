// Same-origin image proxy for Open Food Facts product images.
export async function onRequestGet({request}) {
  const u=new URL(request.url);const raw=u.searchParams.get('url');
  if(!raw)return new Response('Missing image URL',{status:400});
  let target;try{target=new URL(raw)}catch{return new Response('Invalid URL',{status:400})}
  // Restrict hostnames to Open Food Facts image CDN to avoid an open proxy.
  if(target.protocol!=='https:' || !['images.openfoodfacts.org','static.openfoodfacts.org'].includes(target.hostname))return new Response('Forbidden',{status:403});
  try{
    const r=await fetch(target.toString(),{headers:{'Accept':'image/avif,image/webp,image/jpeg,image/png,image/*'},signal:AbortSignal.timeout(8000)});
    if(!r.ok)return new Response('Image unavailable',{status:404});
    const type=r.headers.get('content-type')||'';
    if(!type.startsWith('image/'))return new Response('Invalid image',{status:415});
    return new Response(r.body,{headers:{'Content-Type':type,'Cache-Control':'public, max-age=86400'}});
  }catch{return new Response('Image unavailable',{status:502})}
}
