// Controles serverfuncties v1.1 (mail-import, assistent, gebruikers) met nagebootste Supabase en Claude
const fs = require('fs'); const path = require('path');
let ok = 0, fout = 0; const fouten = [];
function check(n, c) { if (c) ok++; else { fout++; fouten.push(n); console.log('  ✗ ' + n); } }
process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_SERVICE_KEY = 'service'; process.env.ANTHROPIC_API_KEY = 'sleutel';

// --- nagebootste supabase ---
const db = { profielen: [{ id: 'u1', naam: 'Koen', rol: 'schraven', actief: true, bedrijf: 'Schraven' }, { id: 'u2', naam: 'Anna de Vries', rol: 'opdrachtgever', actief: true, bedrijf: 'BC' }], mails: [], acties: [{ id: 'a1', ruimte: 'opdrachtgever', nummer: 1, titel: 'Bestaand punt', status: 'open', verantwoordelijke_naam: 'Anna', updated_at: 'x', created_at: 'x' }], afspraken: [{ id: 'f1', ruimte: 'opdrachtgever', soort: 'overleg', datum: '2026-09-08', titel: 'Bouwvergadering', tekst: 'Anna levert kleuren aan voor 15 sept.', aanwezigen: 'Koen, Anna' }], bestanden: [], planning: [], opmerkingen: [] };
const storage = {}; let serviceMag = true;
function tabel(t) {
  const st = { f: [], ord: null, lim: null, single: false, op: 'select', data: null };
  const q = {
    select() { return q; }, eq(k, v) { st.f.push(r => String(r[k]) === String(v)); return q; }, is(k, v) { st.f.push(r => r[k] == v); return q; }, order(k, o) { st.ord = [k, o]; return q; }, limit(n) { st.lim = n; return q; },
    maybeSingle() { st.single = true; return q; }, single() { st.single = true; return q; },
    insert(d) { st.op = 'insert'; st.data = d; return q; }, update(d) { st.op = 'update'; st.data = d; return q; }, upsert(d) { st.op = 'upsert'; st.data = d; return q; },
    then(res) {
      let rows = db[t] || [];
      if (st.op === 'insert') { const arr = Array.isArray(st.data) ? st.data : [st.data]; arr.forEach(x => { x.id = x.id || 'id' + Math.random().toString(36).slice(2, 8); x.created_at = new Date().toISOString(); db[t].push(x); }); return res({ data: st.single ? arr[0] : arr, error: null }); }
      if (st.op === 'update') { rows = rows.filter(r => st.f.every(f => f(r))); rows.forEach(r => Object.assign(r, st.data)); return res({ data: rows, error: null }); }
      if (st.op === 'upsert') return res({ data: st.data, error: null });
      if (t === 'profielen' && !serviceMag) rows = [];
      rows = rows.filter(r => st.f.every(f => f(r)));
      if (st.lim) rows = rows.slice(0, st.lim);
      return res({ data: st.single ? (rows[0] || null) : rows, error: null, count: rows.length });
    },
  };
  return q;
}
const nepSb = {
  auth: { getUser: async tok => tok === 'tok-u1' ? { data: { user: { id: 'u1' } } } : tok === 'tok-u2' ? { data: { user: { id: 'u2' } } } : { data: { user: null }, error: { message: 'x' } }, admin: { createUser: async o => ({ data: { user: { id: 'nieuw1', email: o.email } }, error: null }), updateUserById: async () => ({ error: null }) } },
  from: tabel,
  storage: { from: () => ({ download: async p => storage[p] ? { data: { arrayBuffer: async () => storage[p] } } : { error: { message: 'niet gevonden ' + p } }, upload: async (p, b) => { storage[p] = b; return { error: null }; }, move: async (a, b) => { storage[b] = storage[a]; delete storage[a]; return { error: null }; } }) },
};
require('@supabase/supabase-js').createClient = () => nepSb;
// nagebootste Claude
let laatstePrompt = null;
global.fetch = async (url, o) => {
  const b = JSON.parse(o.body); laatstePrompt = b;
  const vraag = b.messages[b.messages.length - 1].content;
  let tekst = 'Antwoord van Claude over ' + (b.system.includes('Bestaand punt') ? 'de gegevens' : '???');
  if (/UITSLUITEND met JSON: \{"van"/.test(b.system)) tekst = '{"van":"Anna <anna@bc.nl>","aan":"koen@kozijnenglas.nl","cc":"","datum":"2026-09-10T09:12","onderwerp":"RE: Kozijnstaat","tekst":"Hoi Koen, detail 3 klopt niet."}';
  else if (/UITSLUITEND met JSON: \{"acties"/.test(vraag)) tekst = 'Hier: {"acties":[{"titel":"Kleuren aanleveren","wie":"Anna","deadline":"2026-09-15","omschrijving":"Uit de bouwvergadering"}]}';
  else if (/weekoverzicht/i.test(vraag)) tekst = 'WAT IS ER GEBEURD\n- test';
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: tekst }] }) };
};
const maakReq = (body, tok, method) => ({ method: method || 'POST', headers: { authorization: 'Bearer ' + (tok || 'tok-u1') }, body, url: '/api/x' });
const maakRes = () => { const r = { code: 0, body: '', status(c) { r.code = c; return r; }, setHeader() { return r; }, end(b) { r.body = b; } }; return r; };
const run = async (fn, body, tok, method) => { const res = maakRes(); await fn(maakReq(body, tok, method), res); return { code: res.code, j: JSON.parse(res.body || '{}') }; };

