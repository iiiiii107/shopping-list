/* Reading and writing a shopping-list line.

   Items are stored parsed — { qty, unit, item, note } — not as free text.
   That one decision is what lets 100 ml of milk from one recipe and 150 ml
   from another arrive at the shop as 250 ml on a single line, and what lets
   two lists merge without doubling anything up. The raw line as it was typed
   is kept alongside, so nothing is ever lost to a parse we got wrong.

   Lifted from the cook book's src/lib/recipe.js, minus the recipe factories.
   Keep the two diffable: a fix to the parser belongs in both. */

import { uid } from './dom.js';

/** Units we recognise. Anything else is kept verbatim as the unit. */
export const UNITS = {
  g: 'g', gram: 'g', grams: 'g', gr: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  mg: 'mg',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml', milliliter: 'ml', milliliters: 'ml',
  cl: 'cl', dl: 'dl',
  l: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp',
  cup: 'cup', cups: 'cup',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  pinch: 'pinch', pinches: 'pinch',
  clove: 'clove', cloves: 'clove',
  slice: 'slice', slices: 'slice',
  sprig: 'sprig', sprigs: 'sprig',
  bunch: 'bunch', bunches: 'bunch',
  handful: 'handful', handfuls: 'handful',
  can: 'can', cans: 'can', tin: 'can', tins: 'can',
  jar: 'jar', jars: 'jar',
  packet: 'packet', packets: 'packet', pack: 'packet',
  // Countables that turn up constantly in European recipes and were being
  // lost: "3 sheets of gelatine" parsed as a bare number with the unit stuck
  // to the front of the item, so it could never be added up.
  sheet: 'sheet', sheets: 'sheet',
  stick: 'stick', sticks: 'stick',
  head: 'head', heads: 'head',
  stalk: 'stalk', stalks: 'stalk',
  rasher: 'rasher', rashers: 'rasher',
  fillet: 'fillet', fillets: 'fillet',
  punnet: 'punnet', punnets: 'punnet',
  knob: 'knob', knobs: 'knob',
  drop: 'drop', drops: 'drop',
};

const VULGAR = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

