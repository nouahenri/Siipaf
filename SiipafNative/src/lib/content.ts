/**
 * Contenu du site dans l'application : mêmes textes, images et coordonnées que siipaf.com, réglés dans le dashboard
 * (Contenu du site › Éditorial, Images, Coordonnées). Les textes d'origine viennent du catalogue du serveur
 * (src/content/site-text-slots.json, copie de server/src/lib/ — `npm run sync-content` la met à jour) ; seules les
 * valeurs modifiées dans le dashboard arrivent par l'API (/api/public/content › editorial).
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import catalog from '@/content/site-text-slots.json';
import imageCatalog from '@/content/site-image-slots.json';
import { DEFAULT_CONTACT } from '@/config';
import { apiUrl, publicApi, siteUrl } from './api';
import type { SiteContent } from './types';
import { digits } from './format';

type Block = { type: string; key: string; kind?: string; default?: unknown; blocks?: Block[] };
const defaults = new Map<string, unknown>();
const walk = (blocks: Block[]) => blocks.forEach(b => {
  if (b.type === 'card') { walk(b.blocks || []); return; }
  defaults.set(b.key, b.default);
});
for (const page of (catalog as unknown as { pages: { sections: { key: string; blocks: Block[] }[] }[] }).pages) for (const s of page.sections) walk(s.blocks);

const imageFallbacks = new Map<string, string>(
  ((imageCatalog as unknown as { slots: { id: string; fallback?: string }[] }).slots || []).map(s => [s.id, s.fallback || '']),
);

// Images livrées avec l'application (affichage immédiat, même hors ligne)
const BUNDLED: Record<string, number> = {
  'images/logo-siipaf.png': require('../../assets/images/site/logo-siipaf.png'),
  'images/hero/hero-1-siipaf-general.jpg': require('../../assets/images/hero/hero-1.jpg'),
  'images/hero/hero-2-yamoussoukro.jpg': require('../../assets/images/hero/hero-2.jpg'),
  'images/hero/hero-3-ahoutoue.jpg': require('../../assets/images/hero/hero-3.jpg'),
  'images/hero/hero-4-riviera.jpg': require('../../assets/images/hero/hero-4.jpg'),
  'images/hero/hero-5-cly.jpg': require('../../assets/images/hero/hero-5.jpg'),
};
export const HERO_FALLBACKS = [1, 2, 3, 4, 5].map(i => BUNDLED[Object.keys(BUNDLED)[i]]);
export const PROJECT_IMAGES: Record<string, number> = {
  ahoutoue: require('../../assets/images/projets/ahoutoue.jpg'),
  bingerville: require('../../assets/images/projets/bingerville.jpg'),
  cly: require('../../assets/images/projets/cly.jpg'),
  riviera: require('../../assets/images/projets/riviera.jpg'),
  yamoussoukro: require('../../assets/images/projets/yamoussoukro.jpg'),
};
/**
 * Logo SIIPAF, toujours sans fond (déclinaisons fournies le 04/11, dossier logo_siipaf) : 601 × 228 px.
 * LOGO : fond clair (SIIPAF rouge, textes noirs) ; LOGO_ON_RED : posé sur le rouge (SIIPAF blanc) ;
 * LOGO_ON_DARK : posé sur le noir (SIIPAF et textes blancs, barre rouge). LOGO_EMBLEM : le cercle au globe seul.
 */
export const LOGO = require('../../assets/images/site/logo-siipaf.png');
export const LOGO_ON_RED = require('../../assets/images/site/logo-siipaf-rouge.png');
export const LOGO_ON_DARK = require('../../assets/images/site/logo-siipaf-noir.png');
export const LOGO_EMBLEM = require('../../assets/images/site/logo-emblem.png');
/** Largeur / hauteur du logo, et position de l'emblème dans le logo (fractions de la largeur et de la hauteur). */
export const LOGO_RATIO = 601 / 228;
export const LOGO_EMBLEM_BOX = { cx: 0.1689, cy: 0.4317, size: 0.2529 };

export function useSiteContent() {
  return useQuery({ queryKey: ['content'], queryFn: () => publicApi.get<SiteContent>('/content'), staleTime: 5 * 60 * 1000 });
}

/** Textes, images et coordonnées du site, avec repli sur les valeurs d'origine tant que l'API n'a pas répondu. */
export function useSite() {
  const { data } = useSiteContent();
  const texts = useMemo(() => (data?.editorial?.texts || {}) as Record<string, unknown>, [data?.editorial?.texts]);
  const hidden = useMemo(() => new Set(data?.editorial?.hidden || []), [data?.editorial?.hidden]);

  const t = useCallback((key: string): string => {
    const v = texts[key] ?? defaults.get(key);
    return typeof v === 'string' ? v : '';
  }, [texts]);
  const list = useCallback((key: string): string[] => {
    const v = texts[key] ?? defaults.get(key);
    return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
  }, [texts]);
  const link = useCallback((key: string): { label: string; href: string } | null => {
    const v = (texts[key] ?? defaults.get(key)) as { label?: string; href?: string } | undefined;
    return v && v.label ? { label: v.label, href: v.href || '' } : null;
  }, [texts]);
  /** Section ou carte masquée dans le dashboard (clé ou parent). */
  const isHidden = useCallback((key: string) => [...hidden].some(h => key === h || key.startsWith(`${h}.`)), [hidden]);
  /** Image d'un emplacement : choisie dans le dashboard, sinon image d'origine (livrée avec l'app ou lue sur siipaf.com). */
  const image = useCallback((slot: string) => {
    const chosen = data?.images?.[slot]?.url;
    if (chosen) return { uri: apiUrl(chosen)! };
    const fb = imageFallbacks.get(slot);
    if (!fb) return null;
    return BUNDLED[fb] ?? { uri: siteUrl(fb)! };
  }, [data?.images]);

  const site = data?.site || {};
  const contact = {
    phone: site.phone || DEFAULT_CONTACT.phone,
    phone2: site.phone2 || DEFAULT_CONTACT.phone2,
    email: site.email || DEFAULT_CONTACT.email,
    address: site.address || DEFAULT_CONTACT.address,
    whatsapp: digits(site.whatsapp || DEFAULT_CONTACT.whatsapp),
    socials: site.socials || {},
  };
  return { t, list, link, isHidden, image, contact, content: data };
}

/** Cartes d'une section du catalogue (« home.expertises.carte-1 »…), dans l'ordre, sans les cartes masquées. */
export function cardsOf(sectionKey: string): string[] {
  for (const page of (catalog as unknown as { pages: { sections: { key: string; blocks: Block[] }[] }[] }).pages) {
    const s = page.sections.find(x => x.key === sectionKey);
    if (s) return s.blocks.filter(b => b.type === 'card').map(b => b.key);
  }
  return [];
}
/** Images associées à une carte ou une section dans le catalogue. */
export function imagesOf(key: string): string[] {
  const find = (blocks: (Block & { images?: string[] })[]): string[] | null => {
    for (const b of blocks) { if (b.key === key) return b.images || []; if (b.blocks) { const r = find(b.blocks as never); if (r) return r; } }
    return null;
  };
  for (const page of (catalog as unknown as { pages: { sections: (Block & { images?: string[] })[] }[] }).pages) {
    for (const s of page.sections) { if (s.key === key) return s.images || []; const r = find((s.blocks || []) as never); if (r) return r; }
  }
  return [];
}
