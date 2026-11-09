# running_page 对比分析报告 & 「迈向Ob管理器」可借用清单

> 调研对象：[yihong0618/running_page](https://github.com/yihong0618/running_page)（master，292 个文件；重点阅读 23 个 `run_page/*.py` 与 13 个前端模块）
> 对照对象：鸡翅幸哲迈进OB（jichi-ob，9.5.9，apktool 反编译 smali 静态分析）
> 产出对象：迈向Ob管理器（本仓库 v1.0.0，纯本地 Web 数据中心）
> 日期：2026-11-09

---

## 0. 结论摘要

1. **没有代码级复用**：在 jichi-ob 的 11,139 个 smali 文件中检索 running_page 的特征符号（`summary_polyline`、`run_id`、`YearSummary`、`GridDrawer`、`CircularDrawer`、`ContributionHeatmap`、`11930465` 等）**全部 0 命中**；仅 `start_date_local` 出现在 Intervals.icu/Zwift 平台 API 解析里，属平台字段巧合。jichi-ob 的 FIT 解析走 **Garmin 官方 SDK（com.garmin.fit）**，与 running_page 的 `garmin_fit_sdk` 无共享代码。
2. **概念级借鉴存在且合理**：GitHub 风格日历热力图、个人最佳（PB）、年度轨迹海报、活动数据模型、记录中心检索——这些是 running_page 的强项，jichi-ob 在产品层用过类似概念，但均为 Kotlin 原生重写。
3. **jichi-ob 缺少 running_page 的两块核心能力**：①运动数据统计体系（PB / 年度对比 / 日历热力）；②本地 FIT/GPX 文件管理与年度海报。这正是「迈向Ob管理器」立项原因。
4. **本仓库已完成**：FIT 二进制解析、GPX/TCX 解析、IndexedDB 索引、全内存搜索、查重/去重、生涯&年度统计、日历热力图、PB、年度轨迹海报（SVG）、JSON 备份。对比 running_page，**地图底图、环形海报模板、多语言、服务端同步器**未做（不适用或后续路线图）。

---

## 1. running_page 架构拆解

| 层 | 位置 | 关键内容 |
|---|---|---|
| 数据同步层 | `run_page/*_sync.py`（40+ 平台脚本） | 各平台拉取活动 → 统一为 `Activity`；GitHub Actions 定时跑 |
| 数据存储层 | `run_page/generator/db.py` | SQLAlchemy + SQLite；`Activity` 表字段：`run_id/name/distance/moving_time/elapsed_time/type/subtype/start_date/start_date_local/location_country/summary_polyline/average_heartrate/average_speed/elevation_gain` |
| 文件解析层 | `run_page/gpxtrackposter/track.py` + `track_loader.py` | `Track` 类吃 GPX/TCX/FIT；FIT 用 `garmin_fit_sdk`；`SEMICIRCLE=11930465`、`FIT_EPOCH_S`；坐标/时间/距离/爬升/心率归一 |
| 去重与增量 | `track_loader.py` + `synced_data_file_logger.py` | 文件名/活动 ID 增量去重，避免重复导入 |
| 海报生成 | `gen_svg.py` + `gpxtrackposter/*_drawer.py` | 4 种风格：`grid_drawer`（网格）、`circular_drawer`（环形）、`github_drawer`（GitHub 绿格）、`year_summary_drawer`（年度汇总）；输出 SVG |
| 前端 | `src/`（React + Vite，classic/dashboard 双主题） | 活动列表/筛选、`ContributionHeatmap`（日历热力）、`StatsCards`（年度/累计/目标/对比）、`PersonalBest`（5K/10K/半马/全马 + 配速过滤）、`RouteMap`（Mapbox 轨迹）、`ChinaMap`（中国省市 SVG）、`CalendarWidget`、多语言 i18n、浅/深色主题 |
| 数据产物 | `src/static/activities.json` | 前端静态读取的扁平活动数组（无轨迹点，只有 `summary_polyline`） |
| 部署 | GitHub Actions + Pages | 全自动：同步 → 生成 JSON/海报 → 部署站点 |

---

## 2. 功能矩阵对比

| 能力 | running_page | jichi-ob（现有 App） | 迈向Ob管理器（本项目） |
|---|---|---|---|
| 多平台数据同步 | ✅ 40+ 平台 Python 脚本 + Actions | ✅ App 内直连登录同步（核心卖点） | ❌ 不做（定位本地文件） |
| 本地 FIT 解析 | ✅ garmin_fit_sdk | ✅ Garmin SDK（仅用于上传/下载转换） | ✅ 自研纯 JS 解析器 |
| GPX/TCX 解析 | ✅ | 间接（上传转换） | ✅ |
| 本地文件管理 | ❌（依赖同步产物） | ❌ | ✅ 扫描/索引/搜索/备份 |
| 记录列表/详情/筛选 | ✅ | ✅ 记录中心（同步缓存） | ✅ |
| 全内存搜索 | 部分（筛选） | 部分（按日期/平台） | ✅ 多关键词分词 |
| 查重/去重 | 文件名/ID 增量 | ❌ | ✅ 哈希 + 指纹双判据 |
| 生涯统计 | ✅ | ❌（只有同步成功/跳过/失败） | ✅ |
| 年度目标/对比 | ✅ | ❌ | ✅ 距离/次数目标 |
| 日历热力图 | ✅（GitHub 风格） | 部分（本地轨迹热力地图，非日历） | ✅ 53×7 强度分档 |
| 个人最佳 PB | ✅（4 档 + 配速过滤） | ❌ | ✅ 同口径 + 骑行/爬升纪录 |
| 年度海报 | ✅ 4 种 SVG 风格 | ❌ | ✅ 轨迹海报（基础版） |
| 轨迹地图底图 | ✅ Mapbox（需 token） | ✅ 自研离线网格/3D 轨迹 | ⚠️ 无底图轨迹 SVG（零 token、隐私优先） |
| 离线可用 | ❌（站点/服务端） | ✅ | ✅ 纯前端 |
| 多语言/主题 | ✅ | ❌（中文单语言） | ❌（v1 中文） |
| 数据导出 | ✅ JSON/CSV/海报 | 部分 | ✅ JSON 索引 / SVG 海报 |

---

## 3. 「我们用过它的代码吗」——逐项判定

### 3.1 代码级：未使用（证据）

- jichi-ob smali 全量检索下列 running_page 特征符号，**均 0 命中**：
  `summary_polyline`、`run_id`、`elevation_gain`、`average_heartrate`、`YearSummary`、`ContributionHeatmap`、`GridDrawer`、`CircularDrawer`、`Poster`（仅命中 App 自有贴纸枚举 `WARM_POSTER/POSTER_ORANGE`）、`11930465`、`polyline`。
- jichi-ob 的 FIT 解析类为 `com.garmin.fit.*`（Garmin SDK 原样打包），与 running_page 的 `garmin_fit_sdk`（Python）无关。
- 语言/技术栈不同（Kotlin/Android vs Python+React），不存在直接拷贝条件。

### 3.2 概念级：借鉴过并做了本土化改造

| 概念 | running_page 做法 | jichi-ob 做法 | 改造效果评估 |
|---|---|---|---|
| 活动数据模型 | SQLite `Activity` + `summary_polyline` | App 内 `ActivityRecord` + 平台缓存 | **更好**：移动端实时性/离线性更强；但字段少（无 PB/统计） |
| 日历热力图 | 前端 SVG 绿格，按距离/类型分档 | 本地轨迹热力地图（离线瓦片/网格） | **场景更贴**（轨迹热度），但**缺失年度日历视角**（更差） |
| 年度海报 | 4 种 SVG 风格自动生成 | 无 | **更差**（功能缺口）→ 本项目补齐 |
| 个人最佳 | 4 档距离 + 配速过滤 | 无 | **更差** → 本项目已按同口径实现 |
| 记录中心 | TracksPage 活动浏览/详情/地图 | 已同步记录检索 + 拉取全部 + 下载 | **更适合移动端同步场景**，但不管理本地文件（缺口）→ 本项目补 |
| 离线/隐私 | 站点 + 服务端/Mapbox | 全本地 + 自研渲染 | **更好** |

### 3.3 明确没有采用（合理放弃）

- **40+ 平台 Python 同步器 / GitHub Actions 定时任务**：jichi-ob 已在 App 内实现平台同步，重做无收益；
- **SQLAlchemy/SQLite 服务端**：移动端本地场景用 IndexedDB 更轻；
- **Mapbox 底图 + Token**：隐私与成本考虑，本项目用无底图轨迹 SVG；
- **多语言/多主题/i18n**：v1 聚焦中文单主题，后续按需；
- **中国省市 SVG 地图、城市统计**：需要地理反查数据（本项目未内置 57 万行地图数据），列入路线图。

---

## 4. 可借用清单（按价值/成本排序）

| 优先级 | 借用点 | running_page 参考 | 本项目落地 |
|---|---|---|---|
| P0 | FIT 语义常量与字段口径 | `track.py`：`SEMICIRCLE=11930465`、`FIT_EPOCH`、session 字段/缩放 | ✅ `js/fit.js`：同口径实现（semicircle、Garmin epoch、scale 100/1000/5-500 等） |
| P0 | 运动类型归一化 | `get_normalized_sport_type` | ✅ `SPORT_MAP` + 子类型中文标签 |
| P0 | PB 合理配速过滤 | `PersonalBest.tsx`：距离档位 + 3:00~8:00/km | ✅ 同口径，另加骑行/爬升/均速纪录 |
| P0 | 日历热力图分档 | `ContributionHeatmap.tsx`：日汇总 + 4 档 | ✅ 53×7 网格 + 4 档 |
| P1 | 活动指纹去重 | `track_loader` 增量去重 | ✅ 哈希 + 指纹双判据（本项目增强） |
| P1 | 年度海报轨迹绘制 | `gpxtrackposter/*_drawer.py` | ✅ 轨迹归一化绘制（基础版） |
| P1 | 数据导出 | `data_to_csv.py`（CSV） | ✅ JSON 索引导出/导入；CSV 列入路线图 |
| P2 | 轨迹简化/polyline | `polyline_processor.py` | ⏳ 当前按步长抽样，未上 Douglas-Peucker |
| P2 | 多风格海报（grid/circular/github） | 4 个 drawer | ⏳ 路线图 |
| P2 | 位置/城市统计 | `city.ts`、`ChinaMap.tsx` | ⏳ 需离线地理数据 |
| P3 | 时区处理 | `parse_datetime_to_local` | ✅ 用本地时区分档（`startTime` 本地化展示） |

---

## 5. 「迈向Ob管理器」对照实现情况

**已完成（v1.0.0）**
- FIT/GPX/TCX 解析器（无第三方依赖，Node 测试 30 项通过）
- IndexedDB 索引 + 全内存搜索（多关键词）
- 生涯统计（总距离/时长/爬升/活跃天/连续天/单日最远/最快均速）
- 年度统计（年份切换/月度分布/目标进度）
- 日历热力图（53×7，4 档，悬浮明细）
- PB（5K/10K/半马/全马 + 骑行/爬升纪录）
- 查重/去重（哈希 + 指纹，保留最新/最早）
- 年度轨迹海报 SVG 导出
- JSON 索引导出/导入、清空索引
- 拖拽/文件夹递归扫描/多选导入
- 深色移动端 UI（#FC4C02 主色，参考原型 1-3）

**未完成（路线图）**
- 地图底图（本地瓦片/离线）
- 海报多风格（网格/环形/GitHub 绿格）
- CSV/GPX 导出、PNG 海报
- PWA 安装、File System Access API 直连目录
- 城市/位置统计、多语言

---

## 6. 风险与建议

1. **大文件**：>100 MB FIT（超长活动）解析会占内存；建议后续分片/Worker 解析；
2. **浏览器数据易失**：IndexedDB 可能被清；已提供 JSON 导出，建议 UI 定期提醒备份；
3. **无底图可视化**：轨迹海报缺少地理参照；后续可接本地瓦片或高德/OSM 静态底图（注意合规）；
4. **FIT 覆盖率**：已覆盖 session/record/lap/file_id 主字段；功率/踏频扩展、游泳、开发者字段需补；
5. **与 running_page 的差异化**：不做同步器、不做云站点，专注"本地文件 + 隐私 + 移动端"。

---

## 7. 参考文件（本次阅读）

- `run_page/generator/db.py`、`run_page/gpxtrackposter/track.py`、`track_loader.py`、`gen_svg.py`、`gpxtrackposter/*_drawer.py`、`run_page/config.py`、`fit_sync.py`、`gpx_sync.py`、`tcx_sync.py`、`data_to_csv.py`
- `src/core/types.ts`、`src/themes/classic/utils/const.ts`、`utils.ts`、`src/components/ContributionHeatmap.tsx`、`StatsCards.tsx`、`PersonalBest.tsx`、`SummaryPage.tsx`、`themes/classic/pages/index.tsx`
- jichi-ob 9.5.9 反编译 smali（11,139 文件）关键字检索
