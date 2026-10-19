import { defineConfig } from "vite";

// Build straight into the desktop app's out/ tree: the RemoteGateway serves
// this directory as the phone client (08-REMOTE.md §8). `out/**` is what
// electron-builder packages, so nothing extra is needed for distribution.
export default defineConfig({
  base: "./",
  build: {
    outDir: "../../apps/desktop/out/remote-client",
    emptyOutDir: true,
    target: "es2020",
  },
});
