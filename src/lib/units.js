/* Unit arithmetic for the shopping list.

   The whole point of storing ingredients parsed rather than as text is this
   file: 100 ml of milk in one recipe and 150 ml in another have to arrive at
   the shop as 250 ml, on one line.

   Two rules keep it honest:

   1. Quantities only combine inside a family. Millilitres and litres are the
      same family and add; tablespoons and millilitres are not, because the
      conversion depends on what is being measured and guessing it would put a
      wrong number on the list.
   2. Anything that cannot be added is kept side by side rather than fudged —
      "2 tbsp + 100 ml olive oil" is more use to a cook than a made-up total. */

import { formatUnit } from './item.js';

/* Every family, as multiples of the family's base unit.

   `units` is what may be *read* — centilitres are understood if a recipe uses
   them. `prefer` is what may be *written*, largest first, and it is a shorter
   list on purpose: 100 ml is 1 dl and nobody has ever written that on a
   shopping list. `decimals` is how much precision a step up may introduce,
   and a step up only happens when it costs no accuracy at all. */
const FAMILIES = [
  {
    id: 'mass',
    base: 'g',
    units: { mg: 0.001, g: 1, kg: 1000 },
    prefer: [['kg', 1000], ['g', 1]],
    decimals: 2,
  },
  {
    id: 'volume',
    base: 'ml',
    units: { ml: 1, cl: 10, dl: 100, l: 1000 },
    prefer: [['l', 1000], ['ml', 1]],
    decimals: 2,
  },
  // Spoons stay their own family. A tablespoon of flour and a tablespoon of
  // oil are not the same volume in any useful sense, so they are never
  // silently turned into millilitres. Three teaspoons become a tablespoon,
  // but only when it divides exactly — "1⅓ tbsp" helps nobody.
  {
    id: 'spoon',
    base: 'tsp',
    units: { tsp: 1, tbsp: 3 },
    prefer: [['tbsp', 3], ['tsp', 1]],
    decimals: 0,
  },
  {
    id: 'imperial-mass',
    base: 'oz',
    units: { oz: 1, lb: 16 },
    prefer: [['lb', 16], ['oz', 1]],
    decimals: 2,
  },
  { id: 'cup', base: 'cup', units: { cup: 1 }, prefer: [['cup', 1]], decimals: 2 },
];

/* Countable things each get their own family: you cannot add cloves to
   slices, but two lots of cloves add perfectly well. */
const COUNTABLE = [
  'clove', 'slice', 'sprig', 'bunch', 'handful', 'can', 'jar', 'packet', 'pinch',
  'sheet', 'stick', 'head', 'stalk', 'rasher', 'fillet', 'punnet', 'knob', 'drop',
];
for (const unit of COUNTABLE) {
  FAMILIES.push({
    id: unit, base: unit, units: { [unit]: 1 }, prefer: [[unit, 1]], decimals: 2,
  });
}

/** A bare number with no unit — three eggs, two onions. */
const COUNT = { id: 'count', base: '', units: { '': 1 }, prefer: [['', 1]], decimals: 2 };

/** Which family a unit belongs to, or null if we have never heard of it. */
export function familyOf(unit) {
  const key = String(unit || '').toLowerCase();
  if (!key) return COUNT;
  return FAMILIES.find((family) => key in family.units) || null;
}

/** Can these two units be added together at all? */
export function compatible(a, b) {
  const fa = familyOf(a);
  const fb = familyOf(b);
  return Boolean(fa && fb && fa.id === fb.id);
}

/** Convert a quantity into its family's base unit. */
export function toBase(qty, unit) {
  const family = familyOf(unit);
  if (!family) return null;
  return qty * family.units[String(unit || '').toLowerCase()];
}

/**
 * Present a base-unit amount in the unit a person would actually write.
 * 1500 g reads as 1.5 kg; 700 g stays in grams; 1333 g stays in grams too,
 * because 1.33 kg would quietly lose three of them.
 */
export function fromBase(amount, familyId) {
  const family = [...FAMILIES, COUNT].find((f) => f.id === familyId);
  if (!family) return { qty: round(amount), unit: '' };

  for (const [unit, size] of family.prefer) {
    if (size <= 1 || amount < size) continue;
    const qty = amount / size;
    if (exact(qty, family.decimals)) return { qty: round(qty), unit };
  }
  return { qty: round(amount), unit: family.base };
}

