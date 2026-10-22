import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, RefreshCw, CheckCheck, Trash2, RotateCcw, BookOpen, Lock } from 'lucide-react';
import { api, qs } from '@admin/lib/api';
import { useAuth, useResource, useToast, useSaved } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Drawer, Modal, Field, Badge, Pagination } from '@admin/components/ui';
import { date, dateTime } from '@admin/lib/format';
import { useComptaMeta, amt, STATUS, SOURCES, AccountInput } from '../../lib/compta';

export default function Entries() {
  const { can } = useAuth();
  const toast = useToast();
  const { meta } = useComptaMeta();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState([]);
  const [creating, setCreating] = useState(false);
  const filters = { journal_id: params.get('journal_id') || '', status: params.get('status') || '', source: params.get('source') || '', from: params.get('from') || '', to: params.get('to') || '' };
  const openId = Number(params.get('e')) || null;
  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  const list = useResource(`/admin/erp/compta/entries${qs({ ...filters, q: debounced, limit: pageSize, offset: (page - 1) * pageSize })}`);
  const set = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); setPage(1); setSelected([]); };
  const rows = list.data?.rows || [];
  const drafts = rows.filter(e => e.status === 'brouillon');

  const sync = async () => {
    try {
      const r = await api.post('/admin/erp/compta/sync');
      toast(r.no_fiscal_year ? 'Créez d’abord un exercice comptable.' : `${r.created} écriture(s) générée(s)${r.skipped ? ` · ${r.skipped} hors exercice` : ''}`, r.no_fiscal_year ? 'err' : 'ok');
      list.reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const validate = async ids => {
    try {
      const r = await api.post('/admin/erp/compta/entries/validate', { ids });
      toast(`${r.validated} écriture(s) validée(s)${r.errors.length ? ` · ${r.errors.length} refusée(s) : ${r.errors[0]}` : ''}`, r.errors.length ? 'err' : 'ok');
      setSelected([]); list.reload();
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          <label className="search">
            <Search aria-hidden="true" />
            <input className="input" type="search" placeholder="Libellé, n° d’écriture, pièce…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher" />
          </label>
          <select className="select" style={{ width: 'auto' }} value={filters.journal_id} onChange={e => set('journal_id', e.target.value)} aria-label="Journal">
            <option value="">Tous les journaux</option>
            {meta?.journals.map(j => <option key={j.id} value={j.id}>{j.code} — {j.label}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={filters.status} onChange={e => set('status', e.target.value)} aria-label="Statut">
            <option value="">Brouillons et validées</option>
            <option value="brouillon">Brouillons</option>
            <option value="valide">Validées</option>
          </select>
          <select className="select" style={{ width: 'auto' }} value={filters.source} onChange={e => set('source', e.target.value)} aria-label="Origine">
            <option value="">Toutes origines</option>
            {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className="input" type="date" style={{ width: 'auto' }} value={filters.from} onChange={e => set('from', e.target.value)} aria-label="Du" />
          <input className="input" type="date" style={{ width: 'auto' }} value={filters.to} onChange={e => set('to', e.target.value)} aria-label="Au" />
        </div>
        <div className="row">
          {can('compta:entries') && <button className="btn" onClick={sync}><RefreshCw />Synchroniser</button>}
          {can('compta:validate') && selected.length > 0 && <button className="btn btn-primary" onClick={() => validate(selected)}><CheckCheck />Valider {selected.length}</button>}
          {can('compta:entries') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Écriture</button>}
        </div>
      </div>
      <ErrorBox error={list.error} />
      <Card bodyClass="">
        {!list.data ? <div className="card-body"><Skeleton h={260} /></div> : !rows.length ? <div className="card-body"><Empty icon={BookOpen}>Aucune écriture.</Empty></div> : (
          <>
            <div className="table-wrap"><table className="table">
              <thead><tr>
                {can('compta:validate') && <th><input type="checkbox" aria-label="Sélectionner les brouillons de la page" checked={drafts.length > 0 && drafts.every(e => selected.includes(e.id))} onChange={e => setSelected(e.target.checked ? drafts.map(x => x.id) : [])} /></th>}
                <th>Date</th><th>N°</th><th>Jnl</th><th>Libellé</th><th>Origine</th><th className="right">Montant</th><th>Statut</th>
              </tr></thead>
              <tbody>
                {rows.map(e => (
                  <tr key={e.id} className="clickable" onClick={() => set('e', String(e.id))}>
                    {can('compta:validate') && <td onClick={ev => ev.stopPropagation()}>{e.status === 'brouillon' && <input type="checkbox" aria-label={`Sélectionner ${e.label}`} checked={selected.includes(e.id)} onChange={ev => setSelected(s => (ev.target.checked ? [...s, e.id] : s.filter(x => x !== e.id)))} />}</td>}
                    <td className="small nowrap">{date(e.date)}</td>
                    <td className="small nowrap tabular">{e.number || <span className="muted">—</span>}</td>
                    <td className="small"><b>{e.journal_code}</b></td>
                    <td style={{ minWidth: 260 }}><span className="small">{e.label}</span>{e.project_name && <div className="small muted">{e.project_name}</div>}</td>
                    <td className="small muted">{SOURCES[e.source] || e.source}</td>
                    <td className="right tabular small">{amt(e.amount)}</td>
                    <td><Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <Pagination total={list.data.total} page={page} pageSize={pageSize} onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} label="écritures" />
          </>
        )}
      </Card>
      {openId && <EntryDrawer id={openId} onClose={() => set('e', '')} onChange={() => list.reload()} />}
      {creating && <EntryForm onClose={() => setCreating(false)} onSaved={e => { setCreating(false); list.reload(); set('e', String(e.id)); }} />}
    </div>
  );
}

export function EntryDrawer({ id, onClose, onChange }) {
  const { can } = useAuth();
  const toast = useToast();
  const e = useResource(`/admin/erp/compta/entries/${id}`);
  const [editing, setEditing] = useState(false);
  const d = e.data;
  const act = async (fn, msg) => { try { await fn(); toast(msg); e.reload(); onChange?.(); } catch (err) { toast(err.message, 'err'); } };
  const total = k => (d?.lines || []).reduce((t, l) => t + l[k], 0);

  return (
    <Drawer title={d ? (d.number || 'Écriture en brouillon') : 'Écriture'} onClose={onClose} footer={d && (
      <div className="row" style={{ gap: 8 }}>
        {d.status === 'brouillon' && can('compta:validate') && <button className="btn btn-primary" onClick={() => act(() => api.post('/admin/erp/compta/entries/validate', { ids: [d.id] }), 'Écriture validée')}><CheckCheck />Valider</button>}
        {d.status === 'brouillon' && can('compta:entries') && <button className="btn" onClick={() => setEditing(true)}>Modifier</button>}
        {d.status === 'brouillon' && can('compta:entries') && <button className="btn btn-ghost btn-danger" onClick={() => window.confirm('Supprimer ce brouillon ?') && act(async () => { await api.del(`/admin/erp/compta/entries/${d.id}`); onClose(); }, 'Brouillon supprimé')}><Trash2 />Supprimer</button>}
        {d.status === 'valide' && !d.reversed_by && can('compta:validate') && <button className="btn" onClick={() => window.confirm('Créer l’écriture inverse (contrepassation) à la date du jour ?') && act(() => api.post(`/admin/erp/compta/entries/${d.id}/reverse`, {}), 'Contrepassation créée (brouillon)')}><RotateCcw />Contrepasser</button>}
      </div>
    )}>
      {!d ? <Skeleton h={300} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 8 }}>
            <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
            <Badge>{d.journal_code} — {d.journal_label}</Badge>
            <Badge>{SOURCES[d.source] || d.source}</Badge>
            {d.status === 'valide' && <span className="small muted"><Lock className="ico" aria-hidden="true" />Intangible depuis le {dateTime(d.validated_at)}{d.validated_by_name ? ` par ${d.validated_by_name}` : ''}</span>}
          </div>
          <dl className="dl erp-panel">
            <dt>Date</dt><dd>{date(d.date)}</dd>
            <dt>Libellé</dt><dd>{d.label}</dd>
            {d.ref && <><dt>Pièce</dt><dd>{d.ref}</dd></>}
            {d.reversed_by && <><dt>Contrepassée par</dt><dd>{d.reversed_by.number || 'brouillon'}</dd></>}
          </dl>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Compte</th><th>Libellé · tiers · programme</th><th className="right">Débit</th><th className="right">Crédit</th></tr></thead>
            <tbody>
              {d.lines.map(l => (
                <tr key={l.id}>
                  <td className="small"><b className="tabular">{l.account_code}</b><div className="muted">{l.account_label}</div></td>
                  <td className="small">{l.label}{l.partner_name && <div className="muted">{l.partner_name}</div>}{l.project_name && <div className="muted">{l.project_name}</div>}</td>
                  <td className="right tabular small">{amt(l.debit)}</td>
                  <td className="right tabular small">{amt(l.credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2} className="right small"><b>Totaux</b></td><td className="right tabular small"><b>{amt(total('debit'))}</b></td><td className="right tabular small"><b>{amt(total('credit'))}</b></td></tr></tfoot>
          </table></div>
        </div>
      )}
      {editing && d && <EntryForm entry={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); e.reload(); onChange?.(); }} />}
    </Drawer>
  );
}

const blankLine = () => ({ account: '', label: '', debit: '', credit: '', project_id: '' });

/** Saisie ou modification d'un brouillon : lignes au débit ou au crédit, équilibre contrôlé en direct. */
export function EntryForm({ entry, onClose, onSaved }) {
  const saved = useSaved();
  const { meta } = useComptaMeta();
  const [f, setF] = useState(() => ({
    journal_id: entry?.journal_id || meta?.journals.find(j => j.code === 'OD')?.id || '', date: entry?.date || new Date().toISOString().slice(0, 10),
    label: entry?.label || '', ref: entry?.ref || '',
  }));
  const [lines, setLines] = useState(() => (entry ? entry.lines.map(l => ({ account: l.account_code, label: l.label || '', debit: l.debit || '', credit: l.credit || '', project_id: l.project_id || '', partner_type: l.partner_type, partner_id: l.partner_id })) : [blankLine(), blankLine()]));
  const [error, setError] = useState(null);
  const num = v => Number(String(v).replace(/\s/g, '')) || 0;
  const debit = lines.reduce((t, l) => t + num(l.debit), 0);
  const credit = lines.reduce((t, l) => t + num(l.credit), 0);
  const setLine = (i, k, v) => setLines(ls => ls.map((l, j) => (j === i ? { ...l, [k]: v, ...(k === 'debit' && v ? { credit: '' } : k === 'credit' && v ? { debit: '' } : {}) } : l)));

  const save = async ev => {
    ev.preventDefault(); setError(null);
    const body = {
      journal_id: Number(f.journal_id), date: f.date, label: f.label, ref: f.ref || null,
      lines: lines.filter(l => l.account).map(l => ({
        account: l.account, label: l.label || null, debit: num(l.debit), credit: num(l.credit), project_id: Number(l.project_id) || null,
        partner_type: l.partner_type || null, partner_id: l.partner_id || null,
      })),
    };
    try {
      const out = entry ? await api.patch(`/admin/erp/compta/entries/${entry.id}`, body) : await api.post('/admin/erp/compta/entries', body);
      saved("Écriture enregistrée en brouillon"); onSaved(out);
    } catch (err) { setError(err); }
  };

  return (
    <Modal title={entry ? 'Modifier le brouillon' : 'Nouvelle écriture'} onClose={onClose} footer={(
      <>
        <span className="small tabular" style={{ marginRight: 'auto', color: debit === credit && debit ? 'var(--ok)' : 'var(--danger)' }}>
          Débit {amt(debit, { zero: '0' })} · Crédit {amt(credit, { zero: '0' })}{debit !== credit && ` · écart ${amt(Math.abs(debit - credit))}`}
        </span>
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" form="entry-form" disabled={debit !== credit || !debit}>Enregistrer en brouillon</button>
      </>
    )}>
      <form id="entry-form" className="stack" style={{ gap: 12 }} onSubmit={save}>
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field label="Journal">
            <select className="select" value={f.journal_id} onChange={e => setF(x => ({ ...x, journal_id: e.target.value }))} required>
              {meta?.journals.filter(j => j.active).map(j => <option key={j.id} value={j.id}>{j.code} — {j.label}</option>)}
            </select>
          </Field>
          <Field label="Date"><input className="input" type="date" required value={f.date} onChange={e => setF(x => ({ ...x, date: e.target.value }))} /></Field>
          <Field label="Libellé" className="full"><input className="input" required minLength={2} maxLength={255} value={f.label} onChange={e => setF(x => ({ ...x, label: e.target.value }))} /></Field>
          <Field label="Pièce justificative"><input className="input" maxLength={60} value={f.ref} onChange={e => setF(x => ({ ...x, ref: e.target.value }))} placeholder="N° de facture, de reçu…" /></Field>
        </div>
        <div className="table-wrap"><table className="table entry-lines">
          <thead><tr><th>Compte</th><th>Libellé</th><th>Programme</th><th className="right">Débit</th><th className="right">Crédit</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={{ width: 120 }}><AccountInput value={l.account} onChange={v => setLine(i, 'account', v)} /></td>
                <td><input className="input" value={l.label} onChange={e => setLine(i, 'label', e.target.value)} placeholder={f.label || 'Libellé'} aria-label="Libellé de la ligne" /></td>
                <td style={{ width: 160 }}>
                  <select className="select" value={l.project_id} onChange={e => setLine(i, 'project_id', e.target.value)} aria-label="Programme">
                    <option value="">—</option>
                    {meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td style={{ width: 130 }}><input className="input right tabular" inputMode="numeric" value={l.debit} onChange={e => setLine(i, 'debit', e.target.value)} aria-label="Débit" /></td>
                <td style={{ width: 130 }}><input className="input right tabular" inputMode="numeric" value={l.credit} onChange={e => setLine(i, 'credit', e.target.value)} aria-label="Crédit" /></td>
                <td>{lines.length > 2 && <button type="button" className="btn btn-sm btn-ghost btn-icon btn-danger" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))} aria-label="Retirer la ligne"><Trash2 /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-sm" onClick={() => setLines(ls => [...ls, blankLine()])}><Plus />Ligne</button>
          {debit !== credit && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLines(ls => [...ls, { ...blankLine(), [debit > credit ? 'credit' : 'debit']: String(Math.abs(debit - credit)) }])}>Équilibrer</button>}
        </div>
      </form>
    </Modal>
  );
}
