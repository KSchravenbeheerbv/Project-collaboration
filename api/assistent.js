// Claude-projectassistent: vragen over het project, actiepunten voorstellen, weekoverzicht, mailtekst uitlezen.
// Nodig in Vercel: ANTHROPIC_API_KEY (optioneel ANTHROPIC_MODEL). Ziet alleen de ruimte waar de gebruiker bij mag.
const { wieBelt, json, body } = require('./_hulp');
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const STATUS_B = { nieuw: 'Nieuw', ter_controle: 'Ter controle', goedgekeurd: 'Goedgekeurd', afgekeurd: 'Afgekeurd', definitief: 'Definitief' };
const dat = d => d ? new Date(d).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const kort = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };

async function claude(system, messages, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error('ANTHROPIC_API_KEY ontbreekt in Vercel (zie LEESMIJ, stap Assistent)');
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, max_tokens: maxTokens || 1500, system, messages }) });
  const j = await r.json();
  if (!r.ok) throw new Error('Claude: ' + (j.error && j.error.message || r.status));
  return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}

// Alles uit de ruimte in leesbare vorm (begrensd, nieuwste eerst)
async function context(sb, ruimte, namen) {
  const q = (t, o, lim) => sb.from(t).select('*').eq('ruimte', ruimte).order(o, { ascending: false }).limit(lim);
  const [be, ac, af, ma, pl, op] = await Promise.all([q('bestanden', 'updated_at', 150).eq('verwijderd', false), q('acties', 'nummer', 200), q('afspraken', 'datum', 80), q('mails', 'datum', 60), q('planning', 'start', 100), q('opmerkingen', 'created_at', 300)]);
  const n = id => namen[id] || 'onbekend';
  const opm = (t, id) => (op.data || []).filter(o => o.doel_type === t && o.doel_id === id).map(o => `    · ${dat(o.created_at)} ${n(o.door)}: ${kort(o.tekst, 300)}`).join('\n');
  let s = `VANDAAG: ${dat(new Date())}\n\n== ACTIEPUNTEN (${(ac.data || []).length}) ==\n`;
  for (const a of ac.data || []) s += `#${a.nummer} [${a.status}${a.prioriteit === 'hoog' ? ', HOOG' : ''}] ${a.titel} — wie: ${a.verantwoordelijke_naam || n(a.verantwoordelijke)}${a.deadline ? ', deadline ' + dat(a.deadline) : ''}${a.omschrijving ? ' — ' + kort(a.omschrijving, 200) : ''}\n${opm('actie', a.id)}`.replace(/\n$/, '') + '\n';
  s += `\n== AFSPRAKEN / OVERLEGGEN / BESLUITEN ==\n`;
  for (const a of af.data || []) s += `${dat(a.datum)} [${a.soort}] ${a.titel}${a.aanwezigen ? ' (aanwezig: ' + a.aanwezigen + ')' : ''}: ${kort(a.tekst, 800)}\n${opm('afspraak', a.id)}`.replace(/\n$/, '') + '\n';
  s += `\n== BESTANDEN ==\n`;
  for (const b of be.data || []) s += `${b.map ? b.map + '/' : ''}${b.naam} v${b.huidige_versie} [${STATUS_B[b.status] || b.status}] ${kort(b.omschrijving, 150)} (gewijzigd ${dat(b.updated_at)})\n${opm('bestand', b.id)}`.replace(/\n$/, '') + '\n';
  s += `\n== MAILS (nieuwste eerst) ==\n`;
  for (const m of ma.data || []) s += `${dat(m.datum)} ${m.richting === 'uit' ? 'VERSTUURD' : 'ONTVANGEN'} van ${m.van} aan ${m.aan} — "${m.onderwerp}"${(m.bijlagen || []).length ? ' [bijlagen: ' + m.bijlagen.map(x => x.naam).join(', ') + ']' : ''}\n  ${kort(m.tekst, 1200)}\n`;
  s += `\n== PLANNING ==\n`;
  for (const p of pl.data || []) s += `${p.groep ? p.groep + ' / ' : ''}${p.naam}: ${p.mijlpaal ? 'mijlpaal ' + dat(p.start) : dat(p.start) + ' t/m ' + dat(p.eind) + ' (' + p.voortgang + '%)'}${p.opmerking ? ' — ' + p.opmerking : ''}\n`;
  s += opm('planning', null) ? '\n' + opm('planning', null) : '';
  return s.slice(0, 180000);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Alleen POST' });
  let wie; try { wie = await wieBelt(req); } catch (e) { return json(res, 500, { error: e.message }); }
  if (!wie) return json(res, 401, { error: 'Niet ingelogd' });
  const b = await body(req); const sb = wie.sb; const ruimte = b.ruimte;
  try {
    if (b.actie === 'mail_tekst') {
      const uit = await claude('Je krijgt de tekst van een e-mail die iemand heeft gekopieerd en geplakt (kan Nederlands of Engels/Pools zijn, kan een hele mailwisseling zijn). Haal de gegevens van de BOVENSTE (nieuwste) mail eruit. Antwoord UITSLUITEND met JSON: {"van":"naam <adres>","aan":"...","cc":"...","datum":"YYYY-MM-DDTHH:MM" of "","onderwerp":"...","tekst":"de volledige mailtekst inclusief eerdere berichten, opgeschoond, zonder handtekening-rommel"}', [{ role: 'user', content: String(b.tekst || '').slice(0, 60000) }], 4000);
      const m = /\{[\s\S]*\}/.exec(uit); if (!m) throw new Error('Kon de mail niet uitlezen');
      return json(res, 200, { ok: true, mail: JSON.parse(m[0]) });
    }
    if (!['opdrachtgever', 'leverancier'].includes(ruimte)) return json(res, 400, { error: 'Ruimte ontbreekt' });
    if (wie.profiel.rol !== 'schraven' && wie.profiel.rol !== ruimte) return json(res, 403, { error: 'Geen toegang tot deze ruimte' });
    const { data: profs } = await sb.from('profielen').select('id,naam,rol,bedrijf').eq('actief', true);
    const namen = {}; (profs || []).forEach(p => namen[p.id] = p.naam);
    const personen = (profs || []).filter(p => p.rol === 'schraven' || p.rol === ruimte).map(p => `${p.naam} (${p.rol}${p.bedrijf ? ', ' + p.bedrijf : ''})`).join(', ');
    const ctx = await context(sb, ruimte, namen);
    const basis = `Je bent de projectassistent van het samenwerkingsplatform voor het bouwproject "Merwede Utrecht" (kozijnen/gevel, Schraven BV uit Goirle). Je kijkt naar de ruimte "${ruimte === 'opdrachtgever' ? 'Opdrachtgever ↔ Schraven' : 'Schraven ↔ Leverancier'}". Gebruiker: ${wie.profiel.naam} (rol ${wie.profiel.rol}). Betrokken personen: ${personen}.\nAntwoord in gewoon Nederlands, kort en concreet, gericht op de bouwpraktijk. Verzin niets: als iets niet in de gegevens staat, zeg dat. Verwijs naar actiepunten met hun nummer (#12), naar bestanden met hun naam en naar mails met datum + onderwerp.\n\nHIERONDER ALLE GEGEVENS VAN DEZE RUIMTE:\n${ctx}`;

    if (b.actie === 'chat') {
      const hist = (Array.isArray(b.geschiedenis) ? b.geschiedenis : []).slice(-12).map(h => ({ role: h.rol === 'assistant' ? 'assistant' : 'user', content: String(h.tekst || '').slice(0, 6000) }));
      hist.push({ role: 'user', content: String(b.vraag || '').slice(0, 6000) });
      const uit = await claude(basis, hist, 2000);
      return json(res, 200, { ok: true, antwoord: uit });
    }
    if (b.actie === 'week') {
      const uit = await claude(basis, [{ role: 'user', content: `Maak een weekoverzicht voor ${wie.profiel.naam} met deze kopjes (gebruik ze letterlijk, zonder markdown-sterretjes):\nWAT IS ER DE AFGELOPEN 7 DAGEN GEBEURD\nWAT LOOPT ACHTER OF VRAAGT AANDACHT (te late deadlines, bestanden die lang ter controle staan, onbeantwoorde mails)\nWAT MOET ER DEZE WEEK GEBEUREN (per persoon)\nKOMENDE MIJLPALEN\nHoud het onder de 400 woorden; puntsgewijs met streepjes.` }], 2000);
      return json(res, 200, { ok: true, tekst: uit });
    }
    if (b.actie === 'acties') {
      let bron = '';
      if (b.doel_type === 'mail') { const { data: m } = await sb.from('mails').select('*').eq('id', b.doel_id).eq('ruimte', ruimte).maybeSingle(); if (!m) throw new Error('Mail niet gevonden'); bron = `MAIL van ${m.van} aan ${m.aan}, ${dat(m.datum)}, onderwerp "${m.onderwerp}":\n${String(m.tekst || '').slice(0, 20000)}`; }
      else if (b.doel_type === 'afspraak') { const { data: a } = await sb.from('afspraken').select('*').eq('id', b.doel_id).eq('ruimte', ruimte).maybeSingle(); if (!a) throw new Error('Afspraak niet gevonden'); bron = `${a.soort.toUpperCase()} ${dat(a.datum)} "${a.titel}" (aanwezig: ${a.aanwezigen}):\n${a.tekst}`; }
      else if (b.doel_type === 'tekst') bron = String(b.tekst || '').slice(0, 20000);
      else throw new Error('Onbekende bron');
      const uit = await claude(basis, [{ role: 'user', content: `Haal uit onderstaande bron de concrete actiepunten die NOG NIET als actiepunt in de gegevens staan (vergelijk met de bestaande lijst). Per actiepunt: korte titel (werkwoord vooraan), wie (kies uit de betrokken personen als dat duidelijk is, anders een vrije naam zoals "architect" of "Schraven"), deadline (YYYY-MM-DD als die uit de tekst blijkt, anders leeg) en een toelichting van één zin. Antwoord UITSLUITEND met JSON: {"acties":[{"titel":"","wie":"","deadline":"","omschrijving":""}]} — maximaal 8, geen actiepunten verzinnen die er niet in staan.\n\nBRON:\n${bron}` }], 2000);
      const m = /\{[\s\S]*\}/.exec(uit); const acties = m ? (JSON.parse(m[0]).acties || []) : [];
      return json(res, 200, { ok: true, acties, personen: (profs || []).filter(p => p.rol === 'schraven' || p.rol === ruimte).map(p => ({ id: p.id, naam: p.naam })) });
    }
    return json(res, 400, { error: 'Onbekende actie' });
  } catch (e) { console.error(e); return json(res, 500, { error: e.message }); }
};
