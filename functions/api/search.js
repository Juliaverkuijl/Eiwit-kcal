
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
    const normalized = clean(q)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

    const aliases = [
      [/\b(between|b tween|btween|b twe en)\b/g, "b'tween"],
      [/\b(between|b tween|btween|b twe en)\b/g, 'hero'],
      [/\b(reep|repen|mueslireep|mueslirepen)\b/g, 'mueslireep'],
      [/\b(ontbi|ontbij)\b/g, 'ontbijtkoek'],
      [/\b(danoon|danontje)\b/g, 'danoontje']
    ];

    const variants = [q];

    for (const [pattern, replacement] of aliases) {
      if (pattern.test(normalized)) {
        variants.push(
          normalized.replace(pattern, replacement).trim()
        );
      }
    }

    if (/\b(between|btween|b tween)\b/.test(normalized)) {
      variants.push(
        "B'tween",
        "Hero B'tween",
        'Hero mueslireep'
      );
    }

    if (normalized === 'ontbi' || normalized === 'ontbij') {
      variants.push('ontbijtkoek');
    }

    const queries = [
      ...new Set(variants.map(x => x.trim()).filter(Boolean))
    ].slice(0, 5);

    async function lookup(term) {
      const api = new URL(
        'https://world.openfoodfacts.org/cgi/search.pl'
      );

      api.searchParams.set('search_terms', term);
      api.searchParams.set('search_simple', '1');
      api.searchParams.set('action', 'process');
      api.searchParams.set('json', '1');
      api.searchParams.set('page_size', '100');

      api.searchParams.set(
        'fields',
        'code,product_name,brands,stores,quantity,' +
        'serving_size,product_quantity,product_quantity_unit,' +
        'image_front_small_url,image_front_url,image_url,nutriments'
      );

      const r = await fetch(api.toString(), {
        headers: {
          'User-Agent': 'EiwitKcal/1.0 (nutrition lookup)'
        }
      });

      if (!r.ok) {
        throw new Error('Voedingsdatabase HTTP ' + r.status);
      }

      const data = await r.json();
      return data.products || [];
    }

    const batches = await Promise.allSettled(
      queries.map(lookup)
    );

    // NIEUW: toon de daadwerkelijke fout bij mislukte verzoeken.
    if (!batches.some(x => x.status === 'fulfilled')) {
      const errors = batches
        .filter(x => x.status === 'rejected')
        .map(x => String(x.reason?.message || x.reason));

      throw new Error(
        errors.join(' | ') || 'Onbekende fout'
      );
    }

    const raw = batches.flatMap(
      x => x.status === 'fulfilled' ? x.value : []
    );

    const products = raw.map(p => {
      const stores = clean(p.stores);
      const brand = clean(p.brands);

      const ah =
        stores.includes('albert heijn') ||
        stores.includes('ah ') ||
        brand.includes('albert heijn') ||
        brand === 'ah';

      const jumbo =
        stores.includes('jumbo') ||
        brand.includes('jumbo');

      if (
        !(ah || jumbo) ||
        (store === 'ah' && !ah) ||
        (store === 'jumbo' && !jumbo)
      ) {
        return null;
      }

      const protein = Number(
        p.nutriments?.proteins_100g
      );

      const kcal = Number(
        p.nutriments?.['energy-kcal_100g']
      );

      if (
        !Number.isFinite(protein) ||
        !Number.isFinite(kcal) ||
        protein < 0 ||
        kcal < 0
      ) {
        return null;
      }

      return {
        id: p.code,
        name: p.product_name || 'Naam onbekend',
        brand: p.brands || '',
        store: ah ? 'Albert Heijn' : 'Jumbo',
        protein,
        kcal,
        image:
          p.image_front_url ||
          p.image_front_small_url ||
          p.image_url ||
          null,
        quantity: p.quantity || '',
        portion: portion(p)
      };
    }).filter(Boolean);

    const unique = [
      ...new Map(products.map(p => [p.id, p])).values()
    ];

    const tokens = normalized
      .split(' ')
      .filter(x => x.length > 2);

    const score = p => {
      const title = clean(p.name + ' ' + p.brand);
      let n = 0;

      if (title.includes(normalized)) n += 10;

      for (const token of tokens) {
        if (title.includes(token)) n += 3;
      }

      if (
        /between|btween|b tween/.test(normalized) &&
        /b.?tween|between/.test(title)
      ) {
        n += 15;
      }

      if (p.image) n += 1;

      return n;
    };

    unique.sort((a, b) => score(b) - score(a));

    return Response.json({
      products: unique,
      source: 'Open Food Facts; winkeltoewijzing op basis van productmetadata'
    });

  } catch (e) {
    return Response.json({
      products: [],
      error: 'Zoeken niet gelukt: ' + e.message
    }, { status: 503 });
  }
}
