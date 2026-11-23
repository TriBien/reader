const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const PROGRESS_FILE = path.join(ROOT, "progress.json");
const MAX_JSON_BODY = 1024 * 1024;
const PORT = Number(process.env.PORT) || 3000;

let library = [];
let progress = {};
let progressWrites = Promise.resolve();

function chapterNumber(file) {
  const match = /^chapter_(\d+)\.txt$/i.exec(file);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function scanLibrary() {
  const names = fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "vi"));

  library = names.map((name, id) => {
    const files = fs
      .readdirSync(path.join(DATA_DIR, name))
      .filter((file) => /^chapter_\d+\.txt$/i.test(file))
      .sort((a, b) => chapterNumber(a) - chapterNumber(b) || a.localeCompare(b));

    return {
      id,
      key: name,
      name,
      chapterCount: files.length,
      chapters: files.map((file, chapterId) => ({
        id: chapterId,
        key: file,
        file,
        label: `Chương ${chapterNumber(file)}`,
      })),
    };
  });

  return library;
}

function toParagraphs(raw) {
  let text = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  const heading = /^(?:Chương|Cháp|Phần|Part)\s*\d+\s*/iu.exec(text);
  if (heading) text = text.slice(heading[0].length).trim();

  const sentences = [];
  const boundary = /[.!?…]+["'”’»]?(?=\s*[-–—"“«]?\p{Lu}|\s*$)/gu;
  let start = 0;
  let match;
  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const sentence = text.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  if (start < text.length) {
    const tail = text.slice(start).trim();
    if (tail) sentences.push(tail);
  }

  const paragraphs = [];
  let buffer = [];
  let length = 0;
  let previousWasDialogue = false;

  for (const sentence of sentences) {
    const isDialogue = /^[-–—]/.test(sentence);
    if (
      buffer.length &&
      ((isDialogue && !previousWasDialogue) || length > 420 || buffer.length >= 5)
    ) {
      paragraphs.push(buffer.join(" "));
      buffer = [];
      length = 0;
    }
    buffer.push(sentence);
    length += sentence.length;
    previousWasDialogue = isDialogue;
  }
  if (buffer.length) paragraphs.push(buffer.join(" "));

  return paragraphs;
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function sendFile(response, file, contentType) {
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    });
    response.end(data);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function isRecordKey(key) {
  if (typeof key !== "string") return false;
  try {
    const parts = JSON.parse(key);
    return (
      Array.isArray(parts) &&
      parts.length === 2 &&
      parts.every((part) => typeof part === "string")
    );
  } catch {
    return false;
  }
}

function sanitizeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.ratio !== "number" || !Number.isFinite(value.ratio)) return null;
  const record = { ratio: Math.min(1, Math.max(0, value.ratio)) };
  if (typeof value.at === "number" && Number.isFinite(value.at)) record.at = value.at;
  if (typeof value.done === "boolean") record.done = value.done;
  return record;
}

function sanitizeRecords(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    const record = isRecordKey(key) ? sanitizeRecord(value) : null;
    if (record) result[key] = record;
  }
  return result;
}

