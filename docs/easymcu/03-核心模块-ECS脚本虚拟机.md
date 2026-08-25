# 03 — 核心模块深度：ECS 脚本虚拟机（`easycon/easycon.c` 后半部）

> 前置阅读：`00-总览` 第 5.3 节、`02-串口协议` 第 5 节。
> 这是整个固件最烧脑的部分：一台运行在 512 字节内存上的微型虚拟机（VM），逐条解释执行 EasyCon 编译出的字节码。
> 完整源码对照：`easycon.c:72-445`。

---

## 1. 背景：什么是 ECS 字节码

EasyCon 的上位机软件里，用户写的是**脚本语言 ECS**（如 `Press(A, 50ms)`、`Wait(100ms)`、`for` 循环、`if` 判断）。PC 端把它**编译成 2 字节定长的指令流**，通过 `CMD_FLASH` 烧进芯片。芯片上电后（或收到 `CMD_SCRIPTSTART` 后），本文件实现的小型解释器**逐条取指、解码、执行**。

> 类比：ECS = Java 源码，字节码 = class 文件，这个文件 = JVM 解释器（阉割版）。

脚本头部 2 字节是元信息（见第 4 节），真正指令从地址 2 开始。执行到 `script_addr >= script_eof` 即结束。

---

## 2. 虚拟内存布局（512 字节 `mem[]`）

`easycon.c:6` 的 `static uint8_t mem[MEM_SIZE]` 是 VM 的"内存条"，各区域用宏定义（`easycon.c:38-51`）：

| 区域 | 地址 | 大小 | 宏 | 用途 |
|------|------|------|-----|------|
| 脚本头 | 0..1 | 2B | `EasyCon_read_byte(0/1)` | EOF 长度 + 自动运行标志 |
| 摇杆查表 | 20..51 | 32B | `DX(i)/DY(i)` | 32 个方向 → 摇杆坐标 |
| 按键计时器 | 90..123 | 34B | `KEY(i)` | 33 个键各自的"按住剩余毫秒" |
| 寄存器 | 130..179 | 50B | `REG(i)` | 25 个 int16 寄存器 R1~R25 |
| 数据栈 | 180..229 | 50B | `STACK(i)` | 脚本 push/pop |
| 调用栈 | 230..289 | 60B | `CALLSTACK(i)` | 30 个返回地址（函数调用） |
| FOR 栈 | 290.. | 16B/帧 | `FOR_I/ADDR/NEXT/C` | 循环控制块 |

```c
#define DX(i) (mem[20 + (i) * 2])
#define DY(i) (mem[21 + (i) * 2])
#define KEY(i) (mem[90 + (i)])
#define REG(i) (*(int16_t *)(mem + 130 + ((i) - 1) * 2))
#define STACK(i) (mem[180 + (i)])
#define CALLSTACK(i) (*(int16_t *)(mem + 230 + (i) * 2))
#define FOR_I(i) (*(int32_t *)(mem + 290 + (i) * 16))    // 迭代变量
#define FOR_ADDR(i) (*(uint16_t *)(mem + 294 + (i) * 16))// 循环体起始地址
#define FOR_NEXT(i) (*(uint16_t *)(mem + 296 + (i) * 16))// FORC 指令地址
#define FOR_C(i) (*(int32_t *)(mem + 298 + (i) * 16))    // 循环次数上限
```

> ⚠️ 观察：`FOR` 栈按 16 字节/帧计算，第 14 帧起（`mem[290+13*16=498]`）就会超出 512 字节边界。当前固件对 >13 层嵌套循环存在越界隐患——EasyCon 编译器的实际嵌套深度通常远小于此，但移植/加固时值得留意。

**状态变量**（`easycon.c:25-36`）：

| 变量 | 作用 |
|------|------|
| `_ins0/_ins1/_ins_word/_ins_dword` | 当前指令（2 或 4 字节） |
| `_addr` | 当前指令地址 |
| `_script_addr` | 程序计数器 PC |
| `_e_val` | "E 寄存器"：给下一条指令传递动态参数（见第 7 节） |
| `_v/_flag` | 比较结果 / 条件标志（if 用） |
| `_forstackindex/_callstackindex/_stackindex` | 三个栈的栈顶指针 |
| `_seed` | 随机数种子（持久化在 NVS） |
| `wait_ms` | 当前等待剩余毫秒（1ms tick 递减） |
| `tail_wait` | "尾部等待"（按键尾段） |
| `timer_ms/timer_elapsed` | 运行计时 |

