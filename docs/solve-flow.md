# Solve 求解流程图

## 主流程

```mermaid
flowchart TD
    A["solve(level, opts)"] --> B{"world === 13?"}
    B -->|是| C["solveMonuments(level)"]
    B -->|否| D{"world === 12?"}
    D -->|是| E["solveArrows(level, opts)"]
    D -->|否| F["makeBoard(level) 构造盘面"]
    F --> G["precheck 预检"]
    G -->|已解| H["return {solved}"]
    G -->|无字母| I["return {nosol}"]
    G -->|未知| J["初始化: memo Map, best, stack, maxDepth=16"]
    J --> K["stack.push({cells, steps: [], depth:0})"]

    K --> L{"stack.length > 0?"}
    L -->|否| M["return {exhausted}"]

    L -->|是| N["frame = stack.pop()"]
    N --> O{"budget.check()? ⏱️"}
    O -->|否| P["return {timeout}"]
    O -->|是| Q{"depth > maxDepth?"}
    Q -->|是| L

    Q -->|否| R{"memo.has(key)?"}
    R -->|是| L

    R -->|否| S["memo.set(key, true)"]
    S --> T{"isSolved(cells)?"}
    T -->|是| U["return {solved, steps} ✓"]

    T -->|否| V["更新 best 进度"]
    V --> W["遍历 WORD_LIBRARY"]
    W --> X["findPlacements 找拼法"]
    X --> Y{"有拼法?"}
    Y -->|否| Z["尝试下一个词"]
    Z --> W

    Y -->|是| AA["遍历 placements"]
    AA --> AB["applyWord 应用效果"]
    AB --> AC["diffCells 计算变化"]
    AC --> AD["stack.push 新状态"]
    AD --> AE{"budget.check()?"}
    AE -->|否| P
    AE -->|是| AA

    W -->|所有词尝试完| AF{"pushed > 0?"}
    AF -->|否| AG["budget.exhausted = true"]
    AF -->|是| L
    AG --> L
```

## findPlacements 路径枚举

```mermaid
flowchart TD
    FP_A["findPlacements(grid, word, cols, rows)"] --> FP_B["初始化: results[], stack, maxRec"]
    FP_B --> FP_C["遍历所有起点格"]
    FP_C --> FP_D{"可点击? 匹配首字母?"}
    FP_D -->|否| FP_C
    FP_D -->|是| FP_E["stack.push({path: [start], idx:1})"]

    FP_E --> FP_F{"stack.length > 0?"}
    FP_F -->|否| FP_R["return results"]

    FP_F -->|是| FP_G["pop state: {path, idx}"]
    FP_G --> FP_H{"searchCount > maxRec?"}
    FP_H -->|是| FP_R
    FP_H -->|否| FP_I{"idx === wordLength?"}
    FP_I -->|是| FP_J["results.push({tiles: path})"]
    FP_J --> FP_F

    FP_I -->|否| FP_K["directionFrom(path) 推导方向"]
    FP_K --> FP_L["遍历 DIRS (4方向)"]
    FP_L --> FP_M{"canProceed? 方向合法?"}
    FP_M -->|否| FP_L
    FP_M -->|是| FP_N["nextInDir 直线找下一个格"]
    FP_N --> FP_O{"next 存在? 不是自己? 不回溯?"}
    FP_O -->|否| FP_L
    FP_O -->|是| FP_P{"next 类型?"}

    FP_P -->|"X 导体"| FP_QX["stack.push({path+[next], idx})"]
    FP_QX --> FP_L
    FP_P -->|"? 通配"| FP_QQ["二分: stack.push(消耗, idx+1) + stack.push(通过, idx)"]
    FP_QQ --> FP_L
    FP_P -->|"字母匹配"| FP_QL["stack.push({path+[next], idx+1})"]
    FP_QL --> FP_L
```

## applyWord 词效果应用

```mermaid
flowchart TD
    AW_A["applyWord(grid, word, placement)"] --> AW_B["wdef = WORD_LIBRARY[word]"]
    AW_B --> AW_C["tileCells = 过滤消耗的格子"]
    AW_C --> AW_D["board = applyBlackout 涂黑消耗格"]
    AW_D --> AW_E{"wdef 类型?"}

    AW_E -->|"globalLetter (TA)"| AW_TA["枚举所有存在的字母类型"]
    AW_TA --> AW_TA2["每种字母: 涂黑该类型的所有格"]
    AW_TA2 --> AW_TA3["生成多个结果板"]

    AW_E -->|"createLetter (BE)"| AW_BE["找所有空位 BLANK"]
    AW_BE --> AW_BE2["每个空位 × 每个有用字母"]
    AW_BE2 --> AW_BE3["生成带新字母的结果板"]

    AW_E -->|"diagonal (LOLO)"| AW_LO["找所有非空格 anchor"]
    AW_LO --> AW_LO2["每个唯一对角线: 涂黑对角线上所有格"]
    AW_LO2 --> AW_LO3["生成结果板"]

    AW_E -->|"onion (ABA)"| AW_AB["每个非空格: 加HP或解黑"]
    AW_AB --> AW_AB2["生成结果板"]

    AW_E -->|"clouds (W)"| AW_W["以 W 为参照, 复制形状到其他 anchor"]
    AW_W --> AW_W2["涂黑 W 和对应形状格"]

    AW_E -->|"extra=1 (LOK)"| AW_E1["枚举候选格, 每个额外涂黑1格"]
    AW_E -->|"extra=2 (TLAK)"| AW_E2["枚举同行/同列格对, 额外涂黑2格"]
    AW_E -->|"extra=0 (GRIVA)"| AW_E0["无额外效果"]
```

## 单词效果总览

| 词    | spell | 效果              | 说明                              |
| ----- | ----- | ----------------- | --------------------------------- |
| LOK   | LOK   | extra=1           | 涂黑 L,O,K + 额外1格              |
| TLAK  | TLAK  | extra=2, adjacent | 涂黑 T,L,A,K + 同行/列的2格       |
| TA    | TA    | globalLetter      | 涂黑 T,A + 全盘同字母格           |
| BE    | BE    | createLetter      | 涂黑 B,E + 在一个空位上创建新字母 |
| LOLO  | LOLO  | diagonal          | 涂黑 L,O,L,O + 某对角线全清       |
| ABA   | ABA   | onion             | 涂黑 A,B,A + 任选一格 +/- 洋葱层  |
| GRIVA | GRIVA | —                | 涂黑 G,R,I,V,A                    |
| W     | W     | clouds            | 涂黑 W + 以W为模板复制涂黑        |
