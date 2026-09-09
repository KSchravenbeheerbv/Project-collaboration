// Mailbestand (.msg van Outlook of .eml) uitlezen → mail-log met bijlagen.
// De app zet het bestand eerst in de bestandsopslag (pad: <ruimte>/mailimport/...), daarna roept hij dit aan.
const { wieBelt, json, body } = require('./_hulp');
const { simpleParser } = require('mailparser');
const MsgReader = require('@kenjiuno/msgreader').default || require('@kenjiuno/msgreader');
const BUCKET = process.env.BUCKET || 'bestanden';
const SCHRAVEN = (process.env.SCHRAVEN_DOMEINEN || 'kozijnenglas.nl,schraven.nl').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const veilig = n => String(n || 'bijlage').replace(/[^\w.\-() À-ſ]/g, '_').slice(0, 120);
const adres = (naam, email) => email ? (naam && naam !== email ? `${naam} <${email}>` : email) : (naam || '');
function richting(van) { const dom = ((van || '').match(/@([^>\s,;]+)/) || [])[1] || ''; return SCHRAVEN.some(d => dom.toLowerCase().endsWith(d)) ? 'uit' : 'in'; }
const strip = html => html ? String(html).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim() : '';

async function leesEml(buffer) {
  const m = await simpleParser(buffer);
  const lijst = a => a ? (Array.isArray(a) ? a : [a]).map(x => x.text).join(', ') : '';
  return {
    van: lijst(m.from), aan: lijst(m.to), cc: lijst(m.cc), onderwerp: m.subject || '', datum: m.date ? new Date(m.date).toISOString() : new Date().toISOString(),
    tekst: m.text || strip(m.html),
    bijlagen: (m.attachments || []).filter(a => !(a.contentDisposition === 'inline' && /^image\//.test(a.contentType || '') && a.size < 200000)).map(a => ({ naam: a.filename || 'bijlage', buffer: a.content, mime: a.contentType || '' })),
  };
}
function leesMsg(buffer) {
  const r = new MsgReader(buffer); const d = r.getFileData();
  if (d.error) throw new Error('Kan .msg niet lezen: ' + d.error);
  const rec = (d.recipients || []);
  const aan = rec.filter(x => !x.recipType || x.recipType === 'to').map(x => adres(x.name, x.email || x.smtpAddress)).join(', ');
  const cc = rec.filter(x => x.recipType === 'cc').map(x => adres(x.name, x.email || x.smtpAddress)).join(', ');
  let datum = d.messageDeliveryTime || d.clientSubmitTime || d.creationTime || d.lastModificationTime;
  if (!datum && d.headers) { const m = /^Date:\s*(.+)$/mi.exec(d.headers); if (m) datum = m[1]; }
  const bijlagen = [];
  for (const a of (d.attachments || [])) {
    if (a.pidContentId && /^image\//.test(a.attachMimeTag || '') && (a.contentLength || 0) < 200000) continue; // inline plaatjes (handtekening) overslaan
    try { const f = r.getAttachment(a); if (f && f.content && f.content.length) bijlagen.push({ naam: f.fileName || a.fileName || 'bijlage', buffer: Buffer.from(f.content), mime: a.attachMimeTag || '' }); } catch (e) { console.warn('bijlage', e.message); }
  }
  return { van: adres(d.senderName, d.senderEmail || d.senderSmtpAddress), aan, cc, onderwerp: d.subject || '', datum: datum ? new Date(datum).toISOString() : new Date().toISOString(), tekst: d.body || strip(d.bodyHtml || (d.html ? Buffer.from(d.html).toString() : '')), bijlagen };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Alleen POST' });
  let wie; try { wie = await wieBelt(req); } catch (e) { return json(res, 500, { error: e.message }); }
  if (!wie) return json(res, 401, { error: 'Niet ingelogd' });
  const b = await body(req); const sb = wie.sb;
  const ruimte = b.ruimte; const pad = String(b.pad || '');
  if (!['opdrachtgever', 'leverancier'].includes(ruimte) || !pad.startsWith(ruimte + '/mailimport/')) return json(res, 400, { error: 'Ongeldige aanvraag' });
  if (wie.profiel.rol !== 'schraven' && wie.profiel.rol !== ruimte) return json(res, 403, { error: 'Geen toegang tot deze ruimte' });
  try {
    const { data: blob, error } = await sb.storage.from(BUCKET).download(pad); if (error) throw error;
    const buffer = Buffer.from(await blob.arrayBuffer());
    const naam = pad.split('/').pop();
    const isMsg = /\.msg$/i.test(naam) || buffer.slice(0, 8).equals(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]));
    const m = isMsg ? leesMsg(buffer) : await leesEml(buffer);
    const { data: mail, error: e2 } = await sb.from('mails').insert({ ruimte, richting: richting(m.van), van: m.van, aan: m.aan, cc: m.cc, onderwerp: m.onderwerp, datum: m.datum, tekst: (m.tekst || '').slice(0, 200000), bron: 'handmatig', gemaakt_door: wie.user.id }).select().single();
    if (e2) throw e2;
    const bijl = [];
    for (const a of m.bijlagen) {
      const p = `${ruimte}/mail/${mail.id}/${veilig(a.naam)}`;
      const { error: e3 } = await sb.storage.from(BUCKET).upload(p, a.buffer, { contentType: a.mime || 'application/octet-stream', upsert: true });
      if (!e3) bijl.push({ naam: a.naam, pad: p, grootte: a.buffer.length }); else console.warn('bijlage', e3.message);
    }
    // origineel bewaren als bijlage, importbestand opruimen
    const orig = `${ruimte}/mail/${mail.id}/${veilig(naam)}`;
    const { error: e4 } = await sb.storage.from(BUCKET).move(pad, orig);
    if (!e4) bijl.push({ naam: 'Origineel: ' + naam, pad: orig, grootte: buffer.length, origineel: true });
    await sb.from('mails').update({ bijlagen: bijl }).eq('id', mail.id);
    return json(res, 200, { ok: true, id: mail.id, onderwerp: m.onderwerp, van: m.van, bijlagen: bijl.length });
  } catch (e) { console.error(e); return json(res, 500, { error: e.message }); }
};
module.exports.leesEml = leesEml; module.exports.leesMsg = leesMsg;
