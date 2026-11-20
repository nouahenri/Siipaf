import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Check, ChevronRight, Clock, Landmark, MessageCircle, Receipt as ReceiptIcon, Wallet } from 'lucide-react';
import { useSession, useResource } from '../lib/session';
import { api } from '../lib/api';
import { amount, date, daysUntil, fcfa, plural, shortDate } from '../lib/format';
import { INSTALLMENT_STATUS, PAYMENT_METHODS } from '../lib/domain';
import { Badge, Empty, ErrorState, PageHead, PageSkeleton, PayBar, Pager, Sheet } from '../components/ui';
import { NoDossier } from './Home';
import { PaySheet } from '../components/PaySheet';

export const useDossier = id => useResource(id ? `dossier:${id}` : null, () => api.get(`/dossiers/${id}`));

const FILTERS = [
  ['tout', 'Tout'],
  ['a_venir', 'À venir'],
  ['en_retard', 'En retard'],
  ['payee', 'Payées'],
];

function Summary({ d }) {
  return (
    <section className="summary-dark reveal reveal-2" aria-label="Situation financière">
      <div className="money-label">Reste à payer</div>
      <div className="money-big num" style={{ color: '#fff' }}>{amount(d.remaining_fcfa)}<small>FCFA</small></div>
      <PayBar percent={d.percent_paid} />
      <div className="money-split">
        <div><div className="money-label">Déjà versé · {d.percent_paid} %</div><strong className="num">{fcfa(d.paid_fcfa)}</strong></div>
        <div><div className="money-label">Prix du bien</div><strong className="num">{fcfa(d.price_fcfa)}</strong></div>
      </div>
      {d.financing_label && <div className="summary-plan"><Landmark aria-hidden="true" />{d.financing_label}</div>}
    </section>
  );
}

const ICONS = { payee: Check, en_retard: AlertTriangle, partielle: Clock, a_venir: CalendarDays };

const PAGE_SIZE = 10;

/**
 * Quels versements ont réglé chaque échéance : les versements sont imputés dans l'ordre des dates,
 * sur les échéances dans l'ordre (même règle que le serveur).
 */
function allocate(lines, payments) {
  const pays = [...payments].sort((a, b) => (a.paid_at === b.paid_at ? a.id - b.id : a.paid_at < b.paid_at ? -1 : 1))
    .map(p => ({ ...p, left: Number(p.amount_fcfa) }));
  const out = {};
  let i = 0;
  for (const l of [...lines].sort((a, b) => a.seq - b.seq)) {
    let due = Number(l.amount_fcfa);
    out[l.seq] = [];
    while (due > 0 && i < pays.length) {
      const take = Math.min(due, pays[i].left);
      if (take > 0) out[l.seq].push({ id: pays[i].id, receipt_number: pays[i].receipt_number, paid_at: pays[i].paid_at, amount: take });
      due -= take;
      pays[i].left -= take;
      if (pays[i].left <= 0) i++;
    }
  }
  return out;
}

