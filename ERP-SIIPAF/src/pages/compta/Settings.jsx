import { useEffect, useState } from 'react';
import { CalendarPlus, Lock, Archive, Plus, ArrowRightLeft, Upload } from 'lucide-react';
import { api } from '@admin/lib/api';
import { useAuth, useToast } from '@admin/lib/app-context';
import { Card, Skeleton, Field, ErrorBox, Badge, Modal } from '@admin/components/ui';
import { date } from '@admin/lib/format';
import { useComptaMeta, AccountInput, amt } from '../../lib/compta';

const ACCOUNT_LABELS = {
  client: 'Clients', client_advance: 'Avances et acomptes reçus des clients', supplier: 'Fournisseurs', vat_collected: 'TVA facturée sur ventes',
  vat_deductible: 'TVA récupérable sur achats', sale_housing: 'Ventes de logements', sale_land: 'Ventes de terrains aménagés', expense_default: 'Charge proposée par défaut sur un achat',
  opening_balance: 'Compte d’attente (reprise)',
};

export default function Settings() {
  const { can } = useAuth();
  const { meta, reload } = useComptaMeta();
  if (!meta) return <Skeleton h={400} />;
  const write = can('compta:validate');
  return (
    <div className="stack">
      <FiscalYears meta={meta} write={write} onChange={reload} />
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <Rules meta={meta} write={write} onChange={reload} />
        <Journals meta={meta} write={write} onChange={reload} />
      </div>
    </div>
  );
}

