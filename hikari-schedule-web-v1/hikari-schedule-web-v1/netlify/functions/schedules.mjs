import { getStore } from "@netlify/blobs";

const STORE_NAME = "hikari-schedules";
const ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function validDate(value) {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
}

function validate(body) {
  const date = String(body?.date ?? "").trim();
  const time = String(body?.time ?? "").trim();
  const task = String(body?.task ?? "").trim().replace(/\s+/g, " ");
  if (!validDate(date)) return { error: "日付が正しくありません。" };
  if (!TIME_RE.test(time)) return { error: "時間が正しくありません。" };
  if (!task || task.length > 200) return { error: "予定は1〜200文字で入力してください。" };
  return { date, time, task };
}

function makeId() {
  return `${Date.now().toString(36)}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export default async (req) => {
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const url = new URL(req.url);

  try {
    if (req.method === "GET") {
      const from = url.searchParams.get("from") || "0000-01-01";
      const to = url.searchParams.get("to") || "9999-12-31";
      if (!validDate(from) || !validDate(to)) return json({ error: "検索日付が正しくありません。" }, 400);

      const listed = await store.list({ prefix: "event/" });
      const events = [];
      for (const item of listed.blobs) {
        const event = await store.get(item.key, { type: "json", consistency: "strong" });
        if (event && event.date >= from && event.date <= to) events.push(event);
      }
      events.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`, "ja"));
      return json({ events });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const checked = validate(body);
      if (checked.error) return json(checked, 400);
      const id = makeId();
      const event = { id, ...checked, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await store.setJSON(`event/${id}`, event);
      return json({ event }, 201);
    }

    if (req.method === "PUT") {
      const body = await req.json();
      const id = String(body?.id ?? "");
      if (!ID_RE.test(id)) return json({ error: "予定IDが正しくありません。" }, 400);
      const checked = validate(body);
      if (checked.error) return json(checked, 400);
      const key = `event/${id}`;
      const old = await store.get(key, { type: "json", consistency: "strong" });
      if (!old) return json({ error: "予定が見つかりません。" }, 404);
      const event = { ...old, ...checked, updatedAt: new Date().toISOString() };
      await store.setJSON(key, event);
      return json({ event });
    }

    if (req.method === "DELETE") {
      const id = url.searchParams.get("id") || "";
      if (!ID_RE.test(id)) return json({ error: "予定IDが正しくありません。" }, 400);
      await store.delete(`event/${id}`);
      return json({ ok: true });
    }

    return json({ error: "対応していない操作です。" }, 405);
  } catch (error) {
    console.error(error);
    return json({ error: "サーバーでエラーが発生しました。" }, 500);
  }
};

export const config = { path: "/api/schedules" };
