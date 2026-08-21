import { getStore } from '@netlify/blobs';

const STORE = 'hikari-portal';
const KEY = 'materials-v1';

const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  }
});

function normalizeMaterials(value) {
  return Array.isArray(value) ? value : [];
}

export default async (request) => {
  try {
    const store = getStore({ name: STORE, consistency: 'strong' });

    if (request.method === 'GET') {
      const data = await store.get(KEY, { type: 'json' });
      if (!data) return reply({ initialized: false, materials: [], updatedAt: '' });
      return reply({
        initialized: true,
        materials: normalizeMaterials(data.materials),
        updatedAt: String(data.updatedAt || '')
      });
    }

    if (request.method === 'PUT' || request.method === 'POST') {
      const body = await request.json();
      if (!Array.isArray(body?.materials)) {
        return reply({ error: '材料データの形式が正しくありません。' }, 400);
      }

      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        materials: body.materials
      };
      await store.setJSON(KEY, data);

      const confirmed = await store.get(KEY, { type: 'json' });
      return reply({
        ok: true,
        initialized: true,
        materials: normalizeMaterials(confirmed?.materials),
        updatedAt: String(confirmed?.updatedAt || data.updatedAt)
      });
    }

    return reply({ error: '対応していない操作です。' }, 405);
  } catch (error) {
    console.error('materials function error', error);
    return reply({ error: '材料マスタの共有処理に失敗しました。' }, 500);
  }
};

export const config = { path: '/api/materials' };
