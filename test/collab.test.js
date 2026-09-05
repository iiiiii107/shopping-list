/* @vitest-environment jsdom */

/* Two people, one list, against a real database.

   This is the test that should have existed before sharing shipped. The unit
   tests all passed and the rules were proved in the emulator, and the feature
   was still broken for the second person — because nothing had ever run
   share(), myShared(), join() and openList() end to end as two different
   accounts. Everything here does. */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as firestore from 'firebase/firestore';

import { __useTestSdk } from '../src/lib/sync.js';
import { share, myShared, join, invite, setLinkOpen, leave } from '../src/lib/share.js';
import { openList } from '../src/lib/live.js';
import { newList, newItem, itemToText } from '../src/lib/list.js';
import { claimBodyFlag } from '../src/lib/dom.js';

let env;
const ME = { uid: 'me', name: 'Isabel', email: 'isabel@example.com' };
const ANNA = { uid: 'anna', name: 'Anna', email: 'anna@example.com' };
const STRANGER = { uid: 'stranger', name: 'Nobody', email: 'nobody@example.com' };

/** Become this person, for every module that reads the account. */
function beComesTo(user) {
  const db = env
    .authenticatedContext(user.uid, { email: user.email, email_verified: true })
    .firestore();
  __useTestSdk({ firestore, db }, user);
  return db;
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'collab-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => { __useTestSdk(null, null); await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  // A leaked flag would hold every delivery in every test after it — which is
  // precisely how one failing test turned into four.
  delete document.body.dataset.editing;
  delete document.body.dataset.sheet;
});

/** A list as it would be on somebody's table before they shared it. */
function aList() {
  return newList({
    title: 'Weekly shop',
    subtitle: 'for the flat',
    items: [
      newItem({ text: '250 ml milk', order: 1000 }),
      newItem({ text: '3 apples', order: 2000 }),
    ],
  });
}