/** Does this number fit in `decimals` places with nothing lost? */
function exact(value, decimals) {
  const scaled = value * 10 ** decimals;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

/* --- names ---------------------------------------------------------------- */

/* Plurals are handled conservatively. Stripping a trailing "s" would turn
   asparagus into asparagu and couscous into couscou, so words that genuinely
   end in one of those endings are left alone. */
const KEEP_TRAILING_S = /(ss|us|is|as|os)$/;

/** The form two ingredient lines are compared by. */
export function normaliseItem(item) {
  // Trim before stripping punctuation: with trailing spaces still attached,
  // the end-anchor never matches and the full stop survives.
  let name = String(item || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?]+$/, '');

  // Leading articles and vague amounts carry no meaning for matching.
  name = name.replace(/^(a|an|the|some|of)\s+/, '');

  if (/(ches|shes|xes|zes|oes)$/.test(name)) return name.slice(0, -2);
  if (/ies$/.test(name)) return `${name.slice(0, -3)}y`;
  if (/s$/.test(name) && !KEEP_TRAILING_S.test(name)) return name.slice(0, -1);
  return name;
}

/* --- merging --------------------------------------------------------------- */

/**
 * Combine a pile of ingredients into a shopping list.
 *
 * Lines for the same item whose units can be added become one line. Lines for
 * the same item in units that cannot be added stay as separate amounts on a
 * single entry, so the cook sees "2 tbsp + 100 ml" rather than a wrong total.
 *
 * @param {Array<{qty: number|null, unit: string, item: string, note?: string}>} list
 * @returns {Array<{item: string, label: string, amounts: Array, from: string[]}>}
 */
export function mergeIngredients(list) {
  const byItem = new Map();

  for (const ingredient of list) {
    if (!ingredient?.item) continue;
    const key = normaliseItem(ingredient.item);
    if (!key) continue;

    if (!byItem.has(key)) {
      byItem.set(key, {
        item: key, label: ingredient.item.trim(), amounts: [], from: [],
        // Every form of the name that was actually written down. Merging
        // matches on the singular, so "1 onion" and "2 onions" become one
        // entry — and which of the two words ends up on the list must not
        // depend on which recipe happened to be read first.
        forms: [],
      });
    }
    const entry = byItem.get(key);
    const written = ingredient.item.trim();
    if (written && !entry.forms.includes(written)) entry.forms.push(written);
    if (ingredient.recipe && !entry.from.includes(ingredient.recipe)) {
      entry.from.push(ingredient.recipe);
    }

    // No quantity at all — "salt to taste". It belongs on the list, but there
    // is nothing to add up.
    if (ingredient.qty == null) {
      if (!entry.amounts.some((a) => a.family === null)) {
        entry.amounts.push({ family: null, base: null, unit: '' });
      }
      continue;
    }

    const family = familyOf(ingredient.unit);
    if (!family) {
      // An unrecognised unit is kept verbatim rather than dropped.
      entry.amounts.push({ family: `raw:${ingredient.unit}`, base: ingredient.qty, unit: ingredient.unit });
      continue;
    }

    const existing = entry.amounts.find((a) => a.family === family.id);
    const base = toBase(ingredient.qty, ingredient.unit);
    if (existing) existing.base += base;
    else entry.amounts.push({ family: family.id, base, unit: family.base });
  }

  return [...byItem.values()];
}

/** One merged entry, written the way it should appear on the list. */
/**
 * The name to print, in the form that agrees with the number in front of it.
 *
 * It only ever chooses between forms somebody actually typed, so it cannot
 * invent a wrong word the way a pluralising rule would — but that is also its
 * limit: given only "1 onion" twice it will say "2 onion", because nobody
 * ever wrote the other word down. Longest-when-plural is crude and right far
 * more often than it is wrong, which is the trade being made.
 */
export function labelFor(entry) {
  const forms = entry.forms?.length ? entry.forms : [entry.label];
  if (forms.length === 1) return forms[0];

  // Only a bare count pluralises the noun. "250 ml milk" stays milk however
  // many recipes it came from.
  const count = entry.amounts?.find((a) => a.family === 'count');
  const plural = count && count.base > 1;

  const byLength = [...forms].sort((a, b) => a.length - b.length);
  return plural ? byLength[byLength.length - 1] : byLength[0];
}

export function formatAmount(entry) {
  const parts = entry.amounts
    .filter((a) => a.base != null)
    .map((a) => {
      if (String(a.family).startsWith('raw:')) {
        return `${round(a.base)} ${a.unit}`.trim();
      }
      const { qty, unit } = fromBase(a.base, a.family);
      // Through the same pluraliser the page uses, or the list reads
      // "3 clove garlic" and "5 sheet gelatine".
      const written = formatUnit(unit, qty);
      return `${qty}${written ? ` ${written}` : ''}`;
    });
  return parts.join(' + ');
}
