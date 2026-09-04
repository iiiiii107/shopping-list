import { firebase, currentAccount, syncConfigured } from './sync.js';
import { buildList } from './shopping.js';
import { weekStarts } from './plan.js';
import { addDays, formatLong, todayISO, startOfWeek } from './dates.js';
import { formatAmount, labelFor } from './units.js';
import { newList, newSection, newItem } from './list.js';

/* Reading the cook book.

   Both apps are signed in as the same person and share one Firebase project,
   so this reads that person's own documents with that person's own
   permissions. There is no new rule, no new permission, and nothing in the
   cook book had to change to allow it — `users/{uid}/**` was always yours.

   What comes back is the meal plan and the recipes it points at. The turning
   of that into a shopping list is not reimplemented here: shopping.js and
   units.js are the cook book's own files, lifted, so 100 ml and 150 ml still
   add up to 250 ml in exactly the way they do over there. */

/** The three weeks the cook book's planning sheet covers. */
export function weeks(today = todayISO()) {
  return weekStarts(today).map((start) => ({
    start,
    dates: Array.from({ length: 7 }, (_, i) => addDays(start, i)),
    label: label(start, today),
  }));
}

function label(start, today) {
  const here = startOfWeek(today, 1);
  if (start === here) return 'This week';
  if (start < here) return 'Last week';
  return 'Next week';
}

/** A readable span for a run of dates — what the list ends up subtitled with. */
export function spanOf(dates) {
  if (!dates.length) return '';
  return dates.length === 1
    ? formatLong(dates[0])
    : `${formatLong(dates[0])} – ${formatLong(dates[dates.length - 1])}`;
}

/**
 * Fetch the plan and recipes from the cook book.
 *
 * Returns null when there is nothing to read — not signed in, no database, or
 * simply no cook book on this account. That is not an error worth a dialog;
 * it is the ordinary state of someone who does not use the other app.
 */
export async function readCookbook() {
  if (!syncConfigured() || !currentAccount()) return null;
  const uid = currentAccount().uid;

  const { firestore: f, db } = await firebase();

  // The cook book keeps everything but its recipes in one document, and each
  // recipe as its own — a document is capped at 1 MB and a cookbook grows.
  const [stateSnap, recipeSnap] = await Promise.all([
    f.getDoc(f.doc(db, 'users', uid, 'app', 'cookbook')),
    f.getDocs(f.collection(db, 'users', uid, 'recipes')),
  ]);

  if (!stateSnap.exists()) return null;

  let state = {};
  try {
    state = JSON.parse(stateSnap.data().payload || '{}');
  } catch {
    return null;   // not ours to repair
  }

  return {
    plan: state.plan || {},
    standbys: state.standbys || [],
    recipes: recipeSnap.docs.map((d) => d.data()),
  };
}

/**
 * A week of the cook book's plan, as a shopping list ready to be saved.
 *
 * The aisles become headings, which is what they were for; the meals that
 * brought no ingredients with them come out at the foot under their own
 * heading, because a jam sandwich is still on Tuesday and you may want to
 * check you have the bread.
 */
export function listFromWeek(cookbook, { dates, title, subtitle }) {
  const { groups, extras } = buildList({ ...cookbook, dates });
  if (!groups.length && !extras.length) return null;

  const sections = [];
  const items = [];
  let sectionOrder = 1000;

  for (const group of groups) {
    if (!group.items.length) continue;
    const section = newSection({ label: group.label, order: sectionOrder });
    sectionOrder += 1000;
    sections.push(section);

    let order = 1000;
    for (const entry of group.items) {
      items.push(newItem({
        text: [formatAmount(entry), labelFor(entry)].filter(Boolean).join(' '),
        sectionId: section.id,
        order,
      }));
      order += 1000;
    }
  }

  if (extras.length) {
    const section = newSection({ label: 'Also on the week', order: sectionOrder });
    sections.push(section);
    let order = 1000;
    for (const { name, count } of extras) {
      items.push(newItem({
        text: count > 1 ? `${count} ${name}` : name,
        sectionId: section.id,
        order,
      }));
      order += 1000;
    }
  }

  if (!items.length) return null;

  return newList({
    title: title || 'Shopping list',
    subtitle: subtitle || spanOf(dates),
    date: dates[0] || '',
    sections,
    items,
  });
}
