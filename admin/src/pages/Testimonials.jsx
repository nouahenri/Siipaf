import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Check, X, Star, Pencil, Trash2, Plus, MessageSquareQuote, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { useResource, useToast, useSaved } from '../lib/app-context';
import { Card, Drawer, Field, Badge, Empty, ErrorBox, Skeleton } from '../components/ui';
import { initials, relative, date } from '../lib/format';

const TABS = [
  { id: 'en_attente', label: 'À valider' },
  { id: 'publie', label: 'Publiés' },
  { id: 'refuse', label: 'Refusés' },
];
const AVATAR_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#a16207', '#6d28d9', '#9f1239'];
const colorOf = name => AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];

const Stars = ({ n }) => (
  <span className="stars" aria-label={`${n} sur 5`}>
    {[1, 2, 3, 4, 5].map(i => <Star key={i} size={14} fill={i <= n ? 'currentColor' : 'none'} className={i <= n ? 'on' : ''} aria-hidden="true" />)}
  </span>
);

export default function Testimonials() {
  const toast = useToast();
  const { stats } = useOutletContext(); // pastille « à valider » du menu
  const [tab, setTab] = useState('en_attente');
  const [edit, setEdit] = useState(null);
  const list = useResource(`/admin/testimonials?status=${tab}`);
  const projects = useResource('/admin/projects');
  const counts = list.data?.counts || {};

  const patch = async (t, body, msg) => {
    try {
      await api.patch(`/admin/testimonials/${t.id}`, body);
      toast(msg);
      list.reload();
      stats.reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const remove = async t => {
    if (!window.confirm(`Supprimer définitivement le témoignage de ${t.name} ?`)) return;
    try { await api.del(`/admin/testimonials/${t.id}`); toast('Témoignage supprimé'); list.reload(); stats.reload(); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="stack">
      <div className="row-between">
        <div className="tabs" role="tablist" style={{ marginBottom: 0, borderBottom: 'none' }}>
          {TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}{counts[t.id] ? <span className="tab-count">{counts[t.id]}</span> : null}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => setEdit({})}><Plus />Ajouter un témoignage</button>
      </div>
      <p className="small muted">
        Les témoignages déposés sur le site arrivent dans « À valider » et ne sont visibles qu’une fois publiés.
        Un témoignage « mis en avant » apparaît en premier sur la page d’accueil.
      </p>
      <ErrorBox error={list.error} />

      {list.loading && !list.data ? <Skeleton h={200} />
        : !list.data?.rows.length ? <Card><Empty icon={MessageSquareQuote}>{tab === 'en_attente' ? 'Aucun témoignage en attente de validation.' : 'Aucun témoignage.'}</Empty></Card>
        : (
          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            {list.data.rows.map(t => (
              <Card key={t.id} bodyClass="card-body stack" style={t.featured ? { borderColor: 'var(--gold)' } : undefined}>
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div className="who">
                    <span className="mini-avatar" style={{ background: colorOf(t.name) }} aria-hidden="true">{initials(t.name)}</span>
                    <div style={{ minWidth: 0 }}>
                      <strong>{t.name}</strong>
                      <div className="small muted">{[t.role_label, t.project_name].filter(Boolean).join(' · ') || '—'}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Stars n={t.rating} />
                    <div className="small muted">{relative(t.created_at)}</div>
                  </div>
                </div>
                <p style={{ whiteSpace: 'pre-wrap' }}>« {t.message} »</p>
                <div className="row small muted" style={{ gap: 8 }}>
                  <Badge tone={t.source === 'site' ? '' : 'brand'}>{t.source === 'site' ? 'Déposé sur le site' : 'Saisi en interne'}</Badge>
                  {t.featured && <Badge tone="warn"><Star size={12} fill="currentColor" />Mis en avant</Badge>}
                  {t.email && <span title="Non affiché sur le site">{t.email}</span>}
                  {t.moderated_by_name && <span>· {tab === 'refuse' ? 'refusé' : 'validé'} par {t.moderated_by_name} le {date(t.moderated_at)}</span>}
                </div>
                <div className="row" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  {tab !== 'publie' && <button className="btn btn-sm btn-primary" onClick={() => patch(t, { status: 'publie' }, 'Témoignage publié sur le site')}><Check />Publier</button>}
                  {tab === 'en_attente' && <button className="btn btn-sm" onClick={() => patch(t, { status: 'refuse' }, 'Témoignage refusé')}><X />Refuser</button>}
                  {tab === 'publie' && (
                    <>
                      <button className="btn btn-sm" onClick={() => patch(t, { featured: !t.featured }, t.featured ? 'Retiré de la mise en avant' : 'Mis en avant sur l’accueil')}><Star />{t.featured ? 'Ne plus mettre en avant' : 'Mettre en avant'}</button>
                      <button className="btn btn-sm" onClick={() => patch(t, { status: 'en_attente' }, 'Témoignage retiré du site')}><Undo2 />Retirer du site</button>
                    </>
                  )}
                  <div style={{ flex: 1 }} />
                  <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setEdit(t)} aria-label="Modifier"><Pencil /></button>
                  <button className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={() => remove(t)} aria-label="Supprimer"><Trash2 /></button>
                </div>
              </Card>
            ))}
          </div>
        )}

      {edit && <EditDrawer t={edit} projects={projects.data || []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}

function EditDrawer({ t, projects, onClose, onSaved }) {
  const toast = useToast();
  const saved = useSaved();
  const isNew = !t.id;
  const [f, setF] = useState({ name: t.name || '', role_label: t.role_label || '', project_id: t.project_id || '', rating: t.rating || 5, message: t.message || '' });
  const [error, setError] = useState(null);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    setError(null);
    const body = { ...f, role_label: f.role_label || null, project_id: f.project_id ? Number(f.project_id) : null, rating: Number(f.rating) };
    try {
      if (isNew) await api.post('/admin/testimonials', body);
      else await api.patch(`/admin/testimonials/${t.id}`, body);
      saved(isNew ? 'Témoignage ajouté et publié' : 'Témoignage modifié');
      onSaved();
    } catch (e) { setError(e); }
  };

  return (
    <Drawer title={isNew ? 'Ajouter un témoignage' : `Témoignage de ${t.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}>Enregistrer</button></>}>
      {isNew && <p className="small muted">Pour un témoignage recueilli par téléphone ou en agence, avec l’accord du client. Il est publié directement.</p>}
      <ErrorBox error={error} />
      <div className="form-grid">
        <Field label="Nom affiché" hint="Ex. : Kouamé A. (initiale du nom pour la discrétion)"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Profil" hint="Ex. : Diaspora France, Cadre supérieur"><input className="input" value={f.role_label} onChange={set('role_label')} /></Field>
        <Field label="Projet concerné">
          <select className="select" value={f.project_id} onChange={set('project_id')}>
            <option value="">Aucun</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Note">
          <select className="select" value={f.rating} onChange={set('rating')}>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{'★'.repeat(n)} ({n}/5)</option>)}</select>
        </Field>
        <Field label="Témoignage" className="full" hint={`${f.message.length}/1000 caractères — 20 minimum`}><textarea className="textarea" style={{ minHeight: 160 }} maxLength={1000} value={f.message} onChange={set('message')} /></Field>
      </div>
    </Drawer>
  );
}
