import { getStore } from "@netlify/blobs";

const STORE_NAME = "hikari-portal";
const DATA_KEY = "deadlines-v1";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[a-zA-Z0-9_-]{10,100}$/;

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function validDate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}
function validate(input) {
  const title = String(input?.title ?? "").trim().replace(/\s+/g, " ");
  const client = String(input?.client ?? "").trim().replace(/\s+/g, " ");
  const dueDate = String(input?.dueDate ?? "").trim();
  const notes = String(input?.notes ?? "").trim();
  const priority = ["high", "normal", "low"].includes(input?.priority) ? input.priority : "normal";
  if (!title || title.length > 120) return { error: "案件名は1文字以上120文字以内で入力してください。" };
  if (client.length > 100) return { error: "得意先名は100文字以内で入力してください。" };
  if (!validDate(dueDate)) return { error: "納期が正しくありません。" };
  if (notes.length > 500) return { error: "メモは500文字以内で入力してください。" };
  return { title, client, dueDate, notes, priority };
}
function sortItems(items) {
  return [...items].sort((a, b) => Number(a.completed) - Number(b.completed) || a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title, "ja"));
}
function makeId() { return `${Date.now().toString(36)}_${crypto.randomUUID().replaceAll("-", "")}`; }
async function read(store) { const data = await store.get(DATA_KEY, { type: "json" }); return Array.isArray(data) ? data : []; }
async function write(store, items) { await store.setJSON(DATA_KEY, sortItems(items)); }

export default async (request) => {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const url = new URL(request.url);
  try {
    if (request.method === "GET") return reply({ deadlines: sortItems(await read(store)) });
    if (request.method === "POST") {
      const input = await request.json(); const checked = validate(input); if (checked.error) return reply(checked, 400);
      const items = await read(store); const now = new Date().toISOString();
      const item = { id: makeId(), ...checked, completed: false, completedAt: null, createdAt: now, updatedAt: now };
      items.push(item); await write(store, items); return reply({ deadline: item }, 201);
    }
    if (request.method === "PUT") {
      const input = await request.json(); const id = String(input?.id ?? "").trim();
      if (!ID_RE.test(id)) return reply({ error: "案件を特定できません。" }, 400);
      const items = await read(store); const index = items.findIndex((item) => item.id === id);
      if (index < 0) return reply({ error: "案件が見つかりません。" }, 404);
      if (input.action === "toggle") {
        const completed = !items[index].completed;
        items[index] = { ...items[index], completed, completedAt: completed ? new Date().toISOString() : null, updatedAt: new Date().toISOString() };
      } else {
        const checked = validate(input); if (checked.error) return reply(checked, 400);
        items[index] = { ...items[index], ...checked, updatedAt: new Date().toISOString() };
      }
      await write(store, items); return reply({ deadline: items[index] });
    }
    if (request.method === "DELETE") {
      const id = String(url.searchParams.get("id") ?? "").trim();
      if (!ID_RE.test(id)) return reply({ error: "案件を特定できません。" }, 400);
      const items = await read(store); const rest = items.filter((item) => item.id !== id);
      if (rest.length === items.length) return reply({ error: "案件が見つかりません。" }, 404);
      await write(store, rest); return reply({ ok: true });
    }
    return reply({ error: "対応していない操作です。" }, 405);
  } catch (error) {
    console.error("deadline function error", error);
    return reply({ error: "納期データを処理できませんでした。少し待ってから再度お試しください。" }, 500);
  }
};
export const config = { path: "/api/deadlines" };
