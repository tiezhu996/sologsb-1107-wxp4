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
- `version(3)`：新增 `pulpFeeds` 投料记录表（入库 / 合槽两类，`feedNo` 唯一）；`fiberBatches` 增加 `status`（在用 / 停用）；`sheetRuns` 移除单批 `batchId` 并增加 `frozen`；`paperSamples` 增加 `frozen`。升级时旧工序按原单批补一条 100% 占比的合槽来源记录，旧料批补一条入库记录，余量自始由投料记录汇总。
- 数据库首次创建时通过 `populate` 写入 5 张纸帘、5 个纤维料批、8 槽抄纸工序（含一槽构皮、桑皮合槽）、6 个成纸样本及对应的投料记录。
- 页面顶部的“导出 JSON”可下载五张表的完整备份。

## 合槽投料与余量

- 工序登记支持一槽多批浆及各自投料量；整槽理论消耗 = 克重 × 帘框面积 × 叠高，按各批投料量比例分摊（尾差归末批）。
- 料批余量 = Σ入库量 − Σ合槽分摊消耗，全部由投料记录实时汇总，不作为字段落库。
- 投料记录保存批次编号、原料等登记时快照，修改料批资料（如打浆度复测）不会倒改历史配方。
- 整槽（工序 + 多批投料）在一个事务中原子写入，失败整槽回退并按同一幂等键重试；两个标签页同时领同一批浆时只有一方能成功，重复提交不会再次扣料。
- 料批停用后不能再领用，且只冻结确实引用它的工序及其名下成纸样本。

## 核心功能与路由表

| 路由 | 页面标题 | 核心功能 |
| --- | --- | --- |
| `/` | 工作台 | 查看纸帘状态分布、本周工序数、低余量料批、待复检样本与标准工序路径 |
| `/moulds` | 纸帘台帐 | 筛选纸帘，登记新纸帘，实时推算网目密度并登记修补 |
| `/fibers` | 纤维料批台账 | 按原料和打浆度筛选、比较，查看入库/已耗/余量与投料明细，复测打浆度、停用料批 |
| `/runs` | 抄纸工序记录台 | 按日期和帘号筛选，登记多批合槽投料并即时判断 ±0.2 mm 帘纹偏差 |
| `/samples` | 成纸样本与透光检验卡 | 按匀度与帘纹条数分档，查看透光帘纹预览和归档位置 |

未匹配的地址会回到工作台。
