/* Security rules, against the real rules engine.

   These run in the Firestore emulator, which is the only honest way to check
   them: "it seemed to work while I was signed in as myself" is not a security
   test, and I cannot test the refusals from one Google account at all.

   Run with `npm run test:rules` — it starts the emulator itself. */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where,
} from 'firebase/firestore';

let env;

const ME = { uid: 'me', email: 'isabel@example.com' };
const FRIEND = { uid: 'friend', email: 'anna@example.com' };
const STRANGER = { uid: 'stranger', email: 'nobody@example.com' };

/** A signed-in client, with the email claim Google would put on the token. */
function as({ uid, email }) {
  return env.authenticatedContext(uid, { email, email_verified: true }).firestore();
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'rules-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

/** Put a list in place without going through the rules. */
async function seedList(fields) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'lists', 'L1'), {
      title: 'Weekly shop', owner: ME.uid, members: [ME.uid],
      invited: [], linkOpen: false, sections: [], ...fields,
    });
    await setDoc(doc(db, 'lists', 'L1', 'items', 'i1'), { text: 'milk', done: false });
  });
}

describe('a list nobody has been let into', () => {
  beforeEach(() => seedList());

  it('the owner can read it, and its items', async () => {
    const db = as(ME);
    await assertSucceeds(getDoc(doc(db, 'lists', 'L1')));
    await assertSucceeds(getDoc(doc(db, 'lists', 'L1', 'items', 'i1')));
  });

  /* The point of the whole exercise. */
  it('a stranger who knows the id is refused', async () => {
    const db = as(STRANGER);
    await assertFails(getDoc(doc(db, 'lists', 'L1')));
    await assertFails(getDoc(doc(db, 'lists', 'L1', 'items', 'i1')));
    await assertFails(setDoc(doc(db, 'lists', 'L1', 'items', 'x'), { text: 'sabotage' }));
  });

  it('someone signed out is refused', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'lists', 'L1')));
  });

  it('a stranger cannot add themselves to it', async () => {
    const db = as(STRANGER);
    await assertFails(updateDoc(doc(db, 'lists', 'L1'), { members: [ME.uid, STRANGER.uid] }));
  });
});

describe('inviting somebody by address', () => {
  beforeEach(() => seedList({ invited: [FRIEND.email] }));

  it('the address that was invited gets in', async () => {
    const db = as(FRIEND);
    await assertSucceeds(getDoc(doc(db, 'lists', 'L1')));
    await assertSucceeds(setDoc(doc(db, 'lists', 'L1', 'items', 'i2'), { text: 'bread' }));
  });

  it('and nobody else does, even knowing the id', async () => {
    await assertFails(getDoc(doc(as(STRANGER), 'lists', 'L1')));
  });

  /* Accepting turns an invitation into membership, which is what lets the
     owner see who is actually on the list and take them off again. */
  it('an invited person can join themselves', async () => {
    const db = as(FRIEND);
    await assertSucceeds(updateDoc(doc(db, 'lists', 'L1'), {
      members: [ME.uid, FRIEND.uid],
    }));
  });

  it('a member may write what is on the list', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'lists', 'L1'), { members: [ME.uid, FRIEND.uid] });
    });
    await assertSucceeds(updateDoc(doc(as(FRIEND), 'lists', 'L1'), { title: 'Saturday' }));
  });

  it('but only the owner decides who can see it', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'lists', 'L1'), { members: [ME.uid, FRIEND.uid] });
    });
    await assertFails(updateDoc(doc(as(FRIEND), 'lists', 'L1'), { invited: ['someone@else.com'] }));
    await assertFails(updateDoc(doc(as(FRIEND), 'lists', 'L1'), { linkOpen: true }));
    await assertSucceeds(updateDoc(doc(as(ME), 'lists', 'L1'), { linkOpen: true }));
  });

  it('a member cannot lock everyone else out', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'lists', 'L1'), { members: [ME.uid, FRIEND.uid] });
    });
    // Throwing the owner off and keeping the list.
    await assertFails(updateDoc(doc(as(FRIEND), 'lists', 'L1'), { members: [FRIEND.uid] }));
    // Emptying it entirely, which would leave a list nobody can read.
    await assertFails(updateDoc(doc(as(FRIEND), 'lists', 'L1'), {
      members: [], invited: [], linkOpen: false,
    }));
  });

  it('but a member may take their own name off', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'lists', 'L1'), { members: [ME.uid, FRIEND.uid] });
    });
    await assertSucceeds(updateDoc(doc(as(FRIEND), 'lists', 'L1'), { members: [ME.uid] }));
  });
});

