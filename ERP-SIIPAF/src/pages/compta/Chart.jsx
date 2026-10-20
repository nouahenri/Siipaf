import { useEffect, useState } from 'react';
import { Plus, Search, Pencil } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Skeleton, Empty, Modal, Field, ErrorBox, Badge } from '@admin/components/ui';

const CLASSES = { 1: 'Ressources durables', 2: 'Actif immobilisé', 3: 'Stocks', 4: 'Tiers', 5: 'Trésorerie', 6: 'Charges', 7: 'Produits', 8: 'Hors activités ordinaires', 9: 'Analytique' };
const PARTNER = { client: 'Suivi par client', fournisseur: 'Suivi par fournisseur', employe: 'Suivi par salarié' };

/** Plan comptable SYSCOHADA révisé (comptes livrés et sous-comptes créés par le comptable). */
export default function Chart() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cls, setCls] = useState('');
  const [edit, setEdit] = useState(null);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const list = useResource(`/admin/erp/compta/accounts?${new URLSearchParams(Object.entries({ q: debounced, class: cls }).filter(([, v]) => v))}`);
  const rows = list.data || [];

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <label className="search"><Search aria-hidden="true" /><input className="input" type="search" placeholder="Numéro ou intitulé" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un compte" /></label>
          <select className="select" style={{ width: 'auto' }} value={cls} onChange={e => setCls(e.target.value)} aria-label="Classe">
            <option value="">Toutes les classes</option>
            {Object.entries(CLASSES).map(([k, v]) => <option key={k} value={k}>Classe {k} — {v}</option>)}
          </select>
        </div>
        {can('compta:validate') && <button className="btn btn-primary" onClick={() => setEdit({})}><Plus />Sous-compte</button>}
      </div>
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={300} /></div> : !rows.length ? <div className="card-body"><Empty>Aucun compte.</Empty></div> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Numéro</th><th>Intitulé</th><th>Suivi</th><th /></tr></thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id} style={{ opacity: a.active ? 1 : 0.5 }}>
                  <td className="tabular" style={{ paddingLeft: 16 + Math.max(0, a.code.length - 2) * 10 }}><b>{a.code}</b></td>
                  <td className={a.code.length <= 2 ? '' : 'small'}>{a.code.length <= 2 ? <b>{a.label}</b> : a.label}{!a.system && <Badge> SIIPAF</Badge>}{!a.active && <Badge> Inactif</Badge>}</td>
                  <td className="small muted">{PARTNER[a.partner_kind] || ''}</td>
                  <td>{can('compta:validate') && <button className="btn btn-sm btn-ghost btn-icon" onClick={() => setEdit(a)} aria-label={`Modifier ${a.code}`}><Pencil /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
      <p className="small muted">Plan livré : comptes principaux du SYSCOHADA révisé et sous-comptes utiles à un promoteur et aménageur (programmes en cours, logements et terrains achevés, ventes de logements et de terrains). À compléter et valider par le comptable.</p>
      {edit && <AccountForm account={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}

function AccountForm({ account, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ code: account.code || '', label: account.label || '', active: account.active ?? true });
  const [error, setError] = useState(null);
  const save = async e => {
    e.preventDefault(); setError(null);
    try {
      if (account.id) await api.patch(`/admin/erp/compta/accounts/${account.id}`, { label: f.label, active: f.active });
      else await api.post('/admin/erp/compta/accounts', { code: f.code, label: f.label });
      toast('Compte enregistré'); onSaved();
    } catch (err) { setError(err); }
  };
  return (
    <Modal title={account.id ? `Compte ${account.code}` : 'Nouveau sous-compte'} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="acc-form">Enregistrer</button></>}>
      <form id="acc-form" className="stack" style={{ gap: 12 }} onSubmit={save}>
        <ErrorBox error={error} />
        <Field label="Numéro" hint="Il prolonge un compte existant : ex. 521200 pour une deuxième banque, 621300 pour un corps d’état"><input className="input tabular" required disabled={!!account.id} value={f.code} onChange={e => setF(x => ({ ...x, code: e.target.value.trim() }))} autoFocus={!account.id} /></Field>
        <Field label="Intitulé"><input className="input" required minLength={2} maxLength={160} value={f.label} onChange={e => setF(x => ({ ...x, label: e.target.value }))} /></Field>
        {account.id && <label className="checkbox"><input type="checkbox" checked={f.active} onChange={e => setF(x => ({ ...x, active: e.target.checked }))} />Compte utilisable en saisie</label>}
      </form>
    </Modal>
  );
}
