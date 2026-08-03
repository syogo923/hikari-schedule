/* 光ポータル Ver3.2.2 Network Edition - 二重登録防止修正版 */
/* Ver3.0 RC: code cleanup phase */
// Ver3.0β4 - Safe Refactoring
// Ver3.0β3 - Safe Refactoring
/* 光ポータル Ver3.0β2 - Safe Refactoring
   - コメント整理
   - セクション整理
   - 動作変更なし
*/

// ==========================================
// 光ポータル Ver3.0β1 リファクタリング版
// 安全なリファクタリングのみ実施
// ==========================================

'use strict';

const API = {
  projects: '/api/projects',
  masters: '/api/masters',
  excel: '/api/excel-import'
};

const STORAGE_ACTOR_ID = 'hikariPortal.actorEmployeeId';
const STORAGE_MATERIALS = 'hikariPortal.materialMasters.v1';
const STORAGE_ASSIGNEE_PROGRESS = 'hikariPortal.assigneeProgress.v1';
const STORAGE_TRASH = 'hikariPortal.projectTrash.v1';
const STORAGE_PROJECT_LIFECYCLE = 'hikariPortal.projectLifecycle.v1';
const STORAGE_INTERNAL_SCHEDULES = 'hikariPortal.internalSchedules.v1';
const STORAGE_STICKY_NOTES = 'hikariPortal.stickyNotes.v1';
const SHARED_PORTAL_SHIP_NO = 'SYS.PORTAL';
const SHARED_PORTAL_CLIENT = '__HIKARI_PORTAL_SHARED_STATE__';
const SHARED_PORTAL_SPEC = 'HIKARI_PORTAL_SHARED_STATE_V1';
const STATUS_SHARED_SHIP_NO = 'SYS.PORTAL.STATUS';
const STATUS_SHARED_CLIENT = '__HIKARI_PORTAL_STATUS_STATE__';
const STATUS_SHARED_SPEC = 'HIKARI_PORTAL_STATUS_STATE_V1';
const MATERIAL_SHARED_SHIP_NO = 'SYS.PORTAL.MATERIAL';
const MATERIAL_SHARED_CLIENT = '__HIKARI_PORTAL_MATERIAL_STATE__';
const MATERIAL_SHARED_SPEC = 'HIKARI_PORTAL_MATERIAL_STATE_V1';
const POLL_INTERVAL = 10000;
const API_TIMEOUT_MS = 15000;
const API_GET_RETRY_COUNT = 1;
const SEARCH_DEBOUNCE_MS = 160;

const S = {
  projects: [],
  masters: { employees: [], clients: [], displayNames: [], products: [] },
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  q: '',
  importItems: [],
  pendingDeleteId: '',
  selectedProjectIds: new Set(),
  actorEmployeeId: localStorage.getItem(STORAGE_ACTOR_ID) || '',
  revision: '',
  history: [],
  historyLoaded: false,
  pendingRemoteUpdate: false,
  pollTimer: null,
  materials: [],
  assigneeProgress: {},
  trash: [],
  projectLifecycle: {},
  internalSchedules: [],
  stickyNotes: {},
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  calendarQ: '',
  calendarEmployeeId: '',
  calendarStatusFilter: '',
  deadlineEmployeeId: '',
  deadlineStatusFilter: '',
  sharedPortalProjectId: '',
  statusSharedProjectId: '',
  materialSharedProjectId: '',
  autoSyncing: false,
  sharedWritePending: 0,
  lastAutoSyncAt: ''
};

// 共有データの書き込みを直列化し、同時保存による上書きを防ぐ。
let sharedPortalWriteQueue = Promise.resolve();