---

## 3. 指令解码总览

**每条指令 2 字节**（`_ins0 _ins1`，小端合成 `_ins_word`）。第一字节的最高位决定大类：

```
_ins0 bit7 = 1  →  输入指令（按键/摇杆 + 时长）     第 5 节
_ins0 bit7 = 0  →  控制指令（操作码 = (_ins0>>3)&0xF） 第 6 节
```

解码入口在 `EasyCon_script_task()`（`easycon.c:148-445`），一个 `while(1)` 循环，流程：

```
while (1) {
    脚本未运行 → return
    正在等待(wait_ms>0) → return        ← 延时靠"让出 CPU"实现
    ① KEY 计时器倒计时 → 到 0 的自动松开
    ② tail_wait 处理
    ③ PC 超界 → 停止
    ④ 取指：_ins0=mem[addr++], _ins1=mem[addr++]
    ⑤ 解码执行
}
```

---

## 4. 脚本头（地址 0..1）与启动

```c
// 启动时（easycon.c:127-139）
script_addr = 2;                          // PC 从第 2 字节开始
uint16_t eof = read(0) | (read(1)<<8);    // 头 2 字节 = 脚本长度
if (eof == 0xFFFF) eof = 0;               // 0xFFFF = 无脚本
script_eof = eof & 0x7FFF;                // bit15 是标志位，长度只用 15 位
```

**bit15 = 禁止自动运行标志**：

```c
// 初始化时（easycon.c:99）
auto_run = (EasyCon_read_byte(1) >> 7) == 0;   // bit15=0 → 开机自动运行
```

`EasyCon_script_start()` 还会：清零 PC 以下全部状态、清空寄存器区（`mem+130` 起 382 字节）、重读种子。

---

## 5. 输入指令（bit7=1）：让手柄动起来

### 5.1 按键类（bit6=0，`easycon.c:190-215`）

```
keycode = (_ins0 >> 1) & 0x1F      // 5 位按键编号
```

- `keycode` 0..15 → 按钮：`press_buttons(1 << keycode)`（**按下**，不松开）
- `keycode` 16..31 → 方向键：`set_HAT_switch(keycode & 0xF)`
- 置 `_report_echo = ECHO_TIMES` 通知 PC 状态已变

**时长解码**（4 种模式）：

| 条件 | 含义 | 代码 |
|------|------|------|
| E 寄存器已设 | 时长 = `REG(_e_val)` 毫秒（动态） | `SETWAIT(REG(_e_val)); RESETAFTER(key,1)` |
| `_ins0.bit0 == 0` | 短按：`_ins1 × 10ms` | `n=_ins1; n*=10; SETWAIT(n); RESETAFTER(key,1)` |
| `_ins0.bit0==1` 且 `_ins1.bit7==0` | 中段等待 50ms + 尾段 `_ins1&0x7F × 50ms` | `tail_wait=...*50; SETWAIT(50); RESETAFTER(key,1)` |
| `_ins0.bit0==1` 且 `_ins1.bit7==1` | 按住 `_ins1&0x7F` 毫秒**不等待**（连发） | `RESETAFTER(key, _ins1&0x7F)` |

**KEY 计时器自动松开机制**（`easycon.c:154-171`）：

```c
for (i = 0; i <= KEYCODE_MAX; i++)       // 33 个键逐个倒计时
    if (KEY(i) != 0) {
        KEY(i)--;
        if (KEY(i) == 0) {               // 到 0 → 松开
            if (i == 32)      set_left_stick(128,128);   // 左摇杆回中
            else if (i == 33) set_right_stick(128,128);  // 右摇杆回中
            else if ((i&0x10)==0) release_buttons(1<<i); // 按钮抬起
            else              set_HAT_switch(8);         // 方向回中
            _report_echo = ECHO_TIMES;
        }
    }
```

`RESETAFTER(key, n)` 就是 `KEY(key) = n`。所以"按 100ms" = 按下 + `KEY=100` + 等 100ms，tick 每秒 1000 次把 KEY 减到 0 自动松开。**硬件上没有真实"按住"，全靠这套软件定时器模拟。**

