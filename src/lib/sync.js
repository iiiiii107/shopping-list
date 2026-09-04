import { clone, storage, withDefaults } from './storage.js';

/* Sync, by way of a Google account.

   Signing in gives you your own shelf: your lists live under your own user id
   and the security rules make that the only place you can read or write.

   This is deliberately the *simple* half. Your own lists are one document,
   the way the cook book does it, because a shopping list is small and one
   person's edits never race another's. A list you share with somebody is a
   different animal entirely — one document per item, in its own collection —
   and lives in lib/live.js, because saving a whole blob is exactly how two
   people writing at once lose each other's items.

   The SDK is loaded on demand, so if sync is not configured — or you never
   sign in — none of it is downloaded. */

function readConfig() {
  const raw = import.meta.env.VITE_FIREBASE_CONFIG;
  if (!raw) return null;
  try {
    const config = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return config?.apiKey && config?.projectId ? config : null;
  } catch {
    console.warn('VITE_FIREBASE_CONFIG is not valid JSON — sync stays off.');
    return null;
  }
}

const config = readConfig();

/** True when the site was built with a Firebase project attached. */
export function syncConfigured() {
  return config !== null;
}

let sdk = null;

export async function firebase() {
  if (!config) throw new Error('Sync is not set up for this site.');
  if (sdk) return sdk;

  const [app, auth, firestore] = await Promise.all([
    import('firebase/app'),
    import('firebase/auth'),
    import('firebase/firestore'),
  ]);

  const instance = app.getApps().length ? app.getApp() : app.initializeApp(config);

  /* A persistent cache, which is not a nicety here: this app is used in a
     shop, and a shop is where the signal goes. Ticks made on a dead
     connection queue up and land when you walk out. */
  let db;
  try {
    db = firestore.initializeFirestore(instance, {
      localCache: firestore.persistentLocalCache({
        tabManager: firestore.persistentMultipleTabManager(),
      }),
    });
  } catch {
    db = firestore.getFirestore(instance);
  }

  sdk = { auth, firestore, db, authInstance: auth.getAuth(instance) };
  return sdk;
}

/* ---------- the account ---------- */

const account = new EventTarget();
let currentUser = null;
let watching = false;
let lastError = null;

/** The signed-in user, or null. Only ever id, name, email and photo. */
export function currentAccount() {
  return currentUser;
}

/** Why sync is not working, in words worth showing someone. Null when fine. */
export function syncError() {
  return lastError;
}

function describe(err) {
  const message = String(err?.message || err);
  if (/has not been used in project|is disabled/i.test(message)) {
    return 'The database has not been created yet — make it in the Firebase console, then reload.';
  }
  if (err?.code === 'permission-denied' || /permission/i.test(message)) {
    return 'The database refused the write — check the security rules have been published.';
  }
  if (err?.code === 'unavailable' || /offline|network/i.test(message)) {
    return 'No connection. Your changes are saved here and will go up when it is back.';
  }
  return 'Sync could not start. Your lists are safe in this browser.';
}

export function onAccountChange(fn) {
  account.addEventListener('change', fn);
  return () => account.removeEventListener('change', fn);
}

function announce() {
  account.dispatchEvent(new CustomEvent('change'));
}

/** Picks the session back up on load, so signing in is once per device. */
export async function restoreSession() {
  if (!config || watching) return;
  watching = true;

  const { auth, authInstance } = await firebase();

  // A redirect sign-in (phones, where popups get blocked) lands back here.
  try {
    await auth.getRedirectResult(authInstance);
  } catch (err) {
    console.warn('Sign-in did not complete.', err);
  }

  auth.onAuthStateChanged(authInstance, async (user) => {
    if (user) {
      currentUser = {
        uid: user.uid, name: user.displayName, email: user.email, photo: user.photoURL,
      };
      try {
        await storage.use(createCloudStorage(user.uid));
        lastError = null;
      } catch (err) {
        // Signed in, but the database will not have us. Stay on this browser
        // rather than losing the app — and say plainly what went wrong.
        console.warn('Sync could not start.', err);
        lastError = describe(err);
        await storage.use(null);
      }
    } else {
      currentUser = null;
      lastError = null;
      await storage.use(null);
    }
    announce();
  });
}

/** Google sign-in. Tries a popup, falls back to a redirect where popups die. */
export async function signIn() {
  if (!config) throw new Error('Sync is not set up for this site.');

  const { auth, authInstance } = await firebase();
  await restoreSession();

  const provider = new auth.GoogleAuthProvider();
  try {
    await auth.signInWithPopup(authInstance, provider);
  } catch (err) {
    const fallback = [
      'auth/popup-blocked',
      'auth/popup-closed-by-user',
      'auth/cancelled-popup-request',
      'auth/operation-not-supported-in-this-environment',
    ];
    if (fallback.includes(err?.code)) {
      await auth.signInWithRedirect(authInstance, provider);
      return;
    }
    throw err;
  }
}

export async function signOutOfSync() {
  const { auth, authInstance } = await firebase();
  await auth.signOut(authInstance);
}

/* ---------- your own lists ---------- */

/**
 * Everything you have not shared lives in one document at
 * `users/{uid}/app/shopping`. Not 'state' and not 'cookbook': all of these
 * apps share one Firebase project, and ten-minutes-to-spare already owns
 * app/state while the cook book owns app/cookbook. Writing to either would
 * silently overwrite another app on first sign-in.
 */
export function createCloudStorage(uid) {
  const listeners = new Set();
  let cached = null;
  let stop = null;
  let writing = 0;

  async function ref() {
    const { firestore, db } = await firebase();
    return { f: firestore, doc: firestore.doc(db, 'users', uid, 'app', 'shopping') };
  }

  function fanOut(next) {
    cached = next;
    listeners.forEach((fn) => fn(next));
  }

  async function watch() {
    if (stop) return;
    const { f, doc } = await ref();
    stop = f.onSnapshot(doc, (snap) => {
      // Our own write comes back as an echo; we already have that state.
      if (snap.metadata.hasPendingWrites || writing > 0 || !snap.exists()) return;
      fanOut(withDefaults(JSON.parse(snap.data().payload || '{}')));
    }, (err) => console.warn('Sync listener stopped.', err));
  }

  return {
    kind: 'cloud',

    async load() {
      const { f, doc } = await ref();
      const snap = await f.getDoc(doc);

      if (snap.exists()) {
        cached = withDefaults(JSON.parse(snap.data().payload || '{}'));
      } else {
        // First sign-in on this account: whatever is already in this browser
        // becomes the starting point, so nothing written is lost.
        cached = withDefaults(clone(await storage.local.load()));
        await this.save(cached);
      }

      watch();
      return cached;
    },

    async save(next) {
      cached = next;
      const { f, doc } = await ref();
      writing += 1;
      try {
        await f.setDoc(doc, {
          payload: JSON.stringify(next),
          updatedAt: f.serverTimestamp(),
        });
      } catch (err) {
        console.warn('Could not sync — it will go up when you are back online.', err);
      } finally {
        writing -= 1;
      }
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async exportAll() {
      return JSON.stringify(cached || {}, null, 2);
    },

    async importAll(json) {
      await this.save(withDefaults(JSON.parse(json)));
    },

    stopWatching() {
      stop?.();
      stop = null;
    },
  };
}
