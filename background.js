// Геокодинг через OpenStreetMap Nominatim (бесплатно, без ключа).
// Лимит сервиса — 1 запрос в секунду, поэтому запросы идут по очереди, а результаты кешируются.

let chain = Promise.resolve();
let lastCall = 0;

function throttled(fn) {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastCall + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastCall = Date.now();
    }
  });
  chain = run.catch(() => {});
  return run;
}

async function nominatim(q) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=ru&q=" +
    encodeURIComponent(q);
  const r = await fetch(url);
  if (!r.ok) throw new Error("Nominatim HTTP " + r.status);
  const j = await r.json();
  return j[0] ? { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon) } : null;
}

// Убираем номер дома, чтобы хотя бы найти улицу, если дом не нашёлся в OSM
function stripHouse(q) {
  return q.replace(/,?\s*(?:д\.?\s*)?\d+\s*[а-яa-z]?(?:\s*[\/к]\s*\d+)?(?=\s*(?:,|$))/i, "");
}

async function geocode(query) {
  const key = "g:" + query.toLowerCase();
  const cached = await chrome.storage.local.get(key);
  if (key in cached) return cached[key];

  let res = await throttled(() => nominatim(query));
  if (!res) {
    const loose = stripHouse(query);
    if (loose && loose !== query) {
      res = await throttled(() => nominatim(loose));
      if (res) res.approx = true; // нашли только улицу, не дом
    }
  }
  await chrome.storage.local.set({ [key]: res });
  return res;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "geocode") {
    geocode(msg.query)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // ответ придёт асинхронно
  }
});
