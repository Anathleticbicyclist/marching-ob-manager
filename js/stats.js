/*!
 * 迈向Ob管理器 - 统计引擎
 * 生涯统计 / 年度统计 / 日历热力图 / 月度分布 / 个人最佳 / 去重分组 / 年度海报 SVG
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ObStats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function toDate(a) {
    if (!a) return null;
    if (a instanceof Date) return a;
    var d = new Date(a);
    return isNaN(d.getTime()) ? null : d;
  }

  function dayKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function activityYear(a) {
    var d = toDate(a.startTime);
    return d ? d.getFullYear() : null;
  }

  // 过滤：年份（null=全部）、运动类型（'all'|sport）
  function filterActivities(activities, opts) {
    opts = opts || {};
    var year = opts.year || null;
    var sport = opts.sport || 'all';
    var q = (opts.keyword || '').trim().toLowerCase();
    return (activities || []).filter(function (a) {
      if (year !== null) {
        var y = activityYear(a);
        if (y !== year) return false;
      }
      if (sport !== 'all' && a.sport !== sport) return false;
      if (q) {
        var hay = [a.name, a.fileName, a.sportLabel, a.format, a.device, a.note].join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function sum(list, key) {
    var s = 0;
    for (var i = 0; i < list.length; i++) s += (Number(list[i][key]) || 0);
    return s;
  }

  function totals(list) {
    var dist = sum(list, 'distance');
    var moving = 0;
    for (var i = 0; i < list.length; i++) moving += (Number(list[i].movingTime) || Number(list[i].duration) || 0);
    var activeDays = {};
    for (var j = 0; j < list.length; j++) {
      var d = toDate(list[j].startTime);
      if (d) activeDays[dayKey(d)] = true;
    }
    return {
      count: list.length,
      distance: dist,
      elevation: sum(list, 'ascent'),
      movingTime: moving,
      avgSpeed: moving > 0 ? dist / moving : 0,
      activeDays: Object.keys(activeDays).length
    };
  }

  function career(activities) {
    var list = activities || [];
    var t = totals(list);
    var longest = null, maxClimb = null, fastest = null, longestTime = null;
    var maxHrAct = null, maxPowerAct = null, longestDay = null;
    var dayDist = {};
    list.forEach(function (a) {
      var d = Number(a.distance) || 0;
      if (!longest || d > (Number(longest.distance) || 0)) longest = a;
      var climb = Number(a.ascent) || 0;
      if (!maxClimb || climb > (Number(maxClimb.ascent) || 0)) maxClimb = a;
      var sp = Number(a.avgSpeed) || 0;
      if (d > 1000 && (!fastest || sp > (Number(fastest.avgSpeed) || 0))) fastest = a;
      var tt = Number(a.movingTime) || Number(a.duration) || 0;
      if (!longestTime || tt > (Number(longestTime.movingTime) || Number(longestTime.duration) || 0)) longestTime = a;
      if (a.maxHr && (!maxHrAct || Number(a.maxHr) > Number(maxHrAct.maxHr))) maxHrAct = a;
      if (a.maxPower && (!maxPowerAct || Number(a.maxPower) > Number(maxPowerAct.maxPower))) maxPowerAct = a;
      var dd = toDate(a.startTime);
      if (dd) {
        var k = dayKey(dd);
        dayDist[k] = (dayDist[k] || 0) + d;
      }
    });
    var bestDay = null;
    Object.keys(dayDist).forEach(function (k) {
      if (!bestDay || dayDist[k] > bestDay.distance) bestDay = { day: k, distance: dayDist[k] };
    });
    var streak = longestStreak(list);
    var years = {};
    list.forEach(function (a) {
      var y = activityYear(a);
      if (y) years[y] = (years[y] || 0) + (Number(a.distance) || 0);
    });
    var yearList = Object.keys(years).map(function (y) { return { year: Number(y), distance: years[y] }; })
      .sort(function (a, b) { return a.year - b.year; });
    return {
      totals: t,
      longest: longest,
      maxClimb: maxClimb,
      fastest: fastest,
      longestTime: longestTime,
      maxHrAct: maxHrAct,
      maxPowerAct: maxPowerAct,
      bestDay: bestDay,
      streak: streak,
      years: yearList
    };
  }

  function longestStreak(list) {
    var days = {};
    list.forEach(function (a) {
      var d = toDate(a.startTime);
      if (d) days[dayKey(d)] = true;
    });
    var keys = Object.keys(days).sort();
    if (!keys.length) return { days: 0, from: null, to: null };
    var best = 1, bestFrom = keys[0], bestTo = keys[0], cur = 1, curFrom = keys[0];
    for (var i = 1; i < keys.length; i++) {
      var prev = new Date(keys[i - 1] + 'T00:00:00');
      var curD = new Date(keys[i] + 'T00:00:00');
      var diff = Math.round((curD - prev) / 86400000);
      if (diff === 1) {
        cur++;
      } else {
        cur = 1; curFrom = keys[i];
      }
      if (cur > best) { best = cur; bestFrom = curFrom; bestTo = keys[i]; }
    }
    return { days: best, from: bestFrom, to: bestTo };
  }

  // 日历热力图：返回 [周][日] 索引的 daily 映射 + 等级
  function heatmap(activities, year) {
    var list = (activities || []).filter(function (a) {
      if (!year) return true;
      return activityYear(a) === year;
    });
    var byDay = {};
    list.forEach(function (a) {
      var d = toDate(a.startTime);
      if (!d) return;
      var k = dayKey(d);
      if (!byDay[k]) byDay[k] = { distance: 0, count: 0, duration: 0 };
      byDay[k].distance += Number(a.distance) || 0;
      byDay[k].count += 1;
      byDay[k].duration += Number(a.movingTime) || Number(a.duration) || 0;
    });
    var max = 1;
    Object.keys(byDay).forEach(function (k) { if (byDay[k].distance > max) max = byDay[k].distance; });
    // 按自然年构建 53 列 × 7 行（周一为行首，GitHub 风格）
    var yearStart = new Date(year || (new Date()).getFullYear(), 0, 1);
    var startWeekday = (yearStart.getDay() + 6) % 7; // 周一=0
    var grid = []; // [col][row]
    for (var c = 0; c < 54; c++) { grid.push([]); for (var r = 0; r < 7; r++) grid[c].push(null); }
    var d = new Date(yearStart);
    var totalCells = year ? daysInYear(year) : 366;
    for (var i = 0; i < totalCells; i++) {
      var idx = startWeekday + i;
      var col = Math.floor(idx / 7), row = idx % 7;
      if (col >= 54) break;
      var k2 = dayKey(d);
      var v = byDay[k2] || null;
      var level = 0;
      if (v && v.distance > 0) level = Math.min(4, Math.max(1, Math.ceil(v.distance / max * 4)));
      grid[col][row] = { date: k2, value: v ? v.distance : 0, count: v ? v.count : 0, level: level };
      d.setDate(d.getDate() + 1);
    }
    return { grid: grid, byDay: byDay, max: max, totalDistance: totDistance(byDay) };
  }

  function totDistance(byDay) {
    var s = 0; Object.keys(byDay).forEach(function (k) { s += byDay[k].distance; }); return s;
  }
  function daysInYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  }

  function monthly(activities, year) {
    var list = (activities || []).filter(function (a) {
      return !year || activityYear(a) === year;
    });
    var arr = new Array(12);
    for (var i = 0; i < 12; i++) arr[i] = { distance: 0, count: 0, duration: 0, elevation: 0 };
    list.forEach(function (a) {
      var d = toDate(a.startTime);
      if (!d) return;
      var m = d.getMonth();
      arr[m].distance += Number(a.distance) || 0;
      arr[m].count += 1;
      arr[m].duration += Number(a.movingTime) || Number(a.duration) || 0;
      arr[m].elevation += Number(a.ascent) || 0;
    });
    return arr;
  }

  // 个人最佳
  function personalBests(activities) {
    var list = activities || [];
    var defs = [
      { key: '5K', min: 4800, max: 5500, label: '5K' },
      { key: '10K', min: 9500, max: 11000, label: '10K' },
      { key: 'half', min: 20000, max: 22500, label: '半程马拉松' },
      { key: 'full', min: 41000, max: 44000, label: '全程马拉松' }
    ];
    var runs = list.filter(function (a) { return a.sport === 'run'; });
    var bests = defs.map(function (d) {
      var cand = runs.filter(function (a) {
        var km = (Number(a.distance) || 0) / 1000;
        if (km < d.min / 1000 || km > d.max / 1000) return false;
        var time = Number(a.movingTime) || Number(a.duration) || 0;
        if (time <= 0) return false;
        var pace = time / km;
        return pace >= 180 && pace <= 480;
      });
      if (!cand.length) return { key: d.key, label: d.label, activity: null, time: 0 };
      cand.sort(function (x, y) {
        return (Number(x.movingTime) || Number(x.duration)) - (Number(y.movingTime) || Number(y.duration));
      });
      return { key: d.key, label: d.label, activity: cand[0], time: Number(cand[0].movingTime) || Number(cand[0].duration) || 0 };
    });
    var rides = list.filter(function (a) { return a.sport === 'ride'; });
    var longestRide = rides.reduce(function (b, a) { return (!b || (Number(a.distance) || 0) > (Number(b.distance) || 0)) ? a : b; }, null);
    var maxClimb = list.reduce(function (b, a) { return (!b || (Number(a.ascent) || 0) > (Number(b.ascent) || 0)) ? a : b; }, null);
    var fastestRide = rides.reduce(function (b, a) {
      var sp = Number(a.avgSpeed) || 0;
      if ((Number(a.distance) || 0) < 5000) return b;
      return (!b || sp > (Number(b.avgSpeed) || 0)) ? a : b;
    }, null);
    return {
      marathon: bests,
      longestRide: longestRide,
      maxClimb: maxClimb,
      fastestRide: fastestRide
    };
  }

  // 去重：优先精确文件哈希，其次活动指纹（时间+时长+距离）
  function fingerprint(a) {
    var t = toDate(a.startTime);
    var ts = t ? Math.floor(t.getTime() / 1000) : 0;
    var dur = Math.round((Number(a.movingTime) || Number(a.duration) || 0) / 5) * 5;
    var dist = Math.round((Number(a.distance) || 0) / 10) * 10;
    return [a.sport || 'other', ts, dur, dist].join('|');
  }

  function dedupGroups(activities) {
    var list = activities || [];
    var byHash = {}, byFp = {};
    list.forEach(function (a) {
      if (a.hash) {
        (byHash[a.hash] = byHash[a.hash] || []).push(a);
      }
      var fp = fingerprint(a);
      (byFp[fp] = byFp[fp] || []).push(a);
    });
    var groups = [], seen = {};
    function push(listIn, reason) {
      if (listIn.length < 2) return;
      var ids = listIn.map(function (a) { return a.id; }).sort().join(',');
      if (seen[ids]) return;
      seen[ids] = true;
      groups.push({ reason: reason, items: listIn.slice() });
    }
    Object.keys(byHash).forEach(function (h) { push(byHash[h], '文件完全相同'); });
    Object.keys(byFp).forEach(function (fp) { push(byFp[fp], '活动指纹相似'); });
    return groups;
  }

  // 年度海报 SVG（无地图底图，用轨迹线绘制）
  function posterSVG(activities, year, opts) {
    opts = opts || {};
    var W = opts.width || 900, H = opts.height || 1200;
    var pad = 60;
    var list = (activities || []).filter(function (a) {
      return year ? activityYear(a) === year : true;
    });
    var t = totals(list);
    var days = list.length;
    var poly = [];
    var minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    list.forEach(function (a) {
      var pts = a.points || [];
      if (pts.length < 2) return;
      var step = Math.max(1, Math.floor(pts.length / 120));
      var line = [];
      for (var i = 0; i < pts.length; i += step) {
        var p = pts[i];
        if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
        line.push([p.lat, p.lon]);
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
      }
      if (line.length > 1) poly.push(line);
    });
    var bw = W - pad * 2, bh = H - pad * 2 - 260;
    function proj(lat, lon) {
      var x = (maxLon - minLon) > 0 ? (lon - minLon) / (maxLon - minLon) : 0.5;
      var y = (maxLat - minLat) > 0 ? (maxLat - lat) / (maxLat - minLat) : 0.5;
      return [pad + x * bw, pad + y * bh];
    }
    var tracks = '';
    var colors = ['#FC4C02', '#ff7a3d', '#ffb020', '#ff5252', '#ff8f00'];
    poly.forEach(function (line, idx) {
      var d = line.map(function (p, i) {
        var xy = proj(p[0], p[1]);
        return (i === 0 ? 'M' : 'L') + xy[0].toFixed(1) + ' ' + xy[1].toFixed(1);
      }).join(' ');
      tracks += '<path d="' + d + '" fill="none" stroke="' + colors[idx % colors.length] +
        '" stroke-width="1.6" stroke-opacity="0.85" stroke-linecap="round"/>';
    });
    if (!tracks) {
      tracks = '<text x="' + (W / 2) + '" y="' + (H / 2) + '" fill="#636366" font-size="22" text-anchor="middle">没有带轨迹的活动</text>';
    }
    var yearText = year || '生涯';
    var fmt = function (m) { return (m / 1000).toFixed(1); };
    var svg = '';
    svg += '<?xml version="1.0" encoding="UTF-8"?>';
    svg += '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
    svg += '<rect width="100%" height="100%" fill="#0f0f10"/>';
    svg += '<rect x="24" y="24" width="' + (W - 48) + '" height="' + (H - 48) + '" rx="24" fill="#141416" stroke="#2c2c2e"/>';
    svg += '<text x="' + pad + '" y="' + (pad + 10) + '" fill="#FC4C02" font-family="Arial" font-size="34" font-weight="700">迈向Ob管理器 · ' + yearText + ' 年度海报</text>';
    svg += '<text x="' + pad + '" y="' + (pad + 44) + '" fill="#8e8e93" font-family="Arial" font-size="16">本地 FIT / GPX 数据中心</text>';
    svg += '<g transform="translate(' + pad + ', ' + (pad + 60) + ')">' + tracks + '</g>';
    var baseY = H - 200;
    var stats = [
      ['总距离', fmt(t.distance) + ' km'],
      ['活动次数', t.count + ' 次'],
      ['总时长', (t.movingTime / 3600).toFixed(1) + ' h'],
      ['总爬升', Math.round(t.elevation) + ' m']
    ];
    stats.forEach(function (s, i) {
      var x = pad + (i % 2) * (W - pad * 2) / 2;
      var y = baseY + Math.floor(i / 2) * 70;
      svg += '<text x="' + x + '" y="' + y + '" fill="#8e8e93" font-family="Arial" font-size="15">' + s[0] + '</text>';
      svg += '<text x="' + x + '" y="' + (y + 32) + '" fill="#e8e8e8" font-family="Arial" font-size="26" font-weight="700">' + s[1] + '</text>';
    });
    svg += '<text x="' + pad + '" y="' + (H - pad) + '" fill="#48484a" font-family="Arial" font-size="13">Generated by 迈向Ob管理器 · ' + new Date().toISOString().slice(0, 10) + '</text>';
    svg += '</svg>';
    return { svg: svg, tracks: poly.length, count: list.length, totals: t };
  }

  return {
    filterActivities: filterActivities,
    totals: totals,
    career: career,
    heatmap: heatmap,
    monthly: monthly,
    personalBests: personalBests,
    dedupGroups: dedupGroups,
    fingerprint: fingerprint,
    posterSVG: posterSVG,
    dayKey: dayKey,
    version: '1.0.0'
  };
});
