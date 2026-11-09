import { AlertTriangle, Info } from 'lucide-react';

/**
 * Sous le champ « Nom du rôle » (dashboard › Rôles et privilèges, ERP › Nouveau rôle) : signale pendant la saisie un rôle
 * qui porte déjà ce nom (création bloquée, comme au serveur) ou des rôles au nom proche (simple avertissement).
 * `onOpen(role)` (facultatif) ouvre le rôle existant au lieu d'en créer un autre.
 */
export default function RoleNameCheck({ dup, onOpen }) {
  const { same, close } = dup;
  if (!same && !close.length) return null;
  const count = r => (r.users_total != null ? ` (${r.users_total} compte(s))` : '');
  const open = r => onOpen && !r.locked && <button type="button" className="role-dup-open" onClick={() => onOpen(r)}>Ouvrir « {r.label} »</button>;
  return same ? (
    <div className="role-dup role-dup-same" role="alert">
      <AlertTriangle aria-hidden="true" />
      <span>Le rôle <b>« {same.label} »</b>{count(same)} existe déjà. Choisissez un autre nom{onOpen && !same.locked ? ' ou modifiez ce rôle' : ''}. {open(same)}</span>
    </div>
  ) : (
    <div className="role-dup" role="status">
      <Info aria-hidden="true" />
      <span>
        Nom proche d’un rôle existant : {close.map((r, i) => <span key={r.id}>{i > 0 && ', '}<b>« {r.label} »</b>{count(r)}</span>)}.
        Vérifiez qu’il ne convient pas déjà avant d’en créer un autre. {close.length === 1 && open(close[0])}
      </span>
    </div>
  );
}
