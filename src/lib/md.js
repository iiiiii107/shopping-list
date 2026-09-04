import { newList, newSection, newItem, readingOrder, itemToText, orderAtEnd } from './list.js';

/* Lists as markdown, out and in.

   Out is easy and there is one rule: what comes out has to read as a shopping
   list to a person who has never heard of this app — in Notes, in Obsidian, in
   a message. That is why the items are `- [ ]` checkboxes rather than anything
   cleverer; they are a plain readable list anywhere and a tickable one in
   several places.

   In is the hard half, and the lesson from the cook book is that being strict
   is the wrong instinct. A list arrives from a friend's notes app, from a
   recipe site, from the cook book's own export, or typed into a message, and
   it is very rarely laid out the way you would have laid it out. So the parser
   takes headings at any level, bold headings, plain "Label:" lines, bullets of
   every kind, numbered lines, and files with no headings at all — where every
   line is simply an item.

   The other lesson, and the more expensive one: the cook book's importer was
   perfect for weeks while every import saved a recipe with nothing in it,
   because the factory it handed the result to dropped everything but the
   title. So the tests for this file assert on what lands in the store, not on
   what the parser returned. */

/* --- out ------------------------------------------------------------------ */

/** One list as markdown. */
export function toMarkdown(list) {
  const lines = [`# ${list.title || 'Shopping list'}`, ''];

  if (list.subtitle) lines.push(`*${list.subtitle}*`, '');
  if (list.date) lines.push(`Date: ${list.date}`);
  if (list.store) lines.push(`Shop: ${list.store}`);
  if (list.date || list.store) lines.push('');

  for (const { section, items } of readingOrder(list)) {
    if (!items.length) continue;
    if (section) lines.push(`## ${section.label}`, '');
    for (const item of items) {
      lines.push(`- [${item.done ? 'x' : ' '}] ${itemToText(item)}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/** One section of a list, for sending somebody just the vegetables. */
export function sectionToMarkdown(list, sectionId) {
  const group = readingOrder(list).find((g) => (g.section?.id || '') === sectionId);
  if (!group) return '';

  const lines = [`## ${group.section?.label || list.title || 'Shopping list'}`, ''];
  for (const item of group.items) {
    lines.push(`- [${item.done ? 'x' : ' '}] ${itemToText(item)}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/* --- in ------------------------------------------------------------------- */

const HEADING = /^(#{1,6})\s+(.*)$/;
/* A line that is nothing but bold, or nothing but bold ending in a colon, is
   somebody writing a heading without knowing the markdown for one. */
const BOLD_HEADING = /^\*\*(.+?)\*\*:?\s*$/;
const BULLET = /^\s*(?:[-*+•·–—]|\d+[.)])\s+(.*)$/;
const CHECKBOX = /^\[([ xX])\]\s*(.*)$/;
const META = /^(?:\*\*)?(date|shop|store|for|when|where)(?:\*\*)?\s*:\s*(.+?)\*?\*?$/i;
const ITALIC_ONLY = /^[*_](.+?)[*_]$/;

/** Lines that are decoration, not content. */
function isNoise(line) {
  return !line || /^([-*_=])\1{2,}$/.test(line.replace(/\s/g, ''));
}

/**
 * Read markdown into the makings of a list.
 *
 * Returns `{ title, subtitle, date, store, sections, items }` with real ids
 * and orders, ready to be handed straight to `newList` or merged into one that
 * already exists. Returns null when there is nothing on the page worth
 * importing — an empty list is not worth making, and the cook book used to
 * make them by the dozen.
 */
export function parseMarkdown(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');

  let title = '';
  let subtitle = '';
  let date = '';
  let store = '';
  const sections = [];
  const items = [];
  let current = '';          // the section id items are landing in
  let seenAnyItem = false;

  const addItem = (raw, done) => {
    const body = raw.trim().replace(/^\+\s*/, '');   // the cook book's "+ 2 jam sandwich"
    if (!body) return;
    seenAnyItem = true;
    items.push(newItem({
      text: body,
      done,
      sectionId: current,
      order: (items.filter((i) => i.sectionId === current).length + 1) * 1000,
    }));
  };

  const addSection = (label) => {
    const section = newSection({ label: label.trim(), order: (sections.length + 1) * 1000 });
    sections.push(section);
    current = section.id;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (isNoise(line)) continue;

    const heading = line.match(HEADING);
    const bold = !heading && line.match(BOLD_HEADING);

    if (heading || bold) {
      const label = (heading ? heading[2] : bold[1]).trim();
      const level = heading ? heading[1].length : 2;

      /* The first heading is the list's name — but only if nothing has been
         written down yet. A file that opens with items and gets a heading
         later is a list with a section in it, not a list called "Fruit". */
      if (!title && !seenAnyItem && level <= 1) {
        title = label;
      } else if (!title && !seenAnyItem && !sections.length && level >= 2) {
        /* A file that starts at ## is usually one section somebody has sent
           you. Keep it as a section and let the caller name the list. */
        addSection(label);
      } else {
        addSection(label);
      }
      continue;
    }

    const meta = line.match(META);
    if (meta && !seenAnyItem) {
      const key = meta[1].toLowerCase();
      const value = meta[2].trim();
      if (key === 'date' || key === 'when') date = value;
      else if (key === 'shop' || key === 'store' || key === 'where') store = value;
      else if (key === 'for') subtitle = value;
      continue;
    }

    const bullet = line.match(BULLET);
    const body = bullet ? bullet[1] : line;

    const box = body.match(CHECKBOX);
    if (box) {
      addItem(box[2], box[1].toLowerCase() === 'x');
      continue;
    }

    /* An italic line before anything else is a subtitle — it is how this app
       writes one, and how the cook book writes the week a list is for. */
    if (!seenAnyItem && !subtitle && !bullet) {
      const italic = body.match(ITALIC_ONLY);
      if (italic) { subtitle = italic[1].trim(); continue; }
    }

    /* Anything else is an item. A plain line with no bullet counts: plenty of
       people write a shopping list as one thing per line and nothing else, and
       refusing to read that would be pedantry. */
    addItem(body, false);
  }

  if (!items.length) return null;

  return { title, subtitle, date, store, sections, items };
}

/**
 * A whole file as a new list.
 * @param {string} text the markdown
 * @param {string} [fallbackTitle] used when the file never names itself
 */
export function listFromMarkdown(text, fallbackTitle = 'Shopping list') {
  const parsed = parseMarkdown(text);
  if (!parsed) return null;

  const { title, ...rest } = parsed;
  return newList({ title: title || fallbackTitle, ...rest });
}

/**
 * The same file, merged into a list that already exists — which is what
 * "import a section" means. Sections and items are given orders past whatever
 * is already there, so nothing lands on top of anything.
 *
 * Returns the patch to apply, or null if there was nothing to bring in.
 */
export function mergeMarkdown(list, text, { intoSection = null } = {}) {
  const parsed = parseMarkdown(text);
  if (!parsed) return null;

  const sections = [...(list.sections || [])];
  const items = [...(list.items || [])];
  const remap = new Map();

  /* Dropping everything into one named section is what you want when you are
     handed "the vegetables" and already know where they go. Otherwise the
     file's own headings come along as headings. */
  if (intoSection !== null) {
    for (const item of parsed.items) remap.set(item.sectionId, intoSection);
  } else {
    let order = orderAtEnd(sections);
    for (const section of parsed.sections) {
      const moved = { ...section, order };
      order += 1000;
      sections.push(moved);
      remap.set(section.id, moved.id);
    }
  }

  for (const item of parsed.items) {
    const sectionId = remap.get(item.sectionId) ?? (intoSection || '');
    items.push({
      ...item,
      sectionId,
      order: orderAtEnd(items.filter((i) => (i.sectionId || '') === (sectionId || ''))),
    });
  }

  return { sections, items };
}

/** A filename that will not surprise anyone. */
export function fileNameFor(list) {
  const slug = String(list.title || 'shopping list')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'shopping-list';
  return `${slug}.md`;
}
