# @ns2-studio/pad-types

无硬件依赖的归一化手柄状态类型与常量。安装：`pnpm add @ns2-studio/pad-types`。测试：`pnpm --filter @ns2-studio/pad-types test`。

```ts
import { PadReport, NEUTRAL_REPORT, SwitchButton, SwitchHat } from "@ns2-studio/pad-types";
const report: PadReport = { ...NEUTRAL_REPORT, buttons: SwitchButton.A, hat: SwitchHat.LEFT };
```

按键/摇杆位值与 `docs/architecture/02-PROTOCOL.md` 及 EasyCon 一致。