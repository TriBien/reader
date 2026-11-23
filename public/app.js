const view = document.getElementById("view");
const settingsPanel = document.getElementById("settings");
const confirmPanel = document.getElementById("confirm");
const toast = document.getElementById("toast");

const KEYS = {
  legacyProgress: "reader.progress.v2",
  settings: "reader.settings.v1",
};

const THEME_COLORS = {
  light: "#f7f5f2",
  sepia: "#f3e7d3",
  dark: "#14161a",
};

const HIGHLIGHT_TERMS = ["lồn", "bướm", "âm đạo"];
const HIGHLIGHT_RE = new RegExp(
  `(${HIGHLIGHT_TERMS.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
  "giu"
);

const ICONS = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.34 1.88l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.7 1.7 0 00-1.88-.34 1.7 1.7 0 00-1.03 1.56V21a2 2 0 11-4 0v-.09A1.7 1.7 0 008.9 19.4a1.7 1.7 0 00-1.88.34l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.7 1.7 0 00.34-1.88 1.7 1.7 0 00-1.56-1.03H3a2 2 0 110-4h.09A1.7 1.7 0 004.6 8.9a1.7 1.7 0 00-.34-1.88l-.06-.06a2 2 0 112.83-2.83l.06.06a1.7 1.7 0 001.88.34H9a1.7 1.7 0 001.03-1.56V3a2 2 0 114 0v.09a1.7 1.7 0 001.03 1.56 1.7 1.7 0 001.88-.34l.06-.06a2 2 0 112.83 2.83l-.06.06a1.7 1.7 0 00-.34 1.88V9a1.7 1.7 0 001.56 1.03H21a2 2 0 110 4h-.09a1.7 1.7 0 00-1.51 1.03z"/></svg>',
  search:
    '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  shuffle:
    '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" stroke="none"/></svg>',
};

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

function sendProgress(method, payload) {
  return fetch("/api/progress", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: method === "PUT",
  });
}

function persistProgress(key, value) {
  sendProgress("PUT", { records: { [key]: value } }).catch(() => {});
}

function removeProgress(keys) {
  if (!keys.length) return;
  sendProgress("DELETE", { keys }).catch(() => {});
}

let progress = {};
let settings = Object.assign(
  { theme: "light", size: 18, leading: 1.75 },
  load(KEYS.settings, {})
);
let library = [];
let chapter = null;
let query = "";
let sortBy = "chapters";
let libraryFilter = "all";
let scrollQueued = false;
let lastProgressWrite = 0;
let toastTimer = null;
let confirmHandler = null;

const numberFormat = new Intl.NumberFormat("vi-VN");
const esc = (value) =>
  String(value).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
const fold = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
function hasHighlightTerm(text) {
  const lower = String(text).toLowerCase();
  return HIGHLIGHT_TERMS.some((term) => lower.includes(term));
}
function highlightTerms(text) {
  return esc(text).replace(HIGHLIGHT_RE, '<mark class="term-highlight">$1</mark>');
}
const recordKey = (storyKey, chapterKey) => JSON.stringify([storyKey, chapterKey]);
const record = (storyKey, chapterKey) => progress[recordKey(storyKey, chapterKey)];

function applySettings() {
  document.documentElement.dataset.theme = settings.theme;
  document.documentElement.style.setProperty("--reader-size", `${settings.size}px`);
  document.documentElement.style.setProperty("--reader-leading", String(settings.leading));
  document.querySelector('meta[name="theme-color"]').content =
    THEME_COLORS[settings.theme] || THEME_COLORS.light;
  save(KEYS.settings, settings);
}

function navigate(path) {
  location.hash = `#/${path}`;
}

function currentRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/");
  if (parts[0] === "story" && Number.isInteger(Number(parts[1]))) {
    return { name: "story", sid: Number(parts[1]) };
  }
  if (
    parts[0] === "read" &&
    Number.isInteger(Number(parts[1])) &&
    Number.isInteger(Number(parts[2]))
  ) {
    return { name: "read", sid: Number(parts[1]), cid: Number(parts[2]) };
  }
  return { name: "library" };
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 1800);
}

