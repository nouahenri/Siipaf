/** Données lues sur le serveur, mises en cache (affichage immédiat au retour sur un écran, tirer pour actualiser). */
import { useQuery } from '@tanstack/react-query';
import { clientApi, publicApi, apiUrl } from './api';
import { PROJECT_IMAGES } from './content';
import { getPrefs } from './prefs';
import type { Chantier, DossierDetail, Filters, Job, Message, Project, ProjectDetail, SavTicket, Testimonial } from './types';

const minutes = (n: number) => n * 60 * 1000;

export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => publicApi.get<Project[]>('/projects'), staleTime: minutes(5) });
export const useFilters = () => useQuery({ queryKey: ['filtres'], queryFn: () => publicApi.get<Filters>('/filtres'), staleTime: minutes(10) });
export const useProject = (slug?: string) => useQuery({
  queryKey: ['project', slug], queryFn: () => publicApi.get<ProjectDetail>(`/projects/${encodeURIComponent(slug!)}`), enabled: !!slug, staleTime: minutes(1),
});
/** Position du site pour la carte : GPS saisi dans le dashboard, sinon position approchée de l'adresse (OpenStreetMap). */
export type SitePosition = { lat: number; lng: number; approx: boolean; precision: 'gps' | 'localisation' | 'ville' } | null;
export const useSitePosition = (slug?: string) => useQuery({
  queryKey: ['position', slug], queryFn: () => publicApi.get<SitePosition>(`/projects/${encodeURIComponent(slug!)}/position`), enabled: !!slug, staleTime: minutes(30),
});
export const useTestimonials = () => useQuery({ queryKey: ['testimonials'], queryFn: () => publicApi.get<Testimonial[]>('/testimonials'), staleTime: minutes(10) });
export const useJobs = () => useQuery({ queryKey: ['jobs'], queryFn: () => publicApi.get<Job[]>('/emplois'), staleTime: minutes(10) });

/** Photo d'un programme : celle du dashboard, sinon celle du site livrée avec l'application. */
export const projectImage = (p?: { cover?: string | null; cover_url?: string | null; slug?: string | null } | null) => {
  const uri = apiUrl(p?.cover || p?.cover_url || null);
  if (uri) return { uri };
  return (p?.slug && PROJECT_IMAGES[p.slug]) || require('../../assets/images/site/connexion.jpg');
};

/* ─── Espace client (clé « client » : vidée à la déconnexion) ─── */

export const useDossier = (id?: number | null) => useQuery({
  queryKey: ['client', 'dossier', id], queryFn: () => clientApi.get<DossierDetail>(`/dossiers/${id}`), enabled: !!id,
});
export const useChantier = (id?: number | null) => useQuery({
  queryKey: ['client', 'chantier', id], queryFn: () => clientApi.get<Chantier>(`/dossiers/${id}/chantier`), enabled: !!id,
});
// Économie de données (Paramètres) : pas d'actualisation automatique du fil, seulement à l'ouverture et en tirant l'écran
export const useMessages = () => useQuery({ queryKey: ['client', 'messages'], queryFn: () => clientApi.get<Message[]>('/messages'), refetchInterval: () => (getPrefs().dataSaver ? false : 30000) });
export const useSavList = () => useQuery({ queryKey: ['client', 'sav'], queryFn: () => clientApi.get<SavTicket[]>('/sav') });
export const useSavTicket = (id?: number) => useQuery({ queryKey: ['client', 'sav', id], queryFn: () => clientApi.get<SavTicket>(`/sav/${id}`), enabled: !!id });
export const useSavMeta = () => useQuery({ queryKey: ['client', 'sav-meta'], queryFn: () => clientApi.get<{ categories: Record<string, string> }>('/sav/meta'), staleTime: minutes(30) });
