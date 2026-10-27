import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./styles.css";
import { reportRendererError } from "./error-boundary";
import { applyTheme } from "./composables/use-theme";

const app = createApp(App);

// S18: apply the persisted theme before first paint of routed content.
void window.api.settings.get().then((settings) => {
  applyTheme(settings.theme ?? "dark");
});

// Global renderer error boundary (S11): any uncaught renderer exception is
// logged to the main-process crash log (userData/logs/crash.log) and shown in
// a full-screen overlay with a reload action.
app.config.errorHandler = (err, _instance, _info) => {
  reportRendererError(err);
};

window.addEventListener("error", (event) => {
  reportRendererError(event.error ?? new Error(event.message));
});
window.addEventListener("unhandledrejection", (event) => {
  reportRendererError(event.reason ?? new Error("unhandledrejection"));
});

app.use(router).mount("#app");