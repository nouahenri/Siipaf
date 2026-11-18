/**
 * Caisse : point de caisse du jour, tel que le tient la trésorière (demande du 18/11). Solde de la veille, entrées et
 * sorties de la journée, solde du soir ; arrêté avec comptage des espèces (billetage) et écart passé en écriture.
 * Les montants sont ceux du journal de caisse : versements en espèces, règlements, paie, frais y arrivent d'eux-mêmes.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, Lock, LockOpen, Paperclip, Plus, Printer, Trash2, Settings2, AlertTriangle } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useResource, useSaved } from '@admin/lib/app-context';
import { Card, Skeleton, Field, ErrorBox, Badge, Modal, Empty } from '@admin/components/ui';
import { date, fcfa } from '@admin/lib/format';
import { AccountInput, amt } from '../../lib/compta';
import { useAutoPrint } from './Liasse';

const K = '/admin/erp/compta/caisse';
const shift = (d, n) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
const longDate = d => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const DIRECTION = { entree: 'Entrée', sortie: 'Sortie' };

export default function Caisse() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const meta = useResource(`${K}/meta`);
  const today = meta.data?.today || new Date().toISOString().slice(0, 10);
  const d = params.get('date') || today;
  // Opérations annulées (écriture validée + contrepassation validée) : masquées, affichables sans être comptées
  const showCancelled = params.get('annulees') === '1';
  const book = useResource(`${K}/day?date=${d}${showCancelled ? '&annulees=1' : ''}`);
  const days = useResource(`${K}/days?to=${today}`);
  const [adding, setAdding] = useState(null); // 'entree' | 'sortie'
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState(null);
  const saved = useSaved();
  const go = v => setParams({ ...(v && v !== today ? { date: v } : {}), ...(showCancelled ? { annulees: '1' } : {}) });
  const toggleCancelled = on => setParams({ ...(d !== today ? { date: d } : {}), ...(on ? { annulees: '1' } : {}) });
  const reload = () => { book.reload(); days.reload(); meta.reload(); };
  const write = can('caisse:write');

  if (meta.error) return <ErrorBox error={meta.error} />;
  if (!meta.data) return <Skeleton h={400} />;
  if (!meta.data.journal) return <Card title="Caisse"><p>Aucun journal de caisse actif. Créez-le dans <Link className="link" to="/compta/parametres">Comptabilité › Réglages › Journaux</Link> (type Caisse, compte 571…).</p></Card>;
  const b = book.data;
  const closed = !!b?.closing;
  const act = async (fn, msg) => { setError(null); try { await fn(); saved(msg); reload(); } catch (e) { setError(e); } };

  return (
    <div className="stack">
      <div className="row-between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-ghost" onClick={() => go(shift(d, -1))} aria-label="Jour précédent"><ChevronLeft /></button>
          <input className="input" type="date" max={today} value={d} onChange={e => e.target.value && go(e.target.value)} style={{ width: 'auto' }} aria-label="Journée" />
          <button className="btn btn-sm btn-ghost" disabled={d >= today} onClick={() => go(shift(d, 1))} aria-label="Jour suivant"><ChevronRight /></button>
          {d !== today && <button className="btn btn-sm" onClick={() => go(today)}>Aujourd’hui</button>}
          <span className="small muted" style={{ textTransform: 'capitalize' }}>{longDate(d)}</span>
          <label className="checkbox small" title="Écriture validée et sa contrepassation validée : elles s’annulent et ne comptent pas dans la caisse ; elles restent dans les journaux"><input type="checkbox" checked={showCancelled} onChange={e => toggleCancelled(e.target.checked)} />Afficher les opérations annulées</label>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {write && !closed && <button className="btn btn-sm" onClick={() => setAdding('entree')}><ArrowDownLeft />Entrée</button>}
          {write && !closed && <button className="btn btn-sm" onClick={() => setAdding('sortie')}><ArrowUpRight />Sortie</button>}
          {write && !closed && b && <button className="btn btn-sm btn-primary" onClick={() => setClosing(true)}><Lock />Arrêter la caisse</button>}
          {closed && b.closing.reopenable && can('compta:validate') && <button className="btn btn-sm btn-ghost" onClick={() => window.confirm(`Rouvrir la caisse du ${date(d)} ? L’écriture d’écart sera retirée.`) && act(() => api.del(`${K}/closings/${d}`), 'Caisse rouverte')}><LockOpen />Rouvrir</button>}
          <Link className="btn btn-sm btn-ghost" to={`/compta/caisse/brouillard/${d}?imprimer=1`}><Printer />Imprimer le brouillard</Link>
        </div>
      </div>
      <ErrorBox error={error || book.error} />

      {!b ? <Skeleton h={300} /> : (
        <>
          <div className="report-kpis">
            <div className="report-kpi"><span className="small muted">Solde de la veille</span><b className="tabular">{fcfa(b.opening)}</b></div>
            <div className="report-kpi"><span className="small muted">Entrées du jour</span><b className="tabular" style={{ color: 'var(--ok)' }}>{fcfa(b.receipts)}</b></div>
            <div className="report-kpi"><span className="small muted">Sorties du jour</span><b className="tabular" style={{ color: 'var(--danger)' }}>{fcfa(b.expenses)}</b></div>
            <div className="report-kpi"><span className="small muted">{closed ? 'Solde du soir (compté)' : 'Solde du soir'}</span><b className="tabular">{fcfa(b.closing_balance)}</b></div>
          </div>

          {closed && (
            <div className="erp-panel row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <Badge tone="ok"><Lock size={12} /> Arrêtée</Badge>
              <span className="small">par {b.closing.closed_by || '—'} · solde théorique {fcfa(b.closing.theoretical)} · compté {fcfa(b.closing.counted)}</span>
              {b.closing.gap !== 0 && <Badge tone="danger">{b.closing.gap < 0 ? 'Manquant' : 'Excédent'} {fcfa(Math.abs(b.closing.gap))}</Badge>}
              {b.closing.note && <span className="small muted">« {b.closing.note} »</span>}
              {b.closing.changed && <span className="small" style={{ color: 'var(--warn, #b7791f)' }}><AlertTriangle size={13} style={{ verticalAlign: '-2px' }} /> Une opération a été passée en caisse à cette date après l’arrêté : le solde de la journée a changé.</span>}
            </div>
          )}
          {showCancelled && b.cancelled_count > 0 && <p className="small muted">Les opérations marquées « Annulée » (écriture validée et sa contrepassation validée) sont affichées pour information : elles ne comptent ni dans les totaux ni dans le solde.</p>}
          {b.pending_sync > 0 && <p className="small muted"><AlertTriangle size={13} style={{ verticalAlign: '-2px' }} /> {b.pending_sync} versement(s) client en espèces compté(s) dans la caisse, dont l’écriture reste à créer (« Synchroniser » dans Écritures).</p>}

          <Card title={`Brouillard — ${b.journal.code} ${b.journal.label}`} bodyClass="">
            {!b.rows.length ? <div className="card-body"><Empty>Aucun mouvement de caisse ce jour.</Empty></div> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Pièce</th><th>Libellé</th><th>Origine</th><th className="right">Entrée</th><th className="right">Sortie</th><th className="right">Solde</th><th /></tr></thead>
                <tbody>
                  <tr className="muted"><td /><td colSpan={4}><i>Solde de la veille</i></td><td className="right tabular">{amt(b.opening, { zero: '0' })}</td><td /></tr>
                  {b.rows.map(r => (
                    <tr key={r.key} style={r.cancelled ? { opacity: 0.55 } : undefined}>
                      <td className="small tabular nowrap">{r.cancelled && <><Badge>Annulée</Badge><br /></>}{r.number || (r.status === 'a_synchroniser' ? <Badge tone="warn">À synchroniser</Badge> : <Badge tone="warn">Brouillon</Badge>)}{r.ref && <div className="muted">{r.ref}</div>}</td>
                      <td className="small">{r.label}{r.created_by && r.movement_id && <div className="muted">saisi par {r.created_by}</div>}</td>
                      <td className="small">{r.origin}{r.journal_code && r.journal_code !== b.journal.code && <div className="muted">journal {r.journal_code}</div>}</td>
                      <td className="right tabular">{amt(r.receipt)}</td>
                      <td className="right tabular">{amt(r.expense)}</td>
                      <td className="right tabular">{amt(r.balance, { zero: '0' })}</td>
                      <td className="nowrap right">
                        {r.document && <a href={r.document.url} target="_blank" rel="noreferrer" title={r.document.name} className="btn btn-sm btn-ghost"><Paperclip /></a>}
                        {r.movement_id && write && !closed && !r.document && !r.cancelled && (
                          <label className="btn btn-sm btn-ghost" title="Joindre le justificatif"><Paperclip /><input type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,.heic" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { const fd = new FormData(); fd.append('file', f); act(() => api.put(`${K}/movements/${r.movement_id}/document`, fd), 'Justificatif joint'); } }} /></label>
                        )}
                        {r.movement_id && write && !closed && !r.cancelled && <button className="btn btn-sm btn-ghost btn-danger" title="Annuler la saisie" onClick={() => window.confirm('Annuler cette saisie de caisse ? Son écriture est retirée (ou contrepassée si elle est validée).') && act(() => api.del(`${K}/movements/${r.movement_id}`), 'Saisie annulée')}><Trash2 /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><th colSpan={3}>Totaux du jour</th><th className="right tabular">{amt(b.receipts, { zero: '0' })}</th><th className="right tabular">{amt(b.expenses, { zero: '0' })}</th><th className="right tabular">{amt(b.closing_balance, { zero: '0' })}</th><th /></tr></tfoot>
              </table></div>
            )}
          </Card>
        </>
      )}

      <RecentDays days={days.data} current={d} onPick={go} />
      <p className="small muted">Les espèces encaissées ou payées ailleurs dans l’ERP (versements clients, règlements fournisseurs, paie, notes de frais, carburant) apparaissent ici d’elles-mêmes. Natures des opérations : {can('compta:settings') ? <Link className="link" to="/compta/parametres"><Settings2 size={13} style={{ verticalAlign: '-2px' }} /> Réglages de la Comptabilité</Link> : 'ajoutez-en depuis la saisie'}{' '}· plafond d’espèces réglable dans les Réglages.</p>

      {adding && <MovementModal meta={meta.data} direction={adding} date={d} onClose={() => setAdding(null)} onDone={() => { setAdding(null); reload(); }} onNatures={meta.reload} />}
      {closing && b && <ClosingModal book={b} denominations={meta.data.denominations} onClose={() => setClosing(false)} onDone={() => { setClosing(false); reload(); }} />}
    </div>
  );
}

function RecentDays({ days, current, onPick }) {
  if (!days) return null;
  return (
    <Card title="Journées récentes (30 jours)" bodyClass="">
      {!days.length ? <div className="card-body"><Empty>Aucun mouvement sur les 30 derniers jours.</Empty></div> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Journée</th><th className="right">Entrées</th><th className="right">Sorties</th><th>Arrêté</th></tr></thead>
          <tbody>{days.map(x => (
            <tr key={x.date} onClick={() => onPick(x.date)} style={{ cursor: 'pointer', fontWeight: x.date === current ? 600 : undefined }}>
              <td className="small">{date(x.date)}</td>
              <td className="right tabular">{amt(x.receipts)}</td>
              <td className="right tabular">{amt(x.expenses)}</td>
              <td>{x.closed ? <Badge tone={x.gap ? 'danger' : 'ok'}>{x.gap ? `Arrêtée (écart ${amt(x.gap)})` : 'Arrêtée'}</Badge> : <Badge tone="warn">À arrêter</Badge>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function MovementModal({ meta, direction, date: d, onClose, onDone, onNatures }) {
  const saved = useSaved();
  const list = meta.natures.filter(n => n.direction === direction && n.active);
  const [f, setF] = useState({ nature_id: list[0]?.id || '', amount: '', label: '', beneficiary: '', partner_id: '', project_id: '', reference: '' });
  const [file, setFile] = useState(null);
  const [newNature, setNewNature] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const nature = meta.natures.find(n => n.id === Number(f.nature_id));
  const partners = nature?.partner_kind === 'employe' ? meta.employees : nature?.partner_kind === 'fournisseur' ? meta.suppliers : null;
  const save = async e => {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const m = await api.post(`${K}/movements`, {
        date: d, direction, nature_id: Number(f.nature_id), amount: Math.round(Number(String(f.amount).replace(/[\s  ]/g, ''))), label: f.label,
        beneficiary: f.beneficiary || null, partner_id: partners && f.partner_id ? Number(f.partner_id) : null, project_id: f.project_id ? Number(f.project_id) : null, reference: f.reference || null,
      });
      if (file) { const fd = new FormData(); fd.append('file', file); await api.put(`${K}/movements/${m.id}/document`, fd).catch(err => setError(err)); }
      saved(direction === 'entree' ? 'Entrée enregistrée' : 'Sortie enregistrée');
      onDone();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const addNature = async () => {
    setError(null);
    try { const n = await api.post(`${K}/natures`, { ...newNature, direction }); await onNatures(); meta.natures.push(n); setF(x => ({ ...x, nature_id: n.id })); setNewNature(null); saved('Nature ajoutée'); } catch (err) { setError(err); }
  };
  return (
    <Modal title={`${DIRECTION[direction]} de caisse — ${date(d)}`} onClose={onClose} footer={<><button className="btn btn-ghost" type="button" onClick={onClose}>Annuler</button><button className="btn btn-primary" form="cash-move" disabled={busy || !f.nature_id}>Enregistrer</button></>}>
      <form id="cash-move" className="form-grid" onSubmit={save}>
        <div className="full"><ErrorBox error={error} /></div>
        <Field label="Nature *" className="full">
          <div className="row" style={{ gap: 6 }}>
            <select className="select" required value={f.nature_id} onChange={set('nature_id')}>
              <option value="">Choisir…</option>
              {list.map(n => <option key={n.id} value={n.id}>{n.label} ({n.account_code})</option>)}
            </select>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNewNature(newNature ? null : { label: '', account: '' })}><Plus />Nature</button>
          </div>
        </Field>
        {newNature && (
          <div className="full erp-panel form-grid">
            <Field label="Nouvelle nature"><input className="input" value={newNature.label} onChange={e => setNewNature(x => ({ ...x, label: e.target.value }))} placeholder={direction === 'entree' ? 'Vente de cahiers des charges' : 'Gardiennage'} /></Field>
            <Field label="Compte de contrepartie" hint={direction === 'entree' ? 'Classe 7 pour une recette, 4 ou 5 pour un mouvement de fonds' : 'Classe 6 pour une charge, 4 ou 5 pour un mouvement de fonds'}><AccountInput value={newNature.account} onChange={v => setNewNature(x => ({ ...x, account: v }))} /></Field>
            <div className="full"><button type="button" className="btn btn-sm" disabled={newNature.label.trim().length < 2 || !newNature.account} onClick={addNature}>Ajouter la nature</button></div>
          </div>
        )}
        <Field label="Montant (FCFA) *"><input className="input tabular" required inputMode="numeric" value={f.amount} onChange={set('amount')} autoFocus /></Field>
        <Field label="N° de pièce" hint="Reçu, bon, facture"><input className="input" maxLength={60} value={f.reference} onChange={set('reference')} /></Field>
        <Field label="Motif *" className="full"><input className="input" required minLength={2} maxLength={200} value={f.label} onChange={set('label')} placeholder={direction === 'entree' ? 'Retrait chèque n° …' : 'Taxi pour le dépôt du dossier …'} /></Field>
        {partners ? (
          <Field label={nature.partner_kind === 'employe' ? 'Employé *' : 'Fournisseur *'} className="full">
            <select className="select" required value={f.partner_id} onChange={set('partner_id')}><option value="">Choisir…</option>{partners.map(p => <option key={p.id} value={p.id}>{p.name}{p.matricule ? ` (${p.matricule})` : ''}</option>)}</select>
          </Field>
        ) : (
          <Field label={direction === 'entree' ? 'Remis par' : 'Bénéficiaire'} className="full"><input className="input" maxLength={160} value={f.beneficiary} onChange={set('beneficiary')} /></Field>
        )}
        <Field label="Programme" hint="Facultatif : impute la dépense au programme"><select className="select" value={f.project_id} onChange={set('project_id')}><option value="">Siège / aucun</option>{meta.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Justificatif" hint="Photo du reçu ou PDF, 15 Mo au plus"><input className="input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,.heic" onChange={e => setFile(e.target.files?.[0] || null)} /></Field>
      </form>
    </Modal>
  );
}

function ClosingModal({ book, denominations, onClose, onDone }) {
  const saved = useSaved();
  const [counts, setCounts] = useState({});
  const [direct, setDirect] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const billetage = useMemo(() => Object.entries(counts).reduce((t, [k, n]) => t + (Number(n) || 0) * Number(k.slice(1)), 0), [counts]);
  const useBilletage = Object.values(counts).some(n => Number(n) > 0);
  const counted = useBilletage ? billetage : direct === '' ? null : Math.round(Number(String(direct).replace(/[\s  ]/g, '')));
  const gap = counted == null ? null : counted - book.theoretical;
  const save = async () => {
    setError(null);
    try {
      await api.post(`${K}/closings`, { date: book.date, counted, denominations: useBilletage ? Object.fromEntries(Object.entries(counts).filter(([, n]) => Number(n) > 0).map(([k, n]) => [k, Number(n)])) : null, note: note || null });
      saved('Caisse arrêtée'); onDone();
    } catch (err) { setError(err); }
  };
  const row = (prefix, v) => (
    <tr key={`${prefix}${v}`}>
      <td className="small tabular">{amt(v)}</td>
      <td><input className="input tabular" type="number" min="0" style={{ width: 90 }} value={counts[`${prefix}${v}`] ?? ''} onChange={e => setCounts(x => ({ ...x, [`${prefix}${v}`]: e.target.value }))} aria-label={`Nombre de ${prefix === 'b' ? 'billets' : 'pièces'} de ${v}`} /></td>
      <td className="right tabular small">{amt((Number(counts[`${prefix}${v}`]) || 0) * v)}</td>
    </tr>
  );
  return (
    <Modal title={`Arrêté de caisse — ${date(book.date)}`} onClose={onClose} footer={(
      <>
        <span className="small tabular" style={{ marginRight: 'auto', color: gap ? 'var(--danger)' : 'var(--ok)' }}>{gap == null ? '' : gap === 0 ? 'Caisse juste' : `${gap < 0 ? 'Manquant' : 'Excédent'} : ${fcfa(Math.abs(gap))}`}</span>
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" disabled={counted == null} onClick={() => (!gap || window.confirm(`Écart de ${fcfa(gap)} : il sera passé en écriture (${gap < 0 ? 'manquant' : 'excédent'}) et la Direction prévenue. Arrêter quand même ?`)) && save()}><Lock />Arrêter</button>
      </>
    )}>
      <div className="stack" style={{ gap: 12 }}>
        <ErrorBox error={error} />
        <div className="report-kpis">
          <div className="report-kpi"><span className="small muted">Solde de la veille</span><b className="tabular">{fcfa(book.opening)}</b></div>
          <div className="report-kpi"><span className="small muted">Entrées − sorties</span><b className="tabular">{fcfa(book.receipts - book.expenses)}</b></div>
          <div className="report-kpi"><span className="small muted">Solde théorique</span><b className="tabular">{fcfa(book.theoretical)}</b></div>
        </div>
        <p className="small">Comptez les espèces : billet par billet (billetage) ou directement le total.</p>
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <table className="table"><thead><tr><th>Billets</th><th>Nombre</th><th className="right">Montant</th></tr></thead><tbody>{denominations.billets.map(v => row('b', v))}</tbody></table>
          <table className="table"><thead><tr><th>Pièces</th><th>Nombre</th><th className="right">Montant</th></tr></thead><tbody>{denominations.pieces.map(v => row('p', v))}</tbody></table>
        </div>
        {useBilletage
          ? <p className="tabular"><b>Total compté : {fcfa(billetage)}</b></p>
          : <Field label="Ou total compté (FCFA)"><input className="input tabular" inputMode="numeric" value={direct} onChange={e => setDirect(e.target.value)} /></Field>}
        <Field label="Note" hint="Explication d’un écart, remarque"><input className="input" maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** Brouillard de caisse imprimable (à signer) : mouvements, totaux, arrêté et billetage. */
