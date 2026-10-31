/**
 * Mode démonstration de Sita (aucune clé de l'IA, arrêt d'urgence ou démonstration voulue) : réponses fabriquées UNIQUEMENT à partir
 * des faits publiés (programmes, offres, prix, financement, avancement, documents), sans appel à l'IA ni coût. Un petit dialogue
 * guidé recueille nom, téléphone et accord avant d'enregistrer le prospect (mêmes outils, mêmes vérifications que le mode IA).
 * Le dialogue en cours est gardé dans `sita_conversations.state`.
 */
const S = require('../lib/sita');

const { plain, fcfa } = S;
const YES = /\b(oui|ouais|ok|okay|d accord|daccord|bien sur|volontiers|yes|sure|please|avec plaisir|accepte|j accepte|pas de souci)\b/;
const NO = /\b(non|no|pas question|refuse|je refuse|surtout pas|plutot pas|pas maintenant)\b/;
const NAME_PREFIX = /^(?:bonjour|bonsoir|salut|hello|hi)?[\s,!.]*(?:je m'?appelle|je suis|mon nom est|moi c'?est|c'?est|my name is|i am|i'm)?\s*/i;

const cut = (arr, n) => arr.slice(0, n);

/** Programme cité dans le message (par son nom ou son identifiant), sinon celui consulté, sinon null. */
function programmeOf(message, facts, focus) {
  const t = plain(message);
  const list = facts.programmes || [];
  const named = list.find(p => t.includes(plain(p.nom)) || (p.identifiant && t.includes(plain(p.identifiant).replace(/-/g, ' '))));
  if (named) return named;
  return focus ? list.find(p => p.identifiant === focus.slug) || null : null;
}

