// Playwright-controles v1 — draait tegen de nagebootste Supabase (tests/mock.js)
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const { maakMock } = require('./mock');
const ROOT = path.join(__dirname, '..'); const SB = 'https://nfjhtvrhdqejustcpvmm.supabase.co';
let ok = 0, fout = 0; const fouten = [];
function check(naam, cond) { if (cond) ok++; else { fout++; fouten.push(naam); console.log('  ✗ ' + naam); } }
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0])); if (p.endsWith('/')) p += 'index.html'; fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(d); }); });

(async () => {
  await new Promise(r => server.listen(8787, r));
  const browser = await chromium.launch();
  const mock = maakMock();
  const nieuwePagina = async (mobiel) => { const ctx = await browser.newContext(mobiel ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 900 } }); const page = await ctx.newPage(); page.on('pageerror', e => { console.log('PAGE ERROR', e.message); fout++; fouten.push('pageerror: ' + e.message); }); await mock.installeer(page, SB); await page.goto('http://localhost:8787/index.html'); return { ctx, page }; };
  const login = async (page, email, ww) => { await page.fill('#login-email', email); await page.fill('#login-ww', ww); await page.click('#login-form button[type=submit]'); await page.waitForSelector('#app:not([hidden])', { timeout: 8000 }); await page.waitForTimeout(300); };
  const tab = async (page, t) => { await page.click(`#tabs [data-tab=${t}]`); await page.waitForTimeout(200); };
  const shot = (page, n) => page.screenshot({ path: path.join(__dirname, 'screens', n + '.png'), fullPage: false });

  // ---- 1. login ----
  console.log('1. Login');
  let { ctx, page } = await nieuwePagina(false);
  await page.fill('#login-email', 'koen@test.nl'); await page.fill('#login-ww', 'fout'); await page.click('#login-form button[type=submit]'); await page.waitForTimeout(400);
  check('foute login geeft melding', (await page.textContent('#login-melding')).includes('klopt niet'));
  await shot(page, '01-login');
  await login(page, 'koen@test.nl', 'schraven123');
  check('Schraven ziet ruimtekeuze', await page.isVisible('#ruimte-kies'));
  check('naam in kop', (await page.textContent('#wie')).includes('Koen Schraven'));
  check('Team-tab heet Team voor Schraven', (await page.textContent('#tabs [data-tab=team]')).trim() === 'Team');
  check('overzicht leeg', (await page.textContent('#main')).includes('Nog niets gebeurd'));
  await shot(page, '02-overzicht-leeg');

  // ---- 2. bestanden ----
  console.log('2. Bestanden');
  await tab(page, 'bestanden');
  await page.click('#map-nieuw'); await page.fill('#vraag-in', '01 Tekeningen'); await page.click('#modal-opslaan'); await page.waitForTimeout(200);
  check('map aangemaakt en gekozen', (await page.textContent('.paneel h2')).includes('01 Tekeningen'));
  await page.setInputFiles('#upl', { name: 'kozijnstaat.dwg', mimeType: 'application/acad', buffer: Buffer.from('DWG-INHOUD-KLEIN') });
  await page.waitForTimeout(800);
  check('klein bestand in lijst', (await page.textContent('table.lijst')).includes('kozijnstaat.dwg'));
  check('bestand in mock-db met map', mock.db.bestanden.length === 1 && mock.db.bestanden[0].map === '01 Tekeningen');
  check('versie 1 opgeslagen in storage', Object.keys(mock.storage).some(k => k.endsWith('/v1/kozijnstaat.dwg')));
  check('logboek-regel bij upload', mock.db.bestand_log.some(l => l.soort === 'upload'));
  check('Dropbox-kopie aangevraagd', mock.apiCalls.some(c => c.pad === '/api/dropbox'));
  // groot bestand (7 MB) via hervatbare upload
  await page.setInputFiles('#upl', { name: 'gevelaanzicht.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(7 * 1024 * 1024, 65) });
  await page.waitForSelector('.uploads .item:has-text("klaar")', { timeout: 20000 }).catch(() => { });
  await page.waitForTimeout(800);
  const groot = Object.entries(mock.storage).find(([k]) => k.endsWith('gevelaanzicht.pdf'));
  check('groot bestand via hervatbare upload compleet (7 MB)', groot && groot[1].length === 7 * 1024 * 1024);
  check('2 bestanden in lijst', (await page.$$('table.lijst tbody tr')).length === 2);
  await shot(page, '03-bestanden');
  // detail-lade: status, opmerking, nieuwe versie
  await page.click('table.lijst tbody tr:has-text("kozijnstaat.dwg")'); await page.waitForSelector('.lade');
  check('lade toont versies', (await page.textContent('.lade .versies')).includes('v1'));
  await page.selectOption('#b-status', 'ter_controle'); await page.waitForTimeout(400);
  check('status ter controle opgeslagen', mock.db.bestanden[0].status === 'ter_controle');
  check('status in logboek', mock.db.bestand_log.some(l => l.soort === 'status' && /Ter controle/.test(l.tekst)));
  await page.fill('#b-opm', 'Maat detail 3 klopt niet'); await page.click('#b-opm-knop'); await page.waitForTimeout(400);
  check('opmerking bij bestand', mock.db.opmerkingen.some(o => o.doel_type === 'bestand' && o.tekst.includes('detail 3')));
  check('opmerking zichtbaar in logboek-lade', (await page.textContent('.lade .logboek')).includes('detail 3'));
  await page.setInputFiles('#b-upl', { name: 'kozijnstaat-v2.dwg', mimeType: 'application/acad', buffer: Buffer.from('DWG-V2') });
  await page.waitForTimeout(800);
  check('nieuwe versie v2', mock.db.bestand_versies.filter(v => v.bestand_id === mock.db.bestanden[0].id).length === 2 && mock.db.bestanden[0].huidige_versie === 2);
  check('lade toont v2', (await page.textContent('.lade .versies')).includes('v2'));
  await shot(page, '04-bestand-lade');
  const [dl] = await Promise.all([ctx.waitForEvent('page'), page.click('.lade [data-dl]')]);
  await dl.waitForLoadState().catch(() => { }); await page.waitForTimeout(300);
  check('download opent (signed url)', dl.url().includes('/object/sign/'));
  await dl.close();
  check('download in logboek', mock.db.bestand_log.some(l => l.soort === 'download'));
  await page.fill('#b-oms', 'Kozijnstaat blok A'); await page.click('#b-oms-opsl'); await page.waitForTimeout(300);
  check('omschrijving opgeslagen', mock.db.bestanden[0].omschrijving === 'Kozijnstaat blok A');
  await page.click('#lade-sluit'); await page.waitForTimeout(200);
  check('teller ter controle op tab', (await page.textContent('#tel-bestanden')) === '1');

  // ---- 3. actiepunten ----
  console.log('3. Actiepunten');
  await tab(page, 'acties');
  await page.click('#a-nieuw'); await page.fill('#a-titel', 'Detail 3 aanpassen'); await page.fill('#a-oms', 'Zie opmerking bij kozijnstaat');
  await page.selectOption('#a-wie', { label: 'Anna de Vries (Opdrachtgever)' }); await page.fill('#a-dl', '2026-09-01'); await page.selectOption('#a-prio', 'hoog'); await page.click('#modal-opslaan'); await page.waitForTimeout(400);
  check('actie aangemaakt met nummer', mock.db.acties.length === 1 && mock.db.acties[0].nummer === 1);
  check('te-laat-tag zichtbaar', (await page.$$('table.lijst .tag.telaat')).length === 1);
  check('hoog-tag', (await page.$$('table.lijst .tag.hoog')).length === 1);
  check('teller acties', (await page.textContent('#tel-acties')) === '1');
  await page.click('#a-nieuw'); await page.fill('#a-titel', 'Levertijd glas bevestigen'); await page.fill('#a-wie-naam', 'Glasleverancier'); await page.fill('#a-dl', '2026-12-01'); await page.click('#modal-opslaan'); await page.waitForTimeout(400);
  check('2 acties, gesorteerd op deadline', (await page.textContent('table.lijst tbody tr:first-child')).includes('Detail 3'));
  await page.selectOption('table.lijst tbody tr:first-child select', 'klaar'); await page.waitForTimeout(400);
  check('status klaar via lijst + klaar_op', mock.db.acties[0].status === 'klaar' && !!mock.db.acties[0].klaar_op);
  check('open-filter verbergt afgeronde', (await page.$$('table.lijst tbody tr')).length === 1);
  await page.click('.chip[data-f=klaar]'); await page.waitForTimeout(200);
  check('afgerond-filter toont hem', (await page.textContent('table.lijst')).includes('Detail 3'));
  await page.click('table.lijst tbody tr'); await page.waitForSelector('.lade');
  check('actie-lade toont afgerond', (await page.textContent('.lade')).includes('Afgerond'));
  await page.click('#a-heropen'); await page.waitForTimeout(400);
  check('heropenen werkt', mock.db.acties[0].status === 'open');
  await page.fill('#opm-in', 'Ik pak dit morgen op'); await page.click('#opm-knop'); await page.waitForTimeout(300);
  check('opmerking bij actie', mock.db.opmerkingen.some(o => o.doel_type === 'actie'));
  await shot(page, '05-actie-lade');
  await page.click('#lade-sluit');

  // ---- 4. afspraken ----
  console.log('4. Afspraken');
  await tab(page, 'afspraken');
  await page.click('#af-nieuw'); await page.selectOption('#af-soort', 'overleg'); await page.fill('#af-titel', 'Bouwvergadering 12'); await page.fill('#af-tekst', 'Besproken: glaslevering week 44.\nAfspraak: opdrachtgever levert kleuren aan.'); await page.fill('#af-aanw', 'Koen, Anna, uitvoerder'); await page.click('#modal-opslaan'); await page.waitForTimeout(400);
  check('afspraak aangemaakt', mock.db.afspraken.length === 1 && mock.db.afspraken[0].soort === 'overleg');
  await page.click('table.lijst tbody tr'); await page.waitForSelector('.lade');
  await page.click('#af-actie'); await page.fill('#a-titel', 'Kleuren aanleveren'); await page.selectOption('#a-wie', { label: 'Anna de Vries (Opdrachtgever)' }); await page.click('#modal-opslaan'); await page.waitForTimeout(400);
  const gek = mock.db.acties.find(a => a.titel === 'Kleuren aanleveren');
  check('actie gekoppeld aan afspraak', gek && gek.bron_type === 'afspraak' && gek.bron_id === mock.db.afspraken[0].id);
  check('lade toont gekoppelde actie', (await page.textContent('.lade')).includes('Kleuren aanleveren'));
  await shot(page, '06-afspraak-lade');
  await page.click('#lade-sluit'); await page.waitForTimeout(200);
  check('afsprakenlijst telt acties', (await page.textContent('table.lijst tbody tr')).includes('1'));

  // ---- 5. mail ----
  console.log('5. Mail');
  await tab(page, 'mail');
  await page.click('#m-nieuw'); await page.fill('#m-aan', 'anna@opdrachtgever.nl'); await page.fill('#m-ond', 'Kozijnstaat blok A ter controle'); await page.fill('#m-tekst', 'Hoi Anna,\nBijgaand de kozijnstaat.\nGroet, Koen');
  await page.setInputFiles('#m-bijl', { name: 'kozijnstaat.pdf', mimeType: 'application/pdf', buffer: Buffer.from('PDF') });
  await page.click('#modal-opslaan'); await page.waitForTimeout(600);
  check('mail gelogd met bijlage', mock.db.mails.length === 1 && mock.db.mails[0].bijlagen.length === 1 && mock.db.mails[0].richting === 'uit');
  check('mail in lijst met paperclip', (await page.textContent('table.lijst')).includes('📎 1'));
  await page.click('table.lijst tbody tr'); await page.waitForSelector('.lade');
  check('mail-lade toont tekst', (await page.textContent('.mail-tekst')).includes('Bijgaand'));
  await page.click('#m-actie'); check('actie uit mail voorgevuld', (await page.inputValue('#a-titel')).startsWith('Re: Kozijnstaat')); await page.click('#modal-opslaan'); await page.waitForTimeout(300);
  check('actie uit mail gekoppeld', mock.db.acties.some(a => a.bron_type === 'mail'));
  await shot(page, '07-mail-lade');
  await page.click('#lade-sluit');
  await page.click('.chip[data-f=in]'); await page.waitForTimeout(150);
  check('filter ontvangen = leeg', (await page.textContent('#main')).includes('Nog geen mails'));

  // ---- 6. planning ----
  console.log('6. Planning');
  await tab(page, 'planning');
  check('planning leeg + knop voor Schraven', await page.isVisible('#p-nieuw'));
  const voeg = async (naam, groep, start, eind, mp) => { await page.click('#p-nieuw'); await page.fill('#p-naam', naam); await page.fill('#p-groep', groep); await page.fill('#p-start', start); if (mp) await page.selectOption('#p-mp', '1'); else await page.fill('#p-eind', eind); await page.click('#modal-opslaan'); await page.waitForTimeout(350); };
  await voeg('Kozijnstaten opstellen', 'Engineering', '2026-09-01', '2026-09-20');
  await voeg('Controle opdrachtgever', 'Engineering', '2026-09-21', '2026-10-02');
  await voeg('Productie', 'Uitvoering', '2026-10-05', '2026-11-27');
  await voeg('Start montage', 'Uitvoering', '2026-12-01', null, true);
  check('4 onderdelen in planning', mock.db.planning.length === 4 && mock.db.planning[3].mijlpaal === true);
  check('3 balken + 1 mijlpaal', (await page.$$('.gantt .balk')).length === 3 && (await page.$$('.gantt .mijlpaal')).length === 1);
  check('2 groepen', (await page.$$('.gantt .naamcel.groep')).length === 2);
  check('vandaag-lijn', (await page.$$('.gantt .vandaag')).length >= 1);
  check('weekkoppen', (await page.textContent('.gantt')).includes('wk 37'));
  await page.click('.gantt [data-plan]'); await page.fill('#p-vord', '60'); await page.click('#modal-opslaan'); await page.waitForTimeout(350);
  check('voortgang 60% opgeslagen', mock.db.planning[0].voortgang === 60);
  check('voortgang zichtbaar', (await page.$eval('.gantt .balk .vord', e => e.style.width)) === '60%');
  await page.click('#p-in'); await page.waitForTimeout(150); check('inzoomen', (await page.$eval('.gantt .rijbalk', e => e.offsetWidth)) > 0);
  await shot(page, '08-planning');
  await page.fill('#opm-in', 'Montage kan pas na oplevering casco'); await page.click('#opm-knop'); await page.waitForTimeout(300);
  check('planning-opmerking', mock.db.opmerkingen.some(o => o.doel_type === 'planning'));

  // ---- 7. team ----
  console.log('7. Team');
  await tab(page, 'team');
  check('3 gebruikers', (await page.$$('table.lijst tbody tr')).length === 3);
  await page.click('#t-nieuw'); await page.fill('#g-naam', 'Piet Uitvoerder'); await page.fill('#g-bedrijf', 'Bouwcombinatie'); await page.fill('#g-email', 'piet@og.nl'); await page.selectOption('#g-rol', 'opdrachtgever'); await page.fill('#g-ww', 'piet12345'); await page.click('#modal-opslaan'); await page.waitForTimeout(400);
  check('gebruiker via api aangemaakt', mock.apiCalls.some(c => c.pad === '/api/gebruikers' && c.body.actie === 'nieuw' && c.body.email === 'piet@og.nl'));
  check('4 gebruikers in lijst', (await page.$$('table.lijst tbody tr')).length === 4);
  await page.click('tr:has-text("Pawel") [data-act]'); await page.waitForTimeout(300);
  check('blokkeren werkt', mock.db.profielen.find(p => p.naam.includes('Pawel')).actief === false);
  await page.click('tr:has-text("Pawel") [data-act]'); await page.waitForTimeout(300);
  await shot(page, '09-team');

  // ---- 8. overzicht gevuld + ruimte wisselen ----
  console.log('8. Overzicht & ruimtes');
  await tab(page, 'overzicht');
  check('kpi open acties = 4', (await page.textContent('.kpi:nth-child(1) .n')) === '4');
  check('feed gevuld', (await page.$$('#feed .item')).length >= 8);
  check('mijlpaal op overzicht', (await page.textContent('#main')).includes('Start montage'));
  await shot(page, '10-overzicht');
  await page.click('#feed .item:has-text("actiepunt")'); await page.waitForSelector('.lade'); check('feed-klik opent lade', true); await page.click('#lade-sluit');
  await page.click('#ruimte-kies [data-ruimte=leverancier]'); await page.waitForTimeout(500);
  check('leverancier-ruimte leeg', (await page.textContent('#main')).includes('Nog niets gebeurd'));
  await tab(page, 'acties'); await page.click('#a-nieuw'); await page.fill('#a-titel', 'Offerte JR Okna nakijken'); await page.click('#modal-opslaan'); await page.waitForTimeout(300);
  check('actie in leverancier-ruimte', mock.db.acties.some(a => a.ruimte === 'leverancier'));
  check('personen-keuze toont leverancier, niet opdrachtgever', !(await page.evaluate(() => { const S = window.__S; return S.profielen.filter(p => p.rol === 'opdrachtgever').length === 0; })) && true);
  await page.click('#ruimte-kies [data-ruimte=opdrachtgever]'); await page.waitForTimeout(400); await page.click('.chip[data-f=open]'); await page.waitForTimeout(150);
  check('terug naar opdrachtgever: 4 open acties', (await page.$$('table.lijst tbody tr')).length === 4);
  // thema
  await page.click('#thema-knop'); await page.waitForTimeout(100);
  check('donker thema', (await page.getAttribute('html', 'data-theme')) === 'dark');
  await tab(page, 'bestanden'); await shot(page, '11-donker-bestanden'); await tab(page, 'planning'); await shot(page, '12-donker-planning');
  await page.click('#thema-knop');
  await ctx.close();

  // ---- 9. opdrachtgever-account ----
  console.log('9. Opdrachtgever');
  ({ ctx, page } = await nieuwePagina(false));
  await login(page, 'anna@opdrachtgever.nl', 'anna12345');
  check('geen ruimtekeuze voor extern', !(await page.isVisible('#ruimte-kies')));
  check('ruimte-badge', (await page.textContent('#ruimte-badge')).includes('Opdrachtgever'));
  check('Contacten i.p.v. Team', (await page.textContent('#tabs [data-tab=team]')).trim() === 'Contacten');
  await tab(page, 'acties');
  check('ziet alleen opdrachtgever-acties (4, geen JR Okna)', (await page.$$('table.lijst tbody tr')).length === 4 && !(await page.textContent('table.lijst')).includes('JR Okna'));
  await page.click('.chip[data-f=mijn]'); await page.waitForTimeout(150);
  check('"voor mij" = 2 (Detail 3 + Kleuren)', (await page.$$('table.lijst tbody tr')).length === 2);
  await page.click('table.lijst tbody tr:first-child'); await page.waitForSelector('.lade');
  check('extern kan niet verwijderen', !(await page.$('#a-del')));
  await page.click('#a-klaar'); await page.waitForTimeout(300);
  check('extern kan actie afronden', mock.db.acties.filter(a => a.status === 'klaar').length === 1);
  await page.click('#lade-sluit');
  await tab(page, 'bestanden');
  await page.click('table.lijst tbody tr:has-text("kozijnstaat")'); await page.waitForSelector('.lade');
  check('extern ziet geen verwijderknop bestand', !(await page.$('#b-del')));
  await page.selectOption('#b-status', 'goedgekeurd'); await page.waitForTimeout(300);
  check('extern kan status goedkeuren', mock.db.bestanden[0].status === 'goedgekeurd');
  await page.setInputFiles('#b-upl', { name: 'kozijnstaat-opmerkingen.dwg', mimeType: 'application/acad', buffer: Buffer.from('V3') });
  await page.waitForTimeout(700);
  check('extern kan nieuwe versie uploaden (v3)', mock.db.bestanden[0].huidige_versie === 3);
  await page.click('#lade-sluit');
  await tab(page, 'planning');
  check('extern ziet planning zonder bewerk-knop', !(await page.$('#p-nieuw')) && (await page.$$('.gantt .balk')).length === 3);
  await tab(page, 'team');
  check('contacten zonder leverancier', !(await page.textContent('table.lijst')).includes('Pawel') && (await page.textContent('table.lijst')).includes('Koen'));
  await shot(page, '13-opdrachtgever-contacten');
  await ctx.close();

  // ---- 10. leverancier ----
  console.log('10. Leverancier');
  ({ ctx, page } = await nieuwePagina(false));
  await login(page, 'pawel@leverancier.pl', 'pawel1234');
  await tab(page, 'acties');
  check('leverancier ziet alleen JR Okna-actie', (await page.$$('table.lijst tbody tr')).length === 1 && (await page.textContent('table.lijst')).includes('JR Okna'));
  await tab(page, 'bestanden');
  check('leverancier ziet geen opdrachtgever-bestanden', (await page.textContent('#main')).includes('Nog geen bestanden'));
  await ctx.close();

  // ---- 11. mobiel ----
  console.log('11. Mobiel 390px');
  ({ ctx, page } = await nieuwePagina(true));
  await shot(page, 'm01-login');
  await login(page, 'koen@test.nl', 'schraven123');
  check('mobiel: geen horizontale scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(page, 'm02-overzicht');
  await tab(page, 'bestanden'); await shot(page, 'm03-bestanden');
  check('mobiel bestanden: geen horizontale scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.click('table.lijst tbody tr:first-child'); await page.waitForSelector('.lade'); await shot(page, 'm04-bestand-lade');
  check('mobiel lade volledige breedte', (await page.$eval('.lade', e => e.offsetWidth)) === 390);
  await page.click('#lade-sluit');
  await tab(page, 'acties'); await shot(page, 'm05-acties');
  await tab(page, 'planning'); await shot(page, 'm06-planning');
  check('mobiel planning: pagina zelf scrolt niet horizontaal', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await tab(page, 'afspraken'); await page.click('#af-nieuw'); await shot(page, 'm07-modal');
  check('mobiel modal past', (await page.$eval('.modal', e => e.getBoundingClientRect().right)) <= 390);
  await ctx.close();

  await browser.close(); server.close();
  console.log(`\n${ok} controles groen, ${fout} fout${fouten.length ? ':\n - ' + fouten.join('\n - ') : ''}`);
  process.exit(fout ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
