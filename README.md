# 手工造纸帘纹与工序档案

围绕手工造纸的纸帘、纤维料批、抄纸工序与成纸样本建立一体化档案。界面可登记纸帘丝径与帘纹间距、推算网目密度，跟踪料批打浆度，复测抄纸帘纹偏差，并按匀度与帘纹条数复核样本。所有业务数据保存在浏览器 IndexedDB 中，无需后端服务。

## Docker 一键启动

```bash
cp .env.example .env && docker compose up -d --build
```

默认映射端口为 `21807`。启动后访问 `http://localhost:21807`。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 前端框架 | React 18 + TypeScript 5 |
| 构建工具 | Vite 5 |
| 界面组件 | MUI 5 + Emotion |
| 路由 | React Router 6 |
| 状态管理 | Zustand 4 |
| 本地数据库 | Dexie 4 + IndexedDB |
| 部署 | Nginx + Docker Compose |

## 访问地址

`http://localhost:21807`

## 本地开发方式

```bash
cd frontend
npm install
npm run dev
```

本地开发服务器默认运行在 `http://localhost:5173`。

## 目录结构

```text
.
├── docker-compose.yml
├── .env.example
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   └── src/
│       ├── components/common/  公共可视化组件
│       ├── hooks/              筛选与单位换算
│       ├── pages/              五个业务页面
│       ├── router/             路由表
│       ├── stores/             Zustand 状态与持久化动作
│       ├── types/              四类业务模型
│       └── utils/              Stripe 计算、Dexie 与 JSON 导出
└── README.md
```

## 数据存储说明

数据存储使用 IndexedDB，Dexie 数据库名为 `gbpapermill-db`。

- `version(1)`：建立 `moulds`、`fiberBatches`、`sheetRuns`、`paperSamples` 四张表及编号、日期、状态等索引。
- `version(2)`：为四张表加入 `schemaRev` 索引，并通过 `upgrade` 将存量记录回填为版本 `2`。
- `version(3)`：支持一槽多批浆合槽与料批余量台账：
  - 料批增加 `state`（在用/停用）与 `stockVersion`（乐观并发版本）。
  - 工序以 `batchLines[]` 登记多批浆的投料量、登记时料批快照与各自分摊消耗（旧 `batchId` 仅留痕）。
  - 新增 `stockLedger` 投料流水表（入库/领用），料批余量恒由流水汇总，改料批资料不倒改历史配方。
  - 工序与样本增加 `frozen`：停用某料批只冻结确实用到它的工序及其成纸样本。
  - 升级时旧工序按原单批补一行投料明细，按「克重 × 帘框面积 × 叠高」补回消耗，并为每个旧单批补来源（入库）记录。
- 数据库首次创建时通过 `populate` 写入 5 张纸帘、5 个纤维料批（含建批入库）、8 槽抄纸工序（含两槽构皮+桑皮合槽）、对应投料流水与 6 个成纸样本。
- 页面顶部的“导出 JSON”可下载五张表的完整备份。

### 合槽分摊与并发领料

- 一槽可登记多批浆及各自投料量（kg）；本槽总用纸量 = 克重(g/m²) × 帘框面积(m²) × 叠高(张)，再按各行投料量比例分摊到各批浆，末行承担四舍五入残差。
- 保存工序在同一个读写事务内完成“写工序 + 写领用流水 + 推进料批版本”，任一校验失败（停用批、余额不足等）整槽回退。
- 跨标签页通过 Web Locks 串行化同名料批领料，并以 `stockVersion` 兜底乐观并发：两个标签页同时领同一批浆只有一方成功，失败方可直接重试。
- 领用流水以工序号为幂等键（`clientToken`），重复提交返回原工序且不会再次扣料。

## 核心功能与路由表

| 路由 | 页面标题 | 核心功能 |
| --- | --- | --- |
| `/` | 工作台 | 查看纸帘状态分布、本周工序数、待复检样本与标准工序路径 |
| `/moulds` | 纸帘台帐 | 筛选纸帘，登记新纸帘，实时推算网目密度并登记修补 |
| `/fibers` | 纤维料批台账 | 按原料和打浆度筛选、比较，展开查看关联抄纸工序 |
| `/runs` | 抄纸工序记录台 | 按日期和帘号筛选，登记工序并即时判断 ±0.2 mm 帘纹偏差 |
| `/samples` | 成纸样本与透光检验卡 | 按匀度与帘纹条数分档，查看透光帘纹预览和归档位置 |

未匹配的地址会回到工作台。
