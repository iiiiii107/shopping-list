/* Turning a planned week into a list you can shop from. */

import { mergeIngredients, formatAmount } from './units.js';
import { groupByAisle } from './aisles.js';
import { scaleIngredients } from './item.js';
import { formatLong } from './dates.js';

export const MEALS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
];

/** Every entry planned between two dates, in order. */
export function entriesBetween(plan = {}, dates = []) {
  const out = [];
  for (const date of dates) {
    for (const meal of MEALS) {
      for (const entry of plan[date]?.[meal.id] || []) {
        out.push({ ...entry, date, meal: meal.id });
      }
    }
  }
  return out;
}

/**
 * What a planned meal is, and what it brings to the list.
 *
 * Three kinds sit in the plan and they are not interchangeable: a recipe from
 * a cookbook, a standby referred to by id, and something simply written into
 * the day. The last two may or may not have had ingredients filled in.
 */
function resolve(entry, recipesById, standbysById) {
  if (entry.recipeId) {
    const recipe = recipesById.get(entry.recipeId);
    if (recipe) {
      return { name: recipe.title, ingredients: recipe.ingredients || [], servings: recipe.servings };
    }
    /* Somebody else's recipe on a shared week. We know what it is called and
       nothing about what goes in it, so it belongs at the foot of the list —
       a reminder that Tuesday is spoken for, not a blank. */
    return entry.title ? { name: entry.title, ingredients: [] } : null;
  }
  if (entry.standbyId) {
    const standby = standbysById.get(entry.standbyId);
    // Some meals have no business on a shopping list at all. Eating out is
    // planned, and there is nothing to buy or to check the cupboard for — a
    // line saying so would be noise on the one list you carry to the shop.
    if (!standby || standby.onList === false) return null;
    return { name: standby.name, ingredients: standby.ingredients || [] };
  }
  if (entry.text) {
    if (entry.onList === false) return null;
    return { name: entry.text, ingredients: entry.ingredients || [] };
  }
  return null;
}

/**
 * Gather a planned week into a list you can shop from.
 *
 * Returns the aisle `groups`, and `extras`: the planned meals that brought no
 * ingredients with them. A jam sandwich has nothing to buy attached to it, but
 * it is still on Tuesday — so rather than disappearing it comes out at the
 * foot of the list as a reminder to check you have the bread.
 */
export function buildList({ plan, recipes = [], standbys = [], dates }) {
  const recipesById = new Map(recipes.map((r) => [r.id, r]));
  const standbysById = new Map(standbys.map((s) => [s.id, s]));
  const gathered = [];
  const counts = new Map();

  for (const entry of entriesBetween(plan, dates)) {
    const meal = resolve(entry, recipesById, standbysById);
    if (!meal) continue;

    if (!meal.ingredients.length) {
      // Tallied by name, so a week with the same lunch three times says so
      // once rather than three times over.
      counts.set(meal.name, (counts.get(meal.name) || 0) + 1);
      continue;
    }

    // A planned meal can be cooked for a different number of people than the
    // recipe was written for; the list has to reflect what will be cooked.
    const factor = entry.servings && meal.servings
      ? entry.servings / meal.servings
      : 1;

    for (const ingredient of scaleIngredients(meal.ingredients, factor)) {
      gathered.push({ ...ingredient, recipe: meal.name });
    }
  }

  return {
    groups: groupByAisle(mergeIngredients(gathered)),
    extras: [...counts].map(([name, count]) => ({ name, count })),
  };
}

/**
 * The list as markdown, with checkboxes.
 *
 * Markdown because it is readable anywhere and genuinely tickable in Notes,
 * Obsidian or Reminders — a shopping list is more use in the app you already
 * shop with than in a screen you have to keep this one open to see.
 */
export function toMarkdown(
  groups,
  { dates = [], skipped = new Set(), extras = [], skippedExtras = new Set() } = {},
) {
  const lines = ['# Shopping list', ''];

  if (dates.length) {
    const span = dates.length === 1
      ? formatLong(dates[0])
      : `${formatLong(dates[0])} – ${formatLong(dates[dates.length - 1])}`;
    lines.push(`_${span}_`, '');
  }

  for (const group of groups) {
    const items = group.items.filter((entry) => !skipped.has(entry.item));
    if (!items.length) continue;

    lines.push(`## ${group.label}`, '');
    for (const entry of items) {
      const amount = formatAmount(entry);
      lines.push(`- [ ] ${[amount, entry.label].filter(Boolean).join(' ')}`);
    }
    lines.push('');
  }

  /* The meals with nothing to buy for them, at the foot. Named exactly as they
     were typed — pluralising "jam sandwich" is a small thing to get wrong and
     "toast & coffees" is worse than leaving it alone. */
  /* Their own set. Ingredients are keyed by a singularised item name, so a
     quick meal called "Bread" and a bag of bread would share a key and untick
     each other. */
  const kept = extras.filter((extra) => !skippedExtras.has(extra.name));
  if (kept.length) {
    lines.push('## Also on the week', '');
    for (const { name, count } of kept) {
      lines.push(`- [ ] + ${count > 1 ? `${count} ` : ''}${name}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** A filename that sorts sensibly in a downloads folder. */
export function listFilename(dates = []) {
  const stamp = dates[0] || new Date().toISOString().slice(0, 10);
  return `shopping-list-${stamp}.md`;
}
