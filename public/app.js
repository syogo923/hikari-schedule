'use strict';

const API = {
  projects: '/api/projects',
  masters: '/api/masters',
  excel: '/api/excel-import'
};

const STORAGE_ACTOR_ID = 'hikariPortal.actorEmployeeId';
const STORAGE_MATERIALS = 'hikariPortal.materialMasters.v1';
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
  materials: []
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
  if ($('importEmployeeChoicesField')) $('importEmployeeChoicesField').hidden = false;
}

function filtered() {
  const q = S.q.trim().toLowerCase();
  return S.projects.filter(project => !q || [
    project.shipNo, project.displayName, project.productName, project.client,
    project.spec, project.notes, employeeNames(project)
  ].join(' ').toLowerCase().includes(q));
}

function projectCard(project, employeeId) {
  return `<button class="job ${project.completed ? 'done' : ''}" style="${employeeColorStyle(employeeId)}" data-detail="${esc(project.id)}"><b>${esc(project.shipNo || '—')}</b><span>${esc(project.displayName)}</span><small>${esc(project.productName)}</small></button>`;
}

function renderSchedule() {
  const year = S.month.getFullYear();
  const month = S.month.getMonth();
  if ($('month')) $('month').textContent = `${year}年${month + 1}月`;
  const employees = ordered('employees').filter(item => item.active !== false);
  if ($('emptyEmployees')) $('emptyEmployees').textContent = employees.length ? '' : '社員マスタを登録すると、職員別スケジュールが表示されます。';
  const days = new Date(year, month + 1, 0).getDate();
  let html = '<thead><tr><th class="date-col">日付</th>' + employees.map(item => `<th style="${employeeColorStyle(item.id)}">${esc(item.name)}</th>`).join('') + '</tr></thead><tbody>';
  for (let day = 1; day <= days; day++) {
    const date = fd(new Date(year, month, day));
    html += `<tr><th>${esc(jp(date))}</th>` + employees.map(item => {
      const cards = filtered().filter(project => project.dueDate === date && projectEmployeeIds(project).includes(item.id)).map(project => projectCard(project, item.id)).join('');
      return `<td>${cards}</td>`;
    }).join('') + '</tr>';
  }
  html += '</tbody>';
  if ($('scheduleTable')) $('scheduleTable').innerHTML = html;
}

function renderDeadlines() {
  const list = filtered().slice().sort((a, b) => Number(a.completed) - Number(b.completed) || String(a.dueDate).localeCompare(String(b.dueDate)));
  const count = S.selectedProjectIds.size;
  const toolbar = `<div class="deadline-selection-toolbar"><button type="button" id="selectVisible" class="secondary">表示中をすべて選択</button><button type="button" id="clearProjectSelection" class="secondary">選択をすべて解除</button><strong id="selectedProjectCount">${count}件選択中</strong><button type="button" id="bulkDeleteProjects" class="danger" ${count ? '' : 'disabled'}>選択した${count}件を削除</button></div>`;
  const items = list.length ? list.map(project => `
    <article class="deadline ${project.completed ? 'done' : ''}">
      <input type="checkbox" class="project-select" data-select-project="${esc(project.id)}" ${S.selectedProjectIds.has(project.id) ? 'checked' : ''} aria-label="${esc(project.shipNo)}を選択">
      <button type="button" data-toggle="${esc(project.id)}" class="check">${project.completed ? '✓' : ''}</button>
      <div><time>${esc(jp(project.dueDate))}</time><h3>${esc(project.shipNo)} ${esc(project.displayName)}</h3><p>${esc(project.productName)}${project.quantity ? ` × ${esc(project.quantity)}` : ''} ／ ${esc(employeeNames(project))}${project.client ? ` ／ ${esc(project.client)}` : ''}</p></div>
      <button type="button" data-edit="${esc(project.id)}">編集</button>
      <button type="button" data-delete="${esc(project.id)}">削除</button>
    </article>
  `).join('') : '<div class="notice">案件はありません。</div>';
  if ($('deadlineList')) $('deadlineList').innerHTML = toolbar + items;
}

