/**
 * zod 4 tel que le serveur l'utilise : tout le code importe `z` d'ici, jamais de 'zod' directement.
 * Différence avec zod 4 brut : `.partial()` (schémas des modifications partielles) n'applique JAMAIS la valeur par défaut
 * d'un champ absent, comme en zod 3. Sans cela, une modification partielle (PATCH) remplacerait les valeurs enregistrées
 * par les valeurs par défaut des champs que l'utilisateur n'a pas envoyés (zod 4 applique les défauts même aux champs
 * facultatifs). Les créations (schémas complets) gardent leurs valeurs par défaut.
 */
const { z } = require('zod');

/** Le même schéma sans valeur par défaut (y compris sous .optional() ou .nullable()). */
function withoutDefault(s) {
  if (s instanceof z.ZodDefault || s instanceof z.ZodPrefault) return withoutDefault(s.unwrap());
  if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) {
    const inner = s.unwrap();
    const bare = withoutDefault(inner);
    if (bare === inner) return s;
    return s instanceof z.ZodOptional ? bare.optional() : bare.nullable();
  }
  return s;
}

// Méthode posée sur le prototype de ZodObject, que zod 4 consulte pour chaque schéma objet (extension prévue par zod). zod y
// installe ses propres méthodes à la création du PREMIER schéma objet : on en crée donc un d'abord, sinon la nôtre serait
// remplacée. Même appel interne que la méthode d'origine, sur le schéma dont les champs concernés ont perdu leur valeur par défaut.
z.object({});
if (!z.ZodObject.prototype.partial?.siipaf) {
  const partial = function (mask) {
    const shape = {};
    for (const [k, v] of Object.entries(this.shape)) {
      if (mask && !mask[k]) continue;
      const bare = withoutDefault(v);
      if (bare !== v) shape[k] = bare;
    }
    return z.core.util.partial(z.ZodOptional, Object.keys(shape).length ? this.extend(shape) : this, mask);
  };
  partial.siipaf = true;
  Object.defineProperty(z.ZodObject.prototype, 'partial', { value: partial, enumerable: true, writable: true, configurable: true });
}

module.exports = { z, withoutDefault };
