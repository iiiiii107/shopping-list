import { firebase, currentAccount } from './sync.js';

/* Who else has this list open.

   The useful half of this is not the faces at the top — it is being able to
   answer "has she got the milk yet?" without ringing anybody. The faces just
   tell you whether the answer is going to arrive.

   A heartbeat rather than a connection: a write every half minute while the
   tab is visible, and anyone whose last one is over ninety seconds old is
   treated as gone. That survives a phone going into a pocket, a signal
   dropping in a chest freezer aisle, and a browser closed without warning —
   none of which fire anything you can listen for. It costs about 120 writes
   an hour per person against a free tier of 20,000 a day. */

const BEAT = 30_000;
const STALE = 90_000;

/**
 * Say that you are here, and hear about everyone else who is.
 * @returns {() => void} the way to stop, which also removes you
 */
export async function watchPresence(listId, onPeople) {
  const me = currentAccount();
  if (!me) return () => {};

  const { firestore: f, db } = await firebase();
  const here = f.collection(f.doc(db, 'lists', listId), 'presence');
  const mine = f.doc(here, me.uid);

  let timer = null;
  let stopped = false;

  const beat = () => {
    if (stopped || document.visibilityState !== 'visible') return;
    f.setDoc(mine, {
      name: me.name || me.email || 'Someone',
      email: me.email || '',
      photo: me.photo || '',
      at: Date.now(),
    }).catch(() => {
      // Not being able to say you are here is not worth interrupting a shop.
    });
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') beat();
  };
  document.addEventListener('visibilitychange', onVisible);

  beat();
  timer = setInterval(beat, BEAT);

  const stopWatch = f.onSnapshot(here, (snap) => {
    const now = Date.now();
    const people = snap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((p) => p.uid !== me.uid && now - (p.at || 0) < STALE)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    onPeople(people);
  }, () => {});

  /* Stale rows are swept by whoever is looking, rather than by anything
     scheduled. A row nobody ever sees does no harm, and there is no server
     here to run a cleanup on. */
  const sweep = setInterval(async () => {
    if (stopped) return;
    const snap = await f.getDocs(here).catch(() => null);
    if (!snap) return;
    const now = Date.now();
    for (const d of snap.docs) {
      // Only ever your own row: the rules say so, and they are right to.
      if (d.id === me.uid && now - (d.data().at || 0) > STALE) {
        f.deleteDoc(d.ref).catch(() => {});
      }
    }
  }, STALE);

  return () => {
    stopped = true;
    clearInterval(timer);
    clearInterval(sweep);
    document.removeEventListener('visibilitychange', onVisible);
    stopWatch();
    f.deleteDoc(mine).catch(() => {});
  };
}