const masterLabels = { employees: '社員', clients: '得意先', displayNames: '表示名', products: '製品' };
function renderMasters() {
  if (!$('masterGrid')) return;
  $('masterGrid').innerHTML = Object.keys(masterLabels).map(type => `<section class="master-card"><h3>${masterLabels[type]}マスタ</h3><form data-master="${type}"><input placeholder="${masterLabels[type]}名"><button class="primary">追加</button></form><div>${ordered(type).map((item, index, array) => `<div class="master-item ${item.active === false ? 'inactive' : ''}"><span>${esc(item.name)}</span><div class="master-actions"><button type="button" data-move="up" data-id="${esc(item.id)}" data-type="${type}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-move="down" data-id="${esc(item.id)}" data-type="${type}" ${index === array.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-medit="${esc(item.id)}" data-type="${type}">変更</button><button type="button" data-mtoggle="${esc(item.id)}" data-type="${type}">${item.active === false ? '表示' : '非表示'}</button><button type="button" data-mdelete="${esc(item.id)}" data-type="${type}">削除</button></div></div>`).join('') || '<p class="muted">登録なし</p>'}</div></section>`).join('');
}

function render() {
  renderSchedule();
  renderDeadlines();
  renderMasters();
  fillSelects();
}

async function load({ silent = false } = {}) {
  try {
    const [projectData, masterData] = await Promise.all([api(API.projects), api(API.masters)]);
    S.projects = (projectData.projects || []).map(project => ({ ...project, employeeIds: projectEmployeeIds(project) }));
    S.masters = masterData.masters || S.masters;
    S.revision = String(projectData.revision ?? projectData.updatedAt ?? S.revision ?? '');
    render();
    updateActorStatus();
    requestActorIfNeeded();
  } catch (error) {
    if (!silent) toast(error.message);
  }
}

function openDetail(id) {
  const project = S.projects.find(item => item.id === id);
  if (!project) return toast('案件が見つかりません。');
  $('detailBody').innerHTML = `<header><h2>案件詳細</h2><button type="button" data-close>×</button></header><dl><dt>番船</dt><dd>${esc(project.shipNo || '—')}</dd><dt>表示名</dt><dd>${esc(project.displayName || '—')}</dd><dt>製品名</dt><dd>${esc(project.productName || '—')}</dd><dt>数量</dt><dd>${project.quantity ? esc(project.quantity) : '—'}</dd><dt>仕様</dt><dd>${esc(project.spec || '—')}</dd><dt>担当者</dt><dd>${esc(employeeNames(project))}</dd><dt>得意先</dt><dd>${esc(project.client || '—')}</dd><dt>納期</dt><dd>${esc(jp(project.dueDate))}</dd><dt>メモ</dt><dd>${esc(project.notes || '—')}</dd></dl><footer class="detail-actions"><button type="button" class="secondary" data-close>閉じる</button><div><button type="button" class="secondary" data-detail-edit="${esc(project.id)}">編集</button><button type="button" class="danger" data-request-delete="${esc(project.id)}">削除</button></div></footer>`;
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
  try {
    await api(`${API.projects}?id=${encodeURIComponent(S.pendingDeleteId)}`, { method: 'DELETE', body: actorPayload() });
    S.selectedProjectIds.delete(S.pendingDeleteId);
    S.pendingDeleteId = '';
    $('deleteDialog').close();
    await load();
    toast('案件を削除しました');
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


function employeeCheckboxOptions(selectedIds) {
  const selected = new Set(selectedIds);
  return ordered('employees').filter(item => item.active !== false).map(item => `<label class="employee-choice" style="${employeeColorStyle(item.id)}"><input type="checkbox" value="${esc(item.id)}" ${selected.has(item.id) ? 'checked' : ''}><span>${esc(item.name)}</span></label>`).join('');
}

function rowEmployeeCheckboxes(index, selectedIds, autoEtching = false) {
  const choices = employeeCheckboxOptions(selectedIds);
  if (autoEtching) {
    return `<details class="import-assignee-details" data-import-employees="${index}" data-auto-etching="true"><summary><span class="import-assignee-label" data-assignee-label>エッチング → マサヒーロー</span><span class="import-assignee-change">変更</span></summary><div class="employee-choices compact import-row-employees">${choices}</div></details>`;
  }
  return `<div class="employee-choices compact import-row-employees" data-import-employees="${index}">${choices}</div>`;
}

function updateImportAssigneeLabels(scope = document) {
  scope.querySelectorAll('.import-assignee-details').forEach(container => {
    const checked = [...container.querySelectorAll('input[type="checkbox"]:checked')];
    const names = checked.map(input => employeeName(input.value));
    const label = container.querySelector('[data-assignee-label]');
    if (!label) return;
    const masahiroOnly = checked.length === 1 && employeeName(checked[0].value) === 'マサヒーロー';
    label.textContent = masahiroOnly ? 'エッチング → マサヒーロー' : (names.length ? `担当：${names.join('・')}` : '担当者を選択');
  });
}

function renderImportRows() {
  const masahiroId = findMasahiroId();
  let hasAutoAssign = false;
  $('importRows').innerHTML = S.importItems.map((item, index) => {
    const autoEtching = isEtching(item) && Boolean(masahiroId);
    const selectedIds = autoEtching ? [masahiroId] : [];
    if (selectedIds.length) hasAutoAssign = true;
    return `<tr data-import-row="${index}"><td><input type="checkbox" class="import-select" ${item.selected !== false ? 'checked' : ''}></td><td><input class="import-product" list="productNameList" value="${esc(item.productName || '')}"></td><td><input class="import-quantity" type="number" min="0" step="1" value="${esc(item.quantity || '')}"></td><td><textarea class="import-spec" rows="2">${esc([item.spec, item.remarks].filter(Boolean).join(' ／ '))}</textarea></td><td>${rowEmployeeCheckboxes(index, selectedIds, autoEtching)}</td><td><input class="import-date" type="date" value="${esc($('importDueDate').value)}"></td></tr>`;
  }).join('');
  if ($('etchingAutoAssignNotice')) $('etchingAutoAssignNotice').hidden = !hasAutoAssign;
  updateImportAssigneeLabels($('importRows'));
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
  try {
    await api(API.projects, { method: 'DELETE', body: { ids, ...actorPayload() } });
    S.selectedProjectIds.clear();
    $('bulkDeleteDialog').close();
    await load();
    toast(`${ids.length}件の案件を削除しました。`);
  } catch (error) {
    let deleted = 0;
    for (const id of ids) {
      try { await api(`${API.projects}?id=${encodeURIComponent(id)}`, { method: 'DELETE', body: actorPayload() }); deleted++; } catch {}
    }
    S.selectedProjectIds.clear();
    $('bulkDeleteDialog').close();
    await load();
    toast(`${deleted}件の案件を削除しました。`);
  }
}

function switchView(view) {
  document.querySelectorAll('.nav,.view').forEach(node => node.classList.remove('active'));
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');
  $(`${view}View`)?.classList.add('active');
  if (view === 'history' && !S.historyLoaded) loadHistory();
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
    const ids = checkedValues('importEmployeeChoices');
    const date = $('importDueDate').value;
    document.querySelectorAll('[data-import-employees]').forEach(container => {
      container.querySelectorAll('input[type="checkbox"]').forEach(input => { input.checked = ids.includes(input.value); });
    });
    document.querySelectorAll('.import-date').forEach(input => { if (date) input.value = date; });
    updateImportAssigneeLabels($('importRows'));
  };

  $('backImport').onclick = () => { $('importStep1').hidden = false; $('importStep2').hidden = true; };
  $('importRows').onchange = event => {
    updateImportCount();
    if (event.target.matches('.import-row-employees input[type="checkbox"]')) updateImportAssigneeLabels($('importRows'));
  };

  $('importForm').onsubmit = async event => {
    event.preventDefault();
    if ($('importStep2').hidden) return;
    const rows = [...document.querySelectorAll('[data-import-row]')].filter(row => row.querySelector('.import-select').checked);
    const common = { shipNo: normalizeShipNo($('importShipNo').value), displayName: $('importDisplayName').value.trim(), client: $('importClient').value.trim() };
    const projects = rows.map(row => {
      const ids = [...row.querySelectorAll('.import-row-employees input:checked')].map(input => input.value);
      return { ...common, productName: row.querySelector('.import-product').value.trim(), quantity: Number(row.querySelector('.import-quantity').value) || 0, spec: row.querySelector('.import-spec').value.trim(), notes: '', employeeIds: ids, employeeId: ids[0] || '', dueDate: row.querySelector('.import-date').value };
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

  $('refresh').onclick = () => load();
  $('search').oninput = event => { S.q = event.target.value; renderSchedule(); renderDeadlines(); };
  $('prev').onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); renderSchedule(); };
  $('next').onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); renderSchedule(); };
  $('refreshHistory').onclick = loadHistory;
  $('historyActionFilter').onchange = renderHistory;
  $('historyActorFilter').onchange = renderHistory;
  $('historySearch').oninput = renderHistory;
  $('applyUpdate').onclick = async () => { S.pendingRemoteUpdate = false; $('updateNotice').hidden = true; await load(); toast('最新のデータに更新しました'); };
  $('dismissUpdate').onclick = () => { S.pendingRemoteUpdate = false; $('updateNotice').hidden = true; };
}

function bindDelegatedEvents() {
  document.body.addEventListener('change', event => {
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
      else if (button.dataset.detail) openDetail(button.dataset.detail);
      else if (button.dataset.detailEdit) { $('detailDialog').close(); openProject(button.dataset.detailEdit); }
      else if (button.dataset.requestDelete) requestDelete(button.dataset.requestDelete);
      else if (button.dataset.delete) requestDelete(button.dataset.delete);
      else if (button.id === 'confirmDelete') await confirmDelete();
      else if (button.id === 'selectVisible') { filtered().forEach(project => S.selectedProjectIds.add(project.id)); renderDeadlines(); }
      else if (button.id === 'clearProjectSelection') { S.selectedProjectIds.clear(); renderDeadlines(); }
      else if (button.id === 'bulkDeleteProjects') await bulkDeleteSelectedProjects();
      else if (button.id === 'confirmBulkDelete') await confirmBulkDelete();
      else if (button.dataset.toggle) { await api(API.projects, { method: 'PUT', body: { id: button.dataset.toggle, action: 'toggle', ...actorPayload() } }); await load(); }
      else if (button.dataset.materialUse) { applyMaterial(button.dataset.materialUse); switchView('calculator'); switchCalculatorTab('area'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else if (button.dataset.materialEdit) { const item=S.materials.find(x=>x.id===button.dataset.materialEdit); if(item){ $('materialMasterId').value=item.id; $('materialMasterName').value=item.name; $('materialMasterHeight').value=item.height; $('materialMasterHeightUnit').value=item.heightUnit; $('materialMasterWidth').value=item.width; $('materialMasterWidthUnit').value=item.widthUnit; $('materialMasterPrice').value=item.price; $('cancelMaterialEdit').hidden=false; switchView('calculator'); switchCalculatorTab('materials'); } }
      else if (button.dataset.materialDelete && confirm('この材料を削除しますか？')) { S.materials=S.materials.filter(x=>x.id!==button.dataset.materialDelete); saveMaterials(); toast('材料を削除しました'); }
      else if (button.dataset.historyIndex !== undefined) openHistoryDetail(Number(button.dataset.historyIndex));
      else if (button.dataset.medit) { const item = S.masters[button.dataset.type].find(x => x.id === button.dataset.medit); const newName = prompt('新しい名称を入力してください。', item?.name || ''); if (newName !== null && newName.trim()) { await api(API.masters, { method: 'PUT', body: { type: button.dataset.type, id: button.dataset.medit, name: newName.trim() } }); await load(); } }
      else if (button.dataset.mtoggle) { const item = S.masters[button.dataset.type].find(x => x.id === button.dataset.mtoggle); await api(API.masters, { method: 'PUT', body: { type: button.dataset.type, id: button.dataset.mtoggle, active: item?.active === false } }); await load(); }
      else if (button.dataset.move) { await api(API.masters, { method: 'PUT', body: { type: button.dataset.type, id: button.dataset.id, action: 'move', direction: button.dataset.move } }); await load(); }
      else if (button.dataset.mdelete && confirm('この項目を削除しますか？')) { await api(`${API.masters}?id=${encodeURIComponent(button.dataset.mdelete)}`, { method: 'DELETE', body: { type: button.dataset.type } }); await load(); }
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
  renderMaterialMaster();
  bindCalculatorEvents();
  bindFixedEvents();
  bindDelegatedEvents();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  await load();
  startPolling();
}

init();
