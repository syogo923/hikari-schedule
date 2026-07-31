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
const POLL_INTERVAL = 30000;

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
  projectLifecycle: {}
};

const $ = id => document.getElementById(id);
const fd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const jp = value => value ? new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${value}T00:00:00`)) : '—';
const jpDateTime = value => value ? new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';

function toast(message) {
  const node = $('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2400);
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



function confirmDangerAction(options) {
  return portalConfirm({
    tone: 'danger',
    icon: '！',
    ...options
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store'
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || '通信に失敗しました。');
  return data;
}

function normalizeShipNo(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  if (/^s\.?\s*/i.test(text)) return `S.${text.replace(/^s\.?\s*/i, '')}`;
  if (/^\d/.test(text)) return `S.${text}`;
  return text;
}

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
  const saved = S.projectLifecycle[project.id];
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

function setProjectLifecycle(projectId, status) {
  const project = S.projects.find(item => item.id === projectId);
  if (!project) return false;
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

async function permanentlyDeleteTrashEntry(trashId) {
  const entry = S.trash.find(item => item.trashId === trashId);
  if (!entry) return;
  const label = `${entry.project.shipNo || ''} ${entry.project.displayName || ''}`.trim() || 'この案件';
  const approved = await portalConfirm({
    title: '案件を完全に削除しますか？',
    message: 'ごみ箱から完全に削除すると、元に戻せません。',
    detail: label,
    note: '必要な案件でないことを確認してから実行してください。',
    confirmText: '完全に削除', tone: 'danger', icon: '！'
  });
  if (!approved) return;
  removeTrashEntry(trashId);
  renderTrash();
  toast('ごみ箱から完全に削除しました');
}

async function emptyTrash() {
  if (!S.trash.length) return;
  const approved = await portalConfirm({
    title: 'ごみ箱を空にしますか？',
    message: `ごみ箱にある${S.trash.length}件をすべて完全に削除します。`,
    note: 'この操作は元に戻せません。',
    confirmText: 'すべて完全に削除', tone: 'danger', icon: '！'
  });
  if (!approved) return;
  S.trash = [];
  saveTrash();
  renderTrash();
  toast('ごみ箱を空にしました');
}

function projectAssigneeProgress(project) {
  const saved = S.assigneeProgress[project.id];
  const current = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  return Object.fromEntries(projectEmployeeIds(project).map(id => [id, current[id] === true]));
}

function assigneeProgressSummary(project) {
  const progress = projectAssigneeProgress(project);
  const total = Object.keys(progress).length;
  const completed = Object.values(progress).filter(Boolean).length;
  return { progress, total, completed };
}

function setAssigneeComplete(projectId, employeeId, completed) {
  const project = S.projects.find(item => item.id === projectId);
  if (!project || !projectEmployeeIds(project).includes(employeeId)) return false;

  const progress = projectAssigneeProgress(project);
  progress[employeeId] = Boolean(completed);
  S.assigneeProgress[projectId] = progress;
  saveAssigneeProgress();

  const summary = assigneeProgressSummary(project);
  const lifecycle = projectLifecycle(project);

  // 担当者全員が完了したら、案件も自動で「製作完了」にする。
  if (summary.total > 0 && summary.completed === summary.total && lifecycle.status === 'in_progress') {
    setProjectLifecycle(projectId, 'production_complete');
  }

  // 誰か一人でも未完了へ戻したら、納品前の案件は「製作中」に戻す。
  if (!completed && lifecycle.status !== 'in_progress') {
    setProjectLifecycle(projectId, 'in_progress');
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
    <p class="assignee-progress-note">チェック状態は、この端末のブラウザに保存されます。</p>
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
    <p class="project-lifecycle-storage-note">ステータスは、この端末のブラウザに保存されます。</p>
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
  if ($('productNameList')) $('productNameList').innerHTML = fillDatalist('products');
  if ($('clientList')) $('clientList').innerHTML = fillDatalist('clients');
  if ($('employeeId')) $('employeeId').innerHTML = optionHtml('employees');
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
  if ($('legacyEmployeeLabel')) $('legacyEmployeeLabel').hidden = true;
  if ($('employeeChoicesField')) $('employeeChoicesField').hidden = false;
  if ($('legacyImportEmployeeLabel')) $('legacyImportEmployeeLabel').hidden = true;
  if ($('importEmployeeChoicesField')) $('importEmployeeChoicesField').hidden = true;
}

function filtered() {
  const q = S.q.trim().toLowerCase();
  return S.projects.filter(project => !q || [
    project.shipNo, project.displayName, project.productName, project.client,
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
    group.projects.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || String(a.productName).localeCompare(String(b.productName), 'ja'));
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
  let html = '<thead><tr><th class="date-col">日付</th>' + employees.map(item => `<th style="${employeeColorStyle(item.id)}">${esc(item.name)}</th>`).join('') + '</tr></thead><tbody>';
  for (let day = 1; day <= days; day++) {
    const date = fd(new Date(year, month, day));
    html += `<tr data-schedule-date="${esc(date)}"><th>${esc(jp(date))}</th>` + employees.map(item => {
      const cards = groups.filter(group => group.dueDates[0] === date && group.employeeIds.includes(item.id)).map(group => groupCard(group, item.id)).join('');
      return `<td>${cards}</td>`;
    }).join('') + '</tr>';
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
  const groups = groupProjects(filtered()).sort((a, b) => statusOrder[groupLifecycleStatus(a)] - statusOrder[groupLifecycleStatus(b)] || String(a.dueDates[0] || '').localeCompare(String(b.dueDates[0] || '')));
  const selectedGroups = groups.filter(group => group.projects.every(project => S.selectedProjectIds.has(project.id)));
  const count = selectedGroups.length;
  const toolbar = `<div class="deadline-selection-toolbar"><button type="button" id="selectVisible" class="secondary">表示中をすべて選択</button><button type="button" id="clearProjectSelection" class="secondary">選択をすべて解除</button><strong id="selectedProjectCount">${count}案件選択中</strong><button type="button" id="bulkDeleteProjects" class="danger" ${count ? '' : 'disabled'}>選択した${count}案件をごみ箱へ</button></div>`;
  const items = groups.length ? groups.map(group => {
    const project = group.representative;
    const checked = group.projects.every(item => S.selectedProjectIds.has(item.id));
    const products = group.projects.slice(0, 3).map(item => item.productName || '製品名未設定').join('・');
    const more = group.projects.length > 3 ? ` ほか${group.projects.length - 3}件` : '';
    return `<article class="deadline grouped-deadline lifecycle-${esc(groupLifecycleStatus(group))}">
      <input type="checkbox" class="project-select" data-select-group="${esc(project.id)}" ${checked ? 'checked' : ''} aria-label="${esc(project.shipNo)}を選択">
      <button type="button" data-group-detail="${esc(project.id)}" class="check group-count-check" aria-label="案件詳細を開く">${group.projects.length}</button>
      <div><div class="deadline-heading"><time>${esc(groupDueLabel(group))}</time>${groupLifecycleBadgeHtml(group, true)}</div><h3>${esc(project.shipNo || '—')} ${esc(project.displayName || '—')}</h3><p><strong>${group.projects.length}明細</strong> ／ ${esc(products)}${esc(more)} ／ ${esc(groupEmployeeNames(group))}${project.client ? ` ／ ${esc(project.client)}` : ''}</p></div>
      <button type="button" data-group-detail="${esc(project.id)}">詳細</button>
      <button type="button" data-group-delete="${esc(project.id)}">ごみ箱へ</button>
    </article>`;
  }).join('') : '<div class="notice">案件はありません。</div>';
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
        <div class="trash-item-title"><strong>${esc(project.shipNo || '—')} ${esc(project.displayName || '')}</strong><span>${esc(project.productName || '—')}</span></div>
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

const masterLabels = { clients: '得意先', displayNames: '部門', products: '製作加工', employees: '職員' };
const masterOrder = ['clients', 'displayNames', 'products', 'employees'];
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
  fillSelects();
}

async function load({ silent = false } = {}) {
  try {
    const [projectData, masterData] = await Promise.all([api(API.projects), api(API.masters)]);
    S.projects = (projectData.projects || []).map(project => ({ ...project, employeeIds: projectEmployeeIds(project) }));
    S.masters = masterData.masters || S.masters;
    S.revision = String(projectData.revision ?? projectData.updatedAt ?? S.revision ?? '');
    render();
    requestAnimationFrame(() => scrollScheduleToToday());
    updateActorStatus();
    requestActorIfNeeded();
    const lastUpdated = $('lastUpdated');
    if (lastUpdated) lastUpdated.textContent = `最終更新：${new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date())}`;
  } catch (error) {
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
        <div class="group-detail-line-heading"><h3>${esc(item.productName || '製品名未設定')}</h3>${lifecycleBadgeHtml(item, true)}</div>
        <dl>
          <div><dt>数量</dt><dd>${item.quantity ? esc(item.quantity) : '—'}</dd></div>
          <div><dt>納期</dt><dd>${esc(jp(item.dueDate))}</dd></div>
          <div><dt>担当者</dt><dd>${esc(employeeNames(item))}</dd></div>
          <div><dt>仕様</dt><dd>${esc(item.spec || '—')}</dd></div>
        </dl>
      </div>
      <div class="group-detail-line-actions">
        <button type="button" class="secondary" data-detail="${esc(item.id)}">明細詳細</button>
        <button type="button" class="secondary" data-detail-edit="${esc(item.id)}">編集</button>
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
  $('detailBody').innerHTML = `<header><div>${backButton}<h2>明細詳細</h2></div><button type="button" data-close>×</button></header><dl><dt>番船</dt><dd>${esc(project.shipNo || '—')}</dd><dt>表示名</dt><dd>${esc(project.displayName || '—')}</dd><dt>製品名</dt><dd>${esc(project.productName || '—')}</dd><dt>数量</dt><dd>${project.quantity ? esc(project.quantity) : '—'}</dd><dt>仕様</dt><dd>${esc(project.spec || '—')}</dd><dt>担当者</dt><dd>${esc(employeeNames(project))}</dd><dt>得意先</dt><dd>${esc(project.client || '—')}</dd><dt>納期</dt><dd>${esc(jp(project.dueDate))}</dd><dt>メモ</dt><dd>${esc(project.notes || '—')}</dd></dl>${assigneeProgressHtml(project, effect === 'progress-updated' ? effect : '')}${lifecycleDetailHtml(project, effect)}<footer class="detail-actions"><button type="button" class="secondary" data-close>閉じる</button><div><button type="button" class="secondary" data-detail-edit="${esc(project.id)}">編集</button><button type="button" class="danger" data-request-delete="${esc(project.id)}">ごみ箱へ</button></div></footer>`;
  $('detailDialog').showModal();
}

function openProject(id = '') {
  const project = S.projects.find(item => item.id === id);
  $('projectId').value = project?.id || '';
  $('shipNo').value = project?.shipNo || 'S.';
  $('displayName').value = project?.displayName || '';
  $('productName').value = project?.productName || '';
  $('client').value = project?.client || '';
  $('dueDate').value = project?.dueDate || fd(new Date());
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
  $('deleteTarget').textContent = `${project.shipNo || ''} ${project.displayName || ''} ${project.productName || ''}`.trim();
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
    return `<tr data-import-row="${index}"><td><input type="checkbox" class="import-select" ${item.selected !== false ? 'checked' : ''}></td><td><input class="import-product" list="productNameList" value="${esc(item.productName || '')}"></td><td><input class="import-quantity" type="number" min="0" step="1" value="${esc(item.quantity || '')}"></td><td><textarea class="import-spec" rows="2">${esc([item.spec, item.remarks].filter(Boolean).join(' ／ '))}</textarea></td><td>${rowEmployeeSelect(index, selectedIds, autoEtching)}</td><td><input class="import-date" type="date" value="${esc($('importDueDate').value)}"></td></tr>`;
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
    const text = [project.shipNo, project.displayName, project.productName, item.summary, historyActorName(item)].join(' ').toLowerCase();
    return (!actionFilter || action === actionFilter) && (!actorFilter || historyActorId(item) === actorFilter) && (!query || text.includes(query));
  });
  if ($('historyEmpty')) $('historyEmpty').hidden = list.length !== 0;
  $('historyList').innerHTML = list.map((item, index) => {
    const project = historyProject(item);
    const actorId = historyActorId(item);
    const action = historyAction(item);
    return `<article class="history-item" style="${employeeColorStyle(actorId)}"><button type="button" data-history-index="${index}"><div class="history-meta"><time>${esc(jpDateTime(item.createdAt || item.updatedAt || item.timestamp))}</time><span class="history-actor">${esc(historyActorName(item))}</span><strong>${esc(historyLabels[action] || action || '更新')}</strong></div><h3>${esc(project.shipNo || '—')} ${esc(project.displayName || '')}</h3><p>${esc(project.productName || item.summary || '')}</p></button></article>`;
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
  const table = data => data ? `<dl><dt>番船</dt><dd>${esc(data.shipNo || '—')}</dd><dt>表示名</dt><dd>${esc(data.displayName || '—')}</dd><dt>製品名</dt><dd>${esc(data.productName || '—')}</dd><dt>担当者</dt><dd>${esc(employeeNames(data))}</dd><dt>納期</dt><dd>${esc(data.dueDate ? jp(data.dueDate) : '—')}</dd><dt>メモ</dt><dd>${esc(data.notes || '—')}</dd></dl>` : '<p class="muted">記録なし</p>';
  $('historyDetailBody').innerHTML = `<header><h2>更新履歴の詳細</h2><button type="button" data-close>×</button></header><p><strong>${esc(historyLabels[historyAction(item)] || historyAction(item) || '更新')}</strong>　${esc(jpDateTime(item.createdAt || item.updatedAt || item.timestamp))}</p><p>操作者：${esc(historyActorName(item))}</p><div class="history-compare"><section><h3>変更前</h3>${table(before)}</section><section><h3>変更後</h3>${table(after)}</section></div><footer><button type="button" class="secondary" data-close>閉じる</button></footer>`;
  $('historyDetailDialog').showModal();
}

async function pollRevision() {
  if (document.hidden || S.pendingRemoteUpdate) return;
  try {
    const data = await api(`${API.projects}?mode=status`);
    const revision = String(data.revision ?? data.updatedAt ?? data.status?.revision ?? '');
    if (!S.revision) { S.revision = revision; return; }
    if (revision && revision !== S.revision) {
      S.pendingRemoteUpdate = true;
      if ($('updateNotice')) $('updateNotice').hidden = false;
    }
  } catch {}
}

function startPolling() {
  clearInterval(S.pollTimer);
  S.pollTimer = setInterval(pollRevision, POLL_INTERVAL);
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
}

function bindFixedEvents() {
  $('projectForm').onsubmit = async event => {
    event.preventDefault();
    const employeeIds = checkedValues('employeeChoices');
    if (!employeeIds.length) { $('employeeChoiceError').textContent = '担当者を1人以上選択してください。'; return; }
    const id = $('projectId').value;
    const existing = S.projects.find(item => item.id === id);
    const body = { id, shipNo: normalizeShipNo($('shipNo').value), displayName: $('displayName').value.trim(), productName: $('productName').value.trim(), client: $('client').value.trim(), employeeIds, employeeId: employeeIds[0], dueDate: $('dueDate').value, notes: $('notes').value.trim(), quantity: existing?.quantity || 0, spec: existing?.spec || '', ...actorPayload() };
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
    const common = { shipNo: normalizeShipNo($('importShipNo').value), displayName: $('importDisplayName').value.trim(), client: $('importClient').value.trim() };
    const projects = rows.map(row => {
      const ids = [...row.querySelectorAll('.employee-multi-dropdown input[type="checkbox"]:checked')].map(input => input.value);
      const employeeId = ids[0] || '';
      return { ...common, productName: row.querySelector('.import-product').value.trim(), quantity: Number(row.querySelector('.import-quantity').value) || 0, spec: row.querySelector('.import-spec').value.trim(), notes: '', employeeIds: ids, employeeId, dueDate: row.querySelector('.import-date').value };
    });
    if (!projects.length) { $('importError').textContent = '登録する明細を選択してください。'; return; }
    if (!common.displayName || projects.some(item => !item.productName || !item.employeeIds.length || !item.dueDate)) { $('importError').textContent = '表示名・製品名・担当者・納期を確認してください。'; return; }
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
  $('search').oninput = event => { S.q = event.target.value; renderSchedule(); renderDeadlines(); };
  $('prev').onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); renderSchedule(); requestAnimationFrame(() => scrollScheduleToToday()); };
  $('next').onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); renderSchedule(); requestAnimationFrame(() => scrollScheduleToToday()); };
  $('refreshHistory').onclick = loadHistory;
  $('historyActionFilter').onchange = renderHistory;
  $('historyActorFilter').onchange = renderHistory;
  $('historySearch').oninput = renderHistory;
  $('applyUpdate').onclick = async () => { S.pendingRemoteUpdate = false; $('updateNotice').hidden = true; await load(); toast('最新のデータに更新しました'); };
  $('dismissUpdate').onclick = () => { S.pendingRemoteUpdate = false; $('updateNotice').hidden = true; };
}

function bindDelegatedEvents() {
  document.body.addEventListener('change', event => {
    const progressCheckbox = event.target.closest('[data-assignee-complete]');
    if (progressCheckbox) {
      const projectId = progressCheckbox.dataset.projectId;
      const employeeId = progressCheckbox.value;
      const project = S.projects.find(item => item.id === projectId);
      const beforeStatus = project ? projectLifecycle(project).status : 'in_progress';
      if (setAssigneeComplete(projectId, employeeId, progressCheckbox.checked)) {
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
        if (approved && setProjectLifecycle(projectId, targetStatus)) {
          openDetail(projectId, targetStatus === 'delivered' ? 'celebrate-delivery' : 'status-updated');
          toast(`${lifecycleLabel(targetStatus)}に変更しました`);
        }
      }
      else if (button.dataset.toggle) { await api(API.projects, { method: 'PUT', body: { id: button.dataset.toggle, action: 'toggle', ...actorPayload() } }); await load(); }
      else if (button.dataset.materialUse) { applyMaterial(button.dataset.materialUse); switchView('calculator'); switchCalculatorTab('area'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else if (button.dataset.materialEdit) { const item=S.materials.find(x=>x.id===button.dataset.materialEdit); if(item){ $('materialMasterId').value=item.id; $('materialMasterName').value=item.name; $('materialMasterHeight').value=item.height; $('materialMasterHeightUnit').value=item.heightUnit; $('materialMasterWidth').value=item.width; $('materialMasterWidthUnit').value=item.widthUnit; $('materialMasterPrice').value=item.price; $('cancelMaterialEdit').hidden=false; switchView('calculator'); switchCalculatorTab('materials'); } }
      else if (button.dataset.materialDelete) {
        const item = S.materials.find(x => x.id === button.dataset.materialDelete);
        const approved = await portalConfirm({ title: '材料を削除しますか？', message: '登録した材料マスタから削除します。', detail: item?.name || '', confirmText: '削除する', tone: 'danger', icon: '！' });
        if (approved) { S.materials=S.materials.filter(x=>x.id!==button.dataset.materialDelete); saveMaterials(); toast('材料を削除しました'); }
      }
      else if (button.dataset.historyIndex !== undefined) openHistoryDetail(Number(button.dataset.historyIndex));
      else if (button.dataset.medit) { const item = S.masters[button.dataset.type].find(x => x.id === button.dataset.medit); const newName = prompt('新しい名称を入力してください。', item?.name || ''); if (newName !== null && newName.trim()) { await api(API.masters, { method: 'PUT', body: { type: button.dataset.type, id: button.dataset.medit, name: newName.trim() } }); await load(); } }
      else if (button.dataset.mtoggle) { const item = S.masters[button.dataset.type].find(x => x.id === button.dataset.mtoggle); await api(API.masters, { method: 'PUT', body: { type: button.dataset.type, id: button.dataset.mtoggle, active: item?.active === false } }); await load(); }
      else if (button.dataset.move) { await api(API.masters, { method: 'PUT', body: { type: button.dataset.type, id: button.dataset.id, action: 'move', direction: button.dataset.move } }); await load(); }
      else if (button.dataset.mdelete) {
        const item = S.masters[button.dataset.type]?.find(x => x.id === button.dataset.mdelete);
        const approved = await portalConfirm({ title: 'マスタ項目を削除しますか？', message: 'この項目をマスタから削除します。', detail: item?.name || '', note: '使用中の項目は削除できない場合があります。', confirmText: '削除する', tone: 'danger', icon: '！' });
        if (approved) { await api(`${API.masters}?id=${encodeURIComponent(button.dataset.mdelete)}`, { method: 'DELETE', body: { type: button.dataset.type } }); await load(); }
      }
    } catch (error) { toast(error.message); }
  });
}


function loadMaterials() {
  try { S.materials = JSON.parse(localStorage.getItem(STORAGE_MATERIALS) || '[]'); }
  catch { S.materials = []; }
  if (!Array.isArray(S.materials)) S.materials = [];
}

function saveMaterials() {
  localStorage.setItem(STORAGE_MATERIALS, JSON.stringify(S.materials));
  renderMaterialMaster();
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
    select.innerHTML = '<option value="">選択しない</option>' + S.materials.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    select.value = S.materials.some(item => item.id === current) ? current : '';
  }
  const list = $('materialMasterList');
  if (!list) return;
  list.innerHTML = S.materials.length ? S.materials.map(item => `<article class="material-row"><div><strong>${esc(item.name)}</strong><span>${esc(item.height)}${esc(item.heightUnit)} × ${esc(item.width)}${esc(item.widthUnit)}</span><small>${yen(Number(item.price), 0)}</small></div><div><button type="button" class="secondary" data-material-use="${esc(item.id)}">計算に使う</button><button type="button" data-material-edit="${esc(item.id)}">編集</button><button type="button" class="danger" data-material-delete="${esc(item.id)}">削除</button></div></article>`).join('') : '<div class="notice">材料はまだ登録されていません。</div>';
}

function applyMaterial(id) {
  const item = S.materials.find(x => x.id === id);
  if (!item) return;
  $('areaMaterialSelect').value = item.id;
  $('materialHeight').value = item.height;
  $('materialHeightUnit').value = item.heightUnit;
  $('materialWidth').value = item.width;
  $('materialWidthUnit').value = item.widthUnit;
  $('materialPrice').value = item.price;
}

function switchCalculatorTab(tab) {
  document.querySelectorAll('.calculator-tab').forEach(node => node.classList.toggle('active', node.dataset.calcTab === tab));
  document.querySelectorAll('.calculator-panel').forEach(node => node.classList.remove('active'));
  $(`calc${tab[0].toUpperCase()}${tab.slice(1)}Panel`)?.classList.add('active');
}

function bindCalculatorEvents() {
  document.querySelectorAll('[data-calc-tab]').forEach(button => button.onclick = () => switchCalculatorTab(button.dataset.calcTab));
  $('areaMaterialSelect').onchange = event => { if (event.target.value) applyMaterial(event.target.value); };
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
  $('materialMasterForm').onsubmit = event => {
    event.preventDefault(); const id=$('materialMasterId').value || `mat-${Date.now()}`;
    const item={id,name:$('materialMasterName').value.trim(),height:Number($('materialMasterHeight').value),heightUnit:$('materialMasterHeightUnit').value,width:Number($('materialMasterWidth').value),widthUnit:$('materialMasterWidthUnit').value,price:Number($('materialMasterPrice').value)};
    if (!item.name || !(item.height>0) || !(item.width>0) || !(item.price>=0)) return toast('材料情報を正しく入力してください。');
    const index=S.materials.findIndex(x=>x.id===id); if(index>=0) S.materials[index]=item; else S.materials.push(item); saveMaterials(); event.target.reset(); $('materialMasterId').value=''; $('cancelMaterialEdit').hidden=true; toast(index>=0?'材料を更新しました':'材料を登録しました');
  };
  $('cancelMaterialEdit').onclick=()=>{ $('materialMasterForm').reset(); $('materialMasterId').value=''; $('cancelMaterialEdit').hidden=true; };
}

async function init() {
  ensureActorUi();
  loadMaterials();
  loadAssigneeProgress();
  loadTrash();
  loadProjectLifecycle();
  renderMaterialMaster();
  bindCalculatorEvents();
  bindFixedEvents();
  bindDelegatedEvents();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  await load();
  startPolling();
}

init();