const $ = id => byId(id);
const fd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const jp = value => value ? new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${value}T00:00:00`)) : '—';
const jpDateTime = value => value ? new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';

function toast(message) {
  const node = $('toast');
  if (!node) return;
  node.textContent = message;
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.classList.add('show');
  clearTimeout(toast.timer);
  const duration = String(message || '').length > 36 ? 4200 : 2600;
  toast.timer = setTimeout(() => node.classList.remove('show'), duration);
}

function portalConfirm({
  title = '確認', message = '', detail = '', note = '',
  confirmText = '実行する', cancelText = 'キャンセル',
  tone = 'primary', icon = '✓'
} = {}) {
  const dialog = $('portalConfirmDialog');
  if (!dialog) return Promise.resolve(window.confirm(message || title));
  const titleNode = $('portalConfirmTitle');
  const messageNode = $('portalConfirmMessage');
  const detailNode = $('portalConfirmDetail');
  const noteNode = $('portalConfirmNote');
  const iconNode = $('portalConfirmIcon');
  const okButton = $('portalConfirmOk');
  const cancelButton = $('portalConfirmCancel');
  titleNode.textContent = title;
  messageNode.textContent = message;
  detailNode.textContent = detail;
  detailNode.hidden = !detail;
  noteNode.textContent = note;
  noteNode.hidden = !note;
  iconNode.textContent = icon;
  okButton.textContent = confirmText;
  cancelButton.textContent = cancelText;
  dialog.classList.toggle('is-danger', tone === 'danger');
  dialog.classList.toggle('is-warning', tone === 'warning');
  okButton.className = tone === 'danger' ? 'danger' : 'primary';
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      okButton.removeEventListener('click', onOk);
      cancelButton.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onNativeCancel);
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      resolve(result);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onNativeCancel = event => { event.preventDefault(); finish(false); };
    const onClose = () => finish(false);
    okButton.addEventListener('click', onOk);
    cancelButton.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onNativeCancel);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
    requestAnimationFrame(() => okButton.focus());
  });
}

// ==========================
// Danger Confirmation Helpers
// ==========================

// ===== Danger Confirm Helpers =====
// ===== Danger Confirm Helpers =====
// ===== Danger Confirm Helpers =====
// ===== Danger Confirm Helpers =====
// ===== Danger Confirm Helpers =====
function confirmDangerAction(options) {
  return portalConfirm({
    tone: 'danger',
    icon: '！',
    ...options
  });
}

/* ===== 共通ユーティリティ ===== */

// ===== 共通ユーティリティ =====

function byId(id){ return document.getElementById(id); }
function isNil(v){ return v===null || v===undefined; }

function safeTrim(v){ return isNil(v) ? '' : String(v).trim(); }
const API_EMPTY_TEXT = '\u200B';
function stripApiEmptyText(v){ return String(v ?? '').replace(/\u200B/g, ''); }
function apiTextOrEmptyPlaceholder(v){ return safeTrim(v) || API_EMPTY_TEXT; }
async function api(url, options = {}) {
  const method = options.method || 'GET';
  const maxAttempts = method === 'GET' ? API_GET_RETRY_COUNT + 1 : 1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method,
        headers: options.body ? { 'content-type': 'application/json' } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
        cache: 'no-store',
        signal: controller.signal
      });

      let data = {};
      try { data = await response.json(); } catch {}

      if (!response.ok) {
        const error = new Error(data.error || `通信に失敗しました。（${response.status}）`);
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      lastError = error;
      const retryable =
        method === 'GET' &&
        attempt < maxAttempts &&
        (error.name === 'AbortError' || !error.status || error.status >= 500);

      if (!retryable) {
        if (error.name === 'AbortError') {
          throw new Error('通信がタイムアウトしました。もう一度お試しください。');
        }
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error('通信に失敗しました。');
}
// ===== Common Utility Helpers =====
const activeFormSubmissions = new WeakSet();
const recentSubmissionSignatures = new Map();

function formSubmitButton(form) {
  return form?.querySelector('button[type="submit"], input[type="submit"]') || null;
}

function beginFormSubmission(form, savingText = '保存中…') {
  if (!form || activeFormSubmissions.has(form)) return null;

  activeFormSubmissions.add(form);
  const button = formSubmitButton(form);
  const state = {
    button,
    disabled: button?.disabled ?? false,
    text: button
      ? (button.tagName === 'INPUT' ? button.value : button.textContent)
      : ''
  };

  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (button.tagName === 'INPUT') button.value = savingText;
    else button.textContent = savingText;
  }

  return state;
}

function endFormSubmission(form, state) {
  if (state?.button) {
    state.button.disabled = state.disabled;
    state.button.removeAttribute('aria-busy');
    if (state.button.tagName === 'INPUT') state.button.value = state.text;
    else state.button.textContent = state.text;
  }
  if (form) activeFormSubmissions.delete(form);
}

function isRecentDuplicateSubmission(key, windowMs = 3000) {
  const now = Date.now();
  const previous = recentSubmissionSignatures.get(key) || 0;

  for (const [storedKey, timestamp] of recentSubmissionSignatures.entries()) {
    if (now - timestamp > Math.max(windowMs, 10000)) {
      recentSubmissionSignatures.delete(storedKey);
    }
  }

  if (previous && now - previous < windowMs) return true;
  recentSubmissionSignatures.set(key, now);
  return false;
}


function debounce(fn, wait = SEARCH_DEBOUNCE_MS) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function isBlank(v){ return safeTrim(v)===''; }
function isPresent(v){ return !isBlank(v); }
function coalesce(v, fallback){ return isNil(v) ? fallback : v; }


function isScheduleMemoSharedProject(project) {
  return project?.shipNo === SHARED_PORTAL_SHIP_NO &&
    (project?.client === SHARED_PORTAL_CLIENT || project?.spec === SHARED_PORTAL_SPEC);
}

function isStatusSharedProject(project) {
  return project?.shipNo === STATUS_SHARED_SHIP_NO &&
    (project?.client === STATUS_SHARED_CLIENT || project?.spec === STATUS_SHARED_SPEC);
}


function isMaterialSharedProject(project) {
  return project?.shipNo === MATERIAL_SHARED_SHIP_NO &&
    (
      project?.client === MATERIAL_SHARED_CLIENT ||
      project?.spec === MATERIAL_SHARED_SPEC
    );
}

function isSharedPortalProject(project) {
  return isScheduleMemoSharedProject(project) ||
    isStatusSharedProject(project) ||
    isMaterialSharedProject(project);
}

function parseSharedPortalState(project) {
  if (!project) return null;
  try {
    const parsed = JSON.parse(String(project.notes || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}


function applySharedPortalState(project) {
  const state = parseSharedPortalState(project);
  if (!state) return false;
  S.sharedPortalProjectId = project.id || '';
  applySharedPortalStateObject(state);
  return true;
}


function parseStatusSharedState(project) {
  if (!project) return null;
  try {
    const parsed = JSON.parse(String(project.notes || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeStatusSharedState(state = {}) {
  return {
    version: 1,
    updatedAt: safeTrim(state.updatedAt),
    assigneeProgress:
      state.assigneeProgress &&
      typeof state.assigneeProgress === 'object' &&
      !Array.isArray(state.assigneeProgress)
        ? Object.fromEntries(
            Object.entries(state.assigneeProgress).map(([projectId, value]) => [
              projectId,
              { ...(value || {}) }
            ])
          )
        : {},
    projectLifecycle:
      state.projectLifecycle &&
      typeof state.projectLifecycle === 'object' &&
      !Array.isArray(state.projectLifecycle)
        ? Object.fromEntries(
            Object.entries(state.projectLifecycle).map(([projectId, value]) => [
              projectId,
              { ...(value || {}) }
            ])
          )
        : {}
  };
}

function applyStatusSharedState(project) {
  const state = normalizeStatusSharedState(parseStatusSharedState(project) || {});
  S.statusSharedProjectId = project?.id || '';

  S.assigneeProgress = state.assigneeProgress;
  S.projectLifecycle = state.projectLifecycle;
  saveAssigneeProgress();
  saveProjectLifecycle();
  return true;
}

function statusSharedStateBody(state = {}) {
  const employeeId = sharedPortalEmployeeId();
  if (!employeeId) throw new Error('共有保存には社員マスタが1名以上必要です。');

  const normalized = normalizeStatusSharedState(state);
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    assigneeProgress: normalized.assigneeProgress,
    projectLifecycle: normalized.projectLifecycle
  };

  return {
    id: S.statusSharedProjectId || '',
    shipNo: STATUS_SHARED_SHIP_NO,
    displayName: '進捗・ステータス共有設定',
    productName: '進捗共有データ',
    client: STATUS_SHARED_CLIENT,
    employeeIds: [employeeId],
    employeeId,
    dueDate: '2099-12-31',
    notes: JSON.stringify(payload),
    quantity: 0,
    spec: STATUS_SHARED_SPEC,
    completed: false,
    ...actorPayload()
  };
}

async function fetchLatestStatusSharedProject() {
  const data = await api(API.projects);
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const statusProject = projects.find(isStatusSharedProject) || null;
  if (statusProject?.id) S.statusSharedProjectId = String(statusProject.id);
  return {
    statusProject,
    revision: data.revision ?? data.updatedAt ?? '',
    projects
  };
}

async function writeStatusSharedState(state, existingProject = null) {
  const result = await api(API.projects, {
    method: existingProject ? 'PUT' : 'POST',
    body: statusSharedStateBody(state)
  });

  const createdId = result?.project?.id || result?.item?.id || result?.id || '';
  if (!existingProject && createdId) S.statusSharedProjectId = String(createdId);
  return result;
}

async function ensureScheduleMemoRecordPreserved(snapshot) {
  const latest = await api(API.projects);
  const scheduleProject = (latest.projects || []).find(isScheduleMemoSharedProject) || null;
  const current = normalizedSharedPortalState(parseSharedPortalState(scheduleProject) || {});

  if (scheduleProject && JSON.stringify(current) === JSON.stringify(normalizedSharedPortalState(snapshot))) {
    S.sharedPortalProjectId = String(scheduleProject.id || '');
    return true;
  }

  S.sharedPortalProjectId = scheduleProject?.id ? String(scheduleProject.id) : '';
  await api(API.projects, {
    method: scheduleProject ? 'PUT' : 'POST',
    body: sharedPortalStateBody(snapshot)
  });

  const verified = await api(API.projects);
  const verifiedProject = (verified.projects || []).find(isScheduleMemoSharedProject) || null;
  const verifiedState = normalizedSharedPortalState(parseSharedPortalState(verifiedProject) || {});
  if (!verifiedProject || JSON.stringify(verifiedState) !== JSON.stringify(normalizedSharedPortalState(snapshot))) {
    throw new Error('社内予定・メモの共有レコードを保護できませんでした。');
  }
  S.sharedPortalProjectId = String(verifiedProject.id || '');
  return true;
}

async function ensureStatusRecordPreserved(snapshot) {
  const latest = await api(API.projects);
  const statusProject = (latest.projects || []).find(isStatusSharedProject) || null;
  const current = normalizeStatusSharedState(parseStatusSharedState(statusProject) || {});
  const expected = normalizeStatusSharedState(snapshot);

  if (statusProject && JSON.stringify(current) === JSON.stringify(expected)) {
    S.statusSharedProjectId = String(statusProject.id || '');
    return true;
  }

  S.statusSharedProjectId = statusProject?.id ? String(statusProject.id) : '';
  await writeStatusSharedState(expected, statusProject);

  const verified = await api(API.projects);
  const verifiedProject = (verified.projects || []).find(isStatusSharedProject) || null;
  const verifiedState = normalizeStatusSharedState(parseStatusSharedState(verifiedProject) || {});
  if (!verifiedProject || JSON.stringify(verifiedState) !== JSON.stringify(expected)) {
    throw new Error('進捗・ステータス共有レコードを保護できませんでした。');
  }
  S.statusSharedProjectId = String(verifiedProject.id || '');
  return true;
}

function sharedPortalEmployeeId() {
  if (S.actorEmployeeId && employee(S.actorEmployeeId)?.active !== false) return S.actorEmployeeId;
  return ordered('employees').find(item => item.active !== false)?.id || '';
}



function sharedPortalStateBody(sharedState = {}) {
  const employeeId = sharedPortalEmployeeId();
  if (!employeeId) throw new Error('共有保存には社員マスタが1名以上必要です。');

  const state = {
    version: 3,
    updatedAt: new Date().toISOString(),
    internalSchedules: Array.isArray(sharedState.internalSchedules)
      ? sharedState.internalSchedules
      : [],
    stickyNotes:
      sharedState.stickyNotes &&
      typeof sharedState.stickyNotes === 'object' &&
      !Array.isArray(sharedState.stickyNotes)
        ? sharedState.stickyNotes
        : {}
  };

  return {
    id: S.sharedPortalProjectId || '',
    shipNo: SHARED_PORTAL_SHIP_NO,
    displayName: 'ポータル共有設定',
    productName: '共有データ',
    client: SHARED_PORTAL_CLIENT,
    employeeIds: [employeeId],
    employeeId,
    dueDate: '2099-12-31',
    notes: JSON.stringify(state),
    quantity: 0,
    spec: SHARED_PORTAL_SPEC,
    completed: false,
    ...actorPayload()
  };
}

function hasLocalSharedPortalState() {
  return S.internalSchedules.length > 0 ||
    Object.keys(S.stickyNotes).length > 0 ||
    Object.keys(S.assigneeProgress).length > 0 ||
    Object.keys(S.projectLifecycle).length > 0;
}



function sharedPortalStateSnapshot() {
  return {
    internalSchedules: S.internalSchedules.map(item => ({ ...item, dates: [...(item.dates || [])] })),
    stickyNotes: { ...S.stickyNotes },
    assigneeProgress: Object.fromEntries(
      Object.entries(S.assigneeProgress).map(([projectId, progress]) => [projectId, { ...(progress || {}) }])
    ),
    projectLifecycle: Object.fromEntries(
      Object.entries(S.projectLifecycle).map(([projectId, lifecycle]) => [projectId, { ...(lifecycle || {}) }])
    )
  };
}


function normalizedSharedPortalState(state = {}) {
  return {
    internalSchedules: Array.isArray(state.internalSchedules)
      ? state.internalSchedules.map(normalizeInternalSchedule)
      : [],
    stickyNotes:
      state.stickyNotes &&
      typeof state.stickyNotes === 'object' &&
      !Array.isArray(state.stickyNotes)
        ? { ...state.stickyNotes }
        : {},
    assigneeProgress: {},
    projectLifecycle: {}
  };
}


function applySharedPortalStateObject(state = {}) {
  const normalized = normalizedSharedPortalState(state);

  // 共有管理レコードは社内予定と日付メモだけを反映する。
  // 担当者進捗・製作完了・納品完了は各案件本体へ保存する。
  S.internalSchedules = normalized.internalSchedules;
  S.stickyNotes = normalized.stickyNotes;

  localStorage.setItem(STORAGE_INTERNAL_SCHEDULES, JSON.stringify(S.internalSchedules));
  localStorage.setItem(STORAGE_STICKY_NOTES, JSON.stringify(S.stickyNotes));
}

async function fetchLatestSharedPortalProject() {
  const data = await api(API.projects);
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const sharedProject = projects.find(isSharedPortalProject) || null;
  if (sharedProject?.id) S.sharedPortalProjectId = String(sharedProject.id);
  return { sharedProject, revision: data.revision ?? data.updatedAt ?? '' };
}



function queueSharedPortalWrite(task) {
  const run = sharedPortalWriteQueue
    .catch(() => undefined)
    .then(async () => {
      S.sharedWritePending += 1;
      updateSyncStatus('保存中…', 'saving');
      try {
        const value = await task();
        updateSyncStatus('保存済み', 'ready');
        return value;
      } catch (error) {
        updateSyncStatus('通信エラー', 'error');
        throw error;
      } finally {
        S.sharedWritePending = Math.max(0, S.sharedWritePending - 1);
        if (S.sharedWritePending === 0 && !$('syncStatus')?.classList.contains('is-error')) {
          setTimeout(() => updateSyncStatus('更新', 'ready'), 900);
        }
      }
    });
  sharedPortalWriteQueue = run.catch(() => undefined);
  return run;
}





async function persistSharedPortalMutation(mutator) {
  return queueSharedPortalWrite(async () => {
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const allBefore = await api(API.projects);
        const sharedProject =
          (allBefore.projects || []).find(isScheduleMemoSharedProject) ||
          null;

        if (sharedProject?.id) {
          S.sharedPortalProjectId = String(sharedProject.id);
        }

        const merged = normalizedSharedPortalState(
          parseSharedPortalState(sharedProject) || {}
        );
        await mutator(merged);

        const result = await api(API.projects, {
          method: sharedProject ? 'PUT' : 'POST',
          body: sharedPortalStateBody(merged)
        });

        const confirmedData = await api(API.projects);
        const confirmedProject =
          (confirmedData.projects || []).find(isScheduleMemoSharedProject) ||
          null;

        if (!confirmedProject) {
          throw new Error('社内予定・メモ共有レコードを確認できませんでした。');
        }

        const confirmedState = normalizedSharedPortalState(
          parseSharedPortalState(confirmedProject) || {}
        );
        const expectedState = normalizedSharedPortalState(merged);

        if (JSON.stringify(confirmedState) !== JSON.stringify(expectedState)) {
          if (attempt < 3) continue;
          throw new Error(
            'ほかのPCと同時更新されたため、保存を再確認できませんでした。'
          );
        }

        S.sharedPortalProjectId = String(confirmedProject.id || '');
        applySharedPortalStateObject(confirmedState);
        S.revision = String(
          confirmedData.revision ??
          confirmedData.updatedAt ??
          result?.revision ??
          result?.updatedAt ??
          S.revision ??
          ''
        );
        return true;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise(resolve =>
            setTimeout(resolve, 180 * attempt)
          );
          continue;
        }
      }
    }

    throw lastError || new Error('共有データを保存できませんでした。');
  });
}

async function upsertSharedInternalSchedule(schedule) {
  const normalized = normalizeInternalSchedule(schedule);
  return persistSharedPortalMutation(state => {
    const index = state.internalSchedules.findIndex(item => item.id === normalized.id);
    if (index >= 0) state.internalSchedules[index] = normalized;
    else state.internalSchedules.push(normalized);
  });
}

async function deleteSharedInternalSchedule(scheduleId) {
  return persistSharedPortalMutation(state => {
    state.internalSchedules = state.internalSchedules.filter(item => item.id !== scheduleId);
  });
}

async function saveSharedStickyNote(date, text) {
  return persistSharedPortalMutation(state => {
    const value = safeTrim(text);
    if (value) state.stickyNotes[date] = value;
    else delete state.stickyNotes[date];
  });
}



async function saveSharedProjectRecord(projectId) {
  return persistSharedProjectState(projectId);
}

function localPortalBackupPayload() {
  return {
    format: 'hikari-portal-local-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    sourceActor: employeeName(S.actorEmployeeId),
    internalSchedules: S.internalSchedules.map(item => ({ ...normalizeInternalSchedule(item) })),
    stickyNotes: { ...S.stickyNotes },
    assigneeProgress: Object.fromEntries(
      Object.entries(S.assigneeProgress).map(([id, value]) => [id, { ...(value || {}) }])
    ),
    projectLifecycle: Object.fromEntries(
      Object.entries(S.projectLifecycle).map(([id, value]) => [id, { ...(value || {}) }])
    )
  };
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportLocalPortalData() {
  const actor = safeTrim(employeeName(S.actorEmployeeId)).replace(/[\\/:*?"<>|]/g, '_') || 'PC';
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  downloadJsonFile(`光ポータル旧データ_${actor}_${stamp}.json`, localPortalBackupPayload());
  toast('このPCの旧データを書き出しました');
}

function mergeLifecycleValue(current = {}, incoming = {}) {
  const rank = { in_progress: 0, production_complete: 1, delivered: 2 };
  return (rank[incoming.status] ?? 0) > (rank[current.status] ?? 0)
    ? { ...incoming }
    : { ...current };
}

function mergePortalBackupIntoState(state, backup = {}) {
  const schedules = Array.isArray(backup.internalSchedules) ? backup.internalSchedules : [];
  schedules.map(normalizeInternalSchedule).forEach(schedule => {
    const index = state.internalSchedules.findIndex(item => item.id === schedule.id);
    if (index < 0) state.internalSchedules.push(schedule);
    else {
      const current = state.internalSchedules[index];
      state.internalSchedules[index] = {
        ...current,
        ...schedule,
        dates: [...new Set([...(current.dates || []), ...(schedule.dates || [])])].sort()
      };
    }
  });

  const notes = backup.stickyNotes && typeof backup.stickyNotes === 'object' ? backup.stickyNotes : {};
  Object.entries(notes).forEach(([date, value]) => {
    const incoming = safeTrim(value);
    if (!incoming) return;
    const current = safeTrim(state.stickyNotes[date]);
    if (!current) state.stickyNotes[date] = incoming;
    else if (current !== incoming) state.stickyNotes[date] = [...new Set([current, incoming])].join(' ／ ');
  });

  const progress = backup.assigneeProgress && typeof backup.assigneeProgress === 'object' ? backup.assigneeProgress : {};
  Object.entries(progress).forEach(([projectId, values]) => {
    const current = state.assigneeProgress[projectId] || {};
    state.assigneeProgress[projectId] = { ...current };
    Object.entries(values || {}).forEach(([employeeId, completed]) => {
      state.assigneeProgress[projectId][employeeId] = current[employeeId] === true || completed === true;
    });
  });

  const lifecycle = backup.projectLifecycle && typeof backup.projectLifecycle === 'object' ? backup.projectLifecycle : {};
  Object.entries(lifecycle).forEach(([projectId, value]) => {
    state.projectLifecycle[projectId] = mergeLifecycleValue(state.projectLifecycle[projectId] || {}, value || {});
  });
}

async function importAndMergePortalBackups(files) {
  const list = [...files];
  if (!list.length) return toast('結合するJSONファイルを選択してください。');

  const backups = [];
  for (const file of list) {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error(`${file.name} を読み込めませんでした。`);
    }
    if (!parsed || typeof parsed !== 'object') throw new Error(`${file.name} の形式が正しくありません。`);
    backups.push(parsed);
  }

  await persistSharedPortalMutation(state => {
    backups.forEach(backup => mergePortalBackupIntoState(state, backup));
  });

  renderSchedule();
  renderCalendar();
  renderDeadlines();
  renderInternalScheduleList();
  toast(`${backups.length}台分のデータを共有へ結合しました`);
}


async function persistSharedPortalPatch(patch = {}) {
  return persistSharedPortalMutation(state => {
    if (Object.prototype.hasOwnProperty.call(patch, 'internalSchedules')) {
      state.internalSchedules = patch.internalSchedules.map(normalizeInternalSchedule);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'stickyNotes')) {
      state.stickyNotes = { ...(patch.stickyNotes || {}) };
    }

    // 担当者進捗と案件ステータスは案件本体へ保存する。
  });
}

async function persistSharedPortalState() {
  return persistSharedPortalPatch({
    internalSchedules: S.internalSchedules,
    stickyNotes: S.stickyNotes,
    assigneeProgress: S.assigneeProgress,
    projectLifecycle: S.projectLifecycle
  });
}

function loadInternalTools() {
  try {
    const schedules = JSON.parse(localStorage.getItem(STORAGE_INTERNAL_SCHEDULES) || '[]');
    S.internalSchedules = Array.isArray(schedules) ? schedules : [];
  } catch { S.internalSchedules = []; }
  try {
    const notes = JSON.parse(localStorage.getItem(STORAGE_STICKY_NOTES) || '{}');
    S.stickyNotes = notes && typeof notes === 'object' && !Array.isArray(notes) ? notes : {};
  } catch { S.stickyNotes = {}; }
}


async function saveInternalSchedules(changedSchedule = null) {
  localStorage.setItem(STORAGE_INTERNAL_SCHEDULES, JSON.stringify(S.internalSchedules));
  if (changedSchedule) await upsertSharedInternalSchedule(changedSchedule);
  else await persistSharedPortalPatch({ internalSchedules: S.internalSchedules });
  renderSchedule();
  renderCalendar();
  renderInternalScheduleList();
}


async function saveStickyNotes(changedDate = '') {
  localStorage.setItem(STORAGE_STICKY_NOTES, JSON.stringify(S.stickyNotes));
  if (changedDate) await saveSharedStickyNote(changedDate, S.stickyNotes[changedDate] || '');
  else await persistSharedPortalPatch({ stickyNotes: S.stickyNotes });
  renderSchedule();
}

function normalizeInternalSchedule(item = {}) {
  // 旧版の「毎週」予定は、読み込み時に単発扱いへは変換せず一覧に残す。
  // 編集・新規登録時は monthly / yearly / once のみを使用する。
  return {
    id: item.id || `internal-${Date.now()}`,
    title: safeTrim(item.title),
    type: ['monthly', 'yearly', 'once'].includes(item.type) ? item.type : 'once',
    day: Number(item.day || 1),
    month: Number(item.month || 1),
    date: item.date || '',
    dates: [...new Set((Array.isArray(item.dates) ? item.dates : [item.date]).filter(Boolean))].sort(),
    time: item.time || '',
    note: safeTrim(item.note)
  };
}

function internalSchedulesForDate(date) {
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return [];
  return S.internalSchedules.map(normalizeInternalSchedule).filter(item => {
    if (item.type === 'once') return item.dates.includes(date);
    if (item.type === 'yearly') {
      return Number(item.month) === target.getMonth() + 1 && Number(item.day) === target.getDate();
    }
    return Number(item.day) === target.getDate();
  });
}

function internalScheduleTypeLabel(item) {
  if (item.type === 'once') return item.dates.length ? item.dates.map(jp).join('・') : '日付未設定';
  if (item.type === 'yearly') return `毎年${Number(item.month) || 1}月${Number(item.day) || 1}日`;
  return `毎月${Number(item.day) || 1}日`;
}

function internalScheduleHtml(date) {
  const items = internalSchedulesForDate(date);
  if (!items.length) return '<button type="button" class="internal-empty" data-open-internal-schedule>＋</button>';
  return items.map(item => `<button type="button" class="internal-event" data-open-internal-schedule data-internal-id="${esc(item.id)}"><small>${esc(item.time || '')}${item.type !== 'once' ? ` ${esc(internalScheduleTypeLabel(item))}` : ''}</small><strong>${esc(item.title)}</strong>${item.note ? `<span>${esc(item.note)}</span>` : ''}</button>`).join('');
}

function stickyNoteCellHtml(date) {
  const text = safeTrim(S.stickyNotes[date]);
  const label = text ? `メモあり：${text}` : 'メモを入力';
  return `<button type="button" class="date-memo-button ${text ? 'has-note' : ''}" data-sticky-date="${esc(date)}" title="${esc(label)}" aria-label="${esc(label)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5h11A2.5 2.5 0 0 1 20 7v8a2.5 2.5 0 0 1-2.5 2.5H13l-4.2 3v-3H6.5A2.5 2.5 0 0 1 4 15V7a2.5 2.5 0 0 1 2.5-2.5Z"/><path d="M8 9h8M8 12h6"/></svg><span class="sr-only">${esc(label)}</span></button>`;
}

function getInternalScheduleDates() {
  try {
    const values = JSON.parse($('internalScheduleDates')?.value || '[]');
    return [...new Set(Array.isArray(values) ? values.filter(Boolean) : [])].sort();
  } catch { return []; }
}

function setInternalScheduleDates(dates = []) {
  const values = [...new Set(dates.filter(Boolean))].sort();
  if ($('internalScheduleDates')) $('internalScheduleDates').value = JSON.stringify(values);
  const host = $('internalScheduleDateList');
  if (!host) return;
  host.innerHTML = values.length
    ? values.map(date => `<span class="internal-date-chip"><span>${esc(jp(date))}</span><button type="button" data-remove-internal-date="${esc(date)}" aria-label="${esc(jp(date))}を削除">×</button></span>`).join('')
    : '<span class="internal-date-empty">日付はまだ追加されていません。</span>';
}

function renderInternalScheduleList() {
  const host = $('internalScheduleList');
  if (!host) return;
  const items = S.internalSchedules.map(normalizeInternalSchedule).sort((a,b) => String(a.date || '').localeCompare(String(b.date || '')) || Number(a.day)-Number(b.day) || String(a.time||'').localeCompare(String(b.time||'')));
  host.innerHTML = items.length ? items.map(item => `<article class="internal-schedule-row"><div><strong>${esc(item.title)}</strong><span>${esc(internalScheduleTypeLabel(item))}${item.time ? ` ${esc(item.time)}` : ''}</span>${item.note ? `<small>${esc(item.note)}</small>` : ''}</div><div><button type="button" class="secondary" data-edit-internal="${esc(item.id)}">編集</button><button type="button" class="danger" data-delete-internal="${esc(item.id)}">削除</button></div></article>`).join('') : '<div class="notice">社内予定はまだ登録されていません。</div>';
}

function resetInternalScheduleForm() {
  $('internalScheduleForm')?.reset();
  $('internalScheduleId').value = '';
  $('internalScheduleType').value = 'monthly';
  $('internalScheduleDay').value = '1';
  $('internalScheduleDate').value = '';
  setInternalScheduleDates([]);
  updateInternalScheduleTypeUi();
}

function updateInternalScheduleTypeUi() {
  const type = $('internalScheduleType')?.value || 'monthly';
  if ($('internalDayLabel')) $('internalDayLabel').hidden = type !== 'monthly';
  if ($('internalDateLabel')) $('internalDateLabel').hidden = type !== 'once';
}

function openInternalSchedule(id = '') {
  resetInternalScheduleForm();
  const source = S.internalSchedules.find(x => x.id === id);
  const item = source ? normalizeInternalSchedule(source) : null;
  if (item) {
    $('internalScheduleId').value = item.id;
    $('internalScheduleTitle').value = item.title || '';
    $('internalScheduleType').value = item.type === 'once' ? 'once' : 'monthly';
    $('internalScheduleDay').value = String(item.day || 1);
    $('internalScheduleDate').value = '';
    setInternalScheduleDates(item.dates);
    $('internalScheduleTime').value = item.time || '';
    $('internalScheduleNote').value = item.note || '';
    updateInternalScheduleTypeUi();
  }
  renderInternalScheduleList();
  $('internalScheduleDialog').showModal();
}

function openStickyNote(date) {
  $('stickyNoteDate').value = date;
  $('stickyNoteTitle').textContent = `${jp(date)}のメモ`;
  $('stickyNoteText').value = S.stickyNotes[date] || '';
  $('stickyNoteDialog').showModal();
  requestAnimationFrame(() => $('stickyNoteText').focus());
}

function clientInitial(client) {
  const text = safeTrim(client);
  return text ? Array.from(text)[0] : '';
}

function calendarProjectBadge(group) {
  const project = group.representative;
  const status = groupLifecycleStatus(group);
  const initial = clientInitial(project.client);
  return `<button type="button" class="calendar-project status-${esc(status)}" data-group-detail="${esc(project.id)}" title="${esc(project.client || '')} ${esc(project.shipNo)} ${esc(project.displayName || '')}">${initial ? `<span class="calendar-client-initial" aria-label="得意先 ${esc(project.client)}">${esc(initial)}</span>` : ''}<strong>${esc(project.shipNo || '—')}</strong>${project.displayName ? `<span class="calendar-project-name">${esc(project.displayName)}</span>` : ''}</button>`;
}

function calendarInternalScheduleBadge(item) {
  return `<button type="button" class="calendar-internal-event" data-open-internal-schedule data-internal-id="${esc(item.id)}" title="${esc(internalScheduleTypeLabel(item))} ${esc(item.title)}"><span class="calendar-internal-mark">社</span><strong>${esc(item.time || '')}</strong><span>${esc(item.title)}</span></button>`;
}


function groupIsOverdue(group) {
  if (groupLifecycleStatus(group) === 'delivered') return false;
  const today = fd(new Date());
  return group.dueDates.some(date => date && date < today);
}

function groupMatchesStatusFilter(group, filter) {
  if (!filter) return true;
  if (filter === 'overdue') return groupIsOverdue(group);
  if (filter === 'no_due') return group.dueDates.length === 0;
  return groupLifecycleStatus(group) === filter;
}

function fillEmployeeFilter(selectId, selectedId = '') {
  const select = $(selectId);
  if (!select) return;
  select.innerHTML = '<option value="">全担当者</option>' +
    ordered('employees')
      .filter(item => item.active !== false)
      .map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`)
      .join('');
  select.value = selectedId;
}


