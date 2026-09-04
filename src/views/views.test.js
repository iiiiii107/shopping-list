/* @vitest-environment jsdom */

/* Every button on every screen, clicked.
 *
 * Carried over from the cook book, where the unit tests covered the logic
 * well and caught none of the bugs that actually reached the kitchen: a Done
 * button that threw a ReferenceError and did nothing, an import that saved a
 * recipe with no ingredients. Both were one click away from obvious.
 *
 * So this renders each screen for real and clicks everything on it, failing
 * on any exception. It is deliberately not fussy about what a click *does* —
 * that is what the other tests are for. It only insists nothing is dead. */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';

beforeAll(() => {
  window.matchMedia = () => ({
    matches: false, addEventListener() {}, removeEventListener() {},
  });
  // jsdom lays nothing out, so the page maths all resolves to a single page.
  // Width is what decides pages-or-strip, so it is set explicitly per test.
  Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, writable: true, configurable: true });
  Element.prototype.scrollIntoView = () => {};
  window.confirm = () => false;
  window.alert = () => {};
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => {};
  // Never open a real file dialog.
  HTMLInputElement.prototype.click = function click() {};
});

/* An exception inside a click handler does not come back out of .click() —
   the browser reports it to window.onerror and carries on. Catching around
   the call therefore catches nothing, which is exactly how a Done button that
   threw every time still looked fine to an earlier version of this test in
   the cook book. Proven by putting that bug back: without this listener the
   sweep passed. */
let handlerErrors = [];

beforeAll(() => {
  window.addEventListener('error', (event) => {
    handlerErrors.push(event.error?.message || event.message);
  });
});

async function seed() {
  const { store } = await import('../lib/store.js');
  const { newItem, newSection } = await import('../lib/list.js');

  await store.init();
  store.state.lists = [];

  const list = store.addList({ title: 'Weekly shop', subtitle: 'for the flat', store: 'Billa' });
  const fruit = newSection({ label: 'Fruit', order: 1000 });
  list.sections.push(fruit);
  list.items.push(
    newItem({ text: '250 ml milk', order: 1000 }),
    newItem({ text: 'bread', order: 2000, done: true, doneBy: 'someone@example.com' }),
    newItem({ text: '3 apples', sectionId: fruit.id, order: 1000 }),
  );

  // A second sheet, so the table has more than one thing lying on it.
  store.addList({ title: 'Party', paper: 'receipt' });
  await store.persist();
  return { store, list };
}

/** Click everything clickable, re-querying after each one. */
async function clickEverything(host) {
  const seen = new Set();
  let clicks = 0;

  for (let pass = 0; pass < 80; pass += 1) {
    const next = [...host.querySelectorAll('button')].find((b) => {
      const key = b.title || b.getAttribute('aria-label') || b.textContent.trim();
      // Nothing that tears the whole thing down mid-sweep.
      if (!key || seen.has(key) || b.disabled) return false;
      return !/Throw|remove|Sign out/i.test(key);
    });
    if (!next) break;

    seen.add(next.title || next.getAttribute('aria-label') || next.textContent.trim());
    next.click();
    clicks += 1;
    await Promise.resolve();
    // A dialog opened by one click must not swallow the next.
    document.querySelector('.modal-backdrop')?.remove();
  }
  return clicks;
}

let host;

afterEach(async () => {
  document.body.replaceChildren();
  await new Promise((r) => setTimeout(r, 0));
});

beforeEach(() => {
  handlerErrors = [];
  document.body.replaceChildren();
  delete document.body.dataset.editing;
  host = document.createElement('main');
  document.body.append(host);
});

