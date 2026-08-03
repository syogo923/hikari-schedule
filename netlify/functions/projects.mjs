/* 光ポータル projects API Ver2.1 - 材料マスタ共有対応 */
import { getStore } from '@netlify/blobs';

const STORE = 'hikari-portal';
const PROJECTS_KEY = 'projects-v2';
const HISTORY_KEY = 'projects-history-v1';
const STATE_KEY = 'projects-state-v1';
const HISTORY_LIMIT = 500;
const NORMAL_NOTES_LIMIT = 10000;
const SHARED_NOTES_LIMIT = 500000;

const SHARED_PROJECT_MARKERS = new Set([
  'SYS.PORTAL',
  'SYS.PORTAL.STATUS',
  'SYS.PORTAL.MATERIAL'
]);

const SHARED_CLIENT_MARKERS = new Set([
  '__HIKARI_PORTAL_SHARED_STATE__',
  '__HIKARI_PORTAL_STATUS_STATE__',
  '__HIKARI_PORTAL_MATERIAL_STATE__'
]);

const SHARED_SPEC_MARKERS = new Set([
  'HIKARI_PORTAL_SHARED_STATE_V1',
  'HIKARI_PORTAL_STATUS_STATE_V1',
  'HIKARI_PORTAL_MATERIAL_STATE_V1'
]);

const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });

const clean = (value, maxLength = 120) =>
  String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);

const cleanLongText = (value, maxLength = NORMAL_NOTES_LIMIT) =>
  String(value ?? '')
    .trim()
    .slice(0, maxLength);

const hasOwn = (object, key) =>
  Object.prototype.hasOwnProperty.call(object || {}, key);

function isSharedProject(project = {}) {
  return (
    SHARED_PROJECT_MARKERS.has(clean(project.shipNo, 60)) ||
    SHARED_CLIENT_MARKERS.has(clean(project.client, 100)) ||
    SHARED_SPEC_MARKERS.has(clean(project.spec, 300))
  );
}

function normalizeBooleanMap(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 5000)
      .map(([key, completed]) => [clean(key, 150), completed === true])
      .filter(([key]) => Boolean(key))
  );
}

function normalizeLifecycle(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const allowedStatuses = new Set([
    'in_progress',
    'production_complete',
    'delivered'
  ]);

  const status = clean(value.status, 40);

  return {
    status: allowedStatuses.has(status) ? status : 'in_progress',
    productionCompletedAt: clean(value.productionCompletedAt, 40),
    productionCompletedBy: clean(value.productionCompletedBy, 80),
    deliveredAt: clean(value.deliveredAt, 40),
    deliveredBy: clean(value.deliveredBy, 80)
  };
}

function normalizePortalState(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const normalized = {};

  if (hasOwn(value, 'assigneeProgress')) {
    normalized.assigneeProgress = normalizeBooleanMap(value.assigneeProgress);
  }

  if (hasOwn(value, 'lifecycle')) {
    normalized.lifecycle = normalizeLifecycle(value.lifecycle);
  }

  return normalized;
}

const createId = () =>
  `${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '')}`;

const nowIso = () => new Date().toISOString();

/**
 * 担当者IDを配列に統一します。
 *
 * 新形式:
 * employeeIds: ["社員ID1", "社員ID2"]
 *
 * 旧形式:
 * employeeId: "社員ID1"
 */
function normalizeEmployeeIds(project = {}) {
  const source = Array.isArray(project.employeeIds)
    ? project.employeeIds
    : project.employeeId
      ? [project.employeeId]
      : [];

  return [
    ...new Set(
      source
        .map(value => clean(value, 100))
        .filter(Boolean)
    )
  ].slice(0, 20);
}

/**
 * 既存データとの互換性を保ちながら、
 * 案件データの形式を統一します。
 *
 * employeeIdは旧フロント対応用として残し、
 * employeeIdsの先頭担当者を設定します。
 */
