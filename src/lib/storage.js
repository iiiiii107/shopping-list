/* Storage adapter.

   The shape is lifted from the cook book, which lifted it from
   10minutestospare: everything goes through `storage`, never through
   localStorage directly, and `storage` is a facade over one backend at a
   time — this browser when signed out, Firestore when signed in. Swapping
   the backend is the whole of "turning sync on"; no view knows which is
   under it.

   One thing does NOT pass through here, and it is the point of this app:
   a *shared* list. Shared lists are per-item documents in their own
   collection, because this facade saves the whole state at once and two
   people doing that to one list would overwrite each other. See lib/live.js.
   What lives here is your own lists, your settings, and — for a shared
   list — nothing but a stub saying it exists and where to find it. */

const KEY = 'shopping:data:v1';

export const DEFAULT_SETTINGS = {
  // Filled from the Google account once you sign in; until then an empty
  // name simply means "Chef".
  profile: { name: '', email: '' },
  theme: 'system',       // system | light | dark
  wood: 'oak',
  /* Two palettes, not one. A colour picked for paper by daylight has no
     business being the paper at night — the old single set was written onto
     <html> as an inline style, which beats both token blocks, so choosing a
     cream page once left you with a cream page in the dark as well. */
  palette: { light: {}, dark: {} },
  fontDisplay: 'garamond',
  fontBody: 'inter',
  textScale: 1,
  /* How the sheets are laid out on the table, as { listId: order }.

     In settings rather than on the lists themselves because it has to cover
     shared ones too, and where a list sits on *your* table is nobody else's
     business — writing it onto the shared document would rearrange everybody
     else's table every time you tidied your own. */
  tableOrder: {},
  // Where the door at the bottom-left goes. Kept in settings rather than
  // hard-coded so a local copy of the cookbook can be pointed at instead.
  cookbookUrl: 'https://iiiiii107.github.io/cook-book/',
};

export const DEFAULT_STATE = {
  version: 1,
  lists: [],             // see lib/list.js
  settings: DEFAULT_SETTINGS,
};

/**
 * A palette in the two-set shape, whatever shape it arrived in.
 *
 * A flat palette is what the app saved before there were two, and it applied
 * to both themes at once. So it is copied into both — anything else would
 * silently restyle a list somebody had already got the way they wanted it.
 */
export function splitPalette(palette) {
  const p = palette || {};
  if (p.light || p.dark) {
    return { light: { ...(p.light || {}) }, dark: { ...(p.dark || {}) } };
  }
  const flat = { ...p };
  return { light: { ...flat }, dark: { ...flat } };
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Fills in anything a stored payload predates, so old saves keep working. */
export function withDefaults(data) {
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  settings.profile = { ...DEFAULT_SETTINGS.profile, ...(settings.profile || {}) };
  settings.palette = splitPalette(settings.palette);
  settings.tableOrder = { ...(settings.tableOrder || {}) };

  return {
    ...DEFAULT_STATE,
    ...data,
    lists: (data.lists || []).map((list) => ({
      ...list,
      palette: splitPalette(list.palette),
    })),
    settings,
  };
}

export function createLocalStorage() {
  const listeners = new Set();

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? withDefaults(JSON.parse(raw)) : clone(DEFAULT_STATE);
    } catch {
      return clone(DEFAULT_STATE);
    }
  }

  function write(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not save — storage may be full or blocked.', err);
    }
    listeners.forEach((fn) => fn(state));
  }

  // Another tab saving counts as a remote change; mirror it into this one.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) listeners.forEach((fn) => fn(read()));
  });

  return {
    kind: 'local',
    load: async () => read(),
    save: async (state) => write(state),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async exportAll() {
      return JSON.stringify(read(), null, 2);
    },
    async importAll(json) {
      write(withDefaults(JSON.parse(json)));
    },
  };
}

/* The facade. Subscribers register here rather than with a backend, so they
   survive a swap: signing in replaces what's underneath and everyone is
   handed the cloud's copy of the state. */

const local = createLocalStorage();
let backend = local;
const listeners = new Set();
let detach = backend.subscribe((state) => listeners.forEach((fn) => fn(state)));

export const storage = {
  get kind() {
    return backend.kind;
  },
  load: (...args) => backend.load(...args),
  save: (...args) => backend.save(...args),
  exportAll: () => backend.exportAll(),
  importAll: (json) => backend.importAll(json),

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** The signed-out backend, for seeding the cloud on first sign-in. */
  local,

  /**
   * Put a different backend underneath and hand everyone its state.
   * @param {object} next a backend, or null to go back to this browser only
   */
  async use(next) {
    const chosen = next || local;
    if (chosen === backend) return backend.load();

    detach?.();
    backend = chosen;
    detach = backend.subscribe((state) => listeners.forEach((fn) => fn(state)));

    const state = await backend.load();
    listeners.forEach((fn) => fn(state));
    return state;
  },
};
