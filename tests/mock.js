// Nagebootste Supabase (database + login + bestandsopslag) voor de Playwright-tests.
// De echte database-beveiliging is apart getest met SQL; hier testen we de app zelf.
const crypto = require('crypto');
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function maakMock() {
  const users = {
    'aaaaaaaa-0000-0000-0000-000000000001': { email: 'koen@test.nl', ww: 'schraven123', naam: 'Koen Schraven', rol: 'schraven', bedrijf: 'Schraven BV' },
    'aaaaaaaa-0000-0000-0000-000000000002': { email: 'anna@opdrachtgever.nl', ww: 'anna12345', naam: 'Anna de Vries', rol: 'opdrachtgever', bedrijf: 'Bouwcombinatie Merwede' },
    'aaaaaaaa-0000-0000-0000-000000000003': { email: 'pawel@leverancier.pl', ww: 'pawel1234', naam: 'Pawel Kowalczyk', rol: 'leverancier', bedrijf: 'JR Okna' },
  };
  const db = { profielen: [], bestanden: [], bestand_versies: [], bestand_log: [], opmerkingen: [], acties: [], afspraken: [], mails: [], planning: [] };
  for (const [id, u] of Object.entries(users)) db.profielen.push({ id, naam: u.naam, email: u.email, rol: u.rol, bedrijf: u.bedrijf, actief: true, created_at: now() });
  const storage = {}; const tusSessies = {}; let actieNr = 0; const apiCalls = [];

  const profielVan = req => { const m = /Bearer tok-(.+)/.exec(req.headers()['authorization'] || ''); return m ? db.profielen.find(p => p.id === m[1]) : null; };
  const magRuimte = (p, r) => p && (p.rol === 'schraven' || p.rol === r);

  function filter(rows, params, p) {
    let out = rows.filter(r => !('ruimte' in r) || magRuimte(p, r.ruimte));
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      const m = /^(eq|neq|is|gt|gte|lt|lte|in)\.(.*)$/.exec(v); if (!m) continue;
      const [, op, val] = m;
      out = out.filter(r => { const x = r[k]; if (op === 'eq') return String(x) === val; if (op === 'neq') return String(x) !== val; if (op === 'is') return val === 'null' ? x == null : String(x) === val; if (op === 'gt') return x > val; if (op === 'gte') return x >= val; if (op === 'lt') return x < val; if (op === 'lte') return x <= val; if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(x)); return true; });
    }
    const orders = params.getAll('order');
    for (const o of orders.reverse()) { const [col, dir] = o.split('.'); out.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
    const lim = params.get('limit'); if (lim) out = out.slice(0, +lim);
    return out;
  }
  function defaults(t, rec) {
    const r = { id: uuid(), created_at: now(), ...rec };
    if (['bestanden', 'acties', 'afspraken', 'planning'].includes(t)) r.updated_at = r.updated_at || now();
    if (t === 'bestanden') Object.assign(r, { map: r.map || '', omschrijving: r.omschrijving || '', status: r.status || 'nieuw', huidige_versie: r.huidige_versie || 1, verwijderd: !!r.verwijderd });
    if (t === 'acties') Object.assign(r, { nummer: r.nummer || ++actieNr, status: r.status || 'open', prioriteit: r.prioriteit || 'normaal', omschrijving: r.omschrijving || '', verantwoordelijke_naam: r.verantwoordelijke_naam || '' });
    if (t === 'bestand_versies') r.dropbox_pad = r.dropbox_pad || null;
    if (t === 'mails') r.bijlagen = r.bijlagen || [];
    if (t === 'planning') Object.assign(r, { voortgang: r.voortgang || 0, mijlpaal: !!r.mijlpaal, volgorde: r.volgorde || 0, groep: r.groep || '' });
    return r;
  }

  async function rest(route, req, url) {
    const t = url.pathname.replace('/rest/v1/', ''); const params = url.searchParams; const p = profielVan(req);
    if (!db[t]) return route.fulfill({ status: 404, body: JSON.stringify({ message: 'onbekende tabel ' + t }) });
    if (!p) return route.fulfill({ status: 401, body: JSON.stringify({ message: 'niet ingelogd' }) });
    const accept = req.headers()['accept'] || ''; const single = accept.includes('pgrst.object');
    const antwoord = (rows, code) => { const body = single ? JSON.stringify(rows[0] ?? null) : JSON.stringify(rows); return route.fulfill({ status: code || 200, contentType: 'application/json', body }); };
    if (req.method() === 'GET') return antwoord(filter(db[t], params, p));
    if (req.method() === 'POST') {
      let b = req.postDataJSON(); const arr = Array.isArray(b) ? b : [b]; const ins = [];
      const upsert = (req.headers()['prefer'] || '').includes('resolution=merge');
      for (const x of arr) { if ('ruimte' in x && !magRuimte(p, x.ruimte)) return route.fulfill({ status: 403, body: JSON.stringify({ message: 'RLS: geen toegang tot ruimte' }) }); if (upsert && x.id) { const i = db[t].findIndex(r => r.id === x.id); if (i >= 0) { Object.assign(db[t][i], x); ins.push(db[t][i]); continue; } } const r = defaults(t, x); db[t].push(r); ins.push(r); }
      return antwoord(ins, 201);
    }
    if (req.method() === 'PATCH') {
      const b = req.postDataJSON(); const rows = filter(db[t], params, p);
      if (t === 'planning' && p.rol !== 'schraven') return antwoord([]);
      rows.forEach(r => Object.assign(r, b, db[t] === db.bestanden || db[t] === db.acties ? { updated_at: now() } : {})); return antwoord(rows);
    }
    if (req.method() === 'DELETE') {
      const rows = filter(db[t], params, p); if (p.rol !== 'schraven' && t !== 'opmerkingen') return antwoord([]);
      db[t] = db[t].filter(r => !rows.includes(r)); return antwoord(rows);
    }
    return route.fulfill({ status: 405, body: '{}' });
  }

  async function auth(route, req, url) {
    const pad = url.pathname.replace('/auth/v1/', '');
    if (pad === 'token') {
      const b = req.postDataJSON();
      if (b.refresh_token) { const id = b.refresh_token.replace('ref-', ''); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessie(id)) }); }
      const id = Object.keys(users).find(k => users[k].email === b.email && users[k].ww === b.password);
      if (!id) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials', message: 'Invalid login credentials', code: 400 }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessie(id)) });
    }
    if (pad === 'user') { const p = profielVan(req); if (!p) return route.fulfill({ status: 401, body: '{}' }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userObj(p.id)) }); }
    if (pad === 'logout') return route.fulfill({ status: 204, body: '' });
    if (pad === 'recover') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 404, body: '{}' });
  }
  const userObj = id => ({ id, aud: 'authenticated', role: 'authenticated', email: users[id].email, app_metadata: {}, user_metadata: {}, created_at: now() });
  const sessie = id => ({ access_token: 'tok-' + id, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'ref-' + id, user: userObj(id) });

  async function store(route, req, url) {
    const pad = url.pathname.replace('/storage/v1/', ''); const p = profielVan(req);
    if (pad === 'upload/resumable' && req.method() === 'POST') {
      const meta = Object.fromEntries((req.headers()['upload-metadata'] || '').split(',').map(x => x.trim().split(' ')).map(([k, v]) => [k, Buffer.from(v || '', 'base64').toString()]));
      const id = uuid(); tusSessies[id] = { pad: meta.objectName, lengte: +req.headers()['upload-length'], data: [] };
      const body = req.postDataBuffer(); if (body && body.length) tusSessies[id].data.push(body);
      const offset = tusSessies[id].data.reduce((a, b) => a + b.length, 0);
      if (offset >= tusSessies[id].lengte) storage[meta.objectName] = Buffer.concat(tusSessies[id].data);
      return route.fulfill({ status: 201, headers: { Location: url.origin + '/storage/v1/upload/resumable/' + id, 'Upload-Offset': String(offset), 'Tus-Resumable': '1.0.0', 'Access-Control-Expose-Headers': 'Location, Upload-Offset, Upload-Length, Tus-Resumable' }, body: '' });
    }
    if (pad.startsWith('upload/resumable/')) {
      const id = pad.split('/')[2]; const s = tusSessies[id]; if (!s) return route.fulfill({ status: 404, body: '' });
      if (req.method() === 'PATCH') { s.data.push(req.postDataBuffer()); const offset = s.data.reduce((a, b) => a + b.length, 0); if (offset >= s.lengte) storage[s.pad] = Buffer.concat(s.data); return route.fulfill({ status: 204, headers: { 'Upload-Offset': String(offset), 'Tus-Resumable': '1.0.0', 'Access-Control-Expose-Headers': 'Location, Upload-Offset, Upload-Length, Tus-Resumable' }, body: '' }); }
      if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'Upload-Offset': String(s.data.reduce((a, b) => a + b.length, 0)), 'Upload-Length': String(s.lengte), 'Tus-Resumable': '1.0.0', 'Access-Control-Expose-Headers': 'Location, Upload-Offset, Upload-Length, Tus-Resumable' }, body: '' });
    }
    if (pad.startsWith('object/sign/')) {
      const obj = pad.replace('object/sign/bestanden/', '');
      if (req.method() === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: '/object/sign/bestanden/' + obj + '?token=x' }) });
      return route.fulfill({ status: storage[obj] ? 200 : 404, body: storage[obj] || '' });
    }
    if (pad.startsWith('object/bestanden/') && req.method() === 'POST') {
      const obj = pad.replace('object/bestanden/', ''); if (!magRuimte(p, obj.split('/')[0])) return route.fulfill({ status: 403, body: JSON.stringify({ message: 'RLS' }) });
      storage[obj] = req.postDataBuffer() || Buffer.alloc(0); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'bestanden/' + obj }) });
    }
    return route.fulfill({ status: 404, body: '{}' });
  }

  async function installeer(page, supabaseUrl) {
    await page.context().route(supabaseUrl + '/**', async route => {
      const req = route.request(); const url = new URL(req.url());
      try {
        if (url.pathname.startsWith('/rest/v1/')) return await rest(route, req, url);
        if (url.pathname.startsWith('/auth/v1/')) return await auth(route, req, url);
        if (url.pathname.startsWith('/storage/v1/')) return await store(route, req, url);
        return route.fulfill({ status: 404, body: '{}' });
      } catch (e) { console.error('MOCK FOUT', req.method(), url.pathname, e); return route.fulfill({ status: 500, body: JSON.stringify({ message: e.message }) }); }
    });
    await page.context().route('**/api/**', async route => {
      const req = route.request(); apiCalls.push({ pad: new URL(req.url()).pathname, body: req.postDataJSON ? (() => { try { return req.postDataJSON(); } catch (e) { return null; } })() : null });
      const b = apiCalls[apiCalls.length - 1].body || {};
      if (/gebruikers/.test(req.url()) && b.actie === 'nieuw') { const id = uuid(); users[id] = { email: b.email, ww: b.wachtwoord, naam: b.naam, rol: b.rol, bedrijf: b.bedrijf }; db.profielen.push({ id, naam: b.naam, email: b.email, rol: b.rol, bedrijf: b.bedrijf || '', actief: true, created_at: now() }); }
      const antw = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
      if (/mail-import/.test(req.url())) {
        const p = profielVan(req); const naam = (b.pad || '').split('/').pop();
        if (!storage[b.pad]) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'importbestand niet gevonden in storage' }) });
        const m = defaults('mails', { ruimte: b.ruimte, richting: 'uit', van: 'Koen Schraven <k.schraven@kozijnenglas.nl>', aan: 'Anna de Vries <anna@opdrachtgever.nl>', cc: '', onderwerp: 'Geïmporteerd: ' + naam, datum: now(), tekst: 'Uitgelezen tekst uit ' + naam, bron: 'handmatig', gemaakt_door: p && p.id, bijlagen: [{ naam: 'kozijnstaat.pdf', pad: b.ruimte + '/mail/x/kozijnstaat.pdf', grootte: 19 }, { naam: 'Origineel: ' + naam, pad: b.ruimte + '/mail/x/' + naam, grootte: 100, origineel: true }] });
        db.mails.push(m); delete storage[b.pad]; return antw({ ok: true, id: m.id, bijlagen: 2 });
      }
      if (/assistent/.test(req.url())) {
        if (b.actie === 'mail_tekst') return antw({ ok: true, mail: { van: 'Anna de Vries <anna@opdrachtgever.nl>', aan: 'k.schraven@kozijnenglas.nl', cc: '', datum: '2026-09-10T09:12', onderwerp: 'RE: Kozijnstaat blok A', tekst: 'Hoi Koen, detail 3 klopt niet.' } });
        if (b.actie === 'chat') return antw({ ok: true, antwoord: 'Er staan ' + db.acties.filter(a => a.ruimte === b.ruimte && a.status === 'open').length + ' actiepunten open. Vraag was: ' + b.vraag });
        if (b.actie === 'week') return antw({ ok: true, tekst: 'WAT IS ER DE AFGELOPEN 7 DAGEN GEBEURD\n- test weekoverzicht' });
        if (b.actie === 'acties') return antw({ ok: true, acties: [{ titel: 'Kleuren aanleveren', wie: 'Anna', deadline: '2026-09-15', omschrijving: 'Uit de tekst' }, { titel: 'Steiger regelen', wie: 'Schraven', deadline: '', omschrijving: '' }], personen: db.profielen.filter(p => p.rol === 'schraven' || p.rol === b.ruimte).map(p => ({ id: p.id, naam: p.naam })) });
      }
      return antw({ ok: true, pad: '/Utrecht/x' });
    });
  }
  return { db, storage, users, apiCalls, installeer };
}
module.exports = { maakMock };