function InstallmentSheet({ line, total, allocations, declarations, onPay, onClose }) {
  const st = INSTALLMENT_STATUS[line.status];
  const days = daysUntil(line.due_date);
  const timing = line.status === 'payee' ? null
    : days < 0 ? `En retard de ${plural(-days, 'jour', 'jours')}`
    : days === 0 ? 'À régler aujourd’hui'
    : `Dans ${plural(days, 'jour', 'jours')}`;
  return (
    <Sheet title={line.label} onClose={onClose}
      footer={line.status !== 'payee' && (
        <>
          <button type="button" className="btn btn-primary btn-block" onClick={() => onPay(line)}><Wallet aria-hidden="true" />Régler</button>
          <Link to="/messages" className="btn btn-ghost btn-block" onClick={onClose}><MessageCircle aria-hidden="true" />Une question ? Écrire à SIIPAF</Link>
        </>
      )}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Badge tone={st.tone}>{st.label}</Badge>
        {timing && <span className="small" style={{ color: days < 0 ? 'var(--danger)' : 'var(--ink-3)' }}>{timing}</span>}
      </div>
      <div className="detail-amount" style={{ marginTop: 14 }}>
        {amount(line.status === 'payee' ? line.amount_fcfa : line.remaining_fcfa)}<small>FCFA {line.status === 'payee' ? 'réglés' : 'à régler'}</small>
      </div>
      <dl className="detail-list">
        <dt>Échéance</dt><dd>{date(line.due_date)}</dd>
        <dt>Montant de l’échéance</dt><dd>{fcfa(line.amount_fcfa)}</dd>
        <dt>Déjà réglé</dt><dd style={{ color: line.paid_fcfa ? 'var(--ok)' : undefined }}>{fcfa(line.paid_fcfa)}</dd>
        <dt>Reste à régler</dt><dd>{fcfa(line.remaining_fcfa)}</dd>
        <dt>Position</dt><dd>{line.seq} sur {total}</dd>
      </dl>
      <div className="detail-section">
        <h3>Réglée par</h3>
        {!allocations.length ? <p className="small muted">Aucun versement imputé pour l’instant.</p> : allocations.map(a => (
          <Link key={a.id} to={`/paiements/recu/${a.id}`} className="alloc" onClick={onClose}>
            <span><ReceiptIcon aria-hidden="true" width={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{a.receipt_number} · {shortDate(a.paid_at)}</span>
            <strong className="num">{fcfa(a.amount)}</strong>
          </Link>
        ))}
      </div>
      {/* Paiements déclarés en ligne pour cette échéance (ou sans échéance : paiement volontaire) */}
      {declarations.filter(x => !x.schedule_id || x.schedule_id === line.id).map(x => (
        <div key={x.id} className={`callout ${x.status === 'rejete' ? 'danger' : 'info'}`} style={{ marginTop: 14 }}>
          <span className="callout-icon">{x.status === 'rejete' ? <AlertTriangle aria-hidden="true" /> : <Clock aria-hidden="true" />}</span>
          <span className="callout-body">
            <span className="callout-title">{x.status === 'rejete' ? `Paiement de ${fcfa(x.amount_fcfa)} non confirmé` : `${fcfa(x.amount_fcfa)} déclarés, en vérification`}</span>
            <span className="callout-text" style={{ display: 'block' }}>{x.status === 'rejete' ? x.reject_reason || 'Voir le message du service comptable.' : `Réf. ${x.reference || '—'} · confirmé par la Comptabilité sous peu`}</span>
          </span>
        </div>
      ))}
      {line.status !== 'payee' && (
        <div className="detail-section">
          <h3>Comment payer</h3>
          <p className="small" style={{ color: 'var(--ink-2)' }}>Cliquez sur « Régler » : Wave, Orange Money, MTN MoMo, Moov Money ou PayPal / carte Visa, puis déclarez votre paiement. Le reçu apparaît ici dès sa confirmation par notre service comptable.</p>
        </div>
      )}
    </Sheet>
  );
}

function Schedule({ lines, payments, declarations, onPay }) {
  const [filter, setFilter] = useState(() => (lines.some(l => l.status === 'en_retard') ? 'en_retard' : 'a_venir'));
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const counts = useMemo(() => {
    const c = { tout: lines.length, a_venir: 0, en_retard: 0, payee: 0 };
    lines.forEach(l => { if (l.status === 'partielle') c.a_venir++; else c[l.status]++; });
    return c;
  }, [lines]);
  const allocations = useMemo(() => allocate(lines, payments), [lines, payments]);
  const shown = lines.filter(l => filter === 'tout' || l.status === filter || (filter === 'a_venir' && l.status === 'partielle'));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const pageLines = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  if (!lines.length) {
    return <div className="card"><Empty icon={CalendarDays} title="Échéancier en préparation" text="Votre échéancier sera disponible dès qu’il aura été établi par notre service comptable." /></div>;
  }

  let year = null;
  return (
    <>
      <div className="chips" role="group" aria-label="Filtrer les échéances" style={{ marginBottom: 12 }}>
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" className="chip" aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(1); }}>
            {label}<span className="count">{counts[id]}</span>
          </button>
        ))}
      </div>
      <div className="card">
        {shown.length === 0 ? <Empty title="Rien à afficher" text={filter === 'en_retard' ? 'Aucune échéance en retard. Merci !' : 'Aucune échéance dans cette catégorie.'} /> : (
          <ul className="rows">
            {pageLines.map(l => {
              const st = INSTALLMENT_STATUS[l.status];
              const Icon = ICONS[l.status];
              const y = l.due_date.slice(0, 4);
              const header = y !== year ? (year = y) : null;
              return (
                <li key={l.id ?? l.seq} style={{ display: 'contents' }}>
                  {header && <div className="row-group">{header}</div>}
                  <button type="button" onClick={() => setOpen(l)} aria-label={`${l.label}, ${st.label}, échéance du ${shortDate(l.due_date)} : voir le détail`}
                    className={`row${l.status === 'en_retard' ? ' is-late' : ''}${l.status === 'payee' ? ' is-paid' : ''}`}>
                    <span className="row-icon"><Icon aria-hidden="true" /></span>
                    <div className="row-main">
                      <div className="row-title">{l.label}</div>
                      <div className="row-sub">Échéance du {shortDate(l.due_date)}</div>
                    </div>
                    <div className="row-end">
                      <div className={`row-amount${l.status === 'payee' ? ' strike' : ''}`}>{fcfa(l.status === 'payee' ? l.amount_fcfa : l.remaining_fcfa)}</div>
                      <div style={{ marginTop: 4 }}><Badge tone={st.tone}>{st.label}</Badge></div>
                    </div>
                    <ChevronRight className="row-chevron" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <Pager page={current} pages={pages} onPage={setPage} label="Pages de l’échéancier" />
      </div>
      {open && <InstallmentSheet line={open} total={lines.length} allocations={allocations[open.seq] || []} declarations={declarations} onPay={l => { setOpen(null); onPay(l); }} onClose={() => setOpen(null)} />}
    </>
  );
}

function Payments({ payments }) {
  if (!payments.length) {
    return <div className="card"><Empty icon={Wallet} title="Aucun versement enregistré" text="Vos versements apparaîtront ici dès leur enregistrement par notre service comptable, avec leur reçu." /></div>;
  }
  return (
    <div className="card">
      <ul className="rows">
        {payments.map(p => (
          <li key={p.id}>
            <Link to={`/paiements/recu/${p.id}`} className="row is-paid" aria-label={`Reçu ${p.receipt_number}, ${fcfa(p.amount_fcfa)} le ${shortDate(p.paid_at)}`}>
              <span className="row-icon"><ReceiptIcon aria-hidden="true" /></span>
              <div className="row-main">
                <div className="row-title num">{fcfa(p.amount_fcfa)}</div>
                <div className="row-sub">{shortDate(p.paid_at)} · {PAYMENT_METHODS[p.method]}</div>
              </div>
              <div className="row-end" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-3)', fontSize: 13 }}>
                Reçu <ChevronRight aria-hidden="true" width={18} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Paiements() {
  const { selected } = useSession();
  const { data: d, error, loading, reload } = useDossier(selected?.id);
  const [tab, setTab] = useState('echeancier');
  // Échéance à régler, « libre » pour un paiement volontaire (sans échéance), null si fermé
  const [paying, setPaying] = useState(null);

  if (!selected) return <NoDossier />;
  if (loading) return <PageSkeleton />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  const pending = (d.declarations || []).filter(x => x.status === 'a_confirmer').reduce((s, x) => s + x.amount_fcfa, 0);

  return (
    <>
      <PageHead eyebrow={`Lot ${d.property.lot_code} · ${d.property.project.name}`} title="Mes paiements" />
      <div className="grid grid-home">
        <div>
          <Summary d={d} />
          {d.overdue_count > 0 && (
            <div className="callout danger" style={{ marginTop: 14 }} role="status">
              <span className="callout-icon"><AlertTriangle aria-hidden="true" /></span>
              <span className="callout-body">
                <span className="callout-title">{plural(d.overdue_count, 'échéance en retard', 'échéances en retard')} · {fcfa(d.overdue_fcfa)}</span>
                <span className="callout-text" style={{ display: 'block' }}>Cliquez sur une échéance puis « Régler » : Wave, Orange Money, MTN MoMo, Moov Money ou PayPal / carte Visa. Votre conseiller reste disponible.</span>
              </span>
            </div>
          )}
          {/* Paiement volontaire : verser quand le client le souhaite, sans attendre la date d'une échéance (même sans échéancier) */}
          {d.status !== 'desiste' && d.remaining_fcfa > 0 && (
            <div className="pay-free">
              <button type="button" className="btn btn-ghost btn-block" onClick={() => setPaying('libre')}><Wallet aria-hidden="true" />Faire un paiement volontaire</button>
              {pending > 0 && <p className="small muted" style={{ textAlign: 'center' }}>{fcfa(pending)} déclarés, en vérification par notre service comptable.</p>}
            </div>
          )}
        </div>
        <div>
          <div className="segmented" role="group" aria-label="Affichage" style={{ marginBottom: 14 }}>
            <button type="button" aria-pressed={tab === 'echeancier'} onClick={() => setTab('echeancier')}>Échéancier</button>
            <button type="button" aria-pressed={tab === 'versements'} onClick={() => setTab('versements')}>Versements · {d.payments.length}</button>
          </div>
          {tab === 'echeancier' ? <Schedule lines={d.schedule} payments={d.payments} declarations={d.declarations || []} onPay={setPaying} /> : <Payments payments={d.payments} />}
          {tab === 'echeancier' && d.vefa_upcoming?.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="row-group">Prochains appels de fonds · selon l’avancement du chantier</div>
              {d.vefa_upcoming.map(c => (
                <div key={c.seq} className="row">
                  <span className="row-icon"><Landmark aria-hidden="true" /></span>
                  <span className="row-main"><span className="row-title">{c.label}</span><span className="row-sub" style={{ display: 'block' }}>{c.pct} % du prix · appelé à l’achèvement de l’étape</span></span>
                  <span className="row-end row-amount">{fcfa(c.amount_fcfa)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {paying && <PaySheet dossier={d} line={paying === 'libre' ? null : paying} onDeclared={reload} onClose={() => setPaying(null)} />}
    </>
  );
}
