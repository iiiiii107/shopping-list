import {
  el, add, clear, svg, icon, iconButton, iconLink, modal, toast,
  checkSvg, strikeSvg, hashUnit, claimBodyFlag,
} from '../lib/dom.js';
import { store } from '../lib/store.js';
import { readingOrder, progressOf, itemToText, retextItem } from '../lib/list.js';
import { layout, keepLaidOut } from '../lib/pages.js';
import { keepAwake } from '../lib/awake.js';
import { importDialog, shareList, sendSection } from './transfer.js';
import { PAPER_STOCKS, PALETTE_KEYS, applySheetPalette } from '../lib/theme.js';
import { paletteEditor } from './palette.js';
import { openList } from '../lib/live.js';
import { watchPresence } from '../lib/presence.js';
import { currentAccount, syncConfigured, authSettled } from '../lib/sync.js';
import { shareDialog, whoElse } from './share-ui.js';
import { destroy, leave } from '../lib/share.js';

/* One list, as a single sheet of paper.

   Everything on it is edited where it sits — the title, the subtitle, the
   date, the shop, every item. The cook book spent a while with fields behind
   an Edit button and the verdict was blunt: "i don't like how i need to input
   the portion size and link with another button. let me do it all on the
   page." The same applies here, more so, because a shopping list is nothing
   but short fields.

   Editing in place has one hard rule: while something has focus, this view
   must not be rebuilt. A rebuild replaces the node the caret is in and the
   caret goes with it, mid-word. So a focused field claims the `editing` flag
   on <body>, which main.js's maybeGo() respects, and releases it on blur. */

export function renderSheet(scene, listId, query = new URLSearchParams()) {
  const local = store.listById(listId);

  /* A list you have not got is probably one somebody shared with you — and
     falling back on that rather than on the query string means a link pasted
     with its tail chopped off still opens.

     Probably, not certainly: it could equally be one you threw away. When
     there is no database attached, or you are signed out and nothing in the
     link says otherwise, sharing is not a possibility and the plainer answer
     is the true one. */
  if (!local) {
    const couldBeShared = syncConfigured()
      && (currentAccount() || !authSettled() || query.get('shared') === '1');
    if (couldBeShared) return openShared(scene, listId, query);

    add(scene, el('div', { class: 'table-empty' }, [
      el('p', { text: 'That list is not here any more.' }),
      el('a', { class: 'btn', href: '#/', text: 'Back to the table' }),
    ]));
    return;
  }

  paint(scene, local, storeApi, query);
}

/** The local store, with the same method names the live layer offers. */
const storeApi = {
  shared: false,
  updateList: (id, patch) => store.updateList(id, patch),
  addItem: (id, entry, sectionId) => store.addItem(id, entry, sectionId),
  updateItem: (id, itemId, patch) => store.updateItem(id, itemId, patch),
  toggleItem: (id, itemId) => store.toggleItem(id, itemId),
  removeItem: (id, itemId) => store.removeItem(id, itemId),
  clearDone: (id) => store.clearDone(id),
  addSection: (id, label) => store.addSection(id, label),
  updateSection: (id, sectionId, patch) => store.updateSection(id, sectionId, patch),
  removeSection: (id, sectionId) => store.removeSection(id, sectionId),
};

/* A shared list arrives over the wire, so the screen has to say something
   while it does — and has to keep repainting as other people write on it. */
