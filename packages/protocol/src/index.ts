export { EzDvCommand, Reply, SAVE_AMIIBO_PACKET_SIZE } from "./constants";
export {
  decodeReportPacket,
  encodeReport,
  type DecodedPacket,
} from "./encodeReport";
export {
  buildChangeAmiiboIndexFrame,
  buildHelloFrame,
  buildSaveAmiiboMetaFrame,
  buildWakeFrame,
} from "./commands";

import { EzDvCommand } from "./constants";
import {
  buildChangeAmiiboIndexFrame,
  buildHelloFrame,
  buildSaveAmiiboMetaFrame,
  buildWakeFrame,
} from "./commands";

export const commands = {
  ready: (): Uint8Array => Uint8Array.from([EzDvCommand.Ready]),
  hello: buildHelloFrame,
  wake: buildWakeFrame,
  changeAmiiboIndex: buildChangeAmiiboIndexFrame,
  saveAmiiboHeader: buildSaveAmiiboMetaFrame,
};