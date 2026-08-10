# LOK Digital 在线求解器 — 设计方案 v0.2（对抗式 Review 修订版）

> v0.2 依据 3 位对抗式 reviewer（算法/前端/安全）的审查意见修订。关键变更已标注【改】。

## 1. 产品目标
纯静态 Web 站点（GitHub Pages 托管），提供：
1. 内置全部 151 个官方关卡
2. 自动求解 + 文字步骤 + 逐步动画回放
3. 粘贴 / 上传 ASCII 谜题求解
4. 可视化画题工具（支持全部高级规则符号）
5. 免费、零运行时依赖、零构建依赖

## 2. 技术栈
- 纯 ES Module JavaScript（无框架、无构建、无 npm 运行时依赖）
- HTML5 + CSS；DOM 网格渲染 + **Web Animations API (WAAPI)** 动画【改】
- Node.js 20+ 内置 `node:test` 做开发期测试
- GitHub Actions（SHA 固定版本）+ actions/deploy-pages 自动发布
- 【改】额外提供 `tools/bundle-single.js` 生成单文件 `dist/lok-solver.html`（经典脚本内联，双击 file:// 可用）作为离线降级

## 3. 目录结构
```
lok-digital-solver/
  index.html              # 单页应用壳（ES Module）
  README.md               # 用法 + 在线地址 + 隐私 + 版权声明
  LICENSE                 # MIT（代码）
  data/NOTICE.md          # 数据版权声明（关卡数据属 LOK Digital 原作者）
  .github/workflows/pages.yml
  .gitignore
  data/
    levels.js             # 官方151关【原始ASCII字符串】+ hints + 源版本戳
    words.js              # 固定全局关键词表 + 机制常量
  src/
    parse.js              # ASCII -> Level（唯一解析入口），失败契约 {ok,row,col,message}
    engine.js             # 棋盘状态、单词效果执行器（纯函数，零依赖）
    solver.js             # 求解器：自由词表 + 路径枚举 + 记忆化 + 三重预算
    solver-mono.js        # 纪念碑两阶段求解（世界13），单向依赖 solver.js
    animate.js            # 解步 -> 虚拟时间轴 -> WAAPI 动画
    draw.js               # 画题工具（Pointer Events + 缩放平移 + undo）
    ui.js                 # 主界面（唯一汇聚点）
    main.js               # 入口
  tools/
    extract-levels.js     # 从 levelCSV.txt 生成 data/levels.js（确定性）
    bundle-single.js      # 打包单文件降级产物
  tests/
    parse.test.js
    engine.test.js
    roundtrip.test.js     # 【改】导入导出幂等
    solver.test.js        # 全量151关回归
    security.test.js      # 【改】无 innerHTML / 病态输入 / 预算拦截
  docs/
    ASCII_FORMAT.md       # 【改】ASCII 格式规范（符号表 + 洋葱归属 + 纪念碑段）
```

## 4. 核心数据模型（engine.js）
```js
Cell = { x, y, letter, type:'letter'|'target'|'preblack'|'empty'|'monument_slot'|'monument_fake_slot',
         hp: 0..N,        // 洋葱层数
         blacked:bool,
         spent:bool }
Level = { cols, rows, cells[], monumentsPieces?, text? }
```
- `-`=empty(可穿过)、`#`=target(无字母需额外涂黑)、`=`=preblack(开局已黑)
- 字母=letter 格；`*` 紧跟格子=+1 hp/层（不占列）；`X`=导体(经过不填黑/不计字母/可转向/不可作首字母)；`?`=问号(指定字母后被填黑，转向时被当作X不填黑)；`W`=云朵

**【改】数据存储**：`levels.js` 存原始 ASCII 字符串数组，加载时统一走 `parse.js`——单一解析入口、官方题可导出、round-trip 有唯一事实源。

## 5. 关键词效果（engine.js 必须精确建模）
| 词 | 拼法 | 效果 |
|---|---|---|
| LOK | LOK/KOL | 3字母格涂黑 + 点击1个额外格 |
| TLAK | TLAK/KALT | 4字母格涂黑 + 选2个相邻额外格 |
| TA | TA/AT | 选一字母，全局涂黑所有该字母未黑格 |
| BE | BE/EB | 空格子变指定字母（创建字母格，改变状态） |
| LOLO | LOLO/OLOL | 涂黑一条倾斜对角线 |
| ABA | ABA | 3格涂黑 + 点1格取消涂黑（反转） |
| GRIVA | GRIVA/AVIRG | 最终词，涂黑5字母 |
| W | W | 激活全部 W 云朵格 |
| X/? | — | 导体/通配符（见§4） |

