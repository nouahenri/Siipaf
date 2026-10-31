/**
 * Encart « Courriers affectés au service » des modules (Comptabilité, SAV, RH, Achats, Chantiers) : les courriers que le registre de
 * l'Administration générale a affectés au service (en cours, et traités depuis 30 jours). Chaque ligne ouvre la fiche du courrier.
 * Les courriers confidentiels restent masqués à qui n'a pas le droit de les voir.
 */
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { useResource } from '@admin/lib/app-context';
import { Card, Skeleton, ErrorBox, Badge, Empty } from '@admin/components/ui';
import { date } from '@admin/lib/format';

/** `departments` : services du registre du courrier (comptabilite, sav, rh, chantier, technique, administratif…), `label` : nom du service. */
export default function DepartmentMail({ departments, label }) {
  const res = useResource(`/admin/erp/courrier/service?departments=${[].concat(departments).join(',')}`);
  // Le registre est réservé au courrier, à la Direction et aux membres du service : sans accès, l'encart n'apparaît pas
  if (res.error) return res.error.status === 403 ? null : <ErrorBox error={res.error} />;
  const mail = res.data;
  return (
    <Card title={`Courriers affectés au service ${label}`} bodyClass="">
      {!mail ? <div className="card-body"><Skeleton h={60} /></div> : !mail.length ? <div className="card-body"><Empty icon={Mail}>Aucun courrier affecté au service en ce moment.</Empty></div> : (
        <ul className="list">
          {mail.map(m => (
            <li key={m.id}>
              <Link to={`/administration/courrier?fiche=${m.id}`} className="list-row">
                <span style={{ minWidth: 0, flex: 1 }}>
                  <strong className="ellipsis">{m.number} · {m.masked ? 'Courrier confidentiel' : m.subject}</strong>
                  {!m.masked && <span className="small muted ellipsis">{m.correspondent} · {m.suite_label || ''}</span>}
                </span>
                <span className="small nowrap">
                  {m.status === 'traite' ? <Badge tone="ok">Traité</Badge> : m.due_date ? <>{date(m.due_date)} {m.late && <Badge tone="danger">en retard</Badge>}</> : <Badge>{m.status_label}</Badge>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
