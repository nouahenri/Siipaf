import { useEffect, useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, ImagePlus } from 'lucide-react';
import { api } from '../lib/api';
import { useResource, useToast } from '../lib/app-context';
import { Card, Field, ErrorBox, Skeleton } from '../components/ui';
import { MediaPicker } from '../components/MediaLibrary';

const TABS = [
  { id: 'hero', label: 'Diaporama d’accueil' },
  { id: 'ticker', label: 'Bandeau défilant' },
  { id: 'stats', label: 'Chiffres clés' },
  { id: 'site', label: 'Coordonnées' },
];

const DEFAULTS = {
  hero: { autoplay_ms: 5000, slides: [] },
  ticker: { items: [] },
  stats: { items: [] },
  site: { phone: '', phone2: '', email: '', address: '', whatsapp: '', socials: {} },
};

const move = (list, i, d) => { const l = [...list]; [l[i], l[i + d]] = [l[i + d], l[i]]; return l; };

export default function SiteContent() {
  const toast = useToast();
  const content = useResource('/admin/content');
  const [tab, setTab] = useState('hero');
  const [value, setValue] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (content.data) setValue(structuredClone({ ...DEFAULTS[tab], ...(content.data[tab] || {}) }));
    setError(null);
  }, [content.data, tab]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.put(`/admin/content/${tab}`, value);
      content.setData(d => ({ ...d, [tab]: saved }));
      toast('Contenu enregistré — visible sur le site au prochain chargement');
    } catch (e) { setError(e); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="tabs" role="tablist">
        {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      <ErrorBox error={error} />
      {!value ? <Skeleton h={300} /> : (
        <>
          {tab === 'hero' && <HeroEditor value={value} onChange={setValue} />}
          {tab === 'ticker' && <TickerEditor value={value} onChange={setValue} />}
          {tab === 'stats' && <StatsEditor value={value} onChange={setValue} />}
          {tab === 'site' && <SiteEditor value={value} onChange={setValue} />}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
          </div>
        </>
      )}
    </div>
  );
}

