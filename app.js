// Vocabulary viewer — sharded data for scale.
//
//   data/index.json          lightweight manifest (word, pron, last date) loaded once
//   data/content/<date>.json full def/example for that date, fetched on demand + cached
//
// Home: weighted-random flashcard feed. Recently-registered words appear more
// often, but every word keeps a non-zero chance (exponential recency decay +
// epsilon floor). Browse-by-date and an A-Z dictionary view are also provided.

const HALF_LIFE_DAYS = 14; // weight halves every 14 days since lastSeen
const EPSILON = 0.05; // floor so very old words still surface sometimes
const NO_REPEAT = 6; // don't repeat a card within the last N draws

let DATA = null; // the index manifest
let weights = [];
let cumulative = [];
let totalWeight = 0;
const recent = [];
let current = null;
let flipped = false;

// ---- content shard loading (lazy + cached) ---------------------------------

const contentCache = new Map(); // date -> Promise<{ lowerword: {...} }>

function loadContent(date) {
  if (!contentCache.has(date)) {
    const p = fetch(`data/content/${date}.json`, { cache: "force-cache" })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
    contentCache.set(date, p);
  }
  return contentCache.get(date);
}

// Merge a manifest row with its content entry into one card object.
async function resolveWord(row) {
  const content = await loadContent(row.d);
  const e = content[row.w.toLowerCase()] || {};
  return {
    word: row.w,
    pron: e.pron || row.p,
    defEn: e.defEn || "",
    defKo: e.defKo || "",
    exEn: e.exEn || "",
    exKo: e.exKo || "",
    lastSeen: row.d,
    deck: e.deck || "",
  };
}

// ---- utilities -------------------------------------------------------------

function todayUTCdays() {
  return Math.floor(Date.now() / 86400000);
}

function dateToDays(d) {
  const [y, m, day] = d.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, day) / 86400000);
}

function computeWeights() {
  const today = todayUTCdays();
  weights = DATA.words.map((w) => {
    const ageDays = Math.max(0, today - dateToDays(w.d));
    return Math.pow(0.5, ageDays / HALF_LIFE_DAYS) + EPSILON;
  });
  cumulative = [];
  totalWeight = 0;
  for (const wt of weights) {
    totalWeight += wt;
    cumulative.push(totalWeight);
  }
}

function pickIndex() {
  for (let attempt = 0; attempt < 12; attempt++) {
    const r = Math.random() * totalWeight;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    if (!recent.includes(lo) || DATA.words.length <= NO_REPEAT) return lo;
  }
  return Math.floor(Math.random() * DATA.words.length);
}