function showConfirm({ title, message, onConfirm }) {
  confirmHandler = onConfirm;
  confirmPanel.innerHTML = `<div class="confirm__backdrop" data-action="confirm-no"></div>
    <div class="confirm__box" role="alertdialog" aria-modal="true">
      <strong>${esc(title)}</strong>
      <p>${esc(message)}</p>
      <div class="confirm__actions">
        <button class="confirm__btn" data-action="confirm-no">Hủy</button>
        <button class="confirm__btn confirm__btn--danger" data-action="confirm-yes">Xóa</button>
      </div>
    </div>`;
  confirmPanel.hidden = false;
}

function closeConfirm() {
  confirmPanel.hidden = true;
  confirmHandler = null;
}

function topbar(title, subtitle, actions = "") {
  return `<header class="topbar">
    ${actions}
    <div class="topbar__title">${title}${subtitle ? `<small>${esc(subtitle)}</small>` : ""}</div>
    <button class="icon-btn" data-action="random" aria-label="Đọc ngẫu nhiên">${ICONS.shuffle}</button>
    <button class="icon-btn" data-action="settings" aria-label="Cài đặt">${ICONS.settings}</button>
  </header>`;
}

function backButton(route) {
  return `<button class="icon-btn" data-action="navigate" data-path="${route}" aria-label="Quay lại">${ICONS.back}</button>`;
}

function countReadChapters(story) {
  return story.chapters.filter((item) => record(story.key, item.key)?.done).length;
}

function isStoryRead(story) {
  return story.chapterCount > 0 && countReadChapters(story) === story.chapterCount;
}

function storyProgress(story) {
  if (!story.chapterCount) return 0;
  return countReadChapters(story) / story.chapterCount;
}

function renderLibrary() {
  chapter = null;
  document.title = "Thư viện truyện";
  view.innerHTML = `<div class="screen">
    ${topbar("Thư viện truyện", "")}
    <div class="content">
      <div class="search-wrap">
        ${ICONS.search}
        <input id="search" class="search" type="search" placeholder="Tìm truyện..." value="${esc(query)}" autocomplete="off" />
        ${query ? '<button class="search-clear" data-action="clear-search" aria-label="Xóa">&times;</button>' : ""}
      </div>
      <button class="random-btn" data-action="random">${ICONS.shuffle}<span>Đọc truyện ngẫu nhiên</span></button>
      <div id="library-results"></div>
    </div>
  </div>`;

  document.getElementById("search").addEventListener("input", (event) => {
    query = event.target.value;
    renderLibraryResults();
    const clear = view.querySelector(".search-clear");
    if (query && !clear) {
      document.querySelector(".search-wrap").insertAdjacentHTML(
        "beforeend",
        '<button class="search-clear" data-action="clear-search" aria-label="Xóa">&times;</button>'
      );
    } else if (!query && clear) {
      clear.remove();
    }
  });

  renderLibraryResults();
}

