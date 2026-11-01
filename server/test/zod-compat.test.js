const { test } = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('../src/lib/zod');

// zod 4 applique les valeurs par défaut même aux champs facultatifs : src/lib/zod.js rétablit, pour .partial() (schémas des
// modifications), le comportement de zod 3 — un champ absent reste absent, il n'écrase jamais la valeur enregistrée.
const schema = z.object({
  kind: z.enum(['a', 'b']).default('a'), name: z.string().min(2), active: z.boolean().optional().default(true),
  note: z.string().default('').nullable(),
}).strict();

test('création : les valeurs par défaut s’appliquent', () => {
  assert.deepEqual(schema.parse({ name: 'Nom' }), { kind: 'a', name: 'Nom', active: true, note: '' });
});

test('modification partielle : un champ absent reste absent, une valeur envoyée est gardée', () => {
  assert.deepEqual(schema.partial().parse({ name: 'Nouveau' }), { name: 'Nouveau' });
  assert.deepEqual(schema.partial().parse({ kind: 'b' }), { kind: 'b' });
  assert.deepEqual(schema.partial({ kind: true }).parse({ name: 'Nom' }), { name: 'Nom', active: true, note: '' }, 'seuls les champs du masque perdent leur défaut');
  assert.deepEqual(schema.extend({ extra: z.number().default(1) }).partial().omit({ name: true }).parse({}), {});
  assert.deepEqual(schema.partial().extend({ added: z.number().default(7) }).parse({}), { added: 7 }, 'un champ ajouté après garde son défaut');
});

test('modification partielle : contrôles et refus inchangés', () => {
  assert.equal(schema.partial().safeParse({ inconnu: 1 }).success, false, 'objet strict');
  assert.equal(schema.partial().safeParse({ name: 'x' }).success, false, 'longueur minimale');
  assert.equal(schema.partial().safeParse({ kind: 'c' }).success, false, 'valeur hors liste');
});

test('messages d’erreur personnalisés (format zod 4)', () => {
  assert.equal(z.literal(true, { error: 'Accord requis' }).safeParse(false).error.issues[0].message, 'Accord requis');
  assert.equal(z.string().min(2, 'Trop court').safeParse('a').error.issues[0].message, 'Trop court');
});
