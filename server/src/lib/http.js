class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Enveloppe un handler async pour que ses erreurs arrivent au gestionnaire d'erreurs. */
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Valide `data` avec un schéma zod ; lève une 400 lisible sinon. */
function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map(i => ({ field: i.path.join('.'), message: i.message }));
    throw new HttpError(400, 'Données invalides.', details);
  }
  return result.data;
}

const idParam = req => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Identifiant invalide.');
  return id;
};

/** Les colonnes JSON reviennent en texte sous SQLite : on les décode au besoin. */
function json(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/** Date JS quel que soit le format renvoyé par la base (Date MySQL, millisecondes ou texte SQLite en UTC). */
function toDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value;
  if (typeof value === 'number' || /^\d+$/.test(value)) return new Date(Number(value));
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date « AAAA-MM-JJ » (les dates sans heure sont rendues telles quelles). */
function isoDay(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = toDate(value);
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Horodatage ISO 8601 (ou null). */
const isoTime = value => { const d = toDate(value); return d ? d.toISOString() : null; };

module.exports = { HttpError, ah, parse, idParam, json, toDate, isoDay, isoTime };