async function openShared(scene, listId, query) {
  /* Between the page loading and Firebase saying who is signed in there is a
     second or so where currentAccount() is null and means "we do not know".
     Opening a shared link lands squarely in it — so without this, following a
     link told people who were perfectly well signed in to go and sign in. The
     account resolving re-renders this view a moment later. */
  if (!authSettled()) {
    add(scene, el('div', { class: 'table-empty' }, [el('p', { text: 'Opening the list…' })]));
    return;
  }

  if (!currentAccount()) {
    add(scene, el('div', { class: 'table-empty' }, [
      el('p', { text: 'This is a list somebody shared. Sign in with Google to open it.' }),
      el('a', { class: 'btn', href: '#/settings', text: 'Sign in' }),
    ]));
    return;
  }

  add(scene, el('div', { class: 'table-empty' }, [el('p', { text: 'Opening the list…' })]));

  let api;
  let stopPresence = null;
  let people = [];

  const gone = () => !document.body.contains(scene);

  try {
    api = await openList(listId, (list) => {
      if (gone()) { api?.close(); stopPresence?.(); return; }
      if (!list) {
        clear(scene);
        add(scene, el('div', { class: 'table-empty' }, [
          el('p', { text: 'That list is not there any more. Whoever owns it may have thrown it away.' }),
          el('a', { class: 'btn', href: '#/', text: 'Back to the table' }),
        ]));
        return;
      }
      clear(scene);
      paint(scene, list, api, query, people);
    });
  } catch (err) {
    console.warn('That list could not be opened.', err);
    clear(scene);
    add(scene, el('div', { class: 'table-empty' }, [
      el('p', { text: 'That list could not be opened. You may not have been let onto it, or it may be the connection.' }),
      el('a', { class: 'btn', href: '#/', text: 'Back to the table' }),
    ]));
    return;
  }

  // Who else is looking, so "has she got the milk yet?" has an answer.
  watchPresence(listId, (next) => {
    people = next;
    const bar = document.querySelector('.sheet-bar .who');
    if (bar) bar.replaceWith(whoElse(people));
  }).then((stop) => {
    stopPresence = stop;
    if (gone()) stop();
  });

  /* Both the listener and the heartbeat outlive this function, so they have
     to be let go when the view is replaced — including by a re-render, which
     removes the node rather than the whole page. */
  const watch = new MutationObserver(() => {
    if (document.body.contains(scene) && scene.childElementCount) return;
    api.close();
    stopPresence?.();
    watch.disconnect();
  });
  watch.observe(document.body, { childList: true, subtree: true });
}

/* Exported for the tests: painting a shared list is otherwise only reachable
   through a Firestore round trip, and the thing worth testing is that the
   view goes through whichever backend it was handed rather than round it. */
export function paintForTest(...args) { return paint(...args); }

function paint(scene, list, api, query = new URLSearchParams(), people = []) {
  const shopping = query.get('shop') === '1';
  document.body.dataset.mode = shopping ? 'shopping' : 'writing';

  const view = el('div', { class: 'sheet-view' });
  const sheet = el('div', {
    class: 'sheet paper-stock',
    dataset: { paper: list.paper || 'plain' },
  });
  applySheetPalette(sheet, list.palette, store.state.settings);

  /* The pages are drawn underneath and the content flows over them. Both are
     the sheet's own children so the whole thing keeps one paper colour, one
     stock and one palette however many pages it turns out to be. */
  const pages = el('div', { class: 'sheet-pages', 'aria-hidden': 'true' });
  const flow = el('div', { class: 'sheet-flow' }, [
    header(list, shopping, api), body(list, shopping, api),
  ]);

  add(sheet, pages, flow);
  add(view, sheet);
  add(scene, view, bar(list, shopping, api, people));

  layout(sheet, { title: list.title });
  const stopLayout = keepLaidOut(sheet, { title: list.title });
  const stopAwake = shopping ? keepAwake() : null;

  const releaseView = claimBodyFlag('sheet', sheet);
  const watch = new MutationObserver(() => {
    if (document.contains(sheet)) return;
    stopLayout();
    stopAwake?.();
    releaseView();
    watch.disconnect();
  });
  watch.observe(document.body, { childList: true, subtree: true });
}

/* --- the header ----------------------------------------------------------- */

function header(list, shopping, api) {
  return el('header', { class: 'sheet-head' }, [
    editable('h1', {
      class: 'sheet-title',
      value: list.title,
      placeholder: 'Untitled list',
      locked: shopping,
      onSave: (text) => api.updateList(list.id, { title: text || 'Untitled list' }),
    }),
    (list.subtitle || !shopping) && editable('div', {
      class: 'sheet-sub',
      value: list.subtitle,
      placeholder: 'A subtitle, if it needs one',
      locked: shopping,
      onSave: (text) => api.updateList(list.id, { subtitle: text }),
    }),
    el('div', { class: 'sheet-meta' }, [
      // With your hands full these are read, not typed.
      shopping
        ? (list.date || list.store) && el('span', { class: 'meta-read',
            text: [list.date, list.store].filter(Boolean).join(' · ') })
        : el('span', {}, [
            el('span', { class: 'label', text: 'Date' }),
            el('input', {
              type: 'date',
              value: list.date || '',
              'aria-label': 'The date this list is for',
              onChange: (e) => api.updateList(list.id, { date: e.target.value }),
            }),
          ]),
      !shopping && el('span', {}, [
        el('span', { class: 'label', text: 'Shop' }),
        el('input', {
          type: 'text',
          class: 'meta-text',
          value: list.store || '',
          placeholder: 'anywhere',
          'aria-label': 'Which shop',
          onChange: (e) => api.updateList(list.id, { store: e.target.value.trim() }),
        }),
      ]),
    ]),
  ]);
}

