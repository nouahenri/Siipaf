/**
 * Lecture des pages du site public (HTML écrit par nous, bien formé) : arbre des éléments avec leur
 * position dans le texte source, pour repérer les textes éditables (Contenu du site › Éditorial)
 * et ajouter leurs attributs `data-edit*` sans toucher au reste du fichier.
 */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', euro: '€' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e.toLowerCase()] ?? m;
});

function parseAttrs(raw) {
  const attrs = {};
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(raw))) attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return attrs;
}

/** Arbre : { type: 'el', tag, attrs, start, nameEnd, openEnd, closeStart, end, children, parent } ou { type: 'text', text }. */
function parse(html) {
  const root = { type: 'el', tag: '#root', attrs: {}, children: [], start: 0, openEnd: 0 };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z0-9-]+)\s*>|<([a-z0-9-]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let last = 0;
  let m;
  const pushText = (from, to) => {
    if (to > from) stack[stack.length - 1].children.push({ type: 'text', text: decode(html.slice(from, to)), start: from, end: to });
  };
  while ((m = re.exec(html))) {
    pushText(last, m.index);
    last = re.lastIndex;
    if (m[1]) { // fermeture : on dépile jusqu'à l'élément correspondant
      const tag = m[1].toLowerCase();
      const at = stack.map(n => n.tag).lastIndexOf(tag);
      if (at > 0) {
        for (let i = stack.length - 1; i >= at; i--) { stack[i].closeStart = stack[i].closeStart ?? m.index; stack[i].end = re.lastIndex; }
        stack.length = at;
      }
      continue;
    }
    if (!m[2]) continue; // commentaire ou doctype
    const tag = m[2].toLowerCase();
    const raw = m[3] || '';
    const el = { type: 'el', tag, attrs: parseAttrs(raw.replace(/\/\s*$/, '')), start: m.index, nameEnd: m.index + 1 + m[2].length, openEnd: re.lastIndex, children: [], parent: stack[stack.length - 1] };
    el.parent.children.push(el);
    if (VOID.has(tag) || /\/\s*$/.test(raw)) { el.closeStart = el.end = re.lastIndex; continue; }
    if (RAW.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      const stop = close === -1 ? html.length : close;
      el.children.push({ type: 'text', text: html.slice(re.lastIndex, stop), raw: true });
      el.closeStart = stop;
      el.end = html.indexOf('>', stop) + 1 || html.length;
      re.lastIndex = last = el.end;
      continue;
    }
    stack.push(el);
  }
  pushText(last, html.length);
  return root;
}

const classes = el => (el.attrs.class || '').split(/\s+/).filter(Boolean);
const elements = el => el.children.filter(c => c.type === 'el');

/** Sélecteur simple : `tag`, `.classe`, `#id`, `tag.classe`, `[attribut]`, combinés sans espace. */
function matches(el, selector) {
  if (el.type !== 'el') return false;
  return selector.split(',').some(sel => {
    const parts = sel.trim().match(/^([a-z0-9-]*)((?:[.#][\w-]+|\[[\w-]+\])*)$/i);
    if (!parts) return false;
    if (parts[1] && parts[1].toLowerCase() !== el.tag) return false;
    return (parts[2].match(/[.#][\w-]+|\[[\w-]+\]/g) || []).every(p => {
      if (p[0] === '.') return classes(el).includes(p.slice(1));
      if (p[0] === '#') return el.attrs.id === p.slice(1);
      return p.slice(1, -1) in el.attrs;
    });
  });
}

function* walk(el) {
  for (const c of el.children) {
    if (c.type !== 'el') continue;
    yield c;
    yield* walk(c);
  }
}
const find = (el, selector) => { for (const c of walk(el)) if (matches(c, selector)) return c; return null; };
const findAll = (el, selector) => [...walk(el)].filter(c => matches(c, selector));

/** Texte visible d'un élément (espaces regroupés). */
function textOf(el) {
  if (el.type === 'text') return el.raw ? '' : el.text;
  if (el.tag === 'br') return BR;
  return el.children.map(textOf).join('');
}
// Les retours à la ligne voulus (<br>) passent par un caractère à part : ceux du code source ne sont que des espaces.
const BR = String.fromCharCode(0x2028);
const BR_AROUND = new RegExp(` *${BR} *`, 'g');
const clean = s => s.replace(/[ \t\r\n\f]+/g, ' ').replace(BR_AROUND, '\n').trim();

const isIcon = el => el.type === 'el' && el.tag === 'i' && /\bfa[a-z]?\b|\bfa-/.test(el.attrs.class || '');
/** Enfants gardés tels quels quand le texte d'un élément change : pictogrammes et précisions en petit (<small>, éditables à part). */
const isKept = el => isIcon(el) || (el.type === 'el' && el.tag === 'small');

/**
 * Valeur éditable d'un élément, dans la petite syntaxe de l'éditeur : *mot* = partie en couleur (em),
 * **mot** = gras, [texte](lien) = lien, retour à la ligne = <br>. Les pictogrammes sont laissés de côté.
 */
function markupOf(el) {
  const out = el.children.map(c => {
    if (c.type === 'text') return c.raw ? '' : c.text.replace(/[*[\]]/g, '');
    if (isKept(c)) return '';
    if (c.tag === 'br') return BR;
    if (c.tag === 'em') return `*${clean(markupOf(c))}*`;
    if (c.tag === 'strong' || c.tag === 'b') return `**${clean(markupOf(c))}**`;
    if (c.tag === 'a') return `[${clean(markupOf(c))}](${c.attrs.href || ''})`;
    return markupOf(c);
  }).join('');
  return clean(out);
}

module.exports = { parse, matches, walk, find, findAll, elements, classes, textOf, clean, markupOf, isIcon, isKept, decode };
