import { createRouter, createWebHashHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import type { LucideIcon } from "lucide-vue-next";
import {
  Usb,
  Gamepad2,
  SlidersHorizontal,
  ScanLine,
  MonitorSmartphone,
  Settings,
  CalendarClock,
} from "lucide-vue-next";
import DevicePage from "./pages/DevicePage.vue";
import PadPage from "./pages/PadPage.vue";
import TimelinePage from "./pages/TimelinePage.vue";
import AmiiboPage from "./pages/AmiiboPage.vue";
import RemotePage from "./pages/RemotePage.vue";
import SettingsPage from "./pages/SettingsPage.vue";
import PlaytimePage from "./pages/PlaytimePage.vue";

/**
 * Single source of truth for navigation (sidebar is driven from here).
 * S18: items carry a lucide icon for the Switch-style sidebar.
 */
export interface NavItem {
  path: string;
  title: string;
  name: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { path: "/device", title: "设备", name: "device", icon: Usb },
  { path: "/pad", title: "手柄", name: "pad", icon: Gamepad2 },
  { path: "/timeline", title: "时间轴", name: "timeline", icon: SlidersHorizontal },
  { path: "/amiibo", title: "Amiibo", name: "amiibo", icon: ScanLine },
  { path: "/remote", title: "远程", name: "remote", icon: MonitorSmartphone },
  { path: "/playtime", title: "游玩记录", name: "playtime", icon: CalendarClock },
  { path: "/settings", title: "设置", name: "settings", icon: Settings },
];

const PAGE_COMPONENTS: Record<string, unknown> = {
  device: DevicePage,
  pad: PadPage,
  timeline: TimelinePage,
  amiibo: AmiiboPage,
  remote: RemotePage,
  playtime: PlaytimePage,
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