### 5.2 摇杆类（bit6=1，`easycon.c:217-238`）

```
lr        = (_ins0 >> 5) & 1     // 0=左摇杆 1=右摇杆
direction = _ins0 & 0x1F         // 5 位方向编号（查表）
```

把摇杆打到 `DX(direction), DY(direction)`。时长模式同按键类，但**没有 ×10ms 短按档**（`_ins1.bit7==0` 时是 `×50ms`）。

**32 方向查表**（`easycon.c:81-96` 初始化）：

```c
// 前 16 项：上边缘 + 右边缘的圆角方块轨迹
for (i = 0; i < 16; i++) {
    x = Min(i, 8) << 5;              // 0,32,64,...,224
    y = (Max(i, 8) - 8) << 5;        // 前 8 个 y=0，后 8 个 y=32..224
}
// 后 16 项：下边缘 + 左边缘（镜像）
for (i = 16; i < 32; i++) {
    x = (24 - Min(i, 24)) << 5;
    y = (32 - Max(i, 24)) << 5;
}
```

等价于 32 个落在"圆角方块"轮廓上的点（半径 0/32/64/96/128/160/192/224，封顶 255）。具体方向编号 ↔ 现实方向的对应关系由 **EasyCon 上位机的编译约定**决定（见 `EasyCon/docs/Script.md`），实机复核时记入 lab-note。

---

## 6. 控制指令（bit7=0）

操作码 `op = (_ins0>>3) & 0xF`。部分指令用 `_ins0.bit2/bit1` 扩展成 4 字节（多读 `_ins2 _ins3` 两字节）。

### 6.1 `op=0x0` 串口输出（`easycon.c:242-253`）

```
if (_ins0.bit2) {
    reg = _ins & 0x1FF;            // 9 位：寄存器号或内存地址
    if (_ins0.bit1 == 0) → 发送 reg 低字节、高字节   （发一个 int16 立即数）
    else                → 发送 mem[reg]、mem[reg+1] （发内存 2 字节）
}
```

脚本与 PC 通信的通道（如汇报进度）。

### 6.2 `op=0x1` 等待（`easycon.c:254-270`）

```
n 的取值优先级：
  E 寄存器已设 → REG(_e_val)          （动态时长）
  _ins0.bit2==0 → (_ins & 0x3FF) × 10  （10 位立即数，单位 10ms）
  _ins0.bit1==0 → 4 字节指令，(_insEx & 0x1FFFFFF) × 10   （25 位大立即数）
  其他         → _ins & 0x1FF         （9 位立即数，单位 1ms）
SETWAIT(n)
```

执行 `WAIT` 时只是 `SETWAIT` 后**立刻 return**，靠 `EasyCon_script_tick()` 每秒 1000 次递减 `wait_ms` 到 0 才继续——**延时期间 CPU 让给其他任务**，绝不忙等。

### 6.3 `op=0x2` FOR 循环初始化（`easycon.c:271-294`）

```c
if (_forstackindex == 0 || FOR_ADDR(top) != _addr) {   // 首次进入该 FOR？
    压栈一帧：FOR_I=0, FOR_ADDR=当前地址, FOR_NEXT=_ins&0x7FF
    if (E_SET) {                                       // 变量式循环
        _ri0 = REG(_e_val) & 0xF;                      // 低 4 位 = 起始变量 R#
        _ri1 = (REG(_e_val) >> 4) & 0xF;               // 高 4 位 = 上限变量 R#
        if (_ri0) FOR_I = _ri0 | 0x80000000;           // 标记"变量迭代"
        if (_ri1) { FOR_C = REG(_ri1); E(2); JUMP(FOR_NEXT); }
    }
    E(0); JUMP(FOR_NEXT);                              // 跳到循环体
}
```

- `FOR_NEXT` = 紧跟 FOR 的 **FORC 指令地址**（循环检查点）
- 首次执行 → 初始化后**跳到 FORC**；再次执行（被 FORC 跳回）→ 栈顶地址匹配 → 什么都不做、落到下一条（即 FORC）

### 6.4 `op=0x3` FORC 循环检查（`easycon.c:295-331`）