describe('anyone with the link', () => {
  it('is refused while the switch is off', async () => {
    await seedList({ linkOpen: false });
    await assertFails(getDoc(doc(as(STRANGER), 'lists', 'L1')));
  });

  it('and let in once it is on — the id is the password, and the app says so', async () => {
    await seedList({ linkOpen: true });
    const db = as(STRANGER);
    await assertSucceeds(getDoc(doc(db, 'lists', 'L1')));
    await assertSucceeds(setDoc(doc(db, 'lists', 'L1', 'items', 'i9'), { text: 'olives' }));
  });
});

describe('making and destroying', () => {
  it('a list must be created owned by, and containing, its author', async () => {
    const db = as(ME);
    await assertSucceeds(setDoc(doc(db, 'lists', 'N1'), {
      title: 'Mine', owner: ME.uid, members: [ME.uid], invited: [], linkOpen: false,
    }));
    // Not owned by the author.
    await assertFails(setDoc(doc(db, 'lists', 'N2'), {
      title: 'Theirs', owner: FRIEND.uid, members: [FRIEND.uid], invited: [], linkOpen: false,
    }));
    // Owned by the author but not containing them, which would be a list
    // nobody could read, including the person who just made it.
    await assertFails(setDoc(doc(db, 'lists', 'N3'), {
      title: 'Orphan', owner: ME.uid, members: [], invited: [], linkOpen: false,
    }));
  });

  it('only the owner can throw it away; a member leaves instead', async () => {
    await seedList({ members: [ME.uid, FRIEND.uid] });
    await assertFails(deleteDoc(doc(as(FRIEND), 'lists', 'L1')));
    await assertSucceeds(updateDoc(doc(as(FRIEND), 'lists', 'L1'), { members: [ME.uid] }));
    await assertSucceeds(deleteDoc(doc(as(ME), 'lists', 'L1')));
  });
});

describe('finding your lists', () => {
  it('a query for your own memberships is allowed', async () => {
    await seedList({ members: [ME.uid, FRIEND.uid] });
    const db = as(FRIEND);
    await assertSucceeds(getDocs(query(
      collection(db, 'lists'), where('members', 'array-contains', FRIEND.uid),
    )));
  });

  it('a query for your invitations is allowed', async () => {
    await seedList({ invited: [FRIEND.email] });
    await assertSucceeds(getDocs(query(
      collection(db_of(FRIEND), 'lists'), where('invited', 'array-contains', FRIEND.email),
    )));
  });

  /* Rules are not filters: a query that could return somebody else's list is
     refused outright rather than quietly returning less. */
  it('a fishing query for everything is refused', async () => {
    await seedList();
    await assertFails(getDocs(collection(as(STRANGER), 'lists')));
    await assertFails(getDocs(query(
      collection(as(STRANGER), 'lists'), where('members', 'array-contains', ME.uid),
    )));
  });
});

function db_of(user) { return as(user); }

describe('the other apps in this project are untouched', () => {
  it('a user still owns everything under their own id', async () => {
    await assertSucceeds(setDoc(doc(as(ME), 'users', ME.uid, 'app', 'shopping'), { payload: '{}' }));
    await assertSucceeds(setDoc(doc(as(ME), 'users', ME.uid, 'app', 'cookbook'), { payload: '{}' }));
    await assertFails(getDoc(doc(as(STRANGER), 'users', ME.uid, 'app', 'cookbook')));
  });

  it('the cook book\'s shares still work the way they did', async () => {
    const db = as(ME);
    await assertSucceeds(setDoc(doc(db, 'shares', 'S1'), {
      ownerId: ME.uid, memberIds: [ME.uid],
    }));
    await assertFails(getDoc(doc(as(STRANGER), 'shares', 'S1')));
  });
});