/** "1 1/2", "1½", "0.75", "1-2" → a number. Returns null if there isn't one. */
function readQuantity(text) {
  const t = text.trim();

  // A range keeps both ends. Sums and scaling use the lower bound — over-
  // buying on a guess is the wrong default — but the page still reads "1–2".
  const range = t.match(/^(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)/);
  if (range) {
    return {
      qty: Number(range[1].replace(',', '.')),
      qtyMax: Number(range[2].replace(',', '.')),
      length: range[0].length,
    };
  }

  // Mixed number: "1 1/2" or "1½"
  const mixed = t.match(/^(\d+)\s*(?:(\d+)\s*\/\s*(\d+)|([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]))/);
  if (mixed) {
    const frac = mixed[4] ? VULGAR[mixed[4]] : Number(mixed[2]) / Number(mixed[3]);
    return { qty: Number(mixed[1]) + frac, length: mixed[0].length };
  }

  const frac = t.match(/^(\d+)\s*\/\s*(\d+)/);
  if (frac) return { qty: Number(frac[1]) / Number(frac[2]), length: frac[0].length };

  const vulgar = t.match(/^([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/);
  if (vulgar) return { qty: VULGAR[vulgar[1]], length: vulgar[0].length };

  const plain = t.match(/^(\d+(?:[.,]\d+)?)/);
  if (plain) return { qty: Number(plain[1].replace(',', '.')), length: plain[0].length };

  return null;
}

/**
 * Turn one typed line into a structured ingredient.
 * "200 g plain flour, sifted" → { qty: 200, unit: 'g', item: 'plain flour',
 *                                 note: 'sifted' }
 * A line with no quantity ("salt to taste") is perfectly valid and keeps
 * qty null — it simply won't be summed on a shopping list.
 */
export function parseIngredient(line) {
  const raw = String(line).trim();
  if (!raw) return null;

  let rest = raw;
  let qty = null;
  let qtyMax = null;
  let unit = '';

  const read = readQuantity(rest);
  if (read) {
    qty = read.qty;
    qtyMax = read.qtyMax ?? null;
    rest = rest.slice(read.length).trim();

    // The unit only counts if a quantity introduced it, so "cup of tea" as an
    // ingredient name survives intact.
    const word = rest.match(/^([a-zA-Z]+)\.?\b/);
    if (word) {
      const known = UNITS[word[1].toLowerCase()];
      if (known) {
        unit = known;
        rest = rest.slice(word[0].length).trim();
      }
    }
    rest = rest.replace(/^of\s+/i, '');
  }

  // Everything after the first comma is a preparation note, not the shopping
  // item — you buy parsley, you don't buy "finely chopped".
  let note = '';
  const comma = rest.indexOf(',');
  if (comma >= 0) {
    note = rest.slice(comma + 1).trim();
    rest = rest.slice(0, comma).trim();
  }

  return { id: uid(), qty, qtyMax, unit, item: rest, note, raw };
}

/* Metric is written in decimals and everything else in fractions, because
   that is how each is actually said out loud: "½ cup" but "500 g", never
   "½ kg". */
const METRIC = new Set(['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l']);

/** Units that are really a count of things, so they take a plural. */
const COUNTABLE = {
  cup: 'cups', clove: 'cloves', slice: 'slices', sprig: 'sprigs',
  bunch: 'bunches', handful: 'handfuls', can: 'cans', jar: 'jars',
  packet: 'packets', pinch: 'pinches', sheet: 'sheets', stick: 'sticks',
  head: 'heads', stalk: 'stalks', rasher: 'rashers', fillet: 'fillets',
  punnet: 'punnets', knob: 'knobs', drop: 'drops',
};

/** 0.5 → "½", 1.5 → "1½", 250 → "250". Quantities read as a cook writes them. */
export function formatQty(qty, unit = '') {
  if (qty == null) return '';
  const rounded = Math.round(qty * 1000) / 1000;

  if (!METRIC.has(unit)) {
    const whole = Math.floor(rounded);
    const frac = rounded - whole;
    const glyph = Object.entries(VULGAR).find(([, value]) => Math.abs(value - frac) < 0.02);
    if (glyph && frac > 0.02) return whole ? `${whole}${glyph[0]}` : glyph[0];
  }

  if (Number.isInteger(rounded)) return String(rounded);
  return String(Math.round(rounded * 100) / 100);
}

/** The unit as it should read next to this quantity. */
export function formatUnit(unit, qty) {
  if (!unit) return '';
  const plural = COUNTABLE[unit];
  return plural && qty != null && qty > 1 ? plural : unit;
}

/** Back to one readable line. */
export function formatIngredient(ing) {
  const amount = ing.qtyMax
    ? `${formatQty(ing.qty, ing.unit)}–${formatQty(ing.qtyMax, ing.unit)}`
    : formatQty(ing.qty, ing.unit);
  const head = [amount, formatUnit(ing.unit, ing.qtyMax || ing.qty)].filter(Boolean).join(' ');
  const body = [head, ing.item].filter(Boolean).join(' ');
  return ing.note ? `${body}, ${ing.note}` : body;
}

/** Rescale for a different number of portions. Unquantified lines pass through. */
export function scaleIngredients(ingredients, factor) {
  if (!factor || factor === 1) return ingredients;
  return ingredients.map((ing) => {
    if (ing.qty == null) return ing;
    return {
      ...ing,
      qty: ing.qty * factor,
      qtyMax: ing.qtyMax == null ? null : ing.qtyMax * factor,
    };
  });
}

/* `parseIngredient` keeps its name above so this file stays diffable against
   the cookbook's recipe.js, which is where it comes from. On a shopping list
   the same thing is called an item. */
export const parseItem = parseIngredient;
export const formatItem = formatIngredient;
