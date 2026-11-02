/**
 * Bons de commande soumis par les Achats, à valider par ce compte (validateur désigné sous le plafond, Direction à
 * partir du plafond) : vus et décidés depuis Administration générale › Demandes internes (demande du client du 29/10),
 * en plus de l'écran Achats › Bons de commande. Même règle côté serveur (l'émetteur ne valide pas sa propre commande).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, ShoppingCart, ExternalLink } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Drawer, Badge, Field } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';

const URL = '/admin/erp/demandes/commandes';

export default function OrdersToValidate({ onChange }) {
  const list = useResource(URL);
  const [open, setOpen] = useState(null);
  const rows = list.data || [];
  return (
    <Card bodyClass="">
      <ErrorBox error={list.error} />
      {!list.data ? <div className="card-body"><Skeleton h={200} /></div> : !rows.length ? (
        <div className="card-body"><Empty icon={ShoppingCart}>Aucun bon de commande à valider. Les Achats les soumettent depuis Achats › Bons de commande.</Empty></div>
      ) : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Bon de commande</th><th>Fournisseur</th><th>Émis par</th><th className="right">Montant TTC</th><th>Validation</th></tr></thead>
          <tbody>{rows.map(o => (
            <tr key={o.id} className="clickable" onClick={() => setOpen(o.id)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && setOpen(o.id)}>
              <td className="small tabular nowrap"><b>{o.reference}</b><div className="muted">{date(o.date)}</div></td>
              <td>{o.supplier_name}<div className="small muted">Livraison : {o.location_name}</div></td>
              <td className="small">{o.issuer_name || o.created_by_name}</td>
              <td className="right tabular"><b>{fcfa(o.amount_ttc)}</b></td>
              <td><Badge tone="warn">{o.status === 'attente_direction' ? 'Direction (plafond atteint)' : 'Validateur désigné'}</Badge></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {open && <OrderDrawer id={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); list.reload(); onChange?.(); }} />}
    </Card>
  );
}

function OrderDrawer({ id, onClose, onDone }) {
  const { can } = useAuth();
  const saved = useSaved();
  const toast = useToast();
  const d = useResource(`${URL}/${id}`);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async ok => {
    setBusy(true);
    try {
      await api.post(`${URL}/${id}/${ok ? 'valider' : 'refuser'}`, ok ? {} : { reason });
      saved(ok ? 'Bon de commande validé : les Achats et le fournisseur peuvent être prévenus' : 'Bon de commande refusé : l’émetteur est prévenu');
      onDone();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const o = d.data;
  return (
    <Drawer title={o ? `${o.reference} · ${o.supplier_name}` : 'Bon de commande'} onClose={onClose}
      footer={o && <>{can('appro:read') && <Link className="btn btn-ghost" style={{ marginRight: 'auto' }} to={`/achats/commandes?fiche=${o.id}`}><ExternalLink />Ouvrir dans les Achats</Link>}
        {refusing ? <><button className="btn" onClick={() => setRefusing(false)}>Annuler</button><button className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => act(false)}><X />Confirmer le refus</button></>
          : <><button className="btn btn-ghost btn-danger" onClick={() => setRefusing(true)}><X />Refuser</button><button className="btn btn-primary" disabled={busy} onClick={() => act(true)}><Check />Valider</button></>}</>}>
      <ErrorBox error={d.error} />
      {!o ? <Skeleton h={300} /> : (
        <div className="stack">
          <dl className="dl small">
            <dt>Émis par</dt><dd>{o.issuer_name || o.created_by_name}</dd>
            <dt>Date</dt><dd>{date(o.date)}{o.needed_on ? ` · souhaité le ${date(o.needed_on)}` : ''}</dd>
            <dt>Livraison</dt><dd>{o.location_name}</dd>
            <dt>Montant</dt><dd className="tabular">{fcfa(o.amount_ht)} HT · TVA {o.vat_rate} % · <b>{fcfa(o.amount_ttc)} TTC</b></dd>
          </dl>
          <div className="table-wrap"><table className="table table-compact">
            <thead><tr><th>Article</th><th className="right">Quantité</th><th className="right">Prix HT</th><th className="right">Total HT</th></tr></thead>
            <tbody>{o.lines.map(l => <tr key={l.id}><td>{l.label}</td><td className="right tabular">{String(l.quantity).replace('.', ',')} {l.unit}</td><td className="right tabular">{l.unit_price_fcfa == null ? '—' : fcfa(l.unit_price_fcfa)}</td><td className="right tabular">{l.unit_price_fcfa == null ? '—' : fcfa(Math.round(l.quantity * l.unit_price_fcfa))}</td></tr>)}</tbody>
          </table></div>
          {o.note && <p className="small prewrap">{o.note}</p>}
          {refusing && <Field label="Motif du refus *" hint="Transmis à l’émetteur, qui reprend la commande en brouillon pour la corriger."><textarea className="textarea" value={reason} onChange={e => setReason(e.target.value)} maxLength={255} /></Field>}
        </div>
      )}
    </Drawer>
  );
}