function FiscalYears({ meta, write, onChange }) {
  const toast = useToast();
  const y = new Date().getFullYear();
  const [f, setF] = useState({ label: String(y), start_date: `${y}-01-01`, end_date: `${y}-12-31` });
  const [opening, setOpening] = useState(null);
  const [error, setError] = useState(null);
  const act = async (fn, msg) => { setError(null); try { await fn(); toast(msg); onChange(); } catch (e) { setError(e); } };
  const years = meta.fiscal_years;
  return (
    <Card title="Exercices comptables">
      <div className="stack" style={{ gap: 14 }}>
        <ErrorBox error={error} />
        {!years.length && <p className="small">Aucun exercice. L’exercice de départ est à fixer avec le comptable : il détermine les opérations reprises (versements, appels de fonds, ventes) et la date des soldes d’ouverture.</p>}
        {years.length > 0 && (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Exercice</th><th>Période</th><th>Verrouillé jusqu’au</th><th>État</th><th /></tr></thead>
            <tbody>
              {years.map(fy => (
                <tr key={fy.id}>
                  <td><b>{fy.label}</b></td>
                  <td className="small">{date(fy.start_date)} → {date(fy.end_date)}</td>
                  <td className="small">
                    {write && fy.status === 'ouvert'
                      ? <input className="input" type="date" style={{ width: 'auto' }} defaultValue={fy.lock_date || ''} onBlur={e => e.target.value !== (fy.lock_date || '') && act(() => api.patch(`/admin/erp/compta/fiscal-years/${fy.id}`, { lock_date: e.target.value || null }), 'Période verrouillée')} aria-label="Date de verrouillage" />
                      : fy.lock_date ? date(fy.lock_date) : '—'}
                  </td>
                  <td><Badge tone={fy.status === 'ouvert' ? 'ok' : ''}>{fy.status === 'ouvert' ? 'Ouvert' : 'Clôturé'}</Badge></td>
                  <td className="nowrap right">
                    {write && fy.status === 'ouvert' && <button className="btn btn-sm" onClick={() => setOpening(fy)}><Upload />Soldes d’ouverture</button>}
                    {write && fy.status === 'ouvert' && years.some(o => o.status === 'cloture' && o.end_date < fy.start_date) && (
                      <button className="btn btn-sm btn-ghost" onClick={() => act(() => api.post(`/admin/erp/compta/fiscal-years/${fy.id}/opening-from/${years.filter(o => o.status === 'cloture' && o.end_date < fy.start_date)[0].id}`), 'À-nouveaux générés (brouillon)')}><ArrowRightLeft />À-nouveaux</button>
                    )}
                    {write && fy.status === 'ouvert' && <button className="btn btn-sm btn-ghost btn-danger" onClick={() => window.confirm(`Clôturer l’exercice ${fy.label} ? Plus aucune écriture ne pourra y être passée.`) && act(() => api.post(`/admin/erp/compta/fiscal-years/${fy.id}/close`), 'Exercice clôturé')}><Archive />Clôturer</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {write && (
          <form className="row erp-panel" style={{ alignItems: 'flex-end' }} onSubmit={e => { e.preventDefault(); act(() => api.post('/admin/erp/compta/fiscal-years', f), `Exercice ${f.label} créé`); }}>
            <Field label="Nouvel exercice"><input className="input" required minLength={2} style={{ width: 120 }} value={f.label} onChange={e => setF(x => ({ ...x, label: e.target.value }))} /></Field>
            <Field label="Du"><input className="input" type="date" required value={f.start_date} onChange={e => setF(x => ({ ...x, start_date: e.target.value }))} /></Field>
            <Field label="Au"><input className="input" type="date" required value={f.end_date} onChange={e => setF(x => ({ ...x, end_date: e.target.value }))} /></Field>
            <button className="btn btn-primary"><CalendarPlus />Créer</button>
          </form>
        )}
        <p className="small muted"><Lock className="ico" aria-hidden="true" />Verrouiller une période (par exemple après la déclaration de TVA du mois) interdit toute écriture jusqu’à cette date. Une écriture validée est définitive : on la corrige par contrepassation.</p>
      </div>
      {opening && <OpeningModal fy={opening} onClose={() => setOpening(null)} onDone={() => { setOpening(null); onChange(); }} />}
    </Card>
  );
}

/** Soldes d'ouverture collés depuis l'ancienne comptabilité ou Excel : « compte ; débit ; crédit ; libellé ». */
function OpeningModal({ fy, onClose, onDone }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const num = v => Number(String(v || '').replace(/[\s  ]/g, '').replace(',', '.')) || 0;
  const lines = text.split(/\r?\n/).map(l => l.split(/[;\t]/)).filter(c => /^\d{2,12}$/.test((c[0] || '').trim()))
    .map(c => ({ account: c[0].trim(), debit: Math.round(num(c[1])), credit: Math.round(num(c[2])), label: (c[3] || '').trim() || null }));
  const d = lines.reduce((t, l) => t + l.debit, 0), c = lines.reduce((t, l) => t + l.credit, 0);
  const save = async () => {
    setError(null);
    try { await api.post('/admin/erp/compta/opening', { fiscal_year_id: fy.id, lines }); toast('Soldes d’ouverture enregistrés (brouillon dans le journal AN)'); onDone(); } catch (e) { setError(e); }
  };
  return (
    <Modal title={`Soldes d’ouverture — exercice ${fy.label}`} onClose={onClose} footer={(
      <>
        <span className="small tabular" style={{ marginRight: 'auto', color: d === c && d ? 'var(--ok)' : 'var(--danger)' }}>{lines.length} ligne(s) · débit {amt(d, { zero: '0' })} · crédit {amt(c, { zero: '0' })}</span>
        <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
        <button className="btn btn-primary" disabled={!lines.length || d !== c} onClick={save}>Enregistrer</button>
      </>
    )}>
      <div className="stack" style={{ gap: 10 }}>
        <ErrorBox error={error} />
        <p className="small">Collez la balance de clôture de l’ancienne comptabilité (Excel ou Sage), une ligne par compte : <b>compte ; débit ; crédit ; libellé</b>. Comptes de bilan (classes 1 à 5) uniquement ; le total des débits doit égaler celui des crédits.</p>
        <textarea className="textarea tabular" rows={12} value={text} onChange={e => setText(e.target.value)} placeholder={'101;;10000000;Capital social\n521100;6500000;;Banque\n4111;3500000;;Clients'} aria-label="Soldes d’ouverture" />
      </div>
    </Modal>
  );
}

function Rules({ meta, write, onChange }) {
  const toast = useToast();
  const [s, setS] = useState(meta.settings);
  const [error, setError] = useState(null);
  useEffect(() => setS(meta.settings), [meta.settings]);
  const save = async e => {
    e.preventDefault(); setError(null);
    try { await api.put('/admin/erp/compta/settings', { ...s, vat_sales_rate: Number(s.vat_sales_rate), vat_purchases_rate: Number(s.vat_purchases_rate) }); toast('Réglages enregistrés'); onChange(); } catch (err) { setError(err); }
  };
  return (
    <Card title="Règles comptables">
      <form className="stack" style={{ gap: 14 }} onSubmit={save}>
        <ErrorBox error={error} />
        <fieldset disabled={!write} className="stack" style={{ gap: 14 }}>
          <Field label="Chiffre d’affaires des ventes en VEFA">
            <select className="select" value={s.revenue_vefa} onChange={e => setS(x => ({ ...x, revenue_vefa: e.target.value }))}>
              {Object.entries(meta.revenue_modes.vefa).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Chiffre d’affaires des ventes sur échéancier">
            <select className="select" value={s.revenue_echeancier} onChange={e => setS(x => ({ ...x, revenue_echeancier: e.target.value }))}>
              {Object.entries(meta.revenue_modes.echeancier).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="TVA sur les ventes (%)" hint="Régime des logements et terrains à confirmer"><input className="input" type="number" min="0" max="100" value={s.vat_sales_rate} onChange={e => setS(x => ({ ...x, vat_sales_rate: e.target.value }))} /></Field>
            <Field label="TVA proposée sur les achats (%)"><input className="input" type="number" min="0" max="100" value={s.vat_purchases_rate} onChange={e => setS(x => ({ ...x, vat_purchases_rate: e.target.value }))} /></Field>
          </div>
          <label className="checkbox"><input type="checkbox" checked={!!s.auto_validate} onChange={e => setS(x => ({ ...x, auto_validate: e.target.checked }))} />Valider directement les écritures automatiques (sinon : brouillon à contrôler)</label>
          <details>
            <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Comptes utilisés par les écritures automatiques</summary>
            <div className="form-grid" style={{ marginTop: 10 }}>
              {Object.entries(ACCOUNT_LABELS).map(([k, l]) => (
                <Field key={k} label={l}><AccountInput value={s.accounts[k] || ''} onChange={v => setS(x => ({ ...x, accounts: { ...x.accounts, [k]: v } }))} /></Field>
              ))}
            </div>
          </details>
          <details>
            <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Format de l’export Sage</summary>
            <div className="form-grid" style={{ marginTop: 10 }}>
              <Field label="Séparateur"><select className="select" value={s.sage.separator} onChange={e => setS(x => ({ ...x, sage: { ...x.sage, separator: e.target.value } }))}><option value=";">Point-virgule</option><option value=",">Virgule</option><option value={'\t'}>Tabulation</option><option value="|">Barre verticale</option></select></Field>
              <Field label="Format de date"><select className="select" value={s.sage.date_format} onChange={e => setS(x => ({ ...x, sage: { ...x.sage, date_format: e.target.value } }))}>{['JJMMAAAA', 'JJMMAA', 'AAAAMMJJ', 'JJ/MM/AAAA'].map(v => <option key={v} value={v}>{v}</option>)}</select></Field>
              <Field label="Décimales"><select className="select" value={s.sage.decimal} onChange={e => setS(x => ({ ...x, sage: { ...x.sage, decimal: e.target.value } }))}><option value=",">Virgule</option><option value=".">Point</option></select></Field>
              <label className="checkbox" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={s.sage.header} onChange={e => setS(x => ({ ...x, sage: { ...x.sage, header: e.target.checked } }))} />Ligne d’en-tête</label>
            </div>
          </details>
        </fieldset>
        {write && <div><button className="btn btn-primary">Enregistrer les réglages</button></div>}
      </form>
    </Card>
  );
}

function Journals({ meta, write, onChange }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ code: '', label: '', kind: 'banque', account: '' });
  const [error, setError] = useState(null);
  const save = async () => {
    setError(null);
    try { await api.post('/admin/erp/compta/journals', { ...f, account: f.account || null }); toast('Journal créé'); setAdding(false); onChange(); } catch (e) { setError(e); }
  };
  return (
    <Card title="Journaux" bodyClass="" actions={write && <button className="btn btn-sm" onClick={() => setAdding(true)}><Plus />Journal</button>}>
      <table className="table">
        <thead><tr><th>Code</th><th>Journal</th><th>Compte</th></tr></thead>
        <tbody>{meta.journals.map(j => <tr key={j.id} style={{ opacity: j.active ? 1 : 0.5 }}><td className="tabular"><b>{j.code}</b></td><td className="small">{j.label}<div className="muted">{meta.journal_kinds[j.kind]}</div></td><td className="small tabular">{j.account_code || '—'}</td></tr>)}</tbody>
      </table>
      <p className="small muted" style={{ padding: '10px 16px' }}>Les versements clients vont en banque (virement, chèque), en caisse (espèces) ou en Mobile Money selon le moyen de paiement saisi. Ajoutez un journal par compte bancaire supplémentaire (avec un sous-compte 521…).</p>
      {adding && (
        <Modal title="Nouveau journal" onClose={() => setAdding(false)} footer={<><button className="btn btn-ghost" onClick={() => setAdding(false)}>Annuler</button><button className="btn btn-primary" onClick={save}>Créer</button></>}>
          <div className="form-grid">
            <div className="full"><ErrorBox error={error} /></div>
            <Field label="Code"><input className="input" maxLength={6} value={f.code} onChange={e => setF(x => ({ ...x, code: e.target.value.toUpperCase() }))} placeholder="BQ2" /></Field>
            <Field label="Type"><select className="select" value={f.kind} onChange={e => setF(x => ({ ...x, kind: e.target.value }))}>{Object.entries(meta.journal_kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Intitulé" className="full"><input className="input" value={f.label} onChange={e => setF(x => ({ ...x, label: e.target.value }))} placeholder="Banque SGCI" /></Field>
            {['banque', 'caisse', 'mobile'].includes(f.kind) && <Field label="Compte de trésorerie (classe 5)"><AccountInput value={f.account} onChange={v => setF(x => ({ ...x, account: v }))} classes={[5]} /></Field>}
          </div>
        </Modal>
      )}
    </Card>
  );
}
