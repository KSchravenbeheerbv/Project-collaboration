// Kopie van elk bestand naar Dropbox (Schraven-archief).
// - Vanuit de app: POST { versie_id } met de login van de gebruiker (direct na een upload)
// - Nachtelijke ronde (Vercel cron): GET ?alles=1 met Authorization: Bearer <CRON_SECRET>
// Nodig in Vercel: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN, DROPBOX_MAP (bijv. "/werk/Merwede Utrecht/05 Samenwerking")
const { admin, wieBelt, json, body } = require('./_hulp');
const BUCKET = process.env.BUCKET || 'bestanden';

async function dropboxToken() {
  const { DROPBOX_APP_KEY: k, DROPBOX_APP_SECRET: s, DROPBOX_REFRESH_TOKEN: r } = process.env;
  if (!k || !s || !r) throw new Error('Dropbox nog niet gekoppeld (DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN ontbreken)');
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: r, client_id: k, client_secret: s }) });
  if (!res.ok) throw new Error('Dropbox token mislukt: ' + await res.text());
  return (await res.json()).access_token;
}
const veilig = s => String(s || '').replace(/[\\:*?"<>|]/g, '_').trim();

async function naarDropbox(token, pad, buffer) {
  const arg = JSON.stringify({ path: pad, mode: 'add', autorename: true, mute: true });
  if (buffer.length < 140 * 1024 * 1024) {
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/octet-stream', 'dropbox-api-arg': arg }, body: buffer });
    if (!r.ok) throw new Error('Dropbox upload: ' + await r.text());
    return (await r.json()).path_display;
  }
  // groot: in stukken van 100 MB
  const stuk = 100 * 1024 * 1024; let offset = 0;
  let r = await fetch('https://content.dropboxapi.com/2/files/upload_session/start', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/octet-stream', 'dropbox-api-arg': JSON.stringify({ close: false }) }, body: buffer.subarray(0, stuk) });
  if (!r.ok) throw new Error('Dropbox sessie: ' + await r.text());
  const sid = (await r.json()).session_id; offset = Math.min(stuk, buffer.length);
  while (buffer.length - offset > stuk) {
    r = await fetch('https://content.dropboxapi.com/2/files/upload_session/append_v2', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/octet-stream', 'dropbox-api-arg': JSON.stringify({ cursor: { session_id: sid, offset }, close: false }) }, body: buffer.subarray(offset, offset + stuk) });
    if (!r.ok) throw new Error('Dropbox append: ' + await r.text()); offset += stuk;
  }
  r = await fetch('https://content.dropboxapi.com/2/files/upload_session/finish', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/octet-stream', 'dropbox-api-arg': JSON.stringify({ cursor: { session_id: sid, offset }, commit: { path: pad, mode: 'add', autorename: true, mute: true } }) }, body: buffer.subarray(offset) });
  if (!r.ok) throw new Error('Dropbox finish: ' + await r.text());
  return (await r.json()).path_display;
}

async function kopieer(sb, token, v) {
  const { data: b } = await sb.from('bestanden').select('*').eq('id', v.bestand_id).single();
  const { data: blob, error } = await sb.storage.from(BUCKET).download(v.storage_pad);
  if (error) throw error;
  const buffer = Buffer.from(await blob.arrayBuffer());
  const basis = (process.env.DROPBOX_MAP || '/Utrecht samenwerking').replace(/\/$/, '');
  const ruimteNaam = b.ruimte === 'opdrachtgever' ? '1 Opdrachtgever' : '2 Leverancier';
  const naam = v.versie > 1 ? v.bestandsnaam.replace(/(\.[^.]+)?$/, ` (v${v.versie})$1`) : v.bestandsnaam;
  const pad = `${basis}/${ruimteNaam}/${b.map ? veilig(b.map) + '/' : ''}${veilig(naam)}`;
  const echtPad = await naarDropbox(token, pad, buffer);
  await sb.from('bestand_versies').update({ dropbox_pad: echtPad }).eq('id', v.id);
  return echtPad;
}

module.exports = async (req, res) => {
  try {
    const sb = admin();
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.searchParams.get('alles')) {
      // nachtelijke ronde
      const auth = req.headers.authorization || '';
      if (!process.env.CRON_SECRET || auth !== 'Bearer ' + process.env.CRON_SECRET) return json(res, 403, { error: 'Geen toegang' });
      const token = await dropboxToken();
      const { data: open } = await sb.from('bestand_versies').select('*').is('dropbox_pad', null).order('created_at').limit(25);
      const klaar = [], fouten = [];
      for (const v of open || []) { try { klaar.push(await kopieer(sb, token, v)); } catch (e) { fouten.push(v.bestandsnaam + ': ' + e.message); } }
      return json(res, 200, { ok: true, gekopieerd: klaar, fouten });
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Alleen POST' });
    const wie = await wieBelt(req); if (!wie) return json(res, 401, { error: 'Niet ingelogd' });
    const b = await body(req);
    const { data: v } = await sb.from('bestand_versies').select('*').eq('id', b.versie_id).maybeSingle();
    if (!v) return json(res, 404, { error: 'Versie niet gevonden' });
    if (v.dropbox_pad) return json(res, 200, { ok: true, pad: v.dropbox_pad, al: true });
    const token = await dropboxToken();
    const pad = await kopieer(sb, token, v);
    return json(res, 200, { ok: true, pad });
  } catch (e) { console.error(e); return json(res, 500, { error: e.message }); }
};