function normalizeProject(project = {}) {
  const employeeIds = normalizeEmployeeIds(project);
  const shared = isSharedProject(project);

  const normalized = {
    ...project,
    shipNo: clean(project.shipNo, 60),
    displayName: clean(project.displayName, 80),
    productName: clean(project.productName, 120),
    client: clean(project.client, 100),
    employeeIds,
    employeeId: employeeIds[0] || '',
    dueDate: clean(project.dueDate, 10),
    notes: cleanLongText(
      project.notes,
      shared ? SHARED_NOTES_LIMIT : NORMAL_NOTES_LIMIT
    ),
    quantity: Math.max(0, Number(project.quantity) || 0),
    spec: clean(project.spec, 300),
    completed: Boolean(project.completed)
  };

  if (hasOwn(project, 'assigneeProgress')) {
    normalized.assigneeProgress = normalizeBooleanMap(
      project.assigneeProgress
    );
  }

  if (hasOwn(project, 'lifecycle')) {
    normalized.lifecycle = normalizeLifecycle(project.lifecycle);
  }

  if (hasOwn(project, 'portalState')) {
    normalized.portalState = normalizePortalState(project.portalState);
  }

  return normalized;
}

function validateProject(input = {}) {
  const employeeIds = normalizeEmployeeIds(input);
  const shared = isSharedProject(input);

  const value = {
    shipNo: clean(input.shipNo, 60),
    displayName: clean(input.displayName, 80),
    productName: clean(input.productName, 120),
    client: clean(input.client, 100),
    employeeIds,
    employeeId: employeeIds[0] || '',
    dueDate: clean(input.dueDate, 10),
    notes: cleanLongText(
      input.notes,
      shared ? SHARED_NOTES_LIMIT : NORMAL_NOTES_LIMIT
    ),
    quantity: Math.max(0, Number(input.quantity) || 0),
    spec: clean(input.spec, 300),
    completed: Boolean(input.completed)
  };

  // 案件入力は空欄登録を許可します。
  // 納期は入力された場合だけ形式を確認します。
  if (
    value.dueDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(value.dueDate)
  ) {
    return { error: '納期の日付形式が正しくありません。' };
  }

  // 共有進捗・ステータスの追加項目を保持します。
  if (hasOwn(input, 'assigneeProgress')) {
    value.assigneeProgress = normalizeBooleanMap(
      input.assigneeProgress
    );
  }

  if (hasOwn(input, 'lifecycle')) {
    value.lifecycle = normalizeLifecycle(input.lifecycle);
  }

  if (hasOwn(input, 'portalState')) {
    value.portalState = normalizePortalState(input.portalState);
  }

  return value;
}

function sortProjects(projects) {
  return [...projects].sort((a, b) => {
    const dateA = clean(a.dueDate, 10);
    const dateB = clean(b.dueDate, 10);

    return (
      dateA.localeCompare(dateB) ||
      clean(a.shipNo, 60).localeCompare(clean(b.shipNo, 60), 'ja') ||
      clean(a.productName, 120).localeCompare(
        clean(b.productName, 120),
        'ja'
      )
    );
  });
}

async function readProjects(store) {
  const projects =
    (await store.get(PROJECTS_KEY, {
      type: 'json'
    })) || [];

  if (!Array.isArray(projects)) {
    return [];
  }

  return projects.map(normalizeProject);
}

async function readHistory(store) {
  const history =
    (await store.get(HISTORY_KEY, {
      type: 'json'
    })) || [];

  return Array.isArray(history) ? history : [];
}

async function readState(store, projects = []) {
  const saved =
    (await store.get(STATE_KEY, {
      type: 'json'
    })) || null;

  if (saved?.revision && saved?.updatedAt) {
    return saved;
  }

  const latestProjectTime = projects
    .map(project => project.updatedAt || project.createdAt || '')
    .filter(Boolean)
    .sort()
    .at(-1);

  return {
    revision: latestProjectTime || 'initial',
    updatedAt: latestProjectTime || null
  };
}