function renderCalendar() {
  const host = $('monthlyCalendar');
  if (!host) return;

  const year = S.calendarMonth.getFullYear();
  const month = S.calendarMonth.getMonth();
  $('calendarMonth').textContent = `${year}年${month + 1}月`;

  fillEmployeeFilter('calendarEmployeeFilter', S.calendarEmployeeId);
  if ($('calendarStatusFilter')) $('calendarStatusFilter').value = S.calendarStatusFilter;

  const q = safeTrim(S.calendarQ).toLowerCase();
  const groups = groupProjects(S.projects).filter(group => {
    const project = group.representative;
    const text = [
      project.shipNo,
      project.displayName,
      project.client,
      groupEmployeeNames(group)
    ].join(' ').toLowerCase();

    return (!q || text.includes(q)) &&
      (!S.calendarEmployeeId || group.employeeIds.includes(S.calendarEmployeeId)) &&
      groupMatchesStatusFilter(group, S.calendarStatusFilter);
  });

  if ($('calendarResultCount')) $('calendarResultCount').textContent = `${groups.length}案件`;

  const byDate = new Map();
  groups.forEach(group => {
    group.dueDates.forEach(date => {
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(group);
    });
  });

  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const cells = [];

  for (let i = 0; i < 42; i += 1) {
    let dateObject;
    let otherMonth = false;

    if (i < firstDay) {
      dateObject = new Date(year, month - 1, prevDays - firstDay + i + 1);
      otherMonth = true;
    } else if (i >= firstDay + days) {
      dateObject = new Date(year, month + 1, i - firstDay - days + 1);
      otherMonth = true;
    } else {
      dateObject = new Date(year, month, i - firstDay + 1);
    }

    const date = fd(dateObject);
    const items = byDate.get(date) || [];
    const internalItems = internalSchedulesForDate(date).filter(item => {
      if (!q) return true;
      return [item.title, item.note, item.time, internalScheduleTypeLabel(item)]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });

    const calendarItems = [
      ...internalItems.map(calendarInternalScheduleBadge),
      ...items.map(calendarProjectBadge)
    ];

    cells.push(
      `<div class="calendar-day ${otherMonth ? 'other-month' : ''} ${date === fd(new Date()) ? 'today' : ''}">
        <div class="calendar-day-number">${dateObject.getDate()}</div>
        <div class="calendar-day-projects">
          ${calendarItems.slice(0, 5).join('')}
          ${calendarItems.length > 5 ? `<span class="calendar-more">ほか${calendarItems.length - 5}件</span>` : ''}
        </div>
      </div>`
    );
  }

  host.innerHTML =
    '<div class="calendar-weekdays">' +
    ['日', '月', '火', '水', '木', '金', '土'].map(day => `<div>${day}</div>`).join('') +
    '</div><div class="calendar-grid">' +
    cells.join('') +
    '</div>';
}

function normalizeShipNo(value) {
  let text = safeTrim(value || '');
  // 案件番号が未入力でも、会社の共通接頭辞「S.」は維持して登録する。
  // 「S.」だけの仮登録も可能にし、番号は後から追記できる。
  if (!text) return 'S.';
  if (/^s\.?\s*/i.test(text)) return `S.${text.replace(/^s\.?\s*/i, '')}`;
  if (/^\d/.test(text)) return `S.${text}`;
  return text;
}

function noop(){}

function ordered(type) {
  return [...(S.masters[type] || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function employee(id) {
  return S.masters.employees.find(item => item.id === id);
}

function employeeName(id) {
  return employee(id)?.name || '未設定';
}

function projectEmployeeIds(project) {
  const ids = Array.isArray(project.employeeIds) ? project.employeeIds.filter(Boolean) : [];
  if (!ids.length && project.employeeId) ids.push(project.employeeId);
  return [...new Set(ids)];
}

function employeeNames(project) {
  const names = projectEmployeeIds(project).map(employeeName);
  return names.length ? names.join('・') : '未設定';
}

function loadAssigneeProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_ASSIGNEE_PROGRESS) || '{}');
    S.assigneeProgress = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    S.assigneeProgress = {};
  }
}

function saveAssigneeProgress() {
  localStorage.setItem(STORAGE_ASSIGNEE_PROGRESS, JSON.stringify(S.assigneeProgress));
}

function loadProjectLifecycle() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_PROJECT_LIFECYCLE) || '{}');
    S.projectLifecycle = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    S.projectLifecycle = {};
  }
}

function saveProjectLifecycle() {
  localStorage.setItem(STORAGE_PROJECT_LIFECYCLE, JSON.stringify(S.projectLifecycle));
}

function projectLifecycle(project) {
  const remote = project.portalState?.lifecycle || project.lifecycle;
  const local = S.projectLifecycle[project.id];
  const saved = local && typeof local === 'object' ? local : remote;
  const status = saved?.status === 'delivered'
    ? 'delivered'
    : saved?.status === 'production_complete'
      ? 'production_complete'
      : 'in_progress';
  return {
    status,
    productionCompletedAt: saved?.productionCompletedAt || '',
    productionCompletedBy: saved?.productionCompletedBy || '',
    deliveredAt: saved?.deliveredAt || '',
    deliveredBy: saved?.deliveredBy || ''
  };
}

function lifecycleLabel(status) {
  if (status === 'delivered') return '納品完了';
  if (status === 'production_complete') return '製作完了';
  return '製作中';
}

function lifecycleBadgeHtml(project, compact = false) {
  const lifecycle = projectLifecycle(project);
  return `<span class="project-status status-${esc(lifecycle.status)} ${compact ? 'is-compact' : ''}">${esc(lifecycleLabel(lifecycle.status))}</span>`;
}

function sharedProjectBody(project) {
  const employeeIds = projectEmployeeIds(project);
  const assigneeProgress = projectAssigneeProgress(project);
  const lifecycle = projectLifecycle(project);
  return {
    id: project.id,
    shipNo: project.shipNo || '',
    displayName: project.displayName || '',
    productName: project.productName || '',
    client: project.client || '',
    employeeIds,
    employeeId: employeeIds[0] || '',
    dueDate: project.dueDate || '',
    notes: project.notes || '',
    quantity: project.quantity || 0,
    spec: project.spec || '',
    completed: Boolean(project.completed),
    assigneeProgress,
    lifecycle,
    portalState: { assigneeProgress, lifecycle },
    ...actorPayload()
  };
}



function emergencyProjectSnapshot(projects = []) {
  const snapshot = projects
    .filter(project => !isSharedPortalProject(project))
    .map(project => ({ ...project, employeeIds: projectEmployeeIds(project) }));

  localStorage.setItem('hikari_portal_emergency_project_snapshot', JSON.stringify({
    createdAt: new Date().toISOString(),
    projects: snapshot
  }));

  return snapshot;
}

async function restoreMissingProjects(missingProjects = []) {
  for (const project of missingProjects) {
    try {
      await api(API.projects, {
        method: 'POST',
        body: {
          ...sharedProjectBody(project),
          id: '',
          ...actorPayload()
        }
      });
    } catch {
      // 後続の再取得で復旧状況を確認する。
    }
  }
}



function sharedScheduleMemoSnapshot(sharedProject = null) {
  const parsed = parseSharedPortalState(sharedProject) || {};
  return {
    internalSchedules: Array.isArray(parsed.internalSchedules)
      ? parsed.internalSchedules.map(normalizeInternalSchedule)
      : S.internalSchedules.map(normalizeInternalSchedule),
    stickyNotes:
      parsed.stickyNotes &&
      typeof parsed.stickyNotes === 'object' &&
      !Array.isArray(parsed.stickyNotes)
        ? { ...parsed.stickyNotes }
        : { ...S.stickyNotes }
  };
}

function sharedScheduleMemoEqual(left = {}, right = {}) {
  const a = {
    internalSchedules: Array.isArray(left.internalSchedules)
      ? left.internalSchedules.map(normalizeInternalSchedule)
      : [],
    stickyNotes: left.stickyNotes && typeof left.stickyNotes === 'object'
      ? left.stickyNotes
      : {}
  };
  const b = {
    internalSchedules: Array.isArray(right.internalSchedules)
      ? right.internalSchedules.map(normalizeInternalSchedule)
      : [],
    stickyNotes: right.stickyNotes && typeof right.stickyNotes === 'object'
      ? right.stickyNotes
      : {}
  };
  return JSON.stringify(a) === JSON.stringify(b);
}


async function ensureSharedScheduleMemoPreserved(snapshot, currentProjects = []) {
  return ensureScheduleMemoRecordPreserved(snapshot);
}




async function persistSharedProjectState(projectId) {
  return queueSharedPortalWrite(async () => {
    const latestData = await api(API.projects);
    const allProjects = Array.isArray(latestData.projects)
      ? latestData.projects
      : [];
    const latestProject = allProjects.find(
      item => !isSharedPortalProject(item) && item.id === projectId
    );

    if (!latestProject) {
      throw new Error('更新対象の案件がサーバー上に見つかりません。');
    }

    const localProject =
      S.projects.find(item => item.id === projectId) ||
      latestProject;
    const progress = { ...projectAssigneeProgress(localProject) };
    const lifecycle = { ...projectLifecycle(localProject) };

    // projects.mjs Ver2で保存できる案件拡張項目として、
    // 対象案件1件だけへ進捗とステータスを保存する。
    const body = {
      ...latestProject,
      assigneeProgress: progress,
      lifecycle,
      portalState: {
        ...(latestProject.portalState || {}),
        assigneeProgress: progress,
        lifecycle
      },
      ...actorPayload()
    };

    await api(API.projects, {
      method: 'PUT',
      body
    });

    const confirmedData = await api(API.projects);
    const confirmedProject = (confirmedData.projects || []).find(
      item => !isSharedPortalProject(item) && item.id === projectId
    );

    if (!confirmedProject) {
      throw new Error('更新後の案件を確認できませんでした。');
    }

    const confirmedProgress =
      confirmedProject.portalState?.assigneeProgress ||
      confirmedProject.assigneeProgress ||
      {};
    const confirmedLifecycle =
      confirmedProject.portalState?.lifecycle ||
      confirmedProject.lifecycle ||
      {};

    if (
      JSON.stringify(confirmedProgress) !== JSON.stringify(progress) ||
      JSON.stringify(confirmedLifecycle) !== JSON.stringify(lifecycle)
    ) {
      throw new Error(
        'ステータスの保存結果を確認できませんでした。projects.mjs Ver2のデプロイ状態を確認してください。'
      );
    }

    S.assigneeProgress[projectId] = { ...confirmedProgress };
    S.projectLifecycle[projectId] = { ...confirmedLifecycle };
    saveAssigneeProgress();
    saveProjectLifecycle();

    const localIndex = S.projects.findIndex(item => item.id === projectId);
    if (localIndex >= 0) {
      S.projects[localIndex] = {
        ...S.projects[localIndex],
        assigneeProgress: { ...confirmedProgress },
        lifecycle: { ...confirmedLifecycle },
        portalState: {
          ...(S.projects[localIndex].portalState || {}),
          assigneeProgress: { ...confirmedProgress },
          lifecycle: { ...confirmedLifecycle }
        }
      };
    }

    S.revision = String(
      confirmedData.revision ??
      confirmedData.updatedAt ??
      latestData.revision ??
      S.revision ??
      ''
    );

    return true;
  });
}

async function setProjectLifecycle(projectId, status) {
  const project = S.projects.find(item => item.id === projectId);
  if (!project) return false;

  const previousLifecycle = S.projectLifecycle[projectId]
    ? { ...S.projectLifecycle[projectId] }
    : null;
  const now = new Date().toISOString();
  const actor = employeeName(S.actorEmployeeId);
  const current = projectLifecycle(project);

  if (status === 'production_complete') {
    const summary = assigneeProgressSummary(project);
    if (!summary.total || summary.completed !== summary.total) {
      toast('担当者全員を完了にしてから製作完了にしてください。');
      return false;
    }
    S.projectLifecycle[projectId] = {
      ...current,
      status: 'production_complete',
      productionCompletedAt: now,
      productionCompletedBy: actor,
      deliveredAt: '',
      deliveredBy: ''
    };
  } else if (status === 'delivered') {
    if (current.status !== 'production_complete') {
      toast('先に製作完了にしてください。');
      return false;
    }
    S.projectLifecycle[projectId] = {
      ...current,
      status: 'delivered',
      deliveredAt: now,
      deliveredBy: actor
    };
  } else {
    S.projectLifecycle[projectId] = {
      status: 'in_progress',
      productionCompletedAt: '',
      productionCompletedBy: '',
      deliveredAt: '',
      deliveredBy: ''
    };
  }

  saveProjectLifecycle();
  try {
    await persistSharedProjectState(projectId);
  } catch (error) {
    if (previousLifecycle) S.projectLifecycle[projectId] = previousLifecycle;
    else delete S.projectLifecycle[projectId];
    saveProjectLifecycle();
    renderSchedule();
    renderDeadlines();
    toast(`共有保存に失敗しました：${error.message}`);
    return false;
  }

  renderSchedule();
  renderDeadlines();
  return true;
}

function loadTrash() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_TRASH) || '[]');
    S.trash = Array.isArray(saved) ? saved.filter(item => item && item.trashId && item.project) : [];
  } catch {
    S.trash = [];
  }
}

function saveTrash() {
  localStorage.setItem(STORAGE_TRASH, JSON.stringify(S.trash));
  updateTrashCount();
}

function updateTrashCount() {
  const count = S.trash.length;
  const badge = $('trashCount');
  if (badge) {
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }
}

function trashProjectPayload(project) {
  return {
    shipNo: project.shipNo || '',
    displayName: project.displayName || '',
    productName: project.productName || '',
    client: project.client || '',
    employeeIds: projectEmployeeIds(project),
    employeeId: projectEmployeeIds(project)[0] || '',
    dueDate: project.dueDate || '',
    notes: project.notes || '',
    quantity: project.quantity || 0,
    spec: project.spec || '',
    completed: Boolean(project.completed)
  };
}

