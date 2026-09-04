import { firebase, currentAccount } from './sync.js';
import { newItem, orderAtEnd, itemsInSection } from './list.js';

/* A list several people write on at once.

   This is the one part of the app that does not go through storage.js, and
   the reason is the whole reason the app exists. That facade saves the entire
   state in one go, which is exactly right for one person on two devices and
   ruinous for two people on one list: you add olives, she adds bread, and
   whoever saves second writes a version that never contained the other's
   item. It is silent, and what is lost is the thing you are standing in a
   shop trying to remember.

   So a shared list is not a blob. The list itself is one document — its name,
   its headings, who is on it — and every item is its own document beneath it.
   Two people adding different things write different documents and cannot
   collide. Crossing something off is a two-field write to one item. Firestore
   merges per document, so there is no last-write-wins across the list.

   The other half of the job is not losing the caret. A snapshot arriving
   while you are typing must not rebuild the field you are typing into, so
   anything that lands while the `editing` flag is up is held and applied the
   moment it drops. */

const COLLECTION = 'lists';

/** Fields that live on the list document rather than on an item. */
const HEADER = ['title', 'subtitle', 'date', 'store', 'paper', 'palette', 'sections'];

function headerOf(list) {
  const out = {};
  for (const key of HEADER) if (list[key] !== undefined) out[key] = list[key];
  return out;
}

/**
 * Open a shared list and keep it up to date.
 *
 * `onChange` is handed the whole list, rebuilt from the two snapshots, every
 * time either changes. Returns an object with the same shape the local store
 * offers, so a view can be written once and work either way.
 */
export async function openList(listId, onChange) {
  const { firestore: f, db } = await firebase();

  const listRef = f.doc(db, COLLECTION, listId);
  const itemsRef = f.collection(listRef, 'items');

  let header = null;
  let items = [];
  let stopped = false;

  /* What arrived while somebody was typing. A re-render would take the caret
     out of the middle of a word, so it waits — never for long, because it is
     released on blur. */
  let held = false;

  function editing() {
    return !!document.body.dataset.editing;
  }

  function deliver() {
    if (stopped || !header) return;
    if (editing()) { held = true; return; }
    held = false;
    onChange({ ...header, id: listId, shared: true, items: [...items] });
  }

  const onFlag = (event) => {
    if (event.detail?.name === 'editing' && held) deliver();
  };
  document.addEventListener('bodyflag', onFlag);

  const stopHeader = f.onSnapshot(listRef, (snap) => {
    if (!snap.exists()) { header = null; onChange(null); return; }
    header = snap.data();
    deliver();
  }, (err) => console.warn('The list stopped updating.', err));

  const stopItems = f.onSnapshot(itemsRef, (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    deliver();
  }, (err) => console.warn('The items stopped updating.', err));

  const me = () => currentAccount()?.email || '';

  return {
    shared: true,
    listId,

    close() {
      stopped = true;
      document.removeEventListener('bodyflag', onFlag);
      stopHeader();
      stopItems();
    },

    /* Every write below touches one document. That is the point: none of them
       can undo somebody else's. */

    updateList(_id, patch) {
      return f.updateDoc(listRef, { ...headerOf(patch), updatedAt: f.serverTimestamp() });
    },

    addItem(_id, entry, sectionId = '') {
      const fields = typeof entry === 'string' ? { text: entry } : entry;
      const item = newItem({
        ...fields,
        sectionId,
        order: orderAtEnd(itemsInSection({ items }, sectionId)),
        addedBy: me(),
      });
      const { id, ...rest } = item;
      // Written under the id the item already has, so the row this view just
      // put on screen and the row that comes back are the same row.
      f.setDoc(f.doc(itemsRef, id), rest);
      return item;
    },

    updateItem(_id, itemId, patch) {
      const { id, ...rest } = patch;
      return f.updateDoc(f.doc(itemsRef, itemId), {
        ...rest, updatedAt: new Date().toISOString(),
      });
    },

    toggleItem(_id, itemId) {
      const item = items.find((i) => i.id === itemId);
      if (!item) return Promise.resolve();
      const done = !item.done;
      return this.updateItem(_id, itemId, {
        done,
        doneBy: done ? me() : '',
        doneAt: done ? new Date().toISOString() : '',
      });
    },

    removeItem(_id, itemId) {
      return f.deleteDoc(f.doc(itemsRef, itemId));
    },

    async clearDone(_id) {
      const batch = f.writeBatch(db);
      for (const item of items.filter((i) => i.done)) {
        batch.delete(f.doc(itemsRef, item.id));
      }
      return batch.commit();
    },

    /* Headings live on the list document, so two people renaming two headings
       at the same moment is the one place this design can still lose a write.
       It is a rare thing to be doing and a cheap thing to redo, which is why
       it is not worth a document each. */

    addSection(_id, label) {
      const sections = [...(header?.sections || [])];
      const section = {
        id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
        label,
        order: orderAtEnd(sections),
      };
      sections.push(section);
      f.updateDoc(listRef, { sections });
      return section;
    },

    updateSection(_id, sectionId, patch) {
      const sections = (header?.sections || []).map((s) =>
        (s.id === sectionId ? { ...s, ...patch } : s));
      return f.updateDoc(listRef, { sections });
    },

    async removeSection(_id, sectionId) {
      const sections = (header?.sections || []).filter((s) => s.id !== sectionId);
      const batch = f.writeBatch(db);
      batch.update(listRef, { sections });
      // What was under it stays, and rejoins the loose items at the top.
      for (const item of items.filter((i) => i.sectionId === sectionId)) {
        batch.update(f.doc(itemsRef, item.id), { sectionId: '' });
      }
      return batch.commit();
    },
  };
}
