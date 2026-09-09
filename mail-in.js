// Inkomende mail via het BCC-adres → mail-log.
// Werkt met Resend (webhook "email.received"), en met diensten die de mail als JSON met
// base64-bijlagen sturen (Postmark, CloudMailin, Zapier/Make).
// Beveiliging: de webhook-URL moet ?token=<MAIL_IN_TOKEN> bevatten.
const { admin, json, body } = require('./_hulp');

const SCHRAVEN = (process.env.SCHRAVEN_DOMEINEN || 'kozijnenglas.nl,schraven.nl').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const BUCKET = process.env.BUCKET || 'bestanden';

function adresLijst(x) {
  if (!x) return '';
  if (Array.isArray(x)) return x.map(adresLijst).filter(Boolean).join(', ');
  if (typeof x === 'object') return x.Email || x.email || x.address || x.Name || '';
  return String(x);
}
function ruimteUit(aan) {
  const s = (aan || '').toLowerCase();
  return /lev|leverancier|supplier|okna/.test(s) ? 'leverancier' : 'opdrachtgever';
}
function richtingUit(van) {
  const dom = ((van || '').match(/@([^>\s,;]+)/) || [])[1] || '';
  return SCHRAVEN.some(d => dom.toLowerCase().endsWith(d)) ? 'uit' : 'in';
}

// Resend: mail ophalen op basis van email_id
async function vanResend(id) {
  const key = process.env.RESEND_API_KEY; if (!key) throw new Error('RESEND_API_KEY ontbreekt');
  const h = { authorization: 'Bearer ' + key };
  const r = await fetch('https://api.resend.com/emails/receiving/' + id, { headers: h });
  if (!r.ok) throw new Error('Resend ophalen mislukt: ' + r.status);
  const m = await r.json();
  const bijlagen = [];
  try {
    const ra = await fetch(`https://api.resend.com/emails/receiving/${id}/attachments`, { headers: h });
    if (ra.ok) { const j = await ra.json(); for (const a of (j.data || j.attachments || [])) { const url = a.download_url || a.url; if (!url) continue; const f = await fetch(url); if (f.ok) bijlagen.push({ naam: a.filename || a.name || 'bijlage', buffer: Buffer.from(await f.arrayBuffer()), mime: a.content_type || a.contentType || '' }); } }
  } catch (e) { console.warn('bijlagen', e.message); }
  return { van: adresLijst(m.from), aan: adresLijst(m.to), cc: adresLijst(m.cc), onderwerp: m.subject || '', tekst: m.text || strip(m.html), datum: m.created_at || new Date().toISOString(), bijlagen };
}
function strip(html) { return html ? String(html).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim() : ''; }

// Generiek JSON-formaat (Postmark/CloudMailin/Zapier): from,to,cc,subject,text,html,date,attachments[{filename|name,content|data(base64),content_type}]
function generiek(b) {
  const att = b.Attachments || b.attachments || [];
  const bijlagen = att.map(a => ({ naam: a.Name || a.filename || a.name || 'bijlage', buffer: Buffer.from(a.Content || a.content || a.data || '', 'base64'), mime: a.ContentType || a.content_type || a.type || '' })).filter(a => a.buffer.length);
  return {
    van: adresLijst(b.From || b.FromFull || b.from || b.sender), aan: adresLijst(b.To || b.ToFull || b.to || b.recipient), cc: adresLijst(b.Cc || b.CcFull || b.cc),
    onderwerp: b.Subject || b.subject || '', tekst: b.TextBody || b.text || b.plain || strip(b.HtmlBody || b.html), datum: b.Date || b.date || new Date().toISOString(), bijlagen,
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Alleen POST' });
  const token = (req.query && req.query.token) || new URL(req.url, 'http://x').searchParams.get('token');
  if (!process.env.MAIL_IN_TOKEN || token !== process.env.MAIL_IN_TOKEN) return json(res, 403, { error: 'Ongeldig token' });
  const b = await body(req);
  try {
    let m;
    if (b.type && /^email\./.test(b.type) && b.data) {
      if (b.type !== 'email.received') return json(res, 200, { ok: true, genegeerd: b.type });
      m = await vanResend(b.data.email_id || b.data.id);
    } else m = generiek(b);
    const sb = admin();
    const ruimte = ruimteUit(m.aan + ' ' + (m.cc || '') + ' ' + (b.data && b.data.to ? adresLijst(b.data.to) : ''));
    const richting = richtingUit(m.van);
    const { data: mail, error } = await sb.from('mails').insert({ ruimte, richting, van: m.van, aan: m.aan, cc: m.cc || '', onderwerp: m.onderwerp, datum: new Date(m.datum).toISOString(), tekst: m.tekst || '', bron: 'bcc' }).select().single();
    if (error) throw error;
    const bijl = [];
    for (const a of m.bijlagen) {
      const pad = `${ruimte}/mail/${mail.id}/${a.naam.replace(/[^\w.\-() ]/g, '_')}`;
      const { error: e2 } = await sb.storage.from(BUCKET).upload(pad, a.buffer, { contentType: a.mime || 'application/octet-stream', upsert: true });
      if (!e2) bijl.push({ naam: a.naam, pad, grootte: a.buffer.length }); else console.warn('bijlage', e2.message);
    }
    if (bijl.length) await sb.from('mails').update({ bijlagen: bijl }).eq('id', mail.id);
    return json(res, 200, { ok: true, id: mail.id, ruimte, richting, bijlagen: bijl.length });
  } catch (e) { console.error(e); return json(res, 500, { error: e.message }); }
};
