# S17 — 手机端操控重构（横屏 Overlay）

| 字段 | 值 |
|------|-----|
| **Status** | `in_progress`（一期实现完成，真机横屏手感待验收） |
| **Priority** | P2 |
| **Depends on** | S14 |
| **Owns** | `apps/remote-client/**` |
| **Estimate** | 0.5–1 天 |

> 背景：竖屏双列布局按键目标过小、画面与操作视觉分离、右摇杆缺失。
> 参考 Moonlight / PS Remote Play / Steam Link 的 overlay 范式。

## 1. 一期改动（2026-10-20）

- [x] **横屏 Overlay 布局 v2（定稿）**：弃用 v1 的「cluster 底部锚定」，
      改为商业方案（Moonlight Switch 布局 / Steam Link）的
      **对角镜像 + 百分比锚点**体系——7 个独立组（肩键左/右、HOME/CAP 中上、
      左摇杆、十字、ABXY、右摇杆）`position:absolute + left/top 百分比 +
      translate(-50%,-50%)` 定位：
      - 左摇杆 x14%/y38%（高）、十字键 x14%/y76%（低）
      - ABXY x86%/y38%（高）、右摇杆 x86%/y76%（低）
      - L/ZL、MINUS/LS 贴左上缘；R/ZR、RS/PLUS 贴右上缘（食指区）
      - HOME/CAP 顶部中央
      - 两根摇杆**有意不等高**（对角镜像，Pro Controller 实物布局），
        拇指停驻中位、上翻下翻各够一个；控件最低点在 76% 高度，远离底边
- [x] **右摇杆补全**（功能缺口）：`state.ts` 增加 `setRightStick`
      （rx/ry 协议字段本就存在）；`gamepad.ts` 摇杆接线抽为通用
      `wireStick(binding)`，左右各一
- [x] **竖屏保底**：同一 DOM 用 grid-template-areas 回排双列
      （肩键/摇杆+ABXY/十字+右摇杆/HOME+CAP 沉底）
- [x] footer 撤销：「接管控制 / 唤醒 NS」收进顶部状态栏（`.mini-btn`）
- [x] **全屏模式**：右上角 ⛶ 按钮 → Fullscreen API + 横屏锁定（安卓）+
      隐藏状态栏；系统手势退出自动同步；iOS 降级为仅藏状态栏
- [x] live 状态下视频 overlay 收缩为右上角「关闭画面」小按钮
- [x] 控件透明度 0.62（按用户反馈两轮下调 0.85→0.78→0.62）

v1 教训：底部锚定 + flex 堆叠导致左右 cluster 高度不等（右多一个 sys 行），
补偏移的 hack 越调越怪；百分比锚点 + 对角镜像一次到位。

## 2. 二期（后置，未排期）

- [ ] 震动反馈（`navigator.vibrate`，iOS 降级）
- [ ] 摇杆动态原点（按下处即中心，Steam Link 式）
- [ ] 双击画面显隐全部控件
- [ ] 控件位置/大小/透明度自定义持久化
- [ ] 屏幕边缘上滑 = ZL/ZR（拇指不离摇杆）
- [ ] 长按连发

## 3. 验收

- [ ] 横屏真机：控件不遮关键画面、双摇杆同时可用、多指不串扰
- [ ] 竖屏保底：布局完整、按钮可按
- [ ] 控制链路回归：接管 → 按键/双摇杆 → 桌面端响应正确

## 4. 进度日志

| 日期 | 笔记 |
|------|------|
| 2026-10-20 | 一期实现：横屏 overlay 布局、右摇杆补全、竖屏保底、状态栏按钮化 |