function renderLibraryResults() {
  const target = document.getElementById("library-results");
  if (!target) return;

  const normalized = fold(query.trim());
  const matches = library.filter(
    (story) =>
      (!normalized || fold(story.name).includes(normalized)) &&
      (libraryFilter === "all" || (libraryFilter === "done" && isStoryRead(story)))
  );
  const sorted = [...matches].sort((a, b) =>
    sortBy === "chapters"
      ? a.chapterCount - b.chapterCount || a.name.localeCompare(b.name, "vi")
      : a.name.localeCompare(b.name, "vi")
  );

  const recent = Object.entries(progress)
    .filter(([, value]) => value && value.ratio > 0 && value.ratio < 0.98 && value.at)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 3)
    .map(([key, value]) => {
      let parsed;
      try {
        parsed = JSON.parse(key);
      } catch {
        return null;
      }
      const story = library.find((item) => item.key === parsed[0]);
      const chapterItem = story?.chapters.find((item) => item.key === parsed[1]);
      return story && chapterItem ? { story, chapterItem, value } : null;
    })
    .filter(Boolean);

  const totalChapters = library.reduce((sum, story) => sum + story.chapterCount, 0);
  const readStories = library.filter(isStoryRead).length;

  let html = `<div class="stats">
    <span>${numberFormat.format(library.length)} truyện</span>
    <span>${numberFormat.format(totalChapters)} chương</span>
    <span>${numberFormat.format(readStories)} đã đọc</span>
  </div>
  <div class="setting-row" style="padding-top:4px">
    <span class="setting-row__label">Sắp xếp</span>
    <div class="themes">
      <button class="theme-chip ${sortBy === "name" ? "is-active" : ""}" data-action="sort" data-sort="name">Tên</button>
      <button class="theme-chip ${sortBy === "chapters" ? "is-active" : ""}" data-action="sort" data-sort="chapters">Số chương</button>
    </div>
  </div>
  <div class="setting-row" style="padding-top:4px">
    <span class="setting-row__label">Trạng thái</span>
    <div class="themes">
      <button class="theme-chip ${libraryFilter === "all" ? "is-active" : ""}" data-action="filter" data-filter="all">Tất cả</button>
      <button class="theme-chip ${libraryFilter === "done" ? "is-active" : ""}" data-action="filter" data-filter="done">Đã đọc</button>
    </div>
  </div>`;

  if (recent.length && !normalized && libraryFilter === "all") {
    html += `<div class="section-title">Tiếp tục đọc</div><div class="story-list">`;
    for (const item of recent) {
      html += storyCard(item.story, {
        extraClass: "resume-card",
        badge: item.chapterItem.label.replace("Chương ", "Ch."),
        meta: `Đọc tiếp · ${Math.round(item.value.ratio * 100)}%`,
        progress: item.value.ratio,
        path: `read/${item.story.id}/${item.chapterItem.id}`,
      });
    }
    html += `</div>`;
  }

  const sectionTitle =
    libraryFilter === "done"
      ? `Đã đọc (${sorted.length})`
      : normalized
        ? `Kết quả (${sorted.length})`
        : "Tất cả truyện";
  html += `<div class="section-title">${sectionTitle}</div>`;

  if (!sorted.length) {
    const emptyMessage =
      libraryFilter === "done"
        ? "Bạn chưa đọc xong truyện nào"
        : "Không tìm thấy truyện";
    const emptyHint =
      libraryFilter === "all" ? "Thử một từ khóa khác." : "Chọn trạng thái khác để xem thêm.";
    html += `<div class="empty"><strong>${emptyMessage}</strong>${emptyHint}</div>`;
  } else {
    html += `<div class="story-list">`;
    for (const story of sorted) {
      const value = storyProgress(story);
      const readCount = countReadChapters(story);
      const meta =
        libraryFilter === "done"
          ? `${numberFormat.format(story.chapterCount)} chương · Đã đọc xong`
          : `${numberFormat.format(story.chapterCount)} chương${readCount ? ` · ${readCount} đã đọc` : ""}`;
      html += storyCard(story, {
        badge: String(story.chapterCount),
        meta,
        progress: value,
        path: `story/${story.id}`,
      });
    }
    html += `</div>`;
  }

  target.innerHTML = html;
}

function storyCard(story, options) {
  return `<div class="story-card ${options.extraClass || ""}">
    <button class="story-card__main" data-action="navigate" data-path="${options.path}">
      <div class="story-card__body">
        <div class="story-card__name">${esc(story.name)}</div>
        <div class="story-card__meta">${esc(options.meta)}</div>
        ${options.progress > 0 ? `<div class="progress-track"><div class="progress-fill" style="width:${Math.round(options.progress * 100)}%"></div></div>` : ""}
      </div>
      <div class="story-card__badge">${esc(options.badge)}</div>
    </button>
    <button class="story-card__delete icon-btn" data-action="delete-story" data-sid="${story.id}" aria-label="Xóa truyện">${ICONS.trash}</button>
  </div>`;
}

