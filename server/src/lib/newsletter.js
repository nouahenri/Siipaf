/**
 * Newsletter : réglages d'envoi et modèle d'e-mail des campagnes (HTML compatible avec les messageries + texte brut).
 * Le texte d'une campagne s'écrit simplement : paragraphes séparés par une ligne vide, **gras**, [texte](lien),
 * liens nus, et listes dont chaque ligne commence par « - ».
 */

// Débit prudent par défaut : l'hébergeur (LWS) ne publie pas son quota ; à ajuster dans les réglages
const DEFAULT_NEWSLETTER = { per_minute: 5, per_hour: 150, sender_name: 'SIIPAF SA', reply_to: 'info@siipaf.com' };

const CAMPAIGN_STATUSES = {
  brouillon: 'Brouillon', en_cours: 'Envoi en cours', pause: 'En pause', envoyee: 'Envoyée', annulee: 'Annulée',
};

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = u => (/^(https?:\/\/|mailto:|tel:)/i.test(u) ? u : null);

/** Mise en forme d'une ligne : liens [texte](url), liens nus, **gras** (le texte est échappé avant). */
function inline(text, color) {
  const parts = [];
  let s = esc(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const u = safeUrl(url.replace(/&amp;/g, '&'));
    if (!u) return label;
    parts.push(`<a href="${esc(u)}" style="color:${color};text-decoration:underline">${label}</a>`);
    return `\u0000${parts.length - 1}\u0000`;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => {
    parts.push(`<a href="${url}" style="color:${color};text-decoration:underline">${url}</a>`);
    return `${pre}\u0000${parts.length - 1}\u0000`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => parts[Number(i)]);
}

/** Corps de la campagne : paragraphes et listes. */
function bodyHtml(body, color) {
  return String(body || '').replace(/\r/g, '').split(/\n\s*\n/).map(block => block.trim()).filter(Boolean).map(block => {
    const lines = block.split('\n');
    if (lines.every(l => /^\s*[-•]\s+/.test(l))) {
      return `<ul style="margin:0 0 16px;padding-left:20px">${lines.map(l => `<li style="margin:0 0 6px">${inline(l.replace(/^\s*[-•]\s+/, ''), color)}</li>`).join('')}</ul>`;
    }
    return `<p style="margin:0 0 16px">${lines.map(l => inline(l, color)).join('<br>')}</p>`;
  }).join('');
}

const plain = s => String(s || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)');

/**
 * E-mail d'une campagne. `urls` : logo, image (absolues), lien de désinscription, site.
 * Mise en page en tableaux et styles en ligne (Gmail, Outlook, messageries mobiles).
 */
function renderCampaign(c, { logoUrl, imageUrl = null, unsubscribeUrl, siteUrl, address = 'SIIPAF SA — Promoteur immobilier agréé, Abidjan, Côte d’Ivoire' }) {
  const brand = '#d2101e', ink = '#1d2230', muted = '#6b7280';
  const cta = c.cta_label && safeUrl(c.cta_url || '') ? `
            <tr><td align="center" style="padding:8px 32px 28px">
              <a href="${esc(c.cta_url)}" style="display:inline-block;background:${brand};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:8px">${esc(c.cta_label)}</a>
            </td></tr>` : '';
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.preheader || '')}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:${ink};font-size:15px;line-height:1.6">
        <tr><td align="center" style="padding:24px 32px 8px"><a href="${esc(siteUrl)}"><img src="${esc(logoUrl)}" alt="SIIPAF SA" width="180" style="display:block;width:180px;max-width:60%;height:auto;border:0"></a></td></tr>
        <tr><td style="height:4px;background:${brand};font-size:0;line-height:0">&nbsp;</td></tr>
        ${imageUrl ? `<tr><td style="padding:0"><img src="${esc(imageUrl)}" alt="" width="600" style="display:block;width:100%;height:auto;border:0"></td></tr>` : ''}
        <tr><td style="padding:28px 32px 4px">
          ${c.heading ? `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${ink}">${esc(c.heading)}</h1>` : ''}
          ${bodyHtml(c.body, brand)}
        </td></tr>${cta}
        <tr><td style="padding:20px 32px 28px;border-top:1px solid #e5e7eb;color:${muted};font-size:12px;line-height:1.5">
          ${esc(address)}<br>
          Vous recevez cet e-mail car vous êtes inscrit(e) à la newsletter de SIIPAF sur <a href="${esc(siteUrl)}" style="color:${muted}">${esc(siteUrl.replace(/^https?:\/\//, ''))}</a>.<br>
          <a href="${esc(unsubscribeUrl)}" style="color:${muted};text-decoration:underline">Se désinscrire</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  const text = [c.heading, '', plain(c.body), '', c.cta_label && c.cta_url ? `${c.cta_label} : ${c.cta_url}` : null, '', '—', address, `Se désinscrire : ${unsubscribeUrl}`]
    .filter(x => x != null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { html, text };
}

/** Nombre d'e-mails envoyables maintenant, selon le débit par minute et par heure. */
function allowance(s, sentLastMinute, sentLastHour) {
  return Math.max(0, Math.min(s.per_minute - sentLastMinute, s.per_hour - sentLastHour));
}

module.exports = { DEFAULT_NEWSLETTER, CAMPAIGN_STATUSES, renderCampaign, bodyHtml, inline, allowance, esc };
