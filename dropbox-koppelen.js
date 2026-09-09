// Eenmalig Dropbox koppelen: open https://<jouw-site>/api/dropbox-koppelen in de browser.
// Werkt alleen zolang DROPBOX_REFRESH_TOKEN nog NIET in Vercel staat (daarna is deze pagina dicht).
module.exports = async (req, res) => {
  const html = (t) => { res.status(200).setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;max-width:640px;margin:3em auto;padding:0 1em">${t}</body>`); };
  if (process.env.DROPBOX_REFRESH_TOKEN) return html('<h2>Dropbox is al gekoppeld</h2><p>Wil je opnieuw koppelen? Verwijder dan eerst DROPBOX_REFRESH_TOKEN in Vercel.</p>');
  const key = process.env.DROPBOX_APP_KEY, secret = process.env.DROPBOX_APP_SECRET;
  if (!key || !secret) return html('<h2>Eerst DROPBOX_APP_KEY en DROPBOX_APP_SECRET in Vercel zetten</h2><p>Zie LEESMIJ.md, stap Dropbox.</p>');
  const url = new URL(req.url, 'https://' + (req.headers['x-forwarded-host'] || req.headers.host));
  const redirect = url.origin + '/api/dropbox-koppelen';
  const code = url.searchParams.get('code');
  if (!code) {
    const u = 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({ client_id: key, response_type: 'code', token_access_type: 'offline', redirect_uri: redirect });
    return html(`<h2>Dropbox koppelen</h2><p>Zorg dat <code>${redirect}</code> als Redirect URI in je Dropbox-app staat (App console → Settings → OAuth 2).</p><p><a href="${u}" style="display:inline-block;background:#f26a21;color:#fff;padding:.6em 1em;border-radius:8px;text-decoration:none">Koppel met Dropbox</a></p>`);
  }
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: key, client_secret: secret, redirect_uri: redirect }) });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) return html('<h2>Mislukt</h2><pre>' + (JSON.stringify(j, null, 2).replace(/</g, '&lt;')) + '</pre>');
  return html(`<h2>Gelukt ✓</h2><p>Zet deze waarde in Vercel als environment variable <b>DROPBOX_REFRESH_TOKEN</b> en doe daarna een Redeploy:</p><textarea style="width:100%;height:6em;font-family:monospace">${j.refresh_token}</textarea><p>Bewaar hem nergens anders. Daarna is deze pagina automatisch dicht.</p>`);
};
