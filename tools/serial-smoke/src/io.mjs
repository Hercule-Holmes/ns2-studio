import { HELLO_COMMAND, REPLY_HELLO } from './packets.mjs';

const BAUD_CANDIDATES = [115200, 9600];

async function getSerialPort() {
  try {
    return await import('serialport');
  } catch (err) {
    throw new Error(
      `无法加载 serialport 模块，请先在 tools/serial-smoke 下运行 "pnpm add serialport"。原因: ${err.message}`
    );
  }
}

export async function listPorts() {
  const { SerialPort } = await getSerialPort();
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer ?? '',
    serialNumber: p.serialNumber ?? '',
    friendlyName: p.friendlyName ?? '',
  }));
}

export async function openPort(path) {
  const { SerialPort } = await getSerialPort();
  let lastError;
  for (const baudRate of BAUD_CANDIDATES) {
    try {
      const port = await new Promise((resolve, reject) => {
        const p = new SerialPort({
          path,
          baudRate,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
          autoOpen: true,
        });
        const onOpen = () => {
          cleanup();
          resolve(p);
        };
        const onError = (err) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          p.removeListener('open', onOpen);
          p.removeListener('error', onError);
        };
        p.on('open', onOpen);
        p.on('error', onError);
      });
      return { port, baudRate };
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `无法打开串口 "${path}"（尝试 115200 与 9600 均失败）：${lastError?.message ?? lastError}`
  );
}

export function waitForBytes(port, { timeoutMs = 1000, predicate, beforeWait }) {
  return new Promise((resolve) => {
    const rx = [];
    const finish = (ok) => {
      clearTimeout(timer);
      port.removeListener('data', onData);
      resolve({ ok, rx: [...rx] });
    };
    const onData = (chunk) => {
      rx.push(...chunk);
      if (predicate(rx)) finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    port.on('data', onData);
    if (beforeWait) beforeWait();
  });
}

export async function helloHandshake(port) {
  return waitForBytes(port, {
    predicate: (rx) => rx.includes(REPLY_HELLO),
    beforeWait: () => {
      for (let i = 0; i < 3; i++) port.write(Buffer.from(HELLO_COMMAND));
    },
  });
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}