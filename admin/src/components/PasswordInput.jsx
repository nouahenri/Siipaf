import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Champ de mot de passe avec un œil pour afficher ou masquer la saisie (connexion du dashboard et de l'ERP, changement
 * du mot de passe provisoire). Mêmes propriétés qu'un <input> ; se place dans un <Field>.
 */
export default function PasswordInput({ className = 'input', ...props }) {
  const [show, setShow] = useState(false);
  return (
    <span className="input-wrap">
      <input {...props} className={className} type={show ? 'text' : 'password'} spellCheck={false} />
      <button type="button" className="input-action" onClick={() => setShow(s => !s)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={show} title={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
        {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </button>
    </span>
  );
}