(async () => {
  const hulp = require('../api/_hulp');
  const mailImport = require('../api/mail-import');
  const assistent = require('../api/assistent');
  const gebruikers = require('../api/gebruikers');

  console.log('1. mail-import');
  storage['opdrachtgever/mailimport/x/voorbeeld.msg'] = fs.readFileSync(path.join(__dirname, 'voorbeeld.msg'));
  let r = await run(mailImport, { ruimte: 'opdrachtgever', pad: 'opdrachtgever/mailimport/x/voorbeeld.msg' });
  check('msg import ok', r.code === 200 && r.j.ok);
  const m1 = db.mails[0];
  check('msg: afzender/onderwerp', m1 && m1.van.includes('k.schraven') && m1.onderwerp === 'Kozijnstaat blok A ter controle');
  check('msg: richting uit (eigen domein)', m1.richting === 'uit');
  check('msg: bijlage + origineel opgeslagen', m1.bijlagen.length === 2 && m1.bijlagen[0].naam === 'kozijnstaat.pdf' && m1.bijlagen[1].origineel && storage[m1.bijlagen[0].pad]);
  check('msg: importbestand opgeruimd', !storage['opdrachtgever/mailimport/x/voorbeeld.msg']);
  storage['opdrachtgever/mailimport/y/voorbeeld.eml'] = fs.readFileSync(path.join(__dirname, 'voorbeeld.eml'));
  r = await run(mailImport, { ruimte: 'opdrachtgever', pad: 'opdrachtgever/mailimport/y/voorbeeld.eml' });
  check('eml import ok', r.code === 200 && db.mails[1].richting === 'in' && db.mails[1].cc === 'bouw@opdrachtgever.nl' && db.mails[1].bijlagen.some(b => b.naam === 'detail3.dwg'));
  r = await run(mailImport, { ruimte: 'leverancier', pad: 'leverancier/mailimport/z/a.eml' }, 'tok-u2');
  check('opdrachtgever mag niet in leverancier-ruimte', r.code === 403);
  r = await run(mailImport, { ruimte: 'opdrachtgever', pad: 'opdrachtgever/mail/hack' });
  check('pad buiten mailimport geweigerd', r.code === 400);
  r = await run(mailImport, { ruimte: 'opdrachtgever', pad: 'opdrachtgever/mailimport/q/a.eml' }, 'tok-onbekend');
  check('niet ingelogd → 401', r.code === 401);

  console.log('2. assistent');
  r = await run(assistent, { actie: 'chat', ruimte: 'opdrachtgever', vraag: 'Wat staat er open?', geschiedenis: [{ rol: 'user', tekst: 'hoi' }, { rol: 'assistant', tekst: 'hallo' }] });
  check('chat antwoord', r.code === 200 && /Antwoord van Claude over de gegevens/.test(r.j.antwoord));
  check('context bevat acties, afspraken en mails', /#1 \[open\] Bestaand punt/.test(laatstePrompt.system) && /Bouwvergadering/.test(laatstePrompt.system) && /Kozijnstaat blok A ter controle/.test(laatstePrompt.system));
  check('geschiedenis meegestuurd', laatstePrompt.messages.length === 3 && laatstePrompt.messages[1].role === 'assistant');
  r = await run(assistent, { actie: 'acties', ruimte: 'opdrachtgever', doel_type: 'afspraak', doel_id: 'f1' });
  check('actie-voorstellen uit afspraak', r.code === 200 && r.j.acties.length === 1 && r.j.acties[0].titel === 'Kleuren aanleveren' && r.j.personen.some(p => p.naam === 'Anna de Vries'));
  check('bron in prompt', /Anna levert kleuren/.test(laatstePrompt.messages[0].content));
  r = await run(assistent, { actie: 'acties', ruimte: 'opdrachtgever', doel_type: 'mail', doel_id: db.mails[0].id });
  check('actie-voorstellen uit mail', r.code === 200 && /Bijgaand de kozijnstaat/.test(laatstePrompt.messages[0].content));
  r = await run(assistent, { actie: 'acties', ruimte: 'opdrachtgever', doel_type: 'tekst', tekst: 'Notities: Piet regelt de steiger.' });
  check('actie-voorstellen uit losse tekst', r.code === 200 && /steiger/.test(laatstePrompt.messages[0].content));
  r = await run(assistent, { actie: 'week', ruimte: 'opdrachtgever' });
  check('weekoverzicht', r.code === 200 && /WAT IS ER GEBEURD/.test(r.j.tekst));
  r = await run(assistent, { actie: 'mail_tekst', tekst: 'Van: Anna\nOnderwerp: RE: Kozijnstaat\n\nHoi Koen…' });
  check('mailtekst uitlezen', r.code === 200 && r.j.mail.van.includes('Anna') && r.j.mail.onderwerp === 'RE: Kozijnstaat');
  r = await run(assistent, { actie: 'chat', ruimte: 'leverancier', vraag: 'x' }, 'tok-u2');
  check('extern niet in andere ruimte', r.code === 403);
  r = await run(assistent, { actie: 'chat', ruimte: 'opdrachtgever', vraag: 'x' }, 'tok-u2');
  check('extern wel in eigen ruimte', r.code === 200);
  delete process.env.ANTHROPIC_API_KEY;
  r = await run(assistent, { actie: 'chat', ruimte: 'opdrachtgever', vraag: 'x' });
  check('zonder sleutel duidelijke melding', r.code === 500 && /ANTHROPIC_API_KEY/.test(r.j.error));
  process.env.ANTHROPIC_API_KEY = 'sleutel';

  console.log('3. gebruikers');
  r = await run(gebruikers, { actie: 'nieuw', email: 'piet@og.nl', wachtwoord: 'piet12345', naam: 'Piet', rol: 'opdrachtgever' });
  check('gebruiker aanmaken', r.code === 200 && r.j.id === 'nieuw1');
  r = await run(gebruikers, { actie: 'nieuw', email: 'x@y.nl', wachtwoord: 'kort', naam: 'X', rol: 'opdrachtgever' });
  check('kort wachtwoord geweigerd', r.code === 400);
  r = await run(gebruikers, { actie: 'nieuw', email: 'x@y.nl', wachtwoord: 'lang genoeg', naam: 'X', rol: 'opdrachtgever' }, 'tok-u2');
  check('opdrachtgever mag geen gebruikers beheren', r.code === 403);
  serviceMag = false;
  r = await run(gebruikers, { actie: 'nieuw', email: 'x@y.nl', wachtwoord: 'lang genoeg', naam: 'X', rol: 'opdrachtgever' });
  check('verkeerde service-sleutel → duidelijke melding', r.code === 500 && /service_role/.test(r.j.error));
  serviceMag = true;

  console.log(`\n${ok} controles groen, ${fout} fout${fouten.length ? ':\n - ' + fouten.join('\n - ') : ''}`);
  process.exit(fout ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
