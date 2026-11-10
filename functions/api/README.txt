EIWIT & KCAL — ONLINE ZETTEN

Dit pakket bevat een website en een Cloudflare Pages Function.
Gebruik GitHub + Cloudflare Pages (de Functions-map moet mee worden gedeployed).

1. Maak gratis accounts op github.com en dash.cloudflare.com.
2. Maak een nieuwe PUBLIC of PRIVATE GitHub-repository, bijvoorbeeld eiwit-kcal.
3. Upload index.html EN de map functions/api/search.js in de repository.
   Let op: het pad moet exact functions/api/search.js zijn.
4. Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git.
5. Selecteer de repository. Kies geen framework, build command: exit 0,
   build output directory: / (of laat leeg indien toegestaan).
6. Deploy. Open de nieuwe *.pages.dev link.
7. Test met 'yoghurt' en 'Almhof'. De bron kan onvolledig zijn.

BELANGRIJK
- Dit zijn Open Food Facts-producten die als AH/Jumbo winkel zijn getagd,
  NIET de officiële complete catalogi van de supermarkten.
- Zoeken gebruikt een legacy Open Food Facts endpoint voor vrije tekst.
- Zoekopdrachten zijn gelimiteerd door Open Food Facts.
- Controleer voedingswaarden op de verpakking bij medisch gebruik.
- Dagtotalen worden lokaal in de browser bewaard, niet tussen apparaten gedeeld.
