#!/usr/bin/env node
import { listPorts, openPort, helloHandshake, wakeHandshake, debugQuery, sleep } from './io.mjs';
import {
  NEUTRAL_REPORT,
  A_PRESS_REPORT,
  STICK_UP_REPORT,
  WAKE_COMMAND,
  REPLY_ACK,
  REPLY_ERROR,
  bytesToHex,
} from './packets.mjs';

const USAGE = `NS2 Studio 串口冒烟工具 (S0)

用法:
  ns2-smoke list
  ns2-smoke hello <port>
  ns2-smoke neutral <port>
  ns2-smoke press-a <port>
  ns2-smoke stick-up <port>
  ns2-smoke wake <port>
  ns2-smoke debug <port>
  ns2-smoke report <port> <hex...>

子命令:
  list                    列出可用串口
  hello <port>            打开 115200（失败回退 9600），发 [A5 81] 最多 3 次，
                          等待 0x80 (Reply.Hello) 并打印 RX hex
  neutral <port>          发送中立 report
  press-a <port>          A 按下 → 100ms → 释放回中立
  stick-up <port>         左摇杆上 (LY=0) → 500ms → 回中立
  wake <port>             发 [A5 92] 唤醒休眠主机（CMD_WAKE 0x92，等待约 1s）：
                          RX FF=成功（已唤醒/未休眠）；RX 00 0X=失败+原因码
  debug <port>            读 CMD_DEBUG（含 USB 状态：挂载/挂起/唤醒使能位、
                          suspend/umount 回调计数）
  report <port> <hex...>  发送任意 7bit 报文字节（如 00 00 01 08 04 02 01 80）

示例:
  ns2-smoke list
  ns2-smoke hello COM3
  ns2-smoke press-a COM3
  ns2-smoke wake COM3`;

function normalizePortPath(path) {
  const m = /^COM(\d+)$/i.exec(path);
  if (m && Number(m[1]) > 9) return `\\\\.\\${path}`;
  return path;
}

function parseHexArgs(args) {
  const bytes = [];
  for (const a of args) {
    if (!/^[0-9a-fA-F]{1,2}$/.test(a)) {
      throw new Error(`无效 hex 字节: "${a}"（应为 1-2 位十六进制）`);
    }
    bytes.push(Number.parseInt(a, 16));
  }
  return bytes;
}

async function sendOnce(path, bytes) {
  const { port, baudRate } = await openPort(normalizePortPath(path));
  try {
    console.log(`已打开 ${path} @ ${baudRate}`);
    port.write(Buffer.from(bytes));
    console.log(`TX: ${bytesToHex(bytes)}`);
    await sleep(100);
  } finally {
    port.close();
  }
}

async function sendAndHold(path, downBytes, holdMs) {
  const { port, baudRate } = await openPort(normalizePortPath(path));
  try {
    console.log(`已打开 ${path} @ ${baudRate}`);
    port.write(Buffer.from(downBytes));
    console.log(`TX(down): ${bytesToHex(downBytes)}`);
    await sleep(holdMs);
    port.write(Buffer.from(NEUTRAL_REPORT));
    console.log(`TX(up/neutral): ${bytesToHex(NEUTRAL_REPORT)}`);
    await sleep(50);
  } finally {
    port.close();
  }
}

async function cmdList() {
  const ports = await listPorts();
  if (ports.length === 0) {
    console.log('未发现串口。请将 ESP32-S3 标 "com" 的 USB-C 口连到电脑后重试。');
    return;
  }
  for (const p of ports) {
    const desc = p.friendlyName || p.manufacturer || '';
    console.log(`${p.path}${desc ? `\t${desc}` : ''}`);
  }
}

async function cmdHello(path) {
  const { port, baudRate } = await openPort(normalizePortPath(path));
  try {
    console.log(`已打开 ${path} @ ${baudRate}`);
    const result = await helloHandshake(port);
    console.log(`RX: ${bytesToHex(result.rx)}`);
    console.log(
      result.ok ? '握手成功：收到 0x80 (Reply.Hello)' : '超时：未收到 0x80 (Reply.Hello) 回复'
    );
  } finally {
    port.close();
  }
}