function renderStory(sid) {
  const story = library[sid];
  if (!story) {
    navigate("");
    return;
  }
  chapter = null;
  document.title = story.name;

  const readCount = story.chapters.filter((item) => record(story.key, item.key)?.done).length;
  let html = `<div class="screen">
    ${topbar(esc(story.name), story.chapterCount ? `${story.chapterCount} chương` : "Chưa có chương", backButton(""))}
    <div class="content">`;

  if (!story.chapters.length) {
    html += `<div class="empty"><strong>Chưa có chương nào</strong>Thư mục truyện này đang trống.</div>`;
  } else {
    const resume = story.chapters.find((item) => {
      const value = record(story.key, item.key);
      return value && value.ratio > 0 && value.ratio < 0.98;
    });
    if (resume) {
      const resumeValue = record(story.key, resume.key);
      html += storyCard(story, {
        extraClass: "resume-card",
        badge: "Đọc",
        meta: `Tiếp tục ${resume.label} · ${Math.round(resumeValue.ratio * 100)}%`,
        progress: resumeValue.ratio,
        path: `read/${sid}/${resume.id}`,
      });
    }

    html += `<div class="section-title">Danh sách chương · ${readCount}/${story.chapterCount} đã đọc</div>
      <div class="chapter-list">`;

    for (const item of story.chapters) {
      const value = record(story.key, item.key);
      const hint = value?.done
        ? "Đã đọc"
        : value?.ratio > 0
          ? `Đọc dở ${Math.round(value.ratio * 100)}%`
          : story.chapters.length > 1
            ? item.label
            : "Bắt đầu đọc";
      html += `<div class="chapter-row ${value?.done ? "is-read" : ""}">
        <button class="chapter-row__main" data-action="navigate" data-path="read/${sid}/${item.id}">
          <span class="chapter-row__index">${item.label.replace("Chương ", "")}</span>
          <span class="chapter-row__label">${esc(item.label)}</span>
          <span class="chapter-row__hint">${hint}</span>
        </button>
        <button class="chapter-row__delete icon-btn" data-action="delete-chapter" data-sid="${sid}" data-cid="${item.id}" aria-label="Xóa chương">${ICONS.trash}</button>
      </div>`;
    }
    html += `</div>`;
  }

  html += `</div></div>`;
  view.innerHTML = html;
}

async function renderReader(sid, cid) {
  const story = library[sid];
  if (!story || !story.chapters[cid]) {
    navigate(`story/${sid}`);
    return;
  }

  document.title = `${story.chapters[cid].label} · ${story.name}`;
  view.innerHTML = `<div class="screen">
    <header class="topbar reader-topbar">
      ${backButton(`story/${sid}`)}
      <div class="topbar__title">${esc(story.name)}<small>Đang tải...</small></div>
      <button class="icon-btn" data-action="settings" aria-label="Cài đặt">${ICONS.settings}</button>
    </header>
    <div class="read-progress"><div class="read-progress__fill" id="read-fill"></div></div>
    <div class="reader-body"><p>Đang tải chương...</p></div>
  </div>`;

  let data;
  try {
    const response = await fetch(`/api/chapter/${sid}/${cid}`);
    if (!response.ok) throw new Error("chapter request failed");
    data = await response.json();
  } catch {
    view.innerHTML = `<div class="screen">
      ${topbar("Lỗi", "", backButton(`story/${sid}`))}
      <div class="content"><div class="empty"><strong>Không tải được chương</strong>Vui lòng thử lại.</div></div>
    </div>`;
    return;
  }

  if (currentRoute().name !== "read" || currentRoute().sid !== sid || currentRoute().cid !== cid) {
    return;
  }
  chapter = data;

  const previous = cid > 0;
  const next = story.chapters[cid + 1] ? true : false;

  view.innerHTML = `<div class="screen reader-screen">
    <header class="topbar reader-topbar">
      ${backButton(`story/${sid}`)}
      <div class="topbar__title">${esc(story.name)}<small>${esc(data.label)}</small></div>
      <button class="icon-btn" data-action="settings" aria-label="Cài đặt">${ICONS.settings}</button>
    </header>
    <div class="read-progress"><div class="read-progress__fill" id="read-fill"></div></div>
    <article class="reader-body" id="reader-body">
      ${data.paragraphs
        .map(
          (paragraph) =>
            `<p${hasHighlightTerm(paragraph) ? ' class="has-highlight"' : ""}>${highlightTerms(paragraph)}</p>`
        )
        .join("")}
      ${data.paragraphs.length ? "" : "<p>Chương này hiện chưa có nội dung.</p>"}
    </article>
    <button class="fab-top" data-action="top" aria-label="Lên đầu">${ICONS.up}</button>
    <footer class="reader-footer">
      <button class="nav-btn" data-action="chapter-step" data-step="-1" ${previous ? "" : "disabled"}>← Chương trước</button>
      <button class="nav-btn" data-action="chapter-step" data-step="1" ${next ? "" : "disabled"}>Chương sau →</button>
    </footer>
  </div>`;

  restoreScroll();
  updateReadProgress();
}

function restoreScroll() {
  const value = record(chapter.storyKey, chapter.chapterKey);
  const ratio = value?.done ? 0 : value?.ratio || 0;
  requestAnimationFrame(() => {
    const max = document.scrollingElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.max(0, max * ratio));
    updateReadProgress();
  });
}

