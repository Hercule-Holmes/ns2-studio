import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        // Workspace packages ship TS sources (S1 contract); bundle them so the
        // main output is self-contained instead of `require()`-ing .ts files.
        exclude: [
          "@ns2-studio/protocol",
          "@ns2-studio/pad-types",
          "@ns2-studio/timeline-model",
        ],
      }),
    ],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [vue()],
  },
});