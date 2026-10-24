# `cn-ancient` 构件提示词 · 试产批（2026-10-22）

> 用途：**图生 3D（混元 3D 等）** 的干净多视角设定稿。不是原画氛围稿，一切写法都为“模型能读准轮廓、能落回模数”服务。
> 真源：`docs/BUILDING-DECOMPOSITION.md` §5.1（四段式）＋ §9.2（50 类清单）＋ `docs/CONVENTIONS.md` §1 / §3.3。
> 本批只做 3 件：**硬山单檐屋面 / 檐柱 / 村口老槐** —— 分别代表大硬表面、重复线性件、有机体，先测混元的成功率与后处理工时。

---

## 0. 先看清这条边界

AI 生成的构件**尺寸是“看起来差不多”**。库里的程序化灰模不是废稿，它是这三件 AI 件的**尺寸信封**：

| 资产 | 灰模尺寸（x 宽 × y 高 × z 深） | 轴心 | 面数预算 |
|---|---|---|---|
| `cn-ancient.roof.yingshan-single-a` | 10.0 × 2.0 × 7.0 m | bottom-center | `mass` 50k（建议成品 ≤ 20k） |
| `cn-ancient.pillar.yanzhu-round-a` | 0.4 × 3.0 × 0.4 m（柱脚套箍略粗） | bottom-center | `component` 20k |
| `cn-ancient.nature.old-locust-a` | 4.0 × 5.8 × 4.0 m | bottom-center | `primitive` 5k（建议成品 ≤ 20k） |

出模后**必须**做：① 缩放到上表的包围盒；② 轴心归到底面中心；③ 减面到预算；④ 检查 +Y up / -Z forward。**不许直接替换灰模入库。**

---

## 1. 三视图怎么取

| 资产 | 三格 | 为什么 |
|---|---|---|
| 硬山屋面 | 正视图 / 侧视图 / 俯视图 | 屋顶的坡度在侧视，平面与瓦垄在俯视；背视图对两坡对称体是重复信息 |
| 檐柱 | 正视图 / 侧视图 / 俯视图 | 柱身收分在侧视；俯视确认圆截面与套箍同心 |
| 老槐 | 正视图 / 侧视图 / 背视图 | 树冠与枝干不对称，三个环向视角比俯视更有信息；俯视会被树冠挡住主干 |

> 混元多视图入口若只收环向 0°/90°/180°，屋面那件把“俯视”换成“背视图”再喂；**别把俯视图硬塞进环向槽位**。

---

## 2. 公共骨架（三件都拼它，不许改）

```text
【画面类型】3D 建模用的构件多视角设定稿（orthographic turnaround sheet）。横向三等分：
左＝正视图，中＝严格 90° 侧视图，右＝俯视图（或背视图，见各件说明）。
三格是同一构件、同一缩放、同一材质；三格的水平中线与底边严格对齐；不画透视图、不画四分之三视角。

【呈现】构件孤悬于画面中央，不接触地面、不带底座、不带场景；三格之间留均匀空隙；
构件完整入画，四周留约 8% 空白，不裁切檐口、柱脚、树冠。

【镜头】正交投影（orthographic），无透视、无俯仰、无倾斜、无广角畸变；
正视图与侧视图用同一水平视线高度。

【背景与光照】纯中性灰 #808080 平光背景，无渐变、无纹理、无地平线、无地面、无投影、无环境反射；
受光均匀，暗部保留结构层次；材质低饱和，瓦 / 木 / 石 / 金属四类可辨。

【风格】写实国风 · 次世代游戏资产 · PBR 材质 · 适度做旧：风化、雨痕、边角磨损、灰缝；
不是卡通、不是平涂、不是低模色块；结构准确，接缝、瓦垄、木纹、石纹清楚。

【禁止】画面内不得出现文字、字母、数字、尺寸标注、箭头、辅助线、表格框、logo、水印；
不得出现第二个构件、局部特写小图、场景、人物、动物、云雾、光效、粒子；不得出现透视灭点。
```

> 提示词块里的 `★` 是文档强调记号，**粘进生图工具前删掉**。

---

## 3. 三件的完整提示词

- [硬山单檐屋面](./pilot-01-yingshan-single-a.md)
- [檐柱](./pilot-02-yanzhu-round-a.md)
- [村口老槐](./pilot-03-old-locust-a.md)

> 后续批次：[废洞洞口 / 学堂残垣 4 m](./pilot-04-village-nature-ruin.md)（2026-10-23，报告见 `../../reports/PILOT-2026-10-23.md`）·
> [槐阴村整栋不拆分（民居整栋 / 学堂半废整栋，三视图分张生成）](./pilot-05-village-whole-buildings.md)（2026-10-24，报告见 `../../reports/PILOT-2026-10-24.md`）·
> [民居变体（三开间带披屋 / 两开间低矮 / L 形 / 墙基废墟）](./pilot-06-village-buildings-b.md)（2026-10-25，报告见 `../../reports/PILOT-2026-10-25.md`）·
> [村中道具与地标（院门 / 土地庙 / 井台 / 柴房 / 石碾 / 猪圈 / 农具 / 陶缸 / 溪口石 / 旧山门）](./pilot-07-village-props.md)（2026-10-26，报告见 `../../reports/PILOT-2026-10-26.md`）·
> [混元文生 3D 提示词（剩余村中物件，A/B 组）](./pilot-08-village-hunyuan-text.md)（直接文生，跳过三视图）。

