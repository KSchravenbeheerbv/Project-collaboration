// Gedeelde hulpfuncties voor de serverfuncties (draaien op Vercel, niet in de browser)
const { createClient } = require('@supabase/supabase-js');

function admin() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY ontbreken in Vercel environment variables');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Wie belt er? Geeft { user, profiel } of null
async function wieBelt(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const sb = admin();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profiel, error: pe } = await sb.from('profielen').select('*').eq('id', data.user.id).maybeSingle();
  if (pe) throw new Error('Profiel lezen mislukt: ' + pe.message);
  if (!profiel) {
    // service_role-sleutel omzeilt de beveiliging; ziet hij géén enkel profiel, dan is het de verkeerde sleutel
    const { count } = await sb.from('profielen').select('id', { count: 'exact', head: true });
    if (!count) throw new Error('SUPABASE_SERVICE_KEY in Vercel is niet de service_role-sleutel (Supabase → Project Settings → API Keys → service_role / secret key). Daarna Redeploy.');
    return null;
  }
  if (!profiel.actief) return null;
  return { user: data.user, profiel, sb };
}

function json(res, code, obj) { res.status(code).setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); }

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return await new Promise(ok => { let s = ''; req.on('data', c => s += c); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { ok({}); } }); });
}

module.exports = { admin, wieBelt, json, body };
