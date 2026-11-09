#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成测试用 FIT / GPX / TCX 样本（用于验证前端解析器）。
FIT 编码器只实现本项目解析所需的文件头 + definition + data + compressed timestamp。
"""
import struct, os, datetime, math, sys

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'samples')
os.makedirs(OUT, exist_ok=True)

FIT_EPOCH = 631065600  # 1989-12-31T00:00:00Z


def garmin_ts(dt):
    return int(dt.replace(tzinfo=datetime.timezone.utc).timestamp()) - FIT_EPOCH


def semicircle(deg):
    return int(round(deg * (2 ** 31) / 180.0))


def base_size(t):
    return {0x00:1, 0x01:1, 0x02:1, 0x83:2, 0x84:2, 0x85:4, 0x86:4,
            0x07:1, 0x88:4, 0x89:8, 0x0A:1, 0x8B:2, 0x8C:4, 0x0D:1,
            0x8E:8, 0x8F:8, 0x90:8}[t]


def enc_value(t, v):
    if t == 0x07:  # string
        b = v.encode('utf-8') + b'\x00'
        return b
    fmt = {0x00:'<B',0x01:'<b',0x02:'<B',0x83:'<h',0x84:'<H',0x85:'<i',0x86:'<I',
           0x88:'<f',0x89:'<d',0x0A:'<B',0x8B:'<H',0x8C:'<I',0x0D:'<B'}.get(t)
    if fmt is None:
        raise ValueError('unsupported base type %#x' % t)
    return struct.pack(fmt, v)


def definition(local, global_num, fields, arch=0):
    """fields: [(num, base_type, size)]"""
    b = bytes([0x40 | local, 0x00, arch])
    b += struct.pack('<H' if arch == 0 else '>H', global_num)
    b += bytes([len(fields)])
    for (num, t, size) in fields:
        b += bytes([num, size, t])
    return b


def data(local, fields, values):
    """fields: [(num, base_type, size)]；values: dict num->val"""
    b = bytes([local])
    for (num, t, size) in fields:
        v = values[num]
        if t == 0x07:
            raw = v.encode('utf-8') + b'\x00'
            raw = raw[:size].ljust(size, b'\x00')
        else:
            raw = enc_value(t, v)
        if len(raw) != size:
            # 数组类型：重复 base 值
            raw = raw * (size // len(raw))
        b += raw
    return b


def build_fit(dt_start, sport=1, sub_sport=2, n=120, lat0=36.06, lon0=120.38, name='样例骑行训练'):
    file_id_fields = [(0, 0x00, 1), (4, 0x86, 4)]
    session_fields = [(2, 0x86, 4), (5, 0x00, 1), (6, 0x00, 1),
                      (7, 0x86, 4), (8, 0x86, 4), (9, 0x86, 4),
                      (11, 0x84, 2), (14, 0x84, 2), (15, 0x84, 2),
                      (16, 0x02, 1), (17, 0x02, 1), (18, 0x02, 1),
                      (20, 0x84, 2), (21, 0x84, 2), (22, 0x84, 2), (23, 0x84, 2),
                      (110, 0x07, 16), (26, 0x84, 2)]
    rec_fields = [(253, 0x86, 4), (0, 0x85, 4), (1, 0x85, 4), (2, 0x84, 2),
                  (3, 0x02, 1), (4, 0x02, 1), (5, 0x86, 4), (6, 0x84, 2), (7, 0x84, 2)]
    # 生成轨迹：沿直线骑行，每 5 秒一个点
    records = []
    dist = 0.0
    alt = 20.0
    speed = 7.5  # m/s
    lat, lon = lat0, lon0
    t = garmin_ts(dt_start)
    total_ascent = 0
    total_descent = 0
    prev_alt = alt
    n = max(10, n)
    for i in range(n):
        # 每秒 ~7.5m，纬度方向移动（0.0000675 度 ≈ 7.5m）
        dlat = 7.5 * 5 / 111320.0
        lat += dlat
        alt += 0.4 if i % 5 == 0 else (-0.2 if i % 7 == 0 else 0)
        if alt > prev_alt:
            total_ascent += alt - prev_alt
        else:
            total_descent += prev_alt - alt
        prev_alt = alt
        dist += 7.5 * 5
        t += 5
        hr = 120 + int(20 * math.sin(i / 10.0))
        cad = 80 + (i % 5)
        pw = 180 + (i % 7) * 5
        records.append({
            253: t, 0: semicircle(lat), 1: semicircle(lon),
            2: int((alt + 500) * 5), 3: hr, 4: cad,
            5: int(dist * 100), 6: int(speed * 1000), 7: pw
        })
    elapsed = n * 5
    session = {
        2: garmin_ts(dt_start), 5: sport, 6: sub_sport,
        7: int(elapsed * 1000), 8: int(elapsed * 1000), 9: int(dist * 100),
        11: 420, 14: int((dist / elapsed) * 1000), 15: int(9.2 * 1000),
        16: 132, 17: 158, 18: 84,
        20: 210, 21: 420, 22: int(total_ascent), 23: int(total_descent),
        110: name, 26: 1
    }
    out = b''
    out += definition(0, 0, file_id_fields)
    out += data(0, file_id_fields, {0: 4, 4: garmin_ts(dt_start)})
    out += definition(1, 18, session_fields)
    out += data(1, session_fields, session)
    out += definition(2, 20, rec_fields)
    for r in records:
        out += data(2, rec_fields, r)
    out += b'\x00\x00'  # 文件 CRC（解析器忽略，不计入 dataSize）
    header = bytes([12, 0x10]) + struct.pack('<H', 2100) + struct.pack('<I', len(out) - 2) + b'.FIT'
    return header + out


def build_gpx(dt_start, points=200, lat0=36.06, lon0=120.38, name='样例徒步'):
    head = ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<gpx version="1.1" creator="marching-ob-manager" xmlns="http://www.topografix.com/GPX/1/1">\n'
            '<trk><name>%s</name><type>hiking</type><trkseg>\n' % name)
    body = ''
    lat, lon, alt = lat0, lon0, 30.0
    t = dt_start
    for i in range(points):
        lat += 0.00005
        lon += 0.00003
        alt += 0.3 if i % 4 == 0 else 0
        t += datetime.timedelta(seconds=6)
        body += ('<trkpt lat="%.6f" lon="%.6f"><ele>%.1f</ele>'
                 '<time>%s</time></trkpt>\n' % (lat, lon, alt, t.strftime('%Y-%m-%dT%H:%M:%SZ')))
    return head + body + '</trkseg></trk></gpx>\n'


def build_tcx(dt_start, points=180, lat0=36.06, lon0=120.38, name='样例跑步'):
    start_s = dt_start.strftime('%Y-%m-%dT%H:%M:%SZ')
    head = ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">\n'
            '<Activities><Activity Sport="Running"><Id>%s</Id>' % start_s)
    body = ''
    lat, lon, alt = lat0, lon0, 25.0
    t = dt_start
    dist = 0.0
    pts_xml = ''
    for i in range(points):
        step = 4.0
        lat += step / 111320.0
        dist += step
        t += datetime.timedelta(seconds=2)
        hr = 140 + (i % 10)
        alt += 0.1
        pts_xml += ('<Trackpoint><Time>%s</Time>'
                    '<Position><LatitudeDegrees>%.6f</LatitudeDegrees><LongitudeDegrees>%.6f</LongitudeDegrees></Position>'
                    '<AltitudeMeters>%.1f</AltitudeMeters><DistanceMeters>%.1f</DistanceMeters>'
                    '<HeartRateBpm><Value>%d</Value></HeartRateBpm></Trackpoint>'
                    % (t.strftime('%Y-%m-%dT%H:%M:%SZ'), lat, lon, alt, dist, hr))
    body = ('<Lap StartTime="%s"><TotalTimeSeconds>%d</TotalTimeSeconds>'
            '<DistanceMeters>%.1f</DistanceMeters><Calories>120</Calories>'
            '<AverageHeartRateBpm><Value>142</Value></AverageHeartRateBpm>'
            '<MaximumHeartRateBpm><Value>160</Value></MaximumHeartRateBpm>'
            '<Track>%s</Track></Lap>' % (start_s, points * 2, dist, pts_xml))
    return head + body + '</Activity></Activities></TrainingCenterDatabase>\n'


def main():
    base = datetime.datetime(2026, 5, 17, 7, 30, 0)
    with open(os.path.join(OUT, 'sample_ride.fit'), 'wb') as f:
        f.write(build_fit(base, sport=2, sub_sport=6, n=240, name='样例骑行'))
    with open(os.path.join(OUT, 'sample_hike.gpx'), 'w', encoding='utf-8') as f:
        f.write(build_gpx(datetime.datetime(2026, 7, 19, 6, 0, 0)))
    with open(os.path.join(OUT, 'sample_run.tcx'), 'w', encoding='utf-8') as f:
        f.write(build_tcx(datetime.datetime(2026, 10, 2, 18, 20, 0)))
    # 每月/每年补充样本，便于统计 UI 演示
    months = [(1, 8, 'run'), (2, 14, 'ride'), (3, 21, 'hike'), (4, 5, 'ride'),
              (6, 11, 'run'), (8, 23, 'ride'), (9, 9, 'run'), (11, 2, 'ride')]
    for idx, (m, day, kind) in enumerate(months):
        dt = datetime.datetime(2024 if idx < 3 else 2025 if idx < 6 else 2026, m, day, 7, 0, 0)
        if kind == 'ride':
            with open(os.path.join(OUT, 'demo_%02d_ride.fit' % idx), 'wb') as f:
                f.write(build_fit(dt, sport=2, sub_sport=6, n=120 + idx * 20))
        elif kind == 'run':
            with open(os.path.join(OUT, 'demo_%02d_run.tcx' % idx), 'w', encoding='utf-8') as f:
                f.write(build_tcx(dt, points=120 + idx * 10))
        else:
            with open(os.path.join(OUT, 'demo_%02d_hike.gpx' % idx), 'w', encoding='utf-8') as f:
                f.write(build_gpx(dt, points=90 + idx * 10, name='样例徒步%d' % idx))
    print('samples written to', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