export function CaissePrint() {
  const { date: d } = useParams();
  const book = useResource(`${K}/day?date=${d}`);
  const b = book.data;
  useEffect(() => { document.title = `Brouillard de caisse ${d}`; }, [d]);
  useAutoPrint(!!b, `/compta/caisse?date=${d}`);
  if (!b) return book.error ? <ErrorBox error={book.error} /> : <Skeleton h={400} />;
  const den = b.closing?.denominations || {};
  return (
    <article className="appro-print stack" aria-label={`Brouillard de caisse du ${date(d)}`}>
      <div className="row appro-print-actions">
        <Link className="btn btn-ghost" to={`/compta/caisse?date=${d}`}>Retour à la caisse</Link>
        <button className="btn btn-primary" onClick={() => window.print()}><Printer />Imprimer / PDF</button>
      </div>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <img src="/logo-siipaf.png" alt="SIIPAF SA" style={{ width: 150 }} />
        <div className="right"><h2 style={{ margin: 0 }}>Brouillard de caisse</h2><strong style={{ textTransform: 'capitalize' }}>{longDate(d)}</strong><div className="small">{b.journal.code} — {b.journal.label} ({b.journal.account_code})</div></div>
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Pièce</th><th>Libellé</th><th>Origine</th><th className="right">Entrée</th><th className="right">Sortie</th><th className="right">Solde</th></tr></thead>
        <tbody>
          <tr><td /><td colSpan={4}><i>Solde de la veille</i></td><td className="right tabular">{amt(b.opening, { zero: '0' })}</td></tr>
          {b.rows.map(r => <tr key={r.key}><td className="small tabular">{r.number || (r.status === 'a_synchroniser' ? 'À synchroniser' : 'Brouillon')}{r.ref ? ` · ${r.ref}` : ''}</td><td className="small">{r.label}</td><td className="small">{r.origin}</td><td className="right tabular">{amt(r.receipt)}</td><td className="right tabular">{amt(r.expense)}</td><td className="right tabular">{amt(r.balance, { zero: '0' })}</td></tr>)}
        </tbody>
        <tfoot><tr><th colSpan={3}>Totaux</th><th className="right tabular">{amt(b.receipts, { zero: '0' })}</th><th className="right tabular">{amt(b.expenses, { zero: '0' })}</th><th className="right tabular">{amt(b.closing_balance, { zero: '0' })}</th></tr></tfoot>
      </table></div>
      {b.closing ? (
        <div className="stack" style={{ gap: 6 }}>
          <p className="tabular">Solde théorique : <b>{fcfa(b.closing.theoretical)}</b> · Compté : <b>{fcfa(b.closing.counted)}</b> · Écart : <b>{b.closing.gap ? `${b.closing.gap < 0 ? 'manquant' : 'excédent'} ${fcfa(Math.abs(b.closing.gap))}` : 'aucun'}</b></p>
          {Object.keys(den).length > 0 && <p className="small tabular">Billetage : {Object.entries(den).map(([k, n]) => `${n} × ${amt(Number(k.slice(1)))} (${k[0] === 'b' ? 'billet' : 'pièce'})`).join(' · ')}</p>}
          <p className="small">Arrêtée par {b.closing.closed_by || '—'}{b.closing.note ? ` — ${b.closing.note}` : ''}</p>
        </div>
      ) : <p className="small"><b>Caisse non arrêtée.</b></p>}
      <div className="appro-signatures" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}><div className="small">La caissière</div><div className="small">Le comptable</div><div className="small">La direction</div></div>
    </article>
  );
}

