import { storage } from './storage.js';
import { newList, newItem, newSection, orderAtEnd, itemsInSection } from './list.js';

/* Single source of truth, in the shape the cook book uses: views read
   `store.state`, call an action, and re-render on the change event. No view
   mutates state directly, so a change arriving from another tab, another
   device, or another person lands exactly the way a local edit does.

   Shared lists are the exception, and deliberately so. Their items live in
   their own Firestore documents (lib/live.js) because this store saves the
   whole state at once — fine for one person, ruinous for two. When a list is
   shared, the copy here is a cache that the live layer keeps fed. */

class Store extends EventTarget {
  constructor() {
    super();
    this.state = null;
    this.ready = false;
  }

  async init() {
    this.state = await storage.load();
    this.ready = true;
    storage.subscribe((incoming) => {
      this.state = incoming;
      this.emit();
    });
    this.emit();
  }

  emit() {
    this.dispatchEvent(new CustomEvent('change'));
  }

  async persist() {
    await storage.save(this.state);
    this.emit();
  }

  // ---- lists -------------------------------------------------------------

  addList(fields) {
    const list = newList(fields);
    this.state.lists.push(list);
    this.persist();
    return list;
  }

  updateList(id, patch) {
    const list = this.listById(id);
    if (list) Object.assign(list, patch, { updatedAt: new Date().toISOString() });
    return this.persist();
  }

  deleteList(id) {
    this.state.lists = this.state.lists.filter((l) => l.id !== id);
    return this.persist();
  }

  // ---- items -------------------------------------------------------------

  /**
   * Add an item to a list, at the end of its section.
   * @param {string} listId
   * @param {string|object} entry a typed line, or ready-made fields
   * @param {string} sectionId '' for the loose items at the top
   */
  addItem(listId, entry, sectionId = '') {
    const list = this.listById(listId);
    if (!list) return null;

    const fields = typeof entry === 'string' ? { text: entry } : entry;
    const item = newItem({
      ...fields,
      sectionId,
      order: orderAtEnd(itemsInSection(list, sectionId)),
      addedBy: this.state.settings.profile?.email || '',
    });
    list.items.push(item);
    list.updatedAt = new Date().toISOString();
    this.persist();
    return item;
  }

  updateItem(listId, itemId, patch) {
    const list = this.listById(listId);
    const item = list?.items.find((i) => i.id === itemId);
    if (!item) return this.persist();
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    list.updatedAt = item.updatedAt;
    return this.persist();
  }

  /* Crossing off records who did it and when. On a private list that is just
     history; on a shared one it is the answer to "has she got the milk yet?",
     which is the whole reason two people are on the list at all. */
  toggleItem(listId, itemId) {
    const list = this.listById(listId);
    const item = list?.items.find((i) => i.id === itemId);
    if (!item) return this.persist();

    const done = !item.done;
    return this.updateItem(listId, itemId, {
      done,
      doneBy: done ? (this.state.settings.profile?.email || '') : '',
      doneAt: done ? new Date().toISOString() : '',
    });
  }

  removeItem(listId, itemId) {
    const list = this.listById(listId);
    if (!list) return this.persist();
    list.items = list.items.filter((i) => i.id !== itemId);
    list.updatedAt = new Date().toISOString();
    return this.persist();
  }

  /** Everything crossed off, gone in one action — the end of a shop. */
  clearDone(listId) {
    const list = this.listById(listId);
    if (!list) return this.persist();
    list.items = list.items.filter((i) => !i.done);
    list.updatedAt = new Date().toISOString();
    return this.persist();
  }

  // ---- sections ----------------------------------------------------------

  addSection(listId, label) {
    const list = this.listById(listId);
    if (!list) return null;
    const section = newSection({ label, order: orderAtEnd(list.sections) });
    list.sections.push(section);
    list.updatedAt = new Date().toISOString();
    this.persist();
    return section;
  }

  updateSection(listId, sectionId, patch) {
    const section = this.listById(listId)?.sections.find((s) => s.id === sectionId);
    if (section) Object.assign(section, patch);
    return this.persist();
  }

  /* Removing a heading keeps what was under it. The items lose their section
     and rejoin the loose ones at the top — deleting "Fruit" should tidy the
     page, not throw away the apples. */
  removeSection(listId, sectionId) {
    const list = this.listById(listId);
    if (!list) return this.persist();
    for (const item of list.items) {
      if (item.sectionId === sectionId) item.sectionId = '';
    }
    list.sections = list.sections.filter((s) => s.id !== sectionId);
    list.updatedAt = new Date().toISOString();
    return this.persist();
  }

  // ---- settings ----------------------------------------------------------

  updateSettings(patch) {
    Object.assign(this.state.settings, patch);
    return this.persist();
  }

  // ---- lookups -----------------------------------------------------------

  listById(id) {
    return this.state.lists.find((l) => l.id === id);
  }
}

export const store = new Store();
