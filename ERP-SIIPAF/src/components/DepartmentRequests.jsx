/**
 * Demandes au nom du service (précision du client du 29/10), page « Demandes du service » du menu du module : le chef de
 * service désigné dans RH › Réglages exprime les besoins de travail de tout le service (achat, équipement,
 * intervention, prêt de matériel, véhicule…) ; même circuit que les demandes personnelles. Les membres du service
 * (fiche employé) suivent ces demandes ici. Rien n'est affiché à qui n'est ni chef ni membre du service.
 */
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Car, Users } from 'lucide-react';
import { useAuth, useResource } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, Badge, ErrorBox } from '@admin/components/ui';
import { date, relative } from '@admin/lib/format';
import { RequestDrawer } from '../pages/admin/Demandes';
import { REQUEST_TONES, RequestForm } from './MyRequests';
import { VehicleForm, RESERVATION_TONES, slotLabel } from './VehicleRequests';

const URL = '/admin/erp/demandes';

/** Page « Demandes du service » de la barre latérale du module. */
export function DepartmentPage({ department }) {
  return <DepartmentRequests department={department} page />;
}

export default function DepartmentRequests({ department, page = false }) {
  const espace = useOutletContext()?.espace;
  const { user } = useAuth();
  const refs = useResource(`${URL}/refs`);
  const mine = refs.data?.my_departments;
  const head = !!mine?.heads.includes(department);
  const allowed = !!mine && (head || mine.member === department || user?.role === 'super_admin');
  const list = useResource(allowed ? `${URL}?scope=department&department=${department}` : null);
  const vehicles = useResource(allowed ? `/admin/erp/parc/reservations?department=${department}` : null);
  const [form, setForm] = useState(null); // 'demande' | 'vehicule'
  const [open, setOpen] = useState(null);
  if (!allowed) return page && refs.data ? <Empty icon={Users}>Réservé au chef et aux membres du service (fiche employé, RH › Réglages).</Empty> : null;
  const label = refs.data.departments[department];
  // En cours d'abord ; les demandes closes des 30 derniers jours restent visibles
  const recent = new Date(Date.now() - 30 * 86400000).toISOString();
  const rows = (list.data || []).filter(r => r.open || r.created_at >= recent).sort((a, b) => Number(b.open) - Number(a.open));
  const now = new Date().toISOString().slice(0, 16);
  const trips = (vehicles.data || []).filter(v => v.end_at >= now && ['demandee', 'accordee'].includes(v.status));
  const reload = () => { list.reload(); vehicles.reload(); espace?.reload(); };
  const waiting = rows.filter(r => r.open).length + trips.filter(v => v.status === 'demandee').length;
  return (
    <Card
      title={<span className="row" style={{ gap: 8 }}>Demandes du service {label}{waiting > 0 && <Badge tone="warn">{waiting}</Badge>}</span>}
      actions={head ? (
        <div className="row" style={{ gap: 8 }}>
          <button className={`btn btn-primary${page ? '' : ' btn-sm'}`} onClick={() => setForm('demande')}><Plus />Demande du service</button>
          <button className={`btn btn-primary${page ? '' : ' btn-sm'}`} onClick={() => setForm('vehicule')}><Car />Véhicule</button>
        </div>
      ) : <span className="small muted">Faites par le chef du service</span>}
      bodyClass="">
      <ErrorBox error={list.error || vehicles.error} />
      {!list.data || !vehicles.data ? <div className="card-body"><Skeleton h={80} /></div> : !rows.length && !trips.length ? (
        <div className="card-body"><Empty icon={Users}>{head
          ? 'Besoins de travail de tout le service (fournitures, équipement, dépannage, prêt de matériel, véhicule) : même circuit que les demandes personnelles.'
          : 'Aucune demande du service en cours. Le chef du service, désigné dans RH › Réglages, les fait depuis cette page.'}</Empty></div>
      ) : (
        <div className="table-wrap"><table className="table table-compact"><tbody>
          {rows.map(r => (
            <tr key={`d${r.id}`} className="clickable" tabIndex={0} onClick={() => setOpen(r.id)} onKeyDown={e => e.key === 'Enter' && setOpen(r.id)}>
              <td><b>{r.title}</b><div className="small muted">{r.reference} · {r.kind_label} · {r.requested_by_name} · {relative(r.created_at)}{r.urgency === 'urgente' ? ' · urgente' : ''}</div></td>
              <td className="small nowrap">{r.needed_by ? `pour le ${date(r.needed_by)}` : ''}</td>
              <td className="right"><Badge tone={REQUEST_TONES[r.status]}>{r.status_label}</Badge></td>
            </tr>
          ))}
          {trips.map(v => (
            <tr key={`v${v.id}`}>
              <td><b><Car style={{ width: 14, height: 14, verticalAlign: '-2px' }} /> {v.purpose}</b><div className="small muted">Véhicule · {v.requested_by_name}{v.asset_name ? ` · ${v.asset_name}${v.asset_plate ? ` (${v.asset_plate})` : ''}` : ''}</div></td>
              <td className="small nowrap">{slotLabel(v)}</td>
              <td className="right"><Badge tone={RESERVATION_TONES[v.status]}>{v.status_label}</Badge></td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {form === 'demande' && <RequestForm department={department} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
      {form === 'vehicule' && <VehicleForm department={department} departmentLabel={label} onClose={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
      {open && <RequestDrawer id={open} refs={refs.data} onClose={() => setOpen(null)} onChange={reload} />}
    </Card>
  );
}
