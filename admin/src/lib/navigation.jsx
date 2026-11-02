/**
 * Navigation commune du dashboard et de l'ERP (demande du client du 02/11 : navigation cohérente entre les modules).
 * - Chaque entrée de l'historique de l'onglet retient la page d'où l'on vient (chemin, titre, rang dans l'historique) ;
 *   changer d'onglet ou de filtre dans la même page garde l'origine de la page.
 * - Le bouton « Retour » de l'en-tête ramène exactement à cette page (même dans un autre module, même dans l'autre
 *   application) ; à défaut (arrivée par un lien ou une notification), à la liste parente de la fiche.
 * - Il s'affiche sur les fiches et sur toute page ouverte depuis un autre module (choix du client).
 * - Les filtres d'une liste sont gardés pendant la visite (usePersistentState), effacés à la déconnexion.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

const TRAIL = 'siipaf-navigation';
const FILTERS = 'siipaf-filtre:';
const store = {
  read: () => { try { return JSON.parse(sessionStorage.getItem(TRAIL) || '{}'); } catch { return {}; } },
  write: v => { try { sessionStorage.setItem(TRAIL, JSON.stringify(v)); } catch { /* stockage indisponible : pas de retour vers l'origine */ } },
};
const historyIndex = () => window.history.state?.idx ?? 0;
/** À poser sur les liens du menu et des tuiles d'accueil : <NavLink state={MENU}> — la page ouverte n'a pas d'origine. */
export const MENU = { nav: 'menu' };
const MAX_ENTRIES = 300;
/** Entrée retenue pour une adresse : jamais pour la clé « default » (page chargée directement), et seulement pour la même page. */
const entryOf = (all, loc) => (loc.key !== 'default' && all[loc.key]?.pathname === loc.pathname ? all[loc.key] : null);

/** À la déconnexion : historique et filtres de l'onglet effacés (un autre compte ne les retrouve pas). */
export function clearNavigation() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k === TRAIL || k.startsWith(FILTERS)) sessionStorage.removeItem(k);
  } catch { /* stockage indisponible */ }
}

/** Titre précis d'une fiche (« Chantier CH-2026-0002 — tranche 1 »), affiché dans l'en-tête et repris par le bouton retour. */
export const PageTitleContext = createContext(() => {});
export function usePageTitle(title) {
  const set = useContext(PageTitleContext);
  useEffect(() => { set(title || null); return () => set(null); }, [title]);
}

/** Fiche reconnue par son chemin : [expression, (correspondance, paramètres) => ({ title, parent: { to, label } })]. */
export function matchDetail(rules, pathname, search = '') {
  for (const [re, fn] of rules) {
    const m = pathname.match(re);
    if (m) return fn(m, new URLSearchParams(search));
  }
  return null;
}

/**
 * Adresse de retour venue de l'autre application (paramètre `depuis`), acceptée seulement si elle pointe vers l'hôte
 * attendu du même domaine (admin.siipaf.com ↔ erp.siipaf.com, admin.localhost ↔ erp.localhost) : un lien extérieur est ignoré.
 */
export function externalReturn(value, otherHost) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === window.location.protocol && url.host === otherHost && otherHost !== window.location.host ? url.href : null;
  } catch { return null; }
}

// Titre de la page affichée, tenu à jour par l'en-tête (useNavigationTrail) : repris par les liens vers l'autre application
let pageTitle = '';

