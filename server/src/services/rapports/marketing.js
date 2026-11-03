/**
 * Rapport du Marketing & Communication : campagnes actives sur la période, contenus publiés, dépense de l'IA (le budget du
 * module, contre son plafond mensuel), prospects venus d'un lien de campagne (leads.campaign_id) créés sur la période.
 * Droits : ceux du tableau de bord (marketing:read). Portée de l'écran : des comptes de prospects, jamais leurs noms.
 * Lecture seule : la ligne éditoriale permanente n'est pas créée ici (elle l'est par le tableau de bord ou la tâche horaire).
 */
const { toDate } = require('../../lib/http');
const { CLIENT_STAGES } = require('../../lib/domain');
const { CHANNELS, KINDS, SEGMENTS, CAMPAIGN_STATUSES, STEPS, MODELS, microUsdToFcfa } = require('../../lib/marketing');
const settingsService = require('../marketingSettings');
const { inPeriod, day, sum } = require('./index');

const MEDIUMS = { social: 'Réseaux sociaux', email: 'E-mail (newsletter)', messagerie: 'Messagerie (WhatsApp)', site: 'Site siipaf.com' };
const GENERATION_STATUSES = { ok: 'Réussie', invalide: 'Sortie invalide', erreur: 'Erreur', refuse_plafond: 'Refusée (plafond)', en_cours: 'En cours' };
const SPENT = ['ok', 'invalide', 'erreur']; // appels réellement facturés (« en cours » : coût seulement réservé)
const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