function loadProgress() {
  try {
    progress = sanitizeRecords(JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"))) || {};
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not read ${PROGRESS_FILE}: ${error.message}`);
    }
    progress = {};
  }
}

function persistProgress() {
  const snapshot = `${JSON.stringify(progress, null, 2)}\n`;
  const temporary = `${PROGRESS_FILE}.tmp`;
  const write = async () => {
    await fs.promises.writeFile(temporary, snapshot);
    await fs.promises.rename(temporary, PROGRESS_FILE);
  };
  progressWrites = progressWrites.catch(() => {}).then(write);
  return progressWrites;
}

function removeProgressFor(storyName, chapterKey) {
  let changed = false;
  for (const key of Object.keys(progress)) {
    let parts;
    try {
      parts = JSON.parse(key);
    } catch {
      continue;
    }
    if (
      Array.isArray(parts) &&
      parts[0] === storyName &&
      (chapterKey === undefined || parts[1] === chapterKey)
    ) {
      delete progress[key];
      changed = true;
    }
  }
  return changed ? persistProgress() : Promise.resolve();
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BODY) {
      const error = new Error("Request body too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);

  if (pathname === "/api/library") {
    sendJson(response, 200, { stories: scanLibrary() });
    return;
  }

  const chapterRoute = /^\/api\/chapter\/(\d+)\/(\d+)$/.exec(pathname);
  if (chapterRoute) {
    const story = library[Number(chapterRoute[1])];
    const chapter = story && story.chapters[Number(chapterRoute[2])];
    if (!chapter) {
      sendJson(response, 404, { error: "Chapter not found" });
      return;
    }
    if (request.method !== "GET" && request.method !== "DELETE") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    const file = path.join(DATA_DIR, story.name, chapter.file);
    if (request.method === "DELETE") {
        fs.unlink(file, (error) => {
          if (error) {
            sendJson(response, 500, { error: "Could not delete chapter" });
            return;
          }
          removeProgressFor(story.name, chapter.file)
            .catch((writeError) => console.error(`Could not save ${PROGRESS_FILE}: ${writeError.message}`))
            .finally(() => {
              scanLibrary();
              sendJson(response, 200, { ok: true });
            });
        });
      return;
    }

    fs.readFile(file, "utf8", (error, raw) => {
      if (error) {
        sendJson(response, 404, { error: "Chapter not found" });
        return;
      }
      sendJson(response, 200, {
        storyId: story.id,
        storyKey: story.key,
        storyName: story.name,
        chapterId: chapter.id,
        chapterKey: chapter.key,
        label: chapter.label,
        paragraphs: toParagraphs(raw),
      });
    });
    return;
  }

  const storyRoute = /^\/api\/story\/(\d+)$/.exec(pathname);
  if (storyRoute) {
    const story = library[Number(storyRoute[1])];
    if (!story) {
      sendJson(response, 404, { error: "Story not found" });
      return;
    }
    if (request.method !== "DELETE") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    fs.rm(path.join(DATA_DIR, story.name), { recursive: true, force: true }, (error) => {
      if (error) {
        sendJson(response, 500, { error: "Could not delete story" });
        return;
      }
      removeProgressFor(story.name)
        .catch((writeError) => console.error(`Could not save ${PROGRESS_FILE}: ${writeError.message}`))
        .finally(() => {
          scanLibrary();
          sendJson(response, 200, { ok: true });
        });
    });
    return;
  }

  if (pathname === "/api/progress") {
    if (request.method === "GET") {
      sendJson(response, 200, { records: progress });
      return;
    }
    if (request.method === "PUT" || request.method === "DELETE") {
      try {
        const body = await readJsonBody(request);
        if (request.method === "PUT") {
          const updates = sanitizeRecords(body && body.records);
          if (
            !updates ||
            Object.keys(updates).length !== Object.keys((body && body.records) || {}).length
          ) {
            sendJson(response, 400, { error: "Invalid progress payload" });
            return;
          }
          if (body.onlyIfEmpty === true && Object.keys(progress).length) {
            sendJson(response, 409, { error: "Progress already exists", records: progress });
            return;
          }
          Object.assign(progress, updates);
        } else {
          const keys = body && body.keys;
          if (!Array.isArray(keys) || !keys.every(isRecordKey)) {
            sendJson(response, 400, { error: "Invalid progress keys" });
            return;
          }
          for (const key of keys) delete progress[key];
        }
        await persistProgress();
        sendJson(response, 200, { ok: true, records: progress });
      } catch (error) {
        sendJson(response, error.status || 500, {
          error: error.message || "Could not save progress",
        });
      }
      return;
    }
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "Unknown endpoint" });
    return;
  }

  const publicFile = pathname === "/" ? "index.html" : pathname.slice(1);
  const extension = path.extname(publicFile);
  if (!/^[\w./-]+$/.test(publicFile) || !MIME[extension]) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  sendFile(response, path.join(PUBLIC_DIR, publicFile), MIME[extension]);
});

loadProgress();
scanLibrary();
server.listen(PORT, () => {
  console.log(`Reader running at http://localhost:${PORT}`);
  console.log(`${library.length} stories loaded from ${DATA_DIR}`);
  console.log(`${Object.keys(progress).length} progress records loaded from ${PROGRESS_FILE}`);
});