/* --- sections and items --------------------------------------------------- */

function body(list, shopping, api) {
  const wrap = el('div', { class: 'sheet-body' });

  for (const { section, items } of readingOrder(list)) {
    // The loose group at the top has no heading of its own, and is skipped
    // entirely once it is empty — an app should not show you a blank space
    // where a heading you never wrote would go.
    if (!section && !items.length && list.sections.length) continue;

    const group = el('section', { class: 'sheet-section' });
    if (section) add(group, sectionHead(list, section, shopping, api));

    const ul = el('ul', { class: 'items' }, items.map((item) => itemRow(list, item, shopping, api)));
    add(group, ul, newItemLine(list, section?.id || '', ul, api));
    add(wrap, group);
  }

  if (shopping) return wrap;

  add(wrap, el('div', { class: 'section-add' }, [
    el('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', text: '+ heading',
      onClick: () => {
        const section = api.addSection(list.id, 'New heading');
        // Straight into renaming it: a heading called "New heading" is not a
        // heading, it is a chore you have been handed.
        requestAnimationFrame(() => {
          const node = document.querySelector(`[data-section='${section.id}'] .section-label`);
          node?.focus();
          if (node) document.getSelection()?.selectAllChildren(node);
        });
      },
    }),
  ]));

  return wrap;
}

function sectionHead(list, section, shopping, api) {
  return el('div', { class: 'section-head', dataset: { section: section.id } }, [
    editable('h2', {
      class: 'section-label',
      value: section.label,
      placeholder: 'Heading',
      locked: shopping,
      onSave: (text) => api.updateSection(list.id, section.id, { label: text || 'Heading' }),
    }),
    !shopping && el('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', text: 'send',
      title: `Send just what is under “${section.label}”`,
      onClick: () => sendSection(list, section.id, section.label),
    }),
    !shopping && el('button', {
      class: 'btn btn-quiet btn-sm', type: 'button', text: 'remove',
      title: 'Remove this heading — what is under it stays',
      onClick: () => api.removeSection(list.id, section.id),
    }),
  ]);
}

function itemRow(list, item, shopping, api) {
  const row = el('li', {
    class: `item${item.done ? ' is-done' : ''}`,
    dataset: { item: item.id },
  });

  const tick = el('button', {
    class: 'item-tick',
    type: 'button',
    'aria-pressed': String(!!item.done),
    'aria-label': item.done ? `Put ${item.text} back` : `Cross off ${item.text}`,
    onClick: () => api.toggleItem(list.id, item.id),
  }, [checkSvg()]);

  const text = editable('span', {
    class: 'item-text',
    value: itemToText(item),
    placeholder: 'Something to buy',
    locked: shopping,
    onSave: (typed) => {
      // An item emptied is an item deleted. Backspacing a line away is how
      // people remove things from a written list, and it would be strange to
      // leave an empty bullet sitting there instead.
      if (!typed) return api.removeItem(list.id, item.id);
      const next = retextItem(item, typed);
      return api.updateItem(list.id, item.id, next);
    },
  });

  /* The stroke lives in a holder that shrink-wraps the words, so it runs
     through the text and stops — a line carrying on across empty paper is
     what a text-decoration does, not what a pen does. */
  const hold = el('span', { class: 'item-hold' }, [text]);

  // Drawn, not a text-decoration line: four hand-wobbled paths picked by a
  // hash of the item's id, so no two crossings-out are identical and the same
  // item is always crossed the same way.
  if (item.done) add(hold, strikeSvg(Math.floor(hashUnit(item.id) * 4)));

  add(row, tick, hold);
  if (item.done && item.doneBy) {
    add(row, el('span', { class: 'by', text: shortName(item.doneBy) }));
  }

  return row;
}

