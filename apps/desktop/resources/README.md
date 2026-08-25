# Resources

本目录存放打包所需素材（图标等）。

## 图标（待补）

当前**没有图标素材**，打包使用 electron-builder 的默认 Electron 图标。

补图后：

1. 放入本目录，例如 `icon.ico`（Windows 需 ≥256x256，建议 512x512 多尺寸）。
2. 在 `electron-builder.yml` 的 `win.icon` 中填写路径（当前被注释说明）。
3. 重新打包验证产物图标。

> 不要提交大体积 PSD/SVG 源件；只提交最终 `icon.ico`/`icon.png`。