/*!
 * 迈向Ob管理器 - GPX / TCX 解析器（纯前端、无依赖）
 * 用轻量 XML 扫描而非 DOMParser，浏览器与 Node 均可运行。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GpxParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var R = 6371000; // 地球半径 m

  function haversine(lat1, lon1, lat2, lon2) {
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function decodeEntities(s) {
    return String(s || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  }

  function tagText(xml, tag) {
    var m = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i').exec(xml);
    return m ? decodeEntities(m[1].replace(/<[^>]*>/g, '').trim()) : '';
  }

  function sportFromText(text, name) {
    var t = (text || '') + ' ' + (name || '');
    var s = t.toLowerCase();
    if (/cycl|bik|ride|biking|自行车|骑行|bike/.test(s)) return ['ride', '骑行'];
    if (/run|jog|跑/.test(s)) return ['run', '跑步'];
    if (/hike|trek|徒步|登山|hiking/.test(s)) return ['hike', '徒步'];
    if (/walk|步/.test(s)) return ['walk', '步行'];
    if (/swim|泳/.test(s)) return ['swim', '游泳'];
    if (/ski|雪/.test(s)) return ['ski', '滑雪'];
    if (/row|划/.test(s)) return ['row', '划船'];
    return ['other', '运动'];
  }

  function calcStats(points) {
    var dist = 0, ascent = 0, descent = 0, prevAlt = null;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (i > 0) {
        var q = points[i - 1];
        dist += haversine(q.lat, q.lon, p.lat, p.lon);
      }
      if (typeof p.ele === 'number' && isFinite(p.ele)) {
        if (prevAlt !== null) {
          var d = p.ele - prevAlt;
          if (d > 0.2) ascent += d;
          else if (d < -0.2) descent -= d;
        }
        prevAlt = p.ele;
      }
    }
    var t0 = null, t1 = null;
    for (var j = 0; j < points.length; j++) {
      if (points[j].t) { if (t0 === null) t0 = points[j].t; t1 = points[j].t; }
    }
    var duration = (t0 !== null && t1 !== null) ? (t1 - t0) / 1000 : 0;
    return { distance: dist, ascent: ascent, descent: descent, duration: duration, startMs: t0, endMs: t1 };
  }

  function parseTime(s) {
    if (!s) return null;
    var t = Date.parse(s);
    return isNaN(t) ? null : t;
  }

  function parseGPX(text, fileName) {
    var out = {
      format: 'gpx', startTime: null, distance: 0, duration: 0, movingTime: 0,
      ascent: 0, descent: 0, avgSpeed: 0, maxSpeed: 0, avgHr: null, maxHr: null,
      avgCadence: null, avgPower: null, maxPower: null, calories: null,
      name: '', sport: 'other', sportLabel: '运动', subSport: null,
      points: [], pointCount: 0
    };
    var trkName = tagText(text, 'name');
    var trkType = tagText(text, 'type');
    out.name = trkName || baseName(fileName);
    var sportInfo = sportFromText(trkType, out.name + ' ' + (fileName || ''));
    out.sport = sportInfo[0]; out.sportLabel = sportInfo[1];

    var segs = text.split(/<trkseg[\s>]/i);
    var points = [];
    for (var s = 0; s < segs.length; s++) {
      var re = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi, m;
      while ((m = re.exec(segs[s]))) {
        var attrs = m[1], inner = m[2];
        var lat = parseFloat((/lat\s*=\s*["']([^"']+)["']/i.exec(attrs) || [])[1]);
        var lon = parseFloat((/lon\s*=\s*["']([^"']+)["']/i.exec(attrs) || [])[1]);
        if (!isFinite(lat) || !isFinite(lon)) continue;
        var ele = parseFloat(tagText(inner, 'ele'));
        var t = parseTime(tagText(inner, 'time'));
        var hr = parseInt(tagText(inner, 'hr') || tagText(inner, 'heartrate'), 10);
        points.push({ lat: lat, lon: lon, ele: isFinite(ele) ? ele : null, t: t, hr: isFinite(hr) ? hr : null });
      }
    }
    // 轨迹里可能没有 trkseg 包裹（部分简化 GPX）
    if (!points.length) {
      var re2 = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi, m2;
      while ((m2 = re2.exec(text))) {
        var a2 = m2[1], in2 = m2[2];
        var la = parseFloat((/lat\s*=\s*["']([^"']+)["']/i.exec(a2) || [])[1]);
        var lo = parseFloat((/lon\s*=\s*["']([^"']+)["']/i.exec(a2) || [])[1]);
        if (!isFinite(la) || !isFinite(lo)) continue;
        var el2 = parseFloat(tagText(in2, 'ele'));
        var tt2 = parseTime(tagText(in2, 'time'));
        points.push({ lat: la, lon: lo, ele: isFinite(el2) ? el2 : null, t: tt2, hr: null });
      }
    }
    out.points = points;
    out.pointCount = points.length;
    var st = calcStats(points);
    out.distance = st.distance; out.ascent = st.ascent; out.descent = st.descent;
    out.duration = st.duration; out.movingTime = st.duration;
    if (st.startMs) out.startTime = new Date(st.startMs);
    if (out.duration > 0) out.avgSpeed = out.distance / out.duration;
    var hrs = points.filter(function (p) { return typeof p.hr === 'number'; }).map(function (p) { return p.hr; });
    if (hrs.length) {
      out.avgHr = Math.round(hrs.reduce(function (x, y) { return x + y; }, 0) / hrs.length);
      out.maxHr = Math.max.apply(null, hrs);
    }
    out.maxSpeed = maxSpeed(points);
    return out;
  }

  function maxSpeed(points) {
    var best = 0;
    for (var i = 1; i < points.length; i++) {
      var a = points[i - 1], b = points[i];
      if (a.t && b.t && b.t > a.t) {
        var dt = (b.t - a.t) / 1000;
        if (dt > 0 && dt < 60) {
          var v = haversine(a.lat, a.lon, b.lat, b.lon) / dt;
          if (v > best && v < 30) best = v; // 过滤 GPS 漂移
        }
      }
    }
    return best;
  }

  function parseTCX(text, fileName) {
    var out = {
      format: 'tcx', startTime: null, distance: 0, duration: 0, movingTime: 0,
      ascent: 0, descent: 0, avgSpeed: 0, maxSpeed: 0, avgHr: null, maxHr: null,
      avgCadence: null, avgPower: null, maxPower: null, calories: null,
      name: '', sport: 'other', sportLabel: '运动', subSport: null,
      points: [], pointCount: 0
    };
    var sportAttr = (/<Activity\b[^>]*\bSport\s*=\s*["']([^"']+)["']/i.exec(text) || [])[1] || '';
    var sportInfo = sportFromText(sportAttr, baseName(fileName));
    out.sport = sportInfo[0]; out.sportLabel = sportInfo[1];
    out.name = tagText(text, 'Name') || baseName(fileName);

    var points = [];
    var re = /<Trackpoint\b[^>]*>([\s\S]*?)<\/Trackpoint>/gi, m;
    while ((m = re.exec(text))) {
      var inner = m[1];
      var la = parseFloat(tagText(inner, 'LatitudeDegrees'));
      var lo = parseFloat(tagText(inner, 'LongitudeDegrees'));
      var ele = parseFloat(tagText(inner, 'AltitudeMeters'));
      var t = parseTime(tagText(inner, 'Time'));
      var hrBlock = /<HeartRateBpm\b[^>]*>([\s\S]*?)<\/HeartRateBpm>/i.exec(inner);
      var hr = hrBlock ? parseInt(tagText(hrBlock[1], 'Value'), 10) : NaN;
      var dist = parseFloat(tagText(inner, 'DistanceMeters'));
      if (!isFinite(la) || !isFinite(lo)) continue;
      points.push({
        lat: la, lon: lo, ele: isFinite(ele) ? ele : null, t: t,
        hr: isFinite(hr) ? hr : null,
        dist: isFinite(dist) ? dist : null
      });
    }
    var totalDist = parseFloat(tagText(text, 'DistanceMeters'));
    var totalTime = parseFloat(tagText(text, 'TotalTimeSeconds'));
    out.points = points; out.pointCount = points.length;
    var st = calcStats(points);
    out.distance = isFinite(totalDist) && totalDist > 0 ? totalDist : st.distance;
    out.duration = isFinite(totalTime) && totalTime > 0 ? totalTime : st.duration;
    out.movingTime = out.duration;
    out.ascent = st.ascent; out.descent = st.descent;
    if (st.startMs) out.startTime = new Date(st.startMs);
    out.avgSpeed = out.duration > 0 ? out.distance / out.duration : 0;
    var maxSp = parseFloat(tagText(text, 'MaximumSpeed'));
    out.maxSpeed = isFinite(maxSp) ? maxSp : maxSpeed(points);
    var avgHr = parseFloat(tagText(text, 'AverageHeartRateBpm')); // 结构上还有 Value 子标签
    var avgHrBlock = /<AverageHeartRateBpm\b[^>]*>([\s\S]*?)<\/AverageHeartRateBpm>/i.exec(text);
    if (avgHrBlock) { avgHr = parseFloat(tagText(avgHrBlock[1], 'Value')); }
    var maxHrBlock = /<MaximumHeartRateBpm\b[^>]*>([\s\S]*?)<\/MaximumHeartRateBpm>/i.exec(text);
    if (maxHrBlock) { out.maxHr = parseInt(tagText(maxHrBlock[1], 'Value'), 10); }
    if (isFinite(avgHr)) out.avgHr = Math.round(avgHr);
    if (!out.avgHr) {
      var hrs = points.filter(function (p) { return typeof p.hr === 'number'; }).map(function (p) { return p.hr; });
      if (hrs.length) out.avgHr = Math.round(hrs.reduce(function (x, y) { return x + y; }, 0) / hrs.length);
      if (hrs.length && !out.maxHr) out.maxHr = Math.max.apply(null, hrs);
    }
    var cal = parseFloat(tagText(text, 'Calories'));
    if (isFinite(cal)) out.calories = cal;
    var cad = parseFloat(tagText(text, 'Cadence'));
    if (isFinite(cad)) out.avgCadence = cad;
    return out;
  }

  function baseName(fileName) {
    if (!fileName) return '未命名活动';
    var s = String(fileName).replace(/\\/g, '/').split('/').pop();
    return s.replace(/\.(fit|gpx|tcx)$/i, '');
  }

  return {
    parseGPX: parseGPX,
    parseTCX: parseTCX,
    parseGpx: parseGPX,
    haversine: haversine,
    calcStats: calcStats,
    baseName: baseName,
    version: '1.0.0'
  };
});
