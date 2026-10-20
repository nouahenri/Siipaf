const catalog = require('../lib/site-image-slots.json');
const { HttpError, json } = require('../lib/http');

const slotById = id => catalog.slots.find(s => s.id === id);
async function imageAssignments(db) {
  const row = await db('site_content').where({ key: 'images' }).first();
  return json(row?.value, {});
}

async function imagePlacements(db) {
  const assignments = await imageAssignments(db);
  const ids = [...new Set(Object.values(assignments).map(a => a.media_id).filter(Boolean))];
  const media = ids.length ? await db('media').whereIn('id', ids) : [];
  return {
    ...catalog,
    assignments: Object.fromEntries(Object.entries(assignments).filter(([id]) => slotById(id)).map(([id, a]) => {
      const m = media.find(m => m.id === a.media_id);
      return [id, { ...a, media: m ? { id: m.id, original_name: m.original_name, mime: m.mime, url: `/uploads/${m.filename}` } : null }];
    })),
  };
}

async function assignImage(db, slotId, { media_id, alt }, userId) {
  if (!slotById(slotId)) throw new HttpError(404, 'Emplacement inconnu.');
  await db.transaction(async trx => {
    if (media_id !== null) {
      const media = await trx('media').where({ id: media_id }).first();
      if (!media || !['image/jpeg', 'image/png', 'image/webp'].includes(media.mime)) {
        throw new HttpError(400, 'Choisissez une image JPG, PNG ou WebP de la médiathèque.');
      }
      if (await trx('sale_documents').where({ media_id }).first()) {
        throw new HttpError(409, 'Ce fichier est une pièce de dossier client. Choisissez une image destinée au site public.');
      }
    }
    await trx('site_content').insert({ key: 'images', value: '{}' }).onConflict('key').ignore();
    const row = await trx('site_content').where({ key: 'images' }).forUpdate().first();
    const assignments = json(row.value, {});
    if (media_id === null) delete assignments[slotId];
    else assignments[slotId] = { media_id, alt: alt || '' };
    await trx('site_content').where({ key: 'images' }).update({ value: JSON.stringify(assignments), updated_by: userId, updated_at: new Date() });
  });
  const placements = await imagePlacements(db);
  return placements.assignments[slotId] || null;
}

/** Seules les images de site affectées sont exposées, jamais les pièces client. */
async function publicSiteImages(db) {
  const { assignments } = await imagePlacements(db);
  const privateIds = new Set(await db('sale_documents').whereNotNull('media_id').pluck('media_id'));
  return Object.fromEntries(Object.entries(assignments)
    .filter(([, a]) => a.media && !privateIds.has(a.media_id) && ['image/jpeg', 'image/png', 'image/webp'].includes(a.media.mime))
    .map(([id, a]) => [id, { url: a.media.url, alt: a.alt }]));
}

module.exports = { catalog, slotById, imageAssignments, imagePlacements, assignImage, publicSiteImages };