```c
if (E_SET) {
    if (_e_val == 1) { _forstackindex--; }        // break：弹栈退出
    else if (_e_val == 0) { FOR_C = 立即数; }      // 设置次数上限（0→无限）
} else {
    if (FOR_I & 0x80000000) REG(FOR_I&0xF) += 1;  // 变量迭代：寄存器自增
    else                    FOR_I += 1;           // 普通迭代：计数器自增
}
n = (变量式) ? REG(...) : FOR_I;
if (FOR_C != 0x80000000 && n >= FOR_C) _forstackindex--;  // 到次数 → 弹栈
else JUMP(FOR_ADDR);                                        // 否则跳回 FOR 继续
```

配合 6.3，循环结构为：

```
FOR:  初始化（首次）→ 跳到 FORC
FORC: 计数+1 → 没到上限 → 跳回 FOR →（FOR 幂等）落到 FORC → 循环体
      到上限 → 弹栈 → 落到循环体之后（退出）
```

> `0x80000000` 是两个哨兵值：FOR_I 用它标记"变量迭代"；FOR_C 用它表示"无限循环"。

### 6.5 `op=0x4` 比较 / 分支 / 返回（`easycon.c:332-376`）

**寄存器比较**（`_ins0.bit2=1`）：

```
_ri0=(_ins1>>3)&7, _ri1=_ins1&7
比较：_ins0&3: 0=== 1=!= 2=< 3=<=   → 结果存 _v
组合：_ins1>>6: 0=flag=_v  1=flag&=_v  2=flag|=_v  3=flag^=_v
```

**分支**（`_ins1>>5`，`_ins1.bit4=1` 时需 `_flag` 才执行）：

| 值 | 动作 |
|----|------|
| 0 | 弹 `_ins1&0xF` 层 FOR 栈 + `E(1)` + 跳到 FORC（**break N 层**） |
| 1 | 弹 N 层 + 跳到 FORC（continue） |
| 7 | **函数返回**：`JUMP(CALLSTACK(--callstackindex))`；栈空 → 停止脚本 |

### 6.6 `op=0x5` 算术（`easycon.c:377-427`）

四种子格式由 `_ins0` 的低位区分：

| 格式 | 条件 | 内容 |
|------|------|------|
| 立即数二元 | `bit2==0` | `REG(ri0) op= 32位立即数`（ri0=(_ins>>7)&7, op=(_ins>>3)&7） |
| 寄存器二元 | `bit2==1 && bit1==0` | `REG(ri0) op= REG(ri1)` |
| 移位 | `bit2==1 && bit1==1` | `bit7==0 → REG <<= n` / `bit7==1 → REG >>= n` |
| 一元 | 其他 | 见下表 |

`binaryop` 的 8 个操作码（`easycon.c:447-459`）：

```
0x0=赋值 0x1=加 0x2=乘 0x3=除 0x4=取模 0x5=按位与 0x6=按位或 0x7=异或
```

一元操作（`_ins1>>3` 的低 4 位）：

| 值 | 操作 |
|----|------|
| 0x02 | `REG = -REG`（取负） |
| 0x03 | `REG = ~REG`（按位取反） |
| 0x04 | 压栈：`STACK[stackindex++] = REG` |
| 0x05 | 弹栈：`REG = STACK[--stackindex]` |
| 0x07 | `E(ri0)`：设置 E 寄存器（下一条指令用它当参数） |
| 0x08 | `REG = (REG != 0)`（布尔化） |
| 0x09 | **随机数**：`REG = rand() % REG`（种子见 6.8） |

### 6.7 `op=0x6` 跳转 / 调用（`easycon.c:428-441`）

```c
reg = (_ins & 0x1FF) << 7 >> 6;   // 9 位立即数 → 符号扩展的 10 位相对偏移（×2 步长）
switch ((_ins0>>1) & 0x3) {
    case 0x0: JUMPNEAR(reg); break;                    // 无条件跳
    case 0x1: if (_flag) JUMPNEAR(reg); break;         // flag=真 跳
    case 0x2: if (!_flag) JUMPNEAR(reg); break;        // flag=假 跳
    case 0x3: CALLSTACK[callstackindex++] = script_addr;  // 调用：压返回地址
              JUMPNEAR(reg); break;
}
```

