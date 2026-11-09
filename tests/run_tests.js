#!/usr/bin/env node
/* 迈向Ob管理器 - 解析器与统计引擎冒烟测试 */
const fs = require('fs');
const path = require('path');
const Fit = require('../js/fit.js');
const Gpx = require('../js/gpx.js');
const Stats = require('../js/stats.js');

const samples = path.join(__dirname, 'samples');
let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg + (extra ? ' :: ' + extra : '')); }
}

function norm(parsed, fileName, format) {
  const start = parsed.startTime instanceof Date ? parsed.startTime : new Date(parsed.startTime);
  const a = {
    id: fileName, hash: fileName, fileName: fileName, format: format,
    name: parsed.name || fileName, sport: parsed.sport, sportLabel: parsed.sportLabel,
    startTime: start.toISOString(), year: start.getFullYear(),
    distance: parsed.distance || 0, duration: parsed.duration || 0,
    movingTime: parsed.movingTime || parsed.duration || 0,
    ascent: parsed.ascent || 0, descent: parsed.descent || 0,
    avgSpeed: parsed.avgSpeed || 0, maxSpeed: parsed.maxSpeed || 0,
    avgHr: parsed.avgHr, maxHr: parsed.maxHr, points: parsed.points || []
  };
  a.fingerprint = Stats.fingerprint(a);
  return a;
}

console.log('== FIT 解析 ==');
const fitBuf = fs.readFileSync(path.join(samples, 'sample_ride.fit'));
const fit = Fit.parse(fitBuf.buffer.slice(fitBuf.byteOffset, fitBuf.byteOffset + fitBuf.byteLength));
console.log(JSON.stringify({ start: fit.startTime, sport: fit.sport, distance: fit.distance, duration: fit.duration, ascent: fit.ascent, points: fit.pointCount, name: fit.name }, null, 2));
ok(fit.format === 'fit', '格式识别为 fit');
ok(fit.startTime && fit.startTime.getUTCFullYear() === 2026 && fit.startTime.getUTCMonth() === 4, '开始时间 2026-05');
ok(Math.abs(fit.distance - 9000) < 200, '距离约 9km', 'got ' + fit.distance);
ok(fit.duration > 1000, '时长 > 1000s', 'got ' + fit.duration);
ok(fit.ascent > 5, '有累计爬升', 'got ' + fit.ascent);
ok(fit.pointCount >= 100, '轨迹点数量', 'got ' + fit.pointCount);
ok(fit.sport === 'ride', '运动类型 ride', 'got ' + fit.sport);
ok((fit.name || '').indexOf('样例骑行') === 0, '读取活动名称', 'got ' + fit.name);

console.log('== GPX 解析 ==');
const gpxText = fs.readFileSync(path.join(samples, 'sample_hike.gpx'), 'utf8');
const gpx = Gpx.parseGPX(gpxText, 'sample_hike.gpx');
ok(gpx.format === 'gpx', '格式识别为 gpx');
ok(gpx.distance > 1000, '距离 > 1km', 'got ' + gpx.distance);
ok(gpx.duration > 100, '时长 > 100s', 'got ' + gpx.duration);
ok(gpx.ascent > 1, '有爬升', 'got ' + gpx.ascent);
ok(gpx.sport === 'hike', '运动类型 hike', 'got ' + gpx.sport);
ok(gpx.startTime && gpx.startTime.getUTCFullYear() === 2026, '开始时间年份');

console.log('== TCX 解析 ==');
const tcxText = fs.readFileSync(path.join(samples, 'sample_run.tcx'), 'utf8');
const tcx = Gpx.parseTCX(tcxText, 'sample_run.tcx');
ok(tcx.format === 'tcx', '格式识别为 tcx');
ok(tcx.distance > 500, '距离 > 500m', 'got ' + tcx.distance);
ok(tcx.duration > 100, '时长 > 100s', 'got ' + tcx.duration);
ok(tcx.sport === 'run', '运动类型 run', 'got ' + tcx.sport);
ok(Math.abs((tcx.avgHr || 0) - 142) < 5, '平均心率 ≈142', 'got ' + tcx.avgHr);

console.log('== 统计引擎 ==');
const acts = [];
['sample_ride.fit', 'sample_hike.gpx', 'sample_run.tcx'].forEach(f => {
  const b = fs.readFileSync(path.join(samples, f));
  let p;
  if (f.endsWith('.fit')) p = Fit.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  else if (f.endsWith('.gpx')) p = Gpx.parseGPX(b.toString('utf8'), f);
  else p = Gpx.parseTCX(b.toString('utf8'), f);
  acts.push(norm(p, f, f.split('.').pop()));
});
// 补一些演示活动
for (let i = 0; i < 20; i++) {
  acts.push(Object.assign({}, acts[i % 3], {
    id: 'demo-' + i, hash: 'demo-hash-' + i, fileName: 'demo-' + i + '.fit',
    startTime: new Date(2024 + (i % 3), i % 12, (i % 27) + 1, 7, 0).toISOString(),
    distance: 5000 + i * 1200, movingTime: 900 + i * 60, duration: 1000 + i * 60,
    ascent: 50 + i * 20, sport: i % 2 ? 'ride' : 'run', sportLabel: i % 2 ? '骑行' : '跑步'
  }));
}
acts.forEach(a => { a.year = new Date(a.startTime).getFullYear(); a.fingerprint = Stats.fingerprint(a); });
const career = Stats.career(acts);
ok(career.totals.count === acts.length, '生涯次数正确', 'got ' + career.totals.count);
ok(career.totals.distance > 0, '生涯距离 > 0');
ok(career.longest && career.longest.distance > 0, '最长单次存在');
ok(career.streak.days >= 1, '连续天数计算');
const heat = Stats.heatmap(acts, 2026);
ok(heat.grid.length >= 53 && heat.grid[0].length === 7, '热力图网格 53×7');
ok(heat.totalDistance > 0, '热力图年度距离 > 0');
const monthly = Stats.monthly(acts, 2026);
ok(monthly.length === 12, '月度统计 12 个月');
const pb = Stats.personalBests(acts);
ok(pb.marathon.length === 4, 'PB 项目 4 项');
const dupActs = acts.concat([Object.assign({}, acts[0], { id: 'dup-1' }), Object.assign({}, acts[1], { id: 'dup-2' })]);
const groups = Stats.dedupGroups(dupActs);
ok(groups.length >= 1, '重复分组检测', 'groups=' + groups.length);
const poster = Stats.posterSVG(acts, 2026);
ok(poster.svg.indexOf('<svg') > 0, '海报 SVG 生成');
ok(poster.svg.length > 2000, '海报内容非空');
fs.writeFileSync(path.join(samples, 'poster_2026.svg'), poster.svg);
fs.writeFileSync(path.join(samples, 'export_sample.json'), JSON.stringify({ app: '迈向Ob管理器', version: 1, activities: acts }, null, 2));

console.log('\n==============================');
console.log('PASS=' + pass + '  FAIL=' + fail);
process.exit(fail ? 1 : 0);
