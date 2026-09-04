import { firebase, currentAccount } from './sync.js';
import { newList } from './list.js';

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

  const batch = f.writeBatch(db);
  batch.set(ref, {
    ...headerOf(list),
    owner: me.uid,
    members: [me.uid],
    invited: [],
    linkOpen: false,
    createdAt: f.serverTimestamp(),
    updatedAt: f.serverTimestamp(),
  });
  for (const item of list.items || []) {
    const { id, ...rest } = item;
    batch.set(f.doc(f.collection(ref, 'items'), id), rest);
  }
  await batch.commit();
  return ref.id;
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

/**
 * Bring a shared list back to being your own — what you want when everyone
 * has gone home and you would rather it stopped being a shared thing.
 */
export function toPrivate(list) {
  return newList({
    ...list,
    id: undefined,
    shared: false,
    owner: '',
    members: [],
    invited: [],
    linkOpen: false,
  });
}

/** The link that gets somebody to this list. */
export function linkTo(listId) {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/list/${listId}?shared=1`;
}
