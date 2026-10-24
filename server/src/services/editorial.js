/**
 * Éditorial du site (Contenu du site › Éditorial) : textes, boutons, listes et sections masquées des pages publiques.
 * Stocké dans `site_content` (clé `editorial`) sous la forme { texts: { clé: valeur }, hidden: [clés] } ;
 * seules les valeurs qui diffèrent du texte d'origine des pages sont gardées (une page retouchée garde ainsi ses textes).
 */
const catalog = require('../lib/site-text-slots.json');
const { HttpError } = require('../lib/http');

const MAX = { text: 400, long: 3000, label: 200, href: 500, meta_title: 120, meta_description: 320, list: 40 };
// Même règle que le site (js/site-content.js › safeHref) : pages du site, ancres, adresses web, téléphone, e-mail
const SAFE_HREF = /^(https?:\/\/|[a-z0-9_.-]+\.html|#|tel:|mailto:)/i;

/** Index du catalogue : clé → { kind, default, label } ; clés masquables (sections et cartes). */
function buildIndex() {
  const fields = new Map();
  const hideable = new Set();
  const addBlocks = (blocks, where) => blocks.forEach(b => {
    if (b.type === 'card') { hideable.add(b.key); addBlocks(b.blocks, `${where} › ${b.name || b.label}`); return; }
    fields.set(b.key, { kind: b.type === 'list' ? `list-${b.kind}` : b.kind, default: b.default, label: `${where} › ${b.label}` });
  });
  for (const page of catalog.pages) {
    if (page.meta) {
      fields.set(`${page.id}.meta.title`, { kind: 'meta_title', default: page.meta.title, label: `${page.label} › Titre de la page` });
      fields.set(`${page.id}.meta.description`, { kind: 'meta_description', default: page.meta.description, label: `${page.label} › Description` });
    }
    for (const s of page.sections) {
      if (s.managed) continue;
      hideable.add(s.key);
      addBlocks(s.blocks, `${page.label} › ${s.label}`);
    }
  }
  return { fields, hideable };
}
const index = buildIndex();

const str = (v, max, label) => {
  if (typeof v !== 'string') throw new HttpError(400, `${label} : texte attendu.`);
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (s.length > max) throw new HttpError(400, `${label} : ${max} caractères au plus.`);
  return s;
};
const href = (v, label) => {
  const h = str(v ?? '', MAX.href, label);
  if (h && !SAFE_HREF.test(h)) throw new HttpError(400, `${label} : lien non accepté (« ${h} »). Indiquez une page du site (ex. contact.html), une ancre (#…) ou une adresse complète (https://…).`);
  return h;
};
const link = (v, label) => {
  if (!v || typeof v !== 'object') throw new HttpError(400, `${label} : libellé et lien attendus.`);
  return { label: str(v.label ?? '', MAX.label, label), href: href(v.href, label) };
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Valeur propre d'un champ, ou undefined si elle est vide ou égale au texte d'origine. */
function cleanValue(f, v) {
  let out;
  switch (f.kind) {
    case 'text': case 'long': out = str(v, MAX[f.kind], f.label); break;
    case 'label': out = str(v, MAX.label, f.label); break;
    case 'meta_title': case 'meta_description': out = str(v, MAX[f.kind], f.label); break;
    case 'link': {
      out = link(v, f.label);
      // Libellé ou lien vide : celui d'origine (pour retirer un bouton, masquer la section ou la carte)
      if (!out.label) out.label = f.default.label;
      if (!out.href) out.href = f.default.href;
      break;
    }
    case 'list-text': case 'list-link': {
      if (!Array.isArray(v)) throw new HttpError(400, `${f.label} : liste attendue.`);
      if (v.length > MAX.list) throw new HttpError(400, `${f.label} : ${MAX.list} éléments au plus.`);
      out = f.kind === 'list-text'
        ? v.map(x => str(x, MAX.text, f.label)).filter(Boolean)
        : v.map(x => link(x, f.label)).filter(x => x.label).map(x => ({ label: x.label, href: x.href || '#' }));
      break;
    }
    default: return undefined;
  }
  if (out === '' || same(out, f.default)) return undefined;
  return out;
}

/** Contrôle et nettoie l'éditorial envoyé par le dashboard. Les clés inconnues (texte retiré d'une page) sont ignorées. */
function cleanEditorial(body) {
  const texts = {};
  const src = body && typeof body.texts === 'object' && body.texts ? body.texts : {};
  for (const [key, v] of Object.entries(src)) {
    const f = index.fields.get(key);
    if (!f || v == null) continue;
    const out = cleanValue(f, v);
    if (out !== undefined) texts[key] = out;
  }
  const hidden = [...new Set((Array.isArray(body?.hidden) ? body.hidden : []).filter(k => typeof k === 'string' && index.hideable.has(k)))];
  return { texts, hidden };
}

module.exports = { catalog, cleanEditorial, editorialIndex: index };