function createTrashEntry(project, deletedAt = new Date().toISOString()) {
  return {
    trashId: `trash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    deletedAt,
    deletedBy: employeeName(S.actorEmployeeId),
    originalProjectId: project.id,
    project: trashProjectPayload(project),
    assigneeProgress: projectAssigneeProgress(project),
    lifecycle: projectLifecycle(project)
  };
}

function addProjectsToTrash(projects) {
  const entries = projects.map(project => createTrashEntry(project));
  const replacingIds = new Set(entries.map(entry => entry.originalProjectId));
  S.trash = [...entries, ...S.trash.filter(item => !replacingIds.has(item.originalProjectId))];
  saveTrash();
  return entries;
}

function addProjectToTrash(project) {
  return addProjectsToTrash([project])[0];
}

function removeTrashEntry(trashId) {
  S.trash = S.trash.filter(item => item.trashId !== trashId);
  saveTrash();
}

function findRestoredProject(entry, beforeIds) {
  const direct = S.projects.find(project => !beforeIds.has(project.id) &&
    project.shipNo === entry.project.shipNo &&
    project.displayName === entry.project.displayName &&
    project.productName === entry.project.productName &&
    project.dueDate === entry.project.dueDate);
  return direct || S.projects.find(project => !beforeIds.has(project.id));
}

async function moveProjectToTrash(project) {
  const snapshot = { ...project };
  await api(`${API.projects}?id=${encodeURIComponent(project.id)}`, { method: 'DELETE', body: actorPayload() });
  addProjectToTrash(snapshot);
  delete S.assigneeProgress[project.id];
  delete S.projectLifecycle[project.id];
  saveAssigneeProgress();
  saveProjectLifecycle();
  return true;
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function restoreTrashEntry(trashId) {
  const entry = S.trash.find(item => item.trashId === trashId);
  if (!entry) return toast('ごみ箱の案件が見つかりません。');

  // 復元後にサーバー側で確定したIDを取得するため、一覧を再取得する。
  // 存在しない並び替え関数には依存せず、従来の安定した復元処理を使用する。
  const beforeIds = new Set(S.projects.map(project => project.id));
  await api(API.projects, {
    method: 'POST',
    body: { ...entry.project, ...actorPayload() }
  });
  await load();

  const restored = findRestoredProject(entry, beforeIds);
  if (restored && entry.assigneeProgress) {
    S.assigneeProgress[restored.id] = Object.fromEntries(
      projectEmployeeIds(restored).map(id => [id, entry.assigneeProgress[id] === true])
    );
    saveAssigneeProgress();
  }
  if (restored && entry.lifecycle) {
    S.projectLifecycle[restored.id] = { ...entry.lifecycle };
    saveProjectLifecycle();
  }

  removeTrashEntry(trashId);
  renderTrash();
  toast('案件を復元しました');
}

/* ===== ごみ箱関連 ===== */

async function permanentlyDeleteTrashEntry(trashId) {
  const entry = S.trash.find(item => item.trashId === trashId);
  if (!entry) return;
  const label = `${entry.project.shipNo || ''} ${entry.project.displayName || ''}`.trim() || 'この案件';
  const approved = await confirmDangerAction({
    title: '案件を完全に削除しますか？',
    message: 'ごみ箱から完全に削除すると、元に戻せません。',
    detail: label,
    note: '必要な案件でないことを確認してから実行してください。',
    confirmText: '完全に削除'
  });
  if (!approved) return;
  removeTrashEntry(trashId);
  renderTrash();
  toast('ごみ箱から完全に削除しました');
}

async function emptyTrash() {
  if (!S.trash.length) return;
  const approved = await confirmDangerAction({
    title: 'ごみ箱を空にしますか？',
    message: `ごみ箱にある${S.trash.length}件をすべて完全に削除します。`,
    note: 'この操作は元に戻せません。',
    confirmText: 'すべて完全に削除'
  });
  if (!approved) return;
  S.trash = [];
  saveTrash();
  renderTrash();
  toast('ごみ箱を空にしました');
}

function projectAssigneeProgress(project) {
  const remote = project.portalState?.assigneeProgress || project.assigneeProgress;
  const local = S.assigneeProgress[project.id];
  const saved = local && typeof local === 'object' ? local : remote;
  const current = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  return Object.fromEntries(projectEmployeeIds(project).map(id => [id, current[id] === true]));
}

function assigneeProgressSummary(project) {
  const progress = projectAssigneeProgress(project);
  const total = Object.keys(progress).length;
  const completed = Object.values(progress).filter(Boolean).length;
  return { progress, total, completed };
}


async function setAssigneeComplete(projectId, employeeId, completed) {
  const project = S.projects.find(item => item.id === projectId);
  if (!project || !projectEmployeeIds(project).includes(employeeId)) return false;

  const previousProgress = S.assigneeProgress[projectId]
    ? { ...S.assigneeProgress[projectId] }
    : null;
  const previousLifecycle = S.projectLifecycle[projectId]
    ? { ...S.projectLifecycle[projectId] }
    : null;

  const progress = projectAssigneeProgress(project);
  progress[employeeId] = Boolean(completed);
  S.assigneeProgress[projectId] = progress;
  saveAssigneeProgress();

  const summary = assigneeProgressSummary(project);
  const lifecycle = projectLifecycle(project);

  try {
    if (summary.total > 0 && summary.completed === summary.total && lifecycle.status === 'in_progress') {
      const saved = await setProjectLifecycle(projectId, 'production_complete');
      if (!saved) throw new Error('製作完了の共有保存に失敗しました。');
    } else if (!completed && lifecycle.status !== 'in_progress') {
      const saved = await setProjectLifecycle(projectId, 'in_progress');
      if (!saved) throw new Error('製作中への変更を共有保存できませんでした。');
    } else {
      await persistSharedProjectState(projectId);
    }
  } catch (error) {
    if (previousProgress) S.assigneeProgress[projectId] = previousProgress;
    else delete S.assigneeProgress[projectId];
    if (previousLifecycle) S.projectLifecycle[projectId] = previousLifecycle;
    else delete S.projectLifecycle[projectId];
    saveAssigneeProgress();
    saveProjectLifecycle();
    toast(`担当者進捗の共有保存に失敗しました：${error.message}`);
    return false;
  }

  return true;
}

function assigneeProgressHtml(project, effect = '') {
  const { progress, total, completed } = assigneeProgressSummary(project);
  if (!total) return '<p class="muted">担当者が設定されていません。</p>';
  return `<section class="assignee-progress ${esc(effect)}" aria-labelledby="assigneeProgressHeading">
    <div class="assignee-progress-heading">
      <h3 id="assigneeProgressHeading">担当者ごとの完了</h3>
      <strong>${completed} / ${total} 完了</strong>
    </div>
    <div class="assignee-progress-list">
      ${projectEmployeeIds(project).map(id => `<label class="assignee-progress-item ${progress[id] ? 'is-complete' : ''}" style="${employeeColorStyle(id)}">
        <input type="checkbox" data-assignee-complete data-project-id="${esc(project.id)}" value="${esc(id)}" ${progress[id] ? 'checked' : ''}>
        <span class="assignee-progress-check" aria-hidden="true"></span>
        <span class="assignee-progress-name">${esc(employeeName(id))}</span>
        <small>${progress[id] ? '完了' : '未完了'}</small>
      </label>`).join('')}
    </div>
    <p class="assignee-progress-note">チェック状態は共有保存され、ほかのPCにも更新時に反映されます。</p>
  </section>`;
}

function lifecycleDetailHtml(project, effect = '') {
  const lifecycle = projectLifecycle(project);
  const productionMeta = lifecycle.productionCompletedAt
    ? `<small>製作完了：${esc(jpDateTime(lifecycle.productionCompletedAt))}${lifecycle.productionCompletedBy ? ` ／ ${esc(lifecycle.productionCompletedBy)}` : ''}</small>`
    : '';
  const deliveryMeta = lifecycle.deliveredAt
    ? `<small>納品完了：${esc(jpDateTime(lifecycle.deliveredAt))}${lifecycle.deliveredBy ? ` ／ ${esc(lifecycle.deliveredBy)}` : ''}</small>`
    : '';

  let actions = '';
  if (lifecycle.status === 'production_complete') {
    actions = `<button type="button" class="delivery-complete-button" data-lifecycle="delivered" data-project-id="${esc(project.id)}">納品完了にする</button>`;
  } else if (lifecycle.status === 'delivered') {
    actions = `<button type="button" class="secondary" data-lifecycle="production_complete" data-project-id="${esc(project.id)}">納品完了を取り消す</button>`;
  }

  const productionDone = lifecycle.status === 'production_complete' || lifecycle.status === 'delivered';
  const delivered = lifecycle.status === 'delivered';

  return `<section class="project-lifecycle ${esc(effect)}">
    <div class="project-lifecycle-heading">
      <div><h3>案件ステータス</h3><p>担当者全員の完了で製作完了へ自動更新され、納品完了のみここで操作します。</p></div>
      ${lifecycleBadgeHtml(project)}
    </div>
    <div class="project-lifecycle-steps status-${esc(lifecycle.status)}" aria-label="案件の進捗">
      <span class="is-done">受注</span><i></i>
      <span class="${lifecycle.status === 'in_progress' ? 'is-current' : 'is-done'}">製作中</span><i></i>
      <span class="${productionDone ? (delivered ? 'is-done' : 'is-done is-current') : ''}">製作完了</span><i></i>
      <span class="${delivered ? 'is-done is-current' : ''}">納品完了</span>
    </div>
    <div class="project-lifecycle-meta">${productionMeta}${deliveryMeta}</div>
    ${lifecycle.status === 'in_progress' ? '<p class="project-lifecycle-note">最後の担当者が完了すると、自動で「製作完了」に切り替わります。</p>' : ''}
    ${actions ? `<div class="project-lifecycle-actions">${actions}</div>` : ''}
    <p class="project-lifecycle-storage-note">ステータスは共有保存され、ほかのPCにも反映されます。</p>
  </section>`;
}

function actorPayload() {
  const item = employee(S.actorEmployeeId);
  return {
    actorId: S.actorEmployeeId,
    actorEmployeeId: S.actorEmployeeId,
    actorName: item?.name || ''
  };
}

function employeeColorStyle(id) {
  const index = Math.max(0, ordered('employees').findIndex(item => item.id === id));
  const hues = [215, 145, 28, 275, 350, 185, 52, 245];
  const hue = hues[index % hues.length];
  return `--employee-hue:${hue};`;
}

function ensureActorUi() {
  if (!$('actorDialog')) {
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="actorDialog" class="actor-dialog">
        <form id="actorForm">
          <header>
            <div>
              <h2>光ポータルへようこそ</h2>
              <p class="muted">最初に、あなたのお名前を選択してください。</p>
            </div>
          </header>
          <fieldset class="employee-fieldset">
            <legend>あなたのお名前</legend>
            <div id="actorChoices" class="employee-choices"></div>
            <p id="actorError" class="error"></p>
          </fieldset>
          <footer>
            <button type="submit" class="primary">開始する</button>
          </footer>
        </form>
      </dialog>
      <dialog id="actorSettingsDialog" class="actor-dialog">
        <form id="actorSettingsForm">
          <header>
            <div>
              <h2>利用者設定</h2>
              <p class="muted">更新履歴に記録する名前を変更できます。</p>
            </div>
            <button type="button" data-close aria-label="閉じる">×</button>
          </header>
          <fieldset class="employee-fieldset">
            <legend>現在操作している人</legend>
            <div id="actorSettingsChoices" class="employee-choices"></div>
            <p id="actorSettingsError" class="error"></p>
          </fieldset>
          <footer>
            <button type="button" class="secondary" data-close>キャンセル</button>
            <button type="submit" class="primary">変更する</button>
          </footer>
        </form>
      </dialog>
    `);
  }

  const oldSelector = document.querySelector('.actor-selector');
  if (oldSelector) oldSelector.remove();

  updateActorStatus();
}

function renderActorChoices(containerId, selectedId = '') {
  const container = $(containerId);
  if (!container) return;
  const employees = ordered('employees').filter(item => item.active !== false);
  container.innerHTML = employees.map(item => `
    <label class="employee-choice" style="${employeeColorStyle(item.id)}">
      <input type="radio" name="${containerId}" value="${esc(item.id)}" ${item.id === selectedId ? 'checked' : ''}>
      <span>${esc(item.name)}</span>
    </label>
  `).join('') || '<p class="notice">社員マスタが登録されていません。</p>';
}

function validateStoredActor() {
  if (S.actorEmployeeId && employee(S.actorEmployeeId)?.active !== false) return true;
  S.actorEmployeeId = '';
  localStorage.removeItem(STORAGE_ACTOR_ID);
  return false;
}

function requestActorIfNeeded() {
  if (validateStoredActor()) return;
  renderActorChoices('actorChoices');
  const dialog = $('actorDialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function updateActorStatus() {
  const status = $('currentActorStatus');
  if (!status) return;
  const item = employee(S.actorEmployeeId);
  status.textContent = item ? `利用者：${item.name}` : '利用者：未設定';
  status.style.cssText = item ? employeeColorStyle(item.id) : '';
}

function setActor(id) {
  S.actorEmployeeId = id;
  localStorage.setItem(STORAGE_ACTOR_ID, id);
  updateActorStatus();
}

function fillDatalist(type) {
  return ordered(type).filter(item => item.active !== false).map(item => `<option value="${esc(item.name)}"></option>`).join('');
}

function optionHtml(type, blank = '選択してください') {
  return `<option value="">${esc(blank)}</option>` + ordered(type).filter(item => item.active !== false).map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
}

function renderEmployeeCheckboxes(containerId, selectedIds = []) {
  const container = $(containerId);
  if (!container) return;
  const selected = new Set(selectedIds);
  container.innerHTML = ordered('employees').filter(item => item.active !== false).map(item => `
    <label class="employee-choice" style="${employeeColorStyle(item.id)}">
      <input type="checkbox" value="${esc(item.id)}" ${selected.has(item.id) ? 'checked' : ''}>
      <span>${esc(item.name)}</span>
    </label>
  `).join('');
}

function checkedValues(containerId) {
  return [...document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)].map(input => input.value);
}

function fillSelects() {
  if ($('displayNameList')) $('displayNameList').innerHTML = fillDatalist('displayNames');
  if ($('clientList')) $('clientList').innerHTML = fillDatalist('clients');
  if ($('importEmployee')) $('importEmployee').innerHTML = optionHtml('employees', '担当者を選択');
  renderEmployeeCheckboxes('employeeChoices');
  renderEmployeeCheckboxes('importEmployeeChoices');
  const commonDropdownHost = $('importEmployeeDropdownHost');
  if (commonDropdownHost) commonDropdownHost.innerHTML = employeeMultiDropdownHtml('importEmployeeDropdown', []);
  renderActorChoices('actorChoices', S.actorEmployeeId);
  renderActorChoices('actorSettingsChoices', S.actorEmployeeId);
  if ($('historyActorFilter')) {
    const current = $('historyActorFilter').value;
    $('historyActorFilter').innerHTML = '<option value="">すべて</option>' + ordered('employees').map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    $('historyActorFilter').value = current;
  }
  if ($('employeeChoicesField')) $('employeeChoicesField').hidden = false;
  if ($('legacyImportEmployeeLabel')) $('legacyImportEmployeeLabel').hidden = true;
  if ($('importEmployeeChoicesField')) $('importEmployeeChoicesField').hidden = true;
}

function filtered() {
  const q = S.q.trim().toLowerCase();
  return S.projects.filter(project => !q || [
    project.shipNo, project.displayName, project.client,
    project.spec, project.notes, employeeNames(project)
  ].join(' ').toLowerCase().includes(q));
}

function projectGroupKey(project) {
  return JSON.stringify([
    String(project.shipNo || '').trim(),
    String(project.displayName || '').trim(),
    String(project.client || '').trim()
  ]);
}

function groupProjects(projects = filtered()) {
  const map = new Map();
  projects.forEach(project => {
    const key = projectGroupKey(project);
    if (!map.has(key)) map.set(key, { key, projects: [] });
    map.get(key).projects.push(project);
  });
  return [...map.values()].map(group => {
    group.projects.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    group.representative = group.projects[0];
    group.employeeIds = [...new Set(group.projects.flatMap(projectEmployeeIds))];
    group.dueDates = [...new Set(group.projects.map(project => project.dueDate).filter(Boolean))].sort();
    return group;
  });
}

function projectGroup(projectOrId) {
  const project = typeof projectOrId === 'string' ? S.projects.find(item => item.id === projectOrId) : projectOrId;
  if (!project) return null;
  const key = projectGroupKey(project);
  return groupProjects(S.projects).find(group => group.key === key) || null;
}

function groupLifecycleStatus(group) {
  const statuses = group.projects.map(project => projectLifecycle(project).status);
  if (statuses.length && statuses.every(status => status === 'delivered')) return 'delivered';
  if (statuses.length && statuses.every(status => status === 'production_complete' || status === 'delivered')) return 'production_complete';
  return 'in_progress';
}

function groupLifecycleBadgeHtml(group, compact = false) {
  const status = groupLifecycleStatus(group);
  return `<span class="project-status status-${esc(status)} ${compact ? 'is-compact' : ''}">${esc(lifecycleLabel(status))}</span>`;
}

function groupDueLabel(group) {
  if (!group.dueDates.length) return '納期未設定';
  if (group.dueDates.length === 1) return jp(group.dueDates[0]);
  return `${jp(group.dueDates[0])}〜${jp(group.dueDates[group.dueDates.length - 1])}`;
}

function groupEmployeeNames(group) {
  return group.employeeIds.map(employeeName).filter(Boolean).join('・') || '未設定';
}

function groupCard(group, employeeId) {
  const project = group.representative;
  const status = groupLifecycleStatus(group);
  return `<button class="job group-job lifecycle-${esc(status)}" style="${employeeColorStyle(employeeId)}" data-group-detail="${esc(project.id)}"><span class="job-topline"><b>${esc(project.shipNo || '—')}</b>${groupLifecycleBadgeHtml(group, true)}</span><span>${esc(project.displayName || '—')}</span><small>${group.projects.length}明細${group.dueDates.length > 1 ? ` ／ ${esc(groupDueLabel(group))}` : ''}</small></button>`;
}

function renderSchedule() {
  const year = S.month.getFullYear();
  const month = S.month.getMonth();
  if ($('month')) $('month').textContent = `${year}年${month + 1}月`;
  const employees = ordered('employees').filter(item => item.active !== false);
  if ($('emptyEmployees')) $('emptyEmployees').textContent = employees.length ? '' : '社員マスタを登録すると、職員別スケジュールが表示されます。';
  const days = new Date(year, month + 1, 0).getDate();
  const groups = groupProjects(filtered());
  let html = '<thead><tr><th class="date-col">日付</th><th class="date-memo-col" aria-label="日付メモ"></th><th class="internal-col">社内スケジュール</th>' + employees.map(item => `<th style="${employeeColorStyle(item.id)}">${esc(item.name)}</th>`).join('') + '</tr></thead><tbody>';
  for (let day = 1; day <= days; day++) {
    const date = fd(new Date(year, month, day));
    html += `<tr data-schedule-date="${esc(date)}"><th>${esc(jp(date))}</th><td class="date-memo-cell">${stickyNoteCellHtml(date)}</td><td class="internal-schedule-cell">${internalScheduleHtml(date)}</td>` + employees.map(item => {
      const cards = groups.filter(group => group.dueDates[0] === date && group.employeeIds.includes(item.id)).map(group => groupCard(group, item.id)).join('');
      return `<td>${cards}</td>`;
    }).join('') + `</tr>`;
  }
  html += '</tbody>';
  if ($('scheduleTable')) $('scheduleTable').innerHTML = html;
}

function scrollScheduleToToday({ behavior = 'auto' } = {}) {
  const wrap = document.querySelector('.schedule-wrap');
  const table = $('scheduleTable');
  if (!wrap || !table) return;
  const now = new Date();
  if (S.month.getFullYear() !== now.getFullYear() || S.month.getMonth() !== now.getMonth()) { wrap.scrollTop = 0; return; }
  const row = table.querySelector(`[data-schedule-date="${fd(now)}"]`);
  if (!row) return;
  const head = table.querySelector('thead');
  const target = Math.max(0, row.offsetTop - (head?.offsetHeight || 0));
  wrap.scrollTo({ top: target, behavior });
}


function renderDeadlines() {
  const statusOrder = { in_progress: 0, production_complete: 1, delivered: 2 };

  fillEmployeeFilter('deadlineEmployeeFilter', S.deadlineEmployeeId);
  if ($('deadlineStatusFilter')) $('deadlineStatusFilter').value = S.deadlineStatusFilter;

  const groups = groupProjects(filtered())
    .filter(group =>
      (!S.deadlineEmployeeId || group.employeeIds.includes(S.deadlineEmployeeId)) &&
      groupMatchesStatusFilter(group, S.deadlineStatusFilter)
    )
    .sort((a, b) =>
      statusOrder[groupLifecycleStatus(a)] - statusOrder[groupLifecycleStatus(b)] ||
      String(a.dueDates[0] || '').localeCompare(String(b.dueDates[0] || ''))
    );

  if ($('deadlineResultCount')) $('deadlineResultCount').textContent = `${groups.length}案件`;

  const selectedGroups = groups.filter(group =>
    group.projects.every(project => S.selectedProjectIds.has(project.id))
  );
  const count = selectedGroups.length;

  const toolbar = `<div class="deadline-selection-toolbar">
    <button type="button" id="selectVisible" class="secondary">表示中をすべて選択</button>
    <button type="button" id="clearProjectSelection" class="secondary">選択をすべて解除</button>
    <strong id="selectedProjectCount">${count}案件選択中</strong>
    <button type="button" id="bulkDeleteProjects" class="danger" ${count ? '' : 'disabled'}>
      選択した${count}案件をごみ箱へ
    </button>
  </div>`;

  const items = groups.length
    ? groups.map(group => {
        const project = group.representative;
        const checked = group.projects.every(item => S.selectedProjectIds.has(item.id));
        const more = group.projects.length > 2 ? `ほか${group.projects.length - 2}件` : '';
        const summary = group.projects.reduce(
          (acc, item) => {
            const progress = assigneeProgressSummary(item);
            acc.completed += progress.completed;
            acc.total += progress.total;
            return acc;
          },
          { completed: 0, total: 0 }
        );
        const overdue = groupIsOverdue(group);

        return `<article class="deadline grouped-deadline deadline-one-line lifecycle-${esc(groupLifecycleStatus(group))} ${overdue ? 'is-overdue' : ''}">
          <input type="checkbox" class="project-select" data-select-group="${esc(project.id)}" ${checked ? 'checked' : ''} aria-label="${esc(project.shipNo)}を選択">
          <time>${esc(groupDueLabel(group))}</time>
          ${overdue ? '<span class="overdue-badge">納期超過</span>' : groupLifecycleBadgeHtml(group, true)}
          <button type="button" data-group-detail="${esc(project.id)}" class="deadline-main-link">
            <strong>${esc(project.shipNo || '—')}</strong>
            <span>${esc(project.displayName || '—')}</span>
          </button>
          <span class="deadline-inline-meta">
            ${group.projects.length}明細${more ? ` ／ ${esc(more)}` : ''} ／ ${esc(groupEmployeeNames(group))}
            ${summary.total ? ` ／ 担当完了 ${summary.completed}/${summary.total}` : ''}
          </span>
          <button type="button" class="secondary" data-group-detail="${esc(project.id)}">詳細</button>
          <button type="button" class="danger ghost-danger" data-group-delete="${esc(project.id)}">ごみ箱へ</button>
        </article>`;
      }).join('')
    : '<div class="notice">条件に一致する案件はありません。</div>';

  if ($('deadlineList')) $('deadlineList').innerHTML = toolbar + items;
}