module.exports = {
  title: 'Marketing & Communication',
  allowed: v => v.can('marketing:read'),
  async build(db, p) {
    const [campaigns, contents, leads, generations, s] = await Promise.all([
      db('marketing_campaigns').select('id', 'name', 'segment', 'status', 'permanent', 'starts_on', 'ends_on', 'validated_at', 'created_at', 'updated_at'),
      db('marketing_contents as c').join('marketing_campaigns as k', 'k.id', 'c.campaign_id')
        .select('c.id', 'c.campaign_id', 'c.channel', 'c.kind', 'c.title', 'c.status', 'c.scheduled_for', 'c.published_at', 'c.published_url', 'k.name as campaign_name'),
      db('leads').select('id', 'created_at', 'campaign_id', 'utm_medium', 'stage'),
      db('marketing_generations as g').leftJoin('marketing_campaigns as k', 'k.id', 'g.campaign_id')
        .select('g.id', 'g.campaign_id', 'g.step', 'g.mode', 'g.model', 'g.status', 'g.cost_micro_usd', 'g.created_at', 'k.name as campaign_name'),
      settingsService.all(db),
    ]);
    const rate = s.marketing_usd_fcfa;
    const fcfa = micro => microUsdToFcfa(micro, rate);

    // Campagne active sur la période : validée (ou archivée depuis le début de la période) et dont les dates (début, fin)
    // recoupent la période ; sans date de début (ligne éditoriale permanente…), créée avant la fin de la période
    const overlaps = c => (!c.starts_on || day(c.starts_on) <= p.toDay) && (!c.ends_on || day(c.ends_on) >= p.fromDay);
    const live = c => c.status === 'validee' || (c.status === 'archivee' && !!c.validated_at && toDate(c.updated_at) >= p.from);
    const active = campaigns.filter(c => live(c) && overlaps(c) && (c.starts_on || toDate(c.created_at) < p.to));

    const published = contents.filter(c => inPeriod(p, c.published_at)).sort((a, b) => String(day(a.published_at)).localeCompare(String(day(b.published_at))));
    const planned = contents.filter(c => ['valide', 'planifie'].includes(c.status) && inPeriod(p, c.scheduled_for));
    const fresh = leads.filter(l => inPeriod(p, l.created_at));
    const tracked = fresh.filter(l => l.campaign_id);
    const isClient = l => CLIENT_STAGES.includes(l.stage);
    const runs = generations.filter(g => inPeriod(p, g.created_at)).sort((a, b) => (toDate(a.created_at) - toDate(b.created_at)) || a.id - b.id);
    const spent = runs.filter(g => g.mode === 'ia' && SPENT.includes(g.status));
    const spentFcfa = fcfa(sum(spent, 'cost_micro_usd'));

    // Campagnes du rapport : actives sur la période, ou avec un contenu publié, un prospect ou une dépense de l'IA sur la période
    const touched = new Set([...published.map(c => c.campaign_id), ...tracked.map(l => l.campaign_id), ...spent.map(g => g.campaign_id)]);
    const activeIds = new Set(active.map(c => c.id));
    const listed = campaigns.filter(c => activeIds.has(c.id) || touched.has(c.id))
      .sort((a, b) => Number(b.permanent) - Number(a.permanent) || String(a.name).localeCompare(String(b.name), 'fr'));

    const byMedium = {};
    for (const l of tracked) {
      const k = l.utm_medium || 'non_precise';
      byMedium[k] = byMedium[k] || { prospects: 0, clients: 0 };
      byMedium[k].prospects++;
      if (isClient(l)) byMedium[k].clients++;
    }

    return {
      summary: [
        { label: 'Campagnes actives sur la période', value: active.length, format: 'number' },
        { label: 'Contenus publiés', value: published.length, format: 'number' },
        { label: 'Contenus planifiés sur la période, pas encore publiés', value: planned.length, format: 'number' },
        { label: 'Prospects venus d’une campagne', value: tracked.length, format: 'number' },
        { label: 'Part des nouveaux prospects venus d’une campagne', value: pct(tracked.length, fresh.length), format: 'percent' },
        { label: 'Prospects des campagnes devenus clients', value: tracked.filter(isClient).length, format: 'number' },
        { label: 'Dépense de l’IA sur la période', value: spentFcfa, format: 'fcfa' },
        { label: 'Plafond mensuel de dépense de l’IA (réglage en vigueur)', value: s.marketing_cap_fcfa, format: 'fcfa' },
      ],
      sections: [
        { title: 'Campagnes de la période', columns: [
          { key: 'campagne', label: 'Campagne' }, { key: 'segment', label: 'Segment' }, { key: 'statut', label: 'Statut actuel' }, { key: 'active', label: 'Active sur la période' },
          { key: 'debut', label: 'Début', format: 'date' }, { key: 'fin', label: 'Fin', format: 'date' }, { key: 'publies', label: 'Contenus publiés', format: 'number' },
          { key: 'prospects', label: 'Prospects', format: 'number' }, { key: 'clients', label: 'Devenus clients', format: 'number' }, { key: 'depense', label: 'Dépense de l’IA', format: 'fcfa' },
        ], rows: listed.map(c => {
          const mine = tracked.filter(l => l.campaign_id === c.id);
          return {
            campagne: c.permanent ? `${c.name} (ligne permanente)` : c.name, segment: SEGMENTS[c.segment] || c.segment, statut: CAMPAIGN_STATUSES[c.status] || c.status,
            active: activeIds.has(c.id) ? 'Oui' : 'Non', debut: day(c.starts_on), fin: day(c.ends_on), publies: published.filter(x => x.campaign_id === c.id).length,
            prospects: mine.length, clients: mine.filter(isClient).length, depense: fcfa(sum(spent.filter(g => g.campaign_id === c.id), 'cost_micro_usd')),
          };
        }) },
        { title: 'Contenus publiés sur la période', columns: [
          { key: 'date', label: 'Publié le', format: 'date' }, { key: 'campagne', label: 'Campagne' }, { key: 'canal', label: 'Canal' }, { key: 'type', label: 'Type' },
          { key: 'titre', label: 'Titre' }, { key: 'lien', label: 'Lien de la publication' },
        ], rows: published.map(c => ({
          date: day(c.published_at), campagne: c.campaign_name, canal: CHANNELS[c.channel]?.label || c.channel, type: KINDS[c.kind] || c.kind, titre: c.title, lien: c.published_url,
        })) },
        { title: 'Prospects des campagnes par canal', columns: [
          { key: 'canal', label: 'Canal (type de lien)' }, { key: 'prospects', label: 'Prospects', format: 'number' }, { key: 'clients', label: 'Devenus clients', format: 'number' },
          { key: 'part', label: 'Part des prospects des campagnes', format: 'percent' },
        ], rows: Object.entries(byMedium).sort((a, b) => b[1].prospects - a[1].prospects).map(([k, m]) => ({
          canal: MEDIUMS[k] || (k === 'non_precise' ? 'Non précisé' : k), prospects: m.prospects, clients: m.clients, part: pct(m.prospects, tracked.length),
        })) },
        { title: 'Préparations de l’IA sur la période', columns: [
          { key: 'date', label: 'Date', format: 'date' }, { key: 'campagne', label: 'Campagne' }, { key: 'etape', label: 'Étape' }, { key: 'mode', label: 'Mode' },
          { key: 'modele', label: 'Modèle' }, { key: 'etat', label: 'État' }, { key: 'cout', label: 'Coût', format: 'fcfa' },
        ], rows: runs.map(g => ({
          date: day(g.created_at), campagne: g.campaign_name, etape: STEPS[g.step] || g.step, mode: g.mode === 'ia' ? 'IA' : 'Démonstration',
          modele: g.mode === 'ia' ? MODELS[g.model]?.label || g.model : null, etat: GENERATION_STATUSES[g.status] || g.status,
          cout: g.mode === 'ia' && SPENT.includes(g.status) ? fcfa(g.cost_micro_usd) : 0,
        })) },
      ],
    };
  },
};
