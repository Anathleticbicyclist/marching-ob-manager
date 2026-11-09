/*!
 * 迈向Ob管理器 - 应用层（标签页、导入、搜索、统计渲染、查重、海报、设置）
 */
(function () {
  'use strict';

  var S = window.ObStore, St = window.ObStats;
  var state = {
    activities: [],
    view: 'records',
    keyword: '',
    year: 'all',
    sport: 'all',
    sort: 'date-desc',
    statsYear: null,
    posterYear: null,
    selected: null,
    importing: false
  };

  function $(id) { return document.getElementById(id); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtKm(m, digits) { return ((Number(m) || 0) / 1000).toFixed(digits == null ? 1 : digits); }
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }
  function fmtSpeed(mps) {
    var v = Number(mps) || 0;
    return v > 0 ? (v * 3.6).toFixed(1) + ' km/h' : '—';
  }
  function fmtDate(iso) {
    if (!iso) return '未知时间';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '未知时间';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, ms || 2600);
  }
  function yearsOf(list) {
    var set = {};
    list.forEach(function (a) {
      var d = a.startTime ? new Date(a.startTime) : null;
      if (d && !isNaN(d.getTime())) set[d.getFullYear()] = true;
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return b - a; });
  }
  function dupIdSet() {
    var groups = St.dedupGroups(state.activities);
    var ids = {};
    groups.forEach(function (g) { g.items.forEach(function (a) { ids[a.id] = true; }); });
    return ids;
  }
  function loadGoals() {
    try {
      var g = JSON.parse(localStorage.getItem('mob_goals') || '{}');
      return { distanceKm: g.distanceKm || 4000, count: g.count || 100 };
    } catch (e) { return { distanceKm: 4000, count: 100 }; }
  }
  function saveGoals(g) { localStorage.setItem('mob_goals', JSON.stringify(g)); }

  /* ---------------- 数据加载 ---------------- */
  function reload() {
    return S.getAll().then(function (list) {
      list.sort(function (a, b) { return new Date(b.startTime || 0) - new Date(a.startTime || 0); });
      state.activities = list;
      var years = yearsOf(list);
      if (!state.statsYear && years.length) state.statsYear = years[0];
      if (!state.posterYear && years.length) state.posterYear = years[0];
      if (state.year !== 'all' && years.indexOf(Number(state.year)) < 0) state.year = 'all';
      renderAll();
    });
  }

  function renderAll() {
    renderYearOptions();
    renderRecords();
    renderStats();
    renderDupes();
    renderPoster();
    renderSettings();
  }

  /* ---------------- 记录 ---------------- */
  function renderYearOptions() {
    var years = yearsOf(state.activities);
    var opts = '<option value="all">全部年份</option>' + years.map(function (y) {
      return '<option value="' + y + '"' + (String(state.year) === String(y) ? ' selected' : '') + '>' + y + ' 年</option>';
    }).join('');
    $('yearFilter').innerHTML = opts;
  }

  function applyFilters() {
    var tokens = state.keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var list = St.filterActivities(state.activities, {
      year: state.year === 'all' ? null : Number(state.year),
      sport: state.sport
    });
    if (tokens.length) {
      list = list.filter(function (a) {
        var hay = [a.name, a.fileName, a.sportLabel, a.format, a.device, a.note,
          a.startTime ? fmtDate(a.startTime) : '', String(a.year || '')].join(' ').toLowerCase();
        return tokens.every(function (t) { return hay.indexOf(t) >= 0; });
      });
    }
    var sorters = {
      'date-desc': function (a, b) { return new Date(b.startTime || 0) - new Date(a.startTime || 0); },
      'date-asc': function (a, b) { return new Date(a.startTime || 0) - new Date(b.startTime || 0); },
      'dist-desc': function (a, b) { return (b.distance || 0) - (a.distance || 0); },
      'dur-desc': function (a, b) { return (b.movingTime || b.duration || 0) - (a.movingTime || a.duration || 0); },
      'climb-desc': function (a, b) { return (b.ascent || 0) - (a.ascent || 0); }
    };
    list.sort(sorters[state.sort] || sorters['date-desc']);
    return list;
  }

  function renderRecords() {
    var list = applyFilters();
    var dups = dupIdSet();
    var box = $('recordList');
    var empty = $('emptyRecords');
    if (!state.activities.length) {
      box.innerHTML = '';
      box.hidden = true;
      empty.hidden = false;
      $('listSummary').textContent = '尚未导入数据';
      return;
    }
    empty.hidden = true;
    box.hidden = false;
    $('listSummary').textContent = '共 ' + state.activities.length + ' 条索引 · 当前筛选 ' + list.length + ' 条' +
      (state.keyword ? ' · 搜索「' + state.keyword + '」' : '');
    if (!list.length) {
      box.innerHTML = '<div class="empty"><div class="empty-ico">🔍</div><h3>没有匹配的记录</h3><p>试试更换关键词、年份或运动类型。</p></div>';
      return;
    }
    box.innerHTML = list.map(function (a) {
      var d = a.startTime ? new Date(a.startTime) : null;
      var sportClass = a.sport === 'ride' ? 'ride' : a.sport === 'run' ? 'run' : a.sport === 'hike' ? 'hike' : '';
      var badges = '<span class="badge ' + sportClass + '">' + esc(a.sportLabel || '运动') + '</span>' +
        (a.format ? '<span class="badge">' + esc(String(a.format).toUpperCase()) + '</span>' : '') +
        (dups[a.id] ? '<span class="badge dup">重复</span>' : '');
      return '<div class="record-item" data-id="' + esc(a.id) + '">' +
        '<div class="rec-top"><div class="rec-name">' + esc(a.name || a.fileName) + '</div><div class="rec-badges">' + badges + '</div></div>' +
        '<div class="rec-meta">' + fmtDate(a.startTime) + ' · ' + esc(a.fileName || '') + (a.device ? ' · ' + esc(a.device) : '') + '</div>' +
        '<div class="rec-stats">' +
          '<div class="rec-stat"><span>距离</span>' + fmtKm(a.distance) + '<em>km</em></div>' +
          '<div class="rec-stat"><span>时长</span>' + fmtDur(a.movingTime || a.duration) + '</div>' +
          '<div class="rec-stat"><span>爬升</span>' + Math.round(a.ascent || 0) + '<em>m</em></div>' +
          '<div class="rec-stat"><span>均速</span>' + fmtSpeed(a.avgSpeed) + '</div>' +
          (a.avgHr ? '<div class="rec-stat"><span>心率</span>' + Math.round(a.avgHr) + '<em>bpm</em></div>' : '') +
        '</div></div>';
    }).join('');
    all('.record-item', box).forEach(function (el) {
      el.addEventListener('click', function () { openDetail(el.getAttribute('data-id')); });
    });
  }

  /* ---------------- 统计 ---------------- */
  function renderStats() {
    var years = yearsOf(state.activities);
    var ys = $('yearSwitch');
    var cur = state.statsYear || (years[0] || new Date().getFullYear());
    ys.innerHTML = years.length
      ? years.map(function (y) { return '<button data-year="' + y + '" class="' + (y === cur ? 'on' : '') + '">' + y + ' 年</button>'; }).join('')
      : '<button class="on">暂无数据</button>';
    all('button', ys).forEach(function (b) {
      b.addEventListener('click', function () {
        state.statsYear = Number(b.getAttribute('data-year')) || null;
        renderStats();
      });
    });
    var list = St.filterActivities(state.activities, { year: cur });
    var t = St.totals(list);
    $('statDistance').textContent = fmtKm(t.distance);
    $('statCount').textContent = t.count;
    $('statTime').textContent = (t.movingTime / 3600).toFixed(1);
    $('statElev').textContent = Math.round(t.elevation);
    // 目标
    var goals = loadGoals();
    $('goalDistNow').textContent = fmtKm(t.distance);
    $('goalDistTarget').textContent = goals.distanceKm;
    $('goalCountNow').textContent = t.count;
    $('goalCountTarget').textContent = goals.count;
    $('goalDistBar').style.width = Math.min(100, goals.distanceKm > 0 ? (t.distance / 1000) / goals.distanceKm * 100 : 0) + '%';
    $('goalCountBar').style.width = Math.min(100, goals.count > 0 ? t.count / goals.count * 100 : 0) + '%';
    var career = St.career(state.activities);
    $('careerTotal').textContent = fmtKm(career.totals.distance);
    $('careerCount').textContent = career.totals.count;
    // 热力图
    var heat = St.heatmap(state.activities, cur);
    var todayKey = St.dayKey(new Date());
    var cells = [];
    for (var c = 0; c < heat.grid.length; c++) {
      for (var r = 0; r < 7; r++) {
        var cell = heat.grid[c][r];
        if (!cell) { cells.push('<i></i>'); continue; }
        cells.push('<i class="' + (cell.level ? 'l' + cell.level : '') + (cell.date === todayKey ? ' today' : '') + '" title="' + cell.date + ' · ' + fmtKm(cell.value) + ' km · ' + cell.count + ' 次"></i>');
      }
    }
    $('heatGrid').innerHTML = cells.join('');
    var activeDays = Object.keys(heat.byDay).length;
    $('heatTotal').textContent = fmtKm(heat.totalDistance) + ' km';
    $('heatActive').textContent = activeDays + ' 个活跃日';
    // 月度
    var months = St.monthly(state.activities, cur);
    var maxM = 1;
    months.forEach(function (m) { if (m.distance > maxM) maxM = m.distance; });
    $('monthBars').innerHTML = months.map(function (m, i) {
      var h = Math.round(m.distance / maxM * 90);
      return '<div class="month-bar" title="' + (i + 1) + '月 · ' + fmtKm(m.distance) + ' km · ' + m.count + ' 次">' +
        '<i style="height:' + h + 'px"></i><span>' + (i + 1) + '月</span></div>';
    }).join('');
    // PB
    var pb = St.personalBests(state.activities);
    var pbRows = pb.marathon.map(function (m) {
      var ok = !!m.activity;
      return '<div class="pb-row"><span class="pb-name">' + m.label + '</span>' +
        (ok ? '<span class="pb-val">' + fmtDur(m.time) + '<small>' + fmtDate(m.activity.startTime) + ' · ' + fmtKm(m.activity.distance) + ' km</small></span>'
            : '<span class="pb-val pb-empty">暂无有效记录</span>') + '</div>';
    });
    pbRows.push('<div class="pb-row"><span class="pb-name">最长单次骑行</span>' + (pb.longestRide
      ? '<span class="pb-val">' + fmtKm(pb.longestRide.distance) + ' km<small>' + fmtDate(pb.longestRide.startTime) + '</small></span>'
      : '<span class="pb-val pb-empty">暂无骑行</span>') + '</div>');
    pbRows.push('<div class="pb-row"><span class="pb-name">最大单次爬升</span>' + (pb.maxClimb
      ? '<span class="pb-val">' + Math.round(pb.maxClimb.ascent) + ' m<small>' + fmtDate(pb.maxClimb.startTime) + '</small></span>'
      : '<span class="pb-val pb-empty">暂无记录</span>') + '</div>');
    pbRows.push('<div class="pb-row"><span class="pb-name">最快骑行均速</span>' + (pb.fastestRide
      ? '<span class="pb-val">' + fmtSpeed(pb.fastestRide.avgSpeed) + '<small>' + fmtDate(pb.fastestRide.startTime) + ' · ' + fmtKm(pb.fastestRide.distance) + ' km</small></span>'
      : '<span class="pb-val pb-empty">暂无骑行</span>') + '</div>');
    $('pbList').innerHTML = pbRows.join('');
    // 生涯速览
    var cm = [
      ['生涯总距离', fmtKm(career.totals.distance) + ' km'],
      ['生涯活动数', career.totals.count + ' 次'],
      ['生涯总时长', (career.totals.movingTime / 3600).toFixed(1) + ' h'],
      ['生涯总爬升', Math.round(career.totals.elevation) + ' m'],
      ['活跃天数', career.totals.activeDays + ' 天'],
      ['最长连续', career.streak.days + ' 天'],
      ['单日最远', career.bestDay ? fmtKm(career.bestDay.distance) + ' km' : '—'],
      ['最快均速', career.fastest ? fmtSpeed(career.fastest.avgSpeed) : '—']
    ];
    $('careerMini').innerHTML = cm.map(function (x) {
      return '<div class="mini-item"><div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div></div>';
    }).join('');
  }

  /* ---------------- 查重 ---------------- */
  function renderDupes() {
    var groups = St.dedupGroups(state.activities);
    var box = $('dupeList');
    if (!groups.length) {
      $('dupeSummary').textContent = '没有发现重复记录（精确文件哈希 + 活动指纹双重比对）';
      box.innerHTML = '<div class="empty"><div class="empty-ico">✅</div><h3>索引很干净</h3><p>当前 ' + state.activities.length + ' 条记录中没有检测到重复。</p></div>';
      return;
    }
    var total = groups.reduce(function (s, g) { return s + g.items.length; }, 0);
    $('dupeSummary').textContent = '发现 ' + groups.length + ' 组重复，共 ' + total + ' 条记录';
    box.innerHTML = groups.map(function (g, gi) {
      var rows = g.items.map(function (a) {
        return '<div class="dupe-item"><div><div class="di-name">' + esc(a.name || a.fileName) + '</div>' +
          '<div class="di-meta">' + fmtDate(a.startTime) + ' · ' + fmtKm(a.distance) + ' km · ' + fmtDur(a.movingTime || a.duration) +
          ' · ' + esc(a.fileName || '') + '</div></div>' +
          '<button class="btn" data-del-id="' + esc(a.id) + '">删除</button></div>';
      }).join('');
      return '<div class="dupe-group"><div class="dupe-head"><span class="dupe-reason">' + esc(g.reason) + '</span>' +
        '<span class="dupe-count">' + g.items.length + ' 条</span></div>' + rows +
        '<div class="dupe-actions"><button class="btn" data-keep-new="' + gi + '">保留最新</button>' +
        '<button class="btn" data-keep-old="' + gi + '">保留最早</button></div></div>';
    }).join('');
    all('[data-del-id]', box).forEach(function (b) {
      b.addEventListener('click', function () { doDelete(b.getAttribute('data-del-id')); });
    });
    all('[data-keep-new],[data-keep-old]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var gi2 = Number(b.getAttribute('data-keep-new') || b.getAttribute('data-keep-old'));
        var keepNew = b.hasAttribute('data-keep-new');
        var g2 = groups[gi2];
        if (!g2) return;
        var sorted = g2.items.slice().sort(function (a, b2) {
          return new Date(b2.startTime || 0) - new Date(a.startTime || 0);
        });
        var keep = keepNew ? sorted[0] : sorted[sorted.length - 1];
        var removes = g2.items.filter(function (a) { return a.id !== keep.id; });
        Promise.all(removes.map(function (a) { return S.remove(a.id); })).then(function () {
          toast('已保留 ' + (keepNew ? '最新' : '最早') + ' 1 条，删除 ' + removes.length + ' 条索引');
          reload();
        });
      });
    });
  }

  function doDelete(id) {
    if (!id) return;
    if (!window.confirm('从索引中删除这条记录？（不会删除磁盘上的原始文件）')) return;
    S.remove(id).then(function () {
      toast('已从索引删除');
      closeSheet();
      reload();
    });
  }

  /* ---------------- 海报 ---------------- */
  function renderPoster() {
    var years = yearsOf(state.activities);
    var ys = $('posterYearSwitch');
    var cur = state.posterYear || (years[0] || new Date().getFullYear());
    ys.innerHTML = years.length
      ? years.map(function (y) { return '<button data-pyear="' + y + '" class="' + (y === cur ? 'on' : '') + '">' + y + ' 年</button>'; }).join('')
      : '<button class="on">暂无数据</button>';
    all('button', ys).forEach(function (b) {
      b.addEventListener('click', function () {
        state.posterYear = Number(b.getAttribute('data-pyear')) || null;
        renderPoster();
      });
    });
    var box = $('posterPreview');
    if (!state.activities.length) {
      box.innerHTML = '<div class="empty"><div class="empty-ico">🎨</div><h3>生成年度轨迹海报</h3><p>导入 FIT/GPX 后即可生成。</p></div>';
      return;
    }
    var res = St.posterSVG(state.activities, cur);
    box.innerHTML = res.svg;
    state._posterSvg = res.svg;
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  /* ---------------- 设置 ---------------- */
  function renderSettings() {
    var count = state.activities.length;
    var totalBytes = state.activities.reduce(function (s, a) { return s + (Number(a.fileSize) || 0); }, 0);
    var fmtBytes = function (b) {
      if (b > 1024 * 1024 * 1024) return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
      if (b > 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
      if (b > 1024) return (b / 1024).toFixed(1) + ' KB';
      return b + ' B';
    };
    var years = yearsOf(state.activities);
    $('storageInfo').innerHTML =
      '<div class="kv-row"><span>索引记录</span><b>' + count + ' 条</b></div>' +
      '<div class="kv-row"><span>原始文件总大小</span><b>' + fmtBytes(totalBytes) + '</b></div>' +
      '<div class="kv-row"><span>覆盖年份</span><b>' + (years.length ? years[years.length - 1] + ' ~ ' + years[0] : '—') + '</b></div>' +
      '<div class="kv-row"><span>存储方式</span><b>' + (S.isMemoryOnly() ? '内存（IndexedDB 不可用）' : 'IndexedDB 本地') + '</b></div>';
    var g = loadGoals();
    if (!$('goalDistInput').value) $('goalDistInput').value = g.distanceKm;
    if (!$('goalCountInput').value) $('goalCountInput').value = g.count;
  }

  /* ---------------- 详情 ---------------- */
  function openDetail(id) {
    var a = state.activities.filter(function (x) { return x.id === id; })[0];
    if (!a) return;
    state.selected = a;
    $('sheetTitle').textContent = a.name || a.fileName;
    $('sheetSub').textContent = (a.sportLabel || '运动') + ' · ' + fmtDate(a.startTime) + ' · ' + (a.format || '').toUpperCase();
    var detail = [
      ['距离', fmtKm(a.distance) + ' km'],
      ['时长', fmtDur(a.movingTime || a.duration)],
      ['爬升', Math.round(a.ascent || 0) + ' m'],
      ['下降', Math.round(a.descent || 0) + ' m'],
      ['均速', fmtSpeed(a.avgSpeed)],
      ['最高速度', fmtSpeed(a.maxSpeed)],
      ['平均心率', a.avgHr ? Math.round(a.avgHr) + ' bpm' : '—'],
      ['最大心率', a.maxHr ? Math.round(a.maxHr) + ' bpm' : '—'],
      ['平均功率', a.avgPower ? Math.round(a.avgPower) + ' W' : '—'],
      ['最大功率', a.maxPower ? Math.round(a.maxPower) + ' W' : '—'],
      ['消耗', a.calories ? Math.round(a.calories) + ' kcal' : '—'],
      ['轨迹点', (a.pointCount || (a.points || []).length) + ' 个']
    ];
    var statsHtml = '<div class="detail-stats">' + detail.map(function (x) {
      return '<div class="detail-stat"><div class="k">' + x[0] + '</div><div class="v">' + esc(x[1]) + '</div></div>';
    }).join('') + '</div>';
    var mapHtml = '';
    if (a.points && a.points.length > 1) {
      mapHtml = '<div class="detail-map">' + trackSvg(a.points, 700, 380) + '</div>';
    }
    var kv = [
      ['文件名', a.fileName], ['相对路径', a.relPath || '—'], ['文件大小', a.fileSize ? (a.fileSize / 1024).toFixed(1) + ' KB' : '—'],
      ['文件哈希', a.hash ? a.hash.slice(0, 24) + '…' : '—'], ['活动指纹', a.fingerprint || '—'],
      ['设备', a.device || '—'], ['导入时间', fmtDate(a.importedAt)]
    ];
    var kvHtml = '<div class="detail-kv">' + kv.map(function (x) {
      return '<div class="r"><span>' + x[0] + '</span><b>' + esc(x[1] || '—') + '</b></div>';
    }).join('') + '</div>';
    $('sheetBody').innerHTML = statsHtml + mapHtml + kvHtml;
    $('sheetMask').hidden = false;
  }
  function closeSheet() { $('sheetMask').hidden = true; state.selected = null; }

  function trackSvg(points, w, h) {
    var minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    points.forEach(function (p) {
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') return;
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    });
    if (!isFinite(minLat)) return '';
    var pad = 16;
    var bw = w - pad * 2, bh = h - pad * 2;
    var d = points.map(function (p, i) {
      var x = (maxLon - minLon) > 0 ? (p.lon - minLon) / (maxLon - minLon) : 0.5;
      var y = (maxLat - minLat) > 0 ? (maxLat - p.lat) / (maxLat - minLat) : 0.5;
      return (i === 0 ? 'M' : 'L') + (pad + x * bw).toFixed(1) + ' ' + (pad + y * bh).toFixed(1);
    }).join(' ');
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg">' +
      '<rect width="' + w + '" height="' + h + '" rx="10" fill="#141416"/>' +
      '<path d="' + d + '" fill="none" stroke="#FC4C02" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>' +
      '<circle cx="' + (pad + ((maxLon - minLon) > 0 ? (points[0].lon - minLon) / (maxLon - minLon) : 0.5) * bw).toFixed(1) + '" cy="' +
      (pad + ((maxLat - minLat) > 0 ? (maxLat - points[0].lat) / (maxLat - minLat) : 0.5) * bh).toFixed(1) + '" r="4" fill="#30d158"/></svg>';
  }

  /* ---------------- 导入 ---------------- */
  function setProgress(done, total, name) {
    $('progressWrap').hidden = false;
    $('progressBar').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    $('progressText').textContent = '正在解析 ' + done + ' / ' + total + ' · ' + (name || '');
  }

  function ingest(files) {
    if (state.importing) { toast('正在导入，请稍候…'); return; }
    if (!files || !files.length) return;
    state.importing = true;
    $('progressWrap').hidden = false;
    setProgress(0, files.length, '');
    S.ingestFiles(files, function (done, total, name) {
      setProgress(done, total, name);
    }, state.activities).then(function (rep) {
      state.importing = false;
      $('progressWrap').hidden = true;
      var msg = '导入完成：新增 ' + rep.added + ' 条';
      if (rep.duplicates) msg += ' · 重复跳过 ' + rep.duplicates;
      if (rep.failed) msg += ' · 失败 ' + rep.failed;
      if (rep.skipped && !rep.duplicates) msg += ' · 忽略 ' + rep.skipped;
      toast(msg, 4200);
      if (rep.errors && rep.errors.length) console.warn('导入失败明细：', rep.errors);
      reload().then(function () { switchView('records'); });
    }).catch(function (e) {
      state.importing = false;
      $('progressWrap').hidden = true;
      toast('导入失败：' + (e && e.message ? e.message : e), 4000);
    });
  }

  function walkEntry(entry, out) {
    return new Promise(function (resolve) {
      if (!entry) return resolve();
      if (entry.isFile) {
        entry.file(function (f) {
          out.push(f);
          resolve();
        }, function () { resolve(); });
      } else if (entry.isDirectory) {
        var reader = entry.createReader();
        var allEntries = [];
        var read = function () {
          reader.readEntries(function (entries) {
            if (!entries.length) {
              Promise.all(allEntries.map(function (e2) { return walkEntry(e2, out); })).then(resolve);
            } else {
              allEntries = allEntries.concat(Array.prototype.slice.call(entries));
              read();
            }
          }, function () { resolve(); });
        };
        read();
      } else resolve();
    });
  }

  /* ---------------- 视图切换 ---------------- */
  function switchView(v) {
    state.view = v;
    all('#tabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-view') === v); });
    all('.view').forEach(function (s) { s.classList.toggle('on', s.id === 'view-' + v); });
    if (v === 'stats') renderStats();
    if (v === 'dupes') renderDupes();
    if (v === 'poster') renderPoster();
    if (v === 'settings') renderSettings();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    all('#tabs button').forEach(function (b) {
      b.addEventListener('click', function () { switchView(b.getAttribute('data-view')); });
    });
    $('btnQuickImport').addEventListener('click', function () { $('folderInput').click(); });
    $('btnEmptyImport').addEventListener('click', function () { $('folderInput').click(); });
    $('btnPickFolder').addEventListener('click', function () { $('folderInput').click(); });
    $('btnPickFiles').addEventListener('click', function () { $('fileInput').click(); });
    $('folderInput').addEventListener('change', function (e) {
      ingest(e.target.files);
      e.target.value = '';
    });
    $('fileInput').addEventListener('change', function (e) {
      ingest(e.target.files);
      e.target.value = '';
    });
    $('searchInput').addEventListener('input', function (e) {
      state.keyword = e.target.value;
      renderRecords();
    });
    $('btnClearSearch').addEventListener('click', function () {
      state.keyword = '';
      $('searchInput').value = '';
      renderRecords();
    });
    $('yearFilter').addEventListener('change', function (e) {
      state.year = e.target.value;
      renderRecords();
    });
    $('sortSelect').addEventListener('change', function (e) {
      state.sort = e.target.value;
      renderRecords();
    });
    all('#sportChips button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.sport = b.getAttribute('data-sport');
        all('#sportChips button').forEach(function (x) { x.classList.toggle('on', x === b); });
        renderRecords();
      });
    });
    $('sheetClose').addEventListener('click', closeSheet);
    $('sheetMask').addEventListener('click', function (e) { if (e.target === $('sheetMask')) closeSheet(); });
    $('btnDeleteRecord').addEventListener('click', function () {
      if (state.selected) doDelete(state.selected.id);
    });
    $('btnDownloadPoster').addEventListener('click', function () {
      var svg = state._posterSvg;
      if (!svg) { toast('请先导入数据'); return; }
      var year = state.posterYear || '全部';
      download('迈向Ob管理器-年度海报-' + year + '.svg', svg, 'image/svg+xml');
      toast('海报已下载（SVG，可用浏览器/编辑器转 PNG）');
    });
    $('btnExportJson').addEventListener('click', function () {
      S.exportJSON().then(function (json) {
        download('marching-ob-index-' + new Date().toISOString().slice(0, 10) + '.json', json, 'application/json');
        toast('索引 JSON 已导出');
      });
    });
    $('btnImportJson').addEventListener('click', function () { $('jsonInput').click(); });
    $('jsonInput').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      f.text().then(function (t) {
        return S.importJSON(t);
      }).then(function (n) {
        toast('导入 ' + n + ' 条索引');
        reload();
      }).catch(function (err) { toast('导入 JSON 失败：' + err.message, 4000); });
      e.target.value = '';
    });
    $('btnClearAll').addEventListener('click', function () {
      if (!window.confirm('确定清空全部索引？此操作只删除本地索引，不会删除磁盘文件。')) return;
      S.clearAll().then(function () {
        toast('索引已清空');
        state.statsYear = null; state.posterYear = null;
        reload();
      });
    });
    $('goalDistInput').addEventListener('change', function () {
      var g = loadGoals(); g.distanceKm = Math.max(0, Number($('goalDistInput').value) || 0); saveGoals(g); renderStats();
    });
    $('goalCountInput').addEventListener('change', function () {
      var g = loadGoals(); g.count = Math.max(0, Number($('goalCountInput').value) || 0); saveGoals(g); renderStats();
    });
    // 拖拽导入
    var dz = $('dropzone');
    ['dragenter', 'dragover'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        e.preventDefault();
        $('dropHint').hidden = false;
        dz.classList.add('drag');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === 'dragleave' && e.relatedTarget) return;
        $('dropHint').hidden = true;
        dz.classList.remove('drag');
      });
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      $('dropHint').hidden = true;
      dz.classList.remove('drag');
      var dt = e.dataTransfer;
      if (!dt) return;
      var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
      var entries = items.map(function (it) { return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; }).filter(Boolean);
      if (entries.length) {
        var out = [];
        Promise.all(entries.map(function (en) { return walkEntry(en, out); })).then(function () {
          ingest(out);
        });
      } else if (dt.files && dt.files.length) {
        ingest(dt.files);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSheet();
    });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    $('verLabel').textContent = 'v1.0.0';
    bind();
    S.openDB().then(function () {
      return reload();
    }).then(function () {
      console.log('[迈向Ob管理器] 就绪，索引', state.activities.length, '条');
    }).catch(function (e) {
      console.error('初始化失败', e);
      toast('初始化失败：' + (e && e.message ? e.message : e), 5000);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.ObApp = { state: state, reload: reload, ingest: ingest };
})();
