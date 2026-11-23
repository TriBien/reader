# Story Reader

A mobile-first, dependency-free web reader for local story text files. The server scans a `data/` directory, exposes a small JSON API, and serves a Vietnamese-language single-page UI.

## Requirements

- Node.js 18+ (uses `node:http`, `fs.rm`, Unicode property escapes)
- No npm dependencies to install

## Run

```bash
npm start
```

Then open <http://localhost:3000>. Set `PORT` to use a different port:

```bash
PORT=8080 npm start
```

## Adding stories

Stories live in `data/`, one directory per story; chapters are plain `.txt` files inside it:

```
data/
  My story/
    chapter_1.txt
    chapter_2.txt
    chapter_10.txt
```

- Only files named `chapter_<number>.txt` (case-insensitive) are listed, ordered by number.
- Story names are sorted by Vietnamese collation.
- Text is normalized (BOM/CRLF/control chars removed, whitespace collapsed), an optional leading `Chương|Cháp|Phần|Part <n>` heading is stripped, and sentences are regrouped into paragraphs by length and dialogue boundaries.
- The library is scanned at startup and after a deletion; restart the server (or reload `/api/library`) after adding files externally.

## Features

- Library search (Vietnamese-insensitive), sorting by chapter count ascending by default or by name, and an all / fully read filter; recent/continue reading list
- Chapter list with read/unread and progress hints; random-story picker
- Distraction-free reader with reading progress bar and automatic scroll progress tracking (saved at 92% as read)
- Paragraphs containing `lồn`, `bướm`, or `âm đạo` (any letter case) are highlighted and the terms marked in the reader
- Settings: light/sepia/dark themes, font size, line height
- Per-browser display settings in `localStorage` (`reader.settings.v1`)
- Reading history and progress shared across browsers in a server-side JSON file
- Delete a chapter or an entire story from the UI — this removes the underlying files from `data/` permanently and prunes their progress records

## Reading progress storage

Progress is kept in `progress.json` at the project root (created on the first update). Each record is keyed by `JSON.stringify([storyName, chapterFile])` and stores `ratio` (0–1), `at` (last-read timestamp in ms), and `done`. The `at` values drive the "Tiếp tục đọc" history list.

Writes are atomic (temporary file plus rename) and serialized. Existing `reader.progress.v2` data in `localStorage` is imported once on first load, then removed from browser storage. Deleting a story or chapter also removes its records.

## API

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/library` | All stories with their chapters |
| `GET` | `/api/chapter/:storyId/:chapterId` | Chapter metadata and formatted paragraphs |
| `DELETE` | `/api/chapter/:storyId/:chapterId` | Delete a chapter file |
| `DELETE` | `/api/story/:storyId` | Delete a story directory |
| `GET` | `/api/progress` | All progress records |
| `PUT` | `/api/progress` | Merge records: `{"records":{"[\"Story\",\"chapter_1.txt\"]":{"ratio":0.5,"at":1700000000000,"done":false}}}`. Optional `onlyIfEmpty: true` imports only when no records exist. |
| `DELETE` | `/api/progress` | Remove records: `{"keys":["[\"Story\",\"chapter_1.txt\"]"]}` |

IDs are positional indexes into the scanned library, so they can change when stories or chapters are added/removed.

## Project structure

```
server.js          HTTP server, library scanning, text formatting, API
public/index.html  App shell
public/app.js      Hash-router UI, settings, progress, API calls
public/styles.css  Responsive light/sepia/dark styles
progress.json      Reading history/progress (created automatically)
data/              Story directories with chapter_*.txt files
```

The server has no authentication or write/upload API. Do not expose it directly to untrusted networks, since the delete endpoints modify local files.