### 槐阴村 · 全套资产索引

| 资产 | 提示词 | 状态 |
|---|---|---|
| 村口老槐 `old-locust-a` | [pilot-03](./pilot-03-old-locust-a.md) | 已有图 / 模型 |
| 废洞洞口 `cave-mouth` | [pilot-04](./pilot-04-village-nature-ruin.md) | 已有图，待图生 3D |
| 学堂残垣 4 m `school-ruin-4m` | [pilot-04](./pilot-04-village-nature-ruin.md) | 已有图 |
| 普通民居 `village-house-a` | [pilot-05](./pilot-05-village-whole-buildings.md) | 已有图 / 模型 |
| 学堂半废厢房 `village-school-b` | [pilot-05](./pilot-05-village-whole-buildings.md) | 已有图，待图生 3D |
| 民居 B / C / D `village-house-b/c/d` | [pilot-06](./pilot-06-village-buildings-b.md) | 已有模型 |
| 墙基废墟 `village-ruin-b` | [pilot-06](./pilot-06-village-buildings-b.md) | 已有图（正 / 侧 / 俯 / 背 四张），待图生 3D |
| 院门 / 土地庙 / 井台 / 柴房 / 石碾 / 猪圈 / 农具 / 陶缸 / 溪口石 / 旧山门 | [pilot-07](./pilot-07-village-props.md) | 已有图 / 模型（`huaiyin/props/`，10 件） |
| 剩余村中物件（A/B 组） | [pilot-08](./pilot-08-village-hunyuan-text.md) | 已出模型；文生提示词留档 |

> **不做的**：篱笆 / 晒架（GBE 已有灰模）、地面 / 土路 / 薄田（UE Landscape）、人物 / 牲畜（角色管线）、带字匾额（字必乱）。

---

## 3.1 本轮已出的图

横向三视图已生成并拆成单张，落 `pipeline/out/pilot-2026-10-22/refs/`（`out/` 不入 Git；清单与已知不足见 `pipeline/reports/PILOT-2026-10-22.md`）：

| 资产 | front | side | 第三张 |
|---|---|---|---|
| 硬山屋面 | `yingshan-single-a-front.png` | `yingshan-single-a-side.png` | `yingshan-single-a-top.png`（已旋正） |
| 檐柱 | `yanzhu-round-a-front.png` | `yanzhu-round-a-side.png` | `yanzhu-round-a-top.png` |
| 老槐 | `old-locust-a-front.png` | `old-locust-a-side.png` | `old-locust-a-back.png` |

## 4. 生成与后处理流程

1. **出图**：每件用“公共骨架 ＋ 构件段”，三格一张横向图；尺寸建议 1536×1024 或 1792×1024。
2. **审图**：只标错的那一格，不整件重来（§5.2）。重点看：正/侧是否真 90°、三格是否同比例、有没有透视。
3. **切图**：一张图切成 3 张单视角 PNG，命名 `<asset-name>-<view>-<variant>.png`，进 `pipeline/out/pilot-2026-10-22/refs/`。
4. **混元**：优先多视图入口，按 0°/90°/180° 或正/侧/顶喂；材质选“带纹理”，面数先按 30k–50k 出，再减。
5. **归一**：Blender 里按上表包围盒缩放；移动轴心到 `(0, 0, 0)` 的底面中心；应用变换。
6. **减面 / 重拓扑**：硬表面优先重拓扑到四边面；有机体可保留三角面但按预算减。目标 ≤ 上表面数预算。
7. **材质**：至少保住 `roof-tile/qingwa`、`timber/ben-se`、`timber/hei-qi`、`plant/ye-lu` 四组的主色；不要把做旧做成脏。
8. **导出**：glTF binary（`.glb`），+Y up / -Z forward / 米；文件进 `inbox/<asset-id>@<version>/`，走 `tools/intake.js`，**不直接改 `kits/`**。

---

## 5. 验收（试产批只看这三条）

- **轮廓对**：正视图与侧视图的宽高比与上表一致；屋面的坡度、檐口出挑、柱子的收分、老槐的冠幅都能一眼对上。
- **能落位**：缩放后底面能贴合灰模的承重面；屋面的 `ridge-seat` 仍在 y=2.0，柱子的 `top` 仍在 y=3.0，老槐的根盘仍在 y=0。
- **面数**：屋面 ≤ 20k、檐柱 ≤ 5k、老槐 ≤ 20k 三角面；超出就减，别拿“混元出来就这样”当理由。

> 试产批的产出不是“三件成品入库”，而是**一张成功率与工时表**：三件各花几次出图、几次重生成、后处理多少分钟。用这张表决定下一批是 6 件还是 21 件。
