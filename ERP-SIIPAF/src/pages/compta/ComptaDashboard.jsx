import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, TrendingUp, TrendingDown, Minus, Scale, Users, Truck, Receipt, FileClock, RefreshCw, CheckCheck, CalendarPlus, Wallet, Smartphone, Banknote, ArrowRight } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useToast } from '@admin/lib/app-context';
import { Card, Skeleton, Empty } from '@admin/components/ui';
import { LineChart, useCountUp, monthLabel } from '@admin/components/Charts';
import { SmoothAreaChart, GroupedBars, HighlightBars, Donut } from '@admin/components/ChartsPlus';
import { fcfa, date } from '@admin/lib/format';
import { useComptaMeta, signed } from '../../lib/compta';
import { compact } from '../../lib/commercial';
import SignedBars from '../../components/SignedBars';

// Nom court d'un programme sous les barres : « SIIPAF CITY AHOUTOUE » → « AHOUTOUE »
const shortName = n => n.replace(/^(SIIPAF CITY|MINI-CITÉS DE|C & LY —)\s+/i, '').replace(/^(.{11}).+/, '$1…');

const TREASURY_ICONS ={ banque: Landmark, caisse: Banknote, mobile: Smartphone };
const money = (v, axis) => (axis ? compact(v) : fcfa(v));
const trendOf = (now, before) => (before ? Math.round(((now - before) / Math.abs(before)) * 1000) / 10 : null);

const Trend = ({ value, label = 'par rapport au mois précédent' }) => {
  if (value == null) return null;
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return <span className={`trend ${value > 0 ? 'up' : value < 0 ? 'down' : 'flat'}`} title={label}><Icon aria-hidden="true" />{value > 0 ? '+' : ''}{value.toLocaleString('fr-FR')} %</span>;
};

