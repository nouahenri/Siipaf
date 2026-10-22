import { useEffect, useState } from 'react';
import { Download, Mail, Newspaper, Plus, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth, useResource, useToast, useSaved } from '../lib/app-context';
import { Card, Field, Badge, Empty, ErrorBox, Skeleton, Modal } from '../components/ui';
import CampaignEditor, { CAMPAIGN_TONES, CampaignProgress } from '../components/CampaignEditor';
import { date, dateTime } from '../lib/format';

const TABS = [
  { id: 'campagnes', label: 'Campagnes' },
  { id: 'abonnes', label: 'Abonnés' },
  { id: 'reglages', label: 'Débit d’envoi' },
];

export default function Newsletter() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(t => t.id === params.get('onglet')) ? params.get('onglet') : 'campagnes';
  const campaign = Number(params.get('campagne')) || null;
  const go = (next, id = null) => setParams(id ? { onglet: next, campagne: String(id) } : { onglet: next });

  return (
    <div className="stack">
      {!campaign && (
        <div className="tabs" role="tablist">
          {TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => go(t.id)}>{t.label}</button>)}
        </div>
      )}
      {tab === 'campagnes' && <Campaigns open={campaign} onOpen={id => go('campagnes', id)} />}
      {tab === 'abonnes' && <Subscribers />}
      {tab === 'reglages' && <SendSettings />}
    </div>
  );
}

