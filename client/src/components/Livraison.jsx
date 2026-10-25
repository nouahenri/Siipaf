/**
 * Espace client › Chantier (lot 5, choix du client du 25/10) : travaux modificatifs (demande, devis à accepter ou
 * refuser — accepté, le montant s'ajoute aux paiements) et livraison du lot (procès-verbal, réserves et leur levée).
 */
import { useState } from 'react';
import { Wrench, Plus, Check, X, KeyRound, FileText } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useDossier } from '../pages/Paiements';
import { dayLabel } from '../lib/format';
import { Alert, Badge, Empty, SectionHead, Sheet, useToast } from './ui';

const fcfa = n => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;
const TONES = { demandee: 'muted', chiffree: 'gold', acceptee: 'ok', refusee: 'danger', realisee: 'ok' };

export default function Livraison({ saleId }) {
  const { invalidate } = useSession();
  const dossier = useDossier(saleId);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [toast, say] = useToast();
  const d = dossier.data;
  if (!d) return null;
  const refresh = msg => { invalidate('dossier:'); invalidate('dossiers'); dossier.reload(); if (msg) say(msg); };
  const { changes = [], delivery } = d;

  return (
    <>
      {(changes.length > 0 || d.can_request_changes) && (
        <section className="section">
          <SectionHead title="Travaux modificatifs">
            {d.can_request_changes && <button className="btn btn-dark btn-sm" onClick={() => setAsking(true)}><Plus aria-hidden="true" />Demander</button>}
          </SectionHead>
          {changes.length === 0 ? (
            <div className="card"><Empty icon={Wrench} title="Aucune demande" text="Un aménagement à modifier (carrelage, prises, cloisons…) ? Demandez-le avant la livraison : nous vous adressons un devis à accepter ici." /></div>
          ) : (
            <div className="card">
              <ul className="rows">
                {changes.map(t => (
                  <li key={t.id} className="row" style={{ cursor: 'default' }}>
                    <span className="row-icon"><Wrench aria-hidden="true" /></span>
                    <div className="row-main">
                      <div className="row-title">{t.title}</div>
                      <div className="row-sub">
                        {t.reference}{t.delay_days ? ` · réalisation en ${t.delay_days} jours` : ''}
                        {t.due_date && ` · à régler avant le ${dayLabel(t.due_date).toLowerCase()}`}
                        {t.quote_note && <><br />{t.quote_note}</>}
                      </div>
                      {t.can_answer && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => setAnswer({ t, accept: true })}><Check aria-hidden="true" />Accepter le devis</button>
                          <button className="btn btn-sm" onClick={() => setAnswer({ t, accept: false })}><X aria-hidden="true" />Refuser</button>
                        </div>
                      )}
                    </div>
                    <div className="row-end">
                      {t.amount_fcfa != null && <div className="row-amount">{fcfa(t.amount_fcfa)}</div>}
                      <div style={{ marginTop: 4 }}><Badge tone={TONES[t.status] || 'muted'}>{t.status === 'demandee' ? 'Devis en préparation' : t.status_label}</Badge></div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {delivery?.handover && (
        <section className="section">
          <SectionHead title="Livraison de votre bien" />
          <div className="card card-pad">
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="row-icon"><KeyRound aria-hidden="true" /></span>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="row-title">Réceptionné le {dayLabel(delivery.handover.handed_on).toLowerCase()}</div>
                <div className="row-sub">{delivery.handover.client_signed ? 'Procès-verbal signé' : 'Procès-verbal établi'} · vos garanties courent depuis cette date</div>
              </div>
              {delivery.handover.pv_url && <a className="btn btn-sm" href={delivery.handover.pv_url} target="_blank" rel="noreferrer"><FileText aria-hidden="true" />Voir le PV</a>}
            </div>
            {delivery.reserves.length > 0 ? (
              <ul className="rows" style={{ marginTop: 14 }}>
                {delivery.reserves.map(r => (
                  <li key={r.id} className="row" style={{ cursor: 'default' }}>
                    <div className="row-main">
                      <div className="row-title">{r.label}</div>
                      <div className="row-sub">{[r.location, r.category_label].filter(Boolean).join(' · ')}{r.deadline && r.status === 'ouverte' ? ` · levée prévue avant le ${dayLabel(r.deadline).toLowerCase()}` : ''}</div>
                    </div>
                    <div className="row-end"><Badge tone={r.status === 'levee' ? 'ok' : 'gold'}>{r.status === 'levee' ? 'Levée' : 'En cours'}</Badge></div>
                  </li>
                ))}
              </ul>
            ) : <p className="muted" style={{ marginTop: 12, fontSize: 14 }}>Aucune réserve n’a été notée à la réception.</p>}
          </div>
        </section>
      )}

      {asking && <AskSheet saleId={saleId} onClose={() => setAsking(false)} onDone={() => { setAsking(false); refresh('Demande envoyée : nous vous adressons un devis'); }} />}
      {answer && <AnswerSheet {...answer} onClose={() => setAnswer(null)} onDone={msg => { setAnswer(null); refresh(msg); }} />}
      {toast}
    </>
  );
}

function AskSheet({ saleId, onClose, onDone }) {
  const [f, setF] = useState({ title: '', description: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api.post(`/dossiers/${saleId}/tma`, { title: f.title.trim(), description: f.description.trim() || undefined }); onDone(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Sheet title="Demander des travaux modificatifs" onClose={onClose} footer={(
      <button className="btn btn-primary btn-block" form="tma-ask" disabled={busy || f.title.trim().length < 3}>Envoyer la demande</button>
    )}>
      <form id="tma-ask" onSubmit={submit}>
        {error && <Alert>{error}</Alert>}
        <label className="field">
          <span className="field-label">Travaux souhaités</span>
          <input className="input" required minLength={3} maxLength={200} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Carrelage grand format au séjour, prise supplémentaire…" />
        </label>
        <label className="field">
          <span className="field-label">Précisions (facultatif)</span>
          <textarea className="input" rows={4} maxLength={4000} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="Pièce, matériaux, références…" />
        </label>
        <p className="muted" style={{ fontSize: 13 }}>Le conducteur de travaux chiffre votre demande ; vous recevez le devis ici et l’acceptez ou le refusez.</p>
      </form>
    </Sheet>
  );
}

function AnswerSheet({ t, accept, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api.post(`/tma/${t.id}/reponse`, { accept, note: note.trim() || undefined });
      onDone(accept ? 'Devis accepté : l’échéance figure dans vos paiements' : 'Devis refusé');
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Sheet title={accept ? 'Accepter le devis' : 'Refuser le devis'} onClose={onClose} footer={(
      <button className={`btn btn-block ${accept ? 'btn-primary' : 'btn-dark'}`} onClick={submit} disabled={busy}>{accept ? `Accepter (${fcfa(t.amount_fcfa)})` : 'Confirmer le refus'}</button>
    )}>
      {error && <Alert>{error}</Alert>}
      <p style={{ marginTop: 0 }}><strong>{t.title}</strong> — {fcfa(t.amount_fcfa)}{t.delay_days ? `, réalisation en ${t.delay_days} jours` : ''}.</p>
      <p className="muted" style={{ fontSize: 14 }}>{accept ? 'En acceptant, ce montant s’ajoute à votre échéancier, à régler à la date indiquée dans « Paiements ».' : 'Les travaux ne seront pas réalisés. Vous pouvez préciser la raison.'}</p>
      <label className="field">
        <span className="field-label">{accept ? 'Un mot pour l’équipe (facultatif)' : 'Raison (facultatif)'}</span>
        <textarea className="input" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} />
      </label>
    </Sheet>
  );
}
