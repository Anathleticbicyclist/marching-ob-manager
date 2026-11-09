/*!
 * 迈向Ob管理器 - 存储与导入引擎
 * IndexedDB 持久化 + 内存索引；文件哈希、活动指纹、JSON 导入导出。
 */
(function (root) {
  'use strict';

  var DB_NAME = 'marching_ob_manager';
  var DB_VERSION = 1;
  var STORE = 'activities';
  var memory = [];
  var db = null;
  var memOnly = false;

  function openDB() {
    return new Promise(function (resolve) {
      if (db) return resolve(db);
      if (memOnly || typeof indexedDB === 'undefined') { memOnly = true; return resolve(null); }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) {
          var os = d.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('year', 'year', { unique: false });
          os.createIndex('hash', 'hash', { unique: false });
          os.createIndex('fingerprint', 'fingerprint', { unique: false });
        }
      };
      req.onsuccess = function (e) { db = e.target.result; resolve(db); };
      req.onerror = function () { memOnly = true; resolve(null); };
    });
  }

  function tx(mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  function getAll() {
    return openDB().then(function () {
      if (!db) return memory.slice();
      return new Promise(function (resolve, reject) {
        var req = tx('readonly').getAll();
        req.onsuccess = function () { memory = req.result || []; resolve(memory.slice()); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function putMany(list) {
    return openDB().then(function () {
      if (!db) { memory = memory.concat(list); return list.length; }
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, 'readwrite');
        var os = t.objectStore(STORE);
        list.forEach(function (a) { os.put(a); });
        t.oncomplete = function () { resolve(list.length); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function remove(id) {
    return openDB().then(function () {
      if (!db) { memory = memory.filter(function (a) { return a.id !== id; }); return; }
      return new Promise(function (resolve) {
        var t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).delete(id);
        t.oncomplete = function () { resolve(); };
      });
    });
  }

  function clearAll() {
    return openDB().then(function () {
      memory = [];
      if (!db) return;
      return new Promise(function (resolve) {
        var t = db.transaction(STORE, 'readwrite');
        t.objectStore(STORE).clear();
        t.oncomplete = function () { resolve(); };
      });
    });
  }

  async function sha256Hex(arrayBuffer) {
    if (root.crypto && root.crypto.subtle) {
      try {
        var digest = await root.crypto.subtle.digest('SHA-256', arrayBuffer);
        var bytes = new Uint8Array(digest);
        var hex = '';
        for (var i = 0; i < bytes.length; i++) hex += ('0' + bytes[i].toString(16)).slice(-2);
        return hex;
      } catch (e) { /* fall through */ }
    }
    // FNV-1a 64-bit 兜底（非加密，仅用于去重）
    var u8 = new Uint8Array(arrayBuffer);
    var h1 = 0x811c9dc5, h2 = 0x1000193;
    for (var j = 0; j < u8.length; j++) {
      h1 ^= u8[j]; h1 = (h1 * 0x01000193) >>> 0;
      h2 ^= u8[j]; h2 = ((h2 * 0x85ebca6b) ^ (h2 >>> 13)) >>> 0;
    }
    return ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
  }

  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function downsample(points, maxN) {
    if (!points || !points.length) return [];
    maxN = maxN || 600;
    if (points.length <= maxN) {
      return points.map(function (p) {
        return { lat: round(p.lat), lon: round(p.lon), ele: p.ele == null ? null : round(p.ele), t: p.t || null };
      });
    }
    var step = points.length / maxN;
    var out = [];
    for (var i = 0; i < maxN; i++) {
      var p = points[Math.floor(i * step)];
      out.push({ lat: round(p.lat), lon: round(p.lon), ele: p.ele == null ? null : round(p.ele), t: p.t || null });
    }
    return out;
  }
  function round(v) { return typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : null; }

  function normalize(parsed, fileMeta, hash) {
    var start = parsed.startTime instanceof Date ? parsed.startTime : (parsed.startTime ? new Date(parsed.startTime) : null);
    var startIso = start ? start.toISOString() : null;
    var year = start ? start.getFullYear() : null;
    var month = start ? start.getMonth() + 1 : null;
    var name = (parsed.name && parsed.name.trim()) ? parsed.name.trim() : gpxBaseName(fileMeta.name);
    var a = {
      id: hash + ':' + (fileMeta.relPath || fileMeta.name),
      hash: hash,
      fileName: fileMeta.name,
      relPath: fileMeta.relPath || '',
      fileSize: fileMeta.size || 0,
      format: parsed.format,
      name: name,
      sport: parsed.sport || 'other',
      sportLabel: parsed.sportLabel || '运动',
      subSport: parsed.subSport == null ? null : parsed.subSport,
      startTime: startIso,
      year: year,
      month: month,
      distance: Number(parsed.distance) || 0,
      duration: Number(parsed.duration) || 0,
      movingTime: Number(parsed.movingTime) || Number(parsed.duration) || 0,
      ascent: Number(parsed.ascent) || 0,
      descent: Number(parsed.descent) || 0,
      avgSpeed: Number(parsed.avgSpeed) || 0,
      maxSpeed: Number(parsed.maxSpeed) || 0,
      avgHr: parsed.avgHr == null ? null : Number(parsed.avgHr),
      maxHr: parsed.maxHr == null ? null : Number(parsed.maxHr),
      avgCadence: parsed.avgCadence == null ? null : Number(parsed.avgCadence),
      avgPower: parsed.avgPower == null ? null : Number(parsed.avgPower),
      maxPower: parsed.maxPower == null ? null : Number(parsed.maxPower),
      calories: parsed.calories == null ? null : Number(parsed.calories),
      pointCount: parsed.pointCount || (parsed.points ? parsed.points.length : 0),
      points: downsample(parsed.points, 600),
      device: parsed.device || '',
      note: '',
      importedAt: new Date().toISOString()
    };
    a.fingerprint = root.ObStats ? root.ObStats.fingerprint(a) : '';
    return a;
  }

  function gpxBaseName(n) { return String(n || '未命名活动').replace(/\.(fit|gpx|tcx)$/i, ''); }

  async function ingestFiles(files, onProgress, existing) {
    var existingHashes = {};
    (existing || []).forEach(function (a) { if (a.hash) existingHashes[a.hash] = true; });
    var report = { added: 0, skipped: 0, failed: 0, duplicates: 0, errors: [], items: [] };
    var list = Array.prototype.slice.call(files || []);
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var ext = extOf(f.name);
      if (['fit', 'gpx', 'tcx'].indexOf(ext) < 0) { report.skipped++; continue; }
      try {
        var buf = await f.arrayBuffer();
        var hash = await sha256Hex(buf);
        if (existingHashes[hash]) { report.duplicates++; report.skipped++; continue; }
        var parsed;
        if (ext === 'fit') {
          parsed = root.FitParser.parse(buf);
        } else {
          var text = decodeBytes(buf);
          parsed = (ext === 'tcx') ? root.GpxParser.parseTCX(text, f.name) : root.GpxParser.parseGPX(text, f.name);
        }
        if (!parsed || (!parsed.startTime && !parsed.distance)) { report.failed++; report.errors.push(f.name + ': 无法解析出活动数据'); continue; }
        var rec = normalize(parsed, { name: f.name, relPath: f.webkitRelativePath || f.name, size: f.size }, hash);
        existingHashes[hash] = true;
        report.items.push(rec);
        report.added++;
      } catch (err) {
        report.failed++;
        report.errors.push(f.name + ': ' + (err && err.message ? err.message : String(err)));
      }
      if (onProgress) onProgress(i + 1, list.length, f.name, report);
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    if (report.items.length) await putMany(report.items);
    return report;
  }

  function decodeBytes(buf) {
    var u8 = new Uint8Array(buf);
    var utf8 = '';
    try {
      utf8 = new TextDecoder('utf-8', { fatal: false }).decode(u8);
    } catch (e) {
      utf8 = String.fromCharCode.apply(null, u8.subarray(0, Math.min(u8.length, 200000)));
    }
    return utf8;
  }

  function exportJSON() {
    return getAll().then(function (list) {
      var payload = {
        app: '迈向Ob管理器',
        version: 1,
        exportedAt: new Date().toISOString(),
        count: list.length,
        activities: list
      };
      return JSON.stringify(payload);
    });
  }

  function importJSON(text) {
    var payload = JSON.parse(text);
    var arr = Array.isArray(payload) ? payload : (payload.activities || []);
    if (!Array.isArray(arr)) throw new Error('JSON 格式不正确');
    var out = [];
    arr.forEach(function (a) {
      if (!a || !a.startTime) return;
      var copy = Object.assign({}, a);
      copy.id = copy.id || (copy.hash || '') + ':' + (copy.fileName || '') + ':' + Math.random().toString(36).slice(2);
      copy.points = copy.points || [];
      copy.fingerprint = copy.fingerprint || (root.ObStats ? root.ObStats.fingerprint(copy) : '');
      out.push(copy);
    });
    return putMany(out).then(function () { return out.length; });
  }

  root.ObStore = {
    openDB: openDB,
    getAll: getAll,
    putMany: putMany,
    remove: remove,
    clearAll: clearAll,
    ingestFiles: ingestFiles,
    exportJSON: exportJSON,
    importJSON: importJSON,
    sha256Hex: sha256Hex,
    isMemoryOnly: function () { return memOnly; },
    version: '1.0.0'
  };
})(typeof self !== 'undefined' ? self : this);