function Campaigns({ open, onOpen }) {
  const { can } = useAuth();
  const toast = useToast();
  const list = useResource('/admin/newsletter/campaigns');
  const [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState('');
  const statuses = list.data?.statuses;

  const create = async e => {
    e.preventDefault();
    try {
      const c = await api.post('/admin/newsletter/campaigns', { subject });
      setCreating(false); setSubject(''); list.reload(); onOpen(c.id);
    } catch (err) { toast(err.message, 'err'); }
  };

  if (open) return <CampaignEditor id={open} statuses={statuses} onBack={id => onOpen(id)} onChanged={() => list.reload()} />;

  const rows = list.data?.rows || [];
  return (
    <>
      <div className="row-between">
        <p className="small muted">Rédigez une campagne, vérifiez l’aperçu et envoyez-vous un test avant de l’adresser à tous les abonnés actifs.</p>
        {can('newsletter:write') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus />Nouvelle campagne</button>}
      </div>
      <ErrorBox error={list.error} />
      <Card bodyClass="">
        {list.loading && !list.data ? <div className="card-body"><Skeleton h={160} /></div>
          : !rows.length ? <Empty icon={Mail}>Aucune campagne pour l’instant.</Empty>
          : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Objet</th><th>Statut</th><th>Envoi</th><th>Date</th></tr></thead>
              <tbody>{rows.map(c => (
                <tr key={c.id} className="clickable" onClick={() => onOpen(c.id)}>
                  <td><button className="link-btn" onClick={e => { e.stopPropagation(); onOpen(c.id); }}>{c.subject}</button></td>
                  <td><Badge tone={CAMPAIGN_TONES[c.status]}>{statuses?.[c.status] || c.status}</Badge></td>
                  <td>{c.status === 'brouillon' ? <span className="small muted">—</span> : <CampaignProgress c={c} />}</td>
                  <td className="small muted">{c.started_at ? `Lancée ${dateTime(c.started_at)}` : `Créée ${date(c.created_at)}`}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </Card>
      {creating && (
        <Modal title="Nouvelle campagne" onClose={() => setCreating(false)} footer={(
          <><button className="btn btn-ghost" onClick={() => setCreating(false)}>Annuler</button>
            <button className="btn btn-primary" form="new-campaign" disabled={subject.trim().length < 3}>Créer et rédiger</button></>
        )}>
          <form id="new-campaign" onSubmit={create}>
            <Field label="Objet de l’e-mail" hint="Modifiable ensuite"><input className="input" autoFocus value={subject} maxLength={160} onChange={e => setSubject(e.target.value)} placeholder="Ex. Nouveau programme à Bingerville : lots disponibles" /></Field>
          </form>
        </Modal>
      )}
    </>
  );
}

function Subscribers() {
  const { can } = useAuth();
  const toast = useToast();
  const subs = useResource('/admin/newsletter');
  const [q, setQ] = useState('');
  const rows = (subs.data || []).filter(s => !q || s.email.includes(q.toLowerCase()));
  const active = (subs.data || []).filter(s => s.status === 'actif').length;

  const toggle = async s => {
    const next = s.status === 'actif' ? 'desinscrit' : 'actif';
    try {
      await api.patch(`/admin/newsletter/${s.id}`, { status: next });
      subs.setData(list => list.map(x => (x.id === s.id ? { ...x, status: next } : x)));
      toast(next === 'actif' ? 'Abonné réactivé' : 'Abonné désinscrit');
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="row-between">
        <div className="search">
          <Search aria-hidden="true" />
          <input className="input" placeholder="Rechercher un e-mail" value={q} onChange={e => setQ(e.target.value)} aria-label="Rechercher un abonné" />
        </div>
        <a className="btn" href="/api/admin/newsletter.csv"><Download />Exporter les {active} abonnés actifs</a>
      </div>
      <p className="small muted">Chaque e-mail de campagne contient un lien de désinscription en un clic ; l’abonné passe alors « Désinscrit » et ne reçoit plus rien.</p>
      <ErrorBox error={subs.error} />
      <Card bodyClass="">
        {subs.loading && !subs.data ? <div className="card-body"><Skeleton h={160} /></div>
          : !rows.length ? <Empty icon={Newspaper}>Aucun abonné.</Empty>
          : (
            <div className="table-wrap"><table className="table">
              <thead><tr><th>E-mail</th><th>Inscrit le</th><th>Statut</th><th /></tr></thead>
              <tbody>{rows.map(s => (
                <tr key={s.id}>
                  <td>{s.email}</td>
                  <td className="small muted">{date(s.created_at)}</td>
                  <td><Badge tone={s.status === 'actif' ? 'ok' : ''}>{s.status === 'actif' ? 'Actif' : 'Désinscrit'}</Badge></td>
                  <td className="right">{can('newsletter:write') && <button className="btn btn-sm btn-ghost" onClick={() => toggle(s)}>{s.status === 'actif' ? 'Désinscrire' : 'Réactiver'}</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
      </Card>
    </>
  );
}

function SendSettings() {
  const { can } = useAuth();
  const toast = useToast();
  const saved = useSaved();
  const res = useResource('/admin/newsletter/settings');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (res.data) setForm({ ...res.data, reply_to: res.data.reply_to || '' }); }, [res.data]);
  if (res.error) return <ErrorBox error={res.error} />;
  if (!form) return <Skeleton h={240} />;
  const editable = can('newsletter:send');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      res.setData(await api.put('/admin/newsletter/settings', { ...form, per_minute: Number(form.per_minute), per_hour: Number(form.per_hour) }));
      saved('Réglages enregistrés');
    } catch (err) { toast(err.message, 'err'); } finally { setBusy(false); }
  };

  return (
    <Card title="Débit d’envoi et expéditeur">
      <form onSubmit={save}>
        <fieldset disabled={!editable} className="form-grid" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Field label="E-mails par minute"><input className="input" type="number" min={1} max={100} value={form.per_minute} onChange={e => set('per_minute', e.target.value)} /></Field>
          <Field label="E-mails par heure"><input className="input" type="number" min={1} max={5000} value={form.per_hour} onChange={e => set('per_hour', e.target.value)} /></Field>
          <Field label="Nom de l’expéditeur"><input className="input" value={form.sender_name} maxLength={80} onChange={e => set('sender_name', e.target.value)} /></Field>
          <Field label="Adresse de réponse" hint="Les réponses des abonnés arrivent ici"><input className="input" type="email" value={form.reply_to} onChange={e => set('reply_to', e.target.value)} /></Field>
        </fieldset>
        <p className="small muted" style={{ marginTop: 16 }}>
          L’hébergeur limite le nombre d’e-mails envoyés par heure. Au-delà, la messagerie peut être bloquée : restez prudent (réglage de départ : 5 par minute, 150 par heure).
          Si le serveur mail refuse un envoi pour dépassement, la campagne se met en pause d’elle-même ; il suffit de la reprendre plus tard.
        </p>
        {editable && <div className="row" style={{ marginTop: 16 }}><button className="btn btn-primary" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>}
      </form>
    </Card>
  );
}
