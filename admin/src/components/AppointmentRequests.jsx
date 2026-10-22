import { Link } from 'react-router-dom';
import { CalendarCheck, CalendarX, Phone, MessageCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { Drawer, Empty, ErrorBox, Skeleton } from './ui';
import { APPT_KINDS } from '../lib/domain';
import { dateTime, relative } from '../lib/format';

/**
 * Panneau de droite ouvert par la pastille du menu Rendez-vous : demandes venues du site encore « Demandé ».
 * Confirmer ou annuler les retire de la liste et du compteur.
 */
export default function AppointmentRequests({ onClose }) {
  const { can } = useAuth();
  const toast = useToast();
  const list = useResource('/admin/appointments?a_traiter=1');

  const decide = async (a, status) => {
    try {
      await api.patch(`/admin/appointments/${a.id}`, { status });
      list.setData(rows => rows.filter(x => x.id !== a.id));
      window.dispatchEvent(new Event('siipaf:notifications'));
      toast(status === 'confirme' ? `Rendez-vous de ${a.lead_name} confirmé` : `Rendez-vous de ${a.lead_name} annulé`);
    } catch (e) { toast(e.message, 'err'); }
  };

  const rows = list.data || [];
  return (
    <Drawer title="Rendez-vous demandés sur le site" onClose={onClose}
      footer={<Link className="btn" to="/rendez-vous" onClick={onClose}>Voir tous les rendez-vous</Link>}>
      <ErrorBox error={list.error} />
      {list.loading && !list.data ? <Skeleton h={220} /> : !rows.length ? (
        <Empty icon={CalendarCheck}>Aucune demande en attente. Les demandes faites sur le site (page Contact › Prendre rendez-vous) arrivent ici.</Empty>
      ) : (
        <ul className="appt-requests">
          {rows.map(a => (
            <li key={a.id} className="appt-request">
              <div className="appt-request-head">
                <strong>{a.lead_name}</strong>
                <span className="small muted">demandé {relative(a.created_at)}</span>
              </div>
              <div className="appt-request-when">{APPT_KINDS[a.kind] || a.kind} · {dateTime(a.starts_at)}</div>
              {a.project_name && <div className="small">{a.project_name}</div>}
              {a.notes && <p className="small muted appt-request-notes">{a.notes}</p>}
              <div className="row appt-request-actions">
                {a.lead_phone && <a className="btn btn-sm" href={`tel:${a.lead_phone}`}><Phone />Appeler</a>}
                {a.lead_phone && <a className="btn btn-sm" href={`https://wa.me/${a.lead_phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"><MessageCircle />WhatsApp</a>}
                {can('appointments:write') && <>
                  <button className="btn btn-sm btn-primary" onClick={() => decide(a, 'confirme')}><CalendarCheck />Confirmer</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => decide(a, 'annule')}><CalendarX />Annuler</button>
                </>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
