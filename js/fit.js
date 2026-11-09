/*!
 * 迈向Ob管理器 - FIT 文件解析器（纯前端、无依赖）
 * 参考 FIT SDK 协议实现：文件头 / Definition / Data / Compressed-Timestamp 四类记录。
 * 输出：活动摘要（时间、距离、时长、爬升、均速、心率、功率、轨迹点等）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FitParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FIT_EPOCH = 631065600;            // 1989-12-31T00:00:00Z
  var SEMICIRCLE = 11930465;            // 2^31 / 180
  var BASE_SIZE = {
    0x00: 1, 0x01: 1, 0x02: 1,
    0x83: 2, 0x84: 2,
    0x85: 4, 0x86: 4,
    0x07: 1,
    0x88: 4, 0x89: 8,
    0x0A: 1, 0x8B: 2, 0x8C: 4,
    0x0D: 1,
    0x8E: 8, 0x8F: 8, 0x90: 8
  };
  var SPORT_MAP = {
    0: ['other', '运动'], 1: ['run', '跑步'], 2: ['ride', '骑行'], 3: ['other', '转换'],
    4: ['other', '健身器械'], 5: ['swim', '游泳'], 6: ['other', '篮球'], 7: ['other', '足球'],
    8: ['other', '网球'], 9: ['other', '橄榄球'], 10: ['other', '训练'], 11: ['walk', '步行'],
    12: ['ski', '越野滑雪'], 13: ['ski', '高山滑雪'], 14: ['ski', '单板滑雪'], 15: ['row', '划船'],
    16: ['hike', '登山'], 17: ['hike', '徒步'], 18: ['other', '多项运动'], 19: ['other', '划桨'],
    20: ['other', '飞行'], 21: ['ride', '电助力骑行'], 22: ['other', '摩托'], 23: ['other', '划船'],
    24: ['other', '驾驶'], 25: ['other', '高尔夫'], 26: ['other', '滑翔'], 27: ['other', '马术'],
    28: ['other', '狩猎'], 29: ['other', '钓鱼'], 30: ['other', '轮滑'], 31: ['other', '攀岩'],
    32: ['other', '帆船'], 33: ['other', '滑冰'], 34: ['other', '跳伞'], 35: ['hike', '雪鞋'],
    36: ['other', '雪地摩托'], 37: ['other', '桨板'], 38: ['other', '冲浪'], 39: ['other', '尾波'],
    40: ['other', '滑水'], 41: ['other', '皮划艇'], 42: ['other', '漂流'], 43: ['other', '帆板'],
    44: ['other', '风筝冲浪'], 45: ['other', '战术'], 46: ['other', '跳伞'], 47: ['other', '拳击'],
    48: ['other', '攀岩'], 49: ['other', '棒球'], 53: ['other', '潜水'], 62: ['other', 'HIIT'],
    64: ['other', '球拍运动'], 65: ['other', '壁球'], 66: ['other', '举重'], 67: ['other', '瑜伽']
  };
  var SUB_SPORT_LABEL = {
    1: { 1: '跑步机', 2: '公路跑', 3: '越野跑', 4: '场地跑' },
    2: { 6: '公路骑行', 7: '山地骑行', 8: '速降', 9: '躺车', 10: '公路越野', 11: '手摇车', 12: '场地骑行', 13: '室内骑行', 14: '电助力骑行', 15: 'BMX', 16: '碎石路骑行' },
    11: {}, 17: { 1: '徒步', 2: '登山' }, 5: { 1: '泳池', 2: '公开水域' }
  };

  function garminDate(v) {
    if (v === undefined || v === null) return null;
    return new Date((v + FIT_EPOCH) * 1000);
  }

  function readValue(dv, off, size, btype, le) {
    var base = BASE_SIZE[btype];
    if (!base) {
      // 未知基础类型：跳过字节
      return { value: null, next: off + size };
    }
    if (btype === 0x07) { // string：读取 [off, off+size) 内的 NUL 终止字符串
      var start = off;
      var limit = off + size;
      while (off < limit && dv.getUint8(off) !== 0) off++;
      var bytes = [];
      for (var bi = start; bi < off; bi++) bytes.push(dv.getUint8(bi));
      var str = '';
      try {
        str = decodeURIComponent(escape(String.fromCharCode.apply(null, bytes)));
      } catch (e) {
        str = String.fromCharCode.apply(null, bytes);
      }
      return { value: str, next: limit };
    }
    if (size > base) { // 数组
      var arr = [];
      var n = Math.floor(size / base);
      for (var i = 0; i < n; i++) {
        arr.push(readScalar(dv, off + i * base, base, le));
      }
      return { value: arr, next: off + size };
    }
    return { value: readScalar(dv, off, base, le), next: off + size };
  }

  function readScalar(dv, off, base, le) {
    switch (base) {
      case 1: return dv.getUint8(off);
      case 2: return le ? dv.getUint16(off, true) : dv.getUint16(off, false);
      case 4: return le ? dv.getUint32(off, true) : dv.getUint32(off, false);
      case 8: return le ? Number(dv.getBigUint64(off, true)) : Number(dv.getBigUint64(off, false));
      default: return null;
    }
  }

  // 有符号类型（按 base type 单独处理）
  function readFieldSigned(dv, off, size, btype, le) {
    switch (btype) {
      case 0x01: return dv.getInt8(off);
      case 0x83: return le ? dv.getInt16(off, true) : dv.getInt16(off, false);
      case 0x85: return le ? dv.getInt32(off, true) : dv.getInt32(off, false);
      case 0x8E: return le ? Number(dv.getBigInt64(off, true)) : Number(dv.getBigInt64(off, false));
      case 0x88: return le ? dv.getFloat32(off, true) : dv.getFloat32(off, false);
      case 0x89: return le ? dv.getFloat64(off, true) : dv.getFloat64(off, false);
      default: return null;
    }
  }

  function parse(fileLike) {
    var buf;
    if (fileLike instanceof ArrayBuffer) buf = fileLike;
    else if (fileLike && fileLike.buffer) buf = fileLike.buffer;
    else throw new Error('FIT: 需要 ArrayBuffer');
    if (buf.byteLength < 12) throw new Error('FIT: 文件过小');
    var dv = new DataView(buf);
    var u8 = new Uint8Array(buf);
    var headerSize = u8[0];
    if (headerSize !== 12 && headerSize !== 14) throw new Error('FIT: 文件头无效');
    var magic = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]);
    if (magic !== '.FIT') throw new Error('FIT: 魔数不是 .FIT');
    var dataSize = dv.getUint32(4, true);
    var off = headerSize;
    var end = Math.min(buf.byteLength, off + dataSize);
    if (end <= off) throw new Error('FIT: 数据区为空');

    var defs = {};
    var lastTs = null;
    var messages = { file_id: null, session: [], lap: [], record: [], activity: null, event: [] };

    function readDataMessage(localId, overrideTs) {
      var def = defs[localId];
      if (!def) return false;
      var obj = {};
      var isLe = def.arch === 0;
      for (var i = 0; i < def.fields.length; i++) {
        var fd = def.fields[i];
        if (off + fd.size > end) return false;
        var size = fd.size;
        var signed = (fd.btype === 0x01 || fd.btype === 0x83 || fd.btype === 0x85 || fd.btype === 0x8E || fd.btype === 0x88 || fd.btype === 0x89);
        var v;
        if (!signed && (fd.btype === 0x07 || size > (BASE_SIZE[fd.btype] || 1))) {
          v = readValue(dv, off, size, fd.btype, isLe).value;
          if (v === null) { off += size; continue; }
          off += size;
        } else if (signed) {
          v = readFieldSigned(dv, off, size, fd.btype, isLe);
          if (v === null) { off += size; continue; }
          off += size;
        } else {
          v = readScalar(dv, off, BASE_SIZE[fd.btype], isLe);
          if (v === null) { off += size; continue; }
          off += size;
        }
        obj[fd.num] = v;
      }
      if (overrideTs !== null && overrideTs !== undefined) obj[253] = overrideTs;
      if (obj[253] !== undefined && obj[253] !== null) lastTs = obj[253];
      var g = def.global;
      if (g === 0) messages.file_id = obj;
      else if (g === 18) messages.session.push(obj);
      else if (g === 19) messages.lap.push(obj);
      else if (g === 20) messages.record.push(obj);
      else if (g === 34) messages.activity = obj;
      else if (g === 21) messages.event.push(obj);
      return true;
    }

    while (off < end) {
      try {
      var b = u8[off++];
      if (b & 0x80) { // compressed timestamp
        var localC = (b >> 5) & 0x03;
        var offset = b & 0x1F;
        var ts = (lastTs === null) ? offset : ((lastTs & ~0x1F) | offset);
        lastTs = ts;
        if (!readDataMessage(localC, ts)) break;
      } else if (b & 0x40) { // definition
        var local = b & 0x0F;
        off++; // reserved
        var arch = u8[off++];
        var global = (arch === 0) ? dv.getUint16(off, true) : dv.getUint16(off, false);
        off += 2;
        var nf = u8[off++];
        var fields = [];
        for (var k = 0; k < nf; k++) {
          var fnum = u8[off++];
          var fsize = u8[off++];
          var btype = u8[off++];
          fields.push({ num: fnum, size: fsize, btype: btype });
        }
        defs[local] = { arch: arch, global: global, fields: fields };
      } else { // data
        var lid = b & 0x0F;
        if (!readDataMessage(lid, null)) break;
      }
      } catch (e) { break; }
    }

    return buildActivity(messages);
  }

  function buildActivity(m) {
    var s = m.session && m.session.length ? m.session[m.session.length - 1] : null;
    var fid = m.file_id || {};
    var recs = m.record || [];
    var laps = m.lap || [];
    var acts = m.activity || {};

    var sessionStart = garminDate(pick(s, 2));
    var fileCreated = garminDate(pick(fid, 4));
    var firstRecTs = recs.length ? garminDate(pick(recs[0], 253)) : null;
    var lastRecTs = recs.length ? garminDate(pick(recs[recs.length - 1], 253)) : null;
    var startTime = sessionStart || fileCreated || firstRecTs || null;

    var sportEnum = pick(s, 5);
    var subSport = pick(s, 6);
    var sportInfo = SPORT_MAP[sportEnum] || (sportEnum === undefined ? ['other', '运动'] : ['other', '运动-' + sportEnum]);
    var sport = sportInfo[0], sportLabel = sportInfo[1];
    if (subSport !== undefined && SUB_SPORT_LABEL[sportEnum] && SUB_SPORT_LABEL[sportEnum][subSport]) {
      sportLabel = SUB_SPORT_LABEL[sportEnum][subSport];
    }

    var distance = num(pick(s, 9), 0) / 100;
    var duration = num(pick(s, 7), 0) / 1000;
    var moving = num(pick(s, 8), 0) / 1000;
    var ascent = num(pick(s, 22), 0);
    var descent = num(pick(s, 23), 0);
    var avgSpeed = num(pick(s, 14), 0) / 1000;
    var maxSpeed = num(pick(s, 15), 0) / 1000;
    var avgHr = num(pick(s, 16), null);
    var maxHr = num(pick(s, 17), null);
    var avgCadence = num(pick(s, 18), null);
    var avgPower = num(pick(s, 20), null);
    var maxPower = num(pick(s, 21), null);
    var calories = num(pick(s, 11), null);
    var name = pick(s, 110) || '';
    var lapCount = num(pick(s, 26), null);

    // 轨迹点
    var points = [];
    var ascentCalc = 0, descentCalc = 0;
    var prevAlt = null;
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i];
      var latRaw = pick(r, 0), lonRaw = pick(r, 1);
      var lat = (latRaw !== undefined && latRaw !== null) ? latRaw / SEMICIRCLE : null;
      var lon = (lonRaw !== undefined && lonRaw !== null) ? lonRaw / SEMICIRCLE : null;
      var altRaw = pick(r, 2);
      var alt = (altRaw !== undefined && altRaw !== null) ? altRaw / 5 - 500 : null;
      if (alt === null) {
        var eAlt = pick(r, 78);
        if (eAlt !== undefined && eAlt !== null) alt = eAlt / 5 - 500;
      }
      var t = garminDate(pick(r, 253));
      if (lat !== null && lon !== null) {
        points.push({
          lat: lat, lon: lon, ele: alt,
          t: t ? t.getTime() : null,
          hr: pick(r, 3), cad: pick(r, 4), power: pick(r, 7)
        });
        if (alt !== null) {
          if (prevAlt !== null) {
            var d = alt - prevAlt;
            if (d > 0.5) ascentCalc += d;
            else if (d < -0.5) descentCalc -= d;
          }
          prevAlt = alt;
        }
      }
    }

    // 无 session 时兜底
    if (!s) {
      if (recs.length) {
        var r0 = recs[0], rN = recs[recs.length - 1];
        distance = num(pick(rN, 5), 0) / 100;
        var t0 = pick(r0, 253), t1 = pick(rN, 253);
        if (t0 && t1) {
          duration = (t1 - t0);
          moving = duration;
        }
        ascent = ascentCalc; descent = descentCalc;
        avgSpeed = duration > 0 ? distance / duration : 0;
      }
    }
    if (ascent === 0 && ascentCalc > 0) ascent = ascentCalc;
    if (descent === 0 && descentCalc > 0) descent = descentCalc;
    if ((!startTime) && points.length && points[0].t) startTime = new Date(points[0].t);
    if ((!duration || duration <= 0) && acts[0]) duration = num(pick(acts, 0), 0) / 1000;
    if (!avgSpeed && duration > 0) avgSpeed = distance / duration;
    if (laps.length && (!ascent || !descent)) {
      var a = 0, d2 = 0;
      for (var j = 0; j < laps.length; j++) { a += num(pick(laps[j], 21), 0); d2 += num(pick(laps[j], 22), 0); }
      if (!ascent) ascent = a;
      if (!descent) descent = d2;
    }

    return {
      format: 'fit',
      startTime: startTime,
      distance: distance,
      duration: duration,
      movingTime: moving || duration,
      ascent: ascent,
      descent: descent,
      avgSpeed: avgSpeed,
      maxSpeed: maxSpeed,
      avgHr: avgHr, maxHr: maxHr,
      avgCadence: avgCadence,
      avgPower: avgPower, maxPower: maxPower,
      calories: calories,
      name: name,
      sport: sport, sportLabel: sportLabel,
      subSport: subSport,
      lapCount: lapCount,
      points: points,
      pointCount: recs.length,
      device: fid ? (fid[3] !== undefined ? String(fid[3]) : '') : ''
    };
  }

  function pick(obj, n) {
    if (!obj) return undefined;
    var v = obj[n];
    return (v === undefined || v === null) ? undefined : v;
  }
  function num(v, def) {
    return (typeof v === 'number' && isFinite(v)) ? v : def;
  }

  return { parse: parse, parseFit: parse, version: '1.0.0', SPORT_MAP: SPORT_MAP };
});
