(() => {
  if (window.__rentNearest) return;
  window.__rentNearest = true;

  // Селекторы под популярные сайты. Если сайт поменял вёрстку — правь здесь.
  // card — карточка объявления, address — элементы с адресом внутри неё.
  const SITES = [
    { host: "avito.ru", card: '[data-marker="item"]', address: '[data-marker="item-address"], [class*="geo-root"]' },
    { host: "cian.ru", card: '[data-name="CardComponent"]', address: '[data-name="GeoLabel"]' },
  ];

  // Запасной вариант для любых других сайтов: ищем текст, похожий на "ул. Ленина, 15"
  const STREET =
    /(?:^|[\s,])(?:ул(?:ица|\.)?|пр-?т|просп(?:ект|\.)?|пер(?:еулок|\.)?|б-р|бульвар|ш(?:оссе|\.)|мкр|микрорайон|наб(?:ережная|\.)?|пл(?:ощадь|\.)?)\s*[^\d,]{2,40}[, ]+\s*(?:д\.?\s*)?\d+/i;

  const fmt = (m) => (m < 1000 ? Math.round(m / 10) * 10 + " м" : (m / 1000).toFixed(1) + " км");

  function haversine(a, b) {
    const R = 6371000, rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  async function geocode(q) {
    const r = await chrome.runtime.sendMessage({ type: "geocode", query: q });
    if (!r || !r.ok) throw new Error((r && r.error) || "нет ответа от фонового скрипта");
    return r.result;
  }

  const withCity = (addr, city) =>
    city && !addr.toLowerCase().includes(city.toLowerCase()) ? addr + ", " + city : addr;

  function findCards() {
    const cfg = SITES.find((s) => location.hostname.includes(s.host));
    const out = [];
    if (cfg) {
      document.querySelectorAll(cfg.card).forEach((card) => {
        const parts = [...card.querySelectorAll(cfg.address)]
          .map((e) => e.textContent.trim())
          .filter(Boolean);
        const addr = [...new Set(parts)].join(", ");
        if (addr) out.push({ card, addr });
      });
      if (out.length) return out;
    }
    // запасной поиск
    const leaves = [...document.querySelectorAll("body *")].filter((el) => {
      if (el.children.length) return false;
      const t = el.textContent.trim();
      return t.length >= 8 && t.length <= 150 && STREET.test(t);
    });
    const seen = new Set();
    for (const leaf of leaves) {
      let node = leaf, depth = 0;
      while (
        node.parentElement &&
        node.parentElement !== document.body &&
        depth < 8 &&
        leaves.filter((l) => node.parentElement.contains(l)).length === 1
      ) {
        node = node.parentElement;
        depth++;
      }
      if (seen.has(node)) continue;
      seen.add(node);
      out.push({ card: node, addr: leaf.textContent.trim() });
    }
    return out;
  }

  // ---------- интерфейс (только через el.style, чтобы не упереться в CSP сайта) ----------
  let panel;
  function ensurePanel() {
    if (panel && document.body.contains(panel)) return panel;
    panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed", right: "16px", bottom: "16px", width: "320px", maxHeight: "60vh",
      overflowY: "auto", background: "#fff", color: "#111", border: "1px solid #ccc",
      borderRadius: "10px", boxShadow: "0 6px 24px rgba(0,0,0,.25)", padding: "10px 12px",
      font: "13px/1.4 system-ui, sans-serif", zIndex: "2147483647",
    });
    document.body.appendChild(panel);
    return panel;
  }

  let stopFlag = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function setStatus(text, withStop) {
    const p = ensurePanel();
    p.textContent = "";
    const d = document.createElement("div");
    d.textContent = text;
    p.appendChild(d);
    if (withStop) {
      const b = document.createElement("button");
      b.textContent = "Остановить и показать, что есть";
      b.style.cssText =
        "margin-top:8px;padding:6px 10px;border:0;border-radius:6px;background:#d93025;color:#fff;cursor:pointer;font:600 12px system-ui,sans-serif";
      b.onclick = () => {
        stopFlag = true;
        b.disabled = true;
        b.textContent = "Останавливаю…";
      };
      p.appendChild(b);
    }
  }

  // ---------- автоподгрузка объявлений (работает одинаково на любом сайте) ----------
  // Каждый круг: нажимаем кнопку «Показать ещё» (если есть) и прокручиваем в самый низ.
  // Останавливаемся, когда страница перестала расти 3 круга подряд, набрали лимит или нажали «Остановить».
  const MORE_RE = /^(показать\s+(ещ[её]|больше)|загрузить\s+ещ[её]|load more|show more)(\s|$|[.…»›])|^ещ[её]$/i;

  function clickLoadMore() {
    const btns = document.querySelectorAll('button, a[role="button"], [role="button"]');
    for (const el of btns) {
      const t = el.textContent.trim();
      if (t.length < 40 && MORE_RE.test(t) && el.offsetParent !== null && !el.disabled) {
        el.click();
        return true;
      }
    }
    return false;
  }

  async function loadAll(maxCards) {
    let stable = 0, lastH = 0, lastCount = 0;
    for (let round = 0; round < 80 && !stopFlag; round++) {
      const clicked = clickLoadMore();
      window.scrollTo({ top: document.documentElement.scrollHeight });
      await sleep(1300);
      const h = document.documentElement.scrollHeight;
      const count = findCards().length;
      setStatus("Подгружаю объявления… найдено " + count, true);
      if (count >= maxCards) break;
      if (h === lastH && count === lastCount && !clicked) {
        if (++stable >= 3) break;
      } else {
        stable = 0;
      }
      lastH = h;
      lastCount = count;
    }
    window.scrollTo({ top: 0 });
  }

  function clearOld() {
    document.querySelectorAll("[data-rn-badge]").forEach((e) => e.remove());
    document.querySelectorAll("[data-rn-dim]").forEach((e) => {
      e.style.opacity = e.dataset.rnDim;
      delete e.dataset.rnDim;
    });
  }

  function badge(card, text, color) {
    const b = document.createElement("div");
    b.setAttribute("data-rn-badge", "1");
    b.textContent = text;
    Object.assign(b.style, {
      display: "inline-block", margin: "4px 0", padding: "2px 8px", borderRadius: "999px",
      background: color, color: "#fff", font: "600 12px system-ui, sans-serif",
    });
    card.insertBefore(b, card.firstChild);
  }

  function flash(card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    const old = card.style.outline;
    card.style.outline = "3px solid #1a73e8";
    setTimeout(() => (card.style.outline = old), 2500);
  }

  function renderList(results, targetLabel, radiusKm, skipped) {
    const p = ensurePanel();
    p.textContent = "";

    const head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-weight:600";
    const title = document.createElement("span");
    title.textContent = "Ближе всего к: " + targetLabel;
    const close = document.createElement("span");
    close.textContent = "✕";
    close.style.cssText = "cursor:pointer;padding:0 4px";
    close.onclick = () => { p.remove(); clearOld(); };
    head.append(title, close);
    p.appendChild(head);

    results.slice(0, 15).forEach((r, i) => {
      const row = document.createElement("div");
      row.style.cssText = "padding:6px 0;border-top:1px solid #eee;cursor:pointer";
      const d = document.createElement("b");
      d.textContent = (i + 1) + ". " + (r.approx ? "≈ " : "") + fmt(r.dist);
      const a = document.createElement("div");
      a.textContent = r.addr;
      a.style.color = "#555";
      row.append(d, a);
      row.onclick = () => flash(r.card);
      p.appendChild(row);
    });

    const foot = document.createElement("div");
    foot.style.cssText = "margin-top:6px;color:#777;font-size:12px";
    foot.textContent =
      "Найдено: " + results.length + (skipped ? ", адрес не распознан у " + skipped : "") +
      ". «≈» — дом не нашёлся, посчитано по улице. Дальше " + radiusKm + " км — затемнены.";
    p.appendChild(foot);
  }

  async function scan({ target, city, radiusKm, autoLoad = true, maxCards = 100 }) {
    try {
      stopFlag = false;
      clearOld();
      setStatus("Ищу твой адрес…");
      const t = await geocode(withCity(target, city));
      if (!t) return setStatus("Не нашёл адрес «" + target + "». Проверь город и номер дома.");

      if (autoLoad) {
        await loadAll(maxCards);
        stopFlag = false; // «Остановить» на этапе подгрузки не должно отменять подсчёт
      }
      const items = findCards().slice(0, maxCards);
      if (!items.length) {
        return setStatus("Не нашёл объявления с адресами на этой странице. Открой страницу со списком объявлений.");
      }

      const results = [];
      let skipped = 0;
      for (let i = 0; i < items.length; i++) {
        if (stopFlag) break;
        setStatus("Считаю расстояния: " + (i + 1) + " из " + items.length + "…", true);
        const { card, addr } = items[i];
        const c = await geocode(withCity(addr, city));
        if (!c) { skipped++; continue; }
        const dist = haversine(t, c);
        results.push({ card, addr, dist, approx: !!c.approx });
      }

      results.sort((a, b) => a.dist - b.dist);
      results.forEach((r) => {
        const near = r.dist <= radiusKm * 1000;
        badge(r.card, "📍 " + (r.approx ? "≈ " : "") + fmt(r.dist), near ? "#1e8e3e" : "#888");
        if (!near) {
          r.card.dataset.rnDim = r.card.style.opacity || "";
          r.card.style.opacity = "0.35";
        }
      });
      renderList(results, target, radiusKm, skipped);
    } catch (e) {
      setStatus("Ошибка: " + e.message);
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "scan") scan(msg);
  });
})();
