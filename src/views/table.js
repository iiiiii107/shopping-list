import { el, add, icon, iconButton, iconLink, modal, hashUnit, chefName, toast } from '../lib/dom.js';
import { store } from '../lib/store.js';
import { sortLists, progressOf, readingOrder, itemToText } from '../lib/list.js';
import { PAPER_STOCKS } from '../lib/theme.js';
import { importDialog } from './transfer.js';
import { fromCookbookDialog } from './from-cookbook.js';
import { watchShared, join } from '../lib/share.js';
import { currentAccount, syncConfigured, onAccountChange } from '../lib/sync.js';

/* The table: every list you have, lying about as sheets of paper.

   The scatter is derived from each list's id rather than from Math.random, so
   the arrangement is the same every time you open the app. Paper that shuffles
   itself on each reload reads as a bug, not as charm. */

/* Shared lists do not live in the local store, so they arrive separately.

   A subscription, not a fetch. The first version fetched them at the end of
   every render and re-rendered when the answer came back — which rendered,
   which fetched, which re-rendered, forever, two Firestore queries a turn.
   Subscribing has no such loop in it, and a list somebody shares with you
   while you are looking at the table simply appears. */
let sharedCache = { mine: [], invitations: [] };
let watchingFor = null;
let stopWatching = null;

function followShared() {
  const uid = currentAccount()?.uid || null;
  if (uid === watchingFor) return;

  stopWatching?.();
  stopWatching = null;
  watchingFor = uid;
  sharedCache = { mine: [], invitations: [] };
  if (!uid || !syncConfigured()) return;

  watchShared((next) => {
    sharedCache = next;
    // Only disturb the screen if the table is still what is on it.
    if (document.body.dataset.view === 'table') store.emit();
  }).then((stop) => {
    // Signed out again while the subscription was being set up.
    if (watchingFor !== uid) return stop();
    stopWatching = stop;
  }).catch((err) => console.warn('Could not follow your shared lists.', err));
}

// Signing in or out changes whose lists these are.
onAccountChange(followShared);

export function renderTable(scene) {
  followShared();

  const own = store.state.lists;
  const lists = sortLists([...own, ...sharedCache.mine]);

  add(scene, head(), lists.length || sharedCache.invitations.length
    ? el('div', { class: 'sheets' }, [
        ...sharedCache.invitations.map(invitation),
        ...lists.map(card),
      ])
    : empty());
}

function head() {
  return el('div', { class: 'table-head' }, [
    el('h1', { text: 'Shopping' }),
    el('span', { class: 'greeting', text: greeting() }),
    el('div', { class: 'table-actions' }, [
      iconButton('book', 'Build a list from your cookbook', { onClick: fromCookbookDialog }),
      iconButton('inbox', 'Bring in a list', { onClick: importList }),
      iconButton('plus', 'New list', { primary: true, onClick: () => newListDialog() }),
      iconLink('settings', 'Settings', '#/settings'),
    ]),
  ]);
}

function greeting() {
  const { lists, settings } = store.state;
  const left = lists.reduce((n, list) => n + progressOf(list).total - progressOf(list).done, 0);
  if (!lists.length && !sharedCache.mine.length) {
    return `Nothing to buy yet, ${chefName(settings.profile)}`;
  }
  if (!lists.length) return 'Shared lists only';
  if (!left) return 'Everything crossed off';
  return `${left} still to find`;
}

function empty() {
  return el('div', { class: 'table-empty' }, [
    el('p', { text: 'An empty table. Start a list and it will lie here waiting.' }),
    el('button', {
      class: 'btn', type: 'button', text: 'Start a list',
      onClick: () => newListDialog(),
    }),
  ]);
}

/* A list somebody has asked you onto, sitting on the table as an envelope
   rather than a sheet — it is not yours until you open it. */
function invitation(list) {
  return el('button', {
    class: 'sheet-card is-invitation',
    type: 'button',
    onClick: async () => {
      try {
        await join(list.id);
      } catch (err) {
        console.warn('Could not join that list.', err);
        toast('That did not work. The list may have been thrown away.');
        return;
      }
      location.hash = `#/list/${list.id}?shared=1`;
    },
  }, [
    el('span', { class: 'label', text: 'Shared with you' }),
    el('h2', { text: list.title || 'A shopping list' }),
    list.subtitle && el('div', { class: 'sub', text: list.subtitle }),
    el('div', { class: 'count' }, [el('span', { text: 'open it' })]),
  ]);
}

function card(list) {
  const { done, total } = progressOf(list);

  // Deterministic scatter: a tilt and a nudge derived from the list's own id.
  const tilt = (hashUnit(list.id, 1) - 0.5) * 4.4;
  const nudge = (hashUnit(list.id, 2) - 0.5) * 18;
  const tag = `var(--tag-${Math.floor(hashUnit(list.id, 3) * 6) + 1})`;

  // The first few things on it, so the table is readable without opening
  // anything — which is the point of leaving paper lying out.
  const peek = readingOrder(list)
    .flatMap((group) => group.items)
    .slice(0, 5);

  const node = el('button', {
    class: 'sheet-card',
    type: 'button',
    style: `--tilt:${tilt.toFixed(2)}deg; --nudge:${nudge.toFixed(1)}px; --sheet-tag:${tag}`,
    dataset: { paper: list.paper || 'plain' },
    onClick: () => {
      location.hash = list.shared ? `#/list/${list.id}?shared=1` : `#/list/${list.id}`;
    },
  }, [
    el('h2', { text: list.title }),
    list.subtitle && el('div', { class: 'sub', text: list.subtitle }),
    el('ul', { class: 'peek' }, peek.map((item) => el('li', {
      class: item.done ? 'is-done' : '',
      text: itemToText(item),
    }))),
    el('div', { class: 'count' }, [
      el('span', { text: total ? `${done}/${total}` : 'empty' }),
      list.shared && el('span', { class: 'shared-mark', text: 'shared' }),
    ]),
  ]);

  return node;
}

/* --- making one ----------------------------------------------------------- */

export function newListDialog(onDone) {
  const title = el('input', { type: 'text', value: '', placeholder: 'Weekly shop' });
  const paper = el('select', {}, PAPER_STOCKS.map((stock) =>
    el('option', { value: stock.id, text: stock.label })));

  const body = el('div', {}, [
    el('div', { class: 'field' }, [
      el('label', { class: 'label', text: 'Name' }), title,
    ]),
    el('div', { class: 'field' }, [
      el('label', { class: 'label', text: 'Paper' }), paper,
    ]),
  ]);

  modal({
    title: 'A new list',
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Start it',
        class: 'btn',
        onClick: () => {
          const list = store.addList({
            title: title.value.trim() || 'Shopping list',
            paper: paper.value,
          });
          if (onDone) onDone(list);
          else location.hash = `#/list/${list.id}`;
        },
      },
    ],
  });
}

/* Importing is deliberately reachable from here as well as from inside a
   list, because the two mean different things: from the table a file becomes
   a new sheet, from inside a list it is added to the one already open. */
function importList() {
  importDialog();
}
