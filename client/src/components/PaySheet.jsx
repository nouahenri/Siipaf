/**
 * Payer en ligne depuis l'espace client (même parcours que l'application mobile, SiipafNative/src/components/client/PaySheet.tsx) :
 * 1. choix du moyen parmi ceux réglés dans le dashboard › Paramètres › Général (GET /payer) ;
 * 2. montant (modifiable, plafonné au reste à régler, paiements déjà déclarés déduits) ; « Payer » ouvre le lien marchand
 *    dans un nouvel onglet (montant transmis à Wave), le numéro marchand reste à copier en secours ;
 * 3. retour sur l'onglet : champ Référence prêt, capture du reçu facultative, puis déclaration « à confirmer » par la Comptabilité.
 * `line` absente : paiement volontaire, sans attendre la date d'une échéance ; une fois confirmé, il règle les échéances dans l'ordre.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, ChevronRight, CircleCheck, Copy, ExternalLink, ShieldCheck, Undo2, Wallet, X } from 'lucide-react';
import { api } from '../lib/api';
import { amount, fcfa } from '../lib/format';
import { useResource, useSession } from '../lib/session';
import { Alert, Empty, Sheet, Spinner } from './ui';

const LOGOS = {
  wave: '/logo_payment/wave-icon.png',
  orange_money: '/logo_payment/orange-money.png',
  mtn_money: '/logo_payment/mtn-money.png',
  moov_money: '/logo_payment/moov-money.png',
  paypal: '/logo_payment/paypal.svg',
};
/** Logos carrés à fond plein (couleur de la marque jusqu'au bord) : affichés tels quels. */
const FULL_BLEED = new Set(['wave', 'mtn_money', 'moov_money']);
const nameOf = ch => (ch.key === 'paypal' ? 'PayPal' : ch.label);