/** Nom propre plausible dans un message (réponse à « Quel est votre nom ? »), sinon null. */
function nameFrom(message) {
  const m = String(message || '').replace(NAME_PREFIX, '').replace(/[.!]+$/, '').trim();
  if (!m || /^(oui|non|ok|no|yes|merci)$/i.test(m) || /\d|@/.test(m) || m.length > 60 || m.split(/\s+/).length > 5) return null;
  return /^[\p{L}][\p{L}'’ .-]+$/u.test(m) ? m.replace(/\s+/g, ' ') : null;
}

function offersText(p, en) {
  const priced = (p.offres || []).filter(o => o.price_fcfa);
  if (!priced.length) return en ? `The prices of ${p.nom} are not published yet; a SIIPAF adviser can give you the exact figures.` : `Les prix de ${p.nom} ne sont pas encore publiés : un conseiller SIIPAF peut vous donner les chiffres exacts.`;
  const lines = cut(priced, 5).map(o => `• ${[o.intitule, o.designation].filter(Boolean).join(' — ')}${o.surface ? ` (${o.surface})` : ''} : ${fcfa(o.price_fcfa)}${o.diaspora_price_fcfa ? (en ? `, diaspora price ${fcfa(o.diaspora_price_fcfa)}` : `, tarif diaspora ${fcfa(o.diaspora_price_fcfa)}`) : ''}`);
  return `${en ? `Here are the published prices for ${p.nom}:` : `Voici les prix publiés pour ${p.nom} :`}\n${lines.join('\n')}`;
}

function financingText(p, facts, en) {
  const bits = [];
  if (p.acompte_fcfa) bits.push(en ? `a deposit of ${fcfa(p.acompte_fcfa)}` : `un acompte de ${fcfa(p.acompte_fcfa)}`);
  if (p.duree_solde_mois) bits.push(en ? `the balance spread over ${p.duree_solde_mois} months` : `le solde étalé sur ${p.duree_solde_mois} mois`);
  const first = (p.offres || []).find(o => o.monthly_fcfa);
  const head = bits.length ? (en ? `For ${p.nom}: ${bits.join(', ')}.` : `Pour ${p.nom} : ${bits.join(', ')}.`) : (en ? `The payment terms of ${p.nom} are set with an adviser.` : `Les conditions de paiement de ${p.nom} se précisent avec un conseiller.`);
  const month = first ? (en ? ` For example, ${first.intitule}: about ${fcfa(first.monthly_fcfa)} per month.` : ` Par exemple, pour ${first.intitule} : environ ${fcfa(first.monthly_fcfa)} par mois.`) : '';
  const modes = (facts.modes_de_financement || []).length ? `\n${en ? 'Financing options' : 'Modes de financement possibles'} : ${facts.modes_de_financement.join(' ; ')}.` : '';
  return `${head}${month}${modes}`;
}

function progressText(p, en) {
  const a = (p.avancement || [])[0];
  const parts = [];
  if (a) parts.push(en ? `Latest published update: ${a.titre} (${a.etape}, ${a.progress_pct ?? '?'} %).` : `Dernier point d’avancement publié : ${a.titre} (${a.etape}, ${a.progress_pct ?? '?'} %).`);
  if (p.livraison) parts.push(en ? `Planned delivery: ${p.livraison}.` : `Livraison prévue : ${p.livraison}.`);
  return parts.length ? `${p.nom} — ${parts.join(' ')}` : (en ? `No progress update is published yet for ${p.nom}.` : `Aucun point d’avancement n’est encore publié pour ${p.nom}.`);
}

function docsText(p, en) {
  const docs = cut(p.documents || [], 8);
  return docs.length ? `${en ? `Documents listed for ${p.nom}:` : `Documents du bien pour ${p.nom} :`} ${docs.join(', ')}.` : (en ? `No document is listed yet for ${p.nom}.` : `Aucun document n’est encore listé pour ${p.nom}.`);
}

function availabilityText(p, en) {
  const l = p.lots_par_statut || {};
  const n = l.disponible;
  return n != null ? (en ? `${p.nom}: ${n} lot(s) currently available.` : `${p.nom} : ${n} lot(s) actuellement disponible(s).`) : (en ? `Availability of ${p.nom} is confirmed by an adviser.` : `La disponibilité de ${p.nom} est confirmée par un conseiller.`);
}

function overviewText(facts, en) {
  const list = cut(facts.programmes || [], 6);
  if (!list.length) return en ? 'No programme is published at the moment.' : 'Aucun programme n’est publié pour le moment.';
  return `${en ? 'Our programmes:' : 'Nos programmes :'}\n${list.map(p => `• ${p.nom}${p.ville ? ` (${p.ville})` : ''}${p.accroche ? ` — ${p.accroche}` : ''}`).join('\n')}`;
}

/**
 * Réponse de démonstration. `execute(name, input)` : outils du serveur. Renvoie { text, state }.
 */
async function demoReply({ settings, facts, state: previous, message, focus, now = new Date(), execute, visitorTexts = [] }) {
  const g = S.agree(settings);
  const en = S.looksEnglish(message);
  const T = (fr, eng) => (en ? eng : fr);
  const t = plain(message);
  const state = { asked: null, pending: {}, ...(previous || {}) };
  state.pending = { ...(state.pending || {}) };
  const p0 = programmeOf(message, facts, focus);
  const prog = p0 || (state.pending.project_slug ? (facts.programmes || []).find(x => x.identifiant === state.pending.project_slug) : null);
  if (prog) state.pending.project_slug = prog.identifiant;
  const done = (text, st = state) => ({ text, state: st });
  const summaryOf = () => cut(visitorTexts.filter(Boolean), 4).join(' / ').slice(0, 500) || (state.pending.want === 'rdv' ? 'Souhaite une visite' : 'Souhaite être recontacté');

  const askNext = () => {
    const pd = state.pending;
    if (!pd.name) { state.asked = 'name'; return T('Avec plaisir. Quel est votre nom ?', 'Happy to help. What is your name?'); }
    if (!pd.phone && !pd.email) { state.asked = 'phone'; return T(`Merci ${pd.name}. Quel est votre numéro de téléphone (WhatsApp si possible) ?`, `Thank you ${pd.name}. What is your phone number (WhatsApp if possible)?`); }
    state.asked = 'consent';
    return T(`Merci. Acceptez-vous que SIIPAF vous recontacte à ce ${pd.phone ? 'numéro' : 'e-mail'} ? Répondez « oui » pour confirmer.`, 'Thank you. Do you agree that SIIPAF contacts you with these details? Please answer “yes” to confirm.');
  };

  // Coordonnées glissées dans n'importe quel message
  const phone = S.extractPhone(message);
  const email = S.extractEmail(message);
  if (phone && !state.pending.phone) state.pending.phone = phone;
  if (email && !state.pending.email) state.pending.email = email;
  const named = message.match(/(?:je m['’]appelle|mon nom est|moi c['’]est|my name is)\s+([\p{L}'’ .-]{2,50})/iu);
  if (named && !state.pending.name) state.pending.name = nameFrom(named[1]);

  // ─── Dialogue en cours ──────────────────────────────────────────────
  if (state.asked === 'consent') {
    if (YES.test(t) && !NO.test(t)) {
      const pd = state.pending;
      let result;
      if (pd.want === 'rdv' && pd.when) {
        result = await execute('proposer_rendez_vous', { kind: pd.kind || 'visite', starts_at: pd.when, project_slug: pd.project_slug, name: pd.name, phone: pd.phone, email: pd.email, consent_contact: true });
      } else {
        result = await execute('enregistrer_prospect', { name: pd.name, phone: pd.phone, email: pd.email, project_slug: pd.project_slug, summary: summaryOf(), consent_contact: true });
      }
      const hours = S.hoursText(settings.human_hours);
      if (result.ok === false) return done(`${T('Je n’ai pas pu enregistrer ces informations', 'I could not save these details')} (${result.error}). ${T('Vous pouvez aussi écrire à un conseiller sur WhatsApp ci-dessous.', 'You can also write to an adviser on WhatsApp below.')}`, { asked: null, pending: pd.want === 'rdv' ? { ...pd, when: null } : {} });
      const text = pd.want === 'rdv' && pd.when
        ? T(`C’est noté, ${g.ravi === 'ravie' ? 'je suis ravie' : 'je suis ravi'} : votre demande de rendez-vous est transmise. Un conseiller SIIPAF vous la confirme très vite (équipe présente ${hours}).`, `Done: your appointment request has been sent. A SIIPAF adviser will confirm it shortly (team available ${hours}).`)
        : T(`C’est noté, merci ${pd.name} ! Un conseiller SIIPAF vous recontacte très vite (équipe présente ${hours}). Souhaitez-vous aussi prendre rendez-vous pour une visite ?`, `Noted, thank you ${pd.name}! A SIIPAF adviser will contact you shortly (team available ${hours}). Would you also like to book a visit?`);
      return done(text, { asked: null, pending: {} });
    }
    if (NO.test(t)) return done(T('Pas de souci, je ne note rien. Vous pouvez aussi écrire directement à un conseiller sur WhatsApp ci-dessous si vous préférez.', 'No problem, I will not save anything. You can also write to an adviser on WhatsApp below.'), { asked: null, pending: {} });
    return done(T('Pour que SIIPAF puisse vous recontacter, j’ai besoin de votre accord : répondez « oui » pour confirmer, ou « non » pour ne rien enregistrer.', 'To let SIIPAF contact you I need your agreement: answer “yes” to confirm or “no” to save nothing.'));
  }
  if (state.asked === 'name') {
    const n = state.pending.name || nameFrom(message);
    if (n) { state.pending.name = n; return done(askNext()); }
    return done(T('Pardon, je n’ai pas bien saisi votre nom. Comment dois-je vous appeler ?', 'Sorry, I did not catch your name. How should I call you?'));
  }
  if (state.asked === 'phone') {
    if (state.pending.phone || state.pending.email) return done(askNext());
    return done(T('Je n’ai pas reconnu de numéro. Pouvez-vous l’écrire, par exemple 07 00 00 00 00 ?', 'I did not recognise a number. Could you write it, for example 07 00 00 00 00?'));
  }
  if (state.asked === 'when') {
    const when = S.parseWhen(message, now);
    if (when) { state.pending.when = when.toISOString().slice(0, 16); state.pending.want = 'rdv'; return done(askNext()); }
    if (NO.test(t)) return done(T('D’accord. Je reste là si vous changez d’avis.', 'Alright. I am here if you change your mind.'), { asked: null, pending: {} });
    return done(T('Pouvez-vous me donner un jour et une heure, par exemple « samedi à 10h » ou « demain à 15h » ?', 'Could you give me a day and a time, for example “Saturday at 10am”?'));
  }

  // ─── Intentions ─────────────────────────────────────────────────────
  const wantsHuman = /\b(whatsapp|humain|conseiller|conseillere|quelqu un|une personne|agent|human|adviser|advisor|agent)\b/.test(t) && !/\b(rappel|rappeler|recontact)/.test(t);
  if (wantsHuman) {
    const r = await execute('passer_la_main', { reason: 'Le visiteur demande à parler à un conseiller' });
    state.asked = null;
    return done(T(`Bien sûr. Je passe la main à l’équipe : vous pouvez écrire à un conseiller sur WhatsApp avec le bouton ci-dessous (équipe présente ${S.hoursText(settings.human_hours)}).`, `Of course. I am handing over to the team: write to an adviser on WhatsApp with the button below (team available ${S.hoursText(settings.human_hours)}).`));
  }
  if (/\b(rappel|rappeler|recontact|appelez moi|call me|call back)/.test(t)) {
    state.pending.want = 'rappel';
    return done(askNext());
  }
  if (/\b(visite|visiter|rendez vous|rdv|rencontr|venir voir|voir sur place|visit|appointment|meeting)\b/.test(t)) {
    state.pending.want = 'rdv';
    state.pending.kind = /\bvisio\b/.test(t) ? 'visio' : /\bbureau\b|\boffice\b/.test(t) ? 'bureau' : 'visite';
    const when = S.parseWhen(message, now);
    if (when) { state.pending.when = when.toISOString().slice(0, 16); return done(askNext()); }
    state.asked = 'when';
    return done(T(`Avec plaisir${prog ? ` pour ${prog.nom}` : ''}. Quel jour et à quelle heure vous conviendrait-il ? (par exemple « samedi à 10h »)`, `Gladly${prog ? ` for ${prog.nom}` : ''}. Which day and time suits you? (for example “Saturday at 10am”)`));
  }
  if (/\b(prix|combien|tarif|tarifs|cout|coute|cher|budget|price|prices|how much|cost)\b/.test(t)) {
    if (prog) return done(`${offersText(prog, en)}\n${T('Souhaitez-vous connaître le financement ou organiser une visite ?', 'Would you like to know about financing or arrange a visit?')}`);
    return done(`${overviewText(facts, en)}\n${T('Dites-moi quel programme vous intéresse et je vous donne ses prix.', 'Tell me which programme interests you and I will give you its prices.')}`);
  }
  if (/\b(financ|apport|mensualit|credit|payer|paiement|diaspora|comptant|acompte|echelonn|payment|installment|mortgage)/.test(t)) {
    if (prog) return done(`${financingText(prog, facts, en)}\n${T('Voulez-vous que je note vos coordonnées pour qu’un conseiller détaille la formule adaptée ?', 'Shall I note your details so that an adviser can detail the right plan?')}`);
    const first = (facts.programmes || [])[0];
    return done(first ? `${financingText(first, facts, en)}\n${T('Dites-moi quel programme vous intéresse pour le détail.', 'Tell me which programme interests you for the details.')}` : T('Un conseiller vous détaille les modes de paiement.', 'An adviser will detail the payment options.'));
  }
  if (/\b(avancement|chantier|livraison|delai|construction|progress|delivery|ou en est)\b/.test(t)) {
    if (prog) return done(progressText(prog, en));
    return done(cut(facts.programmes || [], 4).map(p => progressText(p, en)).join('\n') || T('Aucun avancement publié pour le moment.', 'No progress published at the moment.'));
  }
  if (/\b(document|titre foncier|acd|papiers|legal|juridique|documents)\b/.test(t)) {
    if (prog) return done(docsText(prog, en));
    return done(T('De quel programme parlez-vous ? Je vous indique ses documents.', 'Which programme do you mean? I will tell you its documents.'));
  }
  if (/\b(disponib|reste t il|lots|available|availability)\b/.test(t)) {
    if (prog) return done(availabilityText(prog, en));
    return done(cut(facts.programmes || [], 4).map(p => availabilityText(p, en)).join('\n') || T('Un conseiller vous confirme les disponibilités.', 'An adviser will confirm availability.'));
  }
  if (t.length <= 30 && /^(bonjour|bonsoir|salut|coucou|hello|hi|hey)\b/.test(t)) return done(T(`Bonjour ! Je suis ${settings.name}. Prix, financement, avancement des chantiers, visites : posez-moi votre question.`, `Hello! I am ${settings.name}. Prices, financing, site progress, visits: ask me anything.`));
  // Présentation du programme seulement s'il est cité dans le message : la page consultée ne suffit pas (une question hors sujet reste hors faits)
  const cited = programmeOf(message, facts, null);
  if (cited && !/\b(merci|thanks?)\b/.test(t)) {
    const d = [cited.accroche, cited.localisation || cited.ville].filter(Boolean).join(' — ');
    return done(`${cited.nom}${d ? ` : ${d}` : ''}.\n${T('Je peux vous donner les prix, le financement, l’avancement ou organiser une visite : que souhaitez-vous ?', 'I can give you prices, financing, progress or arrange a visit: what would you like?')}`);
  }
  if (/\b(programme|programmes|projet|projets|lotissement|appartement|villa|terrain|maison|house|apartment|land|plot|property)\b/.test(t)) return done(overviewText(facts, en));
  if (/\b(merci|thanks?|thank you)\b/.test(t)) return done(T('Avec plaisir ! N’hésitez pas si vous avez une autre question.', 'My pleasure! Feel free to ask if you have another question.'));

  // Hors de ce que les faits permettent de dire : « je ne sais pas » et passage de main
  await execute('passer_la_main', { reason: `Question hors faits publiés : ${message.slice(0, 120)}` });
  return done(T(`Je ne suis pas ${g.pret === 'prête' ? 'sûre' : 'sûr'} de pouvoir vous répondre correctement sur ce point, et je préfère ne pas me tromper. Un conseiller SIIPAF peut vous répondre : vous pouvez lui écrire sur WhatsApp avec le bouton ci-dessous.`, 'I am not sure I can answer this correctly and I prefer not to be wrong. A SIIPAF adviser can help: you can write to them on WhatsApp with the button below.'));
}

module.exports = { demoReply, nameFrom, programmeOf };