/** An email down to something that fits beside an item. */
function shortName(email) {
  return String(email).split('@')[0].slice(0, 12);
}

function newItemLine(list, sectionId, ul, api) {
  const input = el('input', {
    type: 'text',
    placeholder: 'Add something',
    'aria-label': 'Add something to the list',
  });

  /* Typing a whole list in one go is the main way anyone uses this, so Enter
     adds and stays put.

     That means holding off the re-render. Saving fires a change, a change
     rebuilds this view, and the rebuild would replace the very input being
     typed into — which is how the first version of this lost focus after the
     first item and quietly swallowed the second and third. So the line claims
     the `editing` flag while it has focus and appends the new row itself; the
     next ordinary render, after blur, redraws it all properly anyway. */
  let release = null;
  input.addEventListener('focus', () => { release = claimBodyFlag('editing', input); });
  input.addEventListener('blur', () => { release?.(); release = null; });

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    const item = api.addItem(list.id, text, sectionId);
    input.value = '';
    if (!item) return;

    ul.append(itemRow(list, item, false, api));
    countUp(list);
    // A new item may have filled the page. Re-flowing only changes styles, so
    // the caret stays in this very input while a second sheet appears beside it.
    const sheet = input.closest('.sheet');
    if (sheet) layout(sheet, { title: list.title });
  });

  return el('div', { class: 'item-new', dataset: { add: sectionId || 'loose' } }, [input]);
}

/* The tally in the bar, kept honest while the re-render is held off. Without
   this it would sit at "0 of 2" through a dozen more items being typed. */
function countUp(list) {
  const { done, total } = progressOf(list);
  const node = document.querySelector('.sheet-bar .progress');
  if (node) node.textContent = total ? `${done} of ${total}` : 'nothing on it yet';
}

/* --- the bar of actions --------------------------------------------------- */

function bar(list, shopping, api, people = []) {
  const { done, total } = progressOf(list);
  const left = total - done;

  /* In a shop the bar is what you look at, so it says the thing you actually
     want to know — how many are still to find — rather than a ratio. */
  const progress = shopping
    ? (left ? `${left} still to find` : 'that is everything')
    : (total ? `${done} of ${total}` : 'nothing on it yet');

  return el('div', { class: `sheet-bar${shopping ? ' is-shopping' : ''}` }, [
    iconLink('chevronLeft', 'Back to the table', '#/'),
    el('span', { class: 'progress', text: progress }),
    whoElse(people),
    el('span', { class: 'spacer' }),

    shopping
      ? el('button', {
          class: 'btn btn-secondary', type: 'button', text: 'Done shopping',
          onClick: () => { location.hash = `#/list/${list.id}`; },
        })
      : el('button', {
          class: 'btn', type: 'button', text: 'Shopping mode',
          title: 'Big targets, the screen stays awake, and nothing can be edited by accident',
          onClick: () => { location.hash = `#/list/${list.id}?shop=1`; },
        }),

    /* The rest are things you do while making a list, not while holding one.
       On a wide screen they sit in the bar; on a phone they fold into a single
       button, because otherwise the bar wraps to two rows and half the screen
       becomes chrome. Same handlers either way. */
    ...(shopping ? [] : [
      el('span', { class: 'bar-wide' }, sheetActions(list, done, api).map(({ icon: name, label, run, text }) =>
        (text
          ? el('button', { class: 'btn btn-secondary btn-sm', type: 'button', text: label, onClick: run })
          : iconButton(name, label, { onClick: run })))),
      iconButton('sliders', 'More', {
        class: 'btn-icon bar-narrow',
        onClick: () => moreDialog(list, done, api),
      }),
    ]),
  ]);
}

/** The list-making actions, in one place, so the bar and the phone menu agree. */
function sheetActions(list, done, api) {
  return [
    done > 0 && {
      label: 'Clear crossed off', text: true,
      run: () => api.clearDone(list.id),
    },
    {
      icon: 'share',
      label: list.shared ? 'Who is on this list' : 'Share this list with somebody',
      run: () => shareDialog(list, api),
    },
    { icon: 'brush', label: 'How this sheet looks', run: () => paperDialog(list, api) },
    { icon: 'inbox', label: 'Send this list as a file', run: () => shareList(list) },
    { icon: 'inbox', label: 'Add a list to this one', run: () => importDialog(list) },
    { icon: 'trash', label: 'Throw this list away', run: () => confirmDelete(list, api) },
  ].filter(Boolean);
}