function updateReadProgress() {
  if (!chapter) return;
  const { storyKey, chapterKey } = chapter;
  const fill = document.getElementById("read-fill");
  if (!fill) return;
  const max = document.scrollingElement.scrollHeight - window.innerHeight;
  const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 1;
  fill.style.width = `${ratio * 100}%`;

  const now = Date.now();
  if (scrollQueued || now - lastProgressWrite < 400) return;
  scrollQueued = true;
  setTimeout(() => {
    scrollQueued = false;
    lastProgressWrite = Date.now();
    const key = recordKey(storyKey, chapterKey);
    const current = record(storyKey, chapterKey) || {};
    current.ratio = ratio;
    current.at = Date.now();
    if (ratio > 0.92) current.done = true;
    progress[key] = current;
    persistProgress(key, current);
  }, 120);
}

function renderSettings() {
  const themes = [
    { id: "light", label: "Sáng", color: "#f7f5f2" },
    { id: "sepia", label: "Da lươn", color: "#f3e7d3" },
    { id: "dark", label: "Tối", color: "#14161a" },
  ];
  settingsPanel.innerHTML = `<div class="sheet__head">
    <span>Cài đặt đọc</span>
    <button class="icon-btn" data-action="close-settings" aria-label="Đóng">✕</button>
  </div>
  <div class="setting-row">
    <span class="setting-row__label">Chủ đề</span>
    <div class="themes">
      ${themes
        .map(
          (theme) => `<button class="theme-chip ${settings.theme === theme.id ? "is-active" : ""}" data-action="theme" data-theme="${theme.id}">
            <span class="theme-dot" style="background:${theme.color}"></span>${theme.label}</button>`
        )
        .join("")}
    </div>
  </div>
  <div class="setting-row">
    <span class="setting-row__label">Cỡ chữ</span>
    <div class="stepper">
      <button data-action="size" data-delta="-1" aria-label="Giảm chữ">−</button>
      <span>${settings.size}px</span>
      <button data-action="size" data-delta="1" aria-label="Tăng chữ">+</button>
    </div>
  </div>
  <div class="setting-row">
    <span class="setting-row__label">Giãn dòng</span>
    <div class="stepper">
      <button data-action="leading" data-delta="-0.1" aria-label="Giảm giãn dòng">−</button>
      <span>${settings.leading.toFixed(2)}</span>
      <button data-action="leading" data-delta="0.1" aria-label="Tăng giãn dòng">+</button>
    </div>
  </div>`;
  settingsPanel.hidden = false;
}

function pickRandom() {
  const candidates = library.filter((story) => story.chapterCount > 0);
  if (!candidates.length) {
    showToast("Không có chương nào để đọc");
    return;
  }

  const unread = candidates.filter(
    (story) => !story.chapters.some((item) => record(story.key, item.key)?.done)
  );
  const pool = unread.length ? unread : candidates;
  const story = pool[Math.floor(Math.random() * pool.length)];
  const chapterItem =
    story.chapters.find((item) => {
      const value = record(story.key, item.key);
      return value && value.ratio > 0 && value.ratio < 0.98;
    }) ||
    story.chapters.find((item) => !record(story.key, item.key)?.done) ||
    story.chapters[0];

  navigate(`read/${story.id}/${chapterItem.id}`);
}

async function refreshLibrary() {
  const response = await fetch("/api/library");
  const data = await response.json();
  library = data.stories;
}

function forgetProgress(storyKey, chapterKey) {
  const keys = Object.keys(progress).filter((key) => {
    let parsed;
    try {
      parsed = JSON.parse(key);
    } catch {
      return false;
    }
    return (
      Array.isArray(parsed) &&
      parsed[0] === storyKey &&
      (!chapterKey || parsed[1] === chapterKey)
    );
  });
  for (const key of keys) delete progress[key];
  removeProgress(keys);
}

function deleteStory(sid) {
  const story = library[sid];
  if (!story) return;
  showConfirm({
    title: "Xóa truyện?",
    message: `“${story.name}” và toàn bộ ${story.chapterCount} chương sẽ bị xóa vĩnh viễn.`,
    onConfirm: async () => {
      const response = await fetch(`/api/story/${sid}`, { method: "DELETE" });
      if (!response.ok) {
        showToast("Không thể xóa truyện");
        return;
      }
      forgetProgress(story.key);
      await refreshLibrary();
      if (currentRoute().name === "library") render();
      else navigate("");
      showToast("Đã xóa truyện");
    },
  });
}