function esc(s) {
  return (s || "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

function isRecent(dateStr) {
  return todayUTCdays() - dateToDays(dateStr) <= HALF_LIFE_DAYS;
}

// ---- flashcard rendering ---------------------------------------------------

function renderCard(w) {
  const deckChip = w.deck ? `<span class="chip">${esc(w.deck)}</span>` : "";
  // Card height is fixed by CSS. The word sits vertically centered on the front
  // and slides to the top when flipped; the answer fades in below (scrolls if
  // long). Flipping only toggles the `.flipped` class — no re-render.
  return `<div class="flashcard" id="flashcard">
      <div class="fc-head">
        <div class="fc-word">${esc(w.word)}</div>
        ${w.pron ? `<div class="fc-pron">[ ${esc(w.pron)} ]</div>` : ""}
      </div>
      <div class="fc-reveal">
        <div class="fc-def-en">${esc(w.defEn)}</div>
        <div class="fc-def-ko">${esc(w.defKo)}</div>
        ${
          w.exEn
            ? `<div class="fc-ex"><div class="fc-ex-en">${esc(w.exEn)}</div><div class="fc-ex-ko">${esc(w.exKo)}</div></div>`
            : ""
        }
        <div class="fc-meta">
          ${isRecent(w.lastSeen) ? `<span class="chip recent">최근 등록</span>` : ""}
          <span class="chip">최근: ${esc(w.lastSeen)}</span>
          ${deckChip}
        </div>
      </div>
      <div class="fc-front-hint">탭하면 뜻이 보입니다</div>
    </div>`;
}

let drawToken = 0;

async function showCardFor(index) {
  const token = ++drawToken;
  current = index;
  flipped = false;
  recent.push(index);
  while (recent.length > NO_REPEAT) recent.shift();

  const w = await resolveWord(DATA.words[index]);
  if (token !== drawToken) return; // a newer draw superseded this one

  document.getElementById("card-stage").innerHTML = renderCard(w);
  document.getElementById("btn-flip").textContent = "뜻 보기 (Space)";
  const el = document.getElementById("flashcard");
  if (el) el.addEventListener("click", flipCard);
}

function flipCard() {
  if (current == null) return;
  flipped = !flipped;
  const el = document.getElementById("flashcard");
  if (el) el.classList.toggle("flipped", flipped);
  document.getElementById("btn-flip").textContent = flipped
    ? "단어만 보기"
    : "뜻 보기 (Space)";
}

function nextCard() {
  showCardFor(pickIndex());
}

// ---- dates view ------------------------------------------------------------

let activeDate = null;

function renderDatesList() {
  const wrap = document.getElementById("dates-list");
  wrap.innerHTML = DATA.dates
    .map((d) => {
      const count = Object.values(DATA.byDate[d]).reduce(
        (n, arr) => n + arr.length,
        0
      );
      return `<button class="date-pill${d === activeDate ? " is-active" : ""}" data-date="${d}">${d}<small>${count}</small></button>`;
    })
    .join("");
  wrap.querySelectorAll(".date-pill").forEach((b) =>
    b.addEventListener("click", () => {
      activeDate = b.dataset.date;
      renderDatesList();
      renderDateCards();
    })
  );
}

function miniCard(e) {
  if (!e) return "";
  return `<div class="mini">
      <div class="mini-head"><span class="mini-word">${esc(e.word)}</span>${
        e.pron ? `<span class="mini-pron">[ ${esc(e.pron)} ]</span>` : ""
      }</div>
      <div class="mini-def">${esc(e.defEn)} <span class="ko">(${esc(e.defKo)})</span></div>
      ${e.exEn ? `<div class="mini-ex">${esc(e.exEn)}<br>${esc(e.exKo)}</div>` : ""}
    </div>`;
}

async function renderDateCards() {
  const host = document.getElementById("dates-cards");
  if (!activeDate) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = `<div class="count">불러오는 중…</div>`;
  const content = await loadContent(activeDate);
  const decks = DATA.byDate[activeDate];
  host.innerHTML = Object.entries(decks)
    .map(
      ([deck, list]) =>
        `<div class="deck-label">${esc(deck)} · ${list.length}</div>` +
        list
          .slice()
          .sort((a, b) => a.localeCompare(b))
          .map((key) => miniCard(content[key]))
          .join("")
    )
    .join("");
}

// ---- all (A-Z) view --------------------------------------------------------

function renderAll(filter = "") {
  const host = document.getElementById("all-list");
  const f = filter.trim().toLowerCase();
  const list = DATA.words.filter((w) => !f || w.w.toLowerCase().includes(f));
  host.innerHTML =
    `<div class="count">${list.length} / ${DATA.words.length} 단어</div>` +
    list
      .map(
        (w) => `<div class="mini az-row" data-word="${esc(w.w.toLowerCase())}" data-date="${w.d}">
          <div class="mini-head"><span class="mini-word">${esc(w.w)}</span>${
            w.p ? `<span class="mini-pron">[ ${esc(w.p)} ]</span>` : ""
          }<span class="az-caret">＋</span></div>
          <div class="az-body"></div>
        </div>`
      )
      .join("");

  host.querySelectorAll(".az-row").forEach((row) =>
    row.addEventListener("click", async () => {
      const open = row.classList.toggle("open");
      row.querySelector(".az-caret").textContent = open ? "－" : "＋";
      const body = row.querySelector(".az-body");
      if (open && !body.dataset.loaded) {
        const content = await loadContent(row.dataset.date);
        const e = content[row.dataset.word];
        body.innerHTML = e
          ? `<div class="mini-def">${esc(e.defEn)} <span class="ko">(${esc(e.defKo)})</span></div>
             ${e.exEn ? `<div class="mini-ex">${esc(e.exEn)}<br>${esc(e.exKo)}</div>` : ""}`
          : `<div class="mini-ex">내용을 찾을 수 없습니다.</div>`;
        body.dataset.loaded = "1";
      }
    })
  );
}

// ---- view switching --------------------------------------------------------

function switchView(name) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.toggle("is-active", t.dataset.view === name));
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.toggle("is-active", v.id === `view-${name}`));
  if (name === "dates" && !activeDate && DATA.dates.length) {
    activeDate = DATA.dates[0];
    renderDatesList();
    renderDateCards();
  }
  if (name === "all") renderAll(document.getElementById("search").value);
}

// ---- init ------------------------------------------------------------------

async function init() {
  const res = await fetch("data/index.json", { cache: "no-store" });
  DATA = await res.json();

  computeWeights();
  nextCard();
  renderDatesList();

  document.getElementById("btn-flip").addEventListener("click", flipCard);
  document.getElementById("btn-next").addEventListener("click", nextCard);
  document
    .querySelectorAll(".tab")
    .forEach((t) =>
      t.addEventListener("click", () => switchView(t.dataset.view))
    );
  document
    .getElementById("search")
    .addEventListener("input", (e) => renderAll(e.target.value));

  document.addEventListener("keydown", (e) => {
    const homeActive = document
      .getElementById("view-home")
      .classList.contains("is-active");
    if (!homeActive) return;
    if (e.code === "Space") {
      e.preventDefault();
      flipCard();
    } else if (e.code === "ArrowRight" || e.code === "Enter") {
      e.preventDefault();
      nextCard();
    }
  });
}

init();
