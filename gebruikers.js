// Gebruikersbeheer: alleen Schraven-accounts mogen dit aanroepen.
const { wieBelt, json, body } = require('./_hulp');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Alleen POST' });
  let wie;
  try { wie = await wieBelt(req); } catch (e) { return json(res, 500, { error: e.message }); }
  if (!wie || wie.profiel.rol !== 'schraven') return json(res, 403, { error: 'Alleen Schraven mag gebruikers beheren' });
  const b = await body(req);
  const sb = wie.sb;
  try {
    if (b.actie === 'nieuw') {
      const email = String(b.email || '').trim().toLowerCase();
      if (!email || !b.wachtwoord || String(b.wachtwoord).length < 8) return json(res, 400, { error: 'E-mail en wachtwoord (min. 8 tekens) verplicht' });
      if (!['schraven', 'opdrachtgever', 'leverancier'].includes(b.rol)) return json(res, 400, { error: 'Ongeldige rol' });
      const { data, error } = await sb.auth.admin.createUser({ email, password: String(b.wachtwoord), email_confirm: true, user_metadata: { naam: b.naam || email, rol: b.rol, bedrijf: b.bedrijf || '' } });
      if (error) return json(res, 400, { error: error.message });
      // profiel wordt door de database-trigger aangemaakt; voor de zekerheid nog even bijwerken
      await sb.from('profielen').upsert({ id: data.user.id, naam: b.naam || email, email, rol: b.rol, bedrijf: b.bedrijf || '', actief: true });
      return json(res, 200, { ok: true, id: data.user.id });
    }
    if (b.actie === 'wachtwoord') {
      if (!b.id || !b.wachtwoord || String(b.wachtwoord).length < 8) return json(res, 400, { error: 'Wachtwoord min. 8 tekens' });
      const { error } = await sb.auth.admin.updateUserById(b.id, { password: String(b.wachtwoord) });
      if (error) return json(res, 400, { error: error.message });
      return json(res, 200, { ok: true });
    }
    if (b.actie === 'verwijder') {
      if (!b.id || b.id === wie.user.id) return json(res, 400, { error: 'Jezelf verwijderen kan niet' });
      // account blokkeren en profiel op inactief; de naam blijft zichtbaar bij oude opmerkingen/bestanden
      await sb.from('profielen').update({ actief: false }).eq('id', b.id);
      const { error } = await sb.auth.admin.updateUserById(b.id, { ban_duration: '876000h' });
      if (error) return json(res, 400, { error: error.message });
      return json(res, 200, { ok: true });
    }
    return json(res, 400, { error: 'Onbekende actie' });
  } catch (e) { return json(res, 500, { error: e.message }); }
};
