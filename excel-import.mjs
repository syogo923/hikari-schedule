import { getStore } from "@netlify/blobs";

const STORE_NAME = "hikari-schedule";
const DATA_KEY = "events-v1";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_RE = /^[a-zA-Z0-9_-]{10,100}$/;

function reply(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function isValidDate(value) {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateEvent(input) {
  const eventDate = String(input?.date ?? "").trim();
  const time = String(input?.time ?? "").trim();
  const task = String(input?.task ?? "").trim().replace(/\s+/g, " ");

  if (!isValidDate(eventDate)) return { error: "日付が正しくありません。" };
  if (!TIME_RE.test(time)) return { error: "時間が正しくありません。" };
  if (task.length < 1 || task.length > 200) {
    return { error: "予定は1文字以上200文字以内で入力してください。" };
  }
  return { date: eventDate, time, task };
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const byDateTime = `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
    return byDateTime || String(a.task).localeCompare(String(b.task), "ja");
  });
}

function makeId() {
  return `${Date.now().toString(36)}_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function readEvents(store) {
  const data = await store.get(DATA_KEY, { type: "json" });
  return Array.isArray(data) ? data : [];
}

async function writeEvents(store, events) {
  await store.setJSON(DATA_KEY, sortEvents(events));
}

export default async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const url = new URL(request.url);

  try {
    if (request.method === "GET") {
      const events = sortEvents(await readEvents(store));
      return reply({ events });
    }

    if (request.method === "POST") {
      const input = await request.json();
      const checked = validateEvent(input);
      if (checked.error) return reply(checked, 400);

      const events = await readEvents(store);
      const now = new Date().toISOString();
      const event = {
        id: makeId(),
        ...checked,
        createdAt: now,
        updatedAt: now,
      };
      events.push(event);
      await writeEvents(store, events);
      return reply({ event }, 201);
    }

    if (request.method === "PUT") {
      const input = await request.json();
      const id = String(input?.id ?? "").trim();
      if (!ID_RE.test(id)) return reply({ error: "予定を特定できません。" }, 400);

      const checked = validateEvent(input);
      if (checked.error) return reply(checked, 400);

      const events = await readEvents(store);
      const index = events.findIndex((event) => event.id === id);
      if (index < 0) return reply({ error: "予定が見つかりません。" }, 404);

      events[index] = {
        ...events[index],
        ...checked,
        updatedAt: new Date().toISOString(),
      };
      await writeEvents(store, events);
      return reply({ event: events[index] });
    }

    if (request.method === "DELETE") {
      const id = String(url.searchParams.get("id") ?? "").trim();
      if (!ID_RE.test(id)) return reply({ error: "予定を特定できません。" }, 400);

      const events = await readEvents(store);
      const remaining = events.filter((event) => event.id !== id);
      if (remaining.length === events.length) {
        return reply({ error: "予定が見つかりません。" }, 404);
      }
      await writeEvents(store, remaining);
      return reply({ ok: true });
    }

    return reply({ error: "対応していない操作です。" }, 405);
  } catch (error) {
    console.error("schedule function error", error);
    return reply({ error: "予定データを処理できませんでした。少し待ってから再度お試しください。" }, 500);
  }
};

export const config = {
  path: "/api/schedules",
};