function createState() {
  const updatedAt = nowIso();

  return {
    revision: `${Date.now().toString(36)}_${crypto
      .randomUUID()
      .replaceAll('-', '')}`,
    updatedAt
  };
}

async function writeProjects(store, projects) {
  await store.setJSON(PROJECTS_KEY, sortProjects(projects));
}

async function writeState(store, state) {
  await store.setJSON(STATE_KEY, state);
}

async function writeHistory(store, history) {
  const limited = history
    .sort((a, b) =>
      String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    )
    .slice(0, HISTORY_LIMIT);

  await store.setJSON(HISTORY_KEY, limited);
}

/**
 * 操作者名を取得します。
 *
 * 今後public/app.jsからactorNameを送信します。
 * 現段階で送信されなかった場合は「光ポータル」として記録します。
 */
function getActor(input = {}, url = null) {
  const fromBody = clean(
    input.actorName ||
      input.updatedBy ||
      input.actor ||
      '',
    80
  );

  const fromQuery = url
    ? clean(url.searchParams.get('actorName') || '', 80)
    : '';

  return fromBody || fromQuery || '光ポータル';
}

function historyProjectSnapshot(project) {
  if (!project) {
    return null;
  }

  const normalized = normalizeProject(project);

  return {
    id: normalized.id,
    shipNo: normalized.shipNo,
    displayName: normalized.displayName,
    productName: normalized.productName,
    client: normalized.client,
    employeeIds: normalized.employeeIds,
    employeeId: normalized.employeeId,
    dueDate: normalized.dueDate,
    notes: normalized.notes,
    quantity: normalized.quantity,
    spec: normalized.spec,
    completed: normalized.completed,
    assigneeProgress: normalized.assigneeProgress || {},
    lifecycle: normalized.lifecycle || {},
    portalState: normalized.portalState || {}
  };
}

const CHANGE_FIELDS = [
  ['shipNo', '番船・案件番号'],
  ['displayName', '表示名'],
  ['productName', '製品名'],
  ['client', '得意先'],
  ['employeeIds', '担当者'],
  ['dueDate', '納期'],
  ['notes', 'メモ'],
  ['quantity', '数量'],
  ['spec', '仕様・備考'],
  ['completed', '完了状態'],
  ['assigneeProgress', '担当者進捗'],
  ['lifecycle', '案件ステータス'],
  ['portalState', '共有進捗・ステータス']
];

function valuesEqual(before, after) {
  if (
    Array.isArray(before) ||
    Array.isArray(after) ||
    (before && typeof before === 'object') ||
    (after && typeof after === 'object')
  ) {
    return JSON.stringify(before ?? null) === JSON.stringify(after ?? null);
  }

  return before === after;
}

function createChanges(before, after) {
  if (!before || !after) {
    return [];
  }

  return CHANGE_FIELDS.flatMap(([field, label]) => {
    const beforeValue = before[field];
    const afterValue = after[field];

    if (valuesEqual(beforeValue, afterValue)) {
      return [];
    }

    return [
      {
        field,
        label,
        before: beforeValue,
        after: afterValue
      }
    ];
  });
}

function createHistoryEntry({
  action,
  actorName,
  project,
  before = null,
  after = null,
  batchId = null
}) {
  const projectData =
    historyProjectSnapshot(project) ||
    historyProjectSnapshot(after) ||
    historyProjectSnapshot(before);

  return {
    id: createId(),
    batchId,
    projectId: projectData?.id || '',
    action,
    actorName: clean(actorName, 80) || '光ポータル',
    shipNo: projectData?.shipNo || '',
    displayName: projectData?.displayName || '',
    productName: projectData?.productName || '',
    before: historyProjectSnapshot(before),
    after: historyProjectSnapshot(after),
    changes: createChanges(
      historyProjectSnapshot(before),
      historyProjectSnapshot(after)
    ),
    createdAt: nowIso()
  };
}