function renderTrash() {
  const host = $('trashList');
  if (!host) return;
  updateTrashCount();
  if (!S.trash.length) {
    host.innerHTML = '<div class="notice trash-empty"><strong>ごみ箱は空です。</strong><span>削除した案件はここから復元できます。</span></div>';
    const emptyButton = $('emptyTrash');
    if (emptyButton) emptyButton.disabled = true;
    return;
  }
  const emptyButton = $('emptyTrash');
  if (emptyButton) emptyButton.disabled = false;
  host.innerHTML = S.trash.map(entry => {
    const project = entry.project;
    const names = projectEmployeeIds(project).map(employeeName).join('・') || '未設定';
    return `<article class="trash-item">
      <div class="trash-item-main">
        <div class="trash-item-title"><strong>${esc(project.shipNo || '—')} ${esc(project.displayName || '')}</strong></div>
        <dl>
          <div><dt>納期</dt><dd>${esc(jp(project.dueDate))}</dd></div>
          <div><dt>担当者</dt><dd>${esc(names)}</dd></div>
          <div><dt>状態</dt><dd>${entry.lifecycle ? esc(lifecycleLabel(entry.lifecycle.status)) : '製作中'}</dd></div>
          <div><dt>削除日時</dt><dd>${esc(jpDateTime(entry.deletedAt))}</dd></div>
          <div><dt>削除した人</dt><dd>${esc(entry.deletedBy || '未設定')}</dd></div>
        </dl>
      </div>
      <div class="trash-item-actions">
        <button type="button" class="primary" data-trash-restore="${esc(entry.trashId)}">復元</button>
        <button type="button" class="danger" data-trash-delete="${esc(entry.trashId)}">完全削除</button>
      </div>
    </article>`;
  }).join('');
}

const masterLabels = { clients: '得意先', displayNames: '部門', employees: '職員' };
const masterOrder = ['clients', 'displayNames', 'employees'];
function masterCardHtml(type) {
  const content = `<form data-master="${type}"><input placeholder="${masterLabels[type]}名"><button class="primary">追加</button></form><div>${ordered(type).map((item, index, array) => `<div class="master-item ${item.active === false ? 'inactive' : ''}"><span>${esc(item.name)}</span><div class="master-actions"><button type="button" data-move="up" data-id="${esc(item.id)}" data-type="${type}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-move="down" data-id="${esc(item.id)}" data-type="${type}" ${index === array.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-medit="${esc(item.id)}" data-type="${type}">変更</button><button type="button" data-mtoggle="${esc(item.id)}" data-type="${type}">${item.active === false ? '表示' : '非表示'}</button><button type="button" data-mdelete="${esc(item.id)}" data-type="${type}">削除</button></div></div>`).join('') || '<p class="muted">登録なし</p>'}</div>`;
  if (type === 'employees') return `<details class="master-card master-card-collapsible"><summary><span>職員マスタ</span><small>ほぼ固定のため通常は非表示</small></summary><div class="master-card-body">${content}</div></details>`;
  return `<section class="master-card"><h3>${masterLabels[type]}マスタ</h3>${content}</section>`;
}
function renderMasters() {
  if (!$('masterGrid')) return;
  $('masterGrid').innerHTML = masterOrder.map(masterCardHtml).join('');
}

function render() {
  renderSchedule();
  renderDeadlines();
  renderMasters();
  renderTrash();
  renderCalendar();
  renderInternalScheduleList();
  fillSelects();
}

async function load({ silent = false } = {}) {
  try {
    const [projectData, masterData] = await Promise.all([api(API.projects), api(API.masters)]);

    // 共有レコード作成時に社員マスタを参照できるよう、最初にマスタを確定する。
    S.masters = masterData.masters || S.masters;

    const allProjects = projectData.projects || [];
    const sharedPortalProject = allProjects.find(isScheduleMemoSharedProject) || null;
    const statusSharedProject = allProjects.find(isStatusSharedProject) || null;
    const materialSharedProject = allProjects.find(isMaterialSharedProject) || null;

    S.sharedPortalProjectId = sharedPortalProject?.id || '';
    S.statusSharedProjectId = statusSharedProject?.id || '';
    S.materialSharedProjectId = materialSharedProject?.id || '';

    S.projects = allProjects
      .filter(project => !isSharedPortalProject(project))
      .map(project => ({
        ...project,
        displayName: stripApiEmptyText(project.displayName),
        productName: stripApiEmptyText(project.productName),
        employeeIds: projectEmployeeIds(project)
      }));

    // 社内予定とメモは専用共有レコードから読み込む。
    if (sharedPortalProject) {
      applySharedPortalState(sharedPortalProject);
    }

    // 材料マスタと価格履歴は専用共有レコードから読み込む。
    // 共有レコードがまだない場合だけ、このPCの旧ローカル材料を維持する。
    if (materialSharedProject) {
      applyMaterialSharedState(materialSharedProject);
    }

    // RC5では進捗・ステータスを各案件本体から読み込む。
    // RC4以前のSYS.PORTAL.STATUSは移行用の予備データとしてのみ参照する。
    const legacyStatusState = statusSharedProject
      ? normalizeStatusSharedState(
          parseStatusSharedState(statusSharedProject) || {}
        )
      : { assigneeProgress: {}, projectLifecycle: {} };

    const nextProgress = {};
    const nextLifecycle = {};

    S.projects.forEach(project => {
      const projectProgress =
        project.portalState?.assigneeProgress ||
        project.assigneeProgress;
      const projectLifecycleValue =
        project.portalState?.lifecycle ||
        project.lifecycle;

      const fallbackProgress =
        legacyStatusState.assigneeProgress?.[project.id];
      const fallbackLifecycle =
        legacyStatusState.projectLifecycle?.[project.id];

      if (
        projectProgress &&
        typeof projectProgress === 'object' &&
        !Array.isArray(projectProgress)
      ) {
        nextProgress[project.id] = { ...projectProgress };
      } else if (fallbackProgress) {
        nextProgress[project.id] = { ...fallbackProgress };
      }

      if (
        projectLifecycleValue &&
        typeof projectLifecycleValue === 'object' &&
        !Array.isArray(projectLifecycleValue)
      ) {
        nextLifecycle[project.id] = { ...projectLifecycleValue };
      } else if (fallbackLifecycle) {
        nextLifecycle[project.id] = { ...fallbackLifecycle };
      }
    });

    // 同期時に取得したサーバー値で、このPCのローカル状態を置き換える。
    // 操作中は従来どおりローカル優先のため、担当者チェックの即時反映を壊さない。
    S.assigneeProgress = nextProgress;
    S.projectLifecycle = nextLifecycle;

    // 詳細画面・一覧・月間表示が同じ同期値を参照できるよう、
    // 案件オブジェクトにも読み込んだ進捗とステータスを反映する。
    S.projects = S.projects.map(project => {
      const progress = nextProgress[project.id];
      const lifecycle = nextLifecycle[project.id];

      return {
        ...project,
        ...(progress ? { assigneeProgress: { ...progress } } : {}),
        ...(lifecycle ? { lifecycle: { ...lifecycle } } : {}),
        portalState: {
          ...(project.portalState || {}),
          ...(progress ? { assigneeProgress: { ...progress } } : {}),
          ...(lifecycle ? { lifecycle: { ...lifecycle } } : {})
        }
      };
    });

    saveAssigneeProgress();
    saveProjectLifecycle();
    S.revision = String(projectData.revision ?? projectData.updatedAt ?? S.revision ?? '');
    render();
    requestAnimationFrame(() => scrollScheduleToToday());
    updateActorStatus();
    requestActorIfNeeded();
    const lastUpdated = $('lastUpdated');
    const now = new Date();
    S.lastAutoSyncAt = now.toISOString();
    if (lastUpdated) lastUpdated.textContent = `最終更新：${new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now)}`;
    renderSyncDetail();
  } catch (error) {
    // 共有データに問題があっても、取得済みのローカルデータで画面を描画する。
    try { render(); } catch {}
    if (!silent) toast(error.message);
  }
}

function openGroupDetail(id) {
  const group = projectGroup(id);
  if (!group) return toast('案件が見つかりません。');
  const project = group.representative;
  const lineItems = group.projects.map((item, index) => `
    <article class="group-detail-line lifecycle-${esc(projectLifecycle(item).status)}">
      <div class="group-detail-line-number">${index + 1}</div>
      <div class="group-detail-line-main">
        <div class="group-detail-line-heading"><h3>明細 ${index + 1}</h3>${lifecycleBadgeHtml(item, true)}</div>
        <dl>
          <div><dt>数量</dt><dd>${item.quantity ? esc(item.quantity) : '—'}</dd></div>
          <div><dt>納期</dt><dd>${esc(jp(item.dueDate))}</dd></div>
          <div><dt>担当者</dt><dd>${esc(employeeNames(item))}</dd></div>
          <div><dt>仕様</dt><dd>${esc(item.spec || '—')}</dd></div>
        </dl>
      </div>
      <div class="group-detail-line-actions">
        <button type="button" class="secondary" data-detail="${esc(item.id)}">明細詳細</button>
        <button type="button" class="secondary" data-copy-project="${esc(item.id)}">コピー</button><button type="button" class="secondary" data-detail-edit="${esc(item.id)}">編集</button>
        <button type="button" class="danger ghost-danger" data-request-delete="${esc(item.id)}">ごみ箱へ</button>
      </div>
    </article>`).join('');
  $('detailBody').innerHTML = `<header><div><p class="dialog-eyebrow">案件単位表示</p><h2>${esc(project.shipNo || '—')} ${esc(project.displayName || '—')}</h2></div><button type="button" data-close>×</button></header>
    <section class="group-detail-summary">
      <dl><div><dt>得意先</dt><dd>${esc(project.client || '—')}</dd></div><div><dt>明細数</dt><dd>${group.projects.length}件</dd></div><div><dt>納期</dt><dd>${esc(groupDueLabel(group))}</dd></div><div><dt>担当者</dt><dd>${esc(groupEmployeeNames(group))}</dd></div></dl>
      ${groupLifecycleBadgeHtml(group)}
    </section>
    <section class="group-detail-lines"><div class="group-detail-section-heading"><h3>製作明細</h3><span>${group.projects.length}件</span></div>${lineItems}</section>
    <footer class="detail-actions"><button type="button" class="secondary" data-close>閉じる</button></footer>`;
  $('detailDialog').showModal();
}

function openDetail(id, effect = '') {
  const project = S.projects.find(item => item.id === id);
  if (!project) return toast('案件が見つかりません。');
  const group = projectGroup(project);
  const backButton = group && group.projects.length > 1 ? `<button type="button" class="detail-back-button" data-group-detail="${esc(project.id)}">← 案件明細一覧へ</button>` : '';
  $('detailBody').innerHTML = `<header><div>${backButton}<h2>明細詳細</h2></div><button type="button" data-close>×</button></header><dl><dt>番船</dt><dd>${esc(project.shipNo || '—')}</dd><dt>表示名</dt><dd>${esc(project.displayName || '—')}</dd><dt>数量</dt><dd>${project.quantity ? esc(project.quantity) : '—'}</dd><dt>仕様</dt><dd>${esc(project.spec || '—')}</dd><dt>担当者</dt><dd>${esc(employeeNames(project))}</dd><dt>得意先</dt><dd>${esc(project.client || '—')}</dd><dt>納期</dt><dd>${esc(jp(project.dueDate))}</dd><dt>メモ</dt><dd>${esc(project.notes || '—')}</dd></dl>${assigneeProgressHtml(project, effect === 'progress-updated' ? effect : '')}${lifecycleDetailHtml(project, effect)}<footer class="detail-actions"><button type="button" class="secondary" data-close>閉じる</button><div><button type="button" class="secondary" data-copy-project="${esc(project.id)}">コピー</button><button type="button" class="secondary" data-detail-edit="${esc(project.id)}">編集</button><button type="button" class="danger" data-request-delete="${esc(project.id)}">ごみ箱へ</button></div></footer>`;
  $('detailDialog').showModal();
}

function openProject(id = '') {
  const project = S.projects.find(item => item.id === id);
  $('projectId').value = project?.id || '';
  $('shipNo').value = project?.shipNo || 'S.';
  $('displayName').value = project?.displayName || '';
  $('client').value = project?.client || '';
  $('dueDate').value = project?.dueDate || '';
  $('notes').value = project?.notes || '';
  $('projectHeading').textContent = project ? '案件を編集' : '案件を追加';
  $('projectError').textContent = '';
  $('employeeChoiceError').textContent = '';
  renderEmployeeCheckboxes('employeeChoices', project ? projectEmployeeIds(project) : []);
  $('projectDialog').showModal();
  setTimeout(() => { const input = $('shipNo'); input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0);
}

function requestDelete(id) {
  const project = S.projects.find(item => item.id === id);
  if (!project) return toast('案件が見つかりません。');
  S.pendingDeleteId = id;
  $('deleteTarget').textContent = `${project.shipNo || ''} ${project.displayName || ''}`.trim();
  if ($('detailDialog').open) $('detailDialog').close();
  $('deleteDialog').showModal();
}

async function confirmDelete() {
  if (!S.pendingDeleteId) return;
  const project = S.projects.find(item => item.id === S.pendingDeleteId);
  if (!project) return toast('案件が見つかりません。');
  try {
    await moveProjectToTrash(project);
    S.selectedProjectIds.delete(S.pendingDeleteId);
    S.pendingDeleteId = '';
    $('deleteDialog').close();
    await load();
    toast('案件をごみ箱へ移動しました');
  } catch (error) { toast(error.message); }
}

function openImport() {
  if (!ordered('employees').some(item => item.active !== false)) return toast('先に社員マスタを登録してください。');
  $('importForm').reset();
  $('importShipNo').value = 'S.';
  $('importDueDate').value = fd(new Date());
  $('importStep1').hidden = false;
  $('importStep2').hidden = true;
  $('importReadError').textContent = '';
  $('importError').textContent = '';
  S.importItems = [];
  renderEmployeeCheckboxes('importEmployeeChoices');
  const commonDropdownHost = $('importEmployeeDropdownHost');
  if (commonDropdownHost) commonDropdownHost.innerHTML = employeeMultiDropdownHtml('importEmployeeDropdown', []);
  $('importDialog').showModal();
}

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('ファイルを読み込めませんでした。'));
    reader.readAsDataURL(file);
  });
}

function findMasahiroId() {
  const normalized = value => String(value || '').replace(/[\s　]/g, '').toLowerCase();
  return ordered('employees').find(item => ['マサヒーロー', 'まさひーろー', 'masahiro'].includes(normalized(item.name)))?.id || '';
}

function normalizeImportText(value) {
  return String(value || '').normalize('NFKC').replace(/[\s　]+/g, '');
}

function isEtching(item) {
  return /エッチング|腐食/i.test(normalizeImportText([item.productName, item.productName2, item.spec, item.remarks].filter(Boolean).join(' ')));
}

function isImportableItem(item) {
  const product = normalizeImportText([item.productName, item.productName2].filter(Boolean).join(' '));
  const quantity = Number(item.quantity);
  if (!product || /^【.*】$/.test(product)) return false;
  if (/見積総合計金額|見積外消費税|総合計|消費税|追加価格|注意事項/.test(product)) return false;
  if (Number.isFinite(quantity) && quantity <= 0) return false;
  return true;
}

function employeeMultiDropdownHtml(containerId, selectedIds = [], autoEtching = false) {
  const selected = new Set(selectedIds);
  const employees = ordered('employees').filter(item => item.active !== false);
  const selectedNames = employees.filter(item => selected.has(item.id)).map(item => item.name);
  const label = selectedNames.length ? selectedNames.join('・') : '担当者を選択';
  const choices = employees.map(item => `
    <label class="employee-choice" style="${employeeColorStyle(item.id)}">
      <input type="checkbox" value="${esc(item.id)}" ${selected.has(item.id) ? 'checked' : ''}>
      <span>${esc(item.name)}</span>
    </label>
  `).join('');
  return `<details class="employee-multi-dropdown ${autoEtching ? 'auto-etching' : ''}" id="${esc(containerId)}">
    <summary><span class="employee-multi-label">${esc(label)}</span><span class="employee-multi-count">${selectedNames.length ? `（${selectedNames.length}名）` : ''}</span></summary>
    <div class="employee-multi-panel">${choices}<button type="button" class="secondary employee-multi-close">閉じる</button></div>
  </details>`;
}

function updateEmployeeMultiLabel(details) {
  if (!details) return;
  const ids = [...details.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
  const names = ids.map(employeeName);
  const label = details.querySelector('.employee-multi-label');
  const count = details.querySelector('.employee-multi-count');
  if (label) label.textContent = names.length ? names.join('・') : '担当者を選択';
  if (count) count.textContent = names.length ? `（${names.length}名）` : '';
}

function setEmployeeMultiValues(details, selectedIds = []) {
  if (!details) return;
  const selected = new Set(selectedIds);
  details.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = selected.has(input.value); });
  updateEmployeeMultiLabel(details);
}