## 5b. OLKO 红鸟规则（隐藏收集机制）【新增】
- **拼法**：OLKO 或 OKLO（4 格直线），拼出后进入 OLKO 状态，点击屏幕任意位置触发 `DoOlko`——**召唤红鸟**（OlkoEffect），并在该世界记录 `setWorldOlkoFound`。
- **结算**：OLKO 触发后 `ResetLevel()`（该步不结算为通关步骤，仅作隐藏收集）。
- **每世界 1 只红鸟**：`getBirdCount()` = 各世界 `isOlkoFound` 之和（含最终关 `finalLevelOlko`）。
- **解锁门槛（用户要求不施加）**：birdCount 达 3/6/10 解锁 3 个隐藏扩展世界，13 key+14 鸟解锁最终关。**本项目不做此限制**。
- **项目目标**：对每个关卡**检测能否拼出 OLKO/OKLO**（词表加入 OLKO/OKLO 作为可检测词），求解时**额外搜索是否存在合法 OLKO 放置**，输出"本关可/不可拼 OLKO + 拼法步骤（哪 4 格）"。与正常通关求解解耦（OLKO 可独立于通关词序）。
- **实现**：solver 增加 `probeOlko(level)` 探测函数——用同一路径枚举框架搜索盘面上任意 4 格直线（含 X/? 通配、跳跃）拼出 OLKO/OKLO 的放置；结果标记到关卡数据 `olko: {possible:bool, placements:[{tiles,text}]}`。官方 151 关全部探测并输出报告（哪几关可拼 OLKO）。

洋葱 hp：hp>0 格涂黑只 hp-- 不黑；hp=0 才黑。【改】hp 建模为计数器，单次效果直接 hp-=1，不为每层开分支。

## 6. 求解器（solver.js）【大幅改】
**核心模型修正（对齐 reviewer 意见）**：
- 【改】**词表**：固定全局关键词表（含反向拼写），每步用"当前盘面未黑字母"查表 → O(1) 可用性检查，即"自由词库推导"。hints 仅用于搜索优先排序/UI 展示/可选报告，**不作搜索约束、成功条件、剪枝依据**。
- 【改】**终止条件**：所有非空格 blacked（CheckWin 语义），与"用了几个词"无关。词可重复使用、无需用完。
- 【改】**放置枚举**：方向+已走长度的路径 DFS，仅在 X/? 格允许 90° 转向；支持跳跃（跨已黑格/空位）。
- 【改】**搜索策略**：DFS + 状态去重 memo（key = 规范化网格快照字符串 type+letter+hp+blacked，含 BE 新建格/世界12坐标/阶段B槽位字母布局），**不含 stepLog/词计数**。
- 【改】**剪枝仅三项**：状态去重、深度上限（词数×2+常数，防 ABA/? 环）、三重预算。弃用"涂黑率上限"（ABA 黑化会下降）。
- 【改】**预算与中止**：`timeBudget`(5s, 单调时钟) + `nodeBudget`(200万节点) + `memoCap`(20万条，LRU)。任一超限抛 BudgetExceeded → 上层展示。**显式栈迭代 DFS** 根除栈溢出。UI 提供取消按钮。
- 【改】**结果四档**：`solved` / `timeout`(未在时限内找到，可加大预算重试) / `exhausted_no_solution`(穷尽搜索确认无解) / `unsupported`(世界12/13未覆盖)。
- 【新增】**OLKO 探测**：独立于通关求解的 `probeOlko(level)`——在盘面上搜索任意 4 格直线放置（含 X/? 通配与跳跃）能拼出 OLKO 或 OKLO 的位置集合，返回 `{possible, placements:[{tiles:[{x,y}], text}]}`；不计入通关步骤、不改变通关搜索，专用于报告"本关能否召唤红鸟"。
- 【改】**廉价前置无解检查**：target总数 > 额外格容量 → 必无解；盘面无可用词 → 必无解。
- 世界12箭头：建模为原子"推"动作（4方向，链推递归解析，坐标进状态）；尽力支持，失败标注 unsupported。
- 世界13纪念碑：两阶段——阶段A 回溯放置 pieces 到槽位（覆盖+无重叠+不含fakeSlot，件数≠槽数即无解；与阶段B 耦合剪枝），阶段B 在生成网格上跑拼词求解；多解时对每个匹配跑阶段B + 按网格哈希 memo。

## 7. 解析（parse.js）
- 兼容 levelCSV 格式；用户输入智能识别（无头自动推断等宽行）
- 【改】**失败契约**：返回 `{ok:true,level} | {ok:false,row,col,message}`，绝不进入 solver/渲染
- 【改】输入边界表：空输入/全空格/非法字符(定位)/非等宽行/超64×64/头非法/独立`*`/CRLF与BOM剥离，全部显式报错
- 【改】上传限制：`file.size ≤ 64KB`，不信任 file.type
- 【改】**永不将用户/提取数据拼进 RegExp 构造器**（防 ReDoS），通配用手写逐字符比对

