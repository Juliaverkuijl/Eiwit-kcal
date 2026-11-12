
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


// Normalisatie en zoekstrategie zijn generiek: geen product-specifieke uitzonderingen.
const norm = s => clean(s).replace(/&/g, ' en ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const compact = s => norm(s).replace(/\s/g, '');
const words = s => norm(s).split(' ').filter(Boolean);
const STORE_RE = /\b(albert heijn|ah|jumbo|picnic|plus|lidl)\b/g;
const STORE_NAME = {ah:'Albert Heijn',jumbo:'Jumbo',picnic:'Picnic',plus:'PLUS',lidl:'Lidl'};
const STOP = new Set(['de','het','een','en','van','met','voor','per','in','op','a','the']);
const json = (obj, status=200) => Response.json(obj, {status,headers:{'Cache-Control':'no-store'}});

function distance(a,b,max=2) {
  if (Math.abs(a.length-b.length)>max) return max+1;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const next=[i]; let best=i;
    for(let j=1;j<=b.length;j++){
      const v=Math.min(prev[j]+1,next[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
      next.push(v); best=Math.min(best,v);
    }
    if(best>max)return max+1;
    prev=next;
  }
  return prev[b.length];
}
function tokenMatches(token, candidateTokens, candidateCompact) {
  if(candidateTokens.includes(token) || (token.length>=5 && candidateCompact.includes(token)))return true;
  if(token.length<5)return false;
  // Vergelijk ook aaneengeschreven merkwoorden met twee losse woorden.
  // Bijvoorbeeld 'redband' versus 'red brand' (redbrand).
  if(candidateTokens.some((t,i)=>i+1<candidateTokens.length &&
    Math.abs((t+candidateTokens[i+1]).length-token.length)<=2 &&
    distance(token,t+candidateTokens[i+1],token.length>=7?2:1)<=(token.length>=7?2:1)))return true;
  return candidateTokens.some(t => t.length>=4 && (t.startsWith(token) || token.startsWith(t) && Math.min(t.length,token.length)>=5 ||
    (token.length>=6 && distance(token,t,token.length>=9?2:1)<=(token.length>=9?2:1))));
}
function relevance(p, query, store) {
  const name=norm(p.name), brand=norm(p.brand), all=norm(p.name+' '+p.brand);
  const allTokens=words(all), joined=compact(all);
  const tokens=words(query).filter(t=>!STOP.has(t));
  if(!tokens.length)return -1;
  const matched=tokens.filter(t=>tokenMatches(t,allTokens,joined)).length;
  // Minstens alle belangrijke termen. Een klein typefoutje is toegestaan,
  // maar producten die niet lijken op de zoekopdracht worden nooit toegelaten.
  if(matched<tokens.length)return -1;
  let score=matched*28;
  if(name===query)score+=180;
  if(name.startsWith(query+' '))score+=95;
  if(name.includes(query))score+=65;
  if(joined.includes(compact(query)))score+=55;
  if(brand && tokens.some(t=>tokenMatches(t,words(brand),compact(brand))))score+=32;
  if(p.dutchMarket)score+=35;
  if(p.dutchLanguage)score+=22;
  if(p.store!=='Open Food Facts')score+=12;
  if(p.image)score+=3;
  if(p.fat!=null && p.sugar!=null && p.carbs!=null)score+=2;
  if(store!=='both' && p.store===STORE_NAME[store])score+=75;
  // Bij generieke categorieën zoals pasta krijgen echte basisproducten voorrang.
  if(query==='pasta'||query==='pastas'){
    if(/\b(penne|fusilli|spaghetti|macaroni|farfalle|rigatoni|tagliatelle|linguine|orzo|pasta)\b/.test(name))score+=55;
    if(/\b(pesto|saus|sauce|soep|salade|chips|dressing)\b/.test(name))score-=110;
  }
  return score;
}
function mapProduct(p, store) {
  const st=norm(p.stores), brand=norm(p.brands);
  const countries=(p.countries_tags||[]).map(clean);
  const dutchMarket=countries.includes('en:netherlands')||countries.includes('en:belgium');
  const dutchName=String(p.product_name_nl||'').trim();
  const dutchLanguage=!!dutchName || clean(p.lang)==='nl';
  const detected={
    ah:st.includes('albert heijn')||brand==='ah'||brand.includes('albert heijn'),
    jumbo:/\bjumbo\b/.test(st+' '+brand),
    picnic:/\bpicnic\b/.test(st+' '+brand),
    plus:/\bplus\b/.test(st+' '+brand),
    lidl:/\blidl\b/.test(st+' '+brand)
  };
  if(store!=='both' && !detected[store])return null;
  if(countries.length&&!dutchMarket&&!Object.values(detected).some(Boolean))return null;
  const n=p.nutriments||{};
  const valid=k=>n[k]!==undefined&&n[k]!==null&&n[k]!==''&&Number.isFinite(Number(n[k]))&&Number(n[k])>=0;
  if(!valid('proteins_100g')||!valid('energy-kcal_100g'))return null;
  const opt=k=>valid(k)?Number(n[k]):null;
  const code=String(p.code||'').trim();
  if(!code)return null;
  return {
    id:code,code, name:dutchName||p.product_name||'Naam onbekend',brand:p.brands||'',
    store: detected.lidl?'Lidl':detected.picnic?'Picnic':detected.plus?'PLUS':detected.ah?'Albert Heijn':detected.jumbo?'Jumbo':'Open Food Facts',
    protein:Number(n.proteins_100g),kcal:Number(n['energy-kcal_100g']),
    fat:opt('fat_100g'),sugar:opt('sugars_100g'),carbs:opt('carbohydrates_100g'),
    nutritionSource:'Open Food Facts (zelfde productrecord)',
    image:p.image_front_url||p.image_front_small_url||p.image_url||null,
    quantity:p.quantity||'',portion:portion(p),dutchMarket,dutchLanguage
  };
}

function searchVariants(q) {
  const n=norm(q);
  const withoutStore=n.replace(STORE_RE,' ').replace(/\s+/g,' ').trim();
  const tokens=words(withoutStore);
  const variants=[n];
  if(withoutStore!==n)variants.push(withoutStore);
  // Exacte productwoorden leveren vaak meer resultaten op dan merk + product.
  if(tokens.length>=3)variants.push(tokens.slice(1).join(' '));
  if(tokens.length>=4)variants.push(tokens.slice(2).join(' '));
  // Kleine variaties van het begin van de productnaam, zonder hardcoded merken.
  if(tokens.length>=2)variants.push(tokens.slice(-2).join(' '));
  // Compacte merknaam hoeft niet bij de bron exact hetzelfde gespeld te zijn.
  if(tokens.length>=3 && tokens[0].length>=5)variants.push(tokens.slice(1).join(' '));
  return [...new Set(variants.filter(x=>x.length>=3))].slice(0,5);
}

async function lookup(term) {
  const url=new URL('https://world.openfoodfacts.org/cgi/search.pl');
  for(const [k,v] of Object.entries({search_terms:term,search_simple:'1',action:'process',json:'1',page_size:'80',
    fields:'code,product_name,brands,stores,quantity,serving_size,image_front_small_url,image_front_url,image_url,nutriments,countries_tags,lang,product_name_nl'}))url.searchParams.set(k,v);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),6500);
  try{
    const res=await fetch(url.toString(),{headers:{'User-Agent':'EiwitKcal/1.0 (nutrition lookup)','Accept':'application/json'},signal:controller.signal});
    if(!res.ok)throw new Error('HTTP '+res.status);
    const data=await res.json();
    if(!Array.isArray(data.products))throw new Error('Ongeldig antwoord van voedingsdatabase');
    return data.products;
  }finally{clearTimeout(timer)}
}