/** Wait for a live list to satisfy something, rather than for a fixed time. */
function until(check, ms = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = async () => {
      const value = await check();
      if (value) return resolve(value);
      if (Date.now() - started > ms) return reject(new Error('timed out waiting'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe('sharing a list, from both sides', () => {
  it('the list and every item on it go up', async () => {
    beComesTo(ME);
    const id = await share(aList());

    const db = beComesTo(ME);
    const snap = await firestore.getDoc(firestore.doc(db, 'lists', id));
    expect(snap.exists()).toBe(true);
    expect(snap.data().title).toBe('Weekly shop');
    expect(snap.data().members).toEqual([ME.uid]);

    const items = await firestore.getDocs(firestore.collection(db, 'lists', id, 'items'));
    expect(items.docs.map((d) => d.data().text).sort()).toEqual(['apples', 'milk']);
  });

  it('the owner sees it among their own', async () => {
    beComesTo(ME);
    const id = await share(aList());
    const { mine, invitations } = await myShared();
    expect(mine.map((l) => l.id)).toEqual([id]);
    expect(invitations).toEqual([]);
  });

  /* The reported failure, from the invited side. */
  it('somebody invited by address finds it waiting on their table', async () => {
    beComesTo(ME);
    const id = await share(aList());
    await invite(id, ANNA.email);

    beComesTo(ANNA);
    const { mine, invitations } = await myShared();
    expect(invitations.map((l) => l.id), 'the invitation should be on Anna\'s table').toEqual([id]);
    expect(mine).toEqual([]);
  });

  it('and can open it, and write on it, before accepting', async () => {
    beComesTo(ME);
    const id = await share(aList());
    await invite(id, ANNA.email);

    beComesTo(ANNA);
    let seen = null;
    const api = await openList(id, (list) => { seen = list; });
    await until(() => seen && seen.items.length === 2);
    expect(seen.title).toBe('Weekly shop');

    api.addItem(id, 'bread');
    await until(() => seen.items.length === 3);
    expect(seen.items.map((i) => i.text)).toContain('bread');
    api.close();
  });

  it('accepting puts them on it for good', async () => {
    beComesTo(ME);
    const id = await share(aList());
    await invite(id, ANNA.email);

    beComesTo(ANNA);
    await join(id);
    const { mine, invitations } = await myShared();
    expect(mine.map((l) => l.id)).toEqual([id]);
    // And it stops offering itself as an invitation once accepted.
    expect(invitations).toEqual([]);
  });

  /* The reported failure, from the link side. */
  it('the link works once the switch is on, and not before', async () => {
    beComesTo(ME);
    const id = await share(aList());

    beComesTo(STRANGER);
    await expect(
      firestore.getDoc(firestore.doc(env.authenticatedContext(STRANGER.uid,
        { email: STRANGER.email }).firestore(), 'lists', id)),
    ).rejects.toThrow();

    beComesTo(ME);
    await setLinkOpen(id, true);

    beComesTo(STRANGER);
    let seen = null;
    const api = await openList(id, (list) => { seen = list; });
    await until(() => seen && seen.items.length === 2);
    expect(seen.title).toBe('Weekly shop');
    api.close();
  });

  it('leaving takes only your own name off', async () => {
    beComesTo(ME);
    const id = await share(aList());
    await invite(id, ANNA.email);
    beComesTo(ANNA);
    await join(id);
    await leave(id);

    beComesTo(ME);
    const { mine } = await myShared();
    expect(mine[0].members).toEqual([ME.uid]);
  });
});

describe('both of them writing at once', () => {
  async function twoOpenLists() {
    beComesTo(ME);
    const id = await share(aList());
    await invite(id, ANNA.email);

    let hers = null;
    beComesTo(ANNA);
    const annaApi = await openList(id, (l) => { hers = l; });

    let mine = null;
    beComesTo(ME);
    const myApi = await openList(id, (l) => { mine = l; });

    await until(() => mine && hers && mine.items.length === 2 && hers.items.length === 2);
    return { id, myApi, annaApi, get mine() { return mine; }, get hers() { return hers; } };
  }

  /* The whole reason for a document per item. With the list saved as one
     blob, whoever wrote second would send a version that never contained the
     other's item, and it would vanish without a word. */
  it('two items added at the same moment both survive', async () => {
    const s = await twoOpenLists();

    beComesTo(ME);
    s.myApi.addItem(s.id, 'olives');
    beComesTo(ANNA);
    s.annaApi.addItem(s.id, 'bread');

    await until(() => s.mine.items.length === 4 && s.hers.items.length === 4);
    const names = s.mine.items.map((i) => i.text).sort();
    expect(names).toEqual(['apples', 'bread', 'milk', 'olives']);
    expect(s.hers.items.map((i) => i.text).sort()).toEqual(names);

    s.myApi.close(); s.annaApi.close();
  });

  it('crossing something off shows up on the other screen, with who did it', async () => {
    const s = await twoOpenLists();

    beComesTo(ANNA);
    const milk = s.hers.items.find((i) => i.text === 'milk');
    await s.annaApi.toggleItem(s.id, milk.id);

    await until(() => s.mine.items.find((i) => i.id === milk.id)?.done);
    expect(s.mine.items.find((i) => i.id === milk.id).doneBy).toBe(ANNA.email);

    s.myApi.close(); s.annaApi.close();
  });

  it('editing one item does not disturb the other', async () => {
    const s = await twoOpenLists();

    beComesTo(ME);
    const milk = s.mine.items.find((i) => i.text === 'milk');
    const apples = s.mine.items.find((i) => i.text === 'apples');
    await s.myApi.updateItem(s.id, milk.id, { text: 'milk', qty: 500, unit: 'ml' });
    beComesTo(ANNA);
    await s.annaApi.toggleItem(s.id, apples.id);

    await until(() => {
      const m = s.hers.items.find((i) => i.id === milk.id);
      const a = s.hers.items.find((i) => i.id === apples.id);
      return m?.qty === 500 && a?.done;
    });
    expect(itemToText(s.hers.items.find((i) => i.id === milk.id))).toBe('500 ml milk');

    s.myApi.close(); s.annaApi.close();
  });
});

describe('what arrives while you are typing', () => {
  /* The rule that makes editing in place possible at all.

     A snapshot from the other person is delivered by rebuilding the sheet,
     and a rebuild replaces the node the caret is in — so a word typed while
     your flatmate adds something would lose its cursor mid-letter. Anything
     landing while the `editing` flag is up is held, and let through the
     moment it drops.

     Tested against the real database and the real flag, because the failure
     is a race and a mock of either would only prove that the code agrees with
     my own idea of them. */
  /* Anna writes; I watch. Her view is deliberately not used to check that a
     write landed — the flag lives on document.body, and in the app that is
     right (one person, one browser) but here both clients share one document,
     so raising it holds her screen as well as mine. The database itself is
     the only honest witness. Waiting on her view instead cost me an afternoon. */
  async function bothOpen() {
    beComesTo(ME);
    const id = await share(aList());
    await invite(id, ANNA.email);

    beComesTo(ANNA);
    const annaApi = await openList(id, () => {});

    beComesTo(ME);
    const seen = [];
    const myApi = await openList(id, (l) => seen.push(l));

    await until(() => seen.some((l) => l.items.length === 2));

    const onFile = async () => {
      const db = env.authenticatedContext(ME.uid, { email: ME.email }).firestore();
      const snap = await firestore.getDocs(firestore.collection(db, 'lists', id, 'items'));
      return snap.docs.map((d) => d.data().text);
    };
    return { id, myApi, annaApi, seen, onFile };
  }

  it('is held back while a field has focus, and let through on blur', async () => {
    const s = await bothOpen();

    // I start typing. The real helper, so the real release path is exercised.
    const field = document.createElement('div');
    document.body.append(field);
    const release = claimBodyFlag('editing', field);

    const before = s.seen.length;
    beComesTo(ANNA);
    s.annaApi.addItem(s.id, 'bread');

    // It really did go up — asked of the database, not of her held screen.
    await until(async () => (await s.onFile()).includes('bread'));

    // Mine has not been rebuilt under my cursor.
    expect(s.seen.length, 'the sheet was rebuilt while a field had focus').toBe(before);

    // I stop typing.
    release();
    await until(() => s.seen.some((l) => l.items.some((i) => i.text === 'bread')));

    field.remove();
    s.myApi.close();
    s.annaApi.close();
  });

  it('only the last state is delivered, not every one that piled up', async () => {
    const s = await bothOpen();

    const field = document.createElement('div');
    document.body.append(field);
    const release = claimBodyFlag('editing', field);

    const before = s.seen.length;
    beComesTo(ANNA);
    s.annaApi.addItem(s.id, 'bread');
    s.annaApi.addItem(s.id, 'olives');
    s.annaApi.addItem(s.id, 'butter');
    await until(async () => (await s.onFile()).length === 5);

    expect(s.seen.length).toBe(before);
    release();

    // One repaint carrying all three, rather than three repaints in a row:
    // the first thing delivered after the flag drops already has everything.
    await until(() => s.seen.length > before);
    expect(s.seen[before].items).toHaveLength(5);

    field.remove();
    s.myApi.close();
    s.annaApi.close();
  });

  /* Somebody else's flag going up and down is not my cue. */
  it('a flag released by another view does not let it through early', async () => {
    const s = await bothOpen();

    const field = document.createElement('div');
    document.body.append(field);
    const release = claimBodyFlag('editing', field);

    const other = document.createElement('div');
    document.body.append(other);
    const releaseOther = claimBodyFlag('sheet', other);

    const before = s.seen.length;
    beComesTo(ANNA);
    s.annaApi.addItem(s.id, 'bread');
    await until(async () => (await s.onFile()).includes('bread'));

    releaseOther();
    await new Promise((r) => setTimeout(r, 150));
    expect(s.seen.length, 'a different flag released it').toBe(before);

    release();
    await until(() => s.seen.some((l) => l.items.some((i) => i.text === 'bread')));

    field.remove(); other.remove();
    s.myApi.close();
    s.annaApi.close();
  });

  it('nothing is held when nobody is typing', async () => {
    const s = await bothOpen();
    const before = s.seen.length;

    beComesTo(ANNA);
    s.annaApi.addItem(s.id, 'bread');

    await until(() => s.seen.some((l) => l.items.some((i) => i.text === 'bread')));

    s.myApi.close();
    s.annaApi.close();
  });
});
