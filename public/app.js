const API = "/api/schedules";
const state = {
  events: [],
  selectedDate: formatDate(new Date()),
  visibleMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  loading: false,
};

const $ = (id) => document.getElementById(id);
const calendar = $("calendar");
const scheduleList = $("scheduleList");
const upcomingList = $("upcomingList");
const dialog = $("scheduleDialog");
const form = $("scheduleForm");

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function japaneseDate(value, withWeekday = true) {
  const options = { year: "numeric", month: "long", day: "numeric" };
  if (withWeekday) options.weekday = "short";
  return new Intl.DateTimeFormat("ja-JP", options).format(parseLocalDate(value));
}

function shortJapaneseDate(value) {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", weekday: "short" }).format(parseLocalDate(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

async function apiRequest(options = {}) {
  const response = await fetch(options.url || API, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || "通信に失敗しました。");
  return data;
}

async function loadEvents({ quiet = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!quiet) scheduleList.innerHTML = '<div class="loading">予定を読み込んでいます…</div>';
  try {
    const data = await apiRequest();
    state.events = Array.isArray(data.events) ? data.events : [];
    renderAll();
    if (quiet) showToast("最新の予定に更新しました");
  } catch (error) {
    scheduleList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}<br>Netlifyのデプロイ状態をご確認ください。</div>`;
    $("todaySummary").innerHTML = '<div>予定を読み込めませんでした。</div>';
  } finally {
    state.loading = false;
  }
}

function renderAll() {
  renderToday();
  renderCalendar();
  renderSelectedDate();
  renderUpcoming();
}

function renderToday() {
  const today = formatDate(new Date());
  const events = state.events.filter((event) => event.date === today);
  $("todayTitle").textContent = japaneseDate(today);
  $("todaySummary").innerHTML = events.length
    ? events.map((event) => `<div class="today-event"><time>${escapeHtml(event.time)}</time><span>${escapeHtml(event.task)}</span></div>`).join("")
    : '<div>本日の予定はありません。</div>';
}

function renderCalendar() {
  const year = state.visibleMonth.getFullYear();
  const month = state.visibleMonth.getMonth();
  $("monthTitle").textContent = `${year}年 ${month + 1}月`;
  calendar.innerHTML = "";

  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const today = formatDate(new Date());
  const eventDates = new Set(state.events.map((event) => event.date));

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const value = formatDate(date);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "day-button";
    button.textContent = date.getDate();
    button.setAttribute("role", "gridcell");
    button.setAttribute("aria-label", japaneseDate(value));
    if (date.getMonth() !== month) button.classList.add("outside");
    if (value === today) button.classList.add("today");
    if (value === state.selectedDate) button.classList.add("selected");
    if (eventDates.has(value)) button.classList.add("has-events");
    button.addEventListener("click", () => {
      state.selectedDate = value;
      state.visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      renderCalendar();
      renderSelectedDate();
    });
    calendar.appendChild(button);
  }
}

function renderSelectedDate() {
  $("selectedDateTitle").textContent = japaneseDate(state.selectedDate);
  const events = state.events.filter((event) => event.date === state.selectedDate);
  if (!events.length) {
    scheduleList.innerHTML = '<div class="empty-state">この日の予定はありません。<br>「予定を追加」から登録できます。</div>';
    return;
  }
  scheduleList.innerHTML = events.map((event) => `
    <div class="schedule-item">
      <time class="schedule-time">${escapeHtml(event.time)}</time>
      <div class="schedule-task">${escapeHtml(event.task)}</div>
      <div class="item-actions">
        <button class="small-button" type="button" data-action="edit" data-id="${escapeHtml(event.id)}">編集</button>
        <button class="small-button delete" type="button" data-action="delete" data-id="${escapeHtml(event.id)}">削除</button>
      </div>
    </div>`).join("");
}

function renderUpcoming() {
  const today = parseLocalDate(formatDate(new Date()));
  const end = new Date(today);
  end.setDate(end.getDate() + 6);
  const from = formatDate(today);
  const to = formatDate(end);
  const events = state.events.filter((event) => event.date >= from && event.date <= to);
  upcomingList.innerHTML = events.length
    ? events.map((event) => `<div class="upcoming-item"><strong>${escapeHtml(shortJapaneseDate(event.date))}</strong><time>${escapeHtml(event.time)}</time><span>${escapeHtml(event.task)}</span></div>`).join("")
    : '<div class="empty-state">今後7日間の予定はありません。</div>';
}

function openCreateDialog() {
  $("dialogTitle").textContent = "予定を追加";
  $("saveButton").textContent = "登録する";
  $("eventId").value = "";
  $("eventDate").value = state.selectedDate;
  $("eventTime").value = "09:00";
  $("eventTask").value = "";
  $("formError").textContent = "";
  dialog.showModal();
  setTimeout(() => $("eventTime").focus(), 50);
}

function openEditDialog(id) {
  const event = state.events.find((item) => item.id === id);
  if (!event) return;
  $("dialogTitle").textContent = "予定を編集";
  $("saveButton").textContent = "更新する";
  $("eventId").value = event.id;
  $("eventDate").value = event.date;
  $("eventTime").value = event.time;
  $("eventTask").value = event.task;
  $("formError").textContent = "";
  dialog.showModal();
}

async function saveEvent(event) {
  event.preventDefault();
  const id = $("eventId").value;
  const body = {
    id,
    date: $("eventDate").value,
    time: $("eventTime").value,
    task: $("eventTask").value.trim(),
  };
  if (!body.date || !body.time || !body.task) {
    $("formError").textContent = "日付・時間・予定をすべて入力してください。";
    return;
  }
  const button = $("saveButton");
  button.disabled = true;
  $("formError").textContent = "";
  try {
    await apiRequest({ method: id ? "PUT" : "POST", body });
    state.selectedDate = body.date;
    state.visibleMonth = new Date(parseLocalDate(body.date).getFullYear(), parseLocalDate(body.date).getMonth(), 1);
    dialog.close();
    await loadEvents();
    showToast(id ? "予定を更新しました" : "予定を登録しました");
  } catch (error) {
    $("formError").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function deleteEvent(id) {
  const event = state.events.find((item) => item.id === id);
  if (!event) return;
  if (!confirm(`${event.date} ${event.time}\n「${event.task}」を削除しますか？`)) return;
  try {
    await apiRequest({ method: "DELETE", url: `${API}?id=${encodeURIComponent(id)}` });
    await loadEvents();
    showToast("予定を削除しました");
  } catch (error) {
    alert(error.message);
  }
}

$("prevMonth").addEventListener("click", () => {
  state.visibleMonth = new Date(state.visibleMonth.getFullYear(), state.visibleMonth.getMonth() - 1, 1);
  renderCalendar();
});
$("nextMonth").addEventListener("click", () => {
  state.visibleMonth = new Date(state.visibleMonth.getFullYear(), state.visibleMonth.getMonth() + 1, 1);
  renderCalendar();
});
$("goToday").addEventListener("click", () => {
  const today = new Date();
  state.selectedDate = formatDate(today);
  state.visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  renderCalendar();
  renderSelectedDate();
});
$("refreshButton").addEventListener("click", () => loadEvents({ quiet: true }));
$("openFormButton").addEventListener("click", openCreateDialog);
$("closeDialog").addEventListener("click", () => dialog.close());
$("cancelButton").addEventListener("click", () => dialog.close());
form.addEventListener("submit", saveEvent);
scheduleList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (button.dataset.action === "edit") openEditDialog(button.dataset.id);
  if (button.dataset.action === "delete") deleteEvent(button.dataset.id);
});

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

loadEvents();
setInterval(() => loadEvents(), 60_000);