describe('every screen renders and every button survives a click', () => {
  const screens = [
    ['the table', async () => (await import('./table.js')).renderTable],
    ['a sheet', async () => (await import('./sheet.js')).renderSheet],
    ['settings', async () => (await import('./settings.js')).renderSettings],
  ];

  for (const [name, load] of screens) {
    it(`${name}: renders, and nothing on it is dead`, async () => {
      const { list } = await seed();
      const render = await load();

      const args = {
        'the table': [host],
        'a sheet': [host, list.id],
        settings: [host],
      }[name];

      expect(() => render(...args)).not.toThrow();
      expect(host.childElementCount).toBeGreaterThan(0);

      const clicks = await clickEverything(host);
      expect(clicks).toBeGreaterThan(0);
      expect(handlerErrors, `a button on ${name} threw`).toEqual([]);
    });
  }

  it('shopping mode renders, and nothing on it is dead', async () => {
    const { list } = await seed();
    const { renderSheet } = await import('./sheet.js');

    expect(() => renderSheet(host, list.id, new URLSearchParams('shop=1'))).not.toThrow();
    expect(await clickEverything(host)).toBeGreaterThan(0);
    expect(handlerErrors, 'a button in shopping mode threw').toEqual([]);
  });

  it('a list that has been thrown away says so rather than crashing', async () => {
    await seed();
    const { renderSheet } = await import('./sheet.js');
    expect(() => renderSheet(host, 'no-such-list')).not.toThrow();
    expect(host.textContent).toMatch(/not here any more/i);
    expect(handlerErrors).toEqual([]);
  });

  it('an empty table offers a way to start', async () => {
    const { store } = await import('../lib/store.js');
    await store.init();
    store.state.lists = [];
    await store.persist();

    const { renderTable } = await import('./table.js');
    renderTable(host);
    expect(host.textContent).toMatch(/empty table/i);
    expect(await clickEverything(host)).toBeGreaterThan(0);
    expect(handlerErrors).toEqual([]);
  });
});

describe('sending a list and bringing one in', () => {
  it('the table can turn a pasted list into a new sheet', async () => {
    const { store } = await seed();
    const before = store.state.lists.length;

    const { renderTable } = await import('./table.js');
    renderTable(host);
    host.querySelector('[aria-label="Bring in a list"]').click();
    await Promise.resolve();

    const paste = document.querySelector('.md-paste');
    expect(paste).toBeTruthy();
    paste.value = '# From Anna\n\n## Freezer\n- [ ] peas\n- [ ] 2 kg fish fingers';

    [...document.querySelectorAll('.modal-actions button')]
      .find((b) => b.textContent === 'Make the sheet').click();
    await Promise.resolve();

    expect(store.state.lists.length).toBe(before + 1);
    const made = store.state.lists[store.state.lists.length - 1];
    expect(made.title).toBe('From Anna');
    expect(made.sections.map((x) => x.label)).toEqual(['Freezer']);
    expect(made.items.map((i) => i.text)).toEqual(['peas', 'fish fingers']);
    expect(handlerErrors).toEqual([]);
  });

  it('an open list can have another added to it', async () => {
    const { store, list } = await seed();
    const before = store.listById(list.id).items.length;

    const { renderSheet } = await import('./sheet.js');
    renderSheet(host, list.id);
    host.querySelector('[aria-label="Add a list to this one"]').click();
    await Promise.resolve();

    document.querySelector('.md-paste').value = '## Freezer\n- [ ] peas';
    [...document.querySelectorAll('.modal-actions button')]
      .find((b) => b.textContent === 'Add it').click();
    await Promise.resolve();

    const after = store.listById(list.id);
    expect(after.items.length).toBe(before + 1);
    expect(after.sections.map((x) => x.label)).toContain('Freezer');
    expect(handlerErrors).toEqual([]);
  });

  /* An empty file is the one thing an importer must refuse. The cook book's
     made a recipe out of every one it was handed. */
  it('refuses a page with nothing on it, and says so', async () => {
    const { store } = await seed();
    const before = store.state.lists.length;

    const { renderTable } = await import('./table.js');
    renderTable(host);
    host.querySelector('[aria-label="Bring in a list"]').click();
    await Promise.resolve();

    document.querySelector('.md-paste').value = '# Just a title\n\n---\n';
    [...document.querySelectorAll('.modal-actions button')]
      .find((b) => b.textContent === 'Make the sheet').click();
    await Promise.resolve();

    expect(store.state.lists.length).toBe(before);
    expect(document.querySelector('.import-form .note').textContent).toMatch(/nothing on that page/i);
    // And the dialog stays open, so the paste is not lost.
    expect(document.querySelector('.md-paste')).toBeTruthy();
  });

  it('sending a list shows the words it will travel as', async () => {
    const { list } = await seed();
    const { renderSheet } = await import('./sheet.js');
    renderSheet(host, list.id);

    host.querySelector('[aria-label="Send this list as a file"]').click();
    await new Promise((r) => setTimeout(r, 0));

    const preview = document.querySelector('.md-preview');
    expect(preview).toBeTruthy();
    expect(preview.value).toContain('# Weekly shop');
    expect(preview.value).toContain('- [ ] 250 ml milk');
    expect(handlerErrors).toEqual([]);
  });
});

