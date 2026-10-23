/**
 * Juridique › Ventes et actes : chaque dossier de vente en cours, de la réservation à l'expédition de l'acte
 * (six étapes, choix du client du 23/10). Filtre par étape en cours ; la fiche date les étapes.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Stamp } from 'lucide-react';
import { qs } from '@admin/lib/api';
import { useResource } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Drawer, Badge } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import DeedSteps from '../../components/DeedSteps';
import { JUR } from '../../lib/juridique';

/** Petite frise : une barre par étape franchie. */
export const DeedMini = ({ steps }) => <span className="deed-mini" aria-hidden="true">{steps.map(s => <i key={s.key} className={s.date ? 'on' : ''} />)}</span>;

export default function Actes() {
  const [params, setParams] = useSearchParams();
  const [step, setStep] = useState('');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const refs = useResource(`${JUR}/refs`);
  const list = useResource(`${JUR}/actes${qs({ step, q })}`);
  const open = Number(params.get('fiche')) || null;
  const setOpen = id => setParams(id ? { fiche: String(id) } : {}, { replace: true });
  useEffect(() => { const t = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(t); }, [text]);
  const notaries = refs.data ? [...refs.data.suppliers].sort((a, b) => (a.kind === 'notaire' ? 0 : 1) - (b.kind === 'notaire' ? 0 : 1)) : null;

  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <select className="select" style={{ width: 'auto' }} value={step} onChange={e => setStep(e.target.value)} aria-label="Étape en cours">
          <option value="">Toutes les étapes</option>
          {refs.data?.steps.map(s => <option key={s.key} value={s.key}>À faire : {s.label.toLowerCase()}</option>)}
          <option value="termine">Dossiers terminés</option>
        </select>
        <label style={{ position: 'relative' }}>
          <Search aria-hidden="true" style={{ position: 'absolute', left: 10, top: 10, width: 16, height: 16, opacity: 0.5 }} />
          <input className="input" style={{ paddingLeft: 32, width: 240 }} type="search" placeholder="Client, programme, lot, notaire…" value={text} onChange={e => setText(e.target.value)} aria-label="Rechercher" />
        </label>
      </div>

      <Card bodyClass="">
        <ErrorBox error={list.error} />
        {!list.data ? <div className="card-body"><Skeleton h={220} /></div> : !list.data.length ? (
          <div className="card-body"><Empty icon={Stamp}>Aucun dossier de vente.</Empty></div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Client</th><th>Bien</th><th>Commercial</th><th>Avancement</th><th>Étape à faire</th><th>Notaire</th></tr></thead>
            <tbody>{list.data.map(d => (
              <tr key={d.sale_id} className="clickable" onClick={() => setOpen(d.sale_id)}>
                <td>{d.client_name}<div className="small muted tabular">{d.client_code || ''}</div></td>
                <td>{d.project_name}<div className="small muted">lot {d.lot_code} · réservé le {date(d.reserved_at)}</div></td>
                <td className="small">{d.commercial_name || '—'}</td>
                <td className="nowrap"><DeedMini steps={d.steps} /> <span className="small muted">{d.done}/6</span></td>
                <td>{d.current ? d.current_label : <Badge tone="ok">Terminé</Badge>}</td>
                <td className="small">{d.notary_name || '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      {open && <DeedDrawer saleId={open} notaries={notaries} onClose={() => setOpen(null)} onChange={() => list.reload()} />}
    </div>
  );
}

function DeedDrawer({ saleId, notaries, onClose, onChange }) {
  const x = useResource(`${JUR}/actes/${saleId}`);
  const d = x.data;
  return (
    <Drawer title={d ? `${d.client_name} · lot ${d.lot_code}` : 'Dossier de vente'} onClose={onClose}>
      {x.error ? <ErrorBox error={x.error} /> : !d ? <Skeleton h={300} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Badge>{d.lot_status_label}</Badge>
            {d.status === 'solde' && <Badge tone="ok">Soldé</Badge>}
            {d.vefa && <Badge tone="brand">VEFA</Badge>}
          </div>
          <div>
            <div className="kv"><span>Programme</span><b>{d.project_name}{d.ilot ? ` · îlot ${d.ilot}` : ''} · lot {d.lot_code}</b></div>
            <div className="kv"><span>Client</span><b>{d.client_name}{d.client_code ? ` · ${d.client_code}` : ''}</b></div>
            {(d.client_phone || d.client_email) && <div className="kv"><span>Contact</span><b>{[d.client_phone, d.client_email].filter(Boolean).join(' · ')}</b></div>}
            <div className="kv"><span>Prix convenu</span><b>{fcfa(d.price_fcfa)}</b></div>
            <div className="kv"><span>Commercial</span><b>{d.commercial_name || '—'}</b></div>
          </div>
          <div className="erp-panel">
            <b style={{ display: 'block', marginBottom: 10 }}>Circuit jusqu’à l’acte</b>
            <DeedSteps saleId={saleId} notaries={notaries} onChange={() => { x.reload(); onChange(); }} />
          </div>
          {d.litigations.length > 0 && (
            <div className="erp-panel">
              <b>Litiges liés</b>
              {d.litigations.map(l => <div key={l.id} className="kv"><span><Link to={`/juridique/litiges?fiche=${l.id}`}>{l.reference}</Link> — {l.title}</span><b>{l.status === 'clos' ? 'Clos' : l.stage_label}</b></div>)}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
