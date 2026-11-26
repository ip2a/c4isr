import { useI18n } from "./i18n-client";
import { t } from "../shared/text";
import { Platform, StyleSheet, Text, View, type TextStyle } from "react-native";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { SidebarStatusRing } from "./sidebar-ring";
import { attentionCount, useAttentionStore, useAttentionView, type AttentionStores } from "./use-attention";
import { useAgentActivity } from "./use-agent-activity";

// The eager sidebar owns only these two palette shades, never the full UI kit.
function darkTheme(theme: PluginTheme) {
  const hex = theme.colors.surface0.replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return false;
  const full = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex;
  const rgb = [0, 2, 4].map(index => { const value = parseInt(full.slice(index, index + 2), 16) / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]! < Math.sqrt(0.0525) - 0.05;
}
const hueColor = (theme: PluginTheme, hue: "red" | "amber" | "blue", text = false) => darkTheme(theme) ? hue === "red" ? "#FB7185" : hue === "amber" ? "#FBBF24" : "#60A5FA" : hue === "red" ? text ? "#BE123C" : "#F43F5E" : hue === "amber" ? text ? "#B45309" : "#D97706" : "#2563EB";


// Same shell as the board's status chips (border + quiet fill): icon + number, no label text.
const badgeStyle = { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, minHeight: 28, paddingHorizontal: 10, borderRadius: 6, borderWidth: Platform.OS === "web" ? 1 : StyleSheet.hairlineWidth } as const;
const numberStyle: TextStyle = { fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] };

/**
 * 「C4ISR」 in the sidebar with the host's two counts (opus-B1, the tasks board's sidebar style): 需要处理 a hollow amber
 * ring (red when something failed or hit a limit) and 执行中 a turning blue ring beside it, plain numbers, no chip, so
 * nothing reads as a button. The numbers are honest: none until the server has read the directory, none after a failed or
 * old read, 「N+」 when the directory was too large to read whole. The row opens the panel.
 */
export function ObservatorySidebarItem({ theme, host, currentScreen, openScreen, stores }: PluginSidebarItemProps & { stores: AttentionStores }) {
  useI18n();
  const store = useAttentionStore(stores, host.id), view = useAttentionView(store);
  // While the page is open its directory observation reports changes; the badge follows them at once.
  // 1s debounce (default 3s): the badge is the sidebar's first impression; the RPC short-circuits on an unchanged revision.
  useAgentActivity(() => { void store.refresh(); }, 1_000);
  const count = attentionCount(view), state = view.state;
  const live = view.foreground !== false;
  // The counts share one gate: shown only while the last read is good, so 执行中 never shows stale either.
  const waiting = count && count.value > 0, running = count ? state?.running ?? 0 : 0;
  const loud = !!state?.loud, waitColor = hueColor(theme, loud ? "red" : "amber"), runColor = hueColor(theme, "blue");
  const attention = waiting ? <View accessibilityLabel={t("boot.secondaryNeedYouViewAgents", { count: count.label })} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
    <SidebarStatusRing color={waitColor} />
    <Text style={{ ...numberStyle, color: hueColor(theme, loud ? "red" : "amber", true) }}>{count.label}</Text>
  </View> : null;
  const executing = running > 0 ? <View accessibilityLabel={t("boot.secondaryRunningAgents", { count: running })} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
    <SidebarStatusRing color={runColor} running active={live} />
    <Text style={{ ...numberStyle, fontWeight: "400", color: theme.colors.foregroundMuted }}>{running}</Text>
  </View> : null;
  const trailing = attention || executing ? <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>{attention}{executing}</View> : null;
  return <SidebarRow label={t("boot.screenTitle")} icon="Ship" active={currentScreen?.screenId === "observatory"} onPress={() => { void store.refresh(); openScreen({ screenId: "observatory" }); }} trailing={trailing} />;
}

/** 「定时运行」 with the failed runs of the last 24 hours (heartbeats apart), red; nothing when none or unknown. */
export function ScheduleSidebarItem({ theme, host, currentScreen, openScreen, stores }: PluginSidebarItemProps & { stores: AttentionStores }) {
  useI18n();
  const store = useAttentionStore(stores, host.id), view = useAttentionView(store);
  const failures = attentionCount(view) ? view.state?.scheduleFailures ?? 0 : 0;
  const trailing = failures > 0 ? <View accessibilityLabel={t("boot.secondaryScheduledRunsFailedInTheLast", { count: failures })} style={{ ...badgeStyle, borderColor: theme.colors.border, backgroundColor: "transparent" }}>
    <Icon name="CalendarClock" size={12} color={hueColor(theme, "red")} />
    <Text style={{ ...numberStyle, color: hueColor(theme, "red", true) }}>{failures}</Text>
  </View> : null;
  return <SidebarRow label={t("boot.schedulesTitle")} icon="CalendarClock" active={currentScreen?.screenId === "schedule-runs"} onPress={() => openScreen({ screenId: "schedule-runs" })} trailing={trailing} />;
}
