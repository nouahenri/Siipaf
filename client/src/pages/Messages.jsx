import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MessageCircle, SendHorizontal } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { dayLabel, time } from '../lib/format';
import { Alert, Empty, ErrorState, Skeleton } from '../components/ui';

const POLL_MS = 30000;

export default function Messages() {
  const { selected, refreshMe } = useSession();
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const areaRef = useRef(null);
  const count = useRef(0);

  const load = useCallback(async () => {
    try {
      const list = await api.get('/messages');
      setMessages(list);
      setError(null);
      refreshMe();
    } catch (err) {
      setError(err);
    }
  }, [refreshMe]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  // Défile vers le dernier message à l'arrivée de nouveaux messages
  useLayoutEffect(() => {
    if (!messages) return;
    // Bas de page (la zone de saisie fixe recouvre la fin de la liste, compensée par une marge)
    if (messages.length !== count.current) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: count.current ? 'smooth' : 'auto' });
    count.current = messages.length;
  }, [messages]);

  // Zone de saisie qui s'agrandit avec le texte
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError('');
    try {
      const m = await api.post('/messages', { body, ...(selected ? { sale_id: selected.id } : {}) });
      setMessages(list => [...(list || []), m]);
      setText('');
    } catch (err) {
      setSendError(err.message);
    }
    setSending(false);
    areaRef.current?.focus();
  }

  function onKeyDown(e) {
    // Entrée envoie sur ordinateur ; Maj+Entrée ajoute une ligne. Sur mobile, Entrée ajoute une ligne.
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 900px)').matches) send(e);
  }

  let lastDay = null;
  return (
    <div className="chat">
      <header className="chat-head">
        <span className="avatar" aria-hidden="true">S</span>
        <div>
          <strong>Équipe SIIPAF</strong>
          <span>Votre conseiller vous répond ici, et vous prévient par e-mail.</span>
        </div>
      </header>

      <div className="chat-list" aria-live="polite">
        {error && !messages && <ErrorState error={error} onRetry={load} />}
        {!messages && !error && (
          <>
            <Skeleton h={44} w="62%" r={20} />
            <Skeleton h={60} w="70%" r={20} style={{ alignSelf: 'flex-end' }} />
            <Skeleton h={44} w="50%" r={20} />
          </>
        )}
        {messages && messages.length === 0 && (
          <Empty icon={MessageCircle} title="Une question ?" text="Posez-la ici : avancement, documents, paiements, rendez-vous de visite… Nos équipes vous répondent dans ce fil." />
        )}
        {messages?.map(m => {
          const day = dayLabel(m.created_at);
          const showDay = day !== lastDay;
          lastDay = day;
          const mine = m.sender === 'client';
          return (
            <Fragment key={m.id}>
              {showDay && <div className="chat-day">{day}</div>}
              <div className={`bubble ${mine ? 'me' : 'them'}`}>
                {!mine && <span className="bubble-author">{m.author || 'Équipe SIIPAF'}</span>}
                {m.body}
                <span className="bubble-meta">{time(m.created_at)}{mine && (m.read ? ' · Lu' : '')}</span>
              </div>
            </Fragment>
          );
        })}
      </div>

      <form className="composer" onSubmit={send}>
        <div className="composer-inner" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          {sendError && <Alert>{sendError}</Alert>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <label htmlFor="msg" className="sr-only">Votre message</label>
            <textarea id="msg" ref={areaRef} className="input" rows={1} value={text} maxLength={4000}
              onChange={e => setText(e.target.value)} onKeyDown={onKeyDown} placeholder="Écrire à SIIPAF…" />
            <button className="send" disabled={!text.trim() || sending} aria-label="Envoyer"><SendHorizontal aria-hidden="true" /></button>
          </div>
        </div>
      </form>
    </div>
  );
}
