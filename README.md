# Vocab

A fast, phone-friendly flashcard app for studying English vocabulary.

**Live:** https://willagio.github.io/vocab-web/

## Features

- **Home** — a weighted-random flashcard feed. Recently-added words come up more
  often, but every word keeps a non-zero chance so older words still resurface.
  Tap a card (or press `Space`) to reveal the meaning and an example sentence;
  `→` / `Enter` draws the next card.
- **By date** — browse every word grouped by the day it was added.
- **Dictionary** — the full A–Z list with search; tap a word to expand its
  definition and example.

Each card shows the word, a beginner-friendly pronunciation, an English and
Korean definition, and an example sentence with its Korean translation.

## Tech

Plain HTML, CSS, and JavaScript — no build step, no dependencies. The word data
is split into a lightweight manifest plus per-day shards that load on demand, so
the app stays fast even with tens of thousands of words.

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```
