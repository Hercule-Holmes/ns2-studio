#!/usr/bin/env node
import { listPorts, openPort, helloHandshake, sleep } from './io.mjs';
import {
  NEUTRAL_REPORT,
  A_PRESS_REPORT,
  STICK_UP_REPORT,
  bytesToHex,
} from './packets.mjs';

const USAGE = `NS2 Studio 串口冒烟工具 (S0)

用法:
  ns2-smoke list
  ns2-smoke hello <port>
  ns2-smoke neutral <port>
  ns2-smoke press-a <port>
  ns2-smoke stick-up <port>
  ns2-smoke report <port> <hex...>

子命令:
  list                    列出可用串口
  hello <port>            打开 115200（失败回退 9600），发 [A5 81] 最多 3 次，
                          等待 0x80 (Reply.Hello) 并打印 RX hex
  neutral <port>          发送中立 report
  press-a <port>          A 按下 → 100ms → 释放回中立
  stick-up <port>         左摇杆上 (LY=0) → 500ms → 回中立
  report <port> <hex...>  发送任意 7bit 报文字节（如 00 00 01 08 04 02 01 80）

示例:
  ns2-smoke list
  ns2-smoke hello COM3
  ns2-smoke press-a COM3`;

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