async function cmdWake(path) {
  const { port, baudRate } = await openPort(normalizePortPath(path));
  try {
    console.log(`已打开 ${path} @ ${baudRate}`);
    console.log(`TX: ${bytesToHex(WAKE_COMMAND)}  （等待固件执行 USB 恢复 + HOME 短按…）`);
    const result = await wakeHandshake(port);
    console.log(`RX: ${bytesToHex(result.rx)}`);
    if (result.rx.includes(REPLY_ACK)) {
      console.log('结果：0xFF — 主机已唤醒（或本就未休眠）✅');
    } else if (result.rx.includes(REPLY_ERROR)) {
      const idx = result.rx.indexOf(REPLY_ERROR);
      const reason = result.rx[idx + 1];
      const reasonText =
        reason === 0x01
          ? '设备未挂载（NS 侧原生 USB 未连接/未枚举）'
          : reason === 0x02
            ? '主机未启用有线远程唤醒（remote_wakeup_en=0，需兜底策略 B1 换 VID/PID）'
            : reason === 0x03
              ? 'USB 恢复失败/超时（tud_remote_wakeup 后总线未恢复）'
              : reason === 0x04
                ? '模拟重插拔后主机未响应连接事件（休眠中端口无监测）'
                : '未知原因';
      console.log(`结果：0x00 — 唤醒失败${reason !== undefined ? `（原因码 0x0${reason}：${reasonText}）` : '（固件过旧，无原因码）'}`);
    } else {
      console.log('结果：超时无响应');
    }
  } finally {
    port.close();
  }
}

async function cmdDebug(path) {
  const { port, baudRate } = await openPort(normalizePortPath(path));
  try {
    console.log(`已打开 ${path} @ ${baudRate}`);
    const result = await debugQuery(port);
    const tail = result.rx.slice(-17);
    const flags = tail[14] ?? 0;
    const susp = tail[15] ?? 0;
    const resm = tail[16] ?? 0;
    console.log(`RX: ${bytesToHex(tail)}`);
    console.log(
      `USB 状态: mounted=${flags & 0x01 ? 1 : 0} suspended=${flags & 0x02 ? 1 : 0} wakeup_en=${flags & 0x04 ? 1 : 0} | suspend_cb=${susp} resume_cb=${resm}`,
    );
  } finally {
    port.close();
  }
}

function needPort(rest, command) {
  const port = rest[0];
  if (!port) throw new Error(`缺少串口参数。用法: ns2-smoke ${command} <port>`);
  return port;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    return;
  }
  try {
    switch (cmd) {
      case 'list':
        await cmdList();
        break;
      case 'hello':
        await cmdHello(needPort(rest, cmd));
        break;
      case 'wake':
        await cmdWake(needPort(rest, cmd));
        break;
      case 'debug':
        await cmdDebug(needPort(rest, cmd));
        break;
      case 'neutral':
        await sendOnce(needPort(rest, cmd), NEUTRAL_REPORT);
        break;
      case 'press-a':
        await sendAndHold(needPort(rest, cmd), A_PRESS_REPORT, 100);
        break;
      case 'stick-up':
        await sendAndHold(needPort(rest, cmd), STICK_UP_REPORT, 500);
        break;
      case 'report': {
        const port = needPort(rest, cmd);
        const hexArgs = rest.slice(1);
        if (hexArgs.length === 0) {
          throw new Error(`缺少 hex 参数。用法: ns2-smoke report <port> <hex...>`);
        }
        await sendOnce(port, parseHexArgs(hexArgs));
        break;
      }
      default:
        throw new Error(`未知子命令 "${cmd}"。运行 "ns2-smoke --help" 查看用法。`);
    }
  } catch (err) {
    console.error(`[错误] ${err.message}`);
    process.exitCode = 1;
  }
}

await main();