偏移乘以 2 是因为**指令是 2 字节对齐的**。

### 6.8 随机数种子（`easycon.c:413-424`）

```c
if (!_seed) {                        // 种子为 0（首次/异常）
    _seed = timer_ms;                // 用运行时钟做种子
    ... 持久化到 NVS（SEED_OFFSET=512）...
    srand(_seed);
}
REG(_ri0) = rand() % REG(_ri0);
```

种子每次开机自增 1（`easycon.c:72-78`），保证挂机脚本的随机序列不重复。

---

## 7. E 寄存器机制（动态参数）

`E(reg)` 只是设 `_e_val = reg`，**下一条指令**在执行时读取 `REG(_e_val)` 作为自己的参数（时长/循环变量/次数），用完后自行 `E(0)` 清除。

场景举例（EasyCon ECS 大致对应）：

| ECS 意图 | 字节码形态 |
|----------|-----------|
| `Press(A, E(R3))` | 设 E=3 → 按键指令（时长=REG(3)） |
| `for i=R1 to R2` | 设 E=xx → FOR 指令（变量式循环） |
| `break` | 设 E=1 → FORC 指令（弹栈） |
| `Wait(E(R5))` | 设 E=5 → WAIT 指令（动态延时） |

> 这本质是 EasyCon 编译器解决"立即数不足"的手段：把参数塞进寄存器再传。

---

## 8. 时序与节流总结

```
tick_task（1ms 一次）
  ├─ timer_ms++
  ├─ echo_ms--              （HID 发送闸门）
  └─ wait_ms--              （脚本等待倒计时）

script_task（连续执行）
  ├─ wait_ms>0 → 挂起，等下个 tick
  ├─ KEY 倒计时 → 自动松开
  ├─ tail_wait → 转为 wait_ms
  └─ 取指执行 → 回到循环头
```

**为什么脚本不会饿死其他任务**：`WAIT` 会主动 return；而连续的非等待指令（如纯算术）在 `script_task` 里以优先级 3 运行，可被 tick/收发任务抢占（FreeRTOS 抢占式调度）。

---

## 9. 与其他模块的接口

| 函数 | 作用 | 调用方 |
|------|------|--------|
| `EasyCon_script_task()` | VM 主循环 | `main.c` script_task |
| `EasyCon_tick()` | 1ms 心跳（timer/echo/wait 递减） | `main.c` tick_task |
| `EasyCon_script_start/stop()` | 启停（stop 时 `reset_hid_report` 防卡键） | 串口命令 `0x83/0x84` |
| `set_*/press_*/release_*` | 修改 8 字节手柄报告 | VM 内部 |
| `EasyCon_serial_send()` | 脚本 → PC 通信 | VM 内部 |

---

## 10. 关键认知总结

1. **这是软件定时器驱动的"伪实时"手柄**：所有按键时长都是 `KEY` 计数 + 1ms tick 模拟的，不是硬件引脚动作。
2. **延时 = 让出 CPU**：VM 永不忙等，WAIT 只是把状态挂到 `wait_ms` 上。
3. **三套栈 + 一套寄存器的微型图灵机**：25 个 int16 寄存器 + 数据栈 + 调用栈 + FOR 栈，支撑起 ECS 的变量/函数/循环。
4. **哨兵值编码**：`0x80000000`（变量迭代 / 无限循环）与 `E(1)/E(2)`（break / 跳过）是字节码层面的协议约定。
5. **潜在风险**：FOR 栈 16 帧 × 16B 会越过 512 字节边界（>13 层嵌套循环越界）；`rand()%REG` 在 REG=0 时未定义行为——加固时优先处理。
6. **与 ns2-studio 的关系**：S0b 固件若要兼容 EasyCon 脚本生态，需要实现同一套字节码语义；S1 协议包只涉及串口命令层，不涉及 VM。

---

## 11. 相关代码位置

| 功能 | 位置 |
|------|------|
| 内存布局宏 | `easycon.c:38-51` |
| 初始化（种子/查表/自动运行） | `easycon.c:72-100` |
| 启动/停止 | `easycon.c:126-146` |
| VM 主循环 + 全部解码 | `easycon.c:148-445` |
| 二元运算 | `easycon.c:447-459` |