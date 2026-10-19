import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function PasswordInput({ label, value, onChange, autoComplete = 'current-password', hint, strength, autoFocus }) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <span className="input-wrap" style={{ display: 'block' }}>
        <input id={id} className="input" type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
          autoComplete={autoComplete} autoFocus={autoFocus} required spellCheck={false} />
        <button type="button" className="input-action" onClick={() => setShow(s => !s)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
          {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </span>
      {strength && <span className="strength" data-level={level(value)} aria-hidden="true"><span /><span /><span /><span /></span>}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Indication simple de robustesse (0 à 4). */
export function level(pw) {
  if (!pw) return 0;
  let n = 0;
  if (pw.length >= 10) n++;
  if (pw.length >= 14) n++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) n++;
  return Math.max(1, n);
}
