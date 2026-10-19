import { useState } from 'react';
import { ChevronRight, KeyRound, LogOut, Mail, MessageSquare, Phone } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { amount, initials } from '../lib/format';
import { CONTACT, PASSWORD_MIN } from '../lib/domain';
import { Alert, PageHead, SectionHead, Spinner } from '../components/ui';
import PasswordInput from '../components/PasswordInput';

function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState({ tone: '', text: '' });
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (next.length < PASSWORD_MIN) return setMsg({ tone: 'error', text: `Le mot de passe doit faire au moins ${PASSWORD_MIN} caractères.` });
    if (next !== confirm) return setMsg({ tone: 'error', text: 'Les deux mots de passe ne sont pas identiques.' });
    setBusy(true);
    try {
      await api.post('/password', { current, next });
      setMsg({ tone: 'ok', text: 'Votre mot de passe a été modifié.' });
      setCurrent(''); setNext(''); setConfirm(''); setOpen(false);
    } catch (err) {
      setMsg({ tone: 'error', text: err.message });
    }
    setBusy(false);
  }

  return (
    <section className="card card-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span className="row-icon"><KeyRound aria-hidden="true" /></span>
        <div style={{ flex: 1 }}>
          <div className="row-title">Mot de passe</div>
          <div className="row-sub">Changez-le à tout moment.</div>
        </div>
        {!open && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(true); setMsg({}); }}>Modifier</button>}
      </div>
      {msg.text && <div style={{ marginTop: 14 }}><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {open && (
        <form onSubmit={submit} style={{ marginTop: 18 }} noValidate>
          <PasswordInput label="Mot de passe actuel" value={current} onChange={setCurrent} autoFocus />
          <PasswordInput label="Nouveau mot de passe" value={next} onChange={setNext} autoComplete="new-password" strength hint={`${PASSWORD_MIN} caractères minimum.`} />
          <PasswordInput label="Confirmez le nouveau mot de passe" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" disabled={busy || !current || !next || !confirm}>{busy ? <Spinner /> : 'Enregistrer'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Annuler</button>
          </div>
        </form>
      )}
    </section>
  );
}

export default function Profile() {
  const { client, dossiers, logout } = useSession();
  if (!client) return null;

  return (
    <>
      <PageHead eyebrow="Mon compte" title="Profil" />
      <div className="grid grid-2">
        <div className="grid">
          <section className="card card-pad reveal reveal-2">
            <div className="profile-card">
              <span className="avatar lg" aria-hidden="true">{initials(client.name)}</span>
              <div>
                <div className="profile-name">{client.name}</div>
                <span className="profile-code">{client.client_code}</span>
              </div>
            </div>
            <dl className="kv" style={{ marginTop: 18 }}>
              <div><dt>E-mail</dt><dd>{client.email || '—'}</dd></div>
              <div><dt>Téléphone</dt><dd>{client.phone || '—'}</dd></div>
              {client.country && <div><dt>Pays de résidence</dt><dd>{client.country}</dd></div>}
              <div><dt>{dossiers.length > 1 ? 'Biens' : 'Bien'}</dt><dd>{dossiers.map(d => `Lot ${d.property.lot_code} — ${d.property.project.name}`).join(', ') || '—'}</dd></div>
              {dossiers[0] && <div><dt>Prix convenu</dt><dd className="num">{amount(dossiers[0].price_fcfa)} FCFA</dd></div>}
            </dl>
            <p className="hint" style={{ marginTop: 12 }}>Une information à corriger ? Signalez-le-nous par message.</p>
          </section>
          <ChangePassword />
        </div>

        <div className="grid" style={{ alignContent: 'start' }}>
          <section>
            <SectionHead title="Nous contacter" />
            <div className="card contact-list">
              <a href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer">
                <span className="row-icon"><MessageSquare aria-hidden="true" /></span>
                <div><div className="row-title">WhatsApp</div><div className="row-sub">{CONTACT.phone}</div></div>
                <ChevronRight className="chev" aria-hidden="true" />
              </a>
              <a href={CONTACT.phoneHref}>
                <span className="row-icon"><Phone aria-hidden="true" /></span>
                <div><div className="row-title">Appeler</div><div className="row-sub">{CONTACT.phone} · bureau {CONTACT.office}</div></div>
                <ChevronRight className="chev" aria-hidden="true" />
              </a>
              <a href={`mailto:${CONTACT.email}?subject=${encodeURIComponent(`Espace client ${client.client_code}`)}`}>
                <span className="row-icon"><Mail aria-hidden="true" /></span>
                <div><div className="row-title">E-mail</div><div className="row-sub">{CONTACT.email}</div></div>
                <ChevronRight className="chev" aria-hidden="true" />
              </a>
            </div>
          </section>
          <button type="button" className="btn btn-ghost btn-block" onClick={logout}><LogOut aria-hidden="true" /> Se déconnecter</button>
        </div>
      </div>
    </>
  );
}
