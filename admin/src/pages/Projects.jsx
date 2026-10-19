import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Building2, MapPin, EyeOff } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { Modal, Field, Empty, ErrorBox, Skeleton, Badge } from '../components/ui';
import { LOT_STATUSES } from '../lib/domain';

export default function Projects() {
  const { can } = useAuth();
  const projects = useResource('/admin/projects');
  const [creating, setCreating] = useState(false);

  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted">Les projets publiés apparaissent sur le site, avec leur grille de prix et leur plan de masse.</p>
        {can('projects:write') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Nouveau projet</button>}
      </div>
      <ErrorBox error={projects.error} />
      {projects.loading && !projects.data ? <Skeleton h={200} />
        : !projects.data?.length ? <Empty icon={Building2}>Aucun projet.</Empty>
        : (
          <div className="grid grid-3">
            {projects.data.map(p => {
              const total = Object.values(p.lots).reduce((a, b) => a + b, 0);
              return (
                <Link key={p.id} to={`/projets/${p.id}`} className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ aspectRatio: '16 / 8', background: p.cover_media_id ? `var(--bg) url(/uploads/by-id/${p.cover_media_id}) center / cover` : 'var(--bg)', display: 'grid', placeItems: 'center', color: 'var(--ink-3)' }}>
                    {!p.cover_media_id && <Building2 aria-hidden="true" />}
                  </div>
                  <div className="card-body stack" style={{ gap: 10, flex: 1 }}>
                    <div className="row-between">
                      <strong>{p.name}</strong>
                      {!p.published && <Badge><EyeOff size={13} />Masqué</Badge>}
                    </div>
                    <div className="small muted row" style={{ gap: 6 }}><MapPin size={14} aria-hidden="true" />{p.city || '—'}</div>
                    {total > 0 ? (
                      <>
                        <div className="dist-bar" style={{ height: 8 }}>
                          {LOT_STATUSES.filter(s => p.lots[s.id]).map(s => <div key={s.id} style={{ flex: p.lots[s.id], background: s.color }} title={`${s.label} : ${p.lots[s.id]}`} />)}
                        </div>
                        <span className="small muted tabular">{p.lots.disponible || 0} disponibles sur {total} lots</span>
                      </>
                    ) : <span className="small muted">Plan de masse non saisi</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      {creating && <CreateProject onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateProject({ onClose }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState(null);
  const auto = v => v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const submit = async () => {
    try {
      const p = await api.post('/admin/projects', { name, slug: slug || auto(name), published: false });
      toast('Projet créé (masqué tant qu’il n’est pas publié)');
      navigate(`/projets/${p.id}`);
    } catch (e) { setError(e); }
  };
  return (
    <Modal title="Nouveau projet" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" disabled={!name} onClick={submit}>Créer</button></>}>
      <ErrorBox error={error} />
      <Field label="Nom du projet"><input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus /></Field>
      <Field label="Identifiant dans l’adresse" hint={`Exemple : projets.html#${slug || auto(name) || 'mon-projet'}`}>
        <input className="input" value={slug} placeholder={auto(name)} onChange={e => setSlug(auto(e.target.value))} />
      </Field>
    </Modal>
  );
}
