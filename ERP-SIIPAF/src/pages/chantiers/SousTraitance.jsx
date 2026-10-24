/**
 * Chantiers › Fiche › Sous-traitants (lot 4, choix du client du 24/10) : marchés de sous-traitance du chantier
 * (contrats de sorte « sous-traitance », même liste que l'Administration et le Juridique) et leurs situations de travaux :
 * saisie et vérification par le conducteur, validation par la Direction → facture d'achat en brouillon (Comptabilité)
 * et retenue de garantie cumulée (Juridique › Cautions).
 */
import { useState } from 'react';
import { HardHat, Plus, Check, Pencil, Trash2, CheckCircle2, XCircle, Undo2, FileText, Send, Info } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved, useToast } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Field, Modal, Badge, Advance } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { CH } from '../../lib/chantiers';
import { today } from '../../lib/rh';
import { ContractForm } from '../admin/Contrats';

const SIT_TONES = { brouillon: '', verifiee: 'warn', validee: 'ok', refusee: 'danger' };

function multipart(fields, file) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== '' && v != null) f.append(k, v);
  if (file) f.append('file', file);
  return f;
}

export default function SousTraitance({ w, refs, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const res = useResource(`${CH}/${w.id}/sous-traitants`);
  const contractRefs = useResource(can('contrats:write') ? '/admin/erp/contrats/refs' : null);
  const [marketForm, setMarketForm] = useState(false);
  const [sit, setSit] = useState(null); // { market, situation? }
  const direction = can('chantiers:direction');
  const done = (data, msg) => { res.setData(data); if (msg) saved(msg); onChange?.(); };
  const act = async (s, action, body, msg) => {
    try { done(await api.post(`${CH}/${w.id}/situations/${s.id}/${action}`, body || {}), msg); } catch (e) { toast(e.message, 'err'); }
  };
  const refuse = s => { const reason = window.prompt('Motif du refus (transmis au conducteur) :'); if (reason) act(s, 'refuser', { reason }, 'Situation refusée'); };
  const validate = s => window.confirm(`Valider la situation n° ${s.number} (${fcfa(s.amount_ttc)} TTC) ? Une facture d’achat en brouillon sera préparée pour la Comptabilité et la retenue de ${fcfa(s.retention_amount)} ajoutée à la retenue de garantie du marché.`) && act(s, 'valider', null, 'Situation validée : facture préparée pour la Comptabilité');
  const remove = async s => {
    if (!window.confirm(`Supprimer le brouillon de la situation n° ${s.number} ?`)) return;
    try { done(await api.del(`${CH}/${w.id}/situations/${s.id}`), 'Brouillon supprimé'); } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="stack">
      <div className="callout-erp"><Info /><span className="small">
        Un marché est un contrat de sorte « sous-traitance » rattaché à ce chantier (il apparaît aussi dans Administration › Contrats et au Juridique).
        Le conducteur saisit chaque situation (avancement cumulé) puis la vérifie ; la <b>Direction la valide</b> : une facture d’achat en brouillon part à la Comptabilité
        (poste « sous-traitance » de ce chantier) et la retenue de garantie s’ajoute à celle du marché dans Juridique › Cautions.
      </span></div>
      <div className="row-between">
        <span />
        {can('contrats:write') && <button className="btn btn-primary" onClick={() => setMarketForm(true)}><Plus />Nouveau marché</button>}
      </div>
      <ErrorBox error={res.error} />
      {!res.data ? <Skeleton h={160} /> : !res.data.length ? <Card><Empty icon={HardHat}>Aucun marché de sous-traitance sur ce chantier.</Empty></Card> : res.data.map(m => (
        <Card key={m.id} title={`${m.reference} — ${m.title}`} bodyClass=""
          actions={w.can_manage && m.status === 'actif' && !m.pending && <button className="btn btn-sm" onClick={() => setSit({ market: m })}><Plus />Nouvelle situation</button>}>
          <div className="card-body">
            <div className="row small muted" style={{ gap: 10, flexWrap: 'wrap' }}>
              <span>{m.supplier_name || 'Sous-traitant non rattaché'}</span>
              <span>Marché : <b>{m.contract_amount ? fcfa(m.contract_amount) : 'sans montant'}</b> HT</span>
              <span>TVA {m.vat_rate} %</span><span>Retenue {m.retention_pct} % du {(refs.settings?.chantier_retention_base || 'ttc') === 'ht' ? 'HT' : 'TTC'}</span>
              {m.status !== 'actif' && <Badge>Clos</Badge>}
            </div>
            <div className="ws-figures">
              <div><span className="small muted">Avancement validé</span>{m.progress_pct != null ? <Advance value={Math.min(100, m.progress_pct)} /> : <b className="tabular">{fcfa(m.cumulative_amount)}</b>}</div>
              <div><span className="small muted">Facturé TTC</span><b className="tabular">{fcfa(m.invoiced_ttc)}</b></div>
              <div><span className="small muted">Retenue de garantie</span><b className="tabular">{fcfa(m.retention_amount)}</b></div>
              <div><span className="small muted">Payé / reste net</span><b className="tabular">{fcfa(m.paid_fcfa)}<span className="small muted"> · reste {fcfa(m.remaining_net)}</span></b></div>
            </div>
          </div>
          {m.situations.length > 0 && (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>N°</th><th>Arrêtée au</th><th className="right">Cumul</th><th className="right">Période HT</th><th className="right">TTC</th><th className="right">Retenue</th><th className="right">Net à payer</th><th>État</th><th /></tr></thead>
              <tbody>{m.situations.map(s => (
                <tr key={s.id}>
                  <td className="tabular"><b>{s.number}</b></td>
                  <td className="small nowrap">{date(s.period_end)}</td>
                  <td className="right small tabular">{s.cumulative_pct != null ? `${s.cumulative_pct} %` : fcfa(s.cumulative_amount)}</td>
                  <td className="right tabular">{fcfa(s.amount_ht)}</td>
                  <td className="right tabular">{fcfa(s.amount_ttc)}</td>
                  <td className="right tabular small">{fcfa(s.retention_amount)}<div className="muted">{s.retention_pct} % du {s.retention_base === 'ht' ? 'HT' : 'TTC'}</div></td>
                  <td className="right tabular"><b>{fcfa(s.net_payable)}</b></td>
                  <td><Badge tone={SIT_TONES[s.status]}>{s.status_label}</Badge>{s.refusal_reason && <div className="small" style={{ color: 'var(--danger)' }}>{s.refusal_reason}</div>}</td>
                  <td className="right nowrap">
                    {s.file_url && <a className="btn btn-ghost btn-icon" href={s.file_url} target="_blank" rel="noreferrer" aria-label="Ouvrir la situation remise"><FileText /></a>}
                    {s.status === 'brouillon' && w.can_manage && <>
                      <button className="btn btn-ghost btn-icon" onClick={() => setSit({ market: m, situation: s })} aria-label={`Modifier la situation ${s.number}`}><Pencil /></button>
                      <button className="btn btn-ghost btn-icon" onClick={() => remove(s)} aria-label={`Supprimer la situation ${s.number}`}><Trash2 /></button>
                      <button className="btn btn-sm" onClick={() => act(s, 'verifier', null, 'Situation vérifiée : la Direction est prévenue')}><Send />Vérifiée</button>
                    </>}
                    {s.status === 'verifiee' && <>
                      {(w.can_manage || direction) && <button className="btn btn-ghost btn-icon" onClick={() => act(s, 'brouillon', null, 'Situation renvoyée en brouillon')} aria-label="Renvoyer en brouillon"><Undo2 /></button>}
                      {direction && <><button className="btn btn-sm btn-primary" onClick={() => validate(s)}><CheckCircle2 />Valider</button> <button className="btn btn-sm btn-ghost" onClick={() => refuse(s)}><XCircle />Refuser</button></>}
                    </>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      ))}

      {marketForm && contractRefs.data && (
        <ContractForm refs={contractRefs.data} preset={{ kind: 'sous_traitance', project_id: w.project_id, worksite_id: w.id, retention_pct: refs.settings?.chantier_retention_pct ?? '' }}
          onClose={() => setMarketForm(false)} onSaved={() => { setMarketForm(false); res.reload(); }} />
      )}
      {sit && <SituationForm w={w} refs={refs} market={sit.market} situation={sit.situation} onClose={() => setSit(null)} onSaved={d => { setSit(null); done(d, sit.situation ? 'Situation enregistrée' : 'Situation saisie (brouillon)'); }} />}
    </div>
  );
}

function SituationForm({ w, refs, market: m, situation: s, onClose, onSaved }) {
  const byAmount = !m.contract_amount;
  const [f, setF] = useState({
    period_end: s?.period_end || today(), cumulative_pct: s?.cumulative_pct ?? '', cumulative_amount: s?.cumulative_amount ?? '', note: s?.note || '',
  });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  // Aperçu (le serveur refait le calcul) : cumul − cumul validé, TVA du marché, retenue sur le TTC
  const cumul = byAmount ? Number(f.cumulative_amount) || 0 : Math.round(((m.contract_amount || 0) * (Number(f.cumulative_pct) || 0)) / 100);
  const ht = cumul - m.cumulative_amount;
  const ttc = ht + Math.round((ht * m.vat_rate) / 100);
  const base = refs.settings?.chantier_retention_base || 'ttc';
  const retention = Math.round(((base === 'ht' ? ht : ttc) * m.retention_pct) / 100);
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    const fields = { period_end: f.period_end, note: f.note.trim(), ...(byAmount ? { cumulative_amount: f.cumulative_amount } : { cumulative_pct: f.cumulative_pct }) };
    try {
      onSaved(s ? await api.patch(`${CH}/${w.id}/situations/${s.id}`, multipart(fields, file)) : await api.post(`${CH}/${w.id}/marches/${m.id}/situations`, multipart(fields, file)));
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Modal title={s ? `Situation n° ${s.number} — ${m.reference}` : `Nouvelle situation — ${m.reference}`} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="situation-form" disabled={busy}><Check />Enregistrer le brouillon</button></>}>
      <form id="situation-form" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Travaux arrêtés au"><input className="input" type="date" required max={today()} value={f.period_end} onChange={set('period_end')} /></Field>
        {byAmount
          ? <Field label="Montant cumulé des travaux (HT)" hint="Le marché n’a pas de montant : cumul depuis le début"><input className="input" type="number" min="0" required value={f.cumulative_amount} onChange={set('cumulative_amount')} /></Field>
          : <Field label="Avancement cumulé (%)" hint={`Validé jusqu’ici : ${m.progress_pct ?? 0} % du marché`}><input className="input" type="number" min="0" max="100" step="0.5" required value={f.cumulative_pct} onChange={set('cumulative_pct')} /></Field>}
        <div className="full erp-panel small">
          {ht > 0 ? <>Période : <b>{fcfa(ht)}</b> HT · TTC {fcfa(ttc)} · retenue {fcfa(retention)} ({m.retention_pct} % du {base === 'ht' ? 'HT' : 'TTC'}) · <b>net à payer {fcfa(ttc - retention)}</b></> : <span className="muted">Le cumul doit dépasser ce qui est déjà validé ({fcfa(m.cumulative_amount)} HT).</span>}
        </div>
        <Field label="Observations" className="full"><textarea className="textarea" rows={2} maxLength={2000} value={f.note} onChange={set('note')} placeholder="Métré, travaux réalisés, réserves…" /></Field>
        <Field label="Situation remise par le sous-traitant" hint="PDF ou photo, 20 Mo au plus" className="full">
          <label className="btn" style={{ alignSelf: 'start' }}><FileText />{file ? file.name : 'Joindre le document'}<input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files[0] || null)} /></label>
        </Field>
      </form>
    </Modal>
  );
}
