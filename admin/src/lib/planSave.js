import { api } from './api';

/**
 * Enregistre une carte convertie : image de fond dans la médiathèque, plan créé (ou mis à jour
 * pour une reconversion), puis les lots. En reconversion, les lots du plan absents du nouveau
 * fichier redeviennent « à placer » (jamais supprimés : ils peuvent avoir un dossier).
 */
export async function savePlan({ projectId, planId, name, image, width, height, lots, onStep = () => {} }) {
  onStep('Envoi de l’image du plan…');
  const form = new FormData();
  const file = image instanceof File ? image : new File([image], `${(name || 'plan').replace(/[^\w-]+/g, '-')}.png`, { type: image.type || 'image/png' });
  form.append('files', file);
  form.append('meta', JSON.stringify([{ width, height, alt: `Plan de masse — ${name || ''}`.trim() }]));
  const [media] = await api.post('/admin/media', form);
  const plan = planId
    ? await api.patch(`/admin/plans/${planId}`, { media_id: media.id, width, height })
    : await api.post('/admin/plans', { project_id: projectId, name: name || 'Plan de masse', media_id: media.id, width, height });
  onStep(`Enregistrement des ${lots.length} lots…`);
  const summary = await api.put(`/admin/projects/${projectId}/lots${planId ? `?replace_plan=${planId}` : ''}`,
    lots.map(l => ({ ...l, plan_id: l.shape ? plan.id : null })));
  return { plan, summary };
}

export const summaryText = s => [
  `${s.created} lot(s) créé(s)`, `${s.updated} mis à jour`, s.unplaced ? `${s.unplaced} retiré(s) du plan (à placer)` : null,
  s.priced ? `${s.priced} prix tiré(s) de la grille` : null,
].filter(Boolean).join(', ');
