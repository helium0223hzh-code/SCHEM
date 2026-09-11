(function () {
  'use strict';

  const App = {
    state: SchemStorage.defaultState(),
    fileHandle: null,
    storageSource: 'idb',
    storagePending: false,
    currentRoute: 'overview',
    basicState: {
      material: 'Water',
      series: '',
      mode: 'process',
      process: {
        hotInput: '',
        hotOutput: '',
        hotFlow: '',
        coldInput: '',
        coldOutput: '',
        coldFlow: '',
        hotFlowUnit: 'mass',
        coldFlowUnit: 'mass'
      },
      temp: {
        material: '',
        side: 'hot',
        input: '',
        output: ''
      },
      results: []
    },
    advanceQuery: '',
    advanceType: 'all',
    editorTab: null,
    editorCategory: null,
    editorBQuery: '',
    editorAQuery: '',
    bTemplates: null,
    outputFolderHandle: null,
    sourceFolderHandle: null,
    exportFolderHandle: null,
    modelStatuses: [],
    tubeDB: [],
    dtsDB: [],
    tubeSearch: {
      tempRange: '85~30℃',
      pressureMode: '100',
      series: 'Sline',
      materialFlow: '',
      serviceFlow: '',
      only72: false
    },
    lists: [],
    selectedListId: null
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function toNum(value) {
    if (value == null || value === '') return null;
    const n = Number(String(value).replace(/,/g, '.'));
    return Number.isFinite(n) ? n : null;
  }

  function closeEnough(a, b) {
    if (a == null || b == null) return false;
    const tolerance = Math.max(0.0001, Math.abs(a) * 0.005);
    return Math.abs(a - b) <= tolerance;
  }

  function formatDate(value) {
    if (!value) return '/';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    const pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function cap(str) {
    return String(str || '').charAt(0).toUpperCase() + String(str || '').slice(1);
  }

  function addRecent(action, label, type, recordId) {
    App.state.recentEdits.unshift({
      id: uuid(),
      action: action,
      label: label || '',
      type: type,
      recordId: recordId || null,
      time: nowIso()
    });
    if (App.state.recentEdits.length > 30) {
      App.state.recentEdits.length = 30;
    }
  }

  async function commit() {
    const result = await SchemStorage.saveState(App.state, App.fileHandle);
    App.storageSource = result.source;
    if (result.warning) {
      App.storagePending = true;
    }
    updateStorageStatus(result);
    return result;
  }

  function updateStorageStatus(result) {
    const el = document.getElementById('storage-status');
    if (!el) return;
    const removable = localStorage.getItem('scheme-removable-disk') === '1';
    let icon = '';
    let text = '';

    if (!App.fileHandle) {
      icon = '<span class="storage-icon danger">!</span>';
      text = t('storageBrowserWarning');
    } else {
      const name = SchemStorage.getFileName(App.fileHandle);
      if (removable) {
        icon = '<span class="storage-icon warning">!</span>';
        text = t('storageRemovableWarning') + ' (' + name + ')';
      } else if (App.storagePending) {
        icon = '<span class="storage-icon warning">!</span>';
        text = t('storagePending') + ' (' + name + ')';
      } else if ((result && result.source === 'file') || App.storageSource === 'file') {
        icon = '<span class="storage-icon info">✓</span>';
        text = t('storageLocalFile') + ': ' + name;
      } else {
        icon = '<span class="storage-icon warning">!</span>';
        text = t('storageBrowser') + ' (' + name + ')';
      }
    }

    el.innerHTML = icon + '<span>' + esc(text) + '</span>';
  }

  function currentLangName() {
    return getLang() === 'zh' ? '中文' : 'English';
  }

  function setActiveNav(route) {
    document.querySelectorAll('.nav-link').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.route === route);
    });
  }

  function navigate(route) {
    App.currentRoute = route;
    setActiveNav(route);
    renderPage(route);
  }

  function renderPage(route) {
    const main = document.getElementById('main-content');
    if (!main) return;
    if (route === 'overview') {
      renderOverview(main);
    } else if (route === 'tubeSearch') {
      renderStandardTubeSearch(main);
    } else if (route === 'lists') {
      renderLists(main);
    } else if (route === 'advance') {
      renderAdvance(main);
    } else if (route === 'editor') {
      renderEditor(main);
    } else if (route === 'modelStatus') {
      renderModelStatus(main);
    } else if (route === 'pageSettings') {
      renderPageSettings(main);
    } else if (route === 'feedback') {
      renderFeedback(main);
    } else {
      renderOverview(main);
    }
  }

  function renderOverview(main) {
    const bCount = App.state.dbB.length;
    const aCount = App.state.dbA.length;
    const materials = new Set(collectMaterials().filter(function (m) { return m && m !== 'NA_'; }));
    const series = new Set(collectSeries(null));
    series.add('Pharma line S');
    series.add('Pharma line DTS');
    const recent = App.state.recentEdits.slice(0, 8);

    let recentHtml = '';
    if (!recent.length) {
      recentHtml = '<div class="empty">' + esc(t('noRecentEdits')) + '</div>';
    } else {
      recentHtml = recent.map(function (item) {
        const actionText = t('recentAction' + cap(item.action));
        const typeText = item.type === 'B' ? 'SCHEM B' : item.type === 'A' ? 'SCHEM A' : '';
        const record = findRecentRecord(item);
        const filePath = record && record.filePath ? String(record.filePath) : '';
        const fileLink = filePath
          ? '<button class="recent-open" data-open="' + esc(filePath) + '">' + esc(t('openLocation')) + '</button>'
          : '';
        const pathPart = filePath ? '<span class="recent-file-path">' + esc(filePath) + '</span>' : '';
        return '<div class="recent-item">' +
          '<div><div class="recent-title"><strong>' + esc(item.label || item.recordId || item.id) + '</strong>' + pathPart + '</div>' +
          '<div class="recent-meta">' + esc(actionText) + ' · ' + esc(typeText) + '</div></div>' +
          '<div class="recent-side">' + fileLink + '<span class="recent-meta">' + esc(formatDate(item.time)) + '</span></div>' +
          '</div>';
      }).join('');
    }

    main.innerHTML =
      '<section class="page">' +
      '<h1 class="page-title">' + esc(t('overviewTitle')) + '</h1>' +
      '<p class="page-subtitle">' + esc(t('overviewSubtitle')) + '</p>' +
      (App.fileHandle ? '' :
        '<div class="banner">' +
        '<span>' + esc(t('setupBanner')) + '</span>' +
        '<div class="banner-actions"><button class="btn btn-primary" id="overview-storage-btn">' + esc(t('dataFile')) + '</button></div>' +
        '</div>') +
      '<div class="card">' +
      '<h2>' + esc(t('overviewDatabase')) + '</h2>' +
      '<div class="grid grid-3">' +
      metric(t('lists'), App.lists.length, iconPencilPaper()) +
      metric(t('materialCount'), materials.size, iconDroplet(), 'materials') +
      metric(t('seriesCount'), series.size, iconDirectory(), 'series') +
      '</div></div>' +
      '<div class="grid grid-3">' +
      '<div class="card module-card"><div class="module-head"><span class="module-icon">' + iconDatabase() + '</span><h3>' + esc(t('lists')) + '</h3></div><p class="text-muted">' + esc(t('listsSubtitle')) + '</p><button class="btn btn-primary" data-route="lists">' + esc(t('lists')) + '</button></div>' +
      '<div class="card module-card"><div class="module-head"><span class="module-icon">' + iconTypewriter() + '</span><h3>' + esc(t('databaseEditor')) + '</h3></div><p class="text-muted">' + esc(t('editorSummary')) + '</p><button class="btn btn-primary" data-route="editor">' + esc(t('goEditor')) + '</button></div>' +
      '<div class="card module-card"><div class="module-head"><span class="module-icon">' + iconSearch() + '</span><h3>' + esc(t('pageSettings')) + '</h3></div><p class="text-muted">' + esc(t('pageSettingsSubtitle')) + '</p><button class="btn btn-primary" data-route="pageSettings">' + esc(t('pageSettings')) + '</button></div>' +
      '</div>' +
      '<div class="card">' +
      '<h2>' + esc(t('overviewRecent')) + '</h2>' + recentHtml +
      '</div>' +
      '</section>';

    main.querySelectorAll('[data-route]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navigate(btn.dataset.route);
      });
    });
    main.querySelectorAll('[data-open]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openLocation(btn.dataset.open);
      });
    });
    main.querySelectorAll('[data-manage="materials"]').forEach(function (el) {
      el.addEventListener('click', function () {
        showMaterialEditor();
      });
    });
    main.querySelectorAll('[data-manage="series"]').forEach(function (el) {
      el.addEventListener('click', function () {
        showSeriesEditor();
      });
    });
    const storageBtn = document.getElementById('overview-storage-btn');
    if (storageBtn) {
      storageBtn.addEventListener('click', function () {
        showStorageSetupModal();
      });
    }
  }

  function findRecentRecord(item) {
    if (!item || !item.recordId) return null;
    if (item.type === 'B') return App.state.dbB.find(function (r) { return r.id === item.recordId; });
    if (item.type === 'A') return App.state.dbA.find(function (r) { return r.id === item.recordId; });
    return null;
  }

  function openLocation(path) {
    const target = String(path || '').trim();
    if (!target) return;
    fetch('/open-location?path=' + encodeURIComponent(target))
      .then(function (response) {
        if (!response.ok) {
          window.alert(t('openLocationFail'));
        }
      })
      .catch(function () {
        window.alert(t('openLocationFail'));
      });
  }

  function metric(label, value, icon, action) {
    const clickable = action ? ' metric-clickable' : '';
    const attr = action ? ' data-manage="' + action + '"' : '';
    return '<div class="metric' + clickable + '"' + attr + '><div class="metric-icon">' + (icon || '') + '</div><div class="metric-value">' + esc(value) + '</div><div class="metric-label">' + esc(label) + '</div></div>';
  }

  function iconSearch() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';
  }

  function iconTypewriter() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M10 14h.01M14 14h.01M18 14h.01M8 18h8"/></svg>';
  }

  function iconPencilPaper() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h9l4 4v14H5z"/><path d="M14 3v5h4"/><path d="M9 13h6M9 16h6"/><path d="m8 17-2 2"/></svg>';
  }

  function iconDroplet() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.3 6 11a6 6 0 0 1-12 0c0-4.7 6-11 6-11z"/></svg>';
  }

  function iconDirectory() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  }

  function iconDatabase() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>';
  }

  function showMaterialEditor() {
    const list = collectMaterials().filter(function (m) { return m !== 'Water' && m !== 'NA_'; }).slice();

    function rowHtml(value, idx) {
      return '<div class="list-row"><input class="list-input" data-idx="' + idx + '" value="' + esc(value) + '"><button class="btn btn-sm btn-danger" data-del="' + idx + '">' + esc(t('delete')) + '</button></div>';
    }

    function renderList() {
      const listEl = document.getElementById('material-list');
      if (!listEl) return;
      listEl.innerHTML = list.map(function (value, idx) { return rowHtml(value, idx); }).join('');
      listEl.querySelectorAll('[data-del]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const idx = Number(btn.dataset.del);
          const value = list[idx];
          if (App.state.dbB.some(function (r) { return r.material === value; })) {
            window.alert(t('deleteMaterialInUse'));
            return;
          }
          list.splice(idx, 1);
          renderList();
        });
      });
      listEl.querySelectorAll('.list-input').forEach(function (input) {
        input.addEventListener('input', function () {
          list[Number(input.dataset.idx)] = input.value;
        });
      });
    }

    openModal(
      '<div class="modal-header"><h3>' + esc(t('materialEditorTitle')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<div class="list-locked">Water <span class="badge warn">' + esc(t('locked')) + '</span></div>' +
      '<div id="material-list"></div>' +
      '<div class="list-add"><input id="list-new" placeholder="' + esc(t('addMaterial')) + '"><button class="btn" id="list-add-btn">' + esc(t('add')) + '</button></div>' +
      '<div class="list-locked">NA_ <span class="badge warn">' + esc(t('locked')) + '</span></div>' +
      '<div class="modal-actions"><button class="btn btn-warning" id="export-material-list">' + esc(t('exportMaterialList')) + '</button><button class="btn" id="m-cancel">' + esc(t('cancel')) + '</button><button class="btn btn-primary" id="m-save">' + esc(t('save')) + '</button></div>'
    );
    renderList();
    document.getElementById('list-add-btn').addEventListener('click', function () {
      const input = document.getElementById('list-new');
      const value = String(input.value || '').trim();
      if (!value || value === 'Water' || value === 'NA_') return;
      if (list.includes(value)) return;
      list.push(value);
      input.value = '';
      renderList();
    });
    document.getElementById('m-cancel').addEventListener('click', closeModal);
    document.getElementById('export-material-list').addEventListener('click', async function () {
      const rows = list.map(function (value) { return { [t('material')]: value }; });
      await writeWorkbook(rows, 'Material_List.xlsx');
    });
    document.getElementById('m-save').addEventListener('click', async function () {
      const cleaned = list.map(function (v) { return String(v).trim(); }).filter(function (v, idx, arr) { return v && arr.indexOf(v) === idx; });
      App.state.materials = cleaned;
      closeModal();
      await commit();
      await syncConfigJson();
      renderPage(App.currentRoute);
    });
  }

  function showSeriesEditor() {
    const list = collectSeries(null).slice();

    function rowHtml(value, idx) {
      return '<div class="list-row"><input class="list-input" data-idx="' + idx + '" value="' + esc(value) + '"><button class="btn btn-sm btn-danger" data-del="' + idx + '">' + esc(t('delete')) + '</button></div>';
    }

    function renderList() {
      const listEl = document.getElementById('series-list');
      if (!listEl) return;
      listEl.innerHTML = list.map(function (value, idx) { return rowHtml(value, idx); }).join('');
      listEl.querySelectorAll('[data-del]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const idx = Number(btn.dataset.del);
          const value = list[idx];
          if (App.state.dbB.some(function (r) { return r.series === value; })) {
            window.alert(t('deleteSeriesInUse'));
            return;
          }
          list.splice(idx, 1);
          renderList();
        });
      });
      listEl.querySelectorAll('.list-input').forEach(function (input) {
        input.addEventListener('input', function () {
          list[Number(input.dataset.idx)] = input.value;
        });
      });
    }

    openModal(
      '<div class="modal-header"><h3>' + esc(t('seriesEditorTitle')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<div class="list-locked">Pharma line S <span class="badge warn">' + esc(t('locked')) + '</span></div>' +
      '<div class="model-list">' +
      (function () {
        const models = Array.from(new Set((App.tubeDB || []).map(function (r) { return r.model; })));
        models.sort(function (a, b) {
          return tubeModelOrder(a).s - tubeModelOrder(b).s || tubeModelOrder(a).n - tubeModelOrder(b).n;
        });
        return models.map(function (model) { return '<span class="model-chip">' + esc(model) + '</span>'; }).join('');
      }()) +
      '</div>' +
      '<div class="list-locked">Pharma line DTS <span class="badge warn">' + esc(t('locked')) + '</span></div>' +
      '<div class="model-list">' +
      (function () {
        const models = Array.from(new Set((App.dtsDB || []).map(function (r) { return r.model; })));
        return models.map(function (model) { return '<span class="model-chip">' + esc(model) + '</span>'; }).join('');
      }()) +
      '</div>' +
      '<div id="series-list"></div>' +
      '<div class="list-add"><input id="list-new" placeholder="' + esc(t('addSeries')) + '"><button class="btn" id="list-add-btn">' + esc(t('add')) + '</button></div>' +
      '<div class="modal-actions"><button class="btn btn-warning" id="export-series-list">' + esc(t('exportSeriesList')) + '</button><button class="btn" id="s-cancel">' + esc(t('cancel')) + '</button><button class="btn btn-primary" id="s-save">' + esc(t('save')) + '</button></div>'
    );
    renderList();
    document.getElementById('list-add-btn').addEventListener('click', function () {
      const input = document.getElementById('list-new');
      const value = String(input.value || '').trim();
      if (!value) return;
      if (list.includes(value)) return;
      list.push(value);
      input.value = '';
      renderList();
    });
    document.getElementById('s-cancel').addEventListener('click', closeModal);
    document.getElementById('export-series-list').addEventListener('click', async function () {
      const rows = list.map(function (value) { return { [t('series')]: value }; });
      await writeWorkbook(rows, 'Series_List.xlsx');
    });
    document.getElementById('s-save').addEventListener('click', async function () {
      const cleaned = list.map(function (v) { return String(v).trim(); }).filter(function (v, idx, arr) { return v && arr.indexOf(v) === idx; });
      App.state.series = cleaned;
      closeModal();
      await commit();
      await syncConfigJson();
      renderPage(App.currentRoute);
    });
  }

  function collectMaterials() {
    const values = new Set();
    App.state.dbB.forEach(function (r) {
      [r.material, r.hotMaterial, r.coldMaterial].forEach(function (m) {
        if (m === 'Water-Water') m = 'Water';
        if (m && m !== 'NA_') values.add(m);
      });
    });
    const ordered = ['Water'];
    (App.state.materials || []).forEach(function (m) {
      if (m && m !== 'Water' && m !== 'NA_' && !ordered.includes(m)) ordered.push(m);
    });
    values.forEach(function (v) {
      if (!ordered.includes(v)) ordered.push(v);
    });
    ordered.push('NA_');
    return ordered;
  }

  function collectSeries(material) {
    const values = new Set(App.state.series || []);
    App.state.dbB.forEach(function (r) {
      if (!r.series) return;
      if (material && material !== 'NA_') {
        if (r.material === material || r.hotMaterial === material || r.coldMaterial === material) values.add(r.series);
      } else {
        values.add(r.series);
      }
    });
    return Array.from(values);
  }

  function materialOptionsHtml(selected, includeNew) {
    const materials = collectMaterials();
    let html = '';
    materials.forEach(function (m) {
      if (m === 'NA_') return;
      const label = m === 'Water' ? t('materialDefault') : m;
      html += '<option value="' + esc(m) + '"' + (selected === m ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    if (includeNew) {
      html += '<option value="__new__">+ ' + esc(t('newMaterial')) + '</option>';
    }
    html += '<option value="NA_"' + (selected === 'NA_' ? ' selected' : '') + '>' + esc(t('materialNA')) + '</option>';
    return html;
  }

  function materialOptionsHtmlWithBlank(selected, includeNew) {
    return '<option value="">' + esc(t('materialSelection')) + '</option>' + materialOptionsHtml(selected, includeNew);
  }

  function addMaterialValue(name) {
    const cleaned = String(name || '').trim();
    if (!cleaned || cleaned === 'Water' || cleaned === 'NA_' || cleaned === '__new__') return '';
    if (!App.state.materials.includes(cleaned)) {
      App.state.materials.push(cleaned);
    }
    return cleaned;
  }

  function addSeriesValue(name) {
    const cleaned = String(name || '').trim();
    if (!cleaned) return '';
    if (!App.state.series.includes(cleaned)) {
      App.state.series.push(cleaned);
    }
    return cleaned;
  }

  function defaultBTemplate() {
    return {
      id: 'default',
      name: t('defaultBlankRecord'),
      fields: [
        { key: 'hotMaterial', label: t('hotMaterial'), type: 'material' },
        { key: 'coldMaterial', label: t('coldMaterial'), type: 'material' },
        { key: 'series', label: t('series'), type: 'text' },
        { key: 'model', label: t('model'), type: 'text' },
        { key: 'plateCount', label: t('plateCount'), type: 'text' },
        { key: 'plateMaterial', label: t('plateMaterial'), type: 'text' },
        { key: 'plateThickness', label: t('plateThickness'), type: 'text' },
        { key: 'gasketMaterial', label: t('gasketMaterial'), type: 'text' },
        { key: 'hotInputTemp', label: t('hotInputTemp'), type: 'number' },
        { key: 'hotOutputTemp', label: t('hotOutputTemp'), type: 'number' },
        { key: 'hotFlow', label: t('hotFlow'), type: 'number' },
        { key: 'hotFlowUnit', label: t('hotFlowUnit'), type: 'flowUnit' },
        { key: 'coldInputTemp', label: t('coldInputTemp'), type: 'number' },
        { key: 'coldOutputTemp', label: t('coldOutputTemp'), type: 'number' },
        { key: 'coldFlow', label: t('coldFlow'), type: 'number' },
        { key: 'coldFlowUnit', label: t('coldFlowUnit'), type: 'flowUnit' }
      ]
    };
  }

  function tubeBTemplate() {
    const template = defaultBTemplate();
    template.id = 'tube';
    template.name = t('tubeDefaultBlankRecord');
    return template;
  }

  function ensureBTemplates() {
    if (!Array.isArray(App.bTemplates) || !App.bTemplates.length) {
      App.bTemplates = [defaultBTemplate(), tubeBTemplate()];
    }
    if (!App.bTemplates.some(function (t) { return t.id === 'default'; })) {
      App.bTemplates.unshift(defaultBTemplate());
    }
    if (!App.bTemplates.some(function (t) { return t.id === 'tube'; })) {
      const defaultIndex = App.bTemplates.findIndex(function (t) { return t.id === 'default'; });
      App.bTemplates.splice(defaultIndex + 1, 0, tubeBTemplate());
    }
  }

  async function saveBTemplates() {
    ensureBTemplates();
    await SchemDB.set('bTemplates', App.bTemplates);
  }

  function tubeModelOrder(model) {
    const m = String(model || '').match(/S\s*(\d+)\s*-\s*([\d.]+)/i);
    if (!m) return { s: 999, n: 999 };
    return { s: Number(m[1]), n: Number(m[2]) };
  }

  function tubeFlowTolerance(value) {
    return Math.max(1, Math.abs(value) * 0.06);
  }

  function renderStandardTubeSearch(main) {
    const q = App.tubeSearch || {
      tempRange: '85~30℃',
      pressureMode: '100',
      materialInletFlow: '',
      materialOutletFlow: ''
    };
    App.tubeSearch = q;
    const tempOptions = ['85~30℃', '85~25℃', '85~20℃', '80~25℃', '80~20℃'].map(function (value) {
      return '<option value="' + esc(value) + '"' + (q.tempRange === value ? ' selected' : '') + '>' + esc(value) + '</option>';
    }).join('');
    main.innerHTML =
      '<section class="page">' +
      '<h1 class="page-title">' + esc(t('tubeSearchNav')) + '</h1>' +
      '<p class="page-subtitle">' + esc(t('tubeSearchSubtitle')) + '</p>' +
      '<div class="card">' +
      '<div class="tube-search-grid">' +
      '<div class="field"><label>' + esc(t('series')) + '</label><select id="std-series">' +
      '<option value="Sline"' + (q.series === 'Sline' ? ' selected' : '') + '>Sline</option>' +
      '<option value="DTS"' + (q.series === 'DTS' ? ' selected' : '') + '>DTS</option>' +
      '</select></div>' +
      '<div class="field"><label>' + esc(t('tempRange')) + '</label><select id="std-temp-range">' + tempOptions + '</select></div>' +
      '<div class="field"><label>' + esc(t('pressureDrop')) + '</label><select id="std-pressure">' +
      '<option value="50"' + (q.pressureMode === '50' ? ' selected' : '') + '>50 kPa</option>' +
      '<option value="100"' + (q.pressureMode === '100' ? ' selected' : '') + '>100 kPa</option>' +
      '</select></div>' +
      '<div class="field"><label>' + esc(t('hotFlow')) + ' (kg/h)</label><input id="std-material-flow" type="number" step="any" value="' + esc(q.materialFlow) + '"></div>' +
      '<div class="field"><label>' + esc(t('coldFlow')) + ' (kg/h)</label><input id="std-service-flow" type="number" step="any" value="' + esc(q.serviceFlow) + '"></div>' +
      '<div class="field"><label><input id="std-only-72" type="checkbox"' + (q.only72 ? ' checked' : '') + '> ' + esc(t('only72')) + '</label></div>' +
      '<div class="field search-button-field"><button id="std-search-btn" class="btn btn-primary">' + esc(t('search')) + '</button></div>' +
      '</div>' +
      '</div>' +
      '<div class="card">' +
      '<h2>' + esc(t('searchResults')) + '</h2>' +
      '<div id="std-results" class="table-wrap"></div>' +
      '</div>' +
      '</section>';

    document.getElementById('std-series').addEventListener('change', function (e) { q.series = e.target.value; });
    document.getElementById('std-temp-range').addEventListener('change', function (e) { q.tempRange = e.target.value; });
    document.getElementById('std-pressure').addEventListener('change', function (e) { q.pressureMode = e.target.value; });
    document.getElementById('std-material-flow').addEventListener('input', function (e) { q.materialFlow = e.target.value; });
    document.getElementById('std-service-flow').addEventListener('input', function (e) { q.serviceFlow = e.target.value; });
    document.getElementById('std-only-72').addEventListener('change', function (e) { q.only72 = e.target.checked; });
    document.getElementById('std-search-btn').addEventListener('click', function () {
      runStandardTubeSearch();
    });
  }

  function runStandardTubeSearch() {
    const q = App.tubeSearch;
    const tempMatch = String(q.tempRange || '').match(/(\d+)\s*~\s*(\d+)/);
    const container = document.getElementById('std-results');
    if (!container) return;
    if (!tempMatch) {
      container.innerHTML = '<div class="empty">' + esc(t('noResults')) + '</div>';
      return;
    }
    const inTemp = Number(tempMatch[1]);
    const outTemp = Number(tempMatch[2]);
    const materialFlow = toNum(q.materialFlow);
    const serviceFlow = toNum(q.serviceFlow);
    if (materialFlow == null) {
      container.innerHTML = '<div class="empty">' + esc(t('tubeSearchMissing')) + '</div>';
      return;
    }
    const pressure = q.pressureMode || '100';
    const db = q.series === 'DTS' ? App.dtsDB : App.tubeDB;
    const rows = db.filter(function (r) {
      if (r.material_in !== inTemp || r.material_out !== outTemp) return false;
      if (pressure === '50' && r.condition !== '50kpa') return false;
      if (pressure === '100' && r.condition === '50kpa') return false;
      if (q.only72 && r.condition !== '7-12℃10%_margin') return false;
      if (serviceFlow != null && r.service_flow < serviceFlow) return false;
      return true;
    }).filter(function (r) {
      return r.material_flow >= materialFlow;
    });

    const byModel = {};
    rows.forEach(function (r) {
      const ratio = (r.material_flow - materialFlow) / r.material_flow;
      const status = ratio >= 0.05 ? 'green' : 'yellow';
      if (!byModel[r.model] || byModel[r.model].statusRank > (status === 'green' ? 0 : 1) || byModel[r.model].flow > r.material_flow) {
        byModel[r.model] = { record: r, status: status, statusRank: status === 'green' ? 0 : 1, flow: r.material_flow };
      }
    });
    const models = Object.keys(byModel).map(function (model) {
      return { model: model, order: tubeModelOrder(model), best: byModel[model] };
    }).sort(function (a, b) {
      return a.order.s - b.order.s || a.order.n - b.order.n;
    });
    if (!models.length) {
      container.innerHTML = '<div class="empty">' + esc(t('noResults')) + '</div>';
      return;
    }
    const html = models.map(function (item) {
      const r = item.best.record;
      const snapshot = (q.tempRange || '') + ' | ' + (q.pressureMode || '100') + ' kPa | ' + (q.materialFlow || '') + ' / ' + (q.serviceFlow || '');
      const icon = item.best.status === 'green'
        ? '<span class="status-chip active">✓</span>'
        : '<span class="status-chip warning">!</span>';
      return '<tr><td>' + esc(r.model) + '</td><td>' + icon + '</td><td>' + esc(r.material_flow) + '</td><td>' + esc(r.service_flow) + '</td><td>' + esc(r.margin) + '%</td><td>' + esc(r.condition) + '</td><td><button class="btn btn-sm" data-add-list-model="' + esc(r.model) + '" data-add-list-snapshot="' + esc(snapshot) + '" data-add-list-raw="' + esc(r.raw || '') + '">' + esc(t('addToList')) + '</button></td></tr>';
    }).join('');
    container.innerHTML = '<table><thead><tr><th>' + esc(t('model')) + '</th><th>' + esc(t('status')) + '</th><th>' + esc(t('hotFlow')) + '</th><th>' + esc(t('coldFlow')) + '</th><th>' + esc(t('margin')) + '</th><th>' + esc(t('condition')) + '</th><th>' + esc(t('actions')) + '</th></tr></thead><tbody>' + html + '</tbody></table>';
    container.querySelectorAll('[data-add-list-model]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showAddToListModal(btn.dataset.addListModel, btn.dataset.addListSnapshot, btn.dataset.addListRaw);
      });
    });
  }

  function showAddToListModal(model, snapshot, raw) {
    const listButtons = App.lists.map(function (list) {
      return '<button class="dropdown-item" data-list="' + esc(list.id) + '">' + esc(list.name) + '</button>';
    }).join('');
    openModal(
      '<div class="modal-header"><h3>' + esc(t('addToList')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<p class="text-muted">' + esc(model) + '</p>' +
      '<div>' + listButtons + '</div>' +
      '<button class="btn mt-2" id="list-create-new">+ ' + esc(t('addList')) + '</button>'
    );
    document.querySelectorAll('[data-list]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const list = App.lists.find(function (l) { return l.id === btn.dataset.list; });
        if (list) {
          list.items.push({ id: uuid(), model: model, conditionSnapshot: snapshot, raw: raw || (model + ' | ' + snapshot) });
          saveLists();
          closeModal();
        }
      });
    });
    document.getElementById('list-create-new').addEventListener('click', function () {
      showGlassPrompt(t('newListName'), function (name) {
        if (!name) return;
        const list = { id: uuid(), name: name, items: [{ id: uuid(), model: model, conditionSnapshot: snapshot, raw: raw || (model + ' | ' + snapshot) }] };
        App.lists.push(list);
        saveLists();
        closeModal();
      });
    });
  }

  function renderTubeSearch(main) {
    main.innerHTML =
      '<section class="page">' +
      '<h1 class="page-title">' + esc(t('basicTitle')) + '</h1>' +
      '<p class="page-subtitle">' + esc(t('searchRedesigning')) + '</p>' +
      '<div class="card"><div class="empty">' + esc(t('searchComingSoon')) + '</div></div>' +
      '</section>';
  }

  function runTubeSearch() {
    const q = App.tubeSearch;
    const inTemp = toNum(q.inputTemp);
    const outTemp = toNum(q.outputTemp);
    const materialFlow = toNum(q.materialFlow);
    const serviceFlow = toNum(q.serviceFlow);
    const minMargin = toNum(q.minMargin) ?? 0;
    const summary = document.getElementById('tube-search-summary');
    const container = document.getElementById('tube-results');
    if (!container) return;
    if (inTemp == null || outTemp == null || materialFlow == null) {
      summary.textContent = t('tubeSearchMissing');
      container.innerHTML = '<div class="empty">' + esc(t('tubeSearchMissing')) + '</div>';
      return;
    }
    let tempCandidates = App.tubeDB.filter(function (r) {
      return r.material_in === inTemp && r.material_out === outTemp;
    });
    if (!tempCandidates.length) {
      tempCandidates = App.tubeDB.filter(function (r) {
        return r.material_in >= inTemp && r.material_out <= outTemp;
      });
    }
    const candidates = tempCandidates.filter(function (r) {
      if (r.material_flow < materialFlow) return false;
      if (serviceFlow != null && r.service_flow < serviceFlow) return false;
      if (q.pressureMode === '50' && r.condition !== '50kpa') return false;
      if (q.pressureMode === '100' && r.condition === '50kpa') return false;
      if (r.margin < minMargin) return false;
      return true;
    });
    const byModel = {};
    candidates.forEach(function (r) {
      const diff = (r.material_flow - materialFlow) + (serviceFlow != null ? (r.service_flow - serviceFlow) : 0);
      if (!byModel[r.model] || byModel[r.model].score > diff) {
        byModel[r.model] = { record: r, score: diff };
      }
    });
    const models = Object.keys(byModel).map(function (model) {
      return { model: model, order: tubeModelOrder(model), best: byModel[model] };
    }).sort(function (a, b) {
      return a.order.s - b.order.s || a.order.n - b.order.n;
    });

    summary.textContent = models.length ? t('tubeResultCount', { n: models.length }) : t('noResults');
    const rows = models.map(function (item) {
      const r = item.best.record;
      const pressure = r.pressure ? r.pressure + ' kPa' : '/';
      const reason = r.margin >= 10 ? t('tubeReasonComfortable') : t('tubeReasonTight');
      return '<tr>' +
        '<td>' + esc(r.model) + '</td>' +
        '<td>' + esc(r.material_flow) + '</td>' +
        '<td>' + esc(r.service_flow) + '</td>' +
        '<td>' + esc(r.margin) + '%</td>' +
        '<td>' + esc(pressure) + '</td>' +
        '<td>' + esc(reason) + '</td>' +
        '</tr>';
    }).join('');
    container.innerHTML = models.length
      ? '<table><thead><tr><th>' + esc(t('model')) + '</th><th>' + esc(t('hotFlow')) + '</th><th>' + esc(t('coldFlow')) + '</th><th>' + esc(t('margin')) + '</th><th>' + esc(t('pressureDrop')) + '</th><th>' + esc(t('recommendReason')) + '</th></tr></thead><tbody>' + rows + '</tbody></table>'
      : '<div class="empty">' + esc(t('noResults')) + '</div>';
  }

  function renderBasic(main) {
    const materials = collectMaterials();
    if (!materials.includes(App.basicState.material)) {
      App.basicState.material = 'Water';
    }
    if (App.basicState.material === 'NA_' && App.basicState.mode === 'temp') {
      App.basicState.mode = 'process';
    }
    const seriesList = collectSeries(App.basicState.material);
    if (App.basicState.series && !seriesList.includes(App.basicState.series)) {
      App.basicState.series = '';
    }

    const materialOptions = materialOptionsHtml(App.basicState.material, false);
    const seriesOptions = ['<option value="">' + esc(t('allSeries')) + '</option>']
      .concat(seriesList.map(function (s) {
        return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
      })).join('');

    const tempHidden = App.basicState.material === 'NA_';

    main.innerHTML =
      '<section class="page">' +
      '<h1 class="page-title">' + esc(t('basicTitle')) + '</h1>' +
      '<p class="page-subtitle">' + esc(t('basicSubtitle')) + '</p>' +
      '<div class="card">' +
      '<div class="form-row">' +
      '<div class="field"><label>' + esc(t('step1')) + '</label><select id="basic-material">' + materialOptions + '</select></div>' +
      '<div class="field"><label>' + esc(t('step2')) + '</label><select id="basic-series">' + seriesOptions + '</select></div>' +
      '</div>' +
      '</div>' +
      '<div class="card">' +
      '<h2>' + esc(t('step3')) + '</h2>' +
      '<div class="search-options">' +
      '<button type="button" class="search-option' + (App.basicState.mode === 'process' ? ' active' : '') + '" id="basic-mode-process">' + esc(t('processSearch')) + '</button>' +
      (tempHidden ? '' : '<button type="button" class="search-option' + (App.basicState.mode === 'temp' ? ' active' : '') + '" id="basic-mode-temp">' + esc(t('tempSearch')) + '</button>') +
      '</div>' +
      '<div id="basic-process-form" class="mt-2' + (App.basicState.mode === 'process' ? '' : ' hidden') + '">' +
      processFormHtml() +
      '</div>' +
      '<div id="basic-temp-form" class="mt-2' + (App.basicState.mode === 'temp' ? '' : ' hidden') + '">' +
      tempFormHtml() +
      '</div>' +
      '</div>' +
      '<div class="card">' +
      '<h2>' + esc(t('searchResults')) + '</h2>' +
      '<div id="basic-result-summary" class="text-muted"></div>' +
      '<div id="basic-results" class="table-wrap"></div>' +
      '</div>' +
      '</section>';

    document.getElementById('basic-material').value = App.basicState.material;
    document.getElementById('basic-series').value = App.basicState.series;
    document.getElementById('basic-material').addEventListener('change', async function (e) {
      const value = e.target.value;
      if (value === '__new__') {
        const name = window.prompt(t('newMaterialPrompt'));
        const added = addMaterialValue(name);
        if (added) {
          await commit();
          App.basicState.material = added;
        }
        renderBasic(document.getElementById('main-content'));
        return;
      }
      App.basicState.material = value;
      if (App.basicState.material === 'NA_' && App.basicState.mode === 'temp') {
        App.basicState.mode = 'process';
      }
      renderBasic(document.getElementById('main-content'));
    });
    document.getElementById('basic-series').addEventListener('change', function (e) {
      App.basicState.series = e.target.value;
      runBasicSearch();
    });

    const processBtn = document.getElementById('basic-mode-process');
    processBtn.addEventListener('click', function () {
      App.basicState.mode = 'process';
      document.getElementById('basic-process-form').classList.remove('hidden');
      const tempForm = document.getElementById('basic-temp-form');
      if (tempForm) tempForm.classList.add('hidden');
      processBtn.classList.add('active');
      const tempBtn = document.getElementById('basic-mode-temp');
      if (tempBtn) tempBtn.classList.remove('active');
      runBasicSearch();
    });
    const tempBtn = document.getElementById('basic-mode-temp');
    if (tempBtn) {
      tempBtn.addEventListener('click', function () {
        App.basicState.mode = 'temp';
        document.getElementById('basic-temp-form').classList.remove('hidden');
        document.getElementById('basic-process-form').classList.add('hidden');
        tempBtn.classList.add('active');
        processBtn.classList.remove('active');
        runBasicSearch();
      });
    }

    bindProcessForm();
    bindTempForm();
    runBasicSearch();
  }

  function processFormHtml() {
    const p = App.basicState.process;
    const hotMass = p.hotFlowUnit === 'mass' ? 'selected' : '';
    const hotVolume = p.hotFlowUnit === 'volume' ? 'selected' : '';
    const coldMass = p.coldFlowUnit === 'mass' ? 'selected' : '';
    const coldVolume = p.coldFlowUnit === 'volume' ? 'selected' : '';
    return '<div class="form-row">' +
      '<div class="field"><label>' + esc(t('hotInputTemp')) + '</label><input id="p-hot-in" type="number" step="any" value="' + esc(p.hotInput) + '"></div>' +
      '<div class="field"><label>' + esc(t('hotOutputTemp')) + '</label><input id="p-hot-out" type="number" step="any" value="' + esc(p.hotOutput) + '"></div>' +
      '<div class="field"><label>' + esc(t('hotFlow')) + '</label><input id="p-hot-flow" type="number" step="any" value="' + esc(p.hotFlow) + '"></div>' +
      '<div class="field"><label>' + esc(t('coldInputTemp')) + '</label><input id="p-cold-in" type="number" step="any" value="' + esc(p.coldInput) + '"></div>' +
      '<div class="field"><label>' + esc(t('coldOutputTemp')) + '</label><input id="p-cold-out" type="number" step="any" value="' + esc(p.coldOutput) + '"></div>' +
      '<div class="field"><label>' + esc(t('coldFlow')) + '</label><input id="p-cold-flow" type="number" step="any" value="' + esc(p.coldFlow) + '"></div>' +
      '<div class="field"><label>' + esc(t('hotFlowUnit')) + '</label><select id="p-hot-flow-unit">' +
      '<option value="mass" ' + hotMass + '>' + esc(t('massFlow')) + '</option>' +
      '<option value="volume" ' + hotVolume + '>' + esc(t('volumeFlow')) + '</option>' +
      '</select></div>' +
      '<div class="field"><label>' + esc(t('coldFlowUnit')) + '</label><select id="p-cold-flow-unit">' +
      '<option value="mass" ' + coldMass + '>' + esc(t('massFlow')) + '</option>' +
      '<option value="volume" ' + coldVolume + '>' + esc(t('volumeFlow')) + '</option>' +
      '</select></div>' +
      '</div>' +
      '<div class="text-muted mt-2">' + esc(t('flowUnitNote')) + '</div>';
  }

  function tempFormHtml() {
    const temp = App.basicState.temp;
    if (!temp.material && App.basicState.material !== 'NA_') {
      temp.material = App.basicState.material;
    }
    const tempMaterials = collectMaterials().filter(function (m) { return m !== 'NA_'; });
    const tempMaterialOptions = ['<option value="">' + esc(t('materialSelection')) + '</option>'].concat(tempMaterials.map(function (m) {
      return '<option value="' + esc(m) + '"' + (temp.material === m ? ' selected' : '') + '>' + esc(m === 'Water' ? t('materialDefault') : m) + '</option>';
    })).join('');
    const hotSelected = temp.side === 'hot' ? 'selected' : '';
    const coldSelected = temp.side === 'cold' ? 'selected' : '';
    const materialLabel = temp.side === 'hot' ? t('hotMaterialSelection') : t('coldMaterialSelection');
    return '<div class="form-row">' +
      '<div class="field"><label>' + esc(t('materialSide')) + '</label><select id="temp-side">' +
      '<option value="hot" ' + hotSelected + '>' + esc(t('hotSide')) + '</option>' +
      '<option value="cold" ' + coldSelected + '>' + esc(t('coldSide')) + '</option>' +
      '</select></div>' +
      '<div class="field"><label id="temp-material-label">' + esc(materialLabel) + '</label><select id="temp-material">' + tempMaterialOptions + '</select></div>' +
      '<div class="field"><label>' + esc(t('inputTemp')) + '</label><input id="temp-input" type="number" step="any" value="' + esc(temp.input) + '"></div>' +
      '<div class="field"><label>' + esc(t('outputTemp')) + '</label><input id="temp-output" type="number" step="any" value="' + esc(temp.output) + '"></div>' +
      '</div>' +
      '<div class="text-muted mt-2">' + esc(t('tempRangeHint')) + '</div>';
  }

  function bindProcessForm() {
    const ids = {
      'p-hot-in': 'hotInput',
      'p-hot-out': 'hotOutput',
      'p-hot-flow': 'hotFlow',
      'p-cold-in': 'coldInput',
      'p-cold-out': 'coldOutput',
      'p-cold-flow': 'coldFlow'
    };
    Object.keys(ids).forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function (e) {
        App.basicState.process[ids[id]] = e.target.value;
        runBasicSearch();
      });
    });
    const hotUnit = document.getElementById('p-hot-flow-unit');
    const coldUnit = document.getElementById('p-cold-flow-unit');
    if (hotUnit) {
      hotUnit.addEventListener('change', function (e) {
        App.basicState.process.hotFlowUnit = e.target.value;
        runBasicSearch();
      });
    }
    if (coldUnit) {
      coldUnit.addEventListener('change', function (e) {
        App.basicState.process.coldFlowUnit = e.target.value;
        runBasicSearch();
      });
    }
  }

  function bindTempForm() {
    const material = document.getElementById('temp-material');
    const side = document.getElementById('temp-side');
    const input = document.getElementById('temp-input');
    const output = document.getElementById('temp-output');
    if (material) {
      material.addEventListener('change', function (e) {
        App.basicState.temp.material = e.target.value;
        runBasicSearch();
      });
    }
    if (side) {
      side.addEventListener('change', function (e) {
        App.basicState.temp.side = e.target.value;
        const label = document.getElementById('temp-material-label');
        if (label) label.textContent = App.basicState.temp.side === 'hot' ? t('hotMaterialSelection') : t('coldMaterialSelection');
        runBasicSearch();
      });
    }
    if (input) {
      input.addEventListener('input', function (e) {
        App.basicState.temp.input = e.target.value;
        runBasicSearch();
      });
    }
    if (output) {
      output.addEventListener('input', function (e) {
        App.basicState.temp.output = e.target.value;
        runBasicSearch();
      });
    }
  }

  function filterProcess(records, p) {
    const hIn = toNum(p.hotInput);
    const hOut = toNum(p.hotOutput);
    const hFlow = toNum(p.hotFlow);
    const cIn = toNum(p.coldInput);
    const cOut = toNum(p.coldOutput);
    const cFlow = toNum(p.coldFlow);
    return records.filter(function (r) {
      if (hIn != null && !closeEnough(toNum(r.hotInputTemp), hIn)) return false;
      if (hOut != null && !closeEnough(toNum(r.hotOutputTemp), hOut)) return false;
      if (cIn != null && !closeEnough(toNum(r.coldInputTemp), cIn)) return false;
      if (cOut != null && !closeEnough(toNum(r.coldOutputTemp), cOut)) return false;
      if (hFlow != null) {
        const hotUnit = r.hotFlowUnit || r.flowUnit || 'mass';
        if (hotUnit !== (p.hotFlowUnit || 'mass')) return false;
        if (!closeEnough(toNum(r.hotFlow), hFlow)) return false;
      }
      if (cFlow != null) {
        const coldUnit = r.coldFlowUnit || r.flowUnit || 'mass';
        if (coldUnit !== (p.coldFlowUnit || 'mass')) return false;
        if (!closeEnough(toNum(r.coldFlow), cFlow)) return false;
      }
      return true;
    });
  }

  function filterTempBoundary(records, temp) {
    const a = toNum(temp.input);
    const b = toNum(temp.output);
    if (a == null && b == null) return records;
    if (a == null || b == null) return [];
    const lower = Math.min(a, b);
    const upper = Math.max(a, b);
    const hot = temp.side !== 'cold';
    return records.filter(function (r) {
      const inVal = hot ? toNum(r.hotInputTemp) : toNum(r.coldInputTemp);
      const outVal = hot ? toNum(r.hotOutputTemp) : toNum(r.coldOutputTemp);
      if (inVal == null || outVal == null) return false;
      return inVal >= lower && inVal <= upper && outVal >= lower && outVal <= upper;
    });
  }

  function runBasicSearch() {
    let records = App.state.dbB.slice();
    const material = App.basicState.material;
    if (App.basicState.mode === 'process') {
      if (material && material !== 'NA_') {
        records = records.filter(function (r) { return r.material === material || r.hotMaterial === material || r.coldMaterial === material; });
      }
      if (App.basicState.series) {
        records = records.filter(function (r) { return r.series === App.basicState.series; });
      }
      records = filterProcess(records, App.basicState.process);
    } else if (App.basicState.mode === 'temp') {
      const tempMaterial = App.basicState.temp.material;
      if (tempMaterial) {
        records = records.filter(function (r) {
          if (App.basicState.temp.side === 'hot') {
            return r.hotMaterial === tempMaterial || (!r.hotMaterial && r.material === tempMaterial);
          }
          return r.coldMaterial === tempMaterial || (!r.coldMaterial && r.material === tempMaterial);
        });
      } else {
        records = [];
      }
      if (App.basicState.series) {
        records = records.filter(function (r) { return r.series === App.basicState.series; });
      }
      records = filterTempBoundary(records, App.basicState.temp);
    }
    App.basicState.results = records;
    renderBasicResults(records);
  }

  function renderBasicResults(records) {
    const summary = document.getElementById('basic-result-summary');
    const container = document.getElementById('basic-results');
    if (!container) return;
    if (summary) {
      summary.textContent = records.length ? t('resultCount', { n: records.length }) : t('noResults');
    }
    if (!records.length) {
      container.innerHTML = '<div class="empty">' + esc(t('noResults')) + '</div>';
      return;
    }
    const rows = records.map(function (r) {
      return '<tr>' +
        '<td>' + esc(r.material || '/') + '</td>' +
        '<td>' + esc(r.series || '/') + '</td>' +
        '<td>' + esc(r.model || '/') + '</td>' +
        '<td>' + esc(r.plateCount || '/') + '</td>' +
        '<td>' + esc(r.plateMaterial || '/') + '</td>' +
        '<td>' + esc(r.plateThickness || '/') + '</td>' +
        '<td>' + esc(r.gasketMaterial || '/') + '</td>' +
        '<td><button class="btn btn-sm" data-action="detail" data-id="' + esc(r.id) + '">' + esc(t('more')) + '</button>' +
        ' <button class="btn btn-sm" data-action="export" data-id="' + esc(r.id) + '">' + esc(t('export')) + '</button></td>' +
        '</tr>';
    }).join('');
    container.innerHTML = '<table><thead><tr>' +
      '<th>' + esc(t('material')) + '</th>' +
      '<th>' + esc(t('series')) + '</th>' +
      '<th>' + esc(t('model')) + '</th>' +
      '<th>' + esc(t('plateCount')) + '</th>' +
      '<th>' + esc(t('plateMaterial')) + '</th>' +
      '<th>' + esc(t('plateThickness')) + '</th>' +
      '<th>' + esc(t('gasketMaterial')) + '</th>' +
      '<th>' + esc(t('actions')) + '</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
    container.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.id;
        const record = App.state.dbB.find(function (r) { return r.id === id; });
        if (!record) return;
        if (btn.dataset.action === 'detail') {
          showRecordDetail(record);
        } else if (btn.dataset.action === 'export') {
          exportRecordXlsx(record);
        }
      });
    });
  }

  function showRecordDetail(record) {
    const items = [
      [t('material'), record.material],
      [t('series'), record.series],
      [t('model'), record.model],
      [t('plateCount'), record.plateCount],
      [t('plateMaterial'), record.plateMaterial],
      [t('plateThickness'), record.plateThickness],
      [t('gasketMaterial'), record.gasketMaterial],
      [t('hotInputTemp'), record.hotInputTemp],
      [t('hotOutputTemp'), record.hotOutputTemp],
      [t('hotFlow'), record.hotFlow],
      [t('coldInputTemp'), record.coldInputTemp],
      [t('coldOutputTemp'), record.coldOutputTemp],
      [t('coldFlow'), record.coldFlow],
      [t('flowUnit'), record.flowUnit === 'volume' ? t('volumeFlow') : record.flowUnit === 'mass' ? t('massFlow') : (record.flowUnit || '/')]
    ];
    const detailHtml = items.map(function (pair) {
      return '<div class="detail-item"><div class="k">' + esc(pair[0]) + '</div><div class="v">' + esc(pair[1] || '/') + '</div></div>';
    }).join('');
    openModal('<div class="modal-header"><h3>' + esc(t('detailTitle')) + '</h3><button class="close-btn" id="modal-close">×</button></div><div class="detail-grid">' + detailHtml + '</div>');
  }

  function openModal(innerHtml) {
    const root = document.getElementById('modal-root');
    root.innerHTML = '<div class="modal-overlay"><div class="modal">' + innerHtml + '</div></div>';
    const close = document.getElementById('modal-close');
    if (close) close.addEventListener('click', closeModal);
    root.querySelector('.modal-overlay').addEventListener('click', function (e) {
      if (e.target === root.querySelector('.modal-overlay')) closeModal();
    });
  }

  function closeModal() {
    document.getElementById('modal-root').innerHTML = '';
  }

  function renderAdvance(main) {
    main.innerHTML =
      '<section class="page">' +
      '<h1 class="page-title">' + esc(t('advanceSearch')) + '</h1>' +
      '<p class="page-subtitle">' + esc(t('advanceSummary')) + '</p>' +
      '<div class="card">' +
      '<div class="form-row">' +
      '<div class="field"><label>' + esc(t('search')) + '</label><input id="advance-query" type="search" placeholder="' + esc(t('searchPlaceholder')) + '" value="' + esc(App.advanceQuery) + '"></div>' +
      '<div class="field"><label>' + esc(t('filterType')) + '</label><select id="advance-type">' +
      '<option value="all"' + (App.advanceType === 'all' ? ' selected' : '') + '>' + esc(t('allFiles')) + '</option>' +
      '<option value="file"' + (App.advanceType === 'file' ? ' selected' : '') + '>' + esc(t('typeFile')) + '</option>' +
      '<option value="folder"' + (App.advanceType === 'folder' ? ' selected' : '') + '>' + esc(t('typeFolder')) + '</option>' +
      '</select></div>' +
      '</div>' +
      '</div>' +
      '<div class="card">' +
      '<h2>' + esc(t('searchResults')) + '</h2>' +
      '<div id="advance-results" class="table-wrap"></div>' +
      '</div>' +
      '</section>';

    document.getElementById('advance-query').addEventListener('input', function (e) {
      App.advanceQuery = e.target.value;
      runAdvanceSearch();
    });
    document.getElementById('advance-type').addEventListener('change', function (e) {
      App.advanceType = e.target.value;
      runAdvanceSearch();
    });
    runAdvanceSearch();
  }

  function runAdvanceSearch() {
    const container = document.getElementById('advance-results');
    if (!container) return;
    const q = App.advanceQuery.trim().toLowerCase();
    const type = App.advanceType;
    const records = App.state.dbA.filter(function (r) {
      if (type !== 'all' && r.type !== type) return false;
      if (!q) return true;
      const haystack = [r.name, r.customName, r.description, r.filePath].join(' ').toLowerCase();
      return haystack.includes(q);
    });
    if (!records.length) {
      container.innerHTML = '<div class="empty">' + esc(t('noResults')) + '</div>';
      return;
    }
    const rows = records.map(function (r) {
      return '<tr>' +
        '<td>' + esc(r.name || '/') + '</td>' +
        '<td><span class="badge">' + esc(r.type === 'folder' ? t('typeFolder') : t('typeFile')) + '</span></td>' +
        '<td>' + esc(r.customName || '/') + '</td>' +
        '<td>' + esc(r.description || '/') + '</td>' +
        '<td>' + esc(r.filePath || '/') + '</td>' +
        '<td><button class="btn btn-sm" data-action="edit" data-id="' + esc(r.id) + '">' + esc(t('edit')) + '</button></td>' +
        '</tr>';
    }).join('');
    container.innerHTML = '<table><thead><tr>' +
      '<th>' + esc(t('name')) + '</th>' +
      '<th>' + esc(t('type')) + '</th>' +
      '<th>' + esc(t('customName')) + '</th>' +
      '<th>' + esc(t('description')) + '</th>' +
      '<th>' + esc(t('filePath')) + '</th>' +
      '<th>' + esc(t('actions')) + '</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
    container.querySelectorAll('button[data-action="edit"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const record = App.state.dbA.find(function (r) { return r.id === btn.dataset.id; });
        if (record) showEditARecord(record);
      });
    });
  }

  function renderEditor(main) {
    if (!App.editorCategory) {
      main.innerHTML =
        '<section class="page">' +
        '<h1 class="page-title">' + esc(t('editorTitle')) + '</h1>' +
        '<p class="page-subtitle">' + esc(t('editorSubtitle')) + '</p>' +
        '<div class="db-menu">' +
        '<button type="button" class="db-choice card" id="editor-cat-S">' +
        '<span class="db-choice-icon">' + iconDatabase() + '</span>' +
        '<span class="db-choice-title">Pharma line S</span>' +
        '</button>' +
        '<button type="button" class="db-choice card" id="editor-cat-DTS">' +
        '<span class="db-choice-icon">' + iconDatabase() + '</span>' +
        '<span class="db-choice-title">Pharma line DTS</span>' +
        '</button>' +
        '<button type="button" class="db-choice card" id="editor-cat-add">' +
        '<span class="db-choice-icon">+</span>' +
        '<span class="db-choice-title">' + esc(t('addSeriesCategory')) + '</span>' +
        '</button>' +
        '</div>' +
        '</section>';
      document.getElementById('editor-cat-S').addEventListener('click', function () {
        App.editorCategory = 'Pharma line S';
        renderEditor(document.getElementById('main-content'));
      });
      document.getElementById('editor-cat-DTS').addEventListener('click', function () {
        App.editorCategory = 'Pharma line DTS';
        renderEditor(document.getElementById('main-content'));
      });
      document.getElementById('editor-cat-add').addEventListener('click', function () {
        const name = window.prompt(t('newSeriesCategory'));
        const cleaned = String(name || '').trim();
        if (!cleaned) return;
        if (!App.state.series.includes(cleaned)) App.state.series.push(cleaned);
        commit();
        App.editorCategory = cleaned;
        renderEditor(document.getElementById('main-content'));
      });
      return;
    }
    renderTubeDatabaseEditor(main, App.editorCategory);
  }

  function renderTubeDatabaseEditor(main, category) {
    const db = category === 'Pharma line S' ? App.tubeDB : App.dtsDB;
    const records = db || [];
    const rows = records.slice(0, 500).map(function (r) {
      return '<tr>' +
        '<td>' + esc(r.model) + '</td>' +
        '<td>' + esc(r.material_in) + '~' + esc(r.material_out) + '℃</td>' +
        '<td>' + esc(r.material_flow) + '</td>' +
        '<td>' + esc(r.service_flow) + '</td>' +
        '<td>' + esc(r.margin) + '%</td>' +
        '<td>' + esc(r.pressure || '/') + '</td>' +
        '<td>' + esc(r.condition) + '</td>' +
        '<td><button class="btn btn-sm" data-action="edit-tube" data-id="' + esc(r.id) + '">' + esc(t('edit')) + '</button></td>' +
        '</tr>';
    }).join('');
    main.innerHTML =
      '<section class="page">' +
      '<h1 class="page-title">' + esc(t('editorTitle')) + '</h1>' +
      '<p class="page-subtitle">' + esc(category) + '</p>' +
      '<div class="card">' +
      '<div class="form-row">' +
      '<div class="field"><button id="tube-db-back" class="btn">' + esc(t('back')) + '</button></div>' +
      '<div class="field"><button id="tube-db-save" class="btn btn-primary">' + esc(t('save')) + '</button></div>' +
      '<div class="field"><button id="tube-db-template" class="btn">' + esc(t('exportTemplate')) + '</button></div>' +
      '<div class="field"><button id="tube-db-add-category" class="btn">' + esc(t('addSeriesCategory')) + '</button></div>' +
      '<div class="field"><button id="tube-db-export-folder" class="btn">' + esc(t('exportToFolder')) + '</button></div>' +
      '</div>' +
      (rows ? '<div class="table-wrap mt-2"><table><thead><tr><th>' + esc(t('model')) + '</th><th>' + esc(t('tempRange')) + '</th><th>' + esc(t('hotFlow')) + '</th><th>' + esc(t('coldFlow')) + '</th><th>' + esc(t('margin')) + '</th><th>' + esc(t('pressureDrop')) + '</th><th>' + esc(t('condition')) + '</th><th>' + esc(t('actions')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">' + esc(t('noData')) + '</div>') +
      '</div>' +
      '</section>';
    main.querySelectorAll('[data-action="edit-tube"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const record = db.find(function (r) { return String(r.id) === String(btn.dataset.id); });
        if (record) showEditTubeRecord(record);
      });
    });
    document.getElementById('tube-db-back').addEventListener('click', function () {
      App.editorCategory = null;
      renderEditor(document.getElementById('main-content'));
    });
    document.getElementById('tube-db-save').addEventListener('click', async function () {
      if (category === 'Pharma line S') await SchemDB.set('tubeDB', App.tubeDB);
      else await SchemDB.set('dtsDB', App.dtsDB);
      window.alert(t('saved'));
    });
    document.getElementById('tube-db-template').addEventListener('click', async function () {
      const rows = records.map(function (r) {
        return { model: r.model, temp_range: r.material_in + '~' + r.material_out + '℃', material_flow: r.material_flow, service_flow: r.service_flow, margin: r.margin, pressure: r.pressure, condition: r.condition };
      });
      await writeWorkbook(rows, category === 'Pharma line S' ? 'Pharma_line_S_Template.xlsx' : 'Pharma_line_DTS_Template.xlsx');
    });
    document.getElementById('tube-db-add-category').addEventListener('click', function () {
      const name = window.prompt(t('newSeriesCategory'));
      const cleaned = String(name || '').trim();
      if (!cleaned) return;
      if (!App.state.series.includes(cleaned)) App.state.series.push(cleaned);
      commit();
      renderPage(App.currentRoute);
    });
    document.getElementById('tube-db-export-folder').addEventListener('click', async function () {
      const rows = records.map(function (r) {
        return { model: r.model, temp_range: r.material_in + '~' + r.material_out + '℃', material_flow: r.material_flow, service_flow: r.service_flow, margin: r.margin, pressure: r.pressure, condition: r.condition };
      });
      await writeWorkbook(rows, category === 'Pharma line S' ? 'Pharma_line_S_Database.xlsx' : 'Pharma_line_DTS_Database.xlsx');
    });
  }

  function showEditTubeRecord(record) {
    openModal(
      '<div class="modal-header"><h3>' + esc(t('editTubeRecord')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<div class="form-row">' +
      '<div class="field"><label>' + esc(t('model')) + '</label><input id="tube-edit-model" value="' + esc(record.model) + '"></div>' +
      '<div class="field"><label>' + esc(t('tempRange')) + '</label><input id="tube-edit-temp" value="' + esc(record.material_in + '~' + record.material_out + '℃') + '"></div>' +
      '<div class="field"><label>' + esc(t('hotFlow')) + '</label><input id="tube-edit-hot" type="number" step="any" value="' + esc(record.material_flow) + '"></div>' +
      '<div class="field"><label>' + esc(t('coldFlow')) + '</label><input id="tube-edit-cold" type="number" step="any" value="' + esc(record.service_flow) + '"></div>' +
      '<div class="field"><label>' + esc(t('margin')) + ' (%)</label><input id="tube-edit-margin" type="number" step="any" value="' + esc(record.margin) + '"></div>' +
      '<div class="field"><label>' + esc(t('pressureDrop')) + '</label><input id="tube-edit-pressure" value="' + esc(record.pressure || '') + '"></div>' +
      '<div class="field"><label>' + esc(t('condition')) + '</label><input id="tube-edit-condition" value="' + esc(record.condition) + '"></div>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn" id="tube-edit-cancel">' + esc(t('cancel')) + '</button><button class="btn btn-primary" id="tube-edit-save">' + esc(t('save')) + '</button></div>'
    );
    document.getElementById('tube-edit-cancel').addEventListener('click', closeModal);
    document.getElementById('tube-edit-save').addEventListener('click', function () {
      const temp = document.getElementById('tube-edit-temp').value.match(/(\d+)\s*~\s*(\d+)/);
      record.model = document.getElementById('tube-edit-model').value;
      if (temp) {
        record.material_in = Number(temp[1]);
        record.material_out = Number(temp[2]);
      }
      record.material_flow = Number(document.getElementById('tube-edit-hot').value);
      record.service_flow = Number(document.getElementById('tube-edit-cold').value);
      record.margin = Number(document.getElementById('tube-edit-margin').value);
      record.pressure = document.getElementById('tube-edit-pressure').value ? Number(document.getElementById('tube-edit-pressure').value) : null;
      record.condition = document.getElementById('tube-edit-condition').value;
      closeModal();
      renderPage(App.currentRoute);
    });
  }

  function renderEditorContent() {
    const container = document.getElementById('editor-content');
    if (!container) return;
    if (App.editorTab === 'B') {
      renderEditorB(container);
    } else {
      renderEditorA(container);
    }
  }

  function renderEditorB(container) {
    const records = App.state.dbB.filter(function (r) {
      const q = App.editorBQuery.trim().toLowerCase();
      if (!q) return true;
      return [r.material, r.hotMaterial, r.coldMaterial, r.series, r.model, r.plateCount, r.plateMaterial, r.plateThickness, r.gasketMaterial, r.hotInputTemp, r.hotOutputTemp, r.hotFlow, r.coldInputTemp, r.coldOutputTemp, r.coldFlow, r.flowUnit].join(' ').toLowerCase().includes(q);
    });
    const rows = records.map(function (r) {
      return '<tr>' +
        '<td>' + esc(r.hotMaterial || r.material || '/') + '</td>' +
        '<td>' + esc(r.coldMaterial || r.material || '/') + '</td>' +
        '<td>' + esc(r.series || '/') + '</td>' +
        '<td>' + esc(r.model || '/') + '</td>' +
        '<td>' + esc(r.plateCount || '/') + '</td>' +
        '<td>' + esc(r.plateMaterial || '/') + '</td>' +
        '<td>' + esc(r.plateThickness || '/') + '</td>' +
        '<td>' + esc(r.gasketMaterial || '/') + '</td>' +
        '<td><button class="btn btn-sm" data-action="more" data-id="' + esc(r.id) + '">' + esc(t('more')) + '</button> ' +
        '<button class="btn btn-sm" data-action="edit" data-id="' + esc(r.id) + '">' + esc(t('edit')) + '</button> ' +
        '<button class="btn btn-sm" data-action="export" data-id="' + esc(r.id) + '">' + esc(t('exportOne')) + '</button> ' +
        '<button class="btn btn-sm btn-danger" data-action="delete" data-id="' + esc(r.id) + '">' + esc(t('delete')) + '</button></td>' +
        '</tr>';
    }).join('');
    container.innerHTML =
      '<div class="form-row">' +
      '<div class="field"><input id="editor-b-search" type="search" placeholder="' + esc(t('searchPlaceholder')) + '" value="' + esc(App.editorBQuery) + '"></div>' +
      '<div class="field add-field">' +
      '<div class="split-add">' +
      '<button id="editor-b-add" class="btn btn-primary split-main">＋ ' + esc(t('add')) + '</button>' +
      '<button id="editor-b-add-menu" class="btn btn-primary split-arrow">⌄</button>' +
      '</div>' +
      '<div id="add-template-menu" class="dropdown-menu hidden"></div>' +
      '</div>' +
      '<div class="field"><button id="editor-b-import" class="btn">' + esc(t('importBBtn')) + '</button><input id="editor-b-file" type="file" accept=".xlsx,.xls" class="hidden"></div>' +
      '<div class="field"><button id="editor-b-export-all" class="btn">' + esc(t('exportAllB')) + '</button></div>' +
      '</div>' +
      '<div class="text-muted mt-2">' + esc(t('importMappingHint')) + '</div>' +
      (records.length ? '<div class="table-wrap mt-2"><table><thead><tr>' +
        '<th>' + esc(t('hotMaterial')) + '</th><th>' + esc(t('coldMaterial')) + '</th><th>' + esc(t('series')) + '</th><th>' + esc(t('model')) + '</th>' +
        '<th>' + esc(t('plateCount')) + '</th><th>' + esc(t('plateMaterial')) + '</th><th>' + esc(t('plateThickness')) + '</th><th>' + esc(t('gasketMaterial')) + '</th>' +
        '<th>' + esc(t('actions')) + '</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty mt-2">' + esc(t('noData')) + '</div>');

    document.getElementById('editor-b-search').addEventListener('input', function (e) {
      App.editorBQuery = e.target.value;
      renderEditorB(container);
    });
    ensureBTemplates();
    document.getElementById('editor-b-add').addEventListener('click', function () {
      const customDefault = App.bTemplates.find(function (t) { return t.isCustomDefault; });
      const template = customDefault || App.bTemplates.find(function (t) { return t.id === 'default'; }) || defaultBTemplate();
      showEditBRecord(null, template);
    });
    document.getElementById('editor-b-add-menu').addEventListener('click', function (e) {
      e.stopPropagation();
      toggleAddTemplateMenu();
    });
    document.getElementById('editor-b-import').addEventListener('click', function () {
      document.getElementById('editor-b-file').click();
    });
    document.getElementById('editor-b-file').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (file) importBExcel(file);
      e.target.value = '';
    });
    document.getElementById('editor-b-export-all').addEventListener('click', function () {
      exportAllB();
    });
    container.querySelectorAll('button[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.id;
        const record = App.state.dbB.find(function (r) { return r.id === id; });
        if (!record) return;
        if (btn.dataset.action === 'more') {
          showBRecordMore(record);
        } else if (btn.dataset.action === 'edit') {
          showEditBRecord(record);
        } else if (btn.dataset.action === 'export') {
          exportRecordXlsx(record);
        } else if (btn.dataset.action === 'delete') {
          confirmDeleteB(record);
        }
      });
    });
  }

  function showBRecordMore(record) {
    const items = [
      [t('hotInputTemp'), record.hotInputTemp],
      [t('hotOutputTemp'), record.hotOutputTemp],
      [t('hotFlow'), record.hotFlow],
      [t('hotFlowUnit'), record.hotFlowUnit || record.flowUnit],
      [t('coldInputTemp'), record.coldInputTemp],
      [t('coldOutputTemp'), record.coldOutputTemp],
      [t('coldFlow'), record.coldFlow],
      [t('coldFlowUnit'), record.coldFlowUnit || record.flowUnit]
    ];
    if (record.customFields) {
      Object.keys(record.customFields).forEach(function (key) {
        items.push([key, record.customFields[key]]);
      });
    }
    const detailHtml = items.map(function (pair) {
      const value = pair[1] == null || pair[1] === '' ? '/' : pair[1];
      return '<div class="detail-item"><div class="k">' + esc(pair[0]) + '</div><div class="v">' + esc(value) + '</div></div>';
    }).join('');
    openModal('<div class="modal-header"><h3>' + esc(t('detailTitle')) + '</h3><button class="close-btn" id="modal-close">×</button></div><div class="detail-grid">' + detailHtml + '</div>');
  }

  function toggleAddTemplateMenu() {
    const menu = document.getElementById('add-template-menu');
    if (!menu) return;
    if (menu.classList.contains('hidden')) {
      renderAddTemplateMenu(menu);
      menu.classList.remove('hidden');
    } else {
      menu.classList.add('hidden');
    }
  }

  function renderAddTemplateMenu(menu) {
    ensureBTemplates();
    const custom = App.bTemplates.filter(function (t) { return t.id !== 'default'; });
    menu.innerHTML =
      '<button class="dropdown-item" data-template="default">' + esc(t('defaultBlankRecord')) + '</button>' +
      '<button class="dropdown-item" data-template="tube">' + esc(t('tubeDefaultBlankRecord')) + '</button>' +
      '<div class="dropdown-section-title">' + esc(t('customBlankRecord')) + '</div>' +
      custom.map(function (tpl) {
        const badge = tpl.isCustomDefault ? ' <span class="badge">' + esc(t('customDefaultBadge')) + '</span>' : '';
        return '<div class="dropdown-row"><button class="dropdown-item" data-template="' + esc(tpl.id) + '">' + esc(tpl.name) + badge + '</button><button class="dropdown-mini" data-edit-template="' + esc(tpl.id) + '">' + esc(t('edit')) + '</button></div>';
      }).join('') +
      '<button class="dropdown-item" id="add-custom-template" title="' + esc(t('addCustomBlankRecordHint')) + '">+ ' + esc(t('addCustomBlankRecord')) + '</button>';

    menu.querySelectorAll('[data-template]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const template = App.bTemplates.find(function (t) { return t.id === btn.dataset.template; });
        if (template) {
          showEditBRecord(null, template);
        }
        menu.classList.add('hidden');
      });
    });
    menu.querySelectorAll('[data-edit-template]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const template = App.bTemplates.find(function (t) { return t.id === btn.dataset.editTemplate; });
        if (template) showTemplateFieldEditor(template);
        menu.classList.add('hidden');
      });
    });
    const addBtn = document.getElementById('add-custom-template');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        const name = window.prompt(t('newTemplatePrompt'));
        const cleaned = String(name || '').trim();
        if (!cleaned) return;
        App.bTemplates.push({
          id: uuid(),
          name: cleaned,
          fields: defaultBTemplate().fields.map(function (f) { return Object.assign({}, f); })
        });
        saveBTemplates();
        renderAddTemplateMenu(menu);
      });
    }
  }

  function renderEditorA(container) {
    const records = App.state.dbA.filter(function (r) {
      const q = App.editorAQuery.trim().toLowerCase();
      if (!q) return true;
      return [r.name, r.customName, r.description, r.filePath, r.type].join(' ').toLowerCase().includes(q);
    });
    const rows = records.map(function (r) {
      return '<tr>' +
        '<td>' + esc(r.name || '/') + '</td>' +
        '<td><span class="badge">' + esc(r.type === 'folder' ? t('typeFolder') : t('typeFile')) + '</span></td>' +
        '<td>' + esc(r.customName || '/') + '</td>' +
        '<td>' + esc(r.description || '/') + '</td>' +
        '<td>' + esc(r.filePath || '/') + '</td>' +
        '<td><button class="btn btn-sm" data-action="edit" data-id="' + esc(r.id) + '">' + esc(t('edit')) + '</button> ' +
        '<button class="btn btn-sm btn-danger" data-action="delete" data-id="' + esc(r.id) + '">' + esc(t('delete')) + '</button></td>' +
        '</tr>';
    }).join('');
    container.innerHTML =
      '<div class="form-row">' +
      '<div class="field"><input id="editor-a-search" type="search" placeholder="' + esc(t('searchPlaceholder')) + '" value="' + esc(App.editorAQuery) + '"></div>' +
      '<div class="field"><button id="editor-a-file" class="btn btn-primary">' + esc(t('chooseFile')) + '</button></div>' +
      '<div class="field"><button id="editor-a-folder" class="btn btn-primary">' + esc(t('chooseFolder')) + '</button></div>' +
      '<div class="field"><button id="editor-a-import" class="btn">' + esc(t('importABtn')) + '</button><input id="editor-a-file-input" type="file" accept=".xlsx,.xls" class="hidden"></div>' +
      '<div class="field"><button id="editor-a-read-excel" class="btn">' + esc(t('readExcel')) + '</button><input id="a-excel-file" type="file" accept=".xlsx,.xls" class="hidden"></div>' +
      '</div>' +
      (records.length ? '<div class="table-wrap mt-2"><table><thead><tr>' +
        '<th>' + esc(t('name')) + '</th><th>' + esc(t('type')) + '</th><th>' + esc(t('customName')) + '</th><th>' + esc(t('description')) + '</th><th>' + esc(t('filePath')) + '</th><th>' + esc(t('actions')) + '</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty mt-2">' + esc(t('noData')) + '</div>') +
      '<div id="a-excel-viewer" class="mt-2"></div>';

    document.getElementById('editor-a-search').addEventListener('input', function (e) {
      App.editorAQuery = e.target.value;
      renderEditorA(container);
    });
    document.getElementById('editor-a-file').addEventListener('click', function () {
      addProjectItem('file');
    });
    document.getElementById('editor-a-folder').addEventListener('click', function () {
      addProjectItem('folder');
    });
    document.getElementById('editor-a-import').addEventListener('click', function () {
      document.getElementById('editor-a-file-input').click();
    });
    document.getElementById('editor-a-file-input').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (file) importAExcel(file);
      e.target.value = '';
    });
    document.getElementById('editor-a-read-excel').addEventListener('click', function () {
      document.getElementById('a-excel-file').click();
    });
    document.getElementById('a-excel-file').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (file) handleAExcelView(file);
      e.target.value = '';
    });
    container.querySelectorAll('button[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.id;
        const record = App.state.dbA.find(function (r) { return r.id === id; });
        if (!record) return;
        if (btn.dataset.action === 'edit') {
          showEditARecord(record);
        } else if (btn.dataset.action === 'delete') {
          confirmDeleteA(record);
        }
      });
    });
  }

  async function handleAExcelView(file) {
    try {
      const rows = await parseExcelFile(file);
      const viewer = document.getElementById('a-excel-viewer');
      if (!viewer) return;
      if (!rows.length) {
        viewer.innerHTML = '<div class="empty">' + esc(t('noResults')) + '</div>';
        return;
      }
      const cards = rows.slice(0, 60).map(function (row) {
        const entries = Object.keys(row).map(function (key) {
          return '<div class="excel-field"><span>' + esc(key) + '</span><strong>' + esc(row[key] == null ? '' : row[key]) + '</strong></div>';
        }).join('');
        return '<div class="excel-card">' + entries + '</div>';
      }).join('');
      viewer.innerHTML = '<div class="excel-grid">' + cards + '</div>';
    } catch (err) {
      window.alert(t('importFail') + ': ' + (err && err.message ? err.message : err));
    }
  }

  async function saveModelStatuses() {
    await SchemDB.set('modelStatuses', App.modelStatuses);
    if (App.sourceFolderHandle) {
      try {
        const handle = await App.sourceFolderHandle.getFileHandle('model_statuses.json', { create: true });
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify({ modelStatuses: App.modelStatuses }, null, 2));
        await writable.close();
      } catch (err) {
        // Ignore folder sync failures.
      }
    }
  }

  function modelStatusLabel(status) {
    if (status === 'soon') return t('modelStatusSoon');
    if (status === 'discontinued') return t('modelStatusDiscontinued');
    return t('modelStatusActive');
  }

  function modelStatusChip(status) {
    if (status === 'soon') return '<span class="status-chip soon">' + esc(t('modelStatusSoon')) + '</span>';
    if (status === 'discontinued') return '<span class="status-chip discontinued">' + esc(t('modelStatusDiscontinued')) + '</span>';
    return '<span class="status-chip active">' + esc(t('modelStatusActive')) + '</span>';
  }

  function renderModelStatus(main) {
    const rows = App.modelStatuses.map(function (item) {
      return '<tr>' +
        '<td>' + esc(item.model || '/') + '</td>' +
        '<td>' + modelStatusChip(item.status) + '</td>' +
        '<td><button class="btn btn-sm" data-action="edit" data-id="' + esc(item.id) + '">' + esc(t('edit')) + '</button> ' +
        '<button class="btn btn-sm btn-danger" data-action="delete" data-id="' + esc(item.id) + '">' + esc(t('delete')) + '</button></td>' +
        '</tr>';
    }).join('');
    main.innerHTML =
      '<section class="page">' +
      '<h1 class="page-title">' + esc(t('modelStatus')) + '</h1>' +
      '<p class="page-subtitle">' + esc(t('modelStatusSubtitle')) + '</p>' +
      '<div class="card">' +
      '<div class="form-row">' +
      '<div class="field"><button id="model-status-add" class="btn btn-primary">' + esc(t('addModelStatus')) + '</button></div>' +
      '<div class="field"><button id="model-status-export" class="btn">' + esc(t('exportModelStatusList')) + '</button></div>' +
      '<div class="field"><button id="model-status-import" class="btn">' + esc(t('importModelStatusExcel')) + '</button><input id="model-status-file" type="file" accept=".xlsx,.xls" class="hidden"></div>' +
      '</div>' +
      (App.modelStatuses.length ? '<div class="table-wrap mt-2"><table><thead><tr><th>' + esc(t('model')) + '</th><th>' + esc(t('status')) + '</th><th>' + esc(t('actions')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty mt-2">' + esc(t('noData')) + '</div>') +
      '</div>' +
      '</section>';

    document.getElementById('model-status-add').addEventListener('click', function () {
      showEditModelStatus(null);
    });
    document.getElementById('model-status-export').addEventListener('click', async function () {
      const rows = App.modelStatuses.map(function (item) {
        return { [t('model')]: item.model, [t('status')]: modelStatusLabel(item.status) };
      });
      await writeWorkbook(rows, 'Model_Status_List.xlsx');
    });
    document.getElementById('model-status-import').addEventListener('click', function () {
      document.getElementById('model-status-file').click();
    });
    document.getElementById('model-status-file').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (file) importModelStatusExcel(file);
      e.target.value = '';
    });
    main.querySelectorAll('button[data-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const item = App.modelStatuses.find(function (x) { return x.id === btn.dataset.id; });
        if (!item) return;
        if (btn.dataset.action === 'edit') showEditModelStatus(item);
        else if (btn.dataset.action === 'delete') {
          App.modelStatuses = App.modelStatuses.filter(function (x) { return x.id !== item.id; });
          saveModelStatuses();
          renderPage(App.currentRoute);
        }
      });
    });
  }

  function showEditModelStatus(record) {
    const isNew = !record;
    const r = record || { id: uuid(), model: '', status: 'active' };
    openModal(
      '<div class="modal-header"><h3>' + esc(isNew ? t('addModelStatus') : t('editModelStatus')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<div class="form-row">' +
      '<div class="field"><label>' + esc(t('model')) + '</label><input id="ms-model" value="' + esc(r.model) + '"></div>' +
      '<div class="field"><label>' + esc(t('status')) + '</label><select id="ms-status">' +
      '<option value="active"' + (r.status === 'active' ? ' selected' : '') + '>' + esc(t('modelStatusActive')) + '</option>' +
      '<option value="soon"' + (r.status === 'soon' ? ' selected' : '') + '>' + esc(t('modelStatusSoon')) + '</option>' +
      '<option value="discontinued"' + (r.status === 'discontinued' ? ' selected' : '') + '>' + esc(t('modelStatusDiscontinued')) + '</option>' +
      '</select></div>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn" id="ms-cancel">' + esc(t('cancel')) + '</button><button class="btn btn-primary" id="ms-save">' + esc(t('save')) + '</button></div>'
    );
    document.getElementById('ms-cancel').addEventListener('click', closeModal);
    document.getElementById('ms-save').addEventListener('click', async function () {
      const next = {
        id: r.id,
        model: document.getElementById('ms-model').value.trim(),
        status: document.getElementById('ms-status').value
      };
      const idx = App.modelStatuses.findIndex(function (x) { return x.id === r.id; });
      if (idx >= 0) App.modelStatuses[idx] = next;
      else App.modelStatuses.unshift(next);
      await saveModelStatuses();
      closeModal();
      renderPage(App.currentRoute);
    });
  }

  async function importModelStatusExcel(file) {
    try {
      const rows = await parseExcelFile(file);
      let count = 0;
      rows.forEach(function (row) {
        const model = String(getFirst(row, ['model', '换热器型号', '型号', 'Model']) || '').trim();
        const rawStatus = String(getFirst(row, ['status', '状态', 'Status']) || '').trim().toLowerCase();
        if (!model) return;
        let status = 'active';
        if (/即将停产|即将|soon/i.test(rawStatus)) status = 'soon';
        if (/停产|discontinued/i.test(rawStatus)) status = 'discontinued';
        App.modelStatuses.unshift({ id: uuid(), model: model, status: status });
        count++;
      });
      await saveModelStatuses();
      renderPage(App.currentRoute);
      window.alert(t('importSuccess') + ': ' + count);
    } catch (err) {
      window.alert(t('importFail') + ': ' + (err && err.message ? err.message : err));
    }
  }

  function showGlassPrompt(title, callback) {
    openModal(
      '<div class="modal-header"><h3>' + esc(title) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<input id="glass-prompt-input" type="text">' +
      '<div class="modal-actions"><button class="btn" id="prompt-cancel">' + esc(t('cancel')) + '</button><button class="btn btn-primary" id="prompt-ok">' + esc(t('confirm')) + '</button></div>'
    );
    document.getElementById('prompt-cancel').addEventListener('click', closeModal);
    document.getElementById('prompt-ok').addEventListener('click', function () {
      const value = document.getElementById('glass-prompt-input').value.trim();
      closeModal();
      callback(value);
    });
  }

  async function saveLists() {
    await SchemDB.set('lists', App.lists);
  }

  async function writeWorkbookToHandle(rows, filename, handle) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SCHEM');
    const writable = await handle.createWritable();
    const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    await writable.write(data);
    await writable.close();
  }

  function showExportLocationModal(rows, filename) {
    openModal(
      '<div class="modal-header"><h3>' + esc(t('chooseExportLocation')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<p class="text-muted">' + esc(filename) + '</p>' +
      '<div class="modal-actions">' +
      '<button class="btn" id="export-target-folder">' + esc(t('exportToFolder')) + '</button>' +
      '<button class="btn" id="export-choose-folder">' + esc(t('chooseFolder')) + '</button>' +
      '<button class="btn" id="export-download">' + esc(t('download')) + '</button>' +
      '</div>'
    );
    const modal = document.querySelector('#modal-root .modal');
    if (modal) modal.classList.add('modal-small');
    document.getElementById('export-target-folder').addEventListener('click', async function () {
      if (!App.exportFolderHandle) {
        await chooseOutputFolder();
      }
      if (App.exportFolderHandle) {
        await writeWorkbook(rows, filename);
      }
      closeModal();
    });
    document.getElementById('export-choose-folder').addEventListener('click', async function () {
      try {
        if (!window.showDirectoryPicker) {
          downloadWorkbookBlob(rows, filename);
          closeModal();
          return;
        }
        const folderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const fileHandle = await folderHandle.getFileHandle(filename, { create: true });
        await writeWorkbookToHandle(rows, filename, fileHandle);
        closeModal();
      } catch (err) {
        if (err && err.name === 'AbortError') closeModal();
      }
    });
    document.getElementById('export-download').addEventListener('click', function () {
      downloadWorkbookBlob(rows, filename);
      closeModal();
    });
  }

  function downloadWorkbookBlob(rows, filename) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SCHEM');
    XLSX.writeFile(wb, filename);
  }

  function renderLists(main) {
    if (!App.selectedListId) {
      main.innerHTML =
        '<section class="page">' +
        '<h1 class="page-title">' + esc(t('lists')) + '</h1>' +
        '<p class="page-subtitle">' + esc(t('listsSubtitle')) + '</p>' +
        '<div class="db-menu">' +
        App.lists.map(function (list) {
          return '<div class="list-tile"><button class="db-choice card" data-list-id="' + esc(list.id) + '"><span class="db-choice-icon">' + iconDatabase() + '</span><span class="db-choice-title">' + esc(list.name) + '</span><button type="button" class="list-dot" data-list-menu="' + esc(list.id) + '">•••</button></button></div>';
        }).join('') +
        '<button class="db-choice card" id="list-add"><span class="db-choice-icon">+</span><span class="db-choice-title">' + esc(t('addList')) + '</span></button>' +
        '</div>' +
        '</section>';
      main.querySelectorAll('[data-list-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          App.selectedListId = btn.dataset.listId;
          renderLists(document.getElementById('main-content'));
        });
      });
      main.querySelectorAll('[data-list-menu]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          showListMenu(btn.dataset.listMenu);
        });
      });
      document.getElementById('list-add').addEventListener('click', function () {
        showGlassPrompt(t('newListName'), function (name) {
          if (!name) return;
          App.lists.push({ id: uuid(), name: name, items: [] });
          saveLists();
          renderLists(document.getElementById('main-content'));
        });
      });
      return;
    }
    const list = App.lists.find(function (l) { return l.id === App.selectedListId; });
    if (!list) {
      App.selectedListId = null;
      renderLists(main);
      return;
    }
    const rows = list.items.map(function (item) {
      return '<tr>' +
        '<td><input type="checkbox" class="list-item-check" data-item-id="' + esc(item.id) + '"></td>' +
        '<td>' + esc(item.model) + '</td>' +
        '<td>' + esc(item.conditionSnapshot || '') + '</td>' +
        '<td><button class="btn btn-sm" data-detail="' + esc(item.id) + '">' + esc(t('detailTitle')) + '</button> <button class="btn btn-sm btn-danger" data-delete-item="' + esc(item.id) + '">' + esc(t('delete')) + '</button></td>' +
        '</tr>';
    }).join('');
    main.innerHTML =
      '<section class="page">' +
      '<h1 class="page-title">' + esc(list.name) + '</h1>' +
      '<div class="card">' +
      '<div class="form-row">' +
      '<div class="field"><button id="list-back" class="btn">' + esc(t('back')) + '</button></div>' +
      '<div class="field"><button id="list-rename" class="btn">' + esc(t('rename')) + '</button></div>' +
      '<div class="field"><button id="list-delete" class="btn btn-danger">' + esc(t('delete')) + '</button></div>' +
      '<div class="field"><button id="list-select-all" class="btn">' + esc(t('selectAll')) + '</button></div>' +
      '<div class="field"><button id="list-export-selected" class="btn btn-primary">' + esc(t('exportSelected')) + '</button></div>' +
      '</div>' +
      (list.items.length ? '<div class="table-wrap mt-2"><table><thead><tr><th>✓</th><th>' + esc(t('model')) + '</th><th>' + esc(t('condition')) + '</th><th>' + esc(t('actions')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="empty">' + esc(t('noData')) + '</div>') +
      '</div>' +
      '</section>';
    document.getElementById('list-back').addEventListener('click', function () {
      App.selectedListId = null;
      renderLists(main);
    });
    document.getElementById('list-rename').addEventListener('click', function () {
      showGlassPrompt(t('newListName'), function (name) {
        if (!name) return;
        list.name = name;
        saveLists();
        renderLists(main);
      });
    });
    document.getElementById('list-delete').addEventListener('click', function () {
      App.lists = App.lists.filter(function (l) { return l.id !== list.id; });
      App.selectedListId = null;
      saveLists();
      renderLists(main);
    });
    document.getElementById('list-select-all').addEventListener('click', function () {
      document.querySelectorAll('.list-item-check').forEach(function (box) { box.checked = true; });
    });
    document.getElementById('list-export-selected').addEventListener('click', function () {
      const ids = Array.from(document.querySelectorAll('.list-item-check:checked')).map(function (box) { return box.dataset.itemId; });
      const items = list.items.filter(function (item) { return ids.includes(item.id); });
      if (!items.length) return;
      const rows = items.map(function (item) {
        return { [t('model')]: item.model, [t('condition')]: item.conditionSnapshot };
      });
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      showExportLocationModal(rows, list.name + '_' + stamp + '.xlsx');
    });
    main.querySelectorAll('[data-detail]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const item = list.items.find(function (x) { return x.id === btn.dataset.detail; });
        if (item) openModal('<div class="modal-header"><h3>' + esc(t('detailTitle')) + '</h3><button class="close-btn" id="modal-close">×</button></div><p class="text-muted">' + esc(item.model) + '</p><p>' + esc(item.raw || item.conditionSnapshot || '') + '</p>');
      });
    });
    main.querySelectorAll('[data-delete-item]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        list.items = list.items.filter(function (x) { return x.id !== btn.dataset.deleteItem; });
        saveLists();
        renderLists(main);
      });
    });
  }

  function showListMenu(listId) {
    const list = App.lists.find(function (l) { return l.id === listId; });
    if (!list) return;
    openModal(
      '<div class="modal-header"><h3>' + esc(list.name) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<div class="modal-actions">' +
      '<button class="btn" id="list-rename">' + esc(t('rename')) + '</button>' +
      '<button class="btn btn-danger" id="list-delete">' + esc(t('delete')) + '</button>' +
      '</div>'
    );
    document.getElementById('list-rename').addEventListener('click', function () {
      showGlassPrompt(t('newListName'), function (name) {
        if (!name) return;
        list.name = name;
        saveLists();
        closeModal();
        renderLists(document.getElementById('main-content'));
      });
    });
    document.getElementById('list-delete').addEventListener('click', function () {
      App.lists = App.lists.filter(function (l) { return l.id !== listId; });
      saveLists();
      closeModal();
      renderLists(document.getElementById('main-content'));
    });
  }

  function renderPageSettings(main) {
    const zhActive = getLang() === 'zh' ? ' active' : '';
    const enActive = getLang() === 'en' ? ' active' : '';
    const lightActive = getThemeMode() === 'light' ? ' active' : '';
    const darkActive = getThemeMode() === 'dark' ? ' active' : '';
    const removableChecked = localStorage.getItem('scheme-removable-disk') === '1' ? ' checked' : '';
    main.innerHTML =
      '<section class="page">' +
      '<h1 class="page-title">' + esc(t('pageSettingsTitle')) + '</h1>' +
      '<p class="page-subtitle">' + esc(t('pageSettingsSubtitle')) + '</p>' +
      '<div class="grid grid-2">' +
      '<div class="card">' +
      '<h3>' + esc(t('themeMode')) + '</h3>' +
      '<div class="search-options">' +
      '<button class="search-option' + lightActive + '" id="theme-light">' + esc(t('lightMode')) + '</button>' +
      '<button class="search-option' + darkActive + '" id="theme-dark">' + esc(t('darkMode')) + '</button>' +
      '</div></div>' +
      '<div class="card">' +
      '<h3>' + esc(t('languageSetting')) + '</h3>' +
      '<div class="search-options">' +
      '<button class="search-option' + zhActive + '" id="lang-zh">' + esc(t('chinese')) + '</button>' +
      '<button class="search-option' + enActive + '" id="lang-en">' + esc(t('english')) + '</button>' +
      '</div></div>' +
      '<div class="card">' +
      '<h3>' + esc(t('backgroundImage')) + '</h3>' +
      '<div class="form-row">' +
      '<div class="field"><button id="bg-upload" class="btn">' + esc(t('uploadBackground')) + '</button><input id="bg-file" type="file" class="hidden" accept="image/*,.heic,.heif"></div>' +
      '<div class="field"><button id="bg-remove" class="btn">' + esc(t('removeBackground')) + '</button></div>' +
      '<div class="field"><button id="bg-recommend" class="btn">' + esc(t('recommendedBackgrounds')) + '</button></div>' +
      '</div></div>' +
      '<div class="card">' +
      '<h3>' + esc(t('dataSourceSetting')) + '</h3>' +
      '<div class="data-source-row"><span class="status-chip ' + (removableChecked ? 'warning' : 'info') + '">!</span><span>' + esc(removableChecked ? t('removableDisk') : t('localStorage')) + '</span></div>' +
      '<button id="detect-removable" class="btn">' + esc(t('autoDetectRemovable')) + '</button>' +
      '<label class="field"><input id="removable-disk" type="checkbox"' + removableChecked + '> ' + esc(t('removableDiskManual')) + '</label>' +
      '</div>' +
      '<div class="card">' +
      '<h3>' + esc(t('workbenchData')) + '</h3>' +
      '<div class="form-row">' +
      '<div class="field"><button id="zip-workbench" class="btn">' + esc(t('exportZip')) + '</button></div>' +
      '<div class="field"><button id="reset-workbench" class="btn btn-danger">' + esc(t('resetWorkbench')) + '</button></div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</section>';
    document.getElementById('lang-zh').addEventListener('click', function () {
      setLang('zh');
      applyLanguage();
    });
    document.getElementById('lang-en').addEventListener('click', function () {
      setLang('en');
      applyLanguage();
    });
    document.getElementById('theme-light').addEventListener('click', function () {
      setThemeMode('light', true);
    });
    document.getElementById('theme-dark').addEventListener('click', function () {
      setThemeMode('dark', true);
    });
    document.getElementById('bg-upload').addEventListener('click', function () {
      document.getElementById('bg-file').click();
    });
    document.getElementById('bg-file').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (file) handleBackgroundFile(file);
      e.target.value = '';
    });
    document.getElementById('bg-remove').addEventListener('click', function () {
      removeBackgroundImage();
    });
    document.getElementById('bg-recommend').addEventListener('click', function () {
      showRecommendedBackgrounds();
    });
    document.getElementById('removable-disk').addEventListener('change', function (e) {
      localStorage.setItem('scheme-removable-disk', e.target.checked ? '1' : '0');
      updateStorageStatus({ source: App.storageSource });
    });
    document.getElementById('detect-removable').addEventListener('click', function () {
      detectRemovableStorage();
    });
    document.getElementById('zip-workbench').addEventListener('click', function () {
      exportWorkbenchZip();
    });
    document.getElementById('reset-workbench').addEventListener('click', function () {
      resetWorkbench();
    });
  }

  function detectRemovableStorage() {
    const name = App.outputFolderHandle && App.outputFolderHandle.name ? App.outputFolderHandle.name.toLowerCase() : '';
    const removable = /usb|sd|removable|移动|可移动/.test(name);
    localStorage.setItem('scheme-removable-disk', removable ? '1' : '0');
    updateStorageStatus({ source: App.storageSource });
    renderPage(App.currentRoute);
  }

  async function exportWorkbenchZip() {
    try {
      const zip = new JSZip();
      zip.file('SCHEM_B.json', JSON.stringify({ dbB: App.state.dbB }, null, 2));
      zip.file('SCHEM_A.json', JSON.stringify({ dbA: App.state.dbA }, null, 2));
      zip.file('materials.json', JSON.stringify({ materials: App.state.materials || [] }, null, 2));
      zip.file('series.json', JSON.stringify({ series: App.state.series || [] }, null, 2));
      if (App.sourceFolderHandle) {
        for await (const entry of App.sourceFolderHandle.entries()) {
          if (entry[1].kind === 'file') {
            const file = await entry[1].getFile();
            zip.file('SCHEM_A_Source/' + entry[0], await file.arrayBuffer());
          }
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      if (App.exportFolderHandle) {
        const fileHandle = await App.exportFolderHandle.getFileHandle('Workbench_Backup.zip', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        downloadBlob(blob, 'Workbench_Backup.zip');
      }
    } catch (err) {
      window.alert(err && err.message ? err.message : err);
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function resetWorkbench() {
    openModal(
      '<div class="modal-header"><h3>' + esc(t('resetWorkbench')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<p>' + esc(t('zipPrompt')) + '</p>' +
      '<div class="modal-actions"><button class="btn" id="reset-cancel">' + esc(t('cancel')) + '</button><button class="btn btn-primary" id="reset-next">' + esc(t('next')) + '</button></div>'
    );
    document.getElementById('reset-cancel').addEventListener('click', closeModal);
    document.getElementById('reset-next').addEventListener('click', function () {
      closeModal();
      resetWorkbenchStep2();
    });
  }

  function resetWorkbenchStep2() {
    openModal(
      '<div class="modal-header"><h3>' + esc(t('resetWorkbench')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<p>' + esc(t('confirmResetPrompt')) + '</p>' +
      '<input id="reset-confirm-input" type="text" placeholder="confirm">' +
      '<div class="modal-actions"><button class="btn" id="reset-cancel2">' + esc(t('cancel')) + '</button><button class="btn btn-primary" id="reset-next2">' + esc(t('next')) + '</button></div>'
    );
    document.getElementById('reset-cancel2').addEventListener('click', closeModal);
    document.getElementById('reset-next2').addEventListener('click', function () {
      const value = document.getElementById('reset-confirm-input').value.trim();
      if (value !== 'confirm') {
        window.alert(t('confirmValueError'));
        return;
      }
      closeModal();
      resetWorkbenchStep3();
    });
  }

  function resetWorkbenchStep3() {
    openModal(
      '<div class="modal-header"><h3>' + esc(t('resetWorkbench')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<p>' + esc(t('confirmResetButton')) + '</p>' +
      '<div class="modal-actions"><button class="btn" id="reset-cancel3">' + esc(t('cancel')) + '</button><button class="btn btn-danger" id="reset-confirm3">' + esc(t('confirm')) + '</button></div>'
    );
    document.getElementById('reset-cancel3').addEventListener('click', closeModal);
    document.getElementById('reset-confirm3').addEventListener('click', async function () {
      closeModal();
      await performResetWorkbench();
    });
  }

  async function performResetWorkbench() {
    try {
      await SchemDB.delete('appState');
      await SchemDB.delete('dataFileHandle');
      await SchemDB.delete('bTemplates');
      await SchemDB.delete('outputFolderHandle');
      await SchemDB.delete('sourceFolderHandle');
      await SchemDB.delete('exportFolderHandle');
      await SchemDB.delete('bgImage');
      if (App.sourceFolderHandle) {
        try {
          await App.sourceFolderHandle.removeEntry('SCHEM_A_Source', { recursive: true });
        } catch (err) {
          // Ignore if the source folder cannot be removed.
        }
      }
      if (App.exportFolderHandle) {
        try {
          await App.exportFolderHandle.removeEntry('Output', { recursive: true });
        } catch (err) {
          // Ignore if the export folder cannot be removed.
        }
      }
      localStorage.clear();
      window.alert(t('resetDone'));
      window.location.reload();
    } catch (err) {
      window.alert(err && err.message ? err.message : err);
    }
  }

  function renderFeedback(main) {
    main.innerHTML =
      '<section class="page">' +
      '<h1 class="page-title">' + esc(t('feedbackTitle')) + '</h1>' +
      '<p class="page-subtitle">' + esc(t('feedbackSubtitle')) + '</p>' +
      '<div class="card"><p>' + esc(t('contactDeveloper')) + ':</p><p><a href="mailto:helium0223hzh@outlook.com">helium0223hzh@outlook.com</a></p></div>' +
      '<div class="card"><h3>' + esc(t('moreContacts')) + '</h3>' +
      '<div class="contact-list">' +
      '<a class="contact-item" href="https://message.bilibili.com/?spm_id_from=333.1387.0.0#/whisper/mid491424227" target="_blank" rel="noopener">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="12" rx="3"/><path d="M8 6V4M16 6V4M8 3h8"/><path d="m9 9 3 3 3-3"/></svg>' +
      '<span>Bilibili</span>' +
      '</a>' +
      '</div></div>' +
      '</section>';
  }

  function applyLanguage() {
    document.documentElement.lang = getLang() === 'zh' ? 'zh' : 'en';
    document.getElementById('lang-toggle').textContent = getLang() === 'zh' ? 'EN' : '中文';
    updateNavLabels();
    renderPage(App.currentRoute);
    updateStorageStatus({ source: App.storageSource });
  }

  function updateNavLabels() {
    const mapping = {
      overview: 'overview',
      tubeSearch: 'tubeSearchNav',
      lists: 'lists',
      basic: 'basicSearch',
      advance: 'advanceSearch',
      editor: 'databaseEditor',
      modelStatus: 'modelStatus',
      pageSettings: 'pageSettings',
      feedback: 'feedback'
    };
    Object.keys(mapping).forEach(function (id) {
      const label = document.querySelector('#nav-' + id + ' .nav-label');
      if (label) label.textContent = t(mapping[id]);
    });
  }

  function fieldInputHtml(field, value, idx) {
    const id = 'f-b-field-' + idx;
    const val = value == null ? '' : value;
    if (field.type === 'material') {
      return '<div class="field"><label>' + esc(field.label) + '</label><select id="' + id + '">' + materialOptionsHtmlWithBlank(val, true) + '</select></div>';
    }
    if (field.type === 'flowUnit') {
      const mass = val === 'mass' || !val ? ' selected' : '';
      const volume = val === 'volume' ? ' selected' : '';
      return '<div class="field"><label>' + esc(field.label) + '</label><select id="' + id + '"><option value="mass"' + mass + '>' + esc(t('massFlow')) + '</option><option value="volume"' + volume + '>' + esc(t('volumeFlow')) + '</option></select></div>';
    }
    const inputType = field.type === 'number' ? 'number' : 'text';
    return '<div class="field"><label>' + esc(field.label) + '</label><input id="' + id + '" type="' + inputType + '"' + (inputType === 'number' ? ' step="any"' : '') + ' value="' + esc(val) + '"></div>';
  }

  function showEditBRecord(record, template) {
    ensureBTemplates();
    const isNew = !record;
    const effectiveTemplate = template || defaultBTemplate();
    const base = record || {
      id: uuid(),
      material: '',
      hotMaterial: '',
      coldMaterial: '',
      series: '',
      model: '',
      plateCount: '',
      plateMaterial: '',
      plateThickness: '',
      gasketMaterial: '',
      hotInputTemp: '',
      hotOutputTemp: '',
      hotFlow: '',
      hotFlowUnit: 'mass',
      coldInputTemp: '',
      coldOutputTemp: '',
      coldFlow: '',
      coldFlowUnit: 'mass',
      customFields: {}
    };
    const fields = effectiveTemplate.fields.slice();
    if (record && record.customFields) {
      Object.keys(record.customFields).forEach(function (key) {
        if (!fields.some(function (f) { return f.key === key; })) {
          fields.push({ key: key, label: key, type: 'text' });
        }
      });
    }
    const fieldParts = [];
    for (let idx = 0; idx < fields.length; idx++) {
      const field = fields[idx];
      const value = field.key in base ? base[field.key] : (base.customFields && base.customFields[field.key]);
      if (field.key === 'coldMaterial' && idx > 0 && fields[idx - 1].key === 'hotMaterial') {
        const hotHtml = fieldParts.pop();
        fieldParts.push('<div class="field-pair">' + hotHtml + fieldInputHtml(field, value, idx) + '</div>');
      } else {
        fieldParts.push(fieldInputHtml(field, value, idx));
      }
    }
    const fieldsHtml = fieldParts.join('');
    const templateName = effectiveTemplate.id === 'default' ? '' : '<span class="badge">' + esc(effectiveTemplate.name) + '</span>';
    openModal(
      '<div class="modal-header"><h3>' + esc(isNew ? t('addBRecord') : t('editBRecord')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      (templateName ? '<div class="mt-2">' + templateName + '</div>' : '') +
      '<div class="form-row">' + fieldsHtml + '</div>' +
      '<div class="modal-actions"><button class="btn" id="f-b-cancel">' + esc(t('cancel')) + '</button><button class="btn btn-primary" id="f-b-save">' + esc(t('save')) + '</button></div>'
    );

    fields.forEach(function (field, idx) {
      if (field.type !== 'material') return;
      const select = document.getElementById('f-b-field-' + idx);
      if (!select) return;
      select.addEventListener('change', async function () {
        if (select.value !== '__new__') return;
        const name = window.prompt(t('newMaterialPrompt'));
        const added = addMaterialValue(name);
        if (added) await commit();
        const current = added || base[field.key] || '';
        select.innerHTML = materialOptionsHtmlWithBlank(current, true);
        select.value = current;
      });
    });

    document.getElementById('f-b-cancel').addEventListener('click', closeModal);
    document.getElementById('f-b-save').addEventListener('click', async function () {
      const next = {
        id: base.id,
        material: '',
        customFields: Object.assign({}, base.customFields || {})
      };
      fields.forEach(function (field, idx) {
        const input = document.getElementById('f-b-field-' + idx);
        const value = input ? input.value : '';
        if (['material', 'series', 'model', 'plateCount', 'plateMaterial', 'plateThickness', 'gasketMaterial', 'hotInputTemp', 'hotOutputTemp', 'hotFlow', 'hotFlowUnit', 'coldInputTemp', 'coldOutputTemp', 'coldFlow', 'coldFlowUnit'].includes(field.key)) {
          next[field.key] = value;
        } else {
          next.customFields[field.key] = value;
        }
      });
      next.hotMaterial = next.hotMaterial || '';
      next.coldMaterial = next.coldMaterial || '';
      next.material = next.hotMaterial || next.coldMaterial || '';
      next.flowUnit = next.hotFlowUnit || next.coldFlowUnit || 'mass';
      const index = App.state.dbB.findIndex(function (x) { return x.id === base.id; });
      if (index >= 0) {
        App.state.dbB[index] = Object.assign({}, App.state.dbB[index], next);
        addRecent('edit', next.model || next.id, 'B', next.id);
      } else {
        next.createdAt = nowIso();
        App.state.dbB.unshift(next);
        addRecent('add', next.model || next.id, 'B', next.id);
      }
      closeModal();
      await commit();
      renderPage(App.currentRoute);
    });
  }

  function showTemplateFieldEditor(template) {
    const fields = template.fields.slice();
    function renderRows() {
      const listEl = document.getElementById('template-fields-list');
      if (!listEl) return;
      listEl.innerHTML = fields.map(function (field, idx) {
        return '<div class="list-row"><input class="list-input" data-field-idx="' + idx + '" value="' + esc(field.label) + '"><button class="btn btn-sm btn-danger" data-del-field="' + idx + '">' + esc(t('delete')) + '</button></div>';
      }).join('');
      listEl.querySelectorAll('.list-input').forEach(function (input) {
        input.addEventListener('input', function () {
          fields[Number(input.dataset.fieldIdx)].label = input.value;
        });
      });
      listEl.querySelectorAll('[data-del-field]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          fields.splice(Number(btn.dataset.delField), 1);
          renderRows();
        });
      });
    }
    openModal(
      '<div class="modal-header"><h3>' + esc(t('templateFieldsTitle')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<div class="field"><label>' + esc(t('templateName')) + '</label><input id="template-name" value="' + esc(template.name) + '"></div>' +
      '<label class="field"><span><input id="tpl-custom-default" type="checkbox"' + (template.isCustomDefault ? ' checked' : '') + '> ' + esc(t('setAsCustomDefault')) + '</span></label>' +
      '<div id="template-fields-list"></div>' +
      '<div class="list-add"><input id="new-field-name" placeholder="' + esc(t('newFieldName')) + '"><button class="btn" id="add-field-btn">' + esc(t('add')) + '</button></div>' +
      '<div class="modal-actions"><button class="btn" id="tpl-cancel">' + esc(t('cancel')) + '</button><button class="btn btn-primary" id="tpl-save">' + esc(t('save')) + '</button></div>'
    );
    renderRows();
    document.getElementById('add-field-btn').addEventListener('click', function () {
      const input = document.getElementById('new-field-name');
      const label = String(input.value || '').trim();
      if (!label) return;
      fields.push({ key: 'custom_' + uuid(), label: label, type: 'text' });
      input.value = '';
      renderRows();
    });
    document.getElementById('tpl-cancel').addEventListener('click', closeModal);
    document.getElementById('tpl-save').addEventListener('click', async function () {
      template.name = document.getElementById('template-name').value.trim() || template.name;
      template.fields = fields;
      const setDefault = document.getElementById('tpl-custom-default').checked;
      if (setDefault) {
        App.bTemplates.forEach(function (t) { t.isCustomDefault = false; });
        template.isCustomDefault = true;
      } else {
        template.isCustomDefault = false;
      }
      await saveBTemplates();
      closeModal();
      renderPage(App.currentRoute);
    });
  }

  function showEditARecord(record, preset) {
    const isNew = !record;
    const r = Object.assign(
      {
        id: uuid(),
        name: '',
        type: 'file',
        customName: '',
        description: '',
        filePath: ''
      },
      record || preset || {}
    );
    openModal(
      '<div class="modal-header"><h3>' + esc(isNew ? t('addARecord') : t('editARecord')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<div class="form-row">' +
      '<div class="field"><label>' + esc(t('name')) + '</label><input id="f-a-name" value="' + esc(r.name) + '"></div>' +
      '<div class="field"><label>' + esc(t('type')) + '</label><select id="f-a-type">' +
      '<option value="file"' + (r.type === 'file' ? ' selected' : '') + '>' + esc(t('typeFile')) + '</option>' +
      '<option value="folder"' + (r.type === 'folder' ? ' selected' : '') + '>' + esc(t('typeFolder')) + '</option>' +
      '</select></div>' +
      '<div class="field"><label>' + esc(t('customName')) + '</label><input id="f-a-customName" value="' + esc(r.customName) + '"></div>' +
      '<div class="field"><label>' + esc(t('description')) + '</label><textarea id="f-a-description" rows="3">' + esc(r.description) + '</textarea></div>' +
      '<div class="field"><label>' + esc(t('filePath')) + '</label><input id="f-a-filePath" value="' + esc(r.filePath) + '"></div>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn" id="f-a-cancel">' + esc(t('cancel')) + '</button><button class="btn btn-primary" id="f-a-save">' + esc(t('save')) + '</button></div>'
    );
    document.getElementById('f-a-cancel').addEventListener('click', closeModal);
    document.getElementById('f-a-save').addEventListener('click', async function () {
      const next = {
        id: r.id,
        name: document.getElementById('f-a-name').value,
        type: document.getElementById('f-a-type').value,
        customName: document.getElementById('f-a-customName').value,
        description: document.getElementById('f-a-description').value,
        filePath: document.getElementById('f-a-filePath').value
      };
      const index = App.state.dbA.findIndex(function (x) { return x.id === r.id; });
      if (index >= 0) {
        App.state.dbA[index] = Object.assign({}, App.state.dbA[index], next);
        addRecent('edit', next.customName || next.name || next.id, 'A', next.id);
      } else {
        next.createdAt = nowIso();
        App.state.dbA.unshift(next);
        addRecent('add', next.customName || next.name || next.id, 'A', next.id);
      }
      closeModal();
      await commit();
      renderPage(App.currentRoute);
    });
  }

  function confirmDeleteB(record) {
    openModal(
      '<div class="modal-header"><h3>' + esc(t('confirmDelete')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<p>' + esc(record.model || record.id) + '</p>' +
      '<div class="modal-actions"><button class="btn" id="d-cancel">' + esc(t('cancel')) + '</button><button class="btn btn-danger" id="d-confirm">' + esc(t('confirm')) + '</button></div>'
    );
    document.getElementById('d-cancel').addEventListener('click', closeModal);
    document.getElementById('d-confirm').addEventListener('click', async function () {
      App.state.dbB = App.state.dbB.filter(function (r) { return r.id !== record.id; });
      addRecent('delete', record.model || record.id, 'B', record.id);
      closeModal();
      await commit();
      renderPage(App.currentRoute);
    });
  }

  function confirmDeleteA(record) {
    openModal(
      '<div class="modal-header"><h3>' + esc(t('confirmDelete')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<p>' + esc(record.name || record.customName || record.id) + '</p>' +
      '<div class="modal-actions"><button class="btn" id="d-cancel">' + esc(t('cancel')) + '</button><button class="btn btn-danger" id="d-confirm">' + esc(t('confirm')) + '</button></div>'
    );
    document.getElementById('d-cancel').addEventListener('click', closeModal);
    document.getElementById('d-confirm').addEventListener('click', async function () {
      App.state.dbA = App.state.dbA.filter(function (r) { return r.id !== record.id; });
      addRecent('delete', record.name || record.customName || record.id, 'A', record.id);
      closeModal();
      await commit();
      renderPage(App.currentRoute);
    });
  }

  async function addProjectItem(kind) {
    let name = '';
    try {
      if (kind === 'file' && typeof window.showOpenFilePicker === 'function') {
        const [handle] = await window.showOpenFilePicker({ multiple: false });
        name = handle.name;
      } else if (kind === 'folder' && typeof window.showDirectoryPicker === 'function') {
        const handle = await window.showDirectoryPicker();
        name = handle.name;
      } else {
        name = window.prompt(t('filePath'));
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      name = window.prompt(t('filePath'));
    }
    if (!name) return;
    showEditARecord(null, {
      name: name,
      type: kind,
      filePath: name
    });
  }

  function recordToExportRow(record) {
    return {
      [t('material')]: record.material || '',
      [t('hotMaterial')]: record.hotMaterial || '',
      [t('coldMaterial')]: record.coldMaterial || '',
      [t('series')]: record.series || '',
      [t('model')]: record.model || '',
      [t('plateCount')]: record.plateCount || '',
      [t('plateMaterial')]: record.plateMaterial || '',
      [t('plateThickness')]: record.plateThickness || '',
      [t('gasketMaterial')]: record.gasketMaterial || '',
      [t('hotInputTemp')]: record.hotInputTemp || '',
      [t('hotOutputTemp')]: record.hotOutputTemp || '',
      [t('hotFlow')]: record.hotFlow || '',
      [t('hotFlowUnit')]: record.hotFlowUnit || record.flowUnit || 'mass',
      [t('flowUnit')]: record.flowUnit === 'volume' ? 'volume' : 'mass',
      [t('coldInputTemp')]: record.coldInputTemp || '',
      [t('coldOutputTemp')]: record.coldOutputTemp || '',
      [t('coldFlow')]: record.coldFlow || '',
      [t('coldFlowUnit')]: record.coldFlowUnit || record.flowUnit || 'mass'
    };
  }

  function recordAToExportRow(record) {
    return {
      [t('name')]: record.name || '',
      [t('type')]: record.type === 'folder' ? 'folder' : 'file',
      [t('customName')]: record.customName || '',
      [t('description')]: record.description || '',
      [t('filePath')]: record.filePath || ''
    };
  }

  async function writeWorkbook(rows, filename) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SCHEM');
    if (App.exportFolderHandle) {
      const fileHandle = await App.exportFolderHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      await writable.write(data);
      await writable.close();
    } else {
      XLSX.writeFile(wb, filename);
    }
  }

  async function exportRecordXlsx(record) {
    const filename = 'SCHEM_B_' + (record.model || record.id).replace(/[\\/:*?"<>|]/g, '_') + '.xlsx';
    await writeWorkbook([recordToExportRow(record)], filename);
    addRecent('export', record.model || record.id, 'B', record.id);
    await commit();
  }

  async function exportAllB() {
    const rows = App.state.dbB.map(recordToExportRow);
    await writeWorkbook(rows, 'SCHEM_B_All.xlsx');
    addRecent('export', 'SCHEM_B_All', 'B', null);
    await commit();
  }

  async function chooseOutputFolder() {
    if (!window.showDirectoryPicker) {
      window.alert(t('folderPickerUnavailable'));
      return;
    }
    try {
      const root = await window.showDirectoryPicker({ mode: 'readwrite' });
      await setupOutputFolder(root);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      window.alert(err && err.message ? err.message : err);
    }
  }

  async function createNewDataFolder() {
    if (!window.showDirectoryPicker) {
      window.alert(t('folderPickerUnavailable'));
      return;
    }
    try {
      const parent = await window.showDirectoryPicker({ mode: 'readwrite' });
      const root = await parent.getDirectoryHandle('SCHEM_Workbench', { create: true });
      await setupOutputFolder(root);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      window.alert(err && err.message ? err.message : err);
    }
  }

  async function setupOutputFolder(root) {
    const source = await root.getDirectoryHandle('SCHEM_A_Source', { create: true });
    const exportDir = await root.getDirectoryHandle('Output', { create: true });
    const dataFileHandle = await root.getFileHandle('SCHEM_Data.xlsx', { create: true });
    await SchemStorage.writeDataFile(dataFileHandle, App.state);
    await SchemDB.set('dataFileHandle', dataFileHandle);
    App.outputFolderHandle = root;
    App.sourceFolderHandle = source;
    App.exportFolderHandle = exportDir;
    App.fileHandle = dataFileHandle;
    App.storageSource = 'file';
    App.storagePending = false;
    await SchemDB.set('outputFolderHandle', root);
    await SchemDB.set('sourceFolderHandle', source);
    await SchemDB.set('exportFolderHandle', exportDir);
    await syncConfigJson();
    updateStorageStatus({ source: App.storageSource });
    renderPage(App.currentRoute);
  }

  async function syncConfigJson() {
    if (!App.sourceFolderHandle) return;
    try {
      const materialsHandle = await App.sourceFolderHandle.getFileHandle('materials.json', { create: true });
      const materialsWritable = await materialsHandle.createWritable();
      await materialsWritable.write(JSON.stringify({ materials: App.state.materials || [] }, null, 2));
      await materialsWritable.close();

      const seriesHandle = await App.sourceFolderHandle.getFileHandle('series.json', { create: true });
      const seriesWritable = await seriesHandle.createWritable();
      await seriesWritable.write(JSON.stringify({ series: App.state.series || [] }, null, 2));
      await seriesWritable.close();
    } catch (err) {
      // Ignore write failures here; exports will still work.
    }
  }

  function getFirst(row, aliases) {
    for (let i = 0; i < aliases.length; i++) {
      const key = aliases[i];
      if (row[key] != null && row[key] !== '') return row[key];
    }
    return '';
  }

  function parseFlowUnit(value) {
    const s = String(value || '').toLowerCase();
    if (s.includes('volume') || s.includes('m³') || s.includes('体积') || s === 'volume') return 'volume';
    if (s.includes('mass') || s.includes('kg') || s.includes('质量') || s === 'mass') return 'mass';
    return 'mass';
  }

  function mapBRow(row) {
    let material = String(getFirst(row, ['material', '物料', 'Material', '介质']) || '').trim();
    if (material === 'Water-Water') material = 'Water';
    let hotMaterial = String(getFirst(row, ['hotMaterial', '热侧物料', 'Hot Material', 'Hot-side material']) || material).trim();
    if (hotMaterial === 'Water-Water') hotMaterial = 'Water';
    let coldMaterial = String(getFirst(row, ['coldMaterial', '冷侧物料', 'Cold Material', 'Cold-side material']) || material).trim();
    if (coldMaterial === 'Water-Water') coldMaterial = 'Water';
    const series = String(getFirst(row, ['series', '换热器系列', '系列', 'Series']) || '').trim();
    const model = String(getFirst(row, ['model', '换热器型号', '型号', 'Model']) || '').trim();
    const plateCount = String(getFirst(row, ['plateCount', '板片数', '板片数量', 'Plate Count', 'PlateCount']) || '').trim();
    const plateMaterial = String(getFirst(row, ['plateMaterial', '板片材质', 'Plate Material', 'PlateMaterial']) || '').trim();
    const plateThickness = String(getFirst(row, ['plateThickness', '板片厚度', 'Plate Thickness', 'PlateThickness']) || '').trim();
    const gasketMaterial = String(getFirst(row, ['gasketMaterial', '胶垫材质', '垫片材质', 'Gasket Material', 'GasketMaterial']) || '').trim();
    const hotInputTemp = String(getFirst(row, ['hotInputTemp', '热侧进口温度', 'Hot Input Temp', 'Hotside Input-temp', 'Hot input temp']) || '').trim();
    const hotOutputTemp = String(getFirst(row, ['hotOutputTemp', '热侧出口温度', 'Hot Output Temp', 'Hotside Output-temp', 'Hot output temp']) || '').trim();
    const hotFlow = String(getFirst(row, ['hotFlow', '热侧流量', 'Hot Flow', 'Hotside Flow', 'Hot flow']) || '').trim();
    const hotFlowUnit = parseFlowUnit(getFirst(row, ['hotFlowUnit', '热侧流量单位', 'Hot Flow Unit', 'Hot flow unit']));
    const flowUnit = parseFlowUnit(getFirst(row, ['flowUnit', '流量单位', 'Flow Unit', 'FlowUnit']));
    const coldInputTemp = String(getFirst(row, ['coldInputTemp', '冷侧进口温度', 'Cold Input Temp', 'Coldside Input-temp', 'Cold input temp']) || '').trim();
    const coldOutputTemp = String(getFirst(row, ['coldOutputTemp', '冷侧出口温度', 'Cold Output Temp', 'Coldside Output-temp', 'Cold output temp']) || '').trim();
    const coldFlow = String(getFirst(row, ['coldFlow', '冷侧流量', 'Cold Flow', 'Coldside Flow', 'Cold flow']) || '').trim();
    const coldFlowUnit = parseFlowUnit(getFirst(row, ['coldFlowUnit', '冷侧流量单位', 'Cold Flow Unit', 'Cold flow unit']));
    return {
      id: uuid(),
      material: material || hotMaterial || coldMaterial || 'Water',
      hotMaterial: hotMaterial || material || '',
      coldMaterial: coldMaterial || material || '',
      series,
      model,
      plateCount,
      plateMaterial,
      plateThickness,
      gasketMaterial,
      hotInputTemp,
      hotOutputTemp,
      hotFlow,
      hotFlowUnit: hotFlowUnit || flowUnit || 'mass',
      flowUnit,
      coldInputTemp,
      coldOutputTemp,
      coldFlow,
      coldFlowUnit: coldFlowUnit || flowUnit || 'mass',
      customFields: {},
      createdAt: nowIso()
    };
  }

  function mapARow(row) {
    const type = String(getFirst(row, ['type', '类型', 'Type']) || 'file').toLowerCase();
    return {
      id: uuid(),
      name: String(getFirst(row, ['name', '名称', 'Name']) || '').trim(),
      type: type === 'folder' || type === '文件夹' ? 'folder' : 'file',
      customName: String(getFirst(row, ['customName', '二次命名', 'Secondary name', 'Custom Name']) || '').trim(),
      description: String(getFirst(row, ['description', '文字描述', '描述', 'Description']) || '').trim(),
      filePath: String(getFirst(row, ['filePath', '文件/文件夹名称', '文件路径', 'File Path', 'FilePath']) || '').trim(),
      createdAt: nowIso()
    };
  }

  async function parseExcelFile(file) {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: '' });
  }

  async function importBExcel(file) {
    try {
      const rows = await parseExcelFile(file);
      let count = 0;
      rows.forEach(function (row) {
        const mapped = mapBRow(row);
        const hasContent = [mapped.material, mapped.series, mapped.model, mapped.plateCount, mapped.plateMaterial, mapped.plateThickness, mapped.gasketMaterial, mapped.hotInputTemp, mapped.hotOutputTemp, mapped.hotFlow, mapped.coldInputTemp, mapped.coldOutputTemp, mapped.coldFlow].some(function (v) { return v !== ''; });
        if (hasContent) {
          App.state.dbB.unshift(mapped);
          count++;
        }
      });
      addRecent('import', file.name + ' (' + count + ')', 'B', null);
      await commit();
      renderPage(App.currentRoute);
      window.alert(t('importSuccess') + ': ' + count);
    } catch (err) {
      window.alert(t('importFail') + ': ' + (err && err.message ? err.message : err));
    }
  }

  async function importAExcel(file) {
    try {
      const rows = await parseExcelFile(file);
      let count = 0;
      rows.forEach(function (row) {
        const mapped = mapARow(row);
        if (mapped.name || mapped.customName || mapped.description || mapped.filePath) {
          App.state.dbA.unshift(mapped);
          count++;
        }
      });
      addRecent('import', file.name + ' (' + count + ')', 'A', null);
      await commit();
      renderPage(App.currentRoute);
      window.alert(t('importSuccess') + ': ' + count);
    } catch (err) {
      window.alert(t('importFail') + ': ' + (err && err.message ? err.message : err));
    }
  }

  function showStorageSetupModal() {
    const hasFs = SchemStorage.hasFileSystemAccess();
    const pending = App.fileHandle && App.storagePending;
    let buttons = '';
    if (hasFs) {
      buttons += '<button class="btn btn-primary" id="storage-folder">' + esc(t('chooseOutputFolder')) + '</button>';
      buttons += '<button class="btn" id="storage-new-folder">' + esc(t('newDataFolder')) + '</button>';
      if (pending) {
        buttons += '<button class="btn" id="storage-auth">' + esc(t('dataFile')) + '</button>';
      }
    } else {
      buttons += '<p class="text-muted">' + esc('Your browser does not support automatic local file access. Data will be kept in browser storage and can be exported/imported as files.') + '</p>';
      buttons += '<button class="btn btn-primary" id="storage-folder">' + esc(t('chooseOutputFolder')) + '</button>';
      buttons += '<button class="btn" id="storage-new-folder">' + esc(t('newDataFolder')) + '</button>';
    }
    buttons += '<button class="btn" id="storage-browser">' + esc(t('useBrowserStorage')) + '</button>';
    const folderName = App.outputFolderHandle && App.outputFolderHandle.name ? App.outputFolderHandle.name : '';
    const folderInfo = folderName ? '<p class="text-muted">' + esc(t('outputFolder')) + ': ' + esc(folderName) + '</p>' : '';
    openModal(
      '<div class="modal-header"><h3>' + esc(t('chooseOutputFolder')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<p>' + esc(t('setupBanner')) + '</p>' +
      folderInfo +
      '<div class="modal-actions">' + buttons + '</div>'
    );
    const newFolderBtn = document.getElementById('storage-new-folder');
    const authBtn = document.getElementById('storage-auth');
    const folderBtn = document.getElementById('storage-folder');
    const browserBtn = document.getElementById('storage-browser');
    if (newFolderBtn) {
      newFolderBtn.addEventListener('click', async function () {
        await createNewDataFolder();
      });
    }
    if (authBtn) {
      authBtn.addEventListener('click', async function () {
        try {
          await SchemStorage.writeDataFile(App.fileHandle, App.state);
          App.storageSource = 'file';
          App.storagePending = false;
          closeModal();
          updateStorageStatus({ source: 'file' });
        } catch (err) {
          window.alert(err && err.message ? err.message : err);
        }
      });
    }
    if (folderBtn) {
      folderBtn.addEventListener('click', async function () {
        await chooseOutputFolder();
      });
    }
    if (browserBtn) {
      browserBtn.addEventListener('click', function () {
        localStorage.setItem('scheme-data-prompt-skipped', '1');
        closeModal();
      });
    }
  }

  function getThemeMode() {
    return localStorage.getItem('scheme-theme') || 'dark';
  }

  function triggerGlassAnimation() {
    const body = document.body;
    body.classList.remove('theme-animating');
    void body.offsetWidth;
    body.classList.add('theme-animating');
    window.setTimeout(function () {
      body.classList.remove('theme-animating');
    }, 650);
  }

  function applyThemeMode(animate) {
    const mode = getThemeMode();
    document.body.classList.remove('theme-light', 'theme-dark');
    document.body.classList.add('theme-' + mode);
    updateLogo();
    if (animate) triggerGlassAnimation();
  }

  function updateLogo() {
    const img = document.getElementById('brand-logo');
    if (!img) return;
    img.src = getThemeMode() === 'dark' ? 'assets/LOGO-DARKMODE-fit.png' : 'assets/LOGO.webp';
  }

  function setThemeMode(mode, animate) {
    localStorage.setItem('scheme-theme', mode);
    applyThemeMode(animate);
    if (App.currentRoute === 'pageSettings') {
      renderPage(App.currentRoute);
    }
  }

  async function applyBackgroundImage() {
    try {
      const dataUrl = await SchemDB.get('bgImage');
      if (dataUrl) {
        document.body.style.backgroundImage = 'url("' + String(dataUrl).replace(/"/g, '\\"') + '")';
        document.body.classList.add('custom-bg');
      } else {
        document.body.style.backgroundImage = '';
        document.body.classList.remove('custom-bg');
      }
    } catch (err) {
      document.body.style.backgroundImage = '';
      document.body.classList.remove('custom-bg');
    }
  }

  function handleBackgroundFile(file) {
    if (!file) return;
    const isImage = (file.type && file.type.indexOf('image/') === 0) || /\.(heic|heif)$/i.test(file.name || '');
    if (!isImage) {
      window.alert(t('importFail'));
      return;
    }
    const reader = new FileReader();
    reader.onload = async function () {
      const dataUrl = reader.result;
      await SchemDB.set('bgImage', dataUrl);
      document.body.style.backgroundImage = 'url("' + String(dataUrl).replace(/"/g, '\\"') + '")';
      document.body.classList.add('custom-bg');
    };
    reader.readAsDataURL(file);
  }

  async function removeBackgroundImage() {
    await SchemDB.delete('bgImage');
    document.body.style.backgroundImage = '';
    document.body.classList.remove('custom-bg');
  }

  function showRecommendedBackgrounds() {
    const images = [
      { file: 'WPID.jpg', mode: 'dark' },
      { file: 'WPIW.jpg', mode: 'light' },
      { file: 'WPIIW.jpg', mode: 'light' }
    ];
    const cards = images.map(function (item) {
      return '<button class="recommend-card" data-bg="' + esc(item.file) + '" data-mode="' + esc(item.mode) + '">' +
        '<img src="assets/backgrounds/' + esc(item.file) + '" alt="' + esc(item.file) + '">' +
        '</button>';
    }).join('');
    openModal(
      '<div class="modal-header"><h3>' + esc(t('recommendedBackgrounds')) + '</h3><button class="close-btn" id="modal-close">×</button></div>' +
      '<div class="recommend-grid">' + cards + '</div>'
    );
    document.querySelectorAll('.recommend-card').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyRecommendedBackground(btn.dataset.bg, btn.dataset.mode);
        closeModal();
      });
    });
  }

  async function applyRecommendedBackground(file, mode) {
    const path = 'assets/backgrounds/' + file;
    await SchemDB.set('bgImage', path);
    document.body.style.backgroundImage = 'url("' + path + '")';
    document.body.classList.add('custom-bg');
    if (mode === 'dark') {
      setThemeMode('dark', true);
    } else {
      setThemeMode('light', true);
    }
  }

  async function init() {
    window.currentLang = localStorage.getItem('scheme-lang') || 'zh';
    const loaded = await SchemStorage.loadState();
    App.state = loaded.state;
    App.fileHandle = loaded.fileHandle;
    App.storageSource = loaded.source;
    App.storagePending = loaded.pending;
    const storedTemplates = await SchemDB.get('bTemplates');
    App.bTemplates = Array.isArray(storedTemplates) && storedTemplates.length ? storedTemplates : [defaultBTemplate()];
    ensureBTemplates();
    try {
      App.outputFolderHandle = await SchemDB.get('outputFolderHandle') || null;
      App.sourceFolderHandle = await SchemDB.get('sourceFolderHandle') || null;
      App.exportFolderHandle = await SchemDB.get('exportFolderHandle') || null;
      App.modelStatuses = await SchemDB.get('modelStatuses') || [];
      App.lists = await SchemDB.get('lists') || [];
    } catch (err) {
      App.outputFolderHandle = null;
      App.sourceFolderHandle = null;
      App.exportFolderHandle = null;
      App.modelStatuses = [];
      App.lists = [];
    }
    try {
      const tubeResponse = await fetch('data/tube_db.json');
      if (tubeResponse.ok) {
        App.tubeDB = await tubeResponse.json();
        App.tubeDB.forEach(function (r, idx) {
          r.id = r.id || 'tube-' + idx;
        });
      } else if (window.TUBE_DB && Array.isArray(window.TUBE_DB)) {
        App.tubeDB = window.TUBE_DB;
        App.tubeDB.forEach(function (r, idx) {
          r.id = r.id || 'tube-' + idx;
        });
      }
    } catch (err) {
      if (window.TUBE_DB && Array.isArray(window.TUBE_DB)) {
        App.tubeDB = window.TUBE_DB;
        App.tubeDB.forEach(function (r, idx) {
          r.id = r.id || 'tube-' + idx;
        });
      } else {
        App.tubeDB = [];
      }
    }
    try {
      if (window.DTS_DB && Array.isArray(window.DTS_DB)) {
        App.dtsDB = window.DTS_DB;
        App.dtsDB.forEach(function (r, idx) {
          r.id = r.id || 'dts-' + idx;
        });
      } else {
        const dtsResponse = await fetch('data/dts_db.json');
        if (dtsResponse.ok) {
          App.dtsDB = await dtsResponse.json();
          App.dtsDB.forEach(function (r, idx) {
            r.id = r.id || 'dts-' + idx;
          });
        }
      }
    } catch (err) {
      App.dtsDB = [];
    }
    applyThemeMode(false);
    await applyBackgroundImage();

    document.querySelectorAll('.nav-link').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navigate(btn.dataset.route);
      });
    });
    document.getElementById('lang-toggle').addEventListener('click', function () {
      setLang(getLang() === 'zh' ? 'en' : 'zh');
      applyLanguage();
    });
    document.getElementById('storage-btn').addEventListener('click', function () {
      showStorageSetupModal();
    });
    document.addEventListener('click', function (e) {
      const menu = document.getElementById('add-template-menu');
      if (menu && !menu.classList.contains('hidden') && !e.target.closest('#editor-b-add-menu') && !e.target.closest('#add-template-menu')) {
        menu.classList.add('hidden');
      }
    });

    applyLanguage();
    updateStorageStatus({ source: App.storageSource });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
