import catalog from "./verified-products.json";

const clean = s => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

function portion(p) {
  const num = x => Number(String(x).replace(',', '.'));
  const values = [
    p.quantity,
    p.product_name,
    p.serving_size
  ].filter(Boolean).map(String);

  // Multipacks: 4 x 50 g, 6×30g, 4 stuks à 50 g.
  for (const value of values) {
    const m = value.match(
      /(?:^|\D)(\d{1,3})\s*(?:x|×|stuks?\s*(?:van|à))\s*(\d+(?:[.,]\d+)?)\s*(g|gram)\b/i
    );

    if (m && num(m[1]) > 0 && num(m[2]) > 0) {
      return {
        grams: num(m[2]),
        count: num(m[1]),
        source: 'stuk',
        estimated: false,
        verifiedFrom: 'multipack'
      };
    }
  }

  const quantity = String(p.quantity || '');

  const total = quantity.match(
    /(?:^|\s)(\d+(?:[.,]\d+)?)\s*(g|gram)\b/i
  );

  const count = values.join(' ').match(
    /(?:^|\s)(\d{1,3})\s*(?:stuks?|potjes|repen|zakjes|koekjes|cups?)\b/i
  );

  if (
    total &&
    count &&
    num(count[1]) > 0 &&
    num(total[1]) > 0 &&
    num(total[1]) >= num(count[1])
  ) {
    return {
      grams: num(total[1]) / num(count[1]),
      count: num(count[1]),
      source: 'stuk',
      estimated: false,
      verifiedFrom: 'totaal / aantal'
    };
  }

  const serving = String(p.serving_size || '');
  const m = serving.match(/(\d+(?:[.,]\d+)?)\s*(g|gram)\b/i);

  if (m && num(m[1]) > 0) {
    return {
      grams: num(m[1]),
      count: null,
      source: 'portie',
      estimated: false,
      verifiedFrom: 'portiegrootte'
    };
  }

  const single = quantity.match(
    /^\s*(\d+(?:[.,]\d+)?)\s*(g|gram)\s*$/i
  );

  if (
    single &&
    /\b(?:1\s*(?:stuk|reep|potje|zakje|koek|bol|broodje)|per stuk)\b/i
      .test(String(p.product_name || ''))
  ) {
    return {
      grams: num(single[1]),
      count: 1,
      source: 'stuk',
      estimated: false,
      verifiedFrom: 'enkel product'
    };
  }

  // Milliliters worden niet automatisch naar grammen omgerekend.
  return null;
}

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const q = (u.searchParams.get('q') || '').trim();
  const store = u.searchParams.get('store') || 'both';

  if (q.length < 2) {
    return Response.json({
      products: [],
      error: 'Vul minimaal twee letters in.'
    }, { status: 400 });
  }

  try {
    const cleanSearch = clean(q).replace(/[^a-z0-9]+/g,' ').trim();
    const terms = cleanSearch.split(/\s+/).filter(x=>x.length>1 && !['ah','albert','heijn','jumbo','plus','picnic'].includes(x));
    const matchingCatalog = catalog.filter(p => {
      const shop = clean(p.store);
      if(store==='ah' && shop!=='albert heijn')return false;
      if(store==='jumbo' && shop!=='jumbo')return false;
      if(store==='picnic' || store==='plus')return false;
      const hay = clean(p.name+' '+p.brand).replace(/[^a-z0-9]+/g,' ');
      return terms.length && terms.every(t=>hay.includes(t));
    });
    // Alleen producten met een rechtstreeks gecontroleerde supermarktbron.
    // Geen Open Food Facts-producten, ook niet wanneer een winkel in de metadata staat.
    return Response.json({
      products: matchingCatalog,
      source: 'Geverifieerde supermarktproductpagina’s',
      expanded: false
    });

  } catch (e) {
    return Response.json({
      products: [],
      error: 'Zoeken niet gelukt: ' + e.message
    }, { status: 503 });
  }
}
