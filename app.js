/* Samenwerkingsplatform Merwede Utrecht — Schraven BV
   Eén pagina, gewone JavaScript. Data in Supabase (tabellen + bestandsopslag). */
(function () {
'use strict';
const C = window.CONFIG;
const sb = supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY);
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

// ---------- state ----------
const S = {
  user: null, profiel: null, ruimte: null, tab: 'overzicht',
  profielen: [], bestanden: [], versies: [], logs: [], opmerkingen: [], acties: [], afspraken: [], mails: [], planning: [],
  mapKeuze: '', actieFilter: 'open', mailFilter: 'alle', lade: null, uploads: [],
};
const STATUS_BESTAND = { nieuw: 'Nieuw', ter_controle: 'Ter controle', goedgekeurd: 'Goedgekeurd', afgekeurd: 'Afgekeurd', definitief: 'Definitief' };
const STATUS_ACTIE = { open: 'Open', bezig: 'Bezig', klaar: 'Klaar', vervallen: 'Vervallen' };
const PRIO = { laag: 'Laag', normaal: 'Normaal', hoog: 'Hoog' };
const SOORT_AFSPRAAK = { overleg: 'Overleg', afspraak: 'Afspraak', besluit: 'Besluit' };
const ROL = { schraven: 'Schraven', opdrachtgever: 'Opdrachtgever', leverancier: 'Leverancier' };

// ---------- hulpjes ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dat = d => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? '' : x.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' }); };
const datTijd = d => { if (!d) return ''; const x = new Date(d); return isNaN(x) ? '' : x.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const iso = d => { const x = d ? new Date(d) : new Date(); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const vandaag = () => iso(new Date());
const week = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7)); const w1 = new Date(x.getFullYear(), 0, 4); return 1 + Math.round(((x - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7); };
const mb = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' kB' : (n / 1048576).toFixed(1) + ' MB';
const naam = id => { const p = S.profielen.find(p => p.id === id); return p ? p.naam : (id ? 'Onbekend' : '—'); };
const isSchraven = () => S.profiel && S.profiel.rol === 'schraven';
const ext = n => (n.split('.').pop() || '').toLowerCase();
const tag = (w, t) => `<span class="tag ${esc(w)}">${esc(t || w)}</span>`;
let toastT; function toast(t) { const e = $('#toast'); e.textContent = t; e.classList.add('zien'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('zien'), 2600); }
function fout(e) { console.error(e); toast('Fout: ' + (e && (e.message || e.error_description) || e)); }
const relTijd = d => { const s = (Date.now() - new Date(d)) / 1000; if (s < 60) return 'zojuist'; if (s < 3600) return Math.floor(s / 60) + ' min geleden'; if (s < 86400) return Math.floor(s / 3600) + ' uur geleden'; if (s < 172800) return 'gisteren'; return dat(d); };
function veiligeNaam(n) { return n.replace(/[^\w.\-() À-ſ]/g, '_'); }

// ---------- thema ----------
function zetThema(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('thema', t); } catch (e) { } }
try { zetThema(localStorage.getItem('thema') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); } catch (e) { zetThema('light'); }
$('#thema-knop').onclick = () => zetThema(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

// ---------- login ----------
$('#login-project').textContent = C.PROJECT_NAAM; $('#app-project').textContent = 'Samenwerking ' + C.PROJECT_NAAM;
function loginMelding(t, soort) { $('#login-melding').innerHTML = t ? `<div class="melding ${soort || 'fout'}">${esc(t)}</div>` : ''; }
$('#login-form').onsubmit = async e => {
  e.preventDefault(); loginMelding('');
  const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-ww').value });
  if (error) loginMelding(/invalid/i.test(error.message) ? 'E-mailadres of wachtwoord klopt niet.' : error.message);
};
$('#login-vergeten').onclick = async () => {
  const email = $('#login-email').value.trim(); if (!email) return loginMelding('Vul eerst je e-mailadres in.');
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  loginMelding(error ? error.message : 'Als dit adres bekend is, ontvang je een mail met een link om een nieuw wachtwoord te kiezen.', error ? 'fout' : 'ok');
};
$('#reset-form').onsubmit = async e => {
  e.preventDefault();
  const { error } = await sb.auth.updateUser({ password: $('#reset-ww').value });
  if (error) return loginMelding(error.message);
  $('#reset-form').hidden = true; $('#login-form').hidden = false; loginMelding('Wachtwoord opgeslagen. Je bent ingelogd.', 'ok'); herstelModus = false; start();
};
$('#uitlog-knop').onclick = async () => { await sb.auth.signOut(); location.reload(); };
let herstelModus = /type=recovery/.test(location.hash);
if (herstelModus) { $('#login-form').hidden = true; $('#login-vergeten').hidden = true; $('#reset-form').hidden = false; }

sb.auth.onAuthStateChange((ev, sess) => {
  if (ev === 'PASSWORD_RECOVERY') { herstelModus = true; $('#login-form').hidden = true; $('#login-vergeten').hidden = true; $('#reset-form').hidden = false; return; }
  if (sess && !herstelModus && !S.user) { S.user = sess.user; start(); }
  if (!sess && S.user) location.reload();
});
sb.auth.getSession().then(({ data }) => { if (data.session && !herstelModus) { S.user = data.session.user; start(); } });

// ---------- start ----------
async function start() {
  const { data: p, error } = await sb.from('profielen').select('*').eq('id', S.user.id).maybeSingle();
  if (error) return loginMelding(error.message);
  if (!p) return loginMelding('Je account is nog niet geactiveerd. Vraag Schraven om je toegang te geven.');
  S.profiel = p;
  $('#login').hidden = true; $('#app').hidden = false;
  $('#wie').textContent = p.naam + ' · ' + ROL[p.rol];
  if (p.rol === 'schraven') { $('#ruimte-kies').hidden = false; let r = 'opdrachtgever'; try { r = localStorage.getItem('ruimte') || r; } catch (e) { } S.ruimte = r; }
  else { S.ruimte = p.rol; $('#ruimte-badge').hidden = false; $('#ruimte-badge').textContent = C.RUIMTES[p.rol]; }
  $$('#ruimte-kies button').forEach(b => b.onclick = () => kiesRuimte(b.dataset.ruimte));
  $$('#tabs button').forEach(b => b.onclick = () => kiesTab(b.dataset.tab));
  if (p.rol !== 'schraven') $('#tabs [data-tab=team]').textContent = 'Contacten';
  await laadAlles(); realtime(); kiesTab(S.tab);
}
function kiesRuimte(r) { S.ruimte = r; try { localStorage.setItem('ruimte', r); } catch (e) { } S.mapKeuze = ''; sluitLade(); laadAlles().then(render); }
function kiesTab(t) { S.tab = t; sluitLade(); render(); window.scrollTo(0, 0); }

// ---------- data ----------
async function laadAlles() {
  const r = S.ruimte;
  const q = (t, extra) => { let x = sb.from(t).select('*').eq('ruimte', r); if (extra) x = extra(x); return x; };
  const [pr, be, ve, lo, op, ac, af, ma, pl] = await Promise.all([
    sb.from('profielen').select('*').order('naam'),
    q('bestanden', x => x.eq('verwijderd', false).order('naam')),
    sb.from('bestand_versies').select('*').order('versie', { ascending: false }),
    sb.from('bestand_log').select('*').order('created_at', { ascending: false }).limit(2000),
    q('opmerkingen', x => x.order('created_at', { ascending: false })),
    q('acties', x => x.order('nummer', { ascending: false })),
    q('afspraken', x => x.order('datum', { ascending: false })),
    q('mails', x => x.order('datum', { ascending: false })),
    q('planning', x => x.order('volgorde').order('start')),
  ]);
  const f = [pr, be, ve, lo, op, ac, af, ma, pl].find(x => x.error); if (f) return fout(f.error);
  S.profielen = pr.data; S.bestanden = be.data; S.versies = ve.data; S.logs = lo.data; S.opmerkingen = op.data;
  S.acties = ac.data; S.afspraken = af.data; S.mails = ma.data; S.planning = pl.data;
  tellers();
}
function tellers() {
  const open = S.acties.filter(a => a.status === 'open' || a.status === 'bezig').length;
  const tc = S.bestanden.filter(b => b.status === 'ter_controle').length;
  $('#tel-acties').hidden = !open; $('#tel-acties').textContent = open;
  $('#tel-bestanden').hidden = !tc; $('#tel-bestanden').textContent = tc;
  $$('#ruimte-kies button').forEach(b => b.classList.toggle('actief', b.dataset.ruimte === S.ruimte));
}
let rtTimer;
function realtime() {
  try {
    sb.channel('alles').on('postgres_changes', { event: '*', schema: 'public' }, () => {
      clearTimeout(rtTimer); rtTimer = setTimeout(async () => { await laadAlles(); render(); if (S.lade) S.lade(); }, 600);
    }).subscribe();
  } catch (e) { console.warn('realtime uit', e); }
}
async function herlaad() { await laadAlles(); render(); if (S.lade) S.lade(); }

// ---------- render ----------
function render() {
  tellers();
  $$('#tabs button').forEach(b => b.classList.toggle('actief', b.dataset.tab === S.tab));
  const m = $('#main');
  ({ overzicht: rOverzicht, bestanden: rBestanden, acties: rActies, afspraken: rAfspraken, mail: rMail, planning: rPlanning, team: rTeam }[S.tab] || rOverzicht)(m);
}

// ===== OVERZICHT =====
function rOverzicht(m) {
  const open = S.acties.filter(a => a.status === 'open' || a.status === 'bezig');
  const mijn = open.filter(a => a.verantwoordelijke === S.user.id);
  const teLaat = open.filter(a => a.deadline && a.deadline < vandaag());
  const tc = S.bestanden.filter(b => b.status === 'ter_controle');
  const mijl = S.planning.filter(p => p.mijlpaal && p.start >= vandaag()).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 4);
  // activiteitenfeed
  const feed = [];
  S.versies.forEach(v => { const b = S.bestanden.find(b => b.id === v.bestand_id); if (b) feed.push({ t: v.created_at, ic: 'B', wie: naam(v.geupload_door), tekst: (v.versie > 1 ? `nieuwe versie v${v.versie} van ` : 'bestand geplaatst: ') + b.naam, klik: () => openBestand(b.id) }); });
  S.opmerkingen.forEach(o => feed.push({ t: o.created_at, ic: 'O', wie: naam(o.door), tekst: 'opmerking: ' + o.tekst.slice(0, 120), klik: () => openDoel(o) }));
  S.acties.forEach(a => { feed.push({ t: a.created_at, ic: 'A', wie: naam(a.gemaakt_door), tekst: `actiepunt #${a.nummer}: ${a.titel}`, klik: () => openActie(a.id) }); if (a.klaar_op) feed.push({ t: a.klaar_op, ic: '✓', wie: '', tekst: `actiepunt #${a.nummer} afgerond: ${a.titel}`, klik: () => openActie(a.id) }); });
  S.afspraken.forEach(a => feed.push({ t: a.created_at, ic: 'V', wie: naam(a.gemaakt_door), tekst: SOORT_AFSPRAAK[a.soort] + ': ' + a.titel, klik: () => openAfspraak(a.id) }));
  S.mails.forEach(x => feed.push({ t: x.created_at, ic: 'M', wie: x.bron === 'bcc' ? 'automatisch' : naam(x.gemaakt_door), tekst: 'mail ' + (x.richting === 'uit' ? 'verstuurd' : 'ontvangen') + ': ' + x.onderwerp, klik: () => openMail(x.id) }));
  feed.sort((a, b) => b.t.localeCompare(a.t));
  const deadlines = open.filter(a => a.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 8);
  m.innerHTML = `
  <div class="kpis">
    <div class="kpi or" data-ga="acties"><div class="n">${open.length}</div><div class="l">Open actiepunten</div></div>
    <div class="kpi ${teLaat.length ? 'rood' : 'groen'}" data-ga="acties"><div class="n">${teLaat.length}</div><div class="l">Over de deadline</div></div>
    <div class="kpi" data-ga="acties"><div class="n">${mijn.length}</div><div class="l">Voor mij</div></div>
    <div class="kpi ${tc.length ? 'or' : ''}" data-ga="bestanden"><div class="n">${tc.length}</div><div class="l">Bestanden ter controle</div></div>
    <div class="kpi" data-ga="bestanden"><div class="n">${S.bestanden.length}</div><div class="l">Bestanden</div></div>
  </div>
  <div class="kolommen">
    <div class="paneel"><div class="kop"><h2>Laatste activiteit</h2></div>
      <div class="activiteit" id="feed">${feed.length ? feed.slice(0, 25).map((f, i) => `<div class="item klik" data-i="${i}"><div class="ic">${f.ic}</div><div class="vul"><b>${esc(f.wie)}</b> ${esc(f.tekst)}</div><div class="wanneer">${relTijd(f.t)}</div></div>`).join('') : '<div class="leeg">Nog niets gebeurd in deze ruimte.</div>'}</div>
    </div>
    <div>
      <div class="paneel"><div class="kop"><h2>Deadlines</h2></div>
        ${deadlines.length ? `<table class="lijst"><tbody>${deadlines.map(a => `<tr class="klik" data-actie="${a.id}"><td>${a.deadline < vandaag() ? tag('telaat', dat(a.deadline)) : esc(dat(a.deadline))}</td><td>#${a.nummer} ${esc(a.titel)}<div class="klein">${esc(a.verantwoordelijke_naam || naam(a.verantwoordelijke))}</div></td></tr>`).join('')}</tbody></table>` : '<div class="leeg">Geen deadlines.</div>'}
      </div>
      <div class="paneel"><div class="kop"><h2>Mijlpalen</h2></div>
        ${mijl.length ? `<table class="lijst"><tbody>${mijl.map(p => `<tr><td>${esc(dat(p.start))}<div class="klein">wk ${week(p.start)}</div></td><td>${esc(p.naam)}</td></tr>`).join('')}</tbody></table>` : '<div class="leeg">Geen komende mijlpalen.</div>'}
      </div>
      <div class="paneel"><div class="kop"><h2>Ter controle</h2></div>
        ${tc.length ? `<table class="lijst"><tbody>${tc.map(b => `<tr class="klik" data-bestand="${b.id}"><td>${esc(b.naam)}<div class="klein">${esc(b.map || 'Hoofdmap')} · v${b.huidige_versie}</div></td></tr>`).join('')}</tbody></table>` : '<div class="leeg">Niets wacht op controle.</div>'}
      </div>
    </div>
  </div>`;
  $$('.kpi', m).forEach(k => k.onclick = () => kiesTab(k.dataset.ga));
  $$('#feed .item', m).forEach(e => e.onclick = () => feed[+e.dataset.i].klik());
  $$('[data-actie]', m).forEach(e => e.onclick = () => openActie(e.dataset.actie));
  $$('[data-bestand]', m).forEach(e => e.onclick = () => openBestand(e.dataset.bestand));
}
function openDoel(o) {
  if (o.doel_type === 'bestand') openBestand(o.doel_id); else if (o.doel_type === 'actie') openActie(o.doel_id); else if (o.doel_type === 'afspraak') openAfspraak(o.doel_id); else if (o.doel_type === 'mail') openMail(o.doel_id); else if (o.doel_type === 'planning') kiesTab('planning');
}

// ===== BESTANDEN =====
function mappen() { const s = new Set(S.bestanden.map(b => b.map || '')); return Array.from(s).sort((a, b) => a.localeCompare(b)); }
function rBestanden(m) {
  const ms = mappen();
  const lijst = S.bestanden.filter(b => !S.mapKeuze || (b.map || '') === S.mapKeuze).sort((a, b) => (a.map || '').localeCompare(b.map || '') || a.naam.localeCompare(b.naam));
  m.innerHTML = `
  <div class="kolommen bestanden-kol">
    <div class="paneel">
      <div class="kop"><h3 style="margin:0">Mappen</h3><div class="vul"></div><button class="btn klein" id="map-nieuw" title="Nieuwe map">+ map</button></div>
      <div class="mappen">
        <button class="${S.mapKeuze === '' ? 'actief' : ''}" data-map="">📁 Alle bestanden <span class="tel">${S.bestanden.length}</span></button>
        ${ms.map(x => `<button class="${S.mapKeuze === x ? 'actief' : ''}" data-map="${esc(x)}">📂 ${esc(x || 'Hoofdmap')} <span class="tel">${S.bestanden.filter(b => (b.map || '') === x).length}</span></button>`).join('')}
        ${(S.nieuweMappen || []).filter(x => !ms.includes(x)).map(x => `<button class="${S.mapKeuze === x ? 'actief' : ''}" data-map="${esc(x)}">📂 ${esc(x)} <span class="tel">0</span></button>`).join('')}
      </div>
    </div>
    <div>
      <div class="paneel">
        <div class="kop"><h2>${esc(S.mapKeuze || 'Alle bestanden')}</h2><div class="vul"></div>
          <input type="file" id="upl" multiple hidden>
          <button class="btn p" id="upl-knop">⬆ Bestanden toevoegen</button></div>
        <div class="dropzone" id="dropzone">Sleep bestanden hierheen (ook grote bestanden en DWG's) — ze komen in <b>${esc(S.mapKeuze || 'Hoofdmap')}</b></div>
        <div class="uploads" id="uploads"></div>
        <div class="tabel-wrap">${lijst.length ? `<table class="lijst"><thead><tr><th>Bestand</th><th class="verberg-mobiel">Map</th><th>Versie</th><th>Status</th><th class="verberg-mobiel">Laatste wijziging</th><th></th></tr></thead><tbody>
          ${lijst.map(b => { const v = S.versies.find(v => v.bestand_id === b.id && v.versie === b.huidige_versie) || S.versies.find(v => v.bestand_id === b.id); const nOpm = S.opmerkingen.filter(o => o.doel_type === 'bestand' && o.doel_id === b.id).length; return `<tr class="klik" data-id="${b.id}"><td><b>${esc(b.naam)}</b>${b.omschrijving ? `<div class="klein">${esc(b.omschrijving)}</div>` : ''}${nOpm ? `<div class="klein">💬 ${nOpm}</div>` : ''}</td><td class="verberg-mobiel">${esc(b.map || 'Hoofdmap')}</td><td>v${b.huidige_versie}<div class="klein">${v ? mb(v.grootte) : ''}</div></td><td>${tag(b.status, STATUS_BESTAND[b.status])}</td><td class="verberg-mobiel klein">${esc(datTijd(b.updated_at))}<br>${esc(naam(v ? v.geupload_door : b.gemaakt_door))}</td><td>${v ? `<button class="btn klein" data-dl="${v.id}" title="Downloaden">⬇</button>` : ''}</td></tr>`; }).join('')}
        </tbody></table>` : '<div class="leeg">Nog geen bestanden in deze map. Sleep ze hierheen of klik op "Bestanden toevoegen".</div>'}</div>
      </div>
    </div>
  </div>`;
  $$('.mappen button', m).forEach(b => b.onclick = () => { S.mapKeuze = b.dataset.map; render(); });
  $('#map-nieuw').onclick = () => modalVraag('Nieuwe map', 'Naam van de map', '', v => { if (!v) return; S.nieuweMappen = (S.nieuweMappen || []).concat(v); S.mapKeuze = v; render(); toast('Map aangemaakt — zet er nu bestanden in.'); });
  $('#upl-knop').onclick = () => $('#upl').click();
  $('#upl').onchange = e => { uploadNieuw(Array.from(e.target.files)); e.target.value = ''; };
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('aan'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('aan'); }));
  dz.addEventListener('drop', e => uploadNieuw(Array.from(e.dataTransfer.files)));
  $$('tr[data-id]', m).forEach(r => r.onclick = e => { if (e.target.closest('[data-dl]')) return; openBestand(r.dataset.id); });
  $$('[data-dl]', m).forEach(b => b.onclick = () => download(b.dataset.dl));
  toonUploads();
}
function toonUploads() {
  const u = $('#uploads'); if (!u) return;
  u.innerHTML = S.uploads.map(x => `<div class="item"><div>${esc(x.naam)} <span class="klein">${x.status}</span></div><div class="voortgang"><div style="width:${x.pct}%"></div></div></div>`).join('');
}
async function download(versieId) {
  const v = S.versies.find(v => v.id === versieId); if (!v) return;
  const { data, error } = await sb.storage.from(C.BUCKET).createSignedUrl(v.storage_pad, 3600, { download: v.bestandsnaam });
  if (error) return fout(error);
  const b = S.bestanden.find(b => b.id === v.bestand_id);
  if (b) sb.from('bestand_log').insert({ bestand_id: b.id, soort: 'download', tekst: `v${v.versie} gedownload`, door: S.user.id }).then(() => { });
  window.open(data.signedUrl, '_blank');
}
// upload (klein: direct; groot: hervatbaar in stukken, zodat 60 MB+ ook lukt)
async function uploadBlob(pad, file, opVoortgang) {
  const { data: { session } } = await sb.auth.getSession();
  if (file.size < 6 * 1024 * 1024) {
    const { error } = await sb.storage.from(C.BUCKET).upload(pad, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) throw error; opVoortgang(100); return;
  }
  await new Promise((ok, nee) => {
    const up = new tus.Upload(file, {
      endpoint: C.SUPABASE_URL + '/storage/v1/upload/resumable',
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: 'Bearer ' + session.access_token, apikey: C.SUPABASE_KEY, 'x-upsert': 'false' },
      uploadDataDuringCreation: true, removeFingerprintOnSuccess: true, chunkSize: 6 * 1024 * 1024,
      metadata: { bucketName: C.BUCKET, objectName: pad, contentType: file.type || 'application/octet-stream', cacheControl: '3600' },
      onError: nee, onProgress: (a, b) => opVoortgang(Math.round(a / b * 100)), onSuccess: ok,
    });
    up.findPreviousUploads().then(prev => { if (prev.length) up.resumeFromPreviousUpload(prev[0]); up.start(); });
  });
}
async function uploadNieuw(files, bestandId) {
  if (!files.length) return;
  for (const f of files) {
    const u = { naam: f.name, pct: 0, status: 'wacht…' }; S.uploads.push(u); toonUploads();
    try {
      let b = bestandId ? S.bestanden.find(b => b.id === bestandId) : null, versie = 1;
      if (!b) {
        const { data, error } = await sb.from('bestanden').insert({ ruimte: S.ruimte, map: S.mapKeuze || '', naam: f.name, gemaakt_door: S.user.id }).select().single();
        if (error) throw error; b = data;
      } else versie = b.huidige_versie + 1;
      const pad = `${S.ruimte}/${b.id}/v${versie}/${veiligeNaam(f.name)}`;
      u.status = 'uploaden…'; await uploadBlob(pad, f, p => { u.pct = p; toonUploads(); });
      const { data: v, error: e2 } = await sb.from('bestand_versies').insert({ bestand_id: b.id, versie, storage_pad: pad, bestandsnaam: f.name, grootte: f.size, mime: f.type || '', geupload_door: S.user.id }).select().single();
      if (e2) throw e2;
      if (versie > 1) await sb.from('bestanden').update({ huidige_versie: versie, status: 'ter_controle' }).eq('id', b.id);
      await sb.from('bestand_log').insert({ bestand_id: b.id, soort: versie > 1 ? 'versie' : 'upload', tekst: versie > 1 ? `Nieuwe versie v${versie} geplaatst (${f.name}, ${mb(f.size)})` : `Bestand geplaatst (${mb(f.size)})`, door: S.user.id });
      u.status = 'klaar ✓'; u.pct = 100; toonUploads();
      dropboxKopie(v.id);
    } catch (e) { u.status = 'mislukt: ' + (e.message || e); toonUploads(); fout(e); }
  }
  setTimeout(() => { S.uploads = S.uploads.filter(x => !/klaar/.test(x.status)); toonUploads(); }, 4000);
  await herlaad();
}
async function apiCall(pad, body) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(pad, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (session ? session.access_token : '') }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('Serverfout ' + r.status));
  return j;
}
function dropboxKopie(versieId) { apiCall('/api/dropbox', { versie_id: versieId }).catch(e => console.warn('Dropbox-kopie later (nachtelijke ronde):', e.message)); }

