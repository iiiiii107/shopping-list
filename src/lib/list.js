/* The shopping list model.

   Two decisions here carry the whole app, and both exist because more than
   one person writes on a list at once.

   1. ORDER IS A FLOAT, NOT AN INDEX. Inserting between 2 and 3 writes 2.5.
      Integer positions would mean renumbering every item below the insert,
      and two people inserting at the same moment would renumber each other
      into a mess. Floats let each insert touch exactly one item.

   2. SECTIONS ARE LABELS, NOT CONTAINERS. A section lives on the list header
      and an item points at it by id. Moving an item between sections is then
      one field on one document, rather than a rewrite of two arrays that a
      second person might be rewriting at the same time.

   Both hold for a private list too. They cost nothing there, and it means
   there is one model rather than two that have to agree. */

import { uid } from './dom.js';
import { parseItem, formatItem } from './item.js';

/** The gap left between items, so there is always room to insert between. */
const STEP = 1000;

/**
 * A new list. Anything you pass through is kept — the cook book once had a
 * factory that quietly dropped everything but two fields, and every import in
 * the app saved an empty record for weeks before anyone worked out why. The
 * `...rest` below is that lesson, and the tests hold it in place.
 */
export function newList({ title = 'Shopping list', id, createdAt, updatedAt, ...rest } = {}) {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title,
    subtitle: '',
    date: '',
    store: '',
    paper: 'plain',
    // This sheet's own colours, over the global ones — a set for each theme,
    // so a list can be cream by day and deep green at night.
    palette: { light: {}, dark: {} },
    sections: [],         // { id, label, order }
    items: [],
    // Sharing is off until it is deliberately turned on. A list that has
    // never been shared never leaves this browser.
    shared: false,
    members: [],
    invited: [],
    linkOpen: false,
    owner: '',
    ...rest,
    createdAt: createdAt || now,
    updatedAt: now,
  };
}

/** A new item. Same `...rest` rule, for the same reason. */
export function newItem({ text = '', id, ...rest } = {}) {
  const parsed = text ? parseItem(text) : null;
  return {
    id: uid(),
    text: parsed?.item ?? String(text).trim(),
    qty: parsed?.qty ?? null,
    qtyMax: parsed?.qtyMax ?? null,
    unit: parsed?.unit ?? '',
    note: parsed?.note ?? '',
    sectionId: '',
    order: 0,
    done: false,
    doneBy: '',
    doneAt: '',
    addedBy: '',
    ...rest,
    updatedAt: new Date().toISOString(),
  };
}

export function newSection({ label = 'Section', ...rest } = {}) {
  return { id: uid(), label, order: 0, ...rest };
}

/**
 * An order value that sorts between `before` and `after`. Either may be null,
 * meaning "the start" or "the end" of the list.
 *
 * The midpoint is deliberate: two people inserting in the same gap at the same
 * moment get the same number, which sorts as a tie rather than as a lost item.
 * Ties fall back to the item id, so both survive and both sides agree on the
 * order they ended up in.
 */
export function orderBetween(before, after) {
  const lo = before?.order;
  const hi = after?.order;
  if (lo == null && hi == null) return STEP;
  if (lo == null) return hi - STEP;
  if (hi == null) return lo + STEP;
  return (lo + hi) / 2;
}

/** The order for something appended to the end of a run of items. */
export function orderAtEnd(items) {
  if (!items.length) return STEP;
  return Math.max(...items.map((i) => i.order ?? 0)) + STEP;
}

/* Sorting is by order, then by id. The id tiebreak is what makes two clients
   agree when a float collision happens — without it, two people could be
   looking at the same list in two different orders, which is unsettling in a
   way that is very hard to explain to someone standing in a shop. */
function byOrder(a, b) {
  const diff = (a.order ?? 0) - (b.order ?? 0);
  return diff !== 0 ? diff : String(a.id).localeCompare(String(b.id));
}

export function sortedSections(list) {
  return [...(list.sections || [])].sort(byOrder);
}

/** Items in one section, in order. Pass '' for the ones with no section. */
export function itemsInSection(list, sectionId = '') {
  return (list.items || [])
    .filter((item) => (item.sectionId || '') === sectionId)
    .sort(byOrder);
}

/**
 * The whole list as it reads on the paper: loose items first, then each
 * section with its own. Sections a list no longer has are not dropped — their
 * items reappear at the top rather than vanishing, because an item silently
 * disappearing from a shopping list is worse than one in the wrong place.
 */
export function readingOrder(list) {
  const sections = sortedSections(list);
  const known = new Set(sections.map((s) => s.id));
  const loose = (list.items || [])
    .filter((item) => !item.sectionId || !known.has(item.sectionId))
    .sort(byOrder);

  return [
    { section: null, items: loose },
    ...sections.map((section) => ({ section, items: itemsInSection(list, section.id) })),
  ];
}

/** How many are left to find, and how many there are. */
export function progressOf(list) {
  const items = list.items || [];
  return { done: items.filter((i) => i.done).length, total: items.length };
}

/** One item as a line of text — for export, and for editing in place. */
export function itemToText(item) {
  return formatItem({
    qty: item.qty, qtyMax: item.qtyMax, unit: item.unit,
    item: item.text, note: item.note,
  });
}

/**
 * Re-read an edited line back into its parts. Used when someone types over an
 * item in place: they may have typed "2 tins tomatoes" over "tomatoes", and
 * the quantity has to follow, or the merge arithmetic quietly stops working.
 */
export function retextItem(item, text) {
  const parsed = parseItem(text);
  return {
    ...item,
    text: parsed?.item ?? String(text).trim(),
    qty: parsed?.qty ?? null,
    qtyMax: parsed?.qtyMax ?? null,
    unit: parsed?.unit ?? '',
    note: parsed?.note ?? '',
    updatedAt: new Date().toISOString(),
  };
}

export const SORT_MODES = [
  { id: 'added', label: 'As written' },
  { id: 'alpha', label: 'A to Z' },
  { id: 'left', label: 'Left to find' },
];

/**
 * The sheets in the order they lie on the table.
 *
 * However you last arranged them, if you have arranged them; otherwise the
 * most recently touched first, which is the sensible thing for a table nobody
 * has tidied. The two are not mixed: the moment one list is moved by hand,
 * every list is given a place, so there is never a table half sorted by hand
 * and half by date, which would move things under you.
 */
export function sortLists(lists, order = {}) {
  const placed = lists.some((l) => order[l.id] != null);

  return [...lists].sort((a, b) => {
    if (placed) {
      const diff = (order[a.id] ?? 0) - (order[b.id] ?? 0);
      if (diff !== 0) return diff;
    }
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
}

/** Give every sheet a place, keeping the order they are lying in now. */
export function placeAll(lists) {
  const out = {};
  lists.forEach((list, i) => { out[list.id] = (i + 1) * 1000; });
  return out;
}