function moreDialog(list, done, api) {
  const body = el('div', { class: 'more-actions' },
    sheetActions(list, done, api).map(({ label, run }) => el('button', {
      class: 'btn btn-secondary', type: 'button', text: label,
      onClick: () => { closeIt(); run(); },
    })));

  const { close } = modal({ title: list.title, body, actions: [{ label: 'Close' }] });
  function closeIt() { close(); }
}

function confirmDelete(list, api) {
  const me = currentAccount();
  const mine = !list.shared || list.owner === me?.uid;

  /* Once somebody else is on a list, throwing it away is not yours to do
     alone — so for everyone but the owner the action becomes leaving, which
     is the only thing the rules allow them anyway. */
  const body = mine
    ? el('p', { text: `“${list.title}” and everything on it. This cannot be undone.` })
    : el('p', { text: `You will come off “${list.title}” and stop seeing it. Whoever owns it still has it.` });

  modal({
    title: mine ? 'Throw it away?' : 'Leave this list?',
    body,
    actions: [
      { label: 'Keep it' },
      {
        label: mine ? 'Throw it away' : 'Leave it',
        class: 'btn btn-danger',
        onClick: async () => {
          try {
            if (!list.shared) store.deleteList(list.id);
            else if (mine) await destroy(list.id, list.items || []);
            else await leave(list.id);
          } catch (err) {
            console.warn('That did not work.', err);
            toast('That did not work. Try again in a moment.');
            return;
          }
          location.hash = '#/';
        },
      },
    ],
  });
}

/* Paper and colour, per sheet. The global palette in settings sets the tone
   for everything; this overrides it for one list, which is how you tell the
   week's shop from the party list at a glance on the table. */
function paperDialog(list, api) {
  const body = el('div', {});

  const stock = el('select', {}, PAPER_STOCKS.map((s) =>
    el('option', { value: s.id, text: s.label, selected: (list.paper || 'plain') === s.id })));
  stock.addEventListener('change', () => api.updateList(list.id, { paper: stock.value }));

  add(body, el('div', { class: 'field' }, [
    el('label', { class: 'label', text: 'Paper' }), stock,
  ]));

  add(body, paletteEditor({
    keys: PALETTE_KEYS,
    palette: () => (list.shared ? list.palette : store.listById(list.id)?.palette),
    onChange: (palette) => api.updateList(list.id, { palette }),
  }));

  modal({ title: 'This sheet', body, actions: [{ label: 'Done', class: 'btn' }] });
}

/* --- editing in place ------------------------------------------------------ */

/**
 * A field you type straight into, on the paper.
 *
 * Three things matter here and each is a bug that has already been paid for
 * elsewhere:
 *
 * - `plaintext-only`, so pasting from a web page brings words and not markup.
 * - The `editing` flag, claimed on focus and released on blur, so a save from
 *   another tab (or, later, another person) cannot rebuild the node the caret
 *   is sitting in.
 * - Saving on blur and on Enter, never on every keystroke. Saving as you type
 *   means re-rendering as you type, and that is the same lost caret again.
 */
function editable(tag, { class: cls, value, placeholder, onSave, locked = false }) {
  const node = el(tag, {
    class: cls,
    // Locked in a shop. Not disabled-looking, just not editable — the text
    // reads exactly the same, it simply cannot be changed by a thumb that
    // was aiming for the box beside it.
    contenteditable: locked ? null : 'plaintext-only',
    role: locked ? null : 'textbox',
    'data-placeholder': placeholder,
    'aria-label': locked ? null : placeholder,
    text: value || '',
  });

  if (locked) return node;

  let release = null;

  node.addEventListener('focus', () => {
    release = claimBodyFlag('editing', node);
  });

  node.addEventListener('blur', () => {
    release?.();
    release = null;
    const text = node.textContent.trim();
    if (text !== (value || '').trim()) onSave(text);
  });

  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      node.blur();
    }
    if (event.key === 'Escape') {
      node.textContent = value || '';
      node.blur();
    }
  });

  return node;
}
