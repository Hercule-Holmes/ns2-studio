import { createRouter, createWebHashHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import DevicePage from "./pages/DevicePage.vue";
import PadPage from "./pages/PadPage.vue";
import TimelinePage from "./pages/TimelinePage.vue";
import AmiiboPage from "./pages/AmiiboPage.vue";
import SettingsPage from "./pages/SettingsPage.vue";

/**
 * Single source of truth for navigation (sidebar is driven from here).
 * Future sessions add hub / timeline / capture routes to this array.
 */
export interface NavItem {
  path: string;
  title: string;
  name: string;
}

export const NAV_ITEMS: NavItem[] = [
  { path: "/device", title: "设备", name: "device" },
  { path: "/pad", title: "手柄", name: "pad" },
  { path: "/timeline", title: "时间轴", name: "timeline" },
  { path: "/amiibo", title: "Amiibo", name: "amiibo" },
  { path: "/settings", title: "设置", name: "settings" },
];

const PAGE_COMPONENTS: Record<string, unknown> = {
  device: DevicePage,
  pad: PadPage,
  timeline: TimelinePage,
  amiibo: AmiiboPage,
  settings: SettingsPage,
};

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/device" },
  ...(NAV_ITEMS.map((item) => ({
    path: item.path,
    name: item.name,
    component: PAGE_COMPONENTS[item.name],
  })) as RouteRecordRaw[]),
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});