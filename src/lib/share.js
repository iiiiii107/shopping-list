import { firebase, currentAccount } from './sync.js';

/* Turning a list into one several people hold, and back again.

   Sharing moves a list rather than copying it: it stops being a row in your
   own blob and becomes a document of its own with an item beneath it for
   every line. Two homes for one list would be two sources of truth that
   disagree the first time anybody is offline. */

const HEADER = ['title', 'subtitle', 'date', 'store', 'paper', 'palette', 'sections'];

function headerOf(list) {
  const out = {};
  for (const key of HEADER) out[key] = list[key] ?? (key === 'sections' ? [] : '');
  if (!out.palette) out.palette = { light: {}, dark: {} };
  return out;
}

/** Make a private list into a shared one. Returns its new id. */
export async function share(list) {
  const me = currentAccount();
  if (!me) throw new Error('Sign in first.');

  const { firestore: f, db } = await firebase();
  const ref = f.doc(f.collection(db, 'lists'));

  /* The list first, on its own, and only then the items.

     They cannot go in one batch, and this is the bug that made sharing fail
     outright the first time somebody tried it. An item's rule asks whether
     you may use the list it belongs to, by `get`ting the list document — and
     rules for a batched write are evaluated against the database as it was
     BEFORE the batch, where the list does not exist yet. So the get returned
     nothing, the item write was denied, and the whole batch with it. Every
     share was refused at the first step. */
  await f.setDoc(ref, {
    ...headerOf(list),
    owner: me.uid,
    members: [me.uid],
    invited: [],
    linkOpen: false,
    createdAt: f.serverTimestamp(),
    updatedAt: f.serverTimestamp(),
  });

  const items = list.items || [];
  if (items.length) {
    const batch = f.writeBatch(db);
    for (const item of items) {
      const { id, ...rest } = item;
      batch.set(f.doc(f.collection(ref, 'items'), id), rest);
    }
    await batch.commit();
  }
  return ref.id;
}

/**
 * The lists you are on and the ones waiting for you, kept up to date.
 *
 * Two live queries rather than a fetch, because a fetch has to be triggered by
 * something — and the something the table first used was its own render, which
 * then re-rendered on the answer and fetched again, forever. A subscription
 * has no such loop in it, and it also means a list somebody shares with you
 * while you are looking at the table simply appears.
 *
 * @returns {Promise<() => void>} the way to stop
 */
export async function watchShared(onChange) {
  const me = currentAccount();
  if (!me) { onChange({ mine: [], invitations: [] }); return () => {}; }

  const { firestore: f, db } = await firebase();
  const lists = f.collection(db, 'lists');

  let mine = [];
  let waiting = [];
  const deliver = () => {
    const ids = new Set(mine.map((l) => l.id));
    onChange({
      mine,
      // Not the ones already accepted: an invitation you took up should stop
      // offering itself.
      invitations: waiting.filter((l) => !ids.has(l.id)),
    });
  };

  const rows = (snap) => snap.docs.map((d) => ({ id: d.id, shared: true, ...d.data() }));

  const stopMine = f.onSnapshot(
    f.query(lists, f.where('members', 'array-contains', me.uid)),
    (snap) => { mine = rows(snap); deliver(); },
    (err) => console.warn('Could not follow your shared lists.', err),
  );

  const stopWaiting = me.email
    ? f.onSnapshot(
        f.query(lists, f.where('invited', 'array-contains', me.email)),
        (snap) => { waiting = rows(snap); deliver(); },
        (err) => console.warn('Could not follow your invitations.', err),
      )
    : () => {};

  return () => { stopMine(); stopWaiting(); };
}

/** The lists you are on, and the ones waiting for you to accept. */
export async function myShared() {
  const me = currentAccount();
  if (!me) return { mine: [], invitations: [] };

  const { firestore: f, db } = await firebase();
  const lists = f.collection(db, 'lists');

  const [onThem, waiting] = await Promise.all([
    f.getDocs(f.query(lists, f.where('members', 'array-contains', me.uid))),
    me.email
      ? f.getDocs(f.query(lists, f.where('invited', 'array-contains', me.email)))
      : Promise.resolve({ docs: [] }),
  ]);

  const mineIds = new Set(onThem.docs.map((d) => d.id));
  return {
    mine: onThem.docs.map((d) => ({ id: d.id, shared: true, ...d.data() })),
    // Only the ones not already accepted, so an invitation you took up does
    // not go on offering itself forever.
    invitations: waiting.docs
      .filter((d) => !mineIds.has(d.id))
      .map((d) => ({ id: d.id, shared: true, ...d.data() })),
  };
}

/** Accept: put yourself on the list, so the owner can see you are on it. */
export async function join(listId) {
  const me = currentAccount();
  if (!me) throw new Error('Sign in first.');

  const { firestore: f, db } = await firebase();
  const ref = f.doc(db, 'lists', listId);
  await f.updateDoc(ref, { members: f.arrayUnion(me.uid) });
}

/** Leave a list. Only your own name comes off — that is all the rules allow. */
export async function leave(listId) {
  const me = currentAccount();
  const { firestore: f, db } = await firebase();
  await f.updateDoc(f.doc(db, 'lists', listId), { members: f.arrayRemove(me.uid) });
}

export async function invite(listId, email) {
  const { firestore: f, db } = await firebase();
  await f.updateDoc(f.doc(db, 'lists', listId), {
    invited: f.arrayUnion(String(email).trim().toLowerCase()),
  });
}

export async function uninvite(listId, email) {
  const { firestore: f, db } = await firebase();
  await f.updateDoc(f.doc(db, 'lists', listId), { invited: f.arrayRemove(email) });
}

export async function setLinkOpen(listId, open) {
  const { firestore: f, db } = await firebase();
  await f.updateDoc(f.doc(db, 'lists', listId), { linkOpen: !!open });
}

/** Throw a shared list away. Only its owner can; everyone else leaves. */
export async function destroy(listId, items = []) {
  const { firestore: f, db } = await firebase();
  const ref = f.doc(db, 'lists', listId);
  const batch = f.writeBatch(db);
  for (const item of items) batch.delete(f.doc(f.collection(ref, 'items'), item.id));
  batch.delete(ref);
  await batch.commit();
}

/** The link that gets somebody to this list. */
export function linkTo(listId) {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/list/${listId}?shared=1`;
}