function rowEmployeeSelect(index, selectedIds = [], autoEtching = false) {
  return `<div class="import-assignee-select-wrap ${autoEtching ? 'auto-etching' : ''}" data-import-employees="${index}">
    ${employeeMultiDropdownHtml(`importEmployeeDropdown-${index}`, selectedIds, autoEtching)}
  </div>`;
}

function renderImportRows() {
  const masahiroId = findMasahiroId();
  let hasAutoAssign = false;
  $('importRows').innerHTML = S.importItems.map((item, index) => {
    const autoEtching = isEtching(item) && Boolean(masahiroId);
    const selectedIds = autoEtching ? [masahiroId] : [];
    if (selectedIds.length) hasAutoAssign = true;
    return `<tr data-import-row="${index}" data-import-product="${esc(item.productName || '')}"><td><input type="checkbox" class="import-select" ${item.selected !== false ? 'checked' : ''}></td><td><input class="import-quantity" type="number" min="0" step="1" value="${esc(item.quantity || '')}"></td><td><textarea class="import-spec" rows="2">${esc([item.spec, item.remarks].filter(Boolean).join(' ／ '))}</textarea></td><td>${rowEmployeeSelect(index, selectedIds, autoEtching)}</td><td><input class="import-date" type="date" value="${esc($('importDueDate').value)}"></td></tr>`;
  }).join('');
  if ($('etchingAutoAssignNotice')) $('etchingAutoAssignNotice').hidden = !hasAutoAssign;
  updateImportCount();
}

function updateImportCount() {
  if ($('importCount')) $('importCount').textContent = `${document.querySelectorAll('.import-select:checked').length}件を登録予定`;
}

function historyAction(item) {
  return item.action || item.type || item.event || '';
}

function historyActorId(item) {
  return item.actorEmployeeId || item.actorId || item.employeeId || '';
}

function historyActorName(item) {
  return item.actorName || employeeName(historyActorId(item));
}

function historyProject(item) {
  return item.project || item.after || item.before || item.data || {};
}

const historyLabels = { create: '案件追加', add: '案件追加', update: '案件編集', edit: '案件編集', complete: '完了', reopen: '完了解除', toggle: '完了状態変更', delete: '案件削除' };

function renderHistory() {
  if (!$('historyList')) return;
  const actionFilter = $('historyActionFilter')?.value || '';
  const actorFilter = $('historyActorFilter')?.value || '';
  const query = ($('historySearch')?.value || '').trim().toLowerCase();
  const list = S.history.filter(item => {
    const action = historyAction(item);
    const project = historyProject(item);
    if (isSharedPortalProject(project)) return false;
    const text = [project.shipNo, project.displayName, item.summary, historyActorName(item)].join(' ').toLowerCase();
    return (!actionFilter || action === actionFilter) && (!actorFilter || historyActorId(item) === actorFilter) && (!query || text.includes(query));
  });
  if ($('historyEmpty')) $('historyEmpty').hidden = list.length !== 0;
  $('historyList').innerHTML = list.map((item, index) => {
    const project = historyProject(item);
    const actorId = historyActorId(item);
    const action = historyAction(item);
    return `<article class="history-item" style="${employeeColorStyle(actorId)}"><button type="button" data-history-index="${index}"><div class="history-meta"><time>${esc(jpDateTime(item.createdAt || item.updatedAt || item.timestamp))}</time><span class="history-actor">${esc(historyActorName(item))}</span><strong>${esc(historyLabels[action] || action || '更新')}</strong></div><h3>${esc(project.shipNo || '—')} ${esc(project.displayName || '')}</h3><p>${esc(item.summary || project.notes || '')}</p></button></article>`;
  }).join('');
}

async function loadHistory() {
  if (!$('historyList')) return;
  $('historyLoading').hidden = false;
  $('historyError').textContent = '';
  try {
    const data = await api(`${API.projects}?history=1`);
    S.history = data.history || data.items || [];
    S.historyLoaded = true;
    renderHistory();
  } catch (error) {
    $('historyError').textContent = error.message;
  } finally {
    $('historyLoading').hidden = true;
  }
}

function openHistoryDetail(index) {
  const item = S.history[index];
  if (!item) return;
  const before = item.before || null;
  const after = item.after || item.project || null;
  const table = data => data ? `<dl><dt>番船</dt><dd>${esc(data.shipNo || '—')}</dd><dt>表示名</dt><dd>${esc(data.displayName || '—')}</dd><dt>担当者</dt><dd>${esc(employeeNames(data))}</dd><dt>納期</dt><dd>${esc(data.dueDate ? jp(data.dueDate) : '—')}</dd><dt>メモ</dt><dd>${esc(data.notes || '—')}</dd></dl>` : '<p class="muted">記録なし</p>';
  $('historyDetailBody').innerHTML = `<header><h2>更新履歴の詳細</h2><button type="button" data-close>×</button></header><p><strong>${esc(historyLabels[historyAction(item)] || historyAction(item) || '更新')}</strong>　${esc(jpDateTime(item.createdAt || item.updatedAt || item.timestamp))}</p><p>操作者：${esc(historyActorName(item))}</p><div class="history-compare"><section><h3>変更前</h3>${table(before)}</section><section><h3>変更後</h3>${table(after)}</section></div><footer><button type="button" class="secondary" data-close>閉じる</button></footer>`;
  $('historyDetailDialog').showModal();
}



function formatSyncDateTime(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

function syncStateDetails() {
  const status = $('syncStatus');
  if (status?.classList.contains('is-error') || !navigator.onLine) {
    return { state: 'error', label: '通信エラー', message: 'ネットワーク接続またはサーバーへの接続を確認してください。' };
  }
  if (status?.classList.contains('is-saving')) {
    return { state: 'saving', label: '保存中…', message: '変更内容を共有データへ保存しています。' };
  }
  if (status?.classList.contains('is-syncing')) {
    return { state: 'syncing', label: '同期中…', message: 'ほかのPCの最新データを取得しています。' };
  }
  if (status?.classList.contains('is-waiting')) {
    return { state: 'waiting', label: '更新待ち', message: '入力中のため、自動同期を一時停止しています。' };
  }
  return { state: 'ready', label: '同期済み', message: 'すべてのPCで共有できる状態です。' };
}

function renderSyncDetail() {
  const detail = syncStateDetails();
  const dot = $('syncDetailDot');
  if (dot) dot.className = `sync-detail-dot is-${detail.state}`;
  if ($('syncDetailState')) $('syncDetailState').textContent = detail.label;
  if ($('syncDetailMessage')) $('syncDetailMessage').textContent = detail.message;
  if ($('syncDetailOnline')) $('syncDetailOnline').textContent = navigator.onLine ? 'オンライン' : 'オフライン';
  if ($('syncDetailLastSync')) $('syncDetailLastSync').textContent = formatSyncDateTime(S.lastAutoSyncAt);
  if ($('syncDetailSchedules')) $('syncDetailSchedules').textContent = `${S.internalSchedules.length}件`;
  if ($('syncDetailNotes')) $('syncDetailNotes').textContent = `${Object.keys(S.stickyNotes).length}件`;
  if ($('syncDetailProgress')) $('syncDetailProgress').textContent = `${Object.keys(S.assigneeProgress).length}案件`;
  if ($('syncDetailLifecycle')) $('syncDetailLifecycle').textContent = `${Object.keys(S.projectLifecycle).length}案件`;
}

function openSyncDetail() {
  renderSyncDetail();
  const dialog = $('syncDetailDialog');
  if (dialog && !dialog.open) dialog.showModal();
}

function updateNetworkStatus() {
  if (navigator.onLine) {
    if ($('syncStatus')?.classList.contains('is-error')) updateSyncStatus('更新', 'ready');
  } else {
    updateSyncStatus('通信エラー', 'error');
  }
  renderSyncDetail();
}

function hasOpenEditingDialog() {
  return Boolean(document.querySelector('dialog[open]'));
}

function isEditingFieldActive() {
  const active = document.activeElement;
  if (!active) return false;
  return active.matches('input, textarea, select, [contenteditable="true"]');
}

function canAutoSyncNow() {
  return !document.hidden &&
    !S.autoSyncing &&
    S.sharedWritePending === 0 &&
    !hasOpenEditingDialog() &&
    !isEditingFieldActive();
}


function showRemoteUpdateNotice() {
  S.pendingRemoteUpdate = true;
  const notice = $('updateNotice');
  if (notice) notice.hidden = false;
  updateSyncStatus('更新待ち', 'waiting');
}


function hideRemoteUpdateNotice() {
  S.pendingRemoteUpdate = false;
  const notice = $('updateNotice');
  if (notice) notice.hidden = true;
  updateSyncStatus('更新', 'ready');
}



function updateSyncStatus(message, state = 'ready') {
  const label = $('refreshLabel');
  if (label) label.textContent = message;

  const status = $('syncStatus');
  const statusText = $('syncStatusText');
  if (!status || !statusText) return;

  status.className = `sync-status is-${state}`;
  const labels = {
    ready: '同期済み',
    saving: '保存中…',
    syncing: '他PCを同期中…',
    waiting: '更新待ち',
    error: '通信エラー'
  };
  statusText.textContent = labels[state] || message || '同期済み';
  renderSyncDetail();
}


async function autoSyncRemoteChanges() {
  if (!canAutoSyncNow()) {
    showRemoteUpdateNotice();
    return false;
  }

  S.autoSyncing = true;
  updateSyncStatus('同期中…', 'syncing');
  try {
    await load({ silent: true });
    hideRemoteUpdateNotice();
    S.lastAutoSyncAt = new Date().toISOString();
    updateSyncStatus('自動同期済み', 'ready');
    setTimeout(() => {
      if (!S.autoSyncing) updateSyncStatus('更新', 'ready');
    }, 1400);
    return true;
  } catch {
    showRemoteUpdateNotice();
    updateSyncStatus('通信エラー', 'error');
    return false;
  } finally {
    S.autoSyncing = false;
  }
}



async function pollRevision() {
  if (document.hidden || S.autoSyncing) return;
  if (!navigator.onLine) {
    updateSyncStatus('通信エラー', 'error');
    return;
  }

  try {
    const data = await api(`${API.projects}?mode=status`);
    const revision = String(data.revision ?? data.updatedAt ?? data.status?.revision ?? '');

    if (!S.revision) {
      S.revision = revision;
      updateSyncStatus('更新', 'ready');
      return;
    }

    if (!revision || revision === S.revision) {
      if (!$('syncStatus')?.classList.contains('is-saving')) {
        updateSyncStatus('更新', 'ready');
      }
      return;
    }

    if (canAutoSyncNow()) {
      await autoSyncRemoteChanges();
    } else {
      showRemoteUpdateNotice();
    }
  } catch {
    updateSyncStatus('通信エラー', 'error');
  }
}


function startPolling() {
  clearInterval(S.pollTimer);
  S.pollTimer = setInterval(pollRevision, POLL_INTERVAL);

  if (!startPolling.visibilityBound) {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pollRevision();
    });
    window.addEventListener('focus', () => pollRevision());
    window.addEventListener('pagehide', () => {
      clearInterval(S.pollTimer);
      S.pollTimer = null;
    });
    window.addEventListener('pageshow', () => {
      if (!S.pollTimer) {
        S.pollTimer = setInterval(pollRevision, POLL_INTERVAL);
        pollRevision();
      }
    });
    startPolling.visibilityBound = true;
  }
}

async function bulkDeleteSelectedProjects() {
  const ids = [...S.selectedProjectIds];
  if (!ids.length) return toast('削除する案件を選択してください。');
  if ($('bulkDeleteTarget')) $('bulkDeleteTarget').textContent = `${ids.length}件の案件`;
  if ($('bulkDeleteDialog')) $('bulkDeleteDialog').showModal();
}

async function confirmBulkDelete() {
  const ids = [...S.selectedProjectIds];
  if (!ids.length) return;

  // 削除前の案件データを保持し、API成功後にそのままごみ箱へ登録する。
  const targetMap = new Map(S.projects.map(project => [project.id, project]));
  const targets = ids.map(id => targetMap.get(id)).filter(Boolean);
  if (!targets.length) return toast('削除対象が見つかりません。');

  const confirmButton = $('confirmBulkDelete');
  const originalLabel = confirmButton?.textContent || 'ごみ箱へ移動';
  if (confirmButton) {
    confirmButton.disabled = true;
    confirmButton.textContent = `${targets.length}件を一括移動中…`;
  }

  try {
    // Phase2.2 高速化:
    // projects.mjsが受け付ける ?ids=ID1,ID2... を使い、DELETE通信を1回に集約する。
    // 削除後の全件再取得（load）は行わず、APIが返すdeletedIdsで画面状態を更新する。
    const params = new URLSearchParams({
      ids: targets.map(project => project.id).join(','),
      actorName: employeeName(S.actorEmployeeId)
    });

    const result = await api(`${API.projects}?${params.toString()}`, {
      method: 'DELETE'
    });

    const deletedIds = new Set(
      Array.isArray(result.deletedIds) ? result.deletedIds.map(String) : []
    );

    if (!deletedIds.size) {
      throw new Error('削除結果を確認できませんでした。');
    }

    const moved = targets.filter(project => deletedIds.has(String(project.id)));
    const failed = targets.filter(project => !deletedIds.has(String(project.id)));

    // サーバーの削除結果だけをローカル状態へ反映する。
    S.projects = S.projects.filter(project => !deletedIds.has(String(project.id)));
    addProjectsToTrash(moved);

    for (const project of moved) {
      delete S.assigneeProgress[project.id];
      delete S.projectLifecycle[project.id];
    }
    saveAssigneeProgress();
    saveProjectLifecycle();

    S.revision = String(result.revision ?? result.updatedAt ?? S.revision ?? '');
    S.selectedProjectIds.clear();
    $('bulkDeleteDialog').close();
    render();

    toast(failed.length
      ? `${moved.length}件をごみ箱へ移動しました（${failed.length}件は対象外でした）`
      : `${moved.length}件を一括でごみ箱へ移動しました`);
  } catch (error) {
    toast(error.message);
  } finally {
    if (confirmButton) {
      confirmButton.disabled = false;
      confirmButton.textContent = originalLabel;
    }
  }
}

function switchView(view) {
  document.querySelectorAll('.nav,.view').forEach(node => node.classList.remove('active'));
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');
  $(`${view}View`)?.classList.add('active');
  if (view === 'history' && !S.historyLoaded) loadHistory();
  if (view === 'home') requestAnimationFrame(() => scrollScheduleToToday());
  if (view === 'calendar') renderCalendar();
}

