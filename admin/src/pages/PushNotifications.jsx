/**
 * Notifications push (Ventes) : annonce envoyée aux téléphones où l'application SIIPAF est installée avec « Recevoir des
 * notifications push » activé dans ses Paramètres (visiteurs et clients). Cible : tous, ou la ville préférée choisie dans
 * l'application ; le toucher ouvre le programme choisi (sinon l'accueil). Historique des envois.
 * Les notifications du dossier d'un client (messages, paiements, chantier, documents, SAV) partent seules depuis l'ERP.
 */
import { useState } from 'react';
import { BellRing, Send, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth, useResource, useToast } from '../lib/app-context';
import { Card, Field, Badge, Empty, ErrorBox, Skeleton, Modal } from '../components/ui';
import { dateTime } from '../lib/format';

const TITLE_MAX = 80;
const BODY_MAX = 240;
const EMPTY = { title: '', body: '', city_id: '', project_id: '' };

export default function PushNotifications() {
  const { can } = useAuth();
  const toast = useToast();
  const res = useResource('/admin/push');
  const [form, setForm] = useState(EMPTY);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const data = res.data;
  const city = data?.cities.find(c => String(c.id) === form.city_id);
  const recipients = form.city_id ? city?.devices || 0 : data?.devices || 0;
  const project = data?.projects.find(p => String(p.id) === form.project_id);
  const valid = form.title.trim().length >= 3 && form.body.trim().length >= 5 && recipients > 0;

  const send = async () => {
    setBusy(true);
    try {
      const out = await api.post('/admin/push', {
        title: form.title.trim(), body: form.body.trim(),
        city_id: form.city_id ? Number(form.city_id) : null, project_id: form.project_id ? Number(form.project_id) : null,
      });
      toast(`Notification envoyée à ${out.recipients} téléphone${out.recipients > 1 ? 's' : ''}`);
      setForm(EMPTY); setConfirm(false); res.reload();
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };

  if (res.error) return <ErrorBox error={res.error} />;
  return (
    <div className="stack">
      <div className="grid grid-3">
        <div className="card kpi"><span className="kpi-label"><Smartphone aria-hidden="true" />Téléphones inscrits</span><span className="kpi-value">{data ? data.devices.toLocaleString('fr-FR') : <Skeleton h={30} w={60} />}</span>
          <span className="kpi-foot small muted">Application installée, notifications activées</span></div>
        <div className="card kpi"><span className="kpi-label"><BellRing aria-hidden="true" />Annonces envoyées</span><span className="kpi-value">{data ? data.rows.length.toLocaleString('fr-FR') : <Skeleton h={30} w={60} />}</span>
          <span className="kpi-foot small muted">50 dernières affichées ci-dessous</span></div>
        <div className="card kpi"><span className="kpi-label"><Smartphone aria-hidden="true" />Avec une ville préférée</span><span className="kpi-value">{data ? data.cities.reduce((n, c) => n + c.devices, 0).toLocaleString('fr-FR') : <Skeleton h={30} w={60} />}</span>
          <span className="kpi-foot small muted">Choisie dans Paramètres de l’application</span></div>
      </div>

      {can('push:send') && (
        <Card title="Nouvelle notification">
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(260px, 1fr)', gap: 24, alignItems: 'start' }}>
            <div className="form-grid">
              <Field label="Titre" hint={`${form.title.length}/${TITLE_MAX} : court, il s’affiche en gras`} className="full">
                <input className="input" value={form.title} maxLength={TITLE_MAX} onChange={set('title')} placeholder="Ex. Nouveau programme à Bingerville" />
              </Field>
              <Field label="Texte" hint={`${form.body.length}/${BODY_MAX} : le téléphone coupe au-delà de deux ou trois lignes`} className="full">
                <textarea className="textarea" rows={3} value={form.body} maxLength={BODY_MAX} onChange={set('body')} placeholder="Ex. Lots viabilisés disponibles dès 5 000 000 FCFA. Touchez pour découvrir le programme." />
              </Field>
              <Field label="Destinataires" hint="Ville préférée choisie dans l’application">
                <select className="select" value={form.city_id} onChange={set('city_id')}>
                  <option value="">Tous les téléphones ({data?.devices ?? 0})</option>
                  {data?.cities.map(c => <option key={c.id} value={c.id} disabled={!c.devices}>{c.label} ({c.devices})</option>)}
                </select>
              </Field>
              <Field label="Au toucher, ouvrir" hint="Fiche du programme dans l’application">
                <select className="select" value={form.project_id} onChange={set('project_id')}>
                  <option value="">L’accueil de l’application</option>
                  {data?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <div className="full row" style={{ gap: 12 }}>
                <button className="btn btn-primary" disabled={!valid} onClick={() => setConfirm(true)}><Send />Envoyer à {recipients} téléphone{recipients > 1 ? 's' : ''}</button>
                {!recipients && data && <span className="small muted">Aucun téléphone inscrit pour cette cible.</span>}
              </div>
            </div>
            {/* Aperçu : bannière telle qu'elle apparaît sur l'écran verrouillé */}
            <div aria-label="Aperçu de la notification" style={{ background: 'linear-gradient(160deg, #1f2937, #0b0f17)', borderRadius: 28, padding: '28px 14px 40px' }}>
              <div style={{ textAlign: 'center', color: '#fff', fontSize: 40, fontWeight: 300, marginBottom: 18 }}>09:41</div>
              <div style={{ background: 'rgba(255,255,255,0.92)', color: '#111', borderRadius: 18, padding: '10px 12px', display: 'flex', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: '#E30613', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>S</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#555' }}><span>SIIPAF</span><span>maintenant</span></div>
                  <div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.title || 'Titre de la notification'}</div>
                  <div style={{ fontSize: 13, color: '#333', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{form.body || 'Texte de la notification.'}</div>
                </div>
              </div>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, textAlign: 'center', marginTop: 14 }}>Au toucher : {project ? project.name : 'accueil de l’application'}</p>
            </div>
          </div>
        </Card>
      )}

      <Card title="Historique des envois" bodyClass="">
        {res.loading && !data ? <div className="card-body"><Skeleton h={120} /></div>
          : !data?.rows.length ? <Empty icon={BellRing}>Aucune notification envoyée pour l’instant.</Empty>
          : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Notification</th><th>Cible</th><th>Au toucher</th><th>Envois</th><th>Date</th></tr></thead>
              <tbody>{data.rows.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.title}</strong><div className="small muted">{r.body}</div></td>
                  <td>{r.city_label ? <Badge>{r.city_label}</Badge> : <span className="small">Tous</span>}</td>
                  <td className="small">{r.project_name || 'Accueil'}</td>
                  <td><Badge tone={r.sent >= r.recipients ? 'ok' : r.sent ? 'warn' : ''}>{r.sent} / {r.recipients}</Badge></td>
                  <td className="small muted">{dateTime(r.created_at)}{r.author ? <div>{r.author}</div> : null}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </Card>

      {confirm && (
        <Modal title="Envoyer la notification ?" onClose={() => setConfirm(false)} footer={(
          <><button className="btn btn-ghost" onClick={() => setConfirm(false)}>Annuler</button>
            <button className="btn btn-primary" disabled={busy} onClick={send}><Send />{busy ? 'Envoi…' : 'Envoyer maintenant'}</button></>
        )}>
          <p>« <strong>{form.title.trim()}</strong> » part tout de suite vers <strong>{recipients} téléphone{recipients > 1 ? 's' : ''}</strong>{city ? ` (ville préférée : ${city.label})` : ''}. Un envoi ne peut pas être annulé.</p>
        </Modal>
      )}
    </div>
  );
}
