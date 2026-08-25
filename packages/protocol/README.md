# @ns2-studio/protocol

PC↔MCU 协议库：Report 7bit 打包、命令帧构造与常量。仅依赖 `@ns2-studio/pad-types`，不含 Node/串口 API。安装：`pnpm add @ns2-studio/protocol`。测试：`pnpm --filter @ns2-studio/protocol test`。

```ts
import { encodeReport, buildHelloFrame, buildSaveAmiiboMetaFrame } from "@ns2-studio/protocol";
const packet = encodeReport(NEUTRAL_REPORT); // 00 00 01 08 04 02 01 80
```

字节布局与 `docs/architecture/02-PROTOCOL.md` 及 EasyCon `SwitchReport`/`NintendoSwitchCmd` 对拍，见 `test/vectors.json`。