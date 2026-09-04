/* @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from 'vitest';
import { toMarkdown, sectionToMarkdown, parseMarkdown, listFromMarkdown, mergeMarkdown } from './md.js';
import { newList, newSection, newItem, readingOrder, itemToText } from './list.js';
import { store } from './store.js';

function sheet() {
  const fruit = newSection({ label: 'Fruit and veg', order: 1000 });
  return newList({
    title: 'Weekly shop',
    subtitle: 'for the flat',
    date: '2026-09-04',
    store: 'Billa',
    sections: [fruit],
    items: [
      newItem({ text: '250 ml milk', order: 1000 }),
      newItem({ text: 'sourdough, if they have it', order: 2000, done: true }),
      newItem({ text: '2 lemons', sectionId: fruit.id, order: 1000 }),
    ],
  });
}

describe('writing a list out', () => {
  it('reads as a shopping list to someone who has never heard of this app', () => {
    const md = toMarkdown(sheet());
    expect(md).toContain('# Weekly shop');
    expect(md).toContain('*for the flat*');
    expect(md).toContain('Date: 2026-09-04');
    expect(md).toContain('Shop: Billa');
    expect(md).toContain('- [ ] 250 ml milk');
    expect(md).toContain('- [x] sourdough, if they have it');
    expect(md).toContain('## Fruit and veg');
    expect(md).toContain('- [ ] 2 lemons');
  });

  it('sends just one section when that is all you meant to send', () => {
    const list = sheet();
    const md = sectionToMarkdown(list, list.sections[0].id);
    expect(md).toContain('## Fruit and veg');
    expect(md).toContain('- [ ] 2 lemons');
    expect(md).not.toContain('milk');
  });
});

describe('reading a list back in', () => {
  it('round-trips everything that was written out', () => {
    const before = sheet();
    const after = listFromMarkdown(toMarkdown(before));

    expect(after.title).toBe('Weekly shop');
    expect(after.subtitle).toBe('for the flat');
    expect(after.date).toBe('2026-09-04');
    expect(after.store).toBe('Billa');

    const groups = readingOrder(after);
    expect(groups[0].items.map(itemToText)).toEqual(['250 ml milk', 'sourdough, if they have it']);
    expect(groups[0].items[1].done).toBe(true);
    expect(groups[1].section.label).toBe('Fruit and veg');
    expect(groups[1].items.map(itemToText)).toEqual(['2 lemons']);
  });

  it('keeps the quantities parsed, so two lists can still be merged', () => {
    const after = listFromMarkdown('# Shop\n- [ ] 250 ml milk\n- [ ] 1.5 kg potatoes\n');
    const milk = after.items.find((i) => i.text === 'milk');
    expect(milk.qty).toBe(250);
    expect(milk.unit).toBe('ml');
  });

  /* The cook book's own shopping list export, near enough verbatim. Being able
     to read it is half the point of this app existing beside that one. */
  it('reads the cook book\'s own export', () => {
    const parsed = parseMarkdown([
      '# Shopping list', '',
      '_31 August – 6 September_', '',
      '## Fruit & veg', '',
      '- [ ] 3 onions',
      '- [ ] 1 bunch parsley', '',
      '## Dairy', '',
      '- [ ] 250 ml milk', '',
      '## Also on the week', '',
      '- [ ] + 2 jam sandwich', '',
    ].join('\n'));

    expect(parsed.title).toBe('Shopping list');
    expect(parsed.subtitle).toBe('31 August – 6 September');
    expect(parsed.sections.map((s) => s.label)).toEqual(['Fruit & veg', 'Dairy', 'Also on the week']);
    expect(parsed.items).toHaveLength(4);
    // The leading "+" is the cook book's mark for a meal with nothing to buy,
    // and is not part of the thing you are buying.
    expect(parsed.items[3].text).toBe('jam sandwich');
    expect(parsed.items[3].qty).toBe(2);
  });

  it('takes headings at any depth, and bold ones written by hand', () => {
    const parsed = parseMarkdown([
      '# Shop', '',
      '### Fruit', '- apples', '',
      '**Dairy**', '- milk',
    ].join('\n'));
    expect(parsed.sections.map((s) => s.label)).toEqual(['Fruit', 'Dairy']);
    expect(parsed.items.map((i) => i.text)).toEqual(['apples', 'milk']);
  });

  it('takes bullets of every kind, and numbers', () => {
    const parsed = parseMarkdown('* milk\n+ bread\n• eggs\n1. butter\n2) jam');
    expect(parsed.items.map((i) => i.text)).toEqual(['milk', 'bread', 'eggs', 'butter', 'jam']);
  });

  /* Plenty of people write a shopping list as one thing per line and nothing
     else. Refusing to read that would be pedantry. */
  it('takes a file with no markdown in it at all', () => {
    const parsed = parseMarkdown('milk\nbread\n2 lemons');
    expect(parsed.items.map((i) => i.text)).toEqual(['milk', 'bread', 'lemons']);
    expect(parsed.sections).toHaveLength(0);
  });

  it('a file that opens at ## is one section somebody sent you', () => {
    const parsed = parseMarkdown('## Fruit and veg\n- [ ] 2 lemons\n- [ ] apples');
    expect(parsed.title).toBe('');
    expect(parsed.sections.map((s) => s.label)).toEqual(['Fruit and veg']);
    expect(parsed.items).toHaveLength(2);
  });

  it('a heading after the items is a section, not the name of the list', () => {
    const parsed = parseMarkdown('- milk\n- bread\n\n## Fruit\n- apples');
    expect(parsed.title).toBe('');
    expect(parsed.sections.map((s) => s.label)).toEqual(['Fruit']);
    expect(parsed.items.filter((i) => !i.sectionId)).toHaveLength(2);
  });

  it('ignores rules and blank lines', () => {
    const parsed = parseMarkdown('# Shop\n\n---\n\n- milk\n***\n- bread');
    expect(parsed.items.map((i) => i.text)).toEqual(['milk', 'bread']);
  });

  /* An empty list is not worth making, and the cook book used to make them by
     the dozen from files that turned out to hold nothing. */
  it('refuses a file with nothing on it', () => {
    expect(parseMarkdown('')).toBeNull();
    expect(parseMarkdown('# Just a title\n\n---\n')).toBeNull();
    expect(listFromMarkdown('   ')).toBeNull();
  });

  it('names an unnamed list rather than leaving it blank', () => {
    const list = listFromMarkdown('- milk\n- bread', 'From a friend');
    expect(list.title).toBe('From a friend');
  });
});