describe('a list that lives somewhere else', () => {
  /* A shared list is not in the store at all: it is a document of its own
     with an item beneath it for every line, because saving a whole list at
     once means whoever writes second sends a version that never contained the
     other person's item. The view is written once and handed whichever
     backend the list has — so the thing worth testing here is that it really
     does go through the one it was handed, and never round it. */
  function fakeLive(list) {
    const calls = [];
    const api = { shared: true };
    for (const name of ['updateList', 'addItem', 'updateItem', 'toggleItem',
      'removeItem', 'clearDone', 'addSection', 'updateSection', 'removeSection']) {
      api[name] = (...args) => { calls.push([name, ...args]); return Promise.resolve(); };
    }
    api.addItem = (...args) => {
      calls.push(['addItem', ...args]);
      return { id: 'new', text: String(args[1]), qty: null, unit: '', note: '', done: false, order: 1 };
    };
    return { api, calls, list };
  }

  async function sharedSheet() {
    const { list } = await seed();
    const shared = { ...JSON.parse(JSON.stringify(list)), shared: true, owner: 'me', members: ['me'] };
    const fake = fakeLive(shared);
    const { paintForTest } = await import('./sheet.js');
    paintForTest(host, shared, fake.api);
    return fake;
  }

  it('crossing something off goes to the shared list, not to the store', async () => {
    const { store } = await import('../lib/store.js');
    const fake = await sharedSheet();
    const before = JSON.stringify(store.state.lists);

    host.querySelector('.item:not(.is-done) .item-tick').click();
    await Promise.resolve();

    expect(fake.calls.map((c) => c[0])).toContain('toggleItem');
    // And the local copy of anything was left completely alone.
    expect(JSON.stringify(store.state.lists)).toBe(before);
    expect(handlerErrors).toEqual([]);
  });

  it('adding, renaming and clearing all go the same way', async () => {
    const fake = await sharedSheet();

    const input = host.querySelector('.item-new input');
    input.dispatchEvent(new window.FocusEvent('focus'));
    input.value = 'olives';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const title = host.querySelector('.sheet-title');
    title.dispatchEvent(new window.FocusEvent('focus'));
    title.textContent = 'Saturday';
    title.dispatchEvent(new window.FocusEvent('blur'));

    host.querySelector('[aria-label="Clear crossed off"]')
      ?? [...host.querySelectorAll('button')].find((b) => b.textContent === 'Clear crossed off').click();

    await Promise.resolve();
    const names = fake.calls.map((c) => c[0]);
    expect(names).toContain('addItem');
    expect(names).toContain('updateList');
    expect(handlerErrors).toEqual([]);
  });

  it('everything on it still renders and nothing on it is dead', async () => {
    await sharedSheet();
    expect(await clickEverything(host)).toBeGreaterThan(0);
    expect(handlerErrors, 'a button on a shared list threw').toEqual([]);
  });

  it('shows who else has it open', async () => {
    const { list } = await seed();
    const shared = { ...JSON.parse(JSON.stringify(list)), shared: true };
    const { paintForTest } = await import('./sheet.js');
    paintForTest(host, shared, fakeLive(shared).api, new URLSearchParams(), [
      { uid: 'u1', name: 'Anna', photo: '' },
      { uid: 'u2', name: 'Bo', photo: '' },
    ]);

    const faces = document.querySelectorAll('.sheet-bar .who .face');
    expect(faces).toHaveLength(2);
    expect(faces[0].textContent).toBe('A');
    expect(faces[0].title).toMatch(/Anna is here/);
  });

  /* Signed out with no database attached, an unknown id is a list you threw
     away — not one somebody shared, because sharing is not even possible. */
  it('an unknown list still reads as gone when sharing is impossible', async () => {
    await seed();
    const { renderSheet } = await import('./sheet.js');
    renderSheet(host, 'no-such-list');
    expect(host.textContent).toMatch(/not here any more/i);
  });
});

