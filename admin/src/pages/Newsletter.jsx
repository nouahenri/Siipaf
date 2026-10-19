import { useState } from 'react';
import { Download, Newspaper, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { Card, Badge, Empty, ErrorBox, Skeleton } from '../components/ui';
import { date } from '../lib/format';

export default function Newsletter() {
  const { can } = useAuth();
  const toast = useToast();
  const subs = useResource('/admin/newsletter');
  const [q, setQ] = useState('');
  const rows = (subs.data || []).filter(s => !q || s.email.includes(q.toLowerCase()));
  const active = (subs.data || []).filter(s => s.status === 'actif').length;

  const toggle = async s => {
    const next = s.status === 'actif' ? 'desinscrit' : 'actif';
    try {
      await api.patch(`/admin/newsletter/${s.id}`, { status: next });
      subs.setData(list => list.map(x => (x.id === s.id ? { ...x, status: next } : x)));
      toast(next === 'actif' ? 'Abonné réactivé' : 'Abonné désinscrit');
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="stack">
      <div className="row-between">
        <div className="search">
          <Search aria-hidden="true" />
          <input className="input" placeholder="Rechercher un e-mail" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un abonné" />
        </div>
        <a className="btn" href="/api/admin/newsletter.csv"><Download />Exporter les {active} abonnés actifs</a>
      </div>
      <p className="small muted">L’envoi des campagnes se fera depuis le dashboard dans une prochaine étape ; en attendant, l’export CSV s’importe dans n’importe quel outil d’e-mailing.</p>
      <ErrorBox error={subs.error} />
      <Card bodyClass="">
        {subs.loading && !subs.data ? <div className="card-body"><Skeleton h={160} /></div>
          : !rows.length ? <Empty icon={Newspaper}>Aucun abonné.</Empty>
          : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>E-mail</th><th>Inscrit le</th><th>Statut</th><th /></tr></thead>
              <tbody>{rows.map(s => (
                <tr key={s.id}>
                  <td>{s.email}</td>
                  <td className="small muted">{date(s.created_at)}</td>
                  <td><Badge tone={s.status === 'actif' ? 'ok' : ''}>{s.status === 'actif' ? 'Actif' : 'Désinscrit'}</Badge></td>
                  <td className="right">{can('newsletter:write') && <button className="btn btn-sm btn-ghost" onClick={() => toggle(s)}>{s.status === 'actif' ? 'Désinscrire' : 'Réactiver'}</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </Card>
    </div>
  );
}
