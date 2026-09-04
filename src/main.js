import './styles/app.css';
import { el, clear } from './lib/dom.js';
import { store } from './lib/store.js';
import { applyTheme } from './lib/theme.js';
import { registerServiceWorker } from './lib/pwa.js';
import { restoreSession, onAccountChange, currentAccount } from './lib/sync.js';

import { renderTable } from './views/table.js';
import { renderSheet } from './views/sheet.js';
import { renderSettings } from './views/settings.js';

/* Hash routing, as in the sibling apps: GitHub Pages serves one file, so a
   real path would 404 on refresh. The route also lands on <body data-view>
   so the stylesheet can dress each screen differently. */

const ROUTES = [
  { pattern: /^\/?$/, view: 'table', render: renderTable },
  { pattern: /^\/list\/([^/]+)$/, view: 'sheet', render: renderSheet },
  { pattern: /^\/settings$/, view: 'settings', render: renderSettings },
];

const app = document.querySelector('#app');
let scene;

function chrome() {
  // The table and the door to the cookbook sit outside the routed area, so
  // opening a list never rebuilds them.
  app.append(el('div', { class: 'table-surface', 'aria-hidden': 'true' }));
  scene = el('main', { class: 'scene' });
  app.append(scene);
  app.append(cookbookDoor());
}

/* The way back to the recipes: a book lying at the corner of the table with
   most of itself over the edge. Hovering slides it out and names it.

   It is an <a> with a real href, so it is keyboard-reachable, it says where
   it goes, and middle-clicking opens the cookbook in a new tab — none of
   which a decorated <div> with a click handler would give you. */
function cookbookDoor() {
  const door = el('a', {
    class: 'cookbook-door',
    href: '#',
    'aria-label': 'Open your cookbook',
  }, [
    el('span', { class: 'book', 'aria-hidden': 'true' }),
    el('span', { class: 'plate', text: 'Your cookbook →' }),
  ]);

  const paint = () => {
    if (!store.state) return;
    door.href = store.state.settings.cookbookUrl || '#';
  };
  store.addEventListener('change', paint);
  paint();
  return door;
}

function go() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  const query = new URLSearchParams(search);

  const route =
    ROUTES.map((r) => ({ r, m: path.match(r.pattern) })).find(({ m }) => m) ||
    { r: ROUTES[0], m: [] };

  document.body.dataset.view = route.r.view;
  clear(scene);
  route.r.render(scene, ...route.m.slice(1), query);
  scene.scrollTop = 0;
}

/* Re-render, unless a screen has asked to be left alone.

   A save normally means "redraw everything", which is what keeps two tabs,
   two devices and two people honest. But a rebuild takes the caret with it,
   so a screen with something being typed into it holds the render and patches
   itself instead. The cook book learned this the hard way twice: an unguarded
   background render tore down cook mode a second after load, and again when
   the auth state resolved. */
function maybeGo() {
  if (document.body.dataset.editing) return;
  go();
}

async function boot() {
  chrome();
  await store.init();
  applyTheme(store.state.settings);

  // "System" means the OS can turn the lights out under us mid-session.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    applyTheme(store.state.settings);
    store.emit();
  });

  /* Picking the session back up swaps the storage backend underneath, which
     the store hears about as an ordinary change. Signing in is once per
     device. It is deliberately not awaited: the app has to be usable before
     the network has said anything. */
  restoreSession().catch((err) => console.warn('Could not restore the session.', err));
  onAccountChange(() => {
    const account = currentAccount();
    // The greeting takes the name from the account once there is one, without
    // overwriting one that was typed in by hand.
    if (account?.name && !store.state.settings.profile?.name) {
      store.updateSettings({
        profile: { name: account.name, email: account.email || '' },
      });
    }
    maybeGo();
  });

  window.addEventListener('hashchange', go);
  store.addEventListener('change', maybeGo);

  go();
  registerServiceWorker(import.meta.env.BASE_URL);
}

boot();