describe('shopping mode', () => {
  /* The decision behind this: shopping mode locks editing, it does not unlock
     ticking. Crossing off is the single most common thing anyone does here,
     and it is often done at home while writing the list — "we already have
     milk" — so putting it behind a mode would put a step in front of it. */
  async function shop() {
    const { store, list } = await seed();
    const { renderSheet } = await import('./sheet.js');
    renderSheet(host, list.id, new URLSearchParams('shop=1'));
    return { store, list };
  }

  it('nothing on the page can be edited', async () => {
    await shop();
    const fields = [...host.querySelectorAll('.item-text, .section-label, .sheet-title')];
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.some((f) => f.getAttribute('contenteditable'))).toBe(false);
  });

  it('but crossing off still works, and still records who', async () => {
    const { store, list } = await shop();
    store.state.settings.profile = { name: 'Isabel', email: 'isabel@example.com' };

    host.querySelector('.item:not(.is-done) .item-tick').click();
    await Promise.resolve();

    const crossed = store.listById(list.id).items.filter((i) => i.done);
    expect(crossed.length).toBe(2);
    expect(crossed.some((i) => i.doneBy === 'isabel@example.com')).toBe(true);
  });

  /* You remember the eggs in the shop. Adding is not editing. */
  it('you can still add something you remembered', async () => {
    const { store, list } = await shop();
    const input = host.querySelector('.item-new input');
    expect(input).toBeTruthy();

    input.value = 'eggs';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();

    expect(store.listById(list.id).items.some((i) => i.text === 'eggs')).toBe(true);
  });

  it('headings cannot be added or removed with your hands full', async () => {
    await shop();
    expect(host.querySelector('.section-add')).toBeNull();
    expect([...host.querySelectorAll('.section-head button')]).toHaveLength(0);
  });

  it('the bar says what is left to find, not a ratio', async () => {
    await shop();
    expect(document.querySelector('.sheet-bar .progress').textContent).toMatch(/still to find/);
  });
});

describe('pages', () => {
  it('a wide screen gets drawn pages, a narrow one gets one long strip', async () => {
    const { list } = await seed();
    const { renderSheet } = await import('./sheet.js');

    window.innerWidth = 400;
    renderSheet(host, list.id);
    let sheet = host.querySelector('.sheet');
    expect(sheet.classList.contains('is-paged')).toBe(false);
    expect(sheet.classList.contains('paper-stock')).toBe(true);
    expect(host.querySelectorAll('.page')).toHaveLength(0);

    host.replaceChildren();
    window.innerWidth = 1280;
    renderSheet(host, list.id);
    sheet = host.querySelector('.sheet');
    expect(sheet.classList.contains('is-paged')).toBe(true);
    // The paper is worn by each page now, not by the frame around them.
    expect(sheet.classList.contains('paper-stock')).toBe(false);
    expect(host.querySelectorAll('.page').length).toBeGreaterThan(0);
  });

  it('every page carries the list\'s paper stock', async () => {
    const { store, list } = await seed();
    await store.updateList(list.id, { paper: 'ruled' });
    const { renderSheet } = await import('./sheet.js');

    window.innerWidth = 1280;
    renderSheet(host, list.id);
    for (const page of host.querySelectorAll('.page')) {
      expect(page.dataset.paper).toBe('ruled');
    }
  });
});