## 8. UI / 动画 / 画题
**动画**【改】：
- 虚拟时间轴：step 序列 → 每步起止时间表（纯函数，可单测）；rAF 驱动 `t += dt*speed`，`applyStateAt(t)` 纯函数
- WAAPI `element.animate()` 提供 play/pause/playbackRate/reverse 原生支持
- 结束断言 DOM 终态 == 全黑终态
- 仅对受影响格动画，不整板 transition

**求解器运行**【改】：
- 首选 Web Worker（solver 纯函数，postMessage 传入 level+budget，返回结果+进度）
- 降级：主线程协作式生成器分片（file:///单文件模式 Worker 不可用）
- 结果抽屉区分四档语义

**画题**【改】：
- Pointer Events 统一输入 + `touch-action:none`；命中测试反变换
- 缩放/平移（CSS transform 层）+ 默认自适应格宽
- undo/redo 栈；洋葱层数用步进 +/- 控件；拖动涂刷
- 底部工具条 + `safe-area-inset-bottom`；工具按钮≥44px
- 【改】导出走同一 parse/export 代码路径，保证 round-trip

**无障碍基线**【改】：`:focus-visible`、棋盘键盘光标、播放器全键盘可达、步骤`<ol>`文本列表、涂黑后黑底白字、reduced-motion 无动画模式

## 9. 安全硬约束【改】
- 全项目**禁用 innerHTML/outerHTML/insertAdjacentHTML/document.write**，一律 createElement+textContent+classList；CI grep 断言命中即失败
- 渲染层字符白名单与解析白名单分离
- 错误信息中的非法字符以 textContent 输出
- 所有定时器回调 try/catch；window.onerror 兜底提示；求解与回放隔离（求解失败不影响其他功能）
- 三重预算 + 输入上限在 parse 前以纯数值拒绝

## 10. 自动化测试
- parse：官方格式/自由输入/错误输入契约表/纪念碑格式/BOM CRLF
- engine：每关键词精确断言（洋葱/TA全局/ABA反转/X与?语义/LOLO对角线）
- 【改】roundtrip：`parse(export(grid))` 逐字节幂等 + 语义等价；覆盖洋葱/预黑/导体/纪念碑/箭头
- 【改】solver 回归：151 关求解 → 断言①解出②重放后全黑③每步合法(词∈固定表+路径合法+hp结算)④用词⊆固定表；hints 覆盖率仅报告不判定
- 【新增】olko 探测：对官方 151 关逐一 `probeOlko`，断言返回结构合法；输出"可拼 OLKO 的关卡清单"报告（含拼法坐标），并抽样人工在游戏内验证
- 【改】security：病态输入预算拦截（64×64全`?`）、innerHTML 扫描、ReDoS 样例
- 【改】数据验证前置：条目数===151 + 世界分组和===151 + round-trip + 关键关指纹表
- `package.json`：`"type":"module"`, `"engines":{"node":">=20"}`, `"scripts":{"test":"node --test"}`
- 【改】CI 加"重新生成 levels.js → git diff --exit-code"防漂移

## 11. GitHub 交付【改】
- workflow：`permissions: {id-token:write, contents:read, pages:write}` + `concurrency` + `environment: github-pages`；先 `npm test` 再部署；actions 按 commit SHA 固定
- 【改】Pages 源需切到 "GitHub Actions"：`gh api repos/:owner/:repo/pages -X POST -f build_type=workflow`
- `gh repo create` 仅需已认证 gh（scope: repo），**零 secret/PAT 依赖**（OIDC id-token）
- 【改】版权决策：仓库公开 + LICENSE MIT(代码) + `data/NOTICE.md`(关卡数据属 LOK Digital，仅供研究，不授权分发)；README 隐私声明（本地处理/无cookie/0网络请求）
- `.gitignore`：node_modules/*.log/.DS_Store/游戏二进制/导出

## 12. 实施步骤
1. 提取数据：levelCSV → data/levels.js（脚本+断言+指纹表）
2. engine + parse + 单测（含 round-trip、错误契约）
3. solver + 全量151回归迭代修复
4. solver-mono（世界13）、世界12 推箱
5. animate + ui + draw + 页面
6. bundle-single 单文件产物 + 浏览器手工验收（含移动端）
7. git 初始化整理提交
8. gh repo create + push + 配置 Pages，验证线上

## 13. 交付物
- GitHub 仓库 + 在线 Pages 地址（含单文件降级）
- README + LICENSE + data/NOTICE + ASCII_FORMAT 规范
- 测试报告（通过率 + 对地验证记录）
