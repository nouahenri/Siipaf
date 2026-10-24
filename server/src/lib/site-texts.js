/**
 * Textes éditables du site public (Contenu du site › Éditorial).
 *
 * Chaque page est lue section par section ; chaque texte (titre, étiquette, paragraphe, bouton, élément de liste)
 * reçoit dans le HTML une clé stable (`data-edit="home.expertises.titre"`), les listes simples `data-edit-list`
 * (on peut y ajouter, retirer et réordonner des éléments), les cartes répétées `data-edit-card` (masquables) et
 * les sections `data-edit-section` (masquables). Une clé déjà posée n'est jamais changée : réordonner ou retoucher
 * une page garde les textes saisis dans le dashboard.
 *
 * Le catalogue (`site-text-slots.json`) décrit pages, sections, champs et textes d'origine ; il est refait par
 * `node scripts/site-texts.js` après toute modification des pages (un test vérifie qu'il est à jour).
 */
const fs = require('fs');
const path = require('path');
const { parse, matches, walk, find, findAll, elements, classes, markupOf, isKept } = require('./html-scan');

const SITE_DIR = path.resolve(__dirname, '../../..');

const PAGES = [
  { id: 'home', file: 'index.html', label: 'Accueil' },
  { id: 'about', file: 'a-propos.html', label: 'À propos' },
  { id: 'projects', file: 'projets.html', label: 'Projets' },
  { id: 'lotissements', file: 'lotissements.html', label: 'Lotissements' },
  { id: 'plan', file: 'plan-interactif.html', label: 'Plan interactif' },
  { id: 'financing', file: 'financement.html', label: 'Financement' },
  { id: 'contact', file: 'contact.html', label: 'Contact' },
  { id: 'careers', file: 'carrieres.html', label: 'Carrières' },
];
const SHARED = { id: 'shared', label: 'Menu et pied de page', hint: 'Communs à toutes les pages du site.' };

// Hors sections : chargement, boutons flottants
const NOT_SECTIONS = '#loader, .whatsapp-float, .back-to-top, script, noscript, style';
// Sections réglées dans un autre onglet de Contenu du site
const MANAGED = [
  ['#hero', 'Diaporama d’accueil', 'hero'],
  ['.ticker-wrap', 'Bandeau défilant', 'ticker'],
  ['.stats-bar', 'Chiffres clés', 'stats'],
];
// Contenus construits par le site à partir des données du dashboard ou de l'ERP, ou formulaires : jamais éditables ici
const SKIP_INSIDE = 'form, .breadcrumb, .counters-grid, .stats-grid, .projects-preview-grid, .temoignages-grid, .proj-main, .sidebar-nav, '
  + '.footer-contact, .footer-social, .lots-grid, .lot-detail, .plan-app, .jobs-list, .nav-cta, .hamburger, .contact-map, svg, iframe, select, script';
// Explication affichée dans le dashboard sous la section qui contient ces blocs
const NOTES = [
  ['.counters-grid', 'Les chiffres de ce bandeau sont ceux de l’onglet « Chiffres clés ».'],
  ['.projects-preview-grid', 'Les cartes des projets reprennent le nom, le type de projet et le prix de chaque fiche projet ; leurs images se choisissent ci-dessous.'],
  ['.temoignages-grid', 'Les témoignages se gèrent dans le menu « Témoignages ».'],
  ['.proj-main', 'Les fiches des projets (textes, prix, équipements, chiffres clés) se règlent dans Projets › fiche projet.'],
  ['.lots-grid', 'Les lotissements affichés viennent des fiches projet publiées.'],
  ['.plan-app', 'Le plan vient des plans de masse publiés (Projets › plan de masse).'],
  ['.jobs-list', 'Les offres d’emploi viennent de l’ERP › RH › Recrutement.'],
  ['.footer-contact', 'Adresse, téléphones et e-mail : onglet « Coordonnées ».'],
  ['.footer-social', 'Réseaux sociaux : onglet « Coordonnées ».'],
];
// Coordonnées : réglées dans l'onglet « Coordonnées », remplacées partout par js/site-content.js
const CONTACT_VALUES = ['Cocody 2 Plateaux 7ème Tranche, Abidjan', '01 02 27 95 95', '27 22 20 50 20', '0102279595', '2722205020', 'info@siipaf'];

