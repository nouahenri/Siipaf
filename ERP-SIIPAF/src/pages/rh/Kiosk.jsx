import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Delete, LogIn, LogOut, CircleAlert } from 'lucide-react';
import { api } from '@admin/lib/api';
import { hm, RH, useRhMeta } from '../../lib/rh';

/**
 * Borne de pointage (référence : mode kiosque d'Odoo Présences) : tablette posée au chantier, ouverte par le
 * conducteur de travaux ; chaque ouvrier tape son matricule et son code. Retour à l'accueil après quelques secondes.
 */
export default function Kiosk() {
  const { meta } = useRhMeta();
  const [project, setProject] = useState(() => { try { return localStorage.getItem('siipaf-borne-chantier') || ''; } catch { return ''; } });
  const [matricule, setMatricule] = useState('EMP-');
  const [pin, setPin] = useState('');
  const [step, setStep] = useState('matricule');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(new Date());
  const timer = useRef(null);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { try { localStorage.setItem('siipaf-borne-chantier', project); } catch { /* stockage indisponible */ } }, [project]);

  const reset = () => { setMatricule('EMP-'); setPin(''); setStep('matricule'); setResult(null); };
  const later = () => { clearTimeout(timer.current); timer.current = setTimeout(reset, 5000); };
  const key = k => {
    if (result) reset();
    if (step === 'matricule') setMatricule(m => (k === '⌫' ? (m.length > 4 ? m.slice(0, -1) : m) : m.length < 12 ? m + k : m));
    else setPin(p => (k === '⌫' ? p.slice(0, -1) : p.length < 6 ? p + k : p));
  };
  const submit = async () => {
    if (step === 'matricule') { if (matricule.length > 4) setStep('pin'); return; }
    setBusy(true);
    try {
      const r = await api.post(`${RH}/attendance/kiosk`, { matricule, pin, project_id: Number(project) || null });
      setResult({ ok: true, ...r });
    } catch (e) { setResult({ ok: false, message: e.message }); } finally { setBusy(false); later(); }
  };
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];
  return (
    <div className="kiosk">
      <div className="kiosk-top">
        <Link to="/rh/presences" className="btn btn-ghost btn-sm"><ArrowLeft />Quitter la borne</Link>
        <select className="select" style={{ width: 'auto' }} value={project} onChange={e => setProject(e.target.value)} aria-label="Chantier de la borne"><option value="">Siège</option>{meta?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      <div className="kiosk-clock" aria-live="polite">{now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}<small>{now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</small></div>
      {result ? (
        <div className={`kiosk-result ${result.ok ? (result.action === 'arrivee' ? 'in' : 'out') : 'err'}`} role="status">
          {result.ok ? (result.action === 'arrivee' ? <LogIn /> : <LogOut />) : <CircleAlert />}
          {result.ok ? <><b>{result.action === 'arrivee' ? 'Bonjour' : 'Au revoir'} {result.employee.name}</b><span>{result.action === 'arrivee' ? `Arrivée pointée à ${hm(result.attendance.check_in)}` : `Départ pointé à ${hm(result.attendance.check_out)} · ${result.attendance.hours} h aujourd’hui`}</span></> : <><b>Pointage refusé</b><span>{result.message}</span></>}
          <button className="btn" onClick={reset}>Suivant</button>
        </div>
      ) : (
        <div className="kiosk-pad">
          <p className="kiosk-label">{step === 'matricule' ? 'Votre matricule' : 'Votre code personnel'}</p>
          <div className="kiosk-display" aria-live="polite">{step === 'matricule' ? matricule : '•'.repeat(pin.length) || ' '}</div>
          <div className="kiosk-keys">
            {digits.map(k => <button key={k} className={`kiosk-key ${k === 'OK' ? 'ok' : ''}`} disabled={busy || (k === 'OK' && (step === 'matricule' ? matricule.length <= 4 : pin.length < 4))} onClick={() => (k === 'OK' ? submit() : key(k))} aria-label={k === '⌫' ? 'Effacer' : k}>{k === '⌫' ? <Delete /> : k}</button>)}
          </div>
          {step === 'pin' && <button className="btn btn-ghost btn-sm" onClick={() => { setStep('matricule'); setPin(''); }}>Changer de matricule</button>}
        </div>
      )}
    </div>
  );
}