/** Lien vers l'autre application qui permet d'y revenir à la page actuelle (`depuis`, `depuis_titre`). */
export function withReturn(url, title = pageTitle) {
  const u = new URL(url);
  u.searchParams.set('depuis', window.location.href.replace(/[?&]depuis(_titre)?=[^&#]*/g, ''));
  if (title) u.searchParams.set('depuis_titre', title);
  return u.href;
}

/**
 * Historique de l'onglet et bouton retour. `title` : titre de la page affichée ; `moduleOf(chemin)` : module d'un chemin ;
 * `detail` : fiche reconnue (matchDetail) ou null ; `otherHost` / `otherLabel` : hôte et nom de l'autre application.
 * Renvoie { back: { label, go } | null }.
 */
export function useNavigationTrail({ title, moduleOf, detail, otherHost, otherLabel }) {
  const location = useLocation();
  const type = useNavigationType();
  const navigate = useNavigate();
  const prev = useRef(null);
  const [, setVersion] = useState(0);
  const path = location.pathname + location.search;
  pageTitle = title;

  // Origine de l'entrée courante, enregistrée avant l'affichage (pas de bouton erroné le temps d'un rendu)
  useLayoutEffect(() => {
    const all = store.read();
    const before = prev.current;
    // Adresse relue au moment de l'effet : une page peut déjà l'avoir nettoyée (paramètres d'arrivée)
    const params = new URLSearchParams(window.location.search);
    if (params.has('depuis')) {
      // Arrivée depuis l'autre application : paramètres retirés de l'adresse ; l'origine (vérifiée) suit la navigation
      const depuis = externalReturn(params.get('depuis'), otherHost);
      const label = params.get('depuis_titre') ? `${params.get('depuis_titre')} (${otherLabel})` : otherLabel;
      params.delete('depuis'); params.delete('depuis_titre');
      const rest = params.toString();
      navigate({ pathname: window.location.pathname, search: rest ? `?${rest}` : '', hash: window.location.hash },
        { replace: true, state: depuis ? { nav: 'depuis', from: { external: depuis, title: label } } : null });
      return;
    }
    // Page chargée directement : react-router lui donne la clé « default », jamais réutilisée (elle n'a pas d'origine)
    if (!entryOf(all, location) && location.key !== 'default') {
      const beforeEntry = before ? entryOf(all, before) : null;
      const from = location.state?.nav === 'depuis' ? location.state.from
        : location.state?.nav === 'menu' || type === 'POP' || !before ? null // menu, tuile d'accueil : pas de retour
        : before.pathname === location.pathname ? beforeEntry?.from ?? null // onglet ou filtre de la même page
        : type === 'PUSH' ? { path: before.path, title: before.title, idx: before.idx, pathname: before.pathname }
        : beforeEntry?.from ?? null; // remplacement d'adresse : même origine
      all[location.key] = { pathname: location.pathname, from };
      const keys = Object.keys(all);
      if (keys.length > MAX_ENTRIES) for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete all[k];
      store.write(all);
      setVersion(v => v + 1);
    }
  }, [location.key]);

  // Page courante retenue (avec son titre, mis à jour quand la fiche le précise) pour devenir l'origine de la suivante
  useEffect(() => { prev.current = { key: location.key, path, pathname: location.pathname, title, idx: historyIndex() }; }, [location.key, path, title]);

  const from = entryOf(store.read(), location)?.from || null;
  const crossModule = !!from && (from.external || moduleOf(from.pathname) !== moduleOf(location.pathname));
  if (!detail && !crossModule) return { back: null };
  if (from?.external) return { back: { label: from.title, go: () => window.location.assign(from.external) } };
  if (from && from.idx < historyIndex()) return { back: { label: from.title, go: () => navigate(from.idx - historyIndex()) } };
  if (from) return { back: { label: from.title, go: () => navigate(from.path) } };
  return { back: { label: detail.parent.label, go: () => navigate(detail.parent.to) } };
}

/** Bouton retour de l'en-tête : flèche et nom de la page de destination (icône seule sur téléphone). */
export function BackButton({ back }) {
  if (!back) return null;
  return (
    <button type="button" className="btn btn-ghost btn-sm back-btn" onClick={back.go} aria-label={`Retour à ${back.label}`} title={`Retour à ${back.label}`}>
      <ArrowLeft aria-hidden="true" /><span>{back.label}</span>
    </button>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * État d'une liste gardé pendant la visite (filtres, recherche, onglet d'affichage) : en revenant sur la page, on les retrouve.
 * Rangé par onglet du navigateur (sessionStorage), par page et par nom.
 * Options : `forced` — valeur imposée par l'adresse (lien d'une notification), prioritaire et gardée ensuite ;
 * `sameDay` — valeur oubliée le lendemain (périodes « jusqu'à aujourd'hui »).
 */
export function usePersistentState(name, initial, { forced = null, sameDay = false } = {}) {
  const { pathname } = useLocation();
  const key = `${FILTERS}${pathname}:${name}`;
  const load = () => {
    if (forced != null && forced !== '') return forced;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw == null) return initial;
      const saved = JSON.parse(raw);
      return sameDay ? (saved?.day === today() ? saved.value : initial) : saved;
    } catch { return initial; }
  };
  const [state, setState] = useState(() => ({ key, value: load() }));
  // Composant partagé par plusieurs adresses (ex. dossiers de vente de chaque module) : chaque adresse a sa valeur
  const current = state.key === key ? state : { key, value: load() };
  if (current !== state) setState(current);
  useEffect(() => {
    try { sessionStorage.setItem(key, JSON.stringify(sameDay ? { day: today(), value: current.value } : current.value)); } catch { /* stockage indisponible : filtres non gardés */ }
  }, [key, current.value]);
  const setValue = v => setState(s => ({ key, value: typeof v === 'function' ? v(s.key === key ? s.value : load()) : v }));
  return [current.value, setValue];
}