/** Réglages de la Comptabilité : natures des opérations de caisse (liste par défaut, administrable). */
export function CashNatures() {
  const { can } = useAuth();
  const list = useResource(`${K}/meta`);
  const saved = useSaved();
  const [f, setF] = useState({ label: '', direction: 'sortie', account: '' });
  const [error, setError] = useState(null);
  const write = can('compta:settings') || can('caisse:write');
  const act = async (fn, msg) => { setError(null); try { await fn(); saved(msg); list.reload(); } catch (e) { setError(e); } };
  if (!list.data) return list.error ? null : <Skeleton h={200} />;
  return (
    <Card title="Caisse : natures des opérations" bodyClass="">
      <div className="card-body stack" style={{ gap: 10 }}>
        <ErrorBox error={error} />
        <p className="small muted">Proposées à la saisie d’une entrée ou d’une sortie de caisse ; chaque nature passe sur son compte (la caisse en contrepartie). Une nature désactivée n’est plus proposée, ses opérations restent.</p>
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Sens</th><th>Nature</th><th>Compte</th><th /></tr></thead>
        <tbody>{list.data.natures.map(n => (
          <tr key={n.id} style={{ opacity: n.active ? 1 : 0.5 }}>
            <td><Badge tone={n.direction === 'entree' ? 'ok' : ''}>{DIRECTION[n.direction]}</Badge></td>
            <td className="small">{write ? <input className="input" defaultValue={n.label} onBlur={e => e.target.value.trim() !== n.label && e.target.value.trim().length >= 2 && act(() => api.patch(`${K}/natures/${n.id}`, { label: e.target.value.trim() }), 'Nature renommée')} aria-label="Intitulé" /> : n.label}</td>
            <td className="small tabular" title={n.account_label}>{write ? <NatureAccount n={n} onSave={code => act(() => api.patch(`${K}/natures/${n.id}`, { account: code }), 'Compte modifié')} /> : n.account_code}</td>
            <td className="right">{write && <button className="btn btn-sm btn-ghost" onClick={() => act(() => api.patch(`${K}/natures/${n.id}`, { active: !n.active }), n.active ? 'Nature désactivée' : 'Nature réactivée')}>{n.active ? 'Désactiver' : 'Réactiver'}</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {write && (
        <form className="row erp-panel" style={{ alignItems: 'flex-end', margin: 16, flexWrap: 'wrap' }} onSubmit={e => { e.preventDefault(); act(() => api.post(`${K}/natures`, f), 'Nature ajoutée').then(() => setF(x => ({ ...x, label: '', account: '' }))); }}>
          <Field label="Sens"><select className="select" value={f.direction} onChange={e => setF(x => ({ ...x, direction: e.target.value }))}><option value="sortie">Sortie</option><option value="entree">Entrée</option></select></Field>
          <Field label="Nouvelle nature"><input className="input" required minLength={2} maxLength={120} value={f.label} onChange={e => setF(x => ({ ...x, label: e.target.value }))} /></Field>
          <Field label="Compte"><AccountInput value={f.account} onChange={v => setF(x => ({ ...x, account: v }))} required /></Field>
          <button className="btn btn-primary"><Plus />Ajouter</button>
        </form>
      )}
    </Card>
  );
}

function NatureAccount({ n, onSave }) {
  const [v, setV] = useState(n.account_code);
  useEffect(() => setV(n.account_code), [n.account_code]);
  return <div onBlur={() => v && v !== n.account_code && onSave(v)} style={{ maxWidth: 140 }}><AccountInput value={v} onChange={setV} /></div>;
}