/** Lien marchand Wave : le montant saisi est passé dans `amount` (comme dans l'application). Les autres liens tels quels. */
export function withAmount(url, sum) {
  if (!/^https:\/\/pay\.wave\.com\//i.test(url) || !(sum > 0)) return url;
  const [base, hash = ''] = url.split('#');
  const [path, query = ''] = base.split('?');
  const params = query.split('&').filter(p => p && !/^amount=/i.test(p));
  params.push(`amount=${Math.round(sum)}`);
  return `${path}?${params.join('&')}${hash ? `#${hash}` : ''}`;
}

function Logo({ k, size = 46 }) {
  return (
    <span className={`pay-logo${FULL_BLEED.has(k) ? ' full' : ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <img src={LOGOS[k]} alt="" />
    </span>
  );
}

export function PaySheet({ dossier, line, onClose, onDeclared }) {
  const { client } = useSession();
  const channels = useResource('payer', () => api.get('/payer'));
  const pending = (dossier.declarations || []).filter(d => d.status === 'a_confirmer').reduce((s, d) => s + d.amount_fcfa, 0);
  const max = Math.max(0, dossier.remaining_fcfa - pending);
  const [ch, setCh] = useState(null);
  const [value, setValue] = useState(line ? String(Math.min(line.remaining_fcfa, max)) : '');
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [back, setBack] = useState(false);
  const [copied, setCopied] = useState(false);
  const away = useRef(false);
  const refInput = useRef(null);
  const fileInput = useRef(null);
  const sum = Number(value.replace(/\D/g, '')) || 0;

  // Revenu sur l'onglet après avoir payé : champ Référence prêt
  useEffect(() => {
    const onBack = () => {
      if (document.visibilityState !== 'visible' || !away.current) return;
      away.current = false;
      setBack(true);
      setTimeout(() => refInput.current?.focus(), 50);
    };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => { document.removeEventListener('visibilitychange', onBack); window.removeEventListener('focus', onBack); };
  }, []);

  const checkAmount = () => {
    if (sum <= 0) return 'Indiquez le montant à payer.';
    if (sum > max) return `Au plus ${fcfa(max)} (reste à régler${pending ? ', paiements déjà déclarés déduits' : ''}).`;
    return null;
  };
  const openLink = url => {
    const e = checkAmount();
    if (e) { setErrors({ amount: e }); return; }
    setErrors({});
    away.current = true;
    setLaunched(true);
    window.open(withAmount(url, sum), '_blank', 'noopener');
  };
  const copy = async text => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* copie refusée : le numéro reste affiché */ }
    away.current = true;
    setLaunched(true);
  };
  const pickProof = async file => {
    if (!file) return;
    const form = new FormData();
    form.append('files', file);
    setUploading(true); setError('');
    try { const [f] = await api.upload('/sav/files', form); setProof(f); } catch (e) { setError(e.message); }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
  };
  const submit = async e => {
    e?.preventDefault();
    const errs = {};
    const a = checkAmount();
    if (a) errs.amount = a.replace('à payer', 'payé');
    if (reference.trim().length < 3) errs.reference = 'Indiquez la référence de la transaction (reçue par SMS ou dans l’application de paiement).';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true); setError('');
    try {
      await api.post(`/dossiers/${dossier.id}/declarations`, { channel: ch.key, amount_fcfa: sum, reference: reference.trim(), schedule_id: line?.id || null, proof_file_id: proof?.id || null });
      setDone(true);
      onDeclared?.();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  // Parti payer sans déclarer : on demande avant de fermer
  const close = () => {
    if (launched && !done && !window.confirm('Fermer sans déclarer ?\n\nVotre paiement n’est pas encore déclaré. Sans déclaration, notre service comptable ne peut pas le rattacher à votre dossier.')) return;
    onClose();
  };

  const title = done ? 'Paiement déclaré' : ch ? `Payer avec ${ch.label}` : line ? `Régler : ${line.label}` : 'Paiement volontaire';
  const footer = done ? <button type="button" className="btn btn-primary btn-block" onClick={onClose}>Terminé</button>
    : ch ? <button className="btn btn-primary btn-block" form="pay-declare" disabled={busy}>{busy ? <Spinner /> : <Check aria-hidden="true" />}J’ai payé : déclarer ce paiement</button>
    : null;

  return (
    <Sheet title={title} onClose={close} footer={footer}>
      {done ? (
        <div className="pay-done">
          <span className="pay-done-icon"><CircleCheck aria-hidden="true" /></span>
          <h3 className="num">{fcfa(sum)} déclarés</h3>
          <p className="small">Notre service comptable vérifie la réception des fonds. Vous recevez une notification dès la confirmation, et le reçu apparaît dans « Versements ».</p>
        </div>
      ) : !ch ? (
        <>
          <div className="pay-box">
            <div className="small">{line ? 'Reste à régler sur cette échéance' : 'Vous pouvez verser jusqu’à'}</div>
            <div className="pay-big num">{amount(line ? line.remaining_fcfa : max)}<small>FCFA</small></div>
            {pending > 0 && <div className="small muted">{fcfa(pending)} déjà déclarés, en cours de vérification.</div>}
            {!line && <div className="small muted" style={{ marginTop: 4 }}>Montant libre, sans attendre la date d’une échéance : une fois confirmé, il règle vos prochaines échéances dans l’ordre.</div>}
          </div>
          <h3 className="pay-h">Choisissez votre moyen de paiement</h3>
          {channels.loading ? <p className="small muted">Chargement…</p>
            : channels.error ? <Alert>{channels.error.message}</Alert>
            : !channels.data?.length ? (
              <Empty icon={Wallet} title="Paiement en ligne bientôt disponible" text="En attendant, réglez par virement ou auprès de nos bureaux, et écrivez-nous dans Messages." />
            ) : (
              <div className="pay-list">
                {channels.data.map(x => (
                  <button key={x.key} type="button" className="pay-choice" onClick={() => setCh(x)} aria-label={`Payer avec ${x.label}`}>
                    <Logo k={x.key} size={52} />
                    <span className="pay-choice-main">
                      <strong>{x.label}</strong>
                      <span className="small muted">{x.link ? `Paiement direct sur ${nameOf(x)}` : `Numéro marchand ${x.number}`}</span>
                    </span>
                    {x.key === 'paypal' && <img src="/logo_payment/visa.svg" alt="Visa" width="38" height="13" />}
                    <ChevronRight aria-hidden="true" className="row-chevron" />
                  </button>
                ))}
              </div>
            )}
          <p className="pay-note small"><ShieldCheck aria-hidden="true" />Le paiement est confirmé par la Comptabilité de SIIPAF avant d’être compté ; le reçu officiel suit.</p>
        </>
      ) : (
        <form id="pay-declare" onSubmit={submit} noValidate>
          <button type="button" className="pay-back" onClick={() => { setCh(null); setLaunched(false); setBack(false); }}><ArrowLeft aria-hidden="true" />Autre moyen</button>
          <Alert>{error}</Alert>
          <label className="field">
            <span className="field-label">Montant à payer (FCFA)</span>
            <input className="input num" inputMode="numeric" value={value} onChange={e => setValue(e.target.value.replace(/[^\d ]/g, ''))} aria-invalid={!!errors.amount} />
            {errors.amount ? <span className="hint" style={{ color: 'var(--danger)' }}>{errors.amount}</span>
              : <span className="hint">Reste à régler sur le dossier : {fcfa(max)}. Vous pouvez payer une partie.</span>}
          </label>

          {/* Étape 1 : payer (lien marchand prioritaire, numéro en secours) */}
          <div className="pay-step">
            <Logo k={ch.key} size={60} />
            <div className="pay-step-main">
              <strong>1. Payez {fcfa(sum)} avec {ch.label}</strong>
              {ch.link && <button type="button" className="btn btn-dark btn-sm btn-block" onClick={() => openLink(ch.link)}><ExternalLink aria-hidden="true" />Payer sur {nameOf(ch)}</button>}
              {ch.number && (
                <button type="button" className="pay-number" onClick={() => copy(ch.number)} aria-label={`Copier le numéro marchand ${ch.number}`}>
                  <span><span className="small muted">{ch.link ? 'Ou au numéro marchand' : 'Numéro marchand SIIPAF'}</span><strong className="num">{ch.number}</strong></span>
                  <span className="pay-copy">{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}<span className="pay-copy-label">{copied ? 'Copié' : 'Copier'}</span></span>
                </button>
              )}
              <span className="small muted">Indiquez en motif votre code client{client?.client_code ? <> <strong style={{ color: 'var(--ink)' }}>{client.client_code}</strong></> : null}.</span>
            </div>
          </div>

          {back && (
            <div className="callout info" role="status" style={{ marginBottom: 14 }}>
              <span className="callout-icon"><Undo2 aria-hidden="true" /></span>
              <span className="callout-body"><span className="callout-title">De retour de {nameOf(ch)}</span><span className="callout-text" style={{ display: 'block' }}>Saisissez la référence de la transaction ci-dessous puis déclarez votre paiement.</span></span>
            </div>
          )}

          {/* Étape 2 : déclarer avec la référence (capture du reçu facultative) */}
          <h3 className="pay-h">2. Déclarez votre paiement</h3>
          <label className="field">
            <span className="field-label">Référence de la transaction *</span>
            <input ref={refInput} className="input code" value={reference} onChange={e => setReference(e.target.value)} placeholder="Ex. : WV2611041234" autoComplete="off" aria-invalid={!!errors.reference} maxLength={120} />
            {errors.reference ? <span className="hint" style={{ color: 'var(--danger)' }}>{errors.reference}</span>
              : <span className="hint">Elle figure dans le SMS de confirmation ou dans l’historique de votre application.</span>}
          </label>
          {proof ? (
            <div className="pay-proof">
              <img src={proof.url} alt="" />
              <span>Capture du reçu jointe</span>
              <button type="button" className="icon-btn" onClick={() => setProof(null)} aria-label="Retirer la capture"><X aria-hidden="true" /></button>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost btn-block" onClick={() => fileInput.current?.click()} disabled={uploading}>
              {uploading ? <Spinner /> : <Camera aria-hidden="true" />}{uploading ? 'Envoi de la capture…' : 'Joindre une capture du reçu (facultatif)'}
            </button>
          )}
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={e => pickProof(e.target.files?.[0])} />
        </form>
      )}
    </Sheet>
  );
}