/** Indicateur dont la valeur défile jusqu'au montant (animation coupée si « réduire les animations »). */
function Kpi({ icon: Icon, label, value, format = v => `${compact(v)} FCFA`, foot, trend, tint, to }) {
  const v = useCountUp(value ?? 0);
  const body = (
    <div className={`card kpi ${tint ? `tint-${tint}` : ''}`}>
      <span className="kpi-label"><Icon aria-hidden="true" />{label}</span>
      <span className="kpi-value">{value == null ? '—' : format(Math.round(v))}</span>
      {(foot || trend != null) && <span className="kpi-foot row" style={{ gap: 8 }}><Trend value={trend} />{foot}</span>}
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

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

  const s = d.series;
  const cur = s[s.length - 1], prev = s[s.length - 2] || {};
  const flows = s.reduce((t, m) => ({ in: t.in + m.encaissements, out: t.out + m.decaissements }), { in: 0, out: 0 });
  const projects = d.margins.filter(m => m.produits || m.charges).slice(0, 6);
  const vat = (d.vat_months || []).slice(-12);

  return (
    <div className="stack compta-charts">
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
        <Kpi icon={Wallet} label="Trésorerie" value={d.treasury_total} trend={trendOf(cur.tresorerie, prev.tresorerie)} foot="banques, caisse, Mobile Money" tint="blue" />
        <Kpi icon={TrendingUp} label="Chiffre d’affaires de l’exercice" value={d.revenue} foot={`${compact(cur.produits)} ce mois`} tint="green" to="/compta/etats?onglet=resultat" />
        <Kpi icon={Scale} label="Résultat provisoire" value={d.result} trend={trendOf(cur.resultat, prev.resultat)} foot="produits − charges" tint={d.result >= 0 ? 'violet' : 'amber'} to="/compta/etats?onglet=resultat" />
        <Kpi icon={FileClock} label="Écritures en brouillon" value={d.drafts} format={v => v} foot="à contrôler puis valider" tint={d.drafts ? 'amber' : undefined} to="/compta/ecritures?status=brouillon" />
      </div>

      <div className="grid grid-2">
        <Card title="Évolution de la trésorerie — 12 mois">
          <SmoothAreaChart data={s} xKey="month" valueKey="tresorerie" label="Solde de trésorerie en fin de mois" format={money} ariaLabel="Solde de trésorerie mois par mois" />
          <div className="kpi-split" style={{ marginTop: 8 }}>
            <span>Encaissé sur 12 mois <b>{compact(flows.in)}</b></span><span>Décaissé <b>{compact(flows.out)}</b></span><span>Variation <b>{signed(flows.in - flows.out)}</b></span>
          </div>
        </Card>
        <Card title="Produits et charges par mois">
          <GroupedBars data={s} labelOf={(m, long) => (long ? monthLabel(m.month) : monthLabel(m.month).split(' ')[0])} format={v => compact(v)} ariaLabel="Produits et charges par mois"
            series={[{ key: 'produits', label: 'Produits (classe 7)', color: '#1baf7a' }, { key: 'charges', label: 'Charges (classe 6)', color: '#eb6834' }]} />
        </Card>
      </div>

      <div className="grid grid-2">
        <Card title="Résultat mensuel">
          <SignedBars data={s} valueKey="resultat" label="Résultat du mois" format={money} ariaLabel="Résultat mensuel, bénéfices et pertes" />
        </Card>
        <Card title="Encaissements et décaissements">
          <LineChart data={s} xKey="month" area format={money} ariaLabel="Encaissements et décaissements de trésorerie par mois"
            series={[{ key: 'encaissements', label: 'Encaissements', color: 'var(--series-1)' }, { key: 'decaissements', label: 'Décaissements', color: '#e87ba4' }]} />
        </Card>
      </div>

      <div className="grid grid-4">
        <Kpi icon={Users} label="Créances clients" value={d.receivables} foot="appels de fonds et ventes non encaissés" to="/compta/etats?onglet=tiers" />
        <Kpi icon={Users} label="Avances reçues" value={d.advances} foot="versements avant constatation (4191)" to="/compta/etats?onglet=tiers" />
        <Kpi icon={Truck} label="Dettes fournisseurs" value={d.payables} foot="factures validées non réglées" to="/compta/achats" />
        <Kpi icon={Receipt} label="TVA de l’exercice" value={d.vat_due} foot={d.vat_due >= 0 ? 'collectée − récupérable' : 'crédit de TVA'} to="/compta/etats?onglet=tva" />
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Répartition des charges (12 mois)">
          {d.charges.length ? <Donut items={d.charges.map(c => ({ label: c.label, value: c.value }))} format={money} centerLabel="Charges" />
            : <Empty>Pas encore de charges : factures d’achat et paies apparaîtront ici.</Empty>}
        </Card>
        <Card title="Marge par programme" actions={<Link className="btn btn-sm btn-ghost" to="/compta/etats?onglet=marges">Détail <ArrowRight /></Link>}>
          {projects.length ? (
            <GroupedBars data={projects} labelOf={(p, long) => (long ? p.name : shortName(p.name))} format={v => compact(v)} ariaLabel="Produits et charges par programme"
              series={[{ key: 'produits', label: 'Produits', color: '#1baf7a' }, { key: 'charges', label: 'Charges', color: '#eb6834' }]} />
          ) : <Empty>Aucun produit ni charge affecté à un programme.</Empty>}
        </Card>
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Card title="Trésorerie par compte" bodyClass="">
          <ul className="list">
            {d.treasury.map(j => {
              const Icon = TREASURY_ICONS[j.kind] || Landmark;
              const share = d.treasury_total > 0 ? Math.max(0, j.balance) / d.treasury_total : 0;
              return (
                <li key={j.id} className="list-row" style={{ display: 'block' }}>
                  <div className="row-between">
                    <span className="row" style={{ gap: 10 }}><Icon className="ico" aria-hidden="true" /><span><b>{j.label}</b><div className="small muted">{j.code} · compte {j.account_code}</div></span></span>
                    <b className="tabular" style={{ color: j.balance < 0 ? 'var(--danger)' : undefined }}>{fcfa(j.balance)}</b>
                  </div>
                  <div className="bar-track" style={{ marginTop: 8 }}><div style={{ width: `${share * 100}%`, background: 'var(--series-1)' }} /></div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="TVA à reverser par mois">
          {vat.length ? <HighlightBars data={vat} labelOf={m => monthLabel(m.month).split(' ')[0]} valueKey="due" format={v => compact(v)} color="#eda100" />
            : <Empty>Aucune TVA sur l’exercice.</Empty>}
        </Card>
      </div>

      {meta && <p className="small muted">Chiffre d’affaires : VEFA {meta.settings.revenue_vefa === 'avancement' ? 'à l’avancement' : 'à la livraison'} · ventes sur échéancier {meta.settings.revenue_echeancier === 'acte' ? 'à l’acte définitif' : 'à l’encaissement'} · TVA sur ventes {meta.settings.vat_sales_rate} % (<Link className="link" to="/compta/parametres">réglages</Link>). Montants des graphiques en FCFA, brouillons compris.</p>}
      {d.drafts > 0 && <p className="small" style={{ color: 'var(--warn)' }}>Les écritures automatiques sont créées en brouillon : le comptable les contrôle puis les valide (numérotation définitive).</p>}
    </div>
  );
}
