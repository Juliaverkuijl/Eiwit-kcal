
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

// Zoekwoordvergelijking op basis van naam én merk. Vergelijk ook zonder
// spaties/streepjes en accepteer kleine typefouten bij langere woorden.
function compactText(s) {
  return clean(s).replace(/[^a-z0-9]+/g, ' ').trim();
}
function editDistanceAtMostOne(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + Number(i < a.length || j < b.length) <= 1;
}
function queryMatches(candidate, query) {
  const c = compactText(candidate);
  const q = compactText(query);
  if (!q) return false;
  const cWords = c.split(' ').filter(Boolean);
  const cCompact = cWords.join('');
  const qWords = q.split(' ').filter(Boolean);
  return qWords.every(t =>
    cWords.some(w => w === t ||
      (t.length >= 4 && w.length >= 4 && (w.startsWith(t) || t.startsWith(w))) ||
      (t.length >= 5 && w.length >= 5 && editDistanceAtMostOne(t, w))) ||
    (t.length >= 5 && (cCompact.includes(t) ||
      // Samengestelde merknamen: 'redband' tegenover 'Red Brand'.
      // Alleen een kleine afwijking accepteren bij een volledige merknaam.
      cWords.some((w, i) => i + 1 < cWords.length &&
        Math.abs((w + cWords[i + 1]).length - t.length) <= 1 &&
        editDistanceAtMostOne(t, w + cWords[i + 1]))))
  );
}

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  const q = (u.searchParams.get('q') || '').trim();
  const store = u.searchParams.get('store') || 'both';

  if (q.length < 2 || q.length > 120) {
    return Response.json({
      products: [],
      error: 'Vul een zoekterm in van 2 tot 120 tekens.'
    }, { status: 400 });
  }

  try {
    const normalized = clean(q)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

    // 'AH pasta', 'pasta AH', 'Albert Heijn pasta' en 'Jumbo pasta'
    // werken ook als de supermarktselector op 'AH en Jumbo' staat.
    const storeTerms = /\b(albert heijn|ah|jumbo|picnic|plus|lidl)\b/g;
    const mentioned = [...normalized.matchAll(storeTerms)].map(m => m[1]);
    const requestedStore = mentioned.some(x => x === 'ah' || x === 'albert heijn') ? 'ah'
      : mentioned.includes('jumbo') ? 'jumbo'
      : mentioned.includes('picnic') ? 'picnic'
      : mentioned.includes('plus') ? 'plus'
      : mentioned.includes('lidl') ? 'lidl' : null;
    const productTerm = normalized.replace(storeTerms, ' ').replace(/\s+/g, ' ').trim();
    const effectiveStore = store === 'both' && requestedStore ? requestedStore : store;
    const rankingTerm = productTerm || normalized;
    // Normaliseer schrijfwijzen zonder de originele zoekterm te verliezen.
    // Gebruik enkele gerichte verzoeken, niet zeven parallelle zoekopdrachten.
    const words = rankingTerm.split(/\s+/).filter(Boolean);
    const variants = [];
    const add = term => {
      const t = String(term || '').trim().replace(/\s+/g, ' ');
      if (t.length >= 2 && !variants.some(v => clean(v) === clean(t))) variants.push(t);
    };
    add(q);
    if (productTerm !== normalized) add(productTerm);

    // Generieke merk-/productcombinaties: probeer de meest specifieke
    // productwoorden zonder het eerste (of de eerste twee) woord(en).
    if (words.length >= 3) add(words.slice(1).join(' '));
    if (words.length >= 4) add(words.slice(2).join(' '));

    // Afwijkende schrijfwijzen en veelvoorkomende afkortingen.
    const synonyms = [
      [/\b(redband)\b/g, 'red band'],
      [/\b(red band)\b/g, 'redband'],
      [/\b(between|b tween|btween)\b/g, "b'tween"],
      [/\b(danoon|danontje)\b/g, 'danoontje'],
      [/\b(ontbi|ontbij)\b/g, 'ontbijtkoek']
    ];
    for (const [pattern, to] of synonyms) {
      if (pattern.test(normalized)) add(normalized.replace(pattern, to));
    }
    // Ook bij 'merk product' van twee woorden proberen we het productwoord.
    // De oorspronkelijke hele zoekopdracht blijft verplicht bij het filteren.
    if (words.length === 2 && words[1].length >= 5) add(words[1]);

    const queries = variants.slice(0, 5);
    async function lookup(term) {
      const api = new URL('https://world.openfoodfacts.org/cgi/search.pl');
      api.searchParams.set('search_terms', term);
      api.searchParams.set('search_simple', '1');
      api.searchParams.set('action', 'process');
      api.searchParams.set('json', '1');
      api.searchParams.set('page_size', '70');
      api.searchParams.set('fields',
        'code,product_name,brands,stores,quantity,serving_size,' +
        'product_quantity,product_quantity_unit,image_front_small_url,' +
        'image_front_url,image_url,nutriments,countries_tags,lang,' +
        'product_name_nl,product_name_en,product_name_fr');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5500);
      try {
        const r = await fetch(api.toString(), {
          headers: { 'User-Agent': 'EiwitKcal/1.1 (nutrition lookup)' },
          signal: controller.signal
        });
        if (!r.ok) throw new Error('Voedingsdatabase HTTP ' + r.status);
        const data = await r.json();
        if (!Array.isArray(data.products)) throw new Error('Ongeldig antwoord voedingsdatabase');
        return data.products;
      } finally { clearTimeout(timer); }
    }

    const raw = [];
    let successful = 0;
    const errors = [];
    // Maximaal twee gelijktijdige verzoeken per ronde; alleen een volgende
    // ronde als er nog geen goede kandidaat is. Eén fout blokkeert de rest niet.
    for (let i = 0; i < queries.length; i += 2) {
      const batch = await Promise.allSettled(queries.slice(i, i + 2).map(lookup));
      for (const result of batch) {
        if (result.status === 'fulfilled') {
          successful++;
          raw.push(...result.value);
        } else errors.push(String(result.reason?.message || result.reason));
      }
      // Stop zodra er relevante productnamen gevonden zijn. Dit voorkomt
      // onnodige verzoeken naar de externe database.
      if (raw.some(p => {
        const label = compactText([p.product_name_nl, p.product_name, p.brands].filter(Boolean).join(' '));
        return queryMatches(label, rankingTerm) &&
          Number.isFinite(Number(p.nutriments?.proteins_100g)) &&
          Number.isFinite(Number(p.nutriments?.['energy-kcal_100g']));
      })) break;
    }
    if (!successful) throw new Error(errors[0] || 'Voedingsdatabase niet bereikbaar');

    const products = raw.map(p => {
      const stores = clean(p.stores);
      const brand = clean(p.brands);
      const countries = (p.countries_tags || []).map(clean);
      const dutchMarket = countries.some(c => c === 'en:netherlands' || c === 'en:belgium');
      const dutchName = String(p.product_name_nl || '').trim();
      const productLanguage = clean(p.lang);
      const isDutchLanguage = productLanguage === 'nl' || !!dutchName;

      const ah =
        stores.includes('albert heijn') ||
        stores.includes('ah ') ||
        brand.includes('albert heijn') ||
        brand === 'ah';

      const jumbo =
        stores.includes('jumbo') ||
        brand.includes('jumbo');

      // Winkeltoewijzing alleen wanneer Open Food Facts de winkel/het merk vermeldt.
      // Geen aannames dat een merk bij een bepaalde supermarkt verkocht wordt.
      const picnic = /\bpicnic\b/.test(stores) || /\bpicnic\b/.test(brand);
      const plus = /\bplus\b/.test(stores) || /\bplus\b/.test(brand);
      const lidl = /\blidl\b/.test(stores) || /\blidl\b/.test(brand);

      if (
        (effectiveStore === 'ah' && !ah) ||
        (effectiveStore === 'jumbo' && !jumbo) ||
        (effectiveStore === 'picnic' && !picnic) ||
        (effectiveStore === 'plus' && !plus) ||
        (effectiveStore === 'lidl' && !lidl)
      ) {
        return null;
      }

      // Producten met een expliciet buitenlands land én zonder Nederlandse aansluiting weren.
      // Onbekende landen zijn niet automatisch buitenlands.
      if (countries.length && !dutchMarket && !ah && !jumbo && !picnic && !plus && !lidl) return null;
      const protein = p.nutriments?.proteins_100g == null ? NaN : Number(p.nutriments.proteins_100g);

      const kcal = p.nutriments?.['energy-kcal_100g'] == null ? NaN : Number(p.nutriments['energy-kcal_100g']);

      if (
        !Number.isFinite(protein) ||
        !Number.isFinite(kcal) ||
        protein < 0 ||
        kcal < 0
      ) {
        return null;
      }

      // Gebruik uitsluitend waarden van DEZELFDE Open Food Facts-productrecord.
      // Ontbrekende waarden blijven null, nooit 0.
      const optionalPer100g = key => {
        const value = p.nutriments?.[key];
        if (value === undefined || value === null || value === '') return null;
        const n = Number(value);
        return Number.isFinite(n) && n >= 0 ? n : null;
      };

      return {
        id: p.code,
        code: p.code,
        fat: optionalPer100g('fat_100g'),
        sugar: optionalPer100g('sugars_100g'),
        carbs: optionalPer100g('carbohydrates_100g'),
        nutritionSource: 'Open Food Facts (zelfde productrecord)',
        name: dutchName || p.product_name || 'Naam onbekend',
        dutchMarket,
        dutchLanguage: isDutchLanguage,
        brand: p.brands || '',
        store: lidl ? 'Lidl' : picnic ? 'Picnic' : plus ? 'PLUS' : ah ? 'Albert Heijn' : jumbo ? 'Jumbo' : 'Open Food Facts',
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

    const tokens = rankingTerm
      .split(' ')
      .filter(x => x.length > 2);

    // Rangschik op productnaam en producttype, niet alleen op een woord
    // dat ergens in merk of beschrijving voorkomt.
    const pastaTypes = /\b(penne|fusilli|spaghetti|macaroni|farfalle|rigatoni|tagliatelle|linguine|lasagnebladen|schelpjes|conchiglie|orzo|tortiglioni|pastaschelpjes)\b/;
    const pastaRelated = /\b(pesto|saus|sauce|pastasaus|soep|salade|maaltijd|kant.en.klaar|dressing|kruiden|mix|chips|spread)\b/;
    const score = p => {
      const name = clean(p.name).replace(/[^a-z0-9]+/g, ' ').trim();
      const brand = clean(p.brand);
      const words = name.split(/\s+/);
      let n = 0;
      const shop = clean(p.store);
      const matchingStore = (effectiveStore === 'ah' && shop === 'albert heijn') ||
        (effectiveStore === 'jumbo' && shop === 'jumbo') ||
        (effectiveStore === 'picnic' && shop === 'picnic') ||
        (effectiveStore === 'plus' && shop === 'plus') ||
        (effectiveStore === 'lidl' && shop === 'lidl');
      // Een expliciet merk of supermarktwoord moet relevant zijn, ook als
      // het niet letterlijk in de productnaam staat.
      if (matchingStore) n += 65;
      if (requestedStore && matchingStore) n += 65;
      if (name === rankingTerm) n += 150;
      if (name.startsWith(rankingTerm + ' ')) n += 85;
      if (words.includes(rankingTerm)) n += 65;
      if (name.includes(rankingTerm)) n += 35;
      if (brand.includes(rankingTerm)) n += 5;
      for (const token of tokens) {
        if (words.includes(token)) n += 24;
        else if (name.includes(token)) n += 10;
        if (brand.split(/[^a-z0-9]+/).includes(token)) n += 28;
        else if (brand.includes(token)) n += 14;
        if (shop.includes(token)) n += 8;
      }
      // 'Pasta' moet echte pasta tonen vóór pesto, sauzen en maaltijden.
      if (rankingTerm === 'pasta' || rankingTerm === 'pastas') {
        if (pastaTypes.test(name)) n += 90;
        if (/\b(pasta|deegwaren)\b/.test(name)) n += 45;
        if (pastaRelated.test(name)) n -= 110;
      }
      if (/between|btween|b tween/.test(rankingTerm) && /b.?tween|between/.test(name)) n += 50;
      if (p.store !== 'Open Food Facts') n += 12;
      if (p.dutchMarket) n += 40;
      if (p.dutchLanguage) n += 25;
      if (p.image) n += 3;
      if (p.fat !== null && p.sugar !== null && p.carbs !== null) n += 2;
      return n;
    };

    // Alleen producten waarvan alle belangrijke zoekwoorden in naam/merk voorkomen.
    // Winkelinformatie is nooit een vervanging voor een overeenkomst met de productnaam.
    const matches = p => queryMatches(p.name + ' ' + p.brand, rankingTerm);
    // Bij onbekende winkel alleen Nederlandse markt of Nederlandse producttaal toelaten.
    const relevant = unique.filter(p => matches(p) &&
      (p.store !== 'Open Food Facts' || p.dutchMarket || p.dutchLanguage));
    const tier = p => ['Albert Heijn','Jumbo'].includes(p.store) ? 0 :
      ['Picnic','PLUS','Lidl'].includes(p.store) ? 1 : 2;
    relevant.sort((a,b) => score(b)-score(a) || tier(a)-tier(b));



    return Response.json({
      products: relevant.slice(0, 80),
      source: 'Open Food Facts; winkels op basis van productmetadata, geen officiële assortiment-API',
      expanded: effectiveStore === 'both'
    });

  } catch (e) {
    return Response.json({
      products: [],
      error: 'Zoeken niet gelukt: ' + e.message
    }, { status: 503 });
  }
}