export async function onRequestGet({request}) {
  const u=new URL(request.url);
  const q=(u.searchParams.get('q')||'').trim().slice(0,120);
  const storeRaw=u.searchParams.get('store')||'both';
  if(q.length<2)return json({products:[],error:'Vul minimaal twee letters in.'},400);
  const n=norm(q);
  const storeMatch=[...n.matchAll(STORE_RE)].map(m=>m[1]);
  const requestedStore=storeMatch.includes('ah')||storeMatch.includes('albert heijn')?'ah':
    ['jumbo','picnic','plus','lidl'].find(s=>storeMatch.includes(s))||null;
  const store=(storeRaw==='both'&&requestedStore?requestedStore:storeRaw);
  const safeStore=['both','ah','jumbo','picnic','plus','lidl'].includes(store)?store:'both';
  const query=norm(n.replace(STORE_RE,' '))||n;
  const variants=searchVariants(q);
  const found=new Map();
  let successful=0; const errors=[];const attempted=[];
  // Geen parallelle burst. De eerste treffers kunnen direct stoppen;
  // een mislukte bronpoging verhindert een volgende niet.
  for(const term of variants){
    attempted.push(term);
    try{
      const raw=await lookup(term);successful++;
      for(const r of raw){
        const p=mapProduct(r,safeStore);
        if(!p)continue;
        const rank=relevance(p,query,safeStore);
        if(rank<0)continue;
        const old=found.get(p.id);
        if(!old||rank>old.rank)found.set(p.id,{p,rank});
      }
      if(found.size>=12)break;
    }catch(e){errors.push(String(e?.message||e));}
  }
  if(!successful)return json({products:[],error:'Voedingsdatabase tijdelijk niet bereikbaar. Probeer het later opnieuw.',sourceStatus:'unavailable'},503);
  const products=[...found.values()].sort((a,b)=>b.rank-a.rank).slice(0,80).map(x=>x.p);
  return json({products,source:'Open Food Facts; winkels op basis van productmetadata, geen officiële assortiment-API',
    expanded:safeStore==='both',sourceStatus:errors.length?'partial':'ok',searchAttempts:attempted.length});
}
