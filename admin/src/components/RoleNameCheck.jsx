import { AlertTriangle, Info, Search } from 'lucide-react';

/**
 * Sous le champ « Nom du rôle » (dashboard › Rôles et privilèges, ERP › Nouveau rôle), pendant la frappe :
 * - rôle qui porte déjà ce nom : encadré rouge, création bloquée (comme au serveur) ;
 * - rôles au nom proche (féminin, pluriel, mots inversés) : encadré jaune, simple avertissement ;
 * - rôles existants dont un mot commence par ce qui est saisi (« juri » → « … / Juridique ») : liste neutre.
 * `onOpen(role)` (facultatif) ouvre le rôle existant au lieu d'en créer un autre.
 */
export default function RoleNameCheck({ dup, onOpen }) {
  const { same, close, matches = [], more = 0 } = dup;
  if (!same && !close.length && !matches.length) return null;
  const count = r => (r.users_total != null ? ` (${r.users_total} compte(s))` : '');
  const open = r => onOpen && !r.locked && <button type="button" className="role-dup-open" onClick={() => onOpen(r)}>Ouvrir « {r.label} »</button>;
  return (
    <>
      {same ? (
        <div className="role-dup role-dup-same" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>Le rôle <b>« {same.label} »</b>{count(same)} existe déjà. Choisissez un autre nom{onOpen && !same.locked ? ' ou modifiez ce rôle' : ''}. {open(same)}</span>
        </div>
      ) : close.length > 0 && (
        <div className="role-dup" role="status">
          <Info aria-hidden="true" />
          <span>
            Nom proche d’un rôle existant : {close.map((r, i) => <span key={r.id}>{i > 0 && ', '}<b>« {r.label} »</b>{count(r)}</span>)}.
            Vérifiez qu’il ne convient pas déjà avant d’en créer un autre. {close.length === 1 && open(close[0])}
          </span>
        </div>
      )}
      {matches.length > 0 && (
        <div className="role-dup role-dup-list" role="status">
          <Search aria-hidden="true" />
          <div>
            <span className="role-dup-title">Rôles existants qui correspondent</span>
            <ul>
              {matches.map(r => (
                <li key={r.id}>
                  {onOpen && !r.locked
                    ? <button type="button" className="role-dup-open" onClick={() => onOpen(r)}>{r.label}</button>
                    : <b>{r.label}</b>}
                  <span className="muted">{count(r)}</span>
                </li>
              ))}
            </ul>
            {more > 0 && <span className="muted">et {more} autre(s) : précisez le nom.</span>}
          </div>
        </div>
      )}
    </>
  );
}
