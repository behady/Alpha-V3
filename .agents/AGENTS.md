# Project-Scoped Rules

- **Git Push Constraint**: Never run `git push`. Work on the current branch (`antigravity`), commit when a piece is finished, and stop there. Another reviewer checks every commit and pushes it; a push from here would go live without that review.
- **No package installs**: Do not run `npm install`, add dependencies, or delete `node_modules` (it is a link to a shared folder; deleting it breaks another copy of the project). If a new package seems needed, say so and stop.
- **Web app only**: Change files under `src/`, `public/` and `tests/`. Do not touch `android/`, `ios/`, `ios-web/`, `functions/`, `tts-service/`, `whatsapp-gateway/`, `firestore.rules` or `firestore.indexes.json`.
- **Two languages**: Every word a user sees has an Arabic and an English version (the screens use `language === "ar" ? "…" : "…"`). Arabic pages are right-to-left; check both directions.
- **Design direction (the owner's taste)**: luxury by restraint. Black/dark slab for the one hero area, everything else plain white and quiet, almost no colour. Big gap between title and body text. Never a grid of identical coloured tiles, never pie charts. Status colours (appointment states) are the only colour that carries meaning.
- **Yellow is a fill, not text**: `bg-accent` (yellow) carries dark text (`text-ink-on-accent`), never white. Never write yellow text on white; use `text-accent` (which is mapped to a dark gold) instead.
- **Use the theme colours**: `text-ink`, `text-ink-muted`, `bg-ink-slab`, `bg-accent` and the other tokens in `src/app/globals.css`. No hard-coded hex colours.
- **Firestore writes**: never send a field set to `undefined` (the save fails silently); leave optional fields out instead. Money and clinical notes are written through the API routes, never straight from the browser.
- **Keep it small**: one screen or one feature per commit, with a plain-English commit message saying what changed for the user.
- **Before committing**: run `npx tsc --noEmit` and fix every error.
