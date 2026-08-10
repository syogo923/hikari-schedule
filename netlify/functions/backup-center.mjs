import { getStore } from '@netlify/blobs';

const SOURCES = {
  projects: { store: 'hikari-portal', key: 'projects-v2' },
  projectHistory: { store: 'hikari-portal', key: 'projects-history-v1' },
  projectState: { store: 'hikari-portal', key: 'projects-state-v1' },
  masters: { store: 'hikari-portal', key: 'masters-v2' },
  schedules: { store: 'hikari-schedule', key: 'events-v1' },
  deadlines: { store: 'hikari-portal', key: 'deadlines-v1' }
};

const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

async function readAll() {
  const data = {};
  for (const [name, source] of Object.entries(SOURCES)) {
    const store = getStore({ name: source.store, consistency: 'strong' });
    data[name] = (await store.get(source.key, { type: 'json' })) ?? null;
  }
  return data;
}

async function writeSelected(data, names) {
  for (const name of names) {
    const source = SOURCES[name];
    if (!source || !Object.prototype.hasOwnProperty.call(data, name)) continue;
    const store = getStore({ name: source.store, consistency: 'strong' });
    const value = data[name];
    if (value === null || value === undefined) {
      await store.delete(source.key);
    } else {
      await store.setJSON(source.key, value);
    }
  }
}

export default async (request) => {
  try {
    if (request.method === 'GET') {
      return reply({
        format: 'hikari-portal-backup',
        formatVersion: 1,
        portalVersion: '4.0',
        createdAt: new Date().toISOString(),
        data: await readAll()
      });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const action = String(body?.action || '');
      const backup = body?.backup;
      if (!backup || backup.format !== 'hikari-portal-backup' || !backup.data || typeof backup.data !== 'object') {
        return reply({ error: '光ポータルのバックアップファイルではありません。' }, 400);
      }

      if (action === 'restore') {
        const missing = Object.keys(SOURCES).filter(name => !Object.prototype.hasOwnProperty.call(backup.data, name));
        if (missing.length) return reply({ error: '完全バックアップではないため復元できません。' }, 400);
        await writeSelected(backup.data, Object.keys(SOURCES));
        return reply({ ok: true, restoredAt: new Date().toISOString() });
      }

      if (action === 'import') {
        const names = Object.keys(SOURCES).filter(name => Object.prototype.hasOwnProperty.call(backup.data, name));
        if (!names.length) return reply({ error: 'インポートできるデータがありません。' }, 400);
        await writeSelected(backup.data, names);
        return reply({ ok: true, imported: names, importedAt: new Date().toISOString() });
      }

      return reply({ error: '対応していない操作です。' }, 405);
    }

    return reply({ error: '対応していない操作です。' }, 405);
  } catch (error) {
    console.error('backup-center function error', error);
    return reply({ error: 'バックアップ処理に失敗しました。少し待ってから再度お試しください。' }, 500);
  }
};

export const config = { path: '/api/backup-center' };