const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'span', 'strong', 'small', 'a', 'button', 'div', 'label', 'dt', 'dd', 'em', 'b', 'figcaption', 'blockquote', 'td', 'th']);
const INLINE = new Set(['em', 'strong', 'b', 'br', 'a']);

const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'section';

const isContact = el => {
  const links = [el, ...walk(el)].filter(e => e.tag === 'a').map(a => a.attrs.href || '');
  if (links.some(h => /^(tel:|mailto:)|wa\.me\//i.test(h))) return true;
  const text = markupOf(el);
  return CONTACT_VALUES.some(v => text.includes(v));
};

/** Champ texte ou lien porté par cet élément, ou null. */
function fieldOf(el) {
  if (!TEXT_TAGS.has(el.tag) || el.attrs.id || isKept(el) && el.tag !== 'small') return null;
  if (el.tag === 'small' && !markupOf(el)) return null;
  const descendants = [...walk(el)];
  if (el.tag === 'a' || el.tag === 'button') {
    // Bouton ou lien : texte, pictogrammes, et au plus une étiquette <span>
    const ok = descendants.every(d => isKept(d) || INLINE.has(d.tag) && d.tag !== 'a' || d.tag === 'span' && d.parent === el);
    if (!ok || !markupOf(el) || isContact(el)) return null;
    return { kind: el.tag === 'button' ? 'label' : 'link' };
  }
  const insideKept = d => { for (let p = d.parent; p && p !== el; p = p.parent) if (isKept(p)) return true; return false; };
  const ok = descendants.every(d => isKept(d) || INLINE.has(d.tag) || insideKept(d));
  if (!ok || !markupOf(el) || isContact(el)) return null;
  // Un élément qui n'enveloppe qu'un lien (<li><a>…</a></li>) : c'est le lien qui est éditable
  const direct = el.children.filter(c => c.type === 'text' ? c.text.trim() : !isKept(c));
  if (direct.length === 1 && direct[0].tag === 'a') return null;
  // Les liens à l'intérieur d'un texte ne contiennent que du texte
  if (descendants.some(d => d.tag === 'a' && [...walk(d)].some(x => !INLINE.has(x.tag) || x.tag === 'a'))) return null;
  return { kind: 'text' };
}

function fieldLabel(el, kind) {
  const cls = classes(el).join(' ');
  if (kind === 'link') return /\bbtn\b/.test(cls) ? 'Bouton' : 'Lien';
  if (kind === 'label') return 'Bouton';
  if (/(^|\s)[\w-]*(label|tag|badge)\b/.test(cls)) return 'Étiquette';
  if (/(^|\s)[\w-]*(num|number)\b/.test(cls)) return 'Numéro';
  if (/^h[1-6]$/.test(el.tag)) return 'Titre';
  if (el.tag === 'small') return 'Précision';
  if (el.tag === 'strong' || el.tag === 'b') return 'Nom';
  if (el.tag === 'dt') return 'Chiffre';
  if (el.tag === 'dd') return 'Légende';
  if (/section-sub/.test(cls)) return 'Sous-titre';
  if (/lead\b/.test(cls)) return 'Introduction';
  if (el.tag === 'p' || el.tag === 'blockquote') return 'Texte';
  return 'Texte court';
}
const fieldKind = (el, kind, value) => (kind === 'text' && (el.tag === 'p' || el.tag === 'dd' || el.tag === 'blockquote') && value.length > 70 ? 'long' : kind);

/** Champs d'un élément, sans regroupement (pour reconnaître listes et cartes). */
function collectFields(el, out = []) {
  if (matches(el, SKIP_INSIDE)) return out;
  const f = fieldOf(el);
  if (f) { out.push({ el, ...f }); findAll(el, 'small').forEach(s => collectFields(s, out)); return out; }
  elements(el).forEach(c => collectFields(c, out));
  return out;
}
const hasImage = el => matches(el, '[data-media-slot]') || !!find(el, '[data-media-slot]');

/** Éléments répétés (même balise et même première classe) : liste simple ou cartes. */
function groupOf(el, inCard) {
  const kids = elements(el).filter(k => !matches(k, SKIP_INSIDE));
  if (kids.length < 2) return null;
  const sig = k => `${k.tag}.${classes(k)[0] || ''}`;
  const counts = new Map();
  kids.forEach(k => counts.set(sig(k), (counts.get(sig(k)) || 0) + 1));
  const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (n < 2) return null;
  const members = kids.filter(k => sig(k) === best);
  const othersHaveFields = kids.some(k => sig(k) !== best && collectFields(k).length);
  const fields = members.map(m => collectFields(m));
  if (fields.some(f => !f.length)) return null;
  const single = fields.every(f => f.length === 1) && !members.some(hasImage);
  const buttons = fields.some(f => f.some(x => x.kind === 'label' || /\bbtn\b/.test(x.el.attrs.class || '')));
  if (single && !buttons && !othersHaveFields && fields.every(f => f[0].kind === fields[0][0].kind)) return { type: 'list', members, fields: fields.map(f => f[0]) };
  // Cartes : les autres enfants (en-tête de section…) restent des champs ordinaires
  if (single || inCard) return null;
  return { type: 'cards', members };
}

function sectionLabel(el, index) {
  if (matches(el, '.page-hero')) return 'Bandeau de titre';
  if (matches(el, '.plan-head')) return 'En-tête du plan';
  if (matches(el, '.plan-section')) return 'Plan';
  if (matches(el, '.counters-bar')) return 'Bandeau de chiffres';
  if (matches(el, '.mv-split')) return 'Mission et vision';
  if (el.tag === 'footer') return 'Pied de page';
  if (el.tag === 'nav') return 'Menu';
  const label = find(el, '.section-label');
  if (label && markupOf(label)) return markupOf(label).replace(/\*/g, '');
  const h = [...walk(el)].find(e => /^h[1-4]$/.test(e.tag) && markupOf(e));
  if (h) return markupOf(h).replace(/\*/g, '').replace(/\n/g, ' ');
  return `Section ${index + 1}`;
}

/** Lit une page : catalogue de ses sections et attributs `data-edit*` à ajouter. */
function scanPage(html, pageId) {
  const root = parse(html);
  const body = find(root, 'body');
  const inserts = [];
  const used = new Set([...walk(root)].flatMap(e => ['data-edit', 'data-edit-list', 'data-edit-card', 'data-edit-section'].map(a => e.attrs[a]).filter(Boolean)));
  const mark = (el, attr, value) => {
    if (attr in el.attrs) return el.attrs[attr];
    inserts.push([el.nameEnd, value == null ? ` ${attr}` : ` ${attr}="${value}"`]);
    el.attrs[attr] = value ?? '';
    return value;
  };
  const unique = (base, own) => {
    if (own) return own;
    let key = base;
    for (let i = 2; used.has(key); i++) key = `${base}-${i}`;
    used.add(key);
    return key;
  };

  function scope(key) { return { key, counts: new Map(), blocks: [], images: [], cards: 0 }; }
  function labelIn(sc, base) {
    const n = (sc.counts.get(base) || 0) + 1;
    sc.counts.set(base, n);
    return n > 1 ? `${base} ${n}` : base;
  }
  function addField(el, kind, sc) {
    const label = labelIn(sc, fieldLabel(el, kind));
    const key = mark(el, 'data-edit', unique(`${sc.key}.${slug(label)}`, el.attrs['data-edit']));
    const value = markupOf(el);
    const def = kind === 'link' ? { label: value, href: el.attrs.href || '' } : value;
    sc.blocks.push({ type: 'field', key, label, kind: fieldKind(el, kind, value), default: def });
  }
  function visit(el, sc, inCard) {
    if (matches(el, SKIP_INSIDE)) return;
    // Texte réécrit par les scripts du site (élément avec un id) ou lien de contact : rien d'éditable dedans
    if (el.attrs.id && /^(h[1-6]|p|span|a|button|label|strong|em)$/.test(el.tag)) return;
    if (el.tag === 'a' && isContact(el)) return;
    if (el.attrs['data-media-slot']) sc.images.push(el.attrs['data-media-slot']);
    const f = fieldOf(el);
    if (f) {
      addField(el, f.kind, sc);
      findAll(el, 'small').forEach(s => visit(s, sc, inCard));
      return;
    }
    const g = groupOf(el, inCard);
    if (g && g.type === 'list') {
      const label = labelIn(sc, 'Liste');
      const key = mark(el, 'data-edit-list', unique(`${sc.key}.${slug(label)}`, el.attrs['data-edit-list']));
      g.fields.forEach(x => mark(x.el, 'data-edit-li'));
      const kind = g.fields[0].kind === 'link' ? 'link' : 'text';
      sc.blocks.push({ type: 'list', key, label, kind, default: g.fields.map(x => (kind === 'link' ? { label: markupOf(x.el), href: x.el.attrs.href || '' } : markupOf(x.el))) });
      return;
    }
    if (g && g.type === 'cards') {
      elements(el).forEach(m => {
        if (!g.members.includes(m)) { visit(m, sc, inCard); return; }
        const i = sc.cards++; // numérotées dans la section, même s'il y a plusieurs groupes de cartes
        const key = mark(m, 'data-edit-card', unique(`${sc.key}.carte-${i + 1}`, m.attrs['data-edit-card']));
        const card = scope(key);
        visit(m, card, true);
        const title = card.blocks.find(b => b.type === 'field' && /^(Titre|Nom)$/.test(b.label))
          || card.blocks.find(b => b.type === 'field' && b.kind !== 'link' && !/^(Numéro|Précision)/.test(b.label));
        const link = card.blocks.find(b => b.type === 'field' && b.kind === 'link');
        const name = !title && link ? link.default.label : title ? String(title.default).replace(/\]\([^)]*\)/g, '').replace(/[*[\]]/g, '').replace(/\n/g, ' ') : '';
        sc.blocks.push({ type: 'card', key, label: `Carte ${i + 1}`, name, images: card.images, blocks: card.blocks });
      });
      return;
    }
    elements(el).forEach(c => visit(c, sc, inCard));
  }

  const sections = [];
  const shared = [];
  elements(body).forEach((el, index) => {
    if (matches(el, NOT_SECTIONS)) return;
    const managed = MANAGED.find(([sel]) => matches(el, sel));
    if (managed) { sections.push({ key: `${pageId}.${managed[2]}`, label: managed[1], managed: managed[2], blocks: [], images: [] }); return; }
    const isShared = el.tag === 'nav' || el.tag === 'footer';
    const label = sectionLabel(el, index);
    const key = mark(el, 'data-edit-section', unique(isShared ? `shared.${slug(label)}` : `${pageId}.${slug(label)}`, el.attrs['data-edit-section']));
    const sc = scope(key);
    visit(el, sc, false);
    const note = NOTES.filter(([sel]) => matches(el, sel) || find(el, sel)).map(([, n]) => n).join(' ');
    (isShared ? shared : sections).push({ key, label, ...(note ? { note } : {}), images: [...new Set(sc.images)], blocks: sc.blocks });
  });
  mark(body, 'data-edit-page', pageId);

  const title = find(root, 'title');
  const description = findAll(root, 'meta').find(m => m.attrs.name === 'description');
  const meta = { title: title ? markupOf(title) : '', description: description ? description.attrs.content || '' : '' };

  let out = html;
  for (const [at, text] of inserts.sort((a, b) => b[0] - a[0])) out = out.slice(0, at) + text + out.slice(at);
  return { html: out, sections, shared, meta };
}

/** Toutes les pages : catalogue complet et pages annotées (`changed` : fichiers dont des attributs ont été ajoutés). */
function scanSite(dir = SITE_DIR) {
  const pages = [];
  const changed = [];
  let shared = null;
  for (const p of PAGES) {
    const file = path.join(dir, p.file);
    const html = fs.readFileSync(file, 'utf8');
    const res = scanPage(html, p.id);
    if (res.html !== html) changed.push({ file, html: res.html });
    if (!shared) shared = res.shared; // menu et pied de page : ceux de l'accueil font foi
    pages.push({ id: p.id, label: p.label, path: p.file, meta: res.meta, sections: res.sections });
  }
  pages.push({ id: SHARED.id, label: SHARED.label, hint: SHARED.hint, path: null, sections: shared || [] });
  return { catalog: { pages }, changed };
}

module.exports = { scanSite, scanPage, PAGES, SITE_DIR };
