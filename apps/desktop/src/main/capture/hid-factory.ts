import { isNs2ProVidPid } from "./ns2-pro-parser";
import type { HidDeviceInfo, HidDeviceLike } from "./types";
import { NodeHidLayer, loadNodeHid } from "./node-hid-layer";

/**
 * Enumerate HID devices and filter for the wired NS2 Pro (VID 0x057E /
 * PID 0x2069 per lab-note §2). Safe mode (0x2072) is excluded — it only
 * exposes a single vendor interface and is not a capture path.
 */
export async function listNs2ProDevices(): Promise<HidDeviceInfo[]> {
  const hid = await loadNodeHid();
  const list = await hid.devicesAsync();
  return list
    .filter((d) => isNs2ProVidPid(d.vendorId, d.productId) && !!d.path)
    .map((d) => ({
      path: d.path as string,
      vid: d.vendorId,
      pid: d.productId,
      product: d.product,
      manufacturer: d.manufacturer,
      serialNumber: d.serialNumber,
    }));
}

export async function openNs2ProDevice(info: HidDeviceInfo): Promise<HidDeviceLike> {
  return NodeHidLayer.open(info);
}