function bindFixedEvents() {
  $('projectForm').onsubmit = async event => {
    event.preventDefault();
    $('projectError').textContent = '';
    $('employeeChoiceError').textContent = '';
    const employeeIds = checkedValues('employeeChoices');
    const id = $('projectId').value;
    const existing = S.projects.find(item => item.id === id);
    const body = { id, shipNo: normalizeShipNo($('shipNo').value), displayName: apiTextOrEmptyPlaceholder($('displayName').value), productName: apiTextOrEmptyPlaceholder(existing?.productName || ''), client: safeTrim($('client').value), employeeIds, employeeId: employeeIds[0] || '', dueDate: $('dueDate').value || '', notes: safeTrim($('notes').value), quantity: existing?.quantity || 0, spec: existing?.spec || '', assigneeProgress: existing ? projectAssigneeProgress(existing) : {}, lifecycle: existing ? projectLifecycle(existing) : { status: 'in_progress' }, portalState: existing ? { assigneeProgress: projectAssigneeProgress(existing), lifecycle: projectLifecycle(existing) } : { assigneeProgress: {}, lifecycle: { status: 'in_progress' } }, ...actorPayload() };
    try {
      await api(API.projects, { method: id ? 'PUT' : 'POST', body });
      $('projectDialog').close();
      await load();
      toast(id ? '更新しました' : '登録しました');
    } catch (error) { $('projectError').textContent = error.message; }
  };

  $('readExcel').onclick = async () => {
    const file = $('excelFile').files[0];
    $('importReadError').textContent = '';
    if (!file) { $('importReadError').textContent = 'Excelファイルを選択してください。'; return; }
    try {
      const data = await api(API.excel, { method: 'POST', body: { base64: await fileBase64(file) } });
      S.importItems = (data.items || []).filter(isImportableItem);
      $('importClient').value = data.client || '';
      $('importDisplayName').value = data.displayName || '';
      $('importShipNo').value = 'S.';
      $('importDueDate').value = fd(new Date());
      $('importStep1').hidden = true;
      $('importStep2').hidden = false;
      renderImportRows();
    } catch (error) { $('importReadError').textContent = error.message; }
  };

  $('applyImportCommon').onclick = () => {
    const commonDropdown = $('importEmployeeDropdown');
    const employeeIds = commonDropdown ? [...commonDropdown.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value) : [];
    const date = $('importDueDate').value;
    document.querySelectorAll('[data-import-employees] .employee-multi-dropdown').forEach(details => setEmployeeMultiValues(details, employeeIds));
    document.querySelectorAll('.import-date').forEach(input => { if (date) input.value = date; });
  };

  $('backImport').onclick = () => { $('importStep1').hidden = false; $('importStep2').hidden = true; };
  $('importRows').onchange = event => {
    const details = event.target.closest('.employee-multi-dropdown');
    if (details) updateEmployeeMultiLabel(details);
    updateImportCount();
  };

  document.addEventListener('change', event => {
    const details = event.target.closest('.employee-multi-dropdown');
    if (details) updateEmployeeMultiLabel(details);
  });
  document.addEventListener('click', event => {
    const close = event.target.closest('.employee-multi-close');
    if (close) close.closest('details').open = false;
  });

  $('importForm').onsubmit = async event => {
    event.preventDefault();
    if ($('importStep2').hidden) return;
    const rows = [...document.querySelectorAll('[data-import-row]')].filter(row => row.querySelector('.import-select').checked);
    const common = { shipNo: normalizeShipNo($('importShipNo').value), displayName: apiTextOrEmptyPlaceholder($('importDisplayName').value), client: $('importClient').value.trim() };
    const projects = rows.map(row => {
      const ids = [...row.querySelectorAll('.employee-multi-dropdown input[type="checkbox"]:checked')].map(input => input.value);
      const employeeId = ids[0] || '';
      return { ...common, productName: apiTextOrEmptyPlaceholder(row.dataset.importProduct || ''), quantity: Number(row.querySelector('.import-quantity').value) || 0, spec: row.querySelector('.import-spec').value.trim(), notes: '', employeeIds: ids, employeeId, dueDate: row.querySelector('.import-date').value };
    });
    if (!projects.length) { $('importError').textContent = '登録する明細を選択してください。'; return; }
    $('importError').textContent = '';
    try {
      await api(API.projects, { method: 'POST', body: { projects, ...actorPayload() } });
      $('importDialog').close();
      await load();
      toast(`${projects.length}件を登録しました`);
    } catch (error) { $('importError').textContent = error.message; }
  };

  $('actorForm').onsubmit = event => {
    event.preventDefault();
    const id = document.querySelector('#actorChoices input:checked')?.value || '';
    if (!id) { $('actorError').textContent = 'お名前を選択してください。'; return; }
    setActor(id);
    $('actorDialog').close();
    toast(`${employeeName(id)}さんで開始します`);
  };

  $('actorSettingsForm').onsubmit = event => {
    event.preventDefault();
    const id = document.querySelector('#actorSettingsChoices input:checked')?.value || '';
    if (!id) { $('actorSettingsError').textContent = 'お名前を選択してください。'; return; }
    setActor(id);
    $('actorSettingsDialog').close();
    toast(`利用者を${employeeName(id)}さんに変更しました`);
  };

  $('refresh').onclick = async () => {
    const button = $('refresh');
    const label = $('refreshLabel');
    if (button?.disabled) return;
    button.disabled = true;
    button.classList.add('is-loading');
    if (label) label.textContent = '更新中…';
    try {
      await load();
      button.classList.remove('is-loading');
      button.classList.add('is-success');
      if (label) label.textContent = '更新しました';
      toast('最新のデータに更新しました');
      setTimeout(() => {
        button.classList.remove('is-success');
        if (label) label.textContent = '更新';
      }, 1400);
    } finally {
      button.disabled = false;
      button.classList.remove('is-loading');
    }
  };
  $('syncStatus').onclick = openSyncDetail;
  $('syncNow').onclick = async () => {
    const button = $('syncNow');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = '同期中…';
    try {
      await load();
      hideRemoteUpdateNotice();
      updateSyncStatus('同期済み', 'ready');
      renderSyncDetail();
      toast('最新の共有データに同期しました');
    } catch (error) {
      updateSyncStatus('通信エラー', 'error');
      toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  };
  $('openSharedDataManagement').onclick = () => {
    $('syncDetailDialog').close();
    switchView('masters');
    requestAnimationFrame(() => document.querySelector('.portal-data-management')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);

  $('search').oninput = debounce(event => {
    S.q = event.target.value;
    renderSchedule();
    renderDeadlines();
  });
  $('prev').onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); renderSchedule(); requestAnimationFrame(() => scrollScheduleToToday()); };
  $('next').onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); renderSchedule(); requestAnimationFrame(() => scrollScheduleToToday()); };
  $('refreshHistory').onclick = loadHistory;
  $('historyActionFilter').onchange = renderHistory;
  $('historyActorFilter').onchange = renderHistory;
  $('historySearch').oninput = renderHistory;
  $('applyUpdate').onclick = async () => {
    hideRemoteUpdateNotice();
    await load();
    toast('最新のデータに更新しました');
  };
  $('dismissUpdate').onclick = () => {
    hideRemoteUpdateNotice();
  };
  $('manageInternalSchedule').onclick = () => openInternalSchedule();
  $('resetInternalSchedule').onclick = resetInternalScheduleForm;
  $('internalScheduleType').onchange = updateInternalScheduleTypeUi;
  $('addInternalScheduleDate').onclick = () => {
    const date = $('internalScheduleDate').value;
    if (!date) return toast('追加する日付を選択してください。');
    setInternalScheduleDates([...getInternalScheduleDates(), date]);
    $('internalScheduleDate').value = '';
  };
  $('internalScheduleDateList').onclick = event => {
    const button = event.target.closest('[data-remove-internal-date]');
    if (!button) return;
    setInternalScheduleDates(getInternalScheduleDates().filter(date => date !== button.dataset.removeInternalDate));
  };
  $('internalScheduleForm').onsubmit = async event => {
    event.preventDefault();

    const form = event.currentTarget;
    const submitState = beginFormSubmission(form, '保存中…');
    if (!submitState) {
      toast('保存処理中です。しばらくお待ちください。');
      return;
    }

    try {
      const type = $('internalScheduleType').value === 'once' ? 'once' : 'monthly';
      const dates = type === 'once' ? getInternalScheduleDates() : [];
      const editingId = $('internalScheduleId').value;
      const item = normalizeInternalSchedule({
        id: editingId || `internal-${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
        title: safeTrim($('internalScheduleTitle').value),
        type,
        day: type === 'monthly' ? Number($('internalScheduleDay').value) || 1 : 1,
        month: 1,
        date: dates[0] || '',
        dates,
        time: $('internalScheduleTime').value,
        note: safeTrim($('internalScheduleNote').value)
      });

      if (!item.title) {
        toast('予定名を入力してください。');
        return;
      }
      if (type === 'once' && !item.dates.length) {
        toast('日付を1つ以上追加してください。');
        return;
      }

      const duplicateKey = JSON.stringify({
        action: editingId ? 'edit' : 'create',
        title: item.title,
        type: item.type,
        day: item.day,
        dates: item.dates,
        time: item.time,
        note: item.note
      });

      if (!editingId && isRecentDuplicateSubmission(duplicateKey, 3000)) {
        toast('同じ内容の予定を保存中、または保存済みです。');
        return;
      }

      // 画面内にも完全一致する新規予定がある場合は二重登録しない。
      const sameScheduleExists = !editingId && S.internalSchedules.some(existing => {
        const normalized = normalizeInternalSchedule(existing);
        return normalized.title === item.title &&
          normalized.type === item.type &&
          normalized.day === item.day &&
          JSON.stringify(normalized.dates || []) === JSON.stringify(item.dates || []) &&
          normalized.time === item.time &&
          normalized.note === item.note;
      });

      if (sameScheduleExists) {
        toast('同じ内容の社内予定がすでに登録されています。');
        return;
      }

      const index = S.internalSchedules.findIndex(x => x.id === item.id);
      const previousSchedules = S.internalSchedules.map(schedule => ({
        ...schedule,
        dates: [...(schedule.dates || [])]
      }));

      if (index >= 0) S.internalSchedules[index] = item;
      else S.internalSchedules.push(item);

      try {
        await saveInternalSchedules(item);
        renderCalendar();
        resetInternalScheduleForm();
        toast(index >= 0 ? '社内予定を更新しました' : '社内予定を登録しました');
      } catch (error) {
        S.internalSchedules = previousSchedules;
        localStorage.setItem(
          STORAGE_INTERNAL_SCHEDULES,
          JSON.stringify(S.internalSchedules)
        );
        renderSchedule();
        renderCalendar();
        renderInternalScheduleList();
        toast(error.message);
      }
    } finally {
      endFormSubmission(form, submitState);
    }
  };
  $('stickyNoteForm').onsubmit = async event => {
    event.preventDefault();
    const date = $('stickyNoteDate').value;
    const text = safeTrim($('stickyNoteText').value);
    const previousNotes = { ...S.stickyNotes };
    if (text) S.stickyNotes[date] = text; else delete S.stickyNotes[date];
    try {
      await saveStickyNotes(date);
      $('stickyNoteDialog').close();
      toast(text ? 'メモを保存しました' : 'メモを消しました');
    } catch (error) {
      S.stickyNotes = previousNotes;
      localStorage.setItem(STORAGE_STICKY_NOTES, JSON.stringify(S.stickyNotes));
      renderSchedule();
      toast(error.message);
    }
  };
  $('clearStickyNote').onclick = () => { $('stickyNoteText').value=''; $('stickyNoteForm').requestSubmit(); };
  $('calendarPrev').onclick = () => { S.calendarMonth=new Date(S.calendarMonth.getFullYear(),S.calendarMonth.getMonth()-1,1); renderCalendar(); };
  $('calendarNext').onclick = () => { S.calendarMonth=new Date(S.calendarMonth.getFullYear(),S.calendarMonth.getMonth()+1,1); renderCalendar(); };
  $('calendarSearch').oninput = debounce(event => {
    S.calendarQ = event.target.value;
    renderCalendar();
  });
  $('calendarEmployeeFilter').onchange = event => {
    S.calendarEmployeeId = event.target.value;
    renderCalendar();
  };
  $('calendarStatusFilter').onchange = event => {
    S.calendarStatusFilter = event.target.value;
    renderCalendar();
  };
  $('deadlineEmployeeFilter').onchange = event => {
    S.deadlineEmployeeId = event.target.value;
    renderDeadlines();
  };
  $('deadlineStatusFilter').onchange = event => {
    S.deadlineStatusFilter = event.target.value;
    renderDeadlines();
  };
  $('clearDeadlineFilters').onclick = () => {
    S.deadlineEmployeeId = '';
    S.deadlineStatusFilter = '';
    renderDeadlines();
  };

  if ($('exportLocalPortalData')) $('exportLocalPortalData').onclick = exportLocalPortalData;
  if ($('mergePortalBackups')) {
    $('mergePortalBackups').onclick = async () => {
      const input = $('portalBackupFiles');
      const button = $('mergePortalBackups');
      const original = button.textContent;
      button.disabled = true;
      button.textContent = '共有へ結合中…';
      try {
        await importAndMergePortalBackups(input?.files || []);
        if (input) input.value = '';
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    };
  }
}

function bindDelegatedEvents() {
  document.body.addEventListener('change', async event => {
    const progressCheckbox = event.target.closest('[data-assignee-complete]');
    if (progressCheckbox) {
      const projectId = progressCheckbox.dataset.projectId;
      const employeeId = progressCheckbox.value;
      const project = S.projects.find(item => item.id === projectId);
      const beforeStatus = project ? projectLifecycle(project).status : 'in_progress';
      if (await setAssigneeComplete(projectId, employeeId, progressCheckbox.checked)) {
        const afterStatus = project ? projectLifecycle(project).status : beforeStatus;
        const effect = beforeStatus !== afterStatus && afterStatus === 'production_complete'
          ? 'celebrate-production'
          : 'progress-updated';
        openDetail(projectId, effect);
        toast(beforeStatus !== afterStatus && afterStatus === 'production_complete'
          ? '担当者全員が完了し、製作完了になりました'
          : progressCheckbox.checked
            ? `${employeeName(employeeId)}さんを完了にしました`
            : `${employeeName(employeeId)}さんを未完了に戻しました`);
      }
      return;
    }

    const groupCheckbox = event.target.closest('[data-select-group]');
    if (groupCheckbox) {
      const group = projectGroup(groupCheckbox.dataset.selectGroup);
      if (group) group.projects.forEach(project => groupCheckbox.checked ? S.selectedProjectIds.add(project.id) : S.selectedProjectIds.delete(project.id));
      renderDeadlines();
      return;
    }
    const checkbox = event.target.closest('[data-select-project]');
    if (!checkbox) return;
    checkbox.checked ? S.selectedProjectIds.add(checkbox.dataset.selectProject) : S.selectedProjectIds.delete(checkbox.dataset.selectProject);
    renderDeadlines();
  });

  document.body.addEventListener('submit', async event => {
    const form = event.target.closest('[data-master]');
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector('input');
    try { await api(API.masters, { method: 'POST', body: { type: form.dataset.master, name: input.value } }); input.value = ''; await load(); } catch (error) { toast(error.message); }
  });

  document.body.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    try {
      if (button.dataset.view) switchView(button.dataset.view);
      else if (button.id === 'actorSettingsButton' || button.id === 'currentActorStatus') {
        renderActorChoices('actorSettingsChoices', S.actorEmployeeId);
        $('actorSettingsError').textContent = '';
        $('actorSettingsDialog').showModal();
      }
      else if (button.id === 'addProject' || button.dataset.add !== undefined) openProject();
      else if (button.dataset.stickyDate) openStickyNote(button.dataset.stickyDate);
      else if (button.dataset.openInternalSchedule !== undefined) openInternalSchedule(button.dataset.internalId || '');
      else if (button.dataset.editInternal) openInternalSchedule(button.dataset.editInternal);
      else if (button.dataset.deleteInternal) {
        const item=S.internalSchedules.find(x=>x.id===button.dataset.deleteInternal);
        const approved=await confirmDangerAction({title:'社内予定を削除しますか？',message:'登録済みの社内予定から削除します。',detail:item?.title||'',confirmText:'削除する'});
        if (approved) {
          const previousSchedules = S.internalSchedules.map(schedule => ({ ...schedule }));
          const deletedId = button.dataset.deleteInternal;
          S.internalSchedules = S.internalSchedules.filter(x => x.id !== deletedId);
          try {
            localStorage.setItem(STORAGE_INTERNAL_SCHEDULES, JSON.stringify(S.internalSchedules));
            await deleteSharedInternalSchedule(deletedId);
            renderSchedule();
            renderCalendar();
            renderInternalScheduleList();
            toast('社内予定を削除しました');
          } catch (error) {
            S.internalSchedules = previousSchedules;
            localStorage.setItem(STORAGE_INTERNAL_SCHEDULES, JSON.stringify(S.internalSchedules));
            renderSchedule();
            renderCalendar();
            renderInternalScheduleList();
            toast(error.message);
          }
        }
      }
      else if (button.dataset.copyProject) {
        const source=S.projects.find(x=>x.id===button.dataset.copyProject);
        if(source){ $('detailDialog')?.close(); openProject(); $('shipNo').value=source.shipNo||''; $('displayName').value=source.displayName||''; $('client').value=source.client||''; $('dueDate').value=source.dueDate||''; $('notes').value=source.notes||''; renderEmployeeCheckboxes('employeeChoices',projectEmployeeIds(source)); toast('案件内容をコピーしました。納期などを確認して登録してください。'); }
      }
      else if (button.id === 'importExcel') openImport();
      else if (button.dataset.close !== undefined) button.closest('dialog')?.close();
      else if (button.dataset.edit) openProject(button.dataset.edit);
      else if (button.dataset.groupDetail) openGroupDetail(button.dataset.groupDetail);
      else if (button.dataset.groupDelete) {
        const group = projectGroup(button.dataset.groupDelete);
        if (group) {
          S.selectedProjectIds.clear();
          group.projects.forEach(project => S.selectedProjectIds.add(project.id));
          await bulkDeleteSelectedProjects();
        }
      }
      else if (button.dataset.detail) openDetail(button.dataset.detail);
      else if (button.dataset.detailEdit) { $('detailDialog').close(); openProject(button.dataset.detailEdit); }
      else if (button.dataset.requestDelete) requestDelete(button.dataset.requestDelete);
      else if (button.dataset.delete) requestDelete(button.dataset.delete);
      else if (button.id === 'confirmDelete') await confirmDelete();
      else if (button.id === 'selectVisible') { filtered().forEach(project => S.selectedProjectIds.add(project.id)); renderDeadlines(); }
      else if (button.id === 'clearProjectSelection') { S.selectedProjectIds.clear(); renderDeadlines(); }
      else if (button.id === 'bulkDeleteProjects') await bulkDeleteSelectedProjects();
      else if (button.id === 'confirmBulkDelete') await confirmBulkDelete();
      else if (button.dataset.trashRestore) await restoreTrashEntry(button.dataset.trashRestore);
      else if (button.dataset.trashDelete) await permanentlyDeleteTrashEntry(button.dataset.trashDelete);
      else if (button.id === 'emptyTrash') await emptyTrash();
      else if (button.dataset.lifecycle) {
        const projectId = button.dataset.projectId;
        const targetStatus = button.dataset.lifecycle;
        const project = S.projects.find(item => item.id === projectId);
        const label = `${project?.shipNo || ''} ${project?.displayName || ''}`.trim();
        const settings = targetStatus === 'delivered'
          ? { title: '納品完了にしますか？', message: 'この案件を納品済みとして記録します。', detail: label, note: '納品完了はあとから取り消せます。', confirmText: '納品完了にする', tone: 'primary', icon: '✓' }
          : { title: `${lifecycleLabel(targetStatus)}に変更しますか？`, message: '案件ステータスを変更します。', detail: label, note: '変更後も必要に応じて戻せます。', confirmText: '変更する', tone: 'warning', icon: '↶' };
        const approved = await portalConfirm(settings);
        if (approved && await setProjectLifecycle(projectId, targetStatus)) {
          openDetail(projectId, targetStatus === 'delivered' ? 'celebrate-delivery' : 'status-updated');
          toast(`${lifecycleLabel(targetStatus)}に変更しました`);
        }
      }
      else if (button.dataset.toggle) { await api(API.projects, { method: 'PUT', body: { id: button.dataset.toggle, action: 'toggle', ...actorPayload() } }); await load(); }
      else if (button.dataset.materialUse) { applyMaterial(button.dataset.materialUse); switchView('calculator'); switchCalculatorTab('area'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else if (button.dataset.materialHistory) { openMaterialHistory(button.dataset.materialHistory); }
      else if (button.dataset.materialEdit) {
        const rawItem = S.materials.find(x => x.id === button.dataset.materialEdit);
        if (rawItem) {
          const item = normalizeMaterial(rawItem);
          $('materialMasterId').value = item.id;
          $('materialMasterName').value = item.name;
          $('materialMasterHeight').value = item.height;
          $('materialMasterHeightUnit').value = item.heightUnit;
          $('materialMasterWidth').value = item.width;
          $('materialMasterWidthUnit').value = item.widthUnit;
          $('materialMasterPrice').value = item.price;
          $('materialMasterEffectiveDate').value = item.effectiveDate || todayIsoDate();
          $('materialMasterSupplier').value = item.supplier || '';
          $('materialMasterChangeReason').value = '';
          $('cancelMaterialEdit').hidden = false;
          switchView('calculator');
          switchCalculatorTab('materials');
        }
      }
      else if (button.dataset.materialDelete) {
        const item = S.materials.find(x => x.id === button.dataset.materialDelete);
        const approved = await confirmDangerAction({ title: '材料を削除しますか？', message: '登録した材料マスタから削除します。', detail: item?.name || '', confirmText: '削除する' });
        if (approved) {
          const previousMaterials = S.materials.map(material => normalizeMaterial(material));
          S.materials = S.materials.filter(
            x => x.id !== button.dataset.materialDelete
          );
          try {
            await saveMaterials();
            toast('材料を全PCから削除しました');
          } catch (error) {
            S.materials = previousMaterials;
            localStorage.setItem(STORAGE_MATERIALS, JSON.stringify(S.materials));
            renderMaterialMaster();
            toast(`材料マスタの共有削除に失敗しました：${error.message}`);
          }
        }
      }
      else if (button.dataset.historyIndex !== undefined) openHistoryDetail(Number(button.dataset.historyIndex));
      else if (button.dataset.medit) { const item = S.masters[button.dataset.type].find(x => x.id === button.dataset.medit); const newName = prompt('新しい名称を入力してください。', item?.name || ''); if (newName !== null && newName.trim()) { await api(API.masters, { method: 'PUT', body: { type: button.dataset.type, id: button.dataset.medit, name: newName.trim() } }); await load(); } }
      else if (button.dataset.mtoggle) { const item = S.masters[button.dataset.type].find(x => x.id === button.dataset.mtoggle); await api(API.masters, { method: 'PUT', body: { type: button.dataset.type, id: button.dataset.mtoggle, active: item?.active === false } }); await load(); }
      else if (button.dataset.move) { await api(API.masters, { method: 'PUT', body: { type: button.dataset.type, id: button.dataset.id, action: 'move', direction: button.dataset.move } }); await load(); }
      else if (button.dataset.mdelete) {
        const item = S.masters[button.dataset.type]?.find(x => x.id === button.dataset.mdelete);
        const approved = await confirmDangerAction({ title: 'マスタ項目を削除しますか？', message: 'この項目をマスタから削除します。', detail: item?.name || '', note: '使用中の項目は削除できない場合があります。', confirmText: '削除する' });
        if (approved) { await api(`${API.masters}?id=${encodeURIComponent(button.dataset.mdelete)}`, { method: 'DELETE', body: { type: button.dataset.type } }); await load(); }
      }
    } catch (error) { toast(error.message); }
  });
}


function todayIsoDate() {
  return fd(new Date());
}

function normalizeMaterialHistoryEntry(entry = {}) {
  return {
    effectiveDate: safeTrim(entry.effectiveDate) || todayIsoDate(),
    price: Number(entry.price) || 0,
    supplier: safeTrim(entry.supplier),
    reason: safeTrim(entry.reason),
    recordedAt: safeTrim(entry.recordedAt) || new Date().toISOString(),
    recordedBy: safeTrim(entry.recordedBy)
  };
}

function normalizeMaterial(item = {}) {
  const history = Array.isArray(item.priceHistory)
    ? item.priceHistory.map(normalizeMaterialHistoryEntry)
    : [];
  const currentDate = safeTrim(item.effectiveDate) || todayIsoDate();
  const currentPrice = Number(item.price) || 0;

  if (!history.length) {
    history.push(normalizeMaterialHistoryEntry({
      effectiveDate: currentDate,
      price: currentPrice,
      supplier: item.supplier,
      reason: item.changeReason || '既存価格',
      recordedAt: item.updatedAt || new Date().toISOString()
    }));
  }

  history.sort((a, b) =>
    String(a.effectiveDate).localeCompare(String(b.effectiveDate)) ||
    String(a.recordedAt).localeCompare(String(b.recordedAt))
  );

  const latest = history[history.length - 1];
  return {
    ...item,
    price: Number(latest?.price ?? currentPrice),
    effectiveDate: latest?.effectiveDate || currentDate,
    supplier: safeTrim(latest?.supplier || item.supplier),
    changeReason: safeTrim(latest?.reason || item.changeReason),
    priceHistory: history
  };
}

function materialPriceAt(item, targetDate = '') {
  const material = normalizeMaterial(item);
  const date = safeTrim(targetDate) || todayIsoDate();
  const applicable = material.priceHistory
    .filter(entry => entry.effectiveDate <= date)
    .sort((a, b) =>
      String(a.effectiveDate).localeCompare(String(b.effectiveDate)) ||
      String(a.recordedAt).localeCompare(String(b.recordedAt))
    );
  return applicable.length ? applicable[applicable.length - 1] : material.priceHistory[0];
}

function openMaterialHistory(id) {
  const item = S.materials.find(material => material.id === id);
  if (!item) return;
  const material = normalizeMaterial(item);
  $('materialHistoryTitle').textContent = `${material.name} の価格履歴`;
  $('materialHistoryList').innerHTML = [...material.priceHistory]
    .sort((a, b) => String(b.effectiveDate).localeCompare(String(a.effectiveDate)))
    .map(entry => `<article class="material-history-entry">
      <div class="material-history-date">${esc(entry.effectiveDate)}</div>
      <div class="material-history-main">
        <strong>${yen(Number(entry.price), 0)}</strong>
        <p>${entry.supplier ? `仕入先：${esc(entry.supplier)}` : '仕入先：—'}</p>
        <p>${entry.reason ? `理由：${esc(entry.reason)}` : '理由：—'}</p>
      </div>
    </article>`).join('') || '<div class="notice">価格履歴はありません。</div>';
  $('materialHistoryDialog').showModal();
}

function updateMaterialPriceFromSelection() {
  const id = $('areaMaterialSelect')?.value || '';
  const item = S.materials.find(material => material.id === id);
  if (!item) return;
  const targetDate = $('materialPriceDate')?.value || todayIsoDate();
  const entry = materialPriceAt(item, targetDate);
  $('materialPrice').value = entry?.price ?? '';
  if ($('materialPriceSource')) {
    $('materialPriceSource').textContent =
      `${entry?.effectiveDate || '—'}改定価格${entry?.supplier ? ` ／ ${entry.supplier}` : ''}を使用しています。`;
  }
}


function parseMaterialSharedState(project) {
  if (!project) return null;
  try {
    const parsed = JSON.parse(String(project.notes || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function normalizeMaterialSharedState(state = {}) {
  return {
    version: 1,
    updatedAt: safeTrim(state.updatedAt),
    materials: Array.isArray(state.materials)
      ? state.materials.map(normalizeMaterial)
      : []
  };
}

function applyMaterialSharedState(project) {
  const state = normalizeMaterialSharedState(
    parseMaterialSharedState(project) || {}
  );
  S.materialSharedProjectId = project?.id || '';
  S.materials = state.materials;
  localStorage.setItem(STORAGE_MATERIALS, JSON.stringify(S.materials));
  renderMaterialMaster();
  return true;
}

function materialSharedStateBody(state = {}) {
  const employeeId = sharedPortalEmployeeId();
  if (!employeeId) {
    throw new Error('材料マスタの共有保存には社員マスタが1名以上必要です。');
  }

  const normalized = normalizeMaterialSharedState(state);
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    materials: normalized.materials
  };

  return {
    id: S.materialSharedProjectId || '',
    shipNo: MATERIAL_SHARED_SHIP_NO,
    displayName: '材料マスタ共有設定',
    productName: '材料・価格履歴共有データ',
    client: MATERIAL_SHARED_CLIENT,
    employeeIds: [employeeId],
    employeeId,
    dueDate: '2099-12-31',
    notes: JSON.stringify(payload),
    quantity: 0,
    spec: MATERIAL_SHARED_SPEC,
    completed: false,
    ...actorPayload()
  };
}

async function persistMaterialSharedState(materials = S.materials) {
  return queueSharedPortalWrite(async () => {
    const before = await api(API.projects);
    const sharedProject =
      (before.projects || []).find(isMaterialSharedProject) || null;

    if (sharedProject?.id) {
      S.materialSharedProjectId = String(sharedProject.id);
    }

    const state = {
      version: 1,
      updatedAt: new Date().toISOString(),
      materials: materials.map(normalizeMaterial)
    };

    const result = await api(API.projects, {
      method: sharedProject ? 'PUT' : 'POST',
      body: materialSharedStateBody(state)
    });

    const confirmed = await api(API.projects);
    const confirmedProject =
      (confirmed.projects || []).find(isMaterialSharedProject) || null;

    if (!confirmedProject) {
      throw new Error('材料マスタ共有データを確認できませんでした。');
    }

    const confirmedState = normalizeMaterialSharedState(
      parseMaterialSharedState(confirmedProject) || {}
    );
    const expected = normalizeMaterialSharedState(state);

    if (JSON.stringify(confirmedState.materials) !== JSON.stringify(expected.materials)) {
      throw new Error('材料マスタの共有保存結果を確認できませんでした。');
    }

    S.materialSharedProjectId = String(confirmedProject.id || '');
    S.materials = confirmedState.materials;
    localStorage.setItem(STORAGE_MATERIALS, JSON.stringify(S.materials));
    renderMaterialMaster();

    S.revision = String(
      confirmed.revision ??
      confirmed.updatedAt ??
      result?.revision ??
      result?.updatedAt ??
      S.revision ??
      ''
    );
    return true;
  });
}

function loadMaterials() {
  try { S.materials = JSON.parse(localStorage.getItem(STORAGE_MATERIALS) || '[]'); }
  catch { S.materials = []; }
  if (!Array.isArray(S.materials)) S.materials = [];
  S.materials = S.materials.map(normalizeMaterial);
}


async function saveMaterials() {
  localStorage.setItem(STORAGE_MATERIALS, JSON.stringify(S.materials));
  renderMaterialMaster();
  await persistMaterialSharedState(S.materials);
}

function toMm(value, unit) {
  const factors = { mm: 1, cm: 10, m: 1000 };
  return Number(value) * (factors[unit] || 1);
}

function yen(value, decimals = 2) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toLocaleString('ja-JP', { maximumFractionDigits: decimals })} 円`;
}

function areaText(mm2) {
  if (!Number.isFinite(mm2)) return '—';
  return `${mm2.toLocaleString('ja-JP', { maximumFractionDigits: 2 })} mm² ／ ${(mm2 / 1000000).toLocaleString('ja-JP', { maximumFractionDigits: 6 })} m²`;
}

function renderMaterialMaster() {
  const select = $('areaMaterialSelect');
  if (select) {
    const current = select.value;
    select.innerHTML = '<option value="">選択しない</option>' +
      S.materials.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    select.value = S.materials.some(item => item.id === current) ? current : '';
  }
  const list = $('materialMasterList');
  if (!list) return;
  list.innerHTML = S.materials.length
    ? S.materials.map(rawItem => {
        const item = normalizeMaterial(rawItem);
        return `<article class="material-row">
          <div>
            <strong>${esc(item.name)}</strong>
            <span>${esc(item.height)}${esc(item.heightUnit)} × ${esc(item.width)}${esc(item.widthUnit)}</span>
            <small>${yen(Number(item.price), 0)} ／ 価格改定日 ${esc(item.effectiveDate || '—')}</small>
            ${item.supplier ? `<small>仕入先：${esc(item.supplier)}</small>` : ''}
          </div>
          <div>
            <button type="button" class="secondary" data-material-use="${esc(item.id)}">計算に使う</button>
            <button type="button" class="secondary" data-material-history="${esc(item.id)}">価格履歴 ${item.priceHistory.length}件</button>
            <button type="button" data-material-edit="${esc(item.id)}">編集</button>
            <button type="button" class="danger" data-material-delete="${esc(item.id)}">削除</button>
          </div>
        </article>`;
      }).join('')
    : '<div class="notice">材料はまだ登録されていません。</div>';
}

function applyMaterial(id) {
  const rawItem = S.materials.find(x => x.id === id);
  if (!rawItem) return;
  const item = normalizeMaterial(rawItem);
  $('areaMaterialSelect').value = item.id;
  $('materialHeight').value = item.height;
  $('materialHeightUnit').value = item.heightUnit;
  $('materialWidth').value = item.width;
  $('materialWidthUnit').value = item.widthUnit;
  if (!$('materialPriceDate').value) $('materialPriceDate').value = todayIsoDate();
  updateMaterialPriceFromSelection();
}

function switchCalculatorTab(tab) {
  document.querySelectorAll('.calculator-tab').forEach(node => node.classList.toggle('active', node.dataset.calcTab === tab));
  document.querySelectorAll('.calculator-panel').forEach(node => node.classList.remove('active'));
  $(`calc${tab[0].toUpperCase()}${tab.slice(1)}Panel`)?.classList.add('active');
}

function bindCalculatorEvents() {
  document.querySelectorAll('[data-calc-tab]').forEach(button => button.onclick = () => switchCalculatorTab(button.dataset.calcTab));
  $('areaMaterialSelect').onchange = event => {
    if (event.target.value) applyMaterial(event.target.value);
  };
  $('materialPriceDate').onchange = updateMaterialPriceFromSelection;
  $('areaCalculatorForm').onsubmit = event => {
    event.preventDefault();
    const mh = toMm($('materialHeight').value, $('materialHeightUnit').value);
    const mw = toMm($('materialWidth').value, $('materialWidthUnit').value);
    const ph = toMm($('productHeight').value, $('productHeightUnit').value);
    const pw = toMm($('productWidth').value, $('productWidthUnit').value);
    const price = Number($('materialPrice').value);
    const ma = mh * mw, pa = ph * pw;
    if (!(ma > 0) || !(pa > 0) || !(price >= 0)) return toast('寸法と材料価格を正しく入力してください。');
    const ratio = pa / ma, cost = price * ratio;
    $('areaCostResult').textContent = yen(cost);
    $('areaCostCeil').textContent = yen(Math.ceil(cost), 0);
    $('materialAreaResult').textContent = areaText(ma);
    $('productAreaResult').textContent = areaText(pa);
    $('areaRatioResult').textContent = `${(ratio * 100).toLocaleString('ja-JP', { maximumFractionDigits: 4 })} %`;
  };
  $('clearAreaCalculator').onclick = () => { $('areaCalculatorForm').reset(); ['areaCostResult','areaCostCeil','materialAreaResult','productAreaResult','areaRatioResult'].forEach(id => $(id).textContent='—'); };
  $('yieldCalculatorForm').onsubmit = event => {
    event.preventDefault(); const price=Number($('yieldMaterialPrice').value), count=Number($('yieldCount').value);
    if (!(price >= 0) || !(count > 0)) return toast('材料価格と取り数を正しく入力してください。');
    const cost=price/count; $('yieldCostResult').textContent=yen(cost); $('yieldCostCeil').textContent=yen(Math.ceil(cost),0); $('yieldFormulaResult').textContent=`${price.toLocaleString()} ÷ ${count.toLocaleString()}`;
  };
  $('materialMasterForm').onsubmit = async event => {
    event.preventDefault();
    const id = $('materialMasterId').value || `mat-${Date.now()}`;
    const index = S.materials.findIndex(item => item.id === id);
    const previous = index >= 0 ? normalizeMaterial(S.materials[index]) : null;
    const price = Number($('materialMasterPrice').value);
    const effectiveDate = $('materialMasterEffectiveDate').value;
    const supplier = safeTrim($('materialMasterSupplier').value);
    const reason = safeTrim($('materialMasterChangeReason').value);

    if (!safeTrim($('materialMasterName').value) ||
        !(Number($('materialMasterHeight').value) > 0) ||
        !(Number($('materialMasterWidth').value) > 0) ||
        !(price >= 0) || !effectiveDate) {
      return toast('材料情報と価格改定日を正しく入力してください。');
    }

    const history = previous ? [...previous.priceHistory] : [];
    const latest = history[history.length - 1];
    if (!latest || Number(latest.price) !== price || latest.effectiveDate !== effectiveDate ||
        safeTrim(latest.supplier) !== supplier) {
      history.push(normalizeMaterialHistoryEntry({
        effectiveDate, price, supplier,
        reason: reason || (previous ? '価格改定' : '新規登録'),
        recordedAt: new Date().toISOString(),
        recordedBy: employeeName(S.actorEmployeeId)
      }));
    }

    const item = normalizeMaterial({
      id,
      name: safeTrim($('materialMasterName').value),
      height: Number($('materialMasterHeight').value),
      heightUnit: $('materialMasterHeightUnit').value,
      width: Number($('materialMasterWidth').value),
      widthUnit: $('materialMasterWidthUnit').value,
      price, effectiveDate, supplier, changeReason: reason, priceHistory: history
    });

    const previousMaterials = S.materials.map(material => normalizeMaterial(material));
    if (index >= 0) S.materials[index] = item; else S.materials.push(item);

    try {
      await saveMaterials();
      event.target.reset();
      $('materialMasterId').value = '';
      $('materialMasterEffectiveDate').value = todayIsoDate();
      $('cancelMaterialEdit').hidden = true;
      toast(index >= 0
        ? '材料と価格履歴を全PCへ更新しました'
        : '材料を全PCへ登録しました');
    } catch (error) {
      S.materials = previousMaterials;
      localStorage.setItem(STORAGE_MATERIALS, JSON.stringify(S.materials));
      renderMaterialMaster();
      toast(`材料マスタの共有保存に失敗しました：${error.message}`);
    }
  };
  $('cancelMaterialEdit').onclick = () => {
    $('materialMasterForm').reset();
    $('materialMasterId').value = '';
    $('materialMasterEffectiveDate').value = todayIsoDate();
    $('cancelMaterialEdit').hidden = true;
  };
  if (!$('materialPriceDate').value) $('materialPriceDate').value = todayIsoDate();
  if (!$('materialMasterEffectiveDate').value) $('materialMasterEffectiveDate').value = todayIsoDate();
}

async function init() {
  ensureActorUi();
  loadMaterials();
  loadAssigneeProgress();
  loadTrash();
  loadProjectLifecycle();
  loadInternalTools();
  renderMaterialMaster();
  bindCalculatorEvents();
  bindFixedEvents();
  bindDelegatedEvents();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  await load();
  startPolling();
}

init();