async function saveAll({
  store,
  projects,
  history,
  state
}) {
  await writeProjects(store, projects);
  await writeHistory(store, history);
  await writeState(store, state);
}

function parseHistoryLimit(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 100;
  }

  return Math.min(500, Math.max(1, Math.trunc(number)));
}

export default async request => {
  const store = getStore({
    name: STORE,
    consistency: 'strong'
  });

  const url = new URL(request.url);

  try {
    let projects = await readProjects(store);

    /*
     * 更新確認専用
     *
     * GET /api/projects?mode=status
     *
     * public/app.jsから約30秒ごとに呼び出し、
     * revisionが変わっていれば更新通知を表示します。
     */
    if (
      request.method === 'GET' &&
      (url.searchParams.get('mode') === 'status' ||
        url.searchParams.get('status') === '1')
    ) {
      const state = await readState(store, projects);

      return reply({
        revision: state.revision,
        updatedAt: state.updatedAt,
        projectCount: projects.length
      });
    }

    /*
     * 更新履歴取得
     *
     * GET /api/projects?history=1
     * GET /api/projects?history=1&projectId=案件ID
     * GET /api/projects?history=1&limit=100
     */
    if (
      request.method === 'GET' &&
      url.searchParams.get('history') === '1'
    ) {
      const projectId = clean(
        url.searchParams.get('projectId'),
        150
      );

      const limit = parseHistoryLimit(
        url.searchParams.get('limit')
      );

      let history = await readHistory(store);

      if (projectId) {
        history = history.filter(
          item => item.projectId === projectId
        );
      }

      history = history
        .sort((a, b) =>
          String(b.createdAt || '').localeCompare(
            String(a.createdAt || '')
          )
        )
        .slice(0, limit);

      const state = await readState(store, projects);

      return reply({
        history,
        revision: state.revision,
        updatedAt: state.updatedAt
      });
    }

    /*
     * 案件一覧取得
     */
    if (request.method === 'GET') {
      const state = await readState(store, projects);

      return reply({
        projects: sortProjects(projects),
        revision: state.revision,
        updatedAt: state.updatedAt
      });
    }

    /*
     * 案件登録
     */
    if (request.method === 'POST') {
      const input = await request.json();
      const actorName = getActor(input, url);
      const createdAt = nowIso();
      const batchId = createId();

      /*
       * Excel取込などの一括登録
       */
      if (Array.isArray(input.projects)) {
        if (
          input.projects.length < 1 ||
          input.projects.length > 200
        ) {
          return reply(
            {
              error:
                '一度に登録できる明細は1〜200件です。'
            },
            400
          );
        }

        const createdProjects = [];

        for (let index = 0; index < input.projects.length; index++) {
          const raw = input.projects[index];
          const validated = validateProject(raw);

          if (validated.error) {
            return reply(
              {
                error: `${index + 1}件目：${validated.error}`
              },
              400
            );
          }

          createdProjects.push({
            id: createId(),
            ...validated,
            createdAt,
            updatedAt: createdAt
          });
        }

        projects.push(...createdProjects);

        const history = await readHistory(store);

        const newHistory = createdProjects.map(project =>
          createHistoryEntry({
            action: 'create',
            actorName,
            project,
            before: null,
            after: project,
            batchId
          })
        );

        const state = createState();

        await saveAll({
          store,
          projects,
          history: [...newHistory, ...history],
          state
        });

        return reply(
          {
            projects: createdProjects,
            revision: state.revision,
            updatedAt: state.updatedAt
          },
          201
        );
      }

      /*
       * 1件登録
       */
      const validated = validateProject(input);

      if (validated.error) {
        return reply(validated, 400);
      }

      const project = {
        id: createId(),
        ...validated,
        createdAt,
        updatedAt: createdAt
      };

      projects.push(project);

      const history = await readHistory(store);

      history.unshift(
        createHistoryEntry({
          action: 'create',
          actorName,
          project,
          before: null,
          after: project
        })
      );

      const state = createState();

      await saveAll({
        store,
        projects,
        history,
        state
      });

      return reply(
        {
          project,
          revision: state.revision,
          updatedAt: state.updatedAt
        },
        201
      );
    }

    /*
     * 案件更新・完了切替
     */
    if (request.method === 'PUT') {
      const input = await request.json();
      const projectId = clean(input.id, 150);
      const index = projects.findIndex(
        project => project.id === projectId
      );

      if (index < 0) {
        return reply(
          {
            error: '案件が見つかりません。'
          },
          404
        );
      }

      const actorName = getActor(input, url);
      const before = normalizeProject(projects[index]);
      let action = 'update';

      if (input.action === 'toggle') {
        action = before.completed ? 'reopen' : 'complete';

        projects[index] = {
          ...before,
          completed: !before.completed,
          updatedAt: nowIso()
        };
      } else {
        const validated = validateProject(input);

        if (validated.error) {
          return reply(validated, 400);
        }

        const updated = {
          ...before,
          ...validated,
          id: before.id,
          createdAt: before.createdAt,
          updatedAt: nowIso()
        };

        // 部分的な更新で、送信されなかった共有項目を消さない。
        if (!hasOwn(input, 'assigneeProgress')) {
          updated.assigneeProgress = before.assigneeProgress || {};
        }
        if (!hasOwn(input, 'lifecycle')) {
          updated.lifecycle = before.lifecycle || {};
        }
        if (!hasOwn(input, 'portalState')) {
          updated.portalState = before.portalState || {};
        }

        projects[index] = updated;
      }

      const after = normalizeProject(projects[index]);
      const history = await readHistory(store);

      history.unshift(
        createHistoryEntry({
          action,
          actorName,
          project: after,
          before,
          after
        })
      );

      const state = createState();

      await saveAll({
        store,
        projects,
        history,
        state
      });

      return reply({
        project: after,
        revision: state.revision,
        updatedAt: state.updatedAt
      });
    }

    /*
     * 案件削除
     *
     * 1件:
     * DELETE /api/projects?id=案件ID
     *
     * 複数:
     * DELETE /api/projects?ids=ID1,ID2,ID3
     */
    if (request.method === 'DELETE') {
      const singleId = clean(
        url.searchParams.get('id'),
        150
      );

      const multipleIds = String(
        url.searchParams.get('ids') || ''
      )
        .split(',')
        .map(value => clean(value, 150))
        .filter(Boolean);

      const targetIds = [
        ...new Set([
          ...(singleId ? [singleId] : []),
          ...multipleIds
        ])
      ];

      if (!targetIds.length) {
        return reply(
          {
            error: '削除する案件が指定されていません。'
          },
          400
        );
      }

      const deletedProjects = projects.filter(project =>
        targetIds.includes(project.id)
      );

      if (!deletedProjects.length) {
        return reply(
          {
            error: '案件が見つかりません。'
          },
          404
        );
      }

      projects = projects.filter(
        project => !targetIds.includes(project.id)
      );

      const actorName = getActor({}, url);
      const batchId =
        deletedProjects.length > 1 ? createId() : null;

      const history = await readHistory(store);

      const deleteHistory = deletedProjects.map(project =>
        createHistoryEntry({
          action: 'delete',
          actorName,
          project,
          before: project,
          after: null,
          batchId
        })
      );

      const state = createState();

      await saveAll({
        store,
        projects,
        history: [...deleteHistory, ...history],
        state
      });

      return reply({
        ok: true,
        deletedCount: deletedProjects.length,
        deletedIds: deletedProjects.map(
          project => project.id
        ),
        revision: state.revision,
        updatedAt: state.updatedAt
      });
    }

    return reply(
      {
        error: '対応していない操作です。'
      },
      405
    );
  } catch (error) {
    console.error(error);

    return reply(
      {
        error:
          error instanceof Error && error.message
            ? error.message
            : '案件データを処理できませんでした。'
      },
      500
    );
  }
};

export const config = {
  path: '/api/projects'
};