function deleteChapter(sid, cid) {
  const story = library[sid];
  const chapterItem = story?.chapters[cid];
  if (!chapterItem) return;
  showConfirm({
    title: "Xóa chương?",
    message: `${chapterItem.label} của “${story.name}” sẽ bị xóa vĩnh viễn.`,
    onConfirm: async () => {
      const response = await fetch(`/api/chapter/${sid}/${cid}`, { method: "DELETE" });
      if (!response.ok) {
        showToast("Không thể xóa chương");
        return;
      }
      forgetProgress(story.key, chapterItem.key);
      await refreshLibrary();
      if (currentRoute().name === "read") navigate(`story/${sid}`);
      else render();
      showToast("Đã xóa chương");
    },
  });
}

function render() {
  settingsPanel.hidden = true;
  closeConfirm();
  window.scrollTo(0, 0);
  const route = currentRoute();
  if (route.name === "story") renderStory(route.sid);
  else if (route.name === "read") renderReader(route.sid, route.cid);
  else renderLibrary();
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) {
    if (!settingsPanel.hidden && event.target === settingsPanel) settingsPanel.hidden = true;
    return;
  }

  const action = target.dataset.action;
  if (action === "confirm-no") closeConfirm();
  else if (action === "confirm-yes") {
    const handler = confirmHandler;
    closeConfirm();
    if (handler) await handler();
  } else if (action === "random") pickRandom();
  else if (action === "delete-story") deleteStory(Number(target.dataset.sid));
  else if (action === "delete-chapter")
    deleteChapter(Number(target.dataset.sid), Number(target.dataset.cid));
  else if (action === "navigate") navigate(target.dataset.path);
  else if (action === "clear-search") {
    query = "";
    renderLibrary();
  } else if (action === "sort") {
    sortBy = target.dataset.sort;
    renderLibraryResults();
  } else if (action === "filter") {
    libraryFilter = target.dataset.filter;
    renderLibraryResults();
  } else if (action === "settings") renderSettings();
  else if (action === "close-settings") settingsPanel.hidden = true;
  else if (action === "theme") {
    settings.theme = target.dataset.theme;
    applySettings();
    renderSettings();
  } else if (action === "size") {
    settings.size = Math.min(30, Math.max(14, settings.size + Number(target.dataset.delta)));
    applySettings();
    renderSettings();
  } else if (action === "leading") {
    settings.leading = Math.min(
      2.4,
      Math.max(1.3, Number((settings.leading + Number(target.dataset.delta)).toFixed(2)))
    );
    applySettings();
    renderSettings();
  } else if (action === "top") window.scrollTo({ top: 0, behavior: "smooth" });
  else if (action === "chapter-step" && chapter) {
    navigate(`read/${chapter.storyId}/${chapter.chapterId + Number(target.dataset.step)}`);
  }
});

window.addEventListener("scroll", () => {
  const route = currentRoute();
  if (route.name === "read" && chapter) updateReadProgress();
});

window.addEventListener("hashchange", render);

applySettings();

async function bootstrap() {
  const [libraryResponse, progressResponse] = await Promise.all([
    fetch("/api/library"),
    fetch("/api/progress"),
  ]);
  if (!libraryResponse.ok || !progressResponse.ok) throw new Error("bootstrap failed");
  const [libraryData, progressData] = await Promise.all([
    libraryResponse.json(),
    progressResponse.json(),
  ]);
  library = libraryData.stories;

  let records = progressData.records || {};
  const legacy = load(KEYS.legacyProgress, null);
  if (!Object.keys(records).length && legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
    try {
      const response = await sendProgress("PUT", { records: legacy, onlyIfEmpty: true });
      const data = await response.json();
      records = data.records || legacy;
      if (response.ok) localStorage.removeItem(KEYS.legacyProgress);
    } catch {
      records = legacy;
    }
  }
  progress = Object.fromEntries(
    Object.entries(records).filter(([, value]) => value && typeof value.ratio === "number")
  );
  render();
}

bootstrap().catch(() => {
  view.innerHTML = `<div class="screen">
    ${topbar("Lỗi", "")}
    <div class="content"><div class="empty"><strong>Không tải được thư viện</strong>Kiểm tra máy chủ và thử lại.</div></div>
  </div>`;
});
