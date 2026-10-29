const $ = (id) => document.getElementById(id);
const status = (t) => ($("status").textContent = t);

chrome.storage.local.get(["target", "city", "radius", "limit", "auto"]).then((s) => {
  $("target").value = s.target || "";
  $("city").value = s.city || "";
  $("radius").value = s.radius || 3;
  $("limit").value = s.limit || 100;
  $("auto").checked = s.auto !== false;
});

$("go").addEventListener("click", async () => {
  const target = $("target").value.trim();
  const city = $("city").value.trim();
  const radiusKm = parseFloat($("radius").value) || 3;
  const maxCards = parseInt($("limit").value, 10) || 100;
  const autoLoad = $("auto").checked;
  if (!target) return status("Введи адрес");

  await chrome.storage.local.set({ target, city, radius: radiusKm, limit: maxCards, auto: autoLoad });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "scan", target, city, radiusKm, autoLoad, maxCards });
    status("Запущено — смотри панель справа внизу на странице.");
  } catch (e) {
    status("Не получилось запустить на этой странице: " + e.message);
  }
});
