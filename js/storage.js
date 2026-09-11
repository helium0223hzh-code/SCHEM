(function () {
  const STATE_KEY = 'appState';
  const HANDLE_KEY = 'dataFileHandle';

  function nowIso() {
    return new Date().toISOString();
  }

  function defaultState() {
    return {
      schemaVersion: 1,
      dbB: [],
      dbA: [],
      materials: [],
      series: [],
      recentEdits: [],
      updatedAt: null
    };
  }

  const B_FIELDS = [
    'id', 'material', 'hotMaterial', 'coldMaterial', 'series', 'model', 'plateCount', 'plateMaterial', 'plateThickness',
    'gasketMaterial', 'hotInputTemp', 'hotOutputTemp', 'hotFlow', 'hotFlowUnit', 'flowUnit',
    'coldInputTemp', 'coldOutputTemp', 'coldFlow', 'coldFlowUnit', 'customFields', 'createdAt'
  ];

  const A_FIELDS = [
    'id', 'name', 'type', 'customName', 'description', 'filePath', 'createdAt'
  ];

  function toText(value) {
    if (value == null) return '';
    return String(value);
  }

  function recordBToRow(record) {
    const row = {};
    B_FIELDS.forEach(function (key) {
      row[key] = key === 'customFields' ? JSON.stringify(record.customFields || {}) : toText(record[key]);
    });
    return row;
  }

  function recordAToRow(record) {
    const row = {};
    A_FIELDS.forEach(function (key) {
      row[key] = toText(record[key]);
    });
    return row;
  }

  function rowToRecordB(row) {
    const legacyMaterial = row.material === 'Water-Water' ? 'Water' : (row.material || '');
    return {
      id: row.id || ('id-' + Date.now() + '-' + Math.random().toString(16).slice(2)),
      material: legacyMaterial,
      hotMaterial: row.hotMaterial === 'Water-Water' ? 'Water' : (row.hotMaterial || legacyMaterial || ''),
      coldMaterial: row.coldMaterial === 'Water-Water' ? 'Water' : (row.coldMaterial || legacyMaterial || ''),
      series: row.series || '',
      model: row.model || '',
      plateCount: row.plateCount || '',
      plateMaterial: row.plateMaterial || '',
      plateThickness: row.plateThickness || '',
      gasketMaterial: row.gasketMaterial || '',
      hotInputTemp: row.hotInputTemp || '',
      hotOutputTemp: row.hotOutputTemp || '',
      hotFlow: row.hotFlow || '',
      flowUnit: row.flowUnit || 'mass',
      coldInputTemp: row.coldInputTemp || '',
      coldOutputTemp: row.coldOutputTemp || '',
      coldFlow: row.coldFlow || '',
      hotFlowUnit: row.hotFlowUnit || 'mass',
      coldFlowUnit: row.coldFlowUnit || 'mass',
      customFields: (function () {
        try {
          return row.customFields ? JSON.parse(row.customFields) : {};
        } catch (err) {
          return {};
        }
      })(),
      createdAt: row.createdAt || ''
    };
  }

  function rowToRecordA(row) {
    return {
      id: row.id || ('id-' + Date.now() + '-' + Math.random().toString(16).slice(2)),
      name: row.name || '',
      type: row.type === 'folder' ? 'folder' : 'file',
      customName: row.customName || '',
      description: row.description || '',
      filePath: row.filePath || '',
      createdAt: row.createdAt || ''
    };
  }

  function stateToWorkbook(state) {
    const wsB = XLSX.utils.json_to_sheet(state.dbB.map(recordBToRow));
    const wsA = XLSX.utils.json_to_sheet(state.dbA.map(recordAToRow));
    const wsLists = XLSX.utils.json_to_sheet([].concat(
      (state.materials || []).map(function (value) { return { type: 'material', value: value }; }),
      (state.series || []).map(function (value) { return { type: 'series', value: value }; })
    ));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsB, 'SCHEM B');
    XLSX.utils.book_append_sheet(wb, wsA, 'SCHEM A');
    XLSX.utils.book_append_sheet(wb, wsLists, 'Lists');
    return wb;
  }

  function sheetToRows(wb, name) {
    if (!wb.SheetNames.includes(name)) return [];
    const ws = wb.Sheets[name];
    return XLSX.utils.sheet_to_json(ws, { defval: '' });
  }

  function workbookToState(wb) {
    const dbB = sheetToRows(wb, 'SCHEM B').map(rowToRecordB);
    const dbA = sheetToRows(wb, 'SCHEM A').map(rowToRecordA);
    const lists = sheetToRows(wb, 'Lists');
    const materials = [];
    const series = [];
    lists.forEach(function (row) {
      const value = String(row.value || '').trim();
      if (!value) return;
      if (row.type === 'series') {
        if (!series.includes(value)) series.push(value);
      } else {
        if (!materials.includes(value)) materials.push(value);
      }
    });
    return {
      schemaVersion: 1,
      dbB: dbB,
      dbA: dbA,
      materials: materials,
      series: series,
      recentEdits: [],
      updatedAt: nowIso()
    };
  }

  function normalizeState(input) {
    const base = defaultState();
    if (!input || typeof input !== 'object') return base;
    return {
      schemaVersion: input.schemaVersion || 1,
      dbB: Array.isArray(input.dbB) ? input.dbB : [],
      dbA: Array.isArray(input.dbA) ? input.dbA : [],
      materials: Array.isArray(input.materials) ? input.materials : [],
      series: Array.isArray(input.series) ? input.series : [],
      recentEdits: Array.isArray(input.recentEdits) ? input.recentEdits : [],
      updatedAt: input.updatedAt || null
    };
  }

  function hasFileSystemAccess() {
    return typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function';
  }

  function sanitizeFileName(name) {
    return String(name || 'SCHEM_Data').replace(/[\\/:*?"<>|]/g, '_');
  }

  async function ensureFilePermission(handle) {
    if (!handle || !handle.queryPermission) return false;
    try {
      let permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        permission = await handle.requestPermission({ mode: 'readwrite' });
      }
      return permission === 'granted';
    } catch (err) {
      return false;
    }
  }

  async function writeDataFile(handle, state) {
    if (!handle || !handle.createWritable) throw new Error('File handle is not writable');
    const allowed = await ensureFilePermission(handle);
    if (!allowed) throw new Error('Permission denied');
    const wb = stateToWorkbook(state);
    const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    return true;
  }

  async function readDataFile(handle) {
    if (!handle || !handle.getFile) throw new Error('File handle is not readable');
    const file = await handle.getFile();
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    return workbookToState(wb);
  }

  async function storeFileHandle(handle) {
    if (handle) {
      await SchemDB.set(HANDLE_KEY, handle);
    } else {
      await SchemDB.delete(HANDLE_KEY);
    }
  }

  async function loadStoredHandle() {
    return SchemDB.get(HANDLE_KEY);
  }

  async function createDataFile(initialState) {
    if (!hasFileSystemAccess()) throw new Error('File System Access API is not available');
    const handle = await window.showSaveFilePicker({
      suggestedName: 'SCHEM_Data.xlsx',
      types: [{
        description: 'SCHEM Data',
        accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
      }]
    });
    await writeDataFile(handle, initialState);
    await storeFileHandle(handle);
    return handle;
  }

  async function openDataFile() {
    if (!hasFileSystemAccess()) throw new Error('File System Access API is not available');
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: 'SCHEM Data',
        accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
      }]
    });
    const state = await readDataFile(handle);
    await storeFileHandle(handle);
    return { handle, state: normalizeState(state) };
  }

  async function saveState(state, fileHandle) {
    state.updatedAt = nowIso();
    await SchemDB.set(STATE_KEY, state);
    if (fileHandle) {
      try {
        await writeDataFile(fileHandle, state);
        return { ok: true, source: 'file' };
      } catch (err) {
        return { ok: true, source: 'idb', warning: err && err.message ? err.message : String(err) };
      }
    }
    return { ok: true, source: 'idb' };
  }

  async function loadState() {
    const cached = await SchemDB.get(STATE_KEY);
    let handle = null;
    try {
      handle = await loadStoredHandle();
    } catch (err) {
      handle = null;
    }

    if (handle) {
      try {
        const fileState = await readDataFile(handle);
        if (cached && Array.isArray(cached.recentEdits)) {
          fileState.recentEdits = cached.recentEdits;
        }
        return { state: normalizeState(fileState), fileHandle: handle, source: 'file', pending: false };
      } catch (err) {
        const permissionDenied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        return {
          state: normalizeState(cached),
          fileHandle: handle,
          source: 'idb',
          pending: permissionDenied
        };
      }
    }

    return { state: normalizeState(cached), fileHandle: null, source: 'idb', pending: false };
  }

  function getFileName(handle) {
    if (!handle) return null;
    if (handle.name) return handle.name;
    return 'SCHEM_Data.xlsx';
  }

  window.SchemStorage = {
    defaultState,
    normalizeState,
    hasFileSystemAccess,
    ensureFilePermission,
    writeDataFile,
    readDataFile,
    createDataFile,
    openDataFile,
    saveState,
    loadState,
    getFileName
  };
})();