describe('the things you actually do to a list', () => {
  it('typing into the add line puts an item on the sheet', async () => {
    const { store, list } = await seed();
    const { renderSheet } = await import('./sheet.js');
    renderSheet(host, list.id);

    const input = host.querySelector('.item-new input');
    input.value = '2 tins tomatoes';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const added = store.listById(list.id).items.find((i) => i.text === 'tomatoes');
    expect(added).toBeTruthy();
    expect(added.qty).toBe(2);
    expect(handlerErrors).toEqual([]);
  });

  /* The bug this replaces: after the first Enter the whole view was rebuilt,
     the input being typed into was replaced, focus went to the body, and the
     second and third items were silently swallowed. Found by typing a real
     list into a real browser, not by any assertion. */
  it('a whole list can be typed in one go without losing focus', async () => {
    const { store, list } = await seed();
    const { renderSheet } = await import('./sheet.js');
    renderSheet(host, list.id);

    const input = host.querySelector('.item-new input');
    input.dispatchEvent(new window.FocusEvent('focus'));

    /* The flag is the mechanism, so the flag is what gets asserted. Checking
       that the input is still in the document would pass either way here —
       nothing in this test rebuilds the view, because main.js is what does
       that in the real app. A test that passes for the wrong reason is worse
       than no test. */
    expect(document.body.dataset.editing, 'the add line must hold off the re-render').toBeTruthy();

    for (const line of ['bread', 'butter', '2 lemons']) {
      input.value = line;
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
      expect(host.contains(input)).toBe(true);
    }

    input.dispatchEvent(new window.FocusEvent('blur'));
    expect(document.body.dataset.editing).toBeUndefined();

    const texts = store.listById(list.id).items.map((i) => i.text);
    expect(texts).toEqual(expect.arrayContaining(['bread', 'butter', 'lemons']));
    // And the rows appeared without waiting for a re-render.
    expect(host.querySelectorAll('.item').length).toBe(6);
    expect(handlerErrors).toEqual([]);
  });

  it('the running tally keeps up while the re-render is held off', async () => {
    const { list } = await seed();
    const { renderSheet } = await import('./sheet.js');
    const { renderTable } = await import('./table.js');
    renderTable(host);          // the bar lives outside the sheet, so render both
    document.body.append(host);
    host.replaceChildren();
    renderSheet(host, list.id);

    const input = host.querySelector('.item-new input');
    input.dispatchEvent(new window.FocusEvent('focus'));
    input.value = 'olives';
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();

    expect(document.querySelector('.sheet-bar .progress').textContent).toBe('1 of 4');
  });

  it('the tick crosses an item off and records who did it', async () => {
    const { store, list } = await seed();
    store.state.settings.profile = { name: 'Isabel', email: 'isabel@example.com' };

    const { renderSheet } = await import('./sheet.js');
    renderSheet(host, list.id);

    host.querySelector('.item:not(.is-done) .item-tick').click();
    await Promise.resolve();

    const crossed = store.listById(list.id).items.filter((i) => i.done);
    expect(crossed.length).toBe(2);
    expect(crossed.some((i) => i.doneBy === 'isabel@example.com')).toBe(true);
    expect(handlerErrors).toEqual([]);
  });

  /* Crossed off stays put, struck through, so you can see what you have and
     untick a mistake. It was chosen over sinking to the bottom precisely so
     nothing moves under your finger while someone else is ticking too. */
  it('a crossed-off item stays where it was, with a strike over it', async () => {
    const { list } = await seed();
    const { renderSheet } = await import('./sheet.js');
    renderSheet(host, list.id);

    const rows = [...host.querySelectorAll('.item')];
    expect(rows[1].classList.contains('is-done')).toBe(true);
    expect(rows[1].querySelector('svg.strike')).toBeTruthy();
    expect(rows[1].querySelector('.by')?.textContent).toBe('someone');
  });

  it('editing an item in place keeps its quantity in step', async () => {
    const { store, list } = await seed();
    const { renderSheet } = await import('./sheet.js');
    renderSheet(host, list.id);

    const field = host.querySelector('.item .item-text');
    field.dispatchEvent(new window.FocusEvent('focus'));
    field.textContent = '500 ml milk';
    field.dispatchEvent(new window.FocusEvent('blur'));
    await Promise.resolve();

    const milk = store.listById(list.id).items.find((i) => i.text === 'milk');
    expect(milk.qty).toBe(500);
    expect(handlerErrors).toEqual([]);
  });

  /* Backspacing a line away is how people remove things from a written list. */
  it('emptying an item removes it', async () => {
    const { store, list } = await seed();
    const before = store.listById(list.id).items.length;

    const { renderSheet } = await import('./sheet.js');
    renderSheet(host, list.id);

    const field = host.querySelector('.item .item-text');
    field.dispatchEvent(new window.FocusEvent('focus'));
    field.textContent = '';
    field.dispatchEvent(new window.FocusEvent('blur'));
    await Promise.resolve();

    expect(store.listById(list.id).items.length).toBe(before - 1);
  });

  /* The rule that makes editing in place possible at all: while a field has
     focus, nothing may rebuild the view, because a rebuild replaces the node
     the caret is in and the caret goes with it, mid-word. */
  it('a focused field holds off the background re-render', async () => {
    const { list } = await seed();
    const { renderSheet } = await import('./sheet.js');
    renderSheet(host, list.id);

    const field = host.querySelector('.sheet-title');
    expect(document.body.dataset.editing).toBeUndefined();

    field.dispatchEvent(new window.FocusEvent('focus'));
    expect(document.body.dataset.editing).toBeTruthy();

    field.dispatchEvent(new window.FocusEvent('blur'));
    expect(document.body.dataset.editing).toBeUndefined();
  });

  it('removing a heading keeps what was under it', async () => {
    const { store, list } = await seed();
    const sectionId = list.sections[0].id;

    await store.removeSection(list.id, sectionId);

    const apples = store.listById(list.id).items.find((i) => i.text === 'apples');
    expect(apples).toBeTruthy();
    expect(apples.sectionId).toBe('');
  });

  it('clearing the crossed-off leaves the rest alone', async () => {
    const { store, list } = await seed();
    await store.clearDone(list.id);
    const left = store.listById(list.id).items;
    expect(left).toHaveLength(2);
    expect(left.every((i) => !i.done)).toBe(true);
  });
});
