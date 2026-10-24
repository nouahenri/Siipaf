import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, ImagePlus, RotateCcw, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { useResource, useSaved } from '../lib/app-context';
import { Card, Field, ErrorBox, Skeleton } from './ui';
import { MediaPicker } from './MediaLibrary';

/**
 * Contenu du site › Éditorial : textes, boutons, listes, images et sections de chaque page du site public.
 * La mise en page ne change pas : on modifie le contenu des sections existantes, on peut en masquer.
 * Le catalogue (pages, sections, champs, textes d'origine) vient des pages elles-mêmes (serveur › site-text-slots.json).
 */

// Adresse du site public : siipaf.com en production (dashboard sur admin.siipaf.com), serveur local du site sinon
const siteBase = () => (/(^|\.)siipaf\.com$/.test(location.hostname) ? 'https://siipaf.com' : `${location.protocol}//localhost:8765`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const move = (list, i, d) => { const l = [...list]; [l[i], l[i + d]] = [l[i + d], l[i]]; return l; };

const countBlocks = (blocks, texts, hidden) => blocks.reduce((n, b) => n
  + (b.type === 'card' ? countBlocks(b.blocks, texts, hidden) + (hidden.includes(b.key) ? 1 : 0) : (b.key in texts ? 1 : 0)), 0);

export default function EditorialEditor({ content, onOpenTab }) {
  const saved = useSaved();
  const catalog = useResource('/admin/content/editorial-catalog');
  const placements = useResource('/admin/media-placements');
  const [pageId, setPageId] = useState('home');
  const [value, setValue] = useState(null);
  const [images, setImages] = useState({}); // emplacement → { media, alt } choisi, null = image d'origine (enregistré avec le reste)
  const [open, setOpen] = useState({});
  const [picker, setPicker] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const stored = content.data?.editorial;
  useEffect(() => {
    if (content.data) setValue({ texts: { ...(stored?.texts || {}) }, hidden: [...(stored?.hidden || [])] });
  }, [content.data, stored]);

  const page = catalog.data?.pages.find(p => p.id === pageId);
  const dirty = value && (!same(value.texts, stored?.texts || {}) || !same([...value.hidden].sort(), [...(stored?.hidden || [])].sort()) || Object.keys(images).length > 0);

  // Avertir avant de quitter la page avec des modifications non enregistrées
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const pageStats = useMemo(() => {
    if (!catalog.data || !value) return {};
    return Object.fromEntries(catalog.data.pages.map(p => {
      let n = p.sections.reduce((m, s) => m + countBlocks(s.blocks, value.texts, value.hidden) + (value.hidden.includes(s.key) ? 1 : 0), 0);
      n += [`${p.id}.meta.title`, `${p.id}.meta.description`].filter(k => k in value.texts).length;
      return [p.id, n];
    }));
  }, [catalog.data, value]);

  if (catalog.error || placements.error) return <ErrorBox error={catalog.error || placements.error} />;
  if (!catalog.data || !placements.data || !value || !page) return <Skeleton h={300} />;

  const setText = (key, v, def) => setValue(prev => {
    const texts = { ...prev.texts };
    if (v === undefined || same(v, def)) delete texts[key]; else texts[key] = v;
    return { ...prev, texts };
  });
  const toggleHidden = key => setValue(prev => ({ ...prev, hidden: prev.hidden.includes(key) ? prev.hidden.filter(k => k !== key) : [...prev.hidden, key] }));
  const slotOf = id => placements.data.slots.find(s => s.id === id);
  const imageOf = id => (id in images ? images[id] : placements.data.assignments[id] ? { media: placements.data.assignments[id].media, alt: placements.data.assignments[id].alt } : null);
  const setImage = (id, img) => setImages(prev => {
    const next = { ...prev };
    const current = placements.data.assignments[id];
    if ((img?.media?.id || null) === (current?.media?.id || null) && (img?.alt || '') === (current?.alt || '')) delete next[id]; else next[id] = img;
    return next;
  });

  const save = async () => {
    setBusy(true); setError(null);
    try {
      for (const [slot, img] of Object.entries(images)) {
        const res = await api.put(`/admin/media-placements/${slot}`, { media_id: img?.media?.id || null, alt: img?.alt || '' });
        placements.setData(prev => ({ ...prev, assignments: { ...prev.assignments, [slot]: res } }));
      }
      setImages({});
      const res = await api.put('/admin/content/editorial', value);
      content.setData(d => ({ ...d, editorial: res }));
      saved('Textes enregistrés — visibles sur le site au prochain chargement');
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const cancel = () => { setValue({ texts: { ...(stored?.texts || {}) }, hidden: [...(stored?.hidden || [])] }); setImages({}); setError(null); };

  const isOpen = (s, i) => open[s.key] ?? i === 0;
  const ctx = { texts: value.texts, hidden: value.hidden, setText, toggleHidden, slotOf, imageOf, setImage, openPicker: setPicker };

  return (
    <div className="stack">
      <Card title="Éditorial du site">
        <div className="stack" style={{ gap: 14 }}>
          <p className="small muted">
            Modifiez le contenu de chaque section : titres, textes, boutons, listes et images. La mise en page du site ne change pas ;
            une section ou une carte peut être masquée. Un champ vidé reprend le texte d’origine.
          </p>
          <div className="form-grid">
            <Field label="Page">
              <select className="select" value={pageId} onChange={e => setPageId(e.target.value)}>
                {catalog.data.pages.map(p => <option key={p.id} value={p.id}>{p.label}{pageStats[p.id] ? ` (${pageStats[p.id]} modifié${pageStats[p.id] > 1 ? 's' : ''})` : ''}</option>)}
              </select>
            </Field>
            <div className="editorial-help small">
              <strong>Mise en forme</strong> : <code>*mot*</code> en couleur · <code>**mot**</code> en gras ·
              <code>[texte](contact.html)</code> lien · retour à la ligne conservé.
            </div>
          </div>
          <div className="row">
            {page.path
              ? <a className="btn btn-sm" href={`${siteBase()}/${page.path}`} target="_blank" rel="noopener noreferrer"><ExternalLink />Voir la page sur le site</a>
              : <span className="small muted">{page.hint}</span>}
          </div>
        </div>
      </Card>

      <ErrorBox error={error} />

      {page.meta && (
        <Card title="Référencement de la page">
          <div className="form-grid">
            <TextField ctx={ctx} block={{ key: `${page.id}.meta.title`, label: 'Titre de la page (onglet du navigateur, Google)', kind: 'text', default: page.meta.title }} max={120} />
            <TextField ctx={ctx} block={{ key: `${page.id}.meta.description`, label: 'Description (résultats de recherche)', kind: 'long', default: page.meta.description }} max={320} />
          </div>
        </Card>
      )}

      {page.sections.map((s, i) => (
        <SectionCard key={s.key} section={s} index={i} ctx={ctx} open={isOpen(s, i)} onToggle={() => setOpen(o => ({ ...o, [s.key]: !isOpen(s, i) }))} onOpenTab={onOpenTab} />
      ))}

      <div className="editorial-bar">
        <span className="small muted">{dirty ? 'Modifications non enregistrées' : 'Aucune modification en attente'}</span>
        <div className="row">
          {dirty && <button className="btn btn-ghost" disabled={busy} onClick={cancel}>Annuler</button>}
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
        </div>
      </div>

      {picker && <MediaPicker selectedId={imageOf(picker)?.media?.id} onPick={m => setImage(picker, { media: { id: m.id, original_name: m.original_name, url: m.url }, alt: imageOf(picker)?.alt || m.alt || '' })} onClose={() => setPicker(null)} />}
    </div>
  );
}

function SectionCard({ section: s, index, ctx, open, onToggle, onOpenTab }) {
  if (s.managed) {
    return (
      <Card title={`${index + 1}. ${s.label}`}>
        <div className="row-between">
          <p className="small muted">Cette section se règle dans l’onglet « {s.label} ».</p>
          <button className="btn btn-sm" onClick={() => onOpenTab(s.managed)}>Ouvrir l’onglet</button>
        </div>
      </Card>
    );
  }
  const hidden = ctx.hidden.includes(s.key);
  const changed = countBlocks(s.blocks, ctx.texts, ctx.hidden);
  return (
    // Classe fixe : l'apparition des cartes (classe « in » posée par script) ne doit pas être effacée au décochage
    <div className="card editorial-section" data-masked={hidden || undefined}>
      <div className="card-head editorial-head">
        <button type="button" className="editorial-toggle" onClick={onToggle} aria-expanded={open}>
          {open ? <ChevronDown /> : <ChevronRight />}
          <span className="card-title">{index + 1}. {s.label}</span>
          {changed > 0 && <span className="badge badge-brand">{changed} modifié{changed > 1 ? 's' : ''}</span>}
          {hidden && <span className="badge badge-warn">Masquée</span>}
        </button>
        <label className="checkbox small"><input type="checkbox" checked={!hidden} onChange={() => ctx.toggleHidden(s.key)} />Affichée sur le site</label>
      </div>
      {open && (
        <div className="card-body stack" style={{ gap: 16 }}>
          {s.note && <p className="small muted">{s.note}</p>}
          {hidden && <p className="small muted">Cette section n’apparaît plus sur le site. Ses textes restent gardés pour le jour où vous la réaffichez.</p>}
          <Images ids={s.images} ctx={ctx} />
          <Blocks blocks={s.blocks} ctx={ctx} />
          {!s.blocks.length && !s.images.length && <p className="small muted">Pas de texte à modifier dans cette section : elle peut seulement être masquée.</p>}
        </div>
      )}
    </div>
  );
}

function Blocks({ blocks, ctx }) {
  // Les champs qui se suivent sont regroupés dans une grille ; cartes et listes prennent toute la largeur
  const groups = [];
  blocks.forEach(b => {
    const solo = b.type !== 'field' || b.kind === 'long' || b.kind === 'link';
    const last = groups[groups.length - 1];
    if (!solo && last && last.grid) last.items.push(b); else groups.push({ grid: !solo, items: [b] });
  });
  return groups.map((g, i) => (g.grid
    ? <div key={i} className="form-grid">{g.items.map(b => <TextField key={b.key} ctx={ctx} block={b} />)}</div>
    : g.items.map(b => <Block key={b.key} ctx={ctx} block={b} />)));
}

function Block({ block: b, ctx }) {
  if (b.type === 'card') return <CardBlock block={b} ctx={ctx} />;
  if (b.type === 'list') return <ListField block={b} ctx={ctx} />;
  if (b.kind === 'link') return <LinkField block={b} ctx={ctx} />;
  return <TextField block={b} ctx={ctx} />;
}

function CardBlock({ block: b, ctx }) {
  const hidden = ctx.hidden.includes(b.key);
  return (
    <div className={`editorial-card${hidden ? ' is-hidden' : ''}`}>
      <div className="row-between">
        <strong className="small">{b.label}{b.name ? ` — ${b.name}` : ''}</strong>
        <label className="checkbox small"><input type="checkbox" checked={!hidden} onChange={() => ctx.toggleHidden(b.key)} />Affichée</label>
      </div>
      {!hidden && <>
        <Images ids={b.images} ctx={ctx} />
        <Blocks blocks={b.blocks} ctx={ctx} />
      </>}
    </div>
  );
}

const Restore = ({ onClick }) => (
  <button type="button" className="btn btn-ghost btn-sm editorial-restore" onClick={onClick} title="Reprendre le texte d’origine"><RotateCcw />Texte d’origine</button>
);
const FieldLabel = ({ label, changed, onRestore }) => <span className="editorial-label">{label}{changed && <Restore onClick={onRestore} />}</span>;

function TextField({ block: b, ctx, max }) {
  const changed = b.key in ctx.texts;
  const v = changed ? ctx.texts[b.key] : b.default;
  // Un champ vidé reste vide pendant la saisie ; à l'enregistrement il reprend le texte d'origine
  const set = e => ctx.setText(b.key, e.target.value, b.default);
  const long = b.kind === 'long' || String(v).length > 90 || String(v).includes('\n');
  return (
    <Field className={long ? 'full' : ''} label={<FieldLabel label={b.label} changed={changed} onRestore={() => ctx.setText(b.key, undefined)} />}>
      {long
        ? <textarea className="textarea" rows={3} value={v} maxLength={max || 3000} placeholder={b.default} onChange={set} />
        : <input className="input" value={v} maxLength={max || 400} placeholder={b.default} onChange={set} />}
    </Field>
  );
}

function LinkField({ block: b, ctx }) {
  const changed = b.key in ctx.texts;
  const v = changed ? ctx.texts[b.key] : b.default;
  const set = (k, x) => ctx.setText(b.key, { ...v, [k]: x }, b.default);
  return (
    <div className="form-grid">
      <Field label={<FieldLabel label={`${b.label} — libellé`} changed={changed} onRestore={() => ctx.setText(b.key, undefined)} />}>
        <input className="input" value={v.label} maxLength={200} placeholder={b.default.label} onChange={e => set('label', e.target.value)} />
      </Field>
      <Field label={`${b.label} — lien`} hint="Page du site (ex. contact.html), ancre (#…) ou adresse complète (https://…).">
        <input className="input" value={v.href} maxLength={500} placeholder={b.default.href} onChange={e => set('href', e.target.value)} />
      </Field>
    </div>
  );
}

function ListField({ block: b, ctx }) {
  const changed = b.key in ctx.texts;
  const items = changed ? ctx.texts[b.key] : b.default;
  const isLink = b.kind === 'link';
  const update = next => ctx.setText(b.key, next, b.default);
  const setItem = (i, x) => update(items.map((it, j) => (j === i ? x : it)));
  return (
    <div className="editorial-list">
      <div className="row-between">
        <FieldLabel label={`${b.label} (${items.length} élément${items.length > 1 ? 's' : ''})`} changed={changed} onRestore={() => ctx.setText(b.key, undefined)} />
        <button type="button" className="btn btn-sm" disabled={items.length >= 40} onClick={() => update([...items, isLink ? { label: '', href: '' } : ''])}><Plus />Ajouter</button>
      </div>
      {!items.length && <p className="small muted">Liste vide : elle n’apparaît pas sur le site.</p>}
      {items.map((it, i) => (
        <div key={i} className="editorial-list-row">
          {isLink ? <>
            <input className="input" value={it.label} maxLength={200} placeholder="Libellé" aria-label="Libellé" onChange={e => setItem(i, { ...it, label: e.target.value })} />
            <input className="input" value={it.href} maxLength={500} placeholder="Lien (ex. contact.html)" aria-label="Lien" onChange={e => setItem(i, { ...it, href: e.target.value })} />
          </> : <input className="input" value={it} maxLength={400} aria-label={`Élément ${i + 1}`} onChange={e => setItem(i, e.target.value)} />}
          <div className="nowrap">
            <button type="button" className="btn btn-sm btn-ghost btn-icon" disabled={i === 0} onClick={() => update(move(items, i, -1))} aria-label="Monter"><ArrowUp /></button>
            <button type="button" className="btn btn-sm btn-ghost btn-icon" disabled={i === items.length - 1} onClick={() => update(move(items, i, 1))} aria-label="Descendre"><ArrowDown /></button>
            <button type="button" className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={() => update(items.filter((_, j) => j !== i))} aria-label="Retirer"><Trash2 /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Images({ ids, ctx }) {
  const slots = (ids || []).map(ctx.slotOf).filter(Boolean);
  if (!slots.length) return null;
  return (
    <div className="editorial-images">
      {slots.map(slot => {
        const img = ctx.imageOf(slot.id);
        return (
          <div key={slot.id} className="editorial-image">
            <button type="button" className={`editorial-thumb${slot.page === 'shared' || /partenaire|logo/i.test(slot.section + slot.label) ? ' contain' : ''}`} onClick={() => ctx.openPicker(slot.id)} aria-label={`Changer l’image : ${slot.label}`}>
              <img src={img?.media?.url || `/api/admin/media-placements/default/${slot.id}`} alt="" loading="lazy" />
            </button>
            <div className="stack" style={{ gap: 6 }}>
              <span className="small"><strong>{slot.label}</strong></span>
              <span className="small muted">{img?.media ? img.media.original_name : 'Image d’origine'}</span>
              <div className="row">
                <button type="button" className="btn btn-sm" onClick={() => ctx.openPicker(slot.id)}><ImagePlus />{img?.media ? 'Changer' : 'Choisir'}</button>
                {img?.media && <button type="button" className="btn btn-sm btn-ghost" onClick={() => ctx.setImage(slot.id, null)}><RotateCcw />Image d’origine</button>}
              </div>
              {img?.media && <input className="input" value={img.alt || ''} maxLength={255} placeholder="Description de l’image (facultatif)" aria-label="Description de l’image" onChange={e => ctx.setImage(slot.id, { ...img, alt: e.target.value })} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
