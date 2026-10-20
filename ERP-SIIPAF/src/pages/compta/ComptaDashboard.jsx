import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, TrendingUp, Scale, Users, Truck, Receipt, FileClock, RefreshCw, CheckCheck, CalendarPlus, Wallet, Smartphone, Banknote } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Skeleton, Empty, Badge } from '@admin/components/ui';
import { fcfa, date } from '@admin/lib/format';
import { useComptaMeta, amt, signed } from '../../lib/compta';
import { compact } from '../../lib/commercial';

const TREASURY_ICONS = { banque: Landmark, caisse: Banknote, mobile: Smartphone };

const Kpi = ({ icon: Icon, label, value, foot, tint, to }) => {
  const body = (
    <div className={`card kpi ${tint ? `tint-${tint}` : ''}`}>
      <span className="kpi-label"><Icon aria-hidden="true" />{label}</span>
      <span className="kpi-value">{value}</span>
      {foot && <span className="kpi-foot">{foot}</span>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
};

export default function ComptaDashboard() {
  const { can } = useAuth();
  const toast = useToast();
  const { meta } = useComptaMeta();
  const dash = useResource('/admin/erp/compta/dashboard');
  const [busy, setBusy] = useState(false);
  const d = dash.data;

  const sync = async () => {
    setBusy(true);
    try {
      const r = await api.post('/admin/erp/compta/sync');
      if (r.no_fiscal_year) toast('Créez d’abord un exercice comptable (Paramètres).', 'err');
      else toast(`${r.created} écriture(s) générée(s)${r.skipped ? ` · ${r.skipped} opération(s) hors exercice ouvert` : ''}${r.reversed ? ` · ${r.reversed} contrepassée(s)` : ''}${r.errors.length ? ` · ${r.errors.length} anomalie(s)` : ''}`);
      dash.reload();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };

  if (!d) return <div className="grid grid-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} h={110} />)}</div>;

  if (!d.fiscal_year) {
    return (
      <Card>
        <Empty icon={CalendarPlus}>
          <b>Aucun exercice comptable ne couvre la date du jour.</b>
          <p className="small muted" style={{ marginTop: 6 }}>L’exercice de départ est à fixer avec le comptable (reprise des soldes d’ouverture).</p>
          {can('compta:validate') && <Link className="btn btn-primary" style={{ marginTop: 12 }} to="/compta/parametres">Créer l’exercice</Link>}
        </Empty>
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted">Exercice {d.fiscal_year.label} · du {date(d.fiscal_year.start_date)} au {date(d.fiscal_year.end_date)} · brouillons compris</p>
        {can('compta:write') && (
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" disabled={busy} onClick={sync} title="Crée les écritures des versements, appels de fonds et ventes saisis dans le dashboard ou l’ERP"><RefreshCw />Synchroniser les ventes et versements</button>
            {d.drafts > 0 && can('compta:validate') && <Link className="btn btn-primary" to="/compta/ecritures?status=brouillon"><CheckCheck />Valider ({d.drafts})</Link>}
          </div>
        )}
      </div>
      <div className="grid grid-4">
        <Kpi icon={Wallet} label="Trésorerie" value={`${compact(d.treasury_total)} FCFA`} foot="banques, caisse, Mobile Money" tint="blue" />
        <Kpi icon={TrendingUp} label="Chiffre d’affaires" value={`${compact(d.revenue)} FCFA`} foot="ventes constatées (classe 70)" tint="green" to="/compta/etats?onglet=resultat" />
        <Kpi icon={Scale} label="Résultat provisoire" value={`${compact(d.result)} FCFA`} foot="produits − charges de l’exercice" tint={d.result >= 0 ? 'violet' : 'amber'} to="/compta/etats?onglet=resultat" />
        <Kpi icon={FileClock} label="Écritures en brouillon" value={d.drafts} foot="à contrôler puis valider" tint={d.drafts ? 'amber' : undefined} to="/compta/ecritures?status=brouillon" />
      </div>
      <div className="grid grid-4">
        <Kpi icon={Users} label="Créances clients" value={`${compact(d.receivables)} FCFA`} foot="appels de fonds et ventes non encaissés" to="/compta/etats?onglet=tiers" />
        <Kpi icon={Users} label="Avances reçues" value={`${compact(d.advances)} FCFA`} foot="versements avant constatation (4191)" to="/compta/etats?onglet=tiers" />
        <Kpi icon={Truck} label="Dettes fournisseurs" value={`${compact(d.payables)} FCFA`} foot="factures validées non réglées" to="/compta/achats" />
        <Kpi icon={Receipt} label="TVA de l’exercice" value={`${compact(d.vat_due)} FCFA`} foot={d.vat_due >= 0 ? 'collectée − récupérable' : 'crédit de TVA'} to="/compta/etats?onglet=tva" />
      </div>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Trésorerie par compte" bodyClass="">
          <ul className="list">
            {d.treasury.map(j => {
              const Icon = TREASURY_ICONS[j.kind] || Landmark;
              return (
                <li key={j.id} className="list-row">
                  <span className="row" style={{ gap: 10 }}><Icon className="ico" aria-hidden="true" /><span><b>{j.label}</b><div className="small muted">{j.code} · compte {j.account_code}</div></span></span>
                  <b className="tabular" style={{ color: j.balance < 0 ? 'var(--danger)' : undefined }}>{fcfa(j.balance)}</b>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Marge par programme (analytique)" bodyClass="">
          {!d.margins.length ? <div className="card-body"><Empty>Pas encore de produits ni de charges affectés à un programme.</Empty></div> : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Programme</th><th className="right">Produits</th><th className="right">Charges</th><th className="right">Marge</th></tr></thead>
              <tbody>
                {d.margins.map(m => (
                  <tr key={m.project_id || 0}>
                    <td className="small">{m.name}</td>
                    <td className="right tabular small">{amt(m.produits, { zero: '—' })}</td>
                    <td className="right tabular small">{amt(m.charges, { zero: '—' })}</td>
                    <td className="right tabular small"><b>{signed(m.marge)}</b>{m.taux != null && <div className="muted">{m.taux} %</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Card>
      </div>
      {meta && <p className="small muted">Chiffre d’affaires : VEFA {meta.settings.revenue_vefa === 'avancement' ? 'à l’avancement' : 'à la livraison'} · ventes sur échéancier {meta.settings.revenue_echeancier === 'acte' ? 'à l’acte définitif' : 'à l’encaissement'} · TVA sur ventes {meta.settings.vat_sales_rate} % (<Link className="link" to="/compta/parametres">réglages</Link>).</p>}
      {d.drafts > 0 && <Badge tone="warn">Les écritures automatiques sont créées en brouillon : le comptable les contrôle puis les valide (numérotation définitive).</Badge>}
    </div>
  );
}
