import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, MessageCircle, Phone, CalendarCheck, Handshake, User } from 'lucide-react';
import { useResource } from '@admin/lib/app-context';
import { Card, Empty, Skeleton, ErrorBox, Badge, Drawer } from '@admin/components/ui';
import { dateTime, fcfa } from '@admin/lib/format';
import { APPT_KINDS } from '@admin/lib/domain';
import LeadDrawer from './LeadDrawer';

const FILTERS = [
  ['toutes', 'Toutes'], ['coordonnees', 'A laissé ses coordonnées'], ['rdv', 'Rendez-vous pris'], ['main', 'Passage de main'], ['sans', 'Sans coordonnées'],
];

/**
 * Service commercial › Conversations de Sita : les discussions de la conseillère IA du site public. Chaque conversation est
 * rattachée à la fiche du prospect quand le visiteur a laissé ses coordonnées. Cloisonné comme les prospects : sans la portée
 * « toute l’équipe », on ne voit que les conversations de ses propres fiches.
 */
export default function SitaConversations() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('toutes');
  const [q, setQ] = useState('');
  const [leadId, setLeadId] = useState(null);
  const open = Number(params.get('fiche')) || null;
  const list = useResource(`/admin/erp/commercial/sita?filtre=${filter}&q=${encodeURIComponent(q.trim())}`);
  const stats = useResource('/admin/erp/commercial/sita/stats');
  const s = stats.data;

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>Les discussions de Sita, la conseillère IA du site public. Une conversation est rattachée à la fiche du prospect dès qu’il laisse ses coordonnées. Les réglages de Sita (identité, budget, arrêt d’urgence) se font dans le dashboard › Contenu du site › Assistante du site.</p>
      {s && (
        <div className="kpi-row" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Badge>{s.month} conversation(s) ce mois-ci</Badge>
          <Badge tone="ok">{s.with_contact} avec coordonnées</Badge>
          <Badge tone="ok">{s.with_appointment} avec rendez-vous</Badge>
          <Badge tone={s.handed_over ? 'warn' : ''}>{s.handed_over} passage(s) de main</Badge>
        </div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select className="select" value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filtrer les conversations">
          {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input className="input" style={{ maxWidth: 260 }} type="search" placeholder="Nom, téléphone, programme…" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher" />
      </div>
      <ErrorBox error={list.error} />
      {!list.data ? <Skeleton h={300} /> : !list.data.length ? <Card><Empty icon={Bot}>Aucune conversation pour ce filtre.</Empty></Card> : (
        <Card bodyClass="">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Date</th><th>Visiteur</th><th>Programme</th><th>Premier message</th><th>Suites</th><th className="num">Coût</th></tr></thead>
            <tbody>
              {list.data.map(c => (
                <tr key={c.id} className="row-click" tabIndex={0} onClick={() => setParams({ fiche: c.id })} onKeyDown={e => e.key === 'Enter' && setParams({ fiche: c.id })}>
                  <td>{dateTime(c.last_message_at)}<div className="small muted">{c.messages_count} message(s)</div></td>
                  <td>{c.lead_name ? <><strong>{c.lead_name}</strong><div className="small muted">{c.lead_phone}{c.assigned_name ? ` · ${c.assigned_name}` : ' · à attribuer'}</div></> : <span className="muted">Anonyme</span>}</td>
                  <td>{c.project_name || '—'}</td>
                  <td className="small">{c.first_message}</td>
                  <td>
                    <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      {c.has_contact && <Badge tone="ok">Coordonnées</Badge>}
                      {c.appointment_id && <Badge tone="ok">Rendez-vous</Badge>}
                      {c.handed_over && <Badge tone="warn">Main passée</Badge>}
                      {c.mode === 'demo' && <Badge>Démo</Badge>}
                    </span>
                  </td>
                  <td className="num tabular">{c.mode === 'ia' ? fcfa(c.cost_fcfa) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      )}
      {open && <Detail id={open} onClose={() => setParams({})} onLead={setLeadId} />}
      {leadId && <LeadDrawer id={leadId} onClose={() => setLeadId(null)} onChange={() => list.reload()} />}
    </div>
  );
}

function Detail({ id, onClose, onLead }) {
  const res = useResource(`/admin/erp/commercial/sita/${id}`);
  const c = res.data;
  return (
    <Drawer title={c ? `Conversation n° ${c.id}` : 'Conversation'} onClose={onClose}>
      <ErrorBox error={res.error} />
      {!c ? (res.error ? null : <Skeleton h={300} />) : (
        <div className="stack">
          <div className="stack" style={{ gap: 6 }}>
            <div className="small muted"><MessageCircle className="ico" aria-hidden="true" />{dateTime(c.created_at)} · {c.messages_count} message(s) · {c.mode === 'ia' ? `IA, coût ${fcfa(c.cost_fcfa)}` : 'mode démonstration'}{c.campaign ? ` · campagne « ${c.campaign} »` : ''}</div>
            {c.project_name && <div className="small"><strong>Programme consulté :</strong> {c.project_name}</div>}
            {c.page_path && <div className="small muted">Page : {c.page_path}</div>}
            {c.lead_id ? (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="small"><User className="ico" aria-hidden="true" /><strong>{c.lead_name}</strong>{c.lead_phone && <> · <Phone className="ico" aria-hidden="true" />{c.lead_phone}</>} · {c.assigned_name || 'à attribuer'}</span>
                <button className="btn btn-sm" onClick={() => onLead(c.lead_id)}>Ouvrir la fiche prospect</button>
              </div>
            ) : <div className="small muted">Le visiteur n’a pas laissé ses coordonnées.</div>}
            {c.appointment_id && <div className="small"><CalendarCheck className="ico" aria-hidden="true" />Rendez-vous demandé : {APPT_KINDS[c.appointment_kind] || c.appointment_kind} le {dateTime(c.appointment_at)} (à confirmer dans Rendez-vous)</div>}
            {c.handed_over && <div className="small"><Handshake className="ico" aria-hidden="true" />Sita a passé la main à l’équipe (relais WhatsApp proposé).</div>}
            {c.lead_id && !c.consent_contact && <div className="small muted">Accord de recontact non enregistré.</div>}
            {c.summary && <div className="small"><strong>Résumé laissé sur la fiche :</strong> {c.summary}</div>}
          </div>
          <div className="stack" style={{ gap: 8 }} role="log" aria-label="Messages de la conversation">
            {c.messages.map(m => (
              <div key={m.id} style={{ alignSelf: m.role === 'visiteur' ? 'flex-start' : 'flex-end', maxWidth: '88%', padding: '8px 12px', borderRadius: 12, background: m.role === 'visiteur' ? 'var(--bg, #f3f4f6)' : 'var(--accent-soft, #fdecec)', whiteSpace: 'pre-wrap' }}>
                <div className="small muted">{m.role === 'visiteur' ? 'Visiteur' : 'Sita'} · {dateTime(m.at)}{m.role === 'assistante' && m.status !== 'ok' ? ` · ${m.status === 'corrige' ? 'réponse corrigée par les contrôles' : m.status === 'refuse_plafond' ? 'plafond atteint' : m.status}` : ''}</div>
                {m.content}
                {m.tools.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>Actions : {m.tools.map(t => `${t.name}${t.ok ? '' : ' (refusée)'}`).join(', ')}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}
