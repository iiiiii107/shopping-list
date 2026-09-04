# Shopping List

Shared shopping lists on a table — a companion to the [Cook Book](https://github.com/iiiiii107/cook-book).

Sheets of paper lie on a wooden table. Each is a list: a name, an optional
subtitle, date and shop, then things to buy under headings you can add or
leave out entirely. Everything is edited where it sits on the paper.

The point of it is the last part, which is still being built: two or three
people writing on one list at the same time, from different phones in
different aisles.

## Running it

```
npm install
npm run dev
```

Nothing has to be configured. Lists live in the browser until you sign in.

## The shape of it

- `src/lib/list.js` — the model. Order is a float and sections are labels, both
  so that two people editing at once never have to renumber each other.
- `src/lib/item.js` — reading a line like `250 ml milk` into parts. Lifted from
  the cook book's `recipe.js`; keep the two diffable.
- `src/lib/units.js`, `aisles.js` — the arithmetic that turns 100 ml and 150 ml
  into 250 ml. Also lifted, also worth keeping diffable.
- `src/lib/storage.js` — one facade, one backend at a time: this browser when
  signed out, Firestore when signed in.
- `src/lib/md.js` — lists out as markdown and back in. Out is easy; in is
  deliberately forgiving, because a list arrives from a friend's notes app as
  often as from this one.
- `src/lib/pages.js` — a long list laid onto A4 sheets by CSS columns, so the
  browser decides the breaks and no node ever moves.
- `src/views/` — one file per screen.

## Tests

```
npm test
```

`src/views/views.test.js` renders every screen and clicks every button. It
exists because in the cook book the unit tests were green while a Done button
threw a ReferenceError on every click — an exception inside a click handler
never comes back out of `.click()`, so the sweep listens for `window.onerror`
instead. Sabotage a handler and watch it fail before trusting it.

## Security rules

`firestore.rules` is the whole project's rules file, not just this app's — the
same Firebase project hosts the cookbook and two other apps, so the file is
kept identical in both repos and published from either.

```
npm run test:rules
```

runs them against the real rules engine in the Firestore emulator. It needs a
JVM; `brew install openjdk` is enough, and the script puts it on PATH itself
rather than asking you to edit your shell profile.

These are worth running before publishing. Writing them turned up four real
holes in rules that looked right, including a recursive wildcard that silently
overrode every check above it.