function openBestand(id) {
  S.lade = () => {
    const b = S.bestanden.find(b => b.id === id); if (!b) return sluitLade();
    const vs = S.versies.filter(v => v.bestand_id === id).sort((a, b) => b.versie - a.versie);
    const log = S.logs.filter(l => l.bestand_id === id).map(l => ({ t: l.created_at, wie: naam(l.door), tekst: l.tekst, opm: false }))
      .concat(S.opmerkingen.filter(o => o.doel_type === 'bestand' && o.doel_id === id).map(o => ({ t: o.created_at, wie: naam(o.door), tekst: o.tekst, opm: true, id: o.id, door: o.door })))
      .sort((a, b) => b.t.localeCompare(a.t));
    lade(`<span class="klein">${esc(b.map || 'Hoofdmap')}</span><br>${esc(b.naam)}`, `
      <div class="acties-rij">
        ${tag(b.status, STATUS_BESTAND[b.status])}
        <select id="b-status" style="width:auto">${Object.entries(STATUS_BESTAND).map(([k, v]) => `<option value="${k}" ${b.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <div class="vul"></div>
        <input type="file" id="b-upl" hidden>
        <button class="btn p klein" id="b-nieuw">⬆ Nieuwe versie</button>
        ${isSchraven() ? `<button class="btn klein gevaar" id="b-del">Verwijderen</button>` : ''}
      </div>
      <label class="veld"><span>Omschrijving / waar gaat het om</span><textarea id="b-oms" style="min-height:3.5em">${esc(b.omschrijving || '')}</textarea></label>
      <div class="acties-rij"><button class="btn klein" id="b-oms-opsl">Omschrijving opslaan</button>${isSchraven() ? `<button class="btn klein" id="b-verpl">Naar andere map</button>` : ''}</div>
      <h3>Versies</h3>
      <div class="versies">${vs.map(v => `<div class="item"><span class="v">v${v.versie}</span><span class="vul">${esc(v.bestandsnaam)}<div class="klein">${esc(naam(v.geupload_door))} · ${esc(datTijd(v.created_at))} · ${mb(v.grootte)}${v.dropbox_pad ? ' · ☁ Dropbox' : ''}</div></span><button class="btn klein" data-dl="${v.id}">⬇ Download</button></div>`).join('')}</div>
      <h3 style="margin-top:1em">Logboek & opmerkingen</h3>
      <div class="opm-form"><textarea id="b-opm" placeholder="Opmerking bij dit bestand… (bijv. 'maat detail 3 klopt niet, zie DWG')"></textarea><button class="btn p" id="b-opm-knop">Plaats</button></div>
      <div class="logboek">${log.map(l => `<div class="log-item ${l.opm ? 'opm' : ''}"><span class="wie">${esc(l.wie)}</span><span class="wanneer">${esc(datTijd(l.t))}</span>${l.opm && (l.door === S.user.id || isSchraven()) ? `<button class="btn link klein" data-opm-del="${l.id}" title="Verwijderen">✕</button>` : ''}<div class="tekst">${esc(l.tekst)}</div></div>`).join('') || '<div class="klein">Nog geen logboek.</div>'}</div>
    `);
    $('#b-status').onchange = async e => { const st = e.target.value; const { error } = await sb.from('bestanden').update({ status: st }).eq('id', id); if (error) return fout(error); await sb.from('bestand_log').insert({ bestand_id: id, soort: 'status', tekst: 'Status → ' + STATUS_BESTAND[st], door: S.user.id }); toast('Status opgeslagen'); herlaad(); };
    $('#b-nieuw').onclick = () => $('#b-upl').click();
    $('#b-upl').onchange = e => { uploadNieuw(Array.from(e.target.files), id); };
    $('#b-oms-opsl').onclick = async () => { const { error } = await sb.from('bestanden').update({ omschrijving: $('#b-oms').value }).eq('id', id); if (error) return fout(error); toast('Opgeslagen'); herlaad(); };
    if ($('#b-verpl')) $('#b-verpl').onclick = () => modalVraag('Naar andere map', 'Mapnaam (leeg = hoofdmap)', b.map || '', async v => { const { error } = await sb.from('bestanden').update({ map: v || '' }).eq('id', id); if (error) return fout(error); await sb.from('bestand_log').insert({ bestand_id: id, soort: 'map', tekst: 'Verplaatst naar map "' + (v || 'Hoofdmap') + '"', door: S.user.id }); herlaad(); });
    if ($('#b-del')) $('#b-del').onclick = () => modalBevestig('Bestand verwijderen?', `"${b.naam}" met alle versies en opmerkingen wordt verwijderd (alleen uit het platform; de Dropbox-kopie blijft staan).`, async () => { const { error } = await sb.from('bestanden').update({ verwijderd: true }).eq('id', id); if (error) return fout(error); sluitLade(); toast('Verwijderd'); herlaad(); });
    $('#b-opm-knop').onclick = () => plaatsOpmerking('bestand', id, $('#b-opm'));
    $$('[data-dl]').forEach(x => x.onclick = () => download(x.dataset.dl));
    $$('[data-opm-del]').forEach(x => x.onclick = () => verwijderOpmerking(x.dataset.opmDel));
  };
  S.lade();
}
async function plaatsOpmerking(doel_type, doel_id, ta) {
  const t = ta.value.trim(); if (!t) return;
  const { error } = await sb.from('opmerkingen').insert({ ruimte: S.ruimte, doel_type, doel_id, tekst: t, door: S.user.id });
  if (error) return fout(error); ta.value = ''; toast('Opmerking geplaatst'); herlaad();
}
async function verwijderOpmerking(id) { const { error } = await sb.from('opmerkingen').delete().eq('id', id); if (error) return fout(error); herlaad(); }
function opmBlok(doel_type, doel_id) {
  const os = S.opmerkingen.filter(o => o.doel_type === doel_type && o.doel_id === doel_id);
  return `<h3 style="margin-top:1em">Opmerkingen</h3>
    <div class="opm-form"><textarea id="opm-in" placeholder="Opmerking…"></textarea><button class="btn p" id="opm-knop">Plaats</button></div>
    <div class="logboek">${os.map(o => `<div class="log-item opm"><span class="wie">${esc(naam(o.door))}</span><span class="wanneer">${esc(datTijd(o.created_at))}</span>${(o.door === S.user.id || isSchraven()) ? `<button class="btn link klein" data-opm-del="${o.id}">✕</button>` : ''}<div class="tekst">${esc(o.tekst)}</div></div>`).join('') || '<div class="klein">Nog geen opmerkingen.</div>'}</div>`;
}
function opmKoppel(doel_type, doel_id) {
  $('#opm-knop').onclick = () => plaatsOpmerking(doel_type, doel_id, $('#opm-in'));
  $$('[data-opm-del]').forEach(x => x.onclick = () => verwijderOpmerking(x.dataset.opmDel));
}

// ===== ACTIEPUNTEN =====
function rActies(m) {
  const f = S.actieFilter;
  let lijst = S.acties.filter(a => f === 'alle' ? true : f === 'mijn' ? (a.verantwoordelijke === S.user.id && a.status !== 'klaar' && a.status !== 'vervallen') : f === 'klaar' ? a.status === 'klaar' : (a.status === 'open' || a.status === 'bezig'));
  lijst = lijst.slice().sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || b.nummer - a.nummer);
  m.innerHTML = `<div class="paneel">
    <div class="kop"><h2>Actiepunten</h2><div class="chips">${[['open', 'Open'], ['mijn', 'Voor mij'], ['klaar', 'Afgerond'], ['alle', 'Alles']].map(([k, v]) => `<button class="chip ${f === k ? 'actief' : ''}" data-f="${k}">${v}</button>`).join('')}</div><div class="vul"></div><button class="btn p" id="a-nieuw">+ Actiepunt</button></div>
    <div class="tabel-wrap">${lijst.length ? `<table class="lijst"><thead><tr><th>#</th><th>Actie</th><th>Wie</th><th>Deadline</th><th>Status</th></tr></thead><tbody>
      ${lijst.map(a => `<tr class="klik" data-id="${a.id}"><td class="mono">${a.nummer}</td><td><b>${esc(a.titel)}</b> ${a.prioriteit === 'hoog' ? tag('hoog', 'Hoog') : ''}${a.omschrijving ? `<div class="klein">${esc(a.omschrijving.slice(0, 140))}</div>` : ''}</td><td>${esc(a.verantwoordelijke_naam || naam(a.verantwoordelijke))}</td><td>${a.deadline ? (a.deadline < vandaag() && (a.status === 'open' || a.status === 'bezig') ? tag('telaat', dat(a.deadline)) : esc(dat(a.deadline))) : '—'}</td><td><select data-st="${a.id}" style="width:auto;padding:.2em .4em">${Object.entries(STATUS_ACTIE).map(([k, v]) => `<option value="${k}" ${a.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td></tr>`).join('')}
    </tbody></table>` : '<div class="leeg">Geen actiepunten in deze lijst.</div>'}</div></div>`;
  $$('.chip', m).forEach(c => c.onclick = () => { S.actieFilter = c.dataset.f; render(); });
  $('#a-nieuw').onclick = () => actieModal();
  $$('tr[data-id]', m).forEach(r => r.onclick = e => { if (e.target.tagName === 'SELECT') return; openActie(r.dataset.id); });
  $$('select[data-st]', m).forEach(s => { s.onclick = e => e.stopPropagation(); s.onchange = () => zetActieStatus(s.dataset.st, s.value); });
}
async function zetActieStatus(id, st) {
  const { error } = await sb.from('acties').update({ status: st, klaar_op: st === 'klaar' ? new Date().toISOString() : null }).eq('id', id);
  if (error) return fout(error); toast('Status: ' + STATUS_ACTIE[st]); herlaad();
}
function personenOpties(gekozen) {
  const ps = S.profielen.filter(p => p.actief && (p.rol === 'schraven' || p.rol === S.ruimte));
  return `<option value="">— kies —</option>` + ps.map(p => `<option value="${p.id}" ${gekozen === p.id ? 'selected' : ''}>${esc(p.naam)} (${ROL[p.rol]})</option>`).join('');
}
function actieModal(a, bron) {
  a = a || {};
  modal(a.id ? `Actiepunt #${a.nummer} bewerken` : 'Nieuw actiepunt', `
    <label class="veld"><span>Actie</span><input type="text" id="a-titel" value="${esc(a.titel || '')}" required></label>
    <label class="veld"><span>Toelichting</span><textarea id="a-oms">${esc(a.omschrijving || '')}</textarea></label>
    <div class="rij">
      <label class="veld"><span>Verantwoordelijke</span><select id="a-wie">${personenOpties(a.verantwoordelijke)}</select></label>
      <label class="veld"><span>Of naam (niet-gebruiker)</span><input type="text" id="a-wie-naam" value="${esc(a.verantwoordelijke_naam || '')}" placeholder="bijv. architect"></label>
    </div>
    <div class="rij">
      <label class="veld"><span>Deadline</span><input type="date" id="a-dl" value="${esc(a.deadline || '')}"></label>
      <label class="veld"><span>Prioriteit</span><select id="a-prio">${Object.entries(PRIO).map(([k, v]) => `<option value="${k}" ${(a.prioriteit || 'normaal') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="veld"><span>Status</span><select id="a-st">${Object.entries(STATUS_ACTIE).map(([k, v]) => `<option value="${k}" ${(a.status || 'open') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    ${bron ? `<p class="klein">Gekoppeld aan: ${esc(bron.label)}</p>` : ''}`,
    async () => {
      const titel = $('#a-titel').value.trim(); if (!titel) return toast('Vul een actie in');
      const st = $('#a-st').value;
      const rec = { ruimte: S.ruimte, titel, omschrijving: $('#a-oms').value, verantwoordelijke: $('#a-wie').value || null, verantwoordelijke_naam: $('#a-wie-naam').value.trim(), deadline: $('#a-dl').value || null, prioriteit: $('#a-prio').value, status: st, klaar_op: st === 'klaar' ? (a.klaar_op || new Date().toISOString()) : null };
      if (bron) { rec.bron_type = bron.type; rec.bron_id = bron.id; }
      let r;
      if (a.id) r = await sb.from('acties').update(rec).eq('id', a.id); else { rec.gemaakt_door = S.user.id; r = await sb.from('acties').insert(rec); }
      if (r.error) return fout(r.error); toast('Opgeslagen'); herlaad(); return true;
    });
}
function openActie(id) {
  S.lade = () => {
    const a = S.acties.find(a => a.id === id); if (!a) return sluitLade();
    const bron = a.bron_type === 'afspraak' ? S.afspraken.find(x => x.id === a.bron_id) : a.bron_type === 'bestand' ? S.bestanden.find(x => x.id === a.bron_id) : a.bron_type === 'mail' ? S.mails.find(x => x.id === a.bron_id) : null;
    lade(`<span class="klein">Actiepunt #${a.nummer}</span><br>${esc(a.titel)}`, `
      <div class="acties-rij">${tag(a.status, STATUS_ACTIE[a.status])} ${tag(a.prioriteit, 'Prioriteit ' + PRIO[a.prioriteit].toLowerCase())}<div class="vul"></div><button class="btn klein" id="a-bew">Bewerken</button>${isSchraven() ? `<button class="btn klein gevaar" id="a-del">Verwijderen</button>` : ''}</div>
      <table class="lijst"><tbody>
        <tr><td class="klein">Verantwoordelijke</td><td>${esc(a.verantwoordelijke_naam || naam(a.verantwoordelijke))}</td></tr>
        <tr><td class="klein">Deadline</td><td>${a.deadline ? (a.deadline < vandaag() && (a.status === 'open' || a.status === 'bezig') ? tag('telaat', dat(a.deadline) + ' — te laat') : esc(dat(a.deadline)) + ' (wk ' + week(a.deadline) + ')') : '—'}</td></tr>
        <tr><td class="klein">Aangemaakt</td><td>${esc(naam(a.gemaakt_door))} · ${esc(datTijd(a.created_at))}</td></tr>
        ${a.klaar_op ? `<tr><td class="klein">Afgerond</td><td>${esc(datTijd(a.klaar_op))}</td></tr>` : ''}
        ${bron ? `<tr><td class="klein">Bron</td><td><button class="btn link" id="a-bron">${esc(a.bron_type === 'afspraak' ? SOORT_AFSPRAAK[bron.soort] + ': ' + bron.titel : a.bron_type === 'mail' ? 'Mail: ' + bron.onderwerp : 'Bestand: ' + bron.naam)}</button></td></tr>` : ''}
      </tbody></table>
      ${a.omschrijving ? `<p style="white-space:pre-wrap;margin-top:.8em">${esc(a.omschrijving)}</p>` : ''}
      <div class="acties-rij" style="margin-top:.8em">${a.status !== 'klaar' ? `<button class="btn p klein" id="a-klaar">✓ Afronden</button>` : `<button class="btn klein" id="a-heropen">Heropenen</button>`}</div>
      ${opmBlok('actie', id)}`);
    $('#a-bew').onclick = () => actieModal(a);
    if ($('#a-del')) $('#a-del').onclick = () => modalBevestig('Actiepunt verwijderen?', a.titel, async () => { const { error } = await sb.from('acties').delete().eq('id', id); if (error) return fout(error); sluitLade(); herlaad(); });
    if ($('#a-klaar')) $('#a-klaar').onclick = () => zetActieStatus(id, 'klaar');
    if ($('#a-heropen')) $('#a-heropen').onclick = () => zetActieStatus(id, 'open');
    if ($('#a-bron')) $('#a-bron').onclick = () => { if (a.bron_type === 'afspraak') openAfspraak(bron.id); else if (a.bron_type === 'mail') openMail(bron.id); else openBestand(bron.id); };
    opmKoppel('actie', id);
  };
  S.lade();
}

// ===== AFSPRAKEN =====
function rAfspraken(m) {
  m.innerHTML = `<div class="paneel">
    <div class="kop"><h2>Afspraken, overleggen & besluiten</h2><div class="vul"></div><button class="btn p" id="af-nieuw">+ Toevoegen</button></div>
    <p class="klein">Alles wat je met elkaar afspreekt op één plek. Vanuit een afspraak maak je direct actiepunten aan.</p>
    <div class="tabel-wrap">${S.afspraken.length ? `<table class="lijst"><thead><tr><th>Datum</th><th>Soort</th><th>Onderwerp</th><th class="verberg-mobiel">Aanwezig</th><th>Acties</th></tr></thead><tbody>
      ${S.afspraken.map(a => { const n = S.acties.filter(x => x.bron_type === 'afspraak' && x.bron_id === a.id); const nOpen = n.filter(x => x.status === 'open' || x.status === 'bezig').length; return `<tr class="klik" data-id="${a.id}"><td>${esc(dat(a.datum))}<div class="klein">wk ${week(a.datum)}</div></td><td>${tag(a.soort === 'besluit' ? 'definitief' : a.soort === 'overleg' ? 'nieuw' : 'open', SOORT_AFSPRAAK[a.soort])}</td><td><b>${esc(a.titel)}</b>${a.tekst ? `<div class="klein">${esc(a.tekst.slice(0, 160))}${a.tekst.length > 160 ? '…' : ''}</div>` : ''}</td><td class="verberg-mobiel klein">${esc(a.aanwezigen || '')}</td><td>${n.length ? `${n.length}${nOpen ? ` <span class="klein">(${nOpen} open)</span>` : ''}` : '—'}</td></tr>`; }).join('')}
    </tbody></table>` : '<div class="leeg">Nog geen afspraken vastgelegd.</div>'}</div></div>`;
  $('#af-nieuw').onclick = () => afspraakModal();
  $$('tr[data-id]', m).forEach(r => r.onclick = () => openAfspraak(r.dataset.id));
}
function afspraakModal(a) {
  a = a || {};
  modal(a.id ? 'Afspraak bewerken' : 'Nieuwe afspraak / overleg / besluit', `
    <div class="rij">
      <label class="veld"><span>Soort</span><select id="af-soort">${Object.entries(SOORT_AFSPRAAK).map(([k, v]) => `<option value="${k}" ${(a.soort || 'afspraak') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="veld"><span>Datum</span><input type="date" id="af-datum" value="${esc(a.datum || vandaag())}"></label>
    </div>
    <label class="veld"><span>Onderwerp</span><input type="text" id="af-titel" value="${esc(a.titel || '')}"></label>
    <label class="veld"><span>Wat is er afgesproken / besproken</span><textarea id="af-tekst" style="min-height:8em">${esc(a.tekst || '')}</textarea></label>
    <label class="veld"><span>Aanwezig / betrokken</span><input type="text" id="af-aanw" value="${esc(a.aanwezigen || '')}" placeholder="namen, gescheiden door komma's"></label>`,
    async () => {
      const titel = $('#af-titel').value.trim(); if (!titel) return toast('Vul een onderwerp in');
      const rec = { ruimte: S.ruimte, soort: $('#af-soort').value, datum: $('#af-datum').value || vandaag(), titel, tekst: $('#af-tekst').value, aanwezigen: $('#af-aanw').value };
      let r; if (a.id) r = await sb.from('afspraken').update(rec).eq('id', a.id); else { rec.gemaakt_door = S.user.id; r = await sb.from('afspraken').insert(rec); }
      if (r.error) return fout(r.error); toast('Opgeslagen'); herlaad(); return true;
    });
}
function openAfspraak(id) {
  S.lade = () => {
    const a = S.afspraken.find(a => a.id === id); if (!a) return sluitLade();
    const acts = S.acties.filter(x => x.bron_type === 'afspraak' && x.bron_id === id);
    lade(`<span class="klein">${SOORT_AFSPRAAK[a.soort]} · ${esc(dat(a.datum))}</span><br>${esc(a.titel)}`, `
      <div class="acties-rij"><span class="klein">${esc(naam(a.gemaakt_door))}${a.aanwezigen ? ' · aanwezig: ' + esc(a.aanwezigen) : ''}</span><div class="vul"></div><button class="btn klein" id="af-bew">Bewerken</button>${isSchraven() ? `<button class="btn klein gevaar" id="af-del">Verwijderen</button>` : ''}</div>
      <p style="white-space:pre-wrap">${esc(a.tekst || '')}</p>
      <h3 style="margin-top:1em">Actiepunten uit deze afspraak</h3>
      ${acts.length ? `<table class="lijst"><tbody>${acts.map(x => `<tr class="klik" data-actie="${x.id}"><td class="mono">#${x.nummer}</td><td>${esc(x.titel)}<div class="klein">${esc(x.verantwoordelijke_naam || naam(x.verantwoordelijke))}${x.deadline ? ' · ' + dat(x.deadline) : ''}</div></td><td>${tag(x.status, STATUS_ACTIE[x.status])}</td></tr>`).join('')}</tbody></table>` : '<p class="klein">Nog geen actiepunten.</p>'}
      <div class="acties-rij"><button class="btn p klein" id="af-actie">+ Actiepunt uit deze afspraak</button></div>
      ${opmBlok('afspraak', id)}`);
    $('#af-bew').onclick = () => afspraakModal(a);
    if ($('#af-del')) $('#af-del').onclick = () => modalBevestig('Verwijderen?', a.titel, async () => { const { error } = await sb.from('afspraken').delete().eq('id', id); if (error) return fout(error); sluitLade(); herlaad(); });
    $('#af-actie').onclick = () => actieModal(null, { type: 'afspraak', id, label: SOORT_AFSPRAAK[a.soort] + ': ' + a.titel });
    $$('[data-actie]').forEach(x => x.onclick = () => openActie(x.dataset.actie));
    opmKoppel('afspraak', id);
  };
  S.lade();
}

// ===== MAIL =====
function rMail(m) {
  const f = S.mailFilter;
  const lijst = S.mails.filter(x => f === 'alle' || x.richting === f);
  m.innerHTML = `<div class="paneel">
    <div class="kop"><h2>Mail-log</h2><div class="chips">${[['alle', 'Alles'], ['uit', 'Verstuurd'], ['in', 'Ontvangen']].map(([k, v]) => `<button class="chip ${f === k ? 'actief' : ''}" data-f="${k}">${v}</button>`).join('')}</div><div class="vul"></div><button class="btn p" id="m-nieuw">+ Mail loggen</button></div>
    <p class="klein">Mails die via het BCC-adres binnenkomen verschijnen hier automatisch; andere mails kun je hier handmatig plakken.</p>
    <div class="tabel-wrap">${lijst.length ? `<table class="lijst"><thead><tr><th>Datum</th><th></th><th>Van → aan</th><th>Onderwerp</th><th>Bijl.</th></tr></thead><tbody>
      ${lijst.map(x => `<tr class="klik" data-id="${x.id}"><td>${esc(datTijd(x.datum))}</td><td>${tag(x.richting, x.richting === 'uit' ? 'Uit' : 'In')}</td><td class="klein">${esc(x.van)}<br>→ ${esc(x.aan)}</td><td><b>${esc(x.onderwerp || '(geen onderwerp)')}</b><div class="klein">${esc((x.tekst || '').replace(/\s+/g, ' ').slice(0, 110))}</div></td><td>${(x.bijlagen || []).length ? '📎 ' + x.bijlagen.length : ''}</td></tr>`).join('')}
    </tbody></table>` : '<div class="leeg">Nog geen mails gelogd.</div>'}</div></div>`;
  $$('.chip', m).forEach(c => c.onclick = () => { S.mailFilter = c.dataset.f; render(); });
  $('#m-nieuw').onclick = () => mailModal();
  $$('tr[data-id]', m).forEach(r => r.onclick = () => openMail(r.dataset.id));
}
function mailModal() {
  modal('Mail loggen', `
    <div class="rij">
      <label class="veld"><span>Richting</span><select id="m-richting"><option value="uit">Verstuurd door Schraven</option><option value="in">Ontvangen</option></select></label>
      <label class="veld"><span>Datum/tijd</span><input type="datetime-local" id="m-datum" value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}"></label>
    </div>
    <div class="rij">
      <label class="veld"><span>Van</span><input type="email" id="m-van" value="${esc(S.profiel.email)}"></label>
      <label class="veld"><span>Aan</span><input type="text" id="m-aan"></label>
    </div>
    <label class="veld"><span>CC</span><input type="text" id="m-cc"></label>
    <label class="veld"><span>Onderwerp</span><input type="text" id="m-ond"></label>
    <label class="veld"><span>Tekst (plak de mail hier)</span><textarea id="m-tekst" style="min-height:10em"></textarea></label>
    <label class="veld"><span>Bijlagen</span><input type="file" id="m-bijl" multiple></label>`,
    async () => {
      const ond = $('#m-ond').value.trim(); if (!ond && !$('#m-tekst').value.trim()) return toast('Vul minimaal een onderwerp of tekst in');
      const { data: mail, error } = await sb.from('mails').insert({ ruimte: S.ruimte, richting: $('#m-richting').value, van: $('#m-van').value, aan: $('#m-aan').value, cc: $('#m-cc').value, onderwerp: ond, datum: new Date($('#m-datum').value || Date.now()).toISOString(), tekst: $('#m-tekst').value, bron: 'handmatig', gemaakt_door: S.user.id }).select().single();
      if (error) return fout(error);
      const files = Array.from($('#m-bijl').files || []); const bijl = [];
      for (const f of files) { const pad = `${S.ruimte}/mail/${mail.id}/${veiligeNaam(f.name)}`; try { await uploadBlob(pad, f, () => { }); bijl.push({ naam: f.name, pad, grootte: f.size }); } catch (e) { fout(e); } }
      if (bijl.length) await sb.from('mails').update({ bijlagen: bijl }).eq('id', mail.id);
      toast('Mail gelogd'); herlaad(); return true;
    });
}
function openMail(id) {
  S.lade = () => {
    const x = S.mails.find(x => x.id === id); if (!x) return sluitLade();
    lade(`<span class="klein">${x.richting === 'uit' ? 'Verstuurd' : 'Ontvangen'} · ${esc(datTijd(x.datum))}</span><br>${esc(x.onderwerp || '(geen onderwerp)')}`, `
      <table class="lijst"><tbody><tr><td class="klein">Van</td><td>${esc(x.van)}</td></tr><tr><td class="klein">Aan</td><td>${esc(x.aan)}</td></tr>${x.cc ? `<tr><td class="klein">CC</td><td>${esc(x.cc)}</td></tr>` : ''}<tr><td class="klein">Bron</td><td>${x.bron === 'bcc' ? 'automatisch via BCC' : 'handmatig gelogd door ' + esc(naam(x.gemaakt_door))}</td></tr></tbody></table>
      <div class="mail-tekst" style="margin-top:.8em">${esc(x.tekst || '')}</div>
      ${(x.bijlagen || []).length ? `<div style="margin-top:.6em">${x.bijlagen.map((b, i) => `<span class="bijlage" data-bijl="${i}">📎 ${esc(b.naam)} <span class="klein">${mb(b.grootte || 0)}</span></span>`).join('')}</div>` : ''}
      <div class="acties-rij" style="margin-top:.8em"><button class="btn p klein" id="m-actie">+ Actiepunt uit deze mail</button>${isSchraven() ? `<button class="btn klein" id="m-verpl">Naar ${S.ruimte === 'opdrachtgever' ? 'leverancier' : 'opdrachtgever'}-ruimte</button><button class="btn klein gevaar" id="m-del">Verwijderen</button>` : ''}</div>
      ${opmBlok('mail', id)}`);
    $$('[data-bijl]').forEach(e => e.onclick = async () => { const b = x.bijlagen[+e.dataset.bijl]; const { data, error } = await sb.storage.from(C.BUCKET).createSignedUrl(b.pad, 3600, { download: b.naam }); if (error) return fout(error); window.open(data.signedUrl, '_blank'); });
    $('#m-actie').onclick = () => actieModal({ titel: 'Re: ' + (x.onderwerp || '') }, { type: 'mail', id, label: 'Mail: ' + x.onderwerp });
    if ($('#m-verpl')) $('#m-verpl').onclick = async () => { const { error } = await sb.from('mails').update({ ruimte: S.ruimte === 'opdrachtgever' ? 'leverancier' : 'opdrachtgever' }).eq('id', id); if (error) return fout(error); sluitLade(); toast('Verplaatst'); herlaad(); };
    if ($('#m-del')) $('#m-del').onclick = () => modalBevestig('Mail verwijderen?', x.onderwerp, async () => { const { error } = await sb.from('mails').delete().eq('id', id); if (error) return fout(error); sluitLade(); herlaad(); });
    opmKoppel('mail', id);
  };
  S.lade();
}

// ===== PLANNING (Gantt) =====
function rPlanning(m) {
  const P = S.planning.slice().sort((a, b) => a.volgorde - b.volgorde || a.start.localeCompare(b.start));
  const kan = isSchraven();
  if (!P.length) {
    m.innerHTML = `<div class="paneel"><div class="kop"><h2>Planning</h2><div class="vul"></div>${kan ? '<button class="btn p" id="p-nieuw">+ Onderdeel</button>' : ''}</div><div class="leeg">Nog geen planning.${kan ? ' Voeg een onderdeel of mijlpaal toe.' : ''}</div>${opmBlok('planning', null)}</div>`;
    if (kan) $('#p-nieuw').onclick = () => planModal(); opmKoppelAlg(); return;
  }
  const min = new Date(P.reduce((a, p) => p.start < a ? p.start : a, P[0].start)); min.setDate(min.getDate() - min.getDay() + 1 - 7);
  const max = new Date(P.reduce((a, p) => p.eind > a ? p.eind : a, P[0].eind)); max.setDate(max.getDate() + 14);
  const dagen = []; for (let d = new Date(min); d <= max; d.setDate(d.getDate() + 1)) dagen.push(new Date(d));
  const dagBreedte = S.planZoom || 22; // px per dag
  const breedte = dagen.length * dagBreedte;
  const t0 = min.getTime(); const px = d => Math.round((new Date(d).getTime() - t0) / 864e5 * dagBreedte);
  const vd = new Date(); vd.setHours(0, 0, 0, 0);
  // weekkoppen
  const weken = []; dagen.forEach((d, i) => { if (d.getDay() === 1 || i === 0) weken.push({ d, n: 0 }); weken[weken.length - 1].n++; });
  const groepen = []; P.forEach(p => { const g = p.groep || ''; if (!groepen.includes(g)) groepen.push(g); });
  let rijen = '';
  groepen.forEach(g => {
    if (g) rijen += `<div class="cel naamcel groep">${esc(g)}</div><div class="rijbalk" style="min-height:26px;width:${breedte}px;background:var(--bg)"></div>`;
    P.filter(p => (p.groep || '') === g).forEach(p => {
      const l = px(p.start), r = px(p.eind) + dagBreedte, w = Math.max(r - l, dagBreedte);
      const bar = p.mijlpaal ? `<div class="mijlpaal" style="left:${l + dagBreedte / 2 - 9}px" title="${esc(p.naam)} · ${dat(p.start)}"></div><span style="position:absolute;left:${l + dagBreedte + 8}px;top:8px;font-size:.75rem;white-space:nowrap">${esc(p.naam)}</span>`
        : `<div class="balk" style="left:${l}px;width:${w}px;${p.kleur ? 'background:' + esc(p.kleur) : ''}" title="${esc(p.naam)} · ${dat(p.start)} t/m ${dat(p.eind)} · ${p.voortgang}%"><div class="vord" style="width:${p.voortgang}%"></div><span>${esc(p.naam)}</span></div>`;
      rijen += `<div class="cel naamcel" data-plan="${p.id}">${esc(p.naam)}<div class="sub">${p.mijlpaal ? '◆ ' + dat(p.start) : dat(p.start) + ' – ' + dat(p.eind) + (p.voortgang ? ' · ' + p.voortgang + '%' : '')}</div></div>
        <div class="rijbalk" style="width:${breedte}px"><div class="raster" style="grid-template-columns:repeat(${dagen.length},${dagBreedte}px)">${dagen.map(d => `<div class="${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''}"></div>`).join('')}</div>${vd >= min && vd <= max ? `<div class="vandaag" style="left:${px(vd) + dagBreedte / 2}px"></div>` : ''}${bar}</div>`;
    });
  });
  m.innerHTML = `<div class="paneel">
    <div class="kop"><h2>Planning</h2><div class="vul"></div>
      <button class="btn klein" id="p-uit">−</button><button class="btn klein" id="p-in">+</button>
      <button class="btn klein" onclick="window.print()">🖨 Print</button>
      ${kan ? '<button class="btn p" id="p-nieuw">+ Onderdeel</button>' : ''}</div>
    <div class="gantt-wrap"><div class="gantt" style="grid-template-columns:200px ${breedte}px">
      <div class="cel kopcel naamcel" style="text-align:left;z-index:4">Onderdeel</div>
      <div style="display:grid;grid-template-columns:${weken.map(w => w.n * dagBreedte + 'px').join(' ')};position:sticky;top:0;z-index:2">${weken.map(w => `<div class="cel kopcel ${vd >= w.d && vd < new Date(w.d.getTime() + w.n * 864e5) ? 'vandaag-kop' : ''}">wk ${week(w.d)}<br><span style="font-weight:400">${w.d.getDate()}/${w.d.getMonth() + 1}</span></div>`).join('')}</div>
      ${rijen}
    </div></div>
    <p class="klein" style="margin-top:.5em">Rode lijn = vandaag · ◆ = mijlpaal · donker deel van een balk = voortgang${kan ? ' · klik op een onderdeel om te bewerken' : ''}</p>
    ${opmBlok('planning', null)}
  </div>`;
  const wrap = $('.gantt-wrap', m); if (wrap && vd >= min) wrap.scrollLeft = Math.max(0, px(vd) - 120);
  $('#p-in').onclick = () => { S.planZoom = Math.min((S.planZoom || 22) + 6, 60); render(); };
  $('#p-uit').onclick = () => { S.planZoom = Math.max((S.planZoom || 22) - 6, 8); render(); };
  if (kan) { $('#p-nieuw').onclick = () => planModal(); $$('[data-plan]', m).forEach(e => e.onclick = () => planModal(S.planning.find(p => p.id === e.dataset.plan))); }
  opmKoppelAlg();
}
function opmKoppelAlg() {
  const os = S.opmerkingen.filter(o => o.doel_type === 'planning');
  $('#opm-knop').onclick = () => plaatsOpmerking('planning', null, $('#opm-in'));
  $$('[data-opm-del]').forEach(x => x.onclick = () => verwijderOpmerking(x.dataset.opmDel));
}
function planModal(p) {
  p = p || {};
  const groepen = Array.from(new Set(S.planning.map(x => x.groep).filter(Boolean)));
  modal(p.id ? 'Onderdeel bewerken' : 'Nieuw onderdeel / mijlpaal', `
    <label class="veld"><span>Naam</span><input type="text" id="p-naam" value="${esc(p.naam || '')}"></label>
    <div class="rij">
      <label class="veld"><span>Groep / fase</span><input type="text" id="p-groep" list="p-groepen" value="${esc(p.groep || '')}" placeholder="bijv. Engineering"><datalist id="p-groepen">${groepen.map(g => `<option value="${esc(g)}">`).join('')}</datalist></label>
      <label class="veld"><span>Mijlpaal</span><select id="p-mp"><option value="0" ${!p.mijlpaal ? 'selected' : ''}>Nee (balk)</option><option value="1" ${p.mijlpaal ? 'selected' : ''}>Ja (◆ één datum)</option></select></label>
    </div>
    <div class="rij">
      <label class="veld"><span>Start</span><input type="date" id="p-start" value="${esc(p.start || vandaag())}"></label>
      <label class="veld"><span>Eind</span><input type="date" id="p-eind" value="${esc(p.eind || p.start || vandaag())}"></label>
      <label class="veld"><span>Voortgang %</span><input type="number" id="p-vord" min="0" max="100" value="${p.voortgang || 0}"></label>
    </div>
    <div class="rij">
      <label class="veld"><span>Volgorde</span><input type="number" id="p-volg" value="${p.volgorde ?? (S.planning.length + 1) * 10}"></label>
      <label class="veld"><span>Kleur</span><select id="p-kleur">${[['', 'Oranje (standaard)'], ['#2a6fd6', 'Blauw'], ['#2e9e5b', 'Groen'], ['#8a929c', 'Grijs'], ['#7b4bd6', 'Paars'], ['#d33a2c', 'Rood']].map(([k, v]) => `<option value="${k}" ${(p.kleur || '') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <label class="veld"><span>Opmerking</span><input type="text" id="p-opm" value="${esc(p.opmerking || '')}"></label>`,
    async () => {
      const naamV = $('#p-naam').value.trim(); if (!naamV) return toast('Vul een naam in');
      const mp = $('#p-mp').value === '1'; const start = $('#p-start').value; let eind = $('#p-eind').value || start; if (mp) eind = start; if (eind < start) return toast('Eind ligt vóór start');
      const rec = { ruimte: S.ruimte, naam: naamV, groep: $('#p-groep').value.trim(), mijlpaal: mp, start, eind, voortgang: Math.max(0, Math.min(100, +$('#p-vord').value || 0)), volgorde: +$('#p-volg').value || 0, kleur: $('#p-kleur').value, opmerking: $('#p-opm').value };
      const r = p.id ? await sb.from('planning').update(rec).eq('id', p.id) : await sb.from('planning').insert(rec);
      if (r.error) return fout(r.error); toast('Opgeslagen'); herlaad(); return true;
    }, p.id ? () => modalBevestig('Onderdeel verwijderen?', p.naam, async () => { const { error } = await sb.from('planning').delete().eq('id', p.id); if (error) return fout(error); herlaad(); }) : null);
}

// ===== TEAM =====
function rTeam(m) {
  const kan = isSchraven();
  const ps = S.profielen.filter(p => kan || p.rol === 'schraven' || p.rol === S.ruimte);
  m.innerHTML = `<div class="paneel">
    <div class="kop"><h2>${kan ? 'Team & toegang' : 'Contacten'}</h2><div class="vul"></div>${kan ? '<button class="btn p" id="t-nieuw">+ Gebruiker</button>' : ''}</div>
    ${kan ? '<p class="klein">Opdrachtgever-accounts zien alleen de opdrachtgever-ruimte, leverancier-accounts alleen de leverancier-ruimte. Schraven-accounts zien alles.</p>' : ''}
    <div class="tabel-wrap"><table class="lijst"><thead><tr><th>Naam</th><th>Bedrijf</th><th>E-mail</th><th>Rol</th>${kan ? '<th>Actief</th><th></th>' : ''}</tr></thead><tbody>
      ${ps.map(p => `<tr><td><b>${esc(p.naam)}</b></td><td>${esc(p.bedrijf || '')}</td><td><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></td><td>${tag('rol-' + p.rol, ROL[p.rol])}</td>${kan ? `<td>${p.actief ? '✓' : tag('afgekeurd', 'Uit')}</td><td style="white-space:nowrap"><button class="btn klein" data-bew="${p.id}">Bewerken</button> ${p.id !== S.user.id ? `<button class="btn klein" data-act="${p.id}">${p.actief ? 'Blokkeren' : 'Activeren'}</button> <button class="btn klein" data-ww="${p.id}">Wachtwoord</button>` : ''}</td>` : ''}</tr>`).join('')}
    </tbody></table></div></div>`;
  if (!kan) return;
  $('#t-nieuw').onclick = () => gebruikerModal();
  $$('[data-bew]', m).forEach(b => b.onclick = () => gebruikerModal(S.profielen.find(p => p.id === b.dataset.bew)));
  $$('[data-act]', m).forEach(b => b.onclick = async () => { const p = S.profielen.find(p => p.id === b.dataset.act); const { error } = await sb.from('profielen').update({ actief: !p.actief }).eq('id', p.id); if (error) return fout(error); herlaad(); });
  $$('[data-ww]', m).forEach(b => b.onclick = () => modalVraag('Nieuw wachtwoord instellen', 'Nieuw wachtwoord (min. 8 tekens) — geef dit persoonlijk door', '', async v => { if (!v || v.length < 8) return toast('Minimaal 8 tekens'); try { await apiCall('/api/gebruikers', { actie: 'wachtwoord', id: b.dataset.ww, wachtwoord: v }); toast('Wachtwoord gewijzigd'); } catch (e) { fout(e); } }));
}
function gebruikerModal(p) {
  p = p || {};
  modal(p.id ? 'Gebruiker bewerken' : 'Nieuwe gebruiker', `
    <div class="rij">
      <label class="veld"><span>Naam</span><input type="text" id="g-naam" value="${esc(p.naam || '')}"></label>
      <label class="veld"><span>Bedrijf</span><input type="text" id="g-bedrijf" value="${esc(p.bedrijf || '')}"></label>
    </div>
    <label class="veld"><span>E-mailadres (= inlognaam)</span><input type="email" id="g-email" value="${esc(p.email || '')}" ${p.id ? 'disabled' : ''}></label>
    <label class="veld"><span>Rol</span><select id="g-rol">${Object.entries(ROL).map(([k, v]) => `<option value="${k}" ${(p.rol || 'opdrachtgever') === k ? 'selected' : ''}>${v}${k === 'schraven' ? ' (ziet alles)' : ' (alleen eigen ruimte)'}</option>`).join('')}</select></label>
    ${p.id ? '' : '<label class="veld"><span>Wachtwoord (min. 8 tekens) — geef dit persoonlijk door</span><input type="text" id="g-ww" autocomplete="off"></label>'}`,
    async () => {
      const rec = { naam: $('#g-naam').value.trim(), bedrijf: $('#g-bedrijf').value.trim(), rol: $('#g-rol').value };
      if (!rec.naam) return toast('Vul een naam in');
      if (p.id) { const { error } = await sb.from('profielen').update(rec).eq('id', p.id); if (error) return fout(error); }
      else {
        const email = $('#g-email').value.trim(), ww = $('#g-ww').value; if (!email || ww.length < 8) return toast('E-mail en wachtwoord (min. 8 tekens) verplicht');
        try { await apiCall('/api/gebruikers', { actie: 'nieuw', email, wachtwoord: ww, ...rec }); } catch (e) { return fout(e); }
      }
      toast('Opgeslagen'); herlaad(); return true;
    }, p.id && p.id !== S.user.id ? () => modalBevestig('Gebruiker verwijderen?', `${p.naam} kan daarna niet meer inloggen. Zijn/haar bestanden en opmerkingen blijven staan.`, async () => { try { await apiCall('/api/gebruikers', { actie: 'verwijder', id: p.id }); toast('Verwijderd'); herlaad(); } catch (e) { fout(e); } }) : null);
}

// ---------- lade & modals ----------
function lade(titel, html) {
  $('#lade-plek').innerHTML = `<div class="lade-achter" id="lade-achter"></div><div class="lade" role="dialog"><div class="lade-kop"><h3>${titel}</h3><button class="sluit" id="lade-sluit" aria-label="Sluiten">×</button></div><div class="lade-body">${html}</div></div>`;
  $('#lade-achter').onclick = sluitLade; $('#lade-sluit').onclick = sluitLade;
}
function sluitLade() { S.lade = null; $('#lade-plek').innerHTML = ''; }
function modal(titel, html, opOpslaan, opVerwijder) {
  $('#modal-plek').innerHTML = `<div class="modal-achter" id="modal-achter"><div class="modal" role="dialog"><div class="m-kop"><h3>${esc(titel)}</h3><button class="sluit" id="modal-sluit">×</button></div><div class="m-body">${html}</div><div class="m-voet">${opVerwijder ? '<button class="btn gevaar" id="modal-del">Verwijderen</button><div class="vul" style="flex:1"></div>' : ''}<button class="btn" id="modal-annuleer">Annuleren</button><button class="btn p" id="modal-opslaan">Opslaan</button></div></div></div>`;
  const sluit = () => $('#modal-plek').innerHTML = '';
  $('#modal-sluit').onclick = sluit; $('#modal-annuleer').onclick = sluit;
  $('#modal-achter').onclick = e => { if (e.target.id === 'modal-achter') sluit(); };
  $('#modal-opslaan').onclick = async () => { $('#modal-opslaan').disabled = true; const ok = await opOpslaan(); if (ok) sluit(); else if ($('#modal-opslaan')) $('#modal-opslaan').disabled = false; };
  if (opVerwijder) $('#modal-del').onclick = () => { sluit(); opVerwijder(); };
  const first = $('.m-body input[type=text],.m-body input[type=email],.m-body textarea'); if (first && !first.disabled) first.focus();
}
function modalVraag(titel, label, waarde, cb) {
  modal(titel, `<label class="veld"><span>${esc(label)}</span><input type="text" id="vraag-in" value="${esc(waarde)}"></label>`, async () => { await cb($('#vraag-in').value.trim()); return true; });
}
function modalBevestig(titel, tekst, cb) {
  modal(titel, `<p>${esc(tekst)}</p>`, async () => { await cb(); return true; });
  $('#modal-opslaan').textContent = 'Ja, doorgaan'; $('#modal-opslaan').classList.add('gevaar');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('#modal-plek').innerHTML) $('#modal-plek').innerHTML = ''; else sluitLade(); } });
window.__S = S; // voor tests
})();