function HeroEditor({ value, onChange }) {
  const [picker, setPicker] = useState(null);
  const slides = value.slides;
  const setSlide = (i, k, v) => onChange({ ...value, slides: slides.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  const add = () => onChange({ ...value, slides: [...slides, { media_id: null, badge: '', title: '', title_em: '', text: '', cta_label: 'Découvrir', cta_href: 'projets.html', active: true }] });

  return (
    <Card title="Diapositives" actions={<button className="btn btn-sm" onClick={add} disabled={slides.length >= 12}><Plus />Ajouter</button>}>
      <div className="stack" style={{ gap: 14 }}>
        <Field label="Durée d’affichage de chaque diapositive (secondes)">
          <input className="input" style={{ maxWidth: 120 }} type="number" min="2" max="20" value={value.autoplay_ms / 1000} onChange={e => onChange({ ...value, autoplay_ms: Math.round(Number(e.target.value) * 1000) || 5000 })} />
        </Field>
        {!slides.length && <p className="muted">Aucune diapositive : le site garde ses diapositives actuelles.</p>}
        {slides.map((s, i) => (
          <div key={i} className="slide-row" style={{ opacity: s.active ? 1 : .6 }}>
            <button type="button" className="slide-thumb" style={{ backgroundImage: s.media_id ? `url(/uploads/by-id/${s.media_id})` : undefined }} onClick={() => setPicker(i)} aria-label="Choisir l’image">
              {!s.media_id && <ImagePlus />}
            </button>
            <div className="form-grid">
              <Field label="Badge"><input className="input" value={s.badge || ''} onChange={e => setSlide(i, 'badge', e.target.value)} placeholder="Logement social & haut standing" /></Field>
              <Field label="Titre"><input className="input" value={s.title} onChange={e => setSlide(i, 'title', e.target.value)} /></Field>
              <Field label="Titre (partie en couleur)"><input className="input" value={s.title_em || ''} onChange={e => setSlide(i, 'title_em', e.target.value)} /></Field>
              <Field label="Texte"><input className="input" value={s.text || ''} onChange={e => setSlide(i, 'text', e.target.value)} /></Field>
              <Field label="Bouton principal"><input className="input" value={s.cta_label || ''} onChange={e => setSlide(i, 'cta_label', e.target.value)} /></Field>
              <Field label="Lien du bouton"><input className="input" value={s.cta_href || ''} onChange={e => setSlide(i, 'cta_href', e.target.value)} /></Field>
              <Field label="Second bouton"><input className="input" value={s.cta2_label || ''} onChange={e => setSlide(i, 'cta2_label', e.target.value)} /></Field>
              <Field label="Lien du second bouton"><input className="input" value={s.cta2_href || ''} onChange={e => setSlide(i, 'cta2_href', e.target.value)} /></Field>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <label className="checkbox small"><input type="checkbox" checked={s.active} onChange={e => setSlide(i, 'active', e.target.checked)} />Active</label>
              <button className="btn btn-sm btn-ghost btn-icon" disabled={i === 0} onClick={() => onChange({ ...value, slides: move(slides, i, -1) })} aria-label="Monter"><ArrowUp /></button>
              <button className="btn btn-sm btn-ghost btn-icon" disabled={i === slides.length - 1} onClick={() => onChange({ ...value, slides: move(slides, i, 1) })} aria-label="Descendre"><ArrowDown /></button>
              <button className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={() => onChange({ ...value, slides: slides.filter((_, j) => j !== i) })} aria-label="Supprimer"><Trash2 /></button>
            </div>
          </div>
        ))}
      </div>
      {picker != null && <MediaPicker selectedId={slides[picker]?.media_id} onPick={m => setSlide(picker, 'media_id', m.id)} onClose={() => setPicker(null)} />}
    </Card>
  );
}

function ListEditor({ title, items, onChange, columns, blank }) {
  const set = (i, k, v) => onChange(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  return (
    <Card title={title} actions={<button className="btn btn-sm" onClick={() => onChange([...items, { ...blank }])}><Plus />Ajouter</button>} bodyClass="">
      <div className="table-wrap"><table className="table">
        <thead><tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}<th /></tr></thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              {columns.map(c => (
                <td key={c.key} style={{ minWidth: c.width || 140 }}>
                  <input className="input" type={c.type || 'text'} value={it[c.key] ?? ''} aria-label={c.label}
                    onChange={e => set(i, c.key, c.type === 'number' ? Number(e.target.value) : e.target.value)} />
                </td>
              ))}
              <td className="nowrap">
                <button className="btn btn-sm btn-ghost btn-icon" disabled={i === 0} onClick={() => onChange(move(items, i, -1))} aria-label="Monter"><ArrowUp /></button>
                <button className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Supprimer"><Trash2 /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </Card>
  );
}

const TickerEditor = ({ value, onChange }) => (
  <ListEditor title="Messages du bandeau" items={value.items} onChange={items => onChange({ ...value, items })} blank={{ text: '', href: '' }}
    columns={[{ key: 'text', label: 'Texte', width: 360 }, { key: 'href', label: 'Lien (facultatif)', width: 220 }]} />
);

const StatsEditor = ({ value, onChange }) => (
  <ListEditor title="Chiffres affichés sur l’accueil" items={value.items} onChange={items => onChange({ ...value, items })} blank={{ value: 0, unit: '', label: '' }}
    columns={[{ key: 'value', label: 'Valeur', type: 'number', width: 100 }, { key: 'unit', label: 'Unité', width: 100 }, { key: 'label', label: 'Libellé', width: 260 }]} />
);

function SiteEditor({ value, onChange }) {
  const set = k => e => onChange({ ...value, [k]: e.target.value });
  const setSocial = k => e => onChange({ ...value, socials: { ...(value.socials || {}), [k]: e.target.value } });
  return (
    <Card title="Coordonnées et réseaux sociaux">
      <div className="form-grid">
        <Field label="Téléphone principal"><input className="input" value={value.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Téléphone secondaire"><input className="input" value={value.phone2 || ''} onChange={set('phone2')} /></Field>
        <Field label="E-mail"><input className="input" type="email" value={value.email || ''} onChange={set('email')} /></Field>
        <Field label="WhatsApp" hint="Numéro international sans espace, ex. 2250102279595"><input className="input" value={value.whatsapp || ''} onChange={set('whatsapp')} /></Field>
        <Field label="Adresse" className="full"><input className="input" value={value.address || ''} onChange={set('address')} /></Field>
        {['facebook', 'instagram', 'linkedin', 'tiktok', 'youtube'].map(k => (
          <Field key={k} label={k[0].toUpperCase() + k.slice(1)}><input className="input" value={value.socials?.[k] || ''} onChange={setSocial(k)} placeholder="https://" /></Field>
        ))}
      </div>
    </Card>
  );
}