describe('merging into a list that already exists', () => {
  it('adds the file\'s own headings and items past what is there', () => {
    const list = sheet();
    const patch = mergeMarkdown(list, '## Freezer\n- [ ] peas\n- [ ] fish fingers');

    expect(patch.sections.map((s) => s.label)).toEqual(['Fruit and veg', 'Freezer']);
    expect(patch.items).toHaveLength(5);

    const merged = { ...list, ...patch };
    const freezer = readingOrder(merged).find((g) => g.section?.label === 'Freezer');
    expect(freezer.items.map((i) => i.text)).toEqual(['peas', 'fish fingers']);
  });

  it('can drop the lot into one section you already have', () => {
    const list = sheet();
    const fruitId = list.sections[0].id;
    const patch = mergeMarkdown(list, '- [ ] apples\n- [ ] pears', { intoSection: fruitId });

    expect(patch.sections).toHaveLength(1);   // no new heading
    const merged = { ...list, ...patch };
    const fruit = readingOrder(merged).find((g) => g.section?.id === fruitId);
    expect(fruit.items.map((i) => i.text)).toEqual(['lemons', 'apples', 'pears']);
  });

  it('leaves what was already on the list untouched', () => {
    const list = sheet();
    const patch = mergeMarkdown(list, '- [ ] peas');
    expect(patch.items.slice(0, 3).map((i) => i.id)).toEqual(list.items.map((i) => i.id));
  });

  it('nothing to merge is null, not an empty patch', () => {
    expect(mergeMarkdown(sheet(), '# Nothing here\n')).toBeNull();
  });
});

/* --- and now the part that actually broke, last time ---------------------- */

describe('what lands in the store', () => {
  beforeEach(async () => {
    await store.init();
    store.state.lists = [];
  });

  /* The cook book's importer was perfect for weeks while every import saved a
     recipe with the right name and nothing in it, because the factory it
     handed the result to dropped every field it was not expecting. It was
     reported twice before anyone found it, because the tests only ever asked
     the parser what it had returned. So: through the store, every time. */
  it('a list imported from a file arrives whole, not just its title', async () => {
    const md = toMarkdown(sheet());
    const parsed = listFromMarkdown(md);
    const saved = store.addList(parsed);

    const fromStore = store.listById(saved.id);
    expect(fromStore.title).toBe('Weekly shop');
    expect(fromStore.subtitle).toBe('for the flat');
    expect(fromStore.date).toBe('2026-09-04');
    expect(fromStore.store).toBe('Billa');
    expect(fromStore.sections).toHaveLength(1);
    expect(fromStore.items).toHaveLength(3);
    expect(fromStore.items.find((i) => i.text === 'milk').qty).toBe(250);
  });

  it('a section imported into an open list arrives whole too', async () => {
    const list = store.addList(newList({ title: 'Weekly shop' }));
    const patch = mergeMarkdown(list, '## Freezer\n- [ ] peas\n- [ ] 2 kg fish fingers');
    await store.updateList(list.id, patch);

    const fromStore = store.listById(list.id);
    expect(fromStore.sections.map((s) => s.label)).toEqual(['Freezer']);
    expect(fromStore.items.map((i) => i.text)).toEqual(['peas', 'fish fingers']);
    expect(fromStore.items[1].qty).toBe(2);
    expect(fromStore.items[1].unit).toBe('kg');
  });

  it('survives the whole round trip: store, out, in, store', async () => {
    const first = store.addList(listFromMarkdown(toMarkdown(sheet())));
    const again = store.addList(listFromMarkdown(toMarkdown(store.listById(first.id))));

    const a = store.listById(first.id);
    const b = store.listById(again.id);
    expect(b.id).not.toBe(a.id);          // a shared list cannot collide with yours
    expect(b.items.map(itemToText)).toEqual(a.items.map(itemToText));
    expect(b.sections.map((s) => s.label)).toEqual(a.sections.map((s) => s.label));
  });
});
