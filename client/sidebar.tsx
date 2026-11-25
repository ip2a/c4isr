import { useI18n } from "./i18n-client";
import { t } from "../shared/text";
import { useMemo, type ComponentType } from "react";
import { Platform, Pressable, StyleSheet, Text, View, type TextStyle } from "react-native";
import type { PluginPopoverProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { BadgePing } from "./sidebar-ping";
import { attentionCount, useAttentionStore, useAttentionView, type AttentionStore, type AttentionStores } from "./use-attention";
import { useAgentActivity } from "./use-agent-activity";

// The eager sidebar owns only these two palette shades, never the full UI kit.
function darkTheme(theme: PluginTheme) {
  const hex = theme.colors.surface0.replace(/^#/, "");
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return false;
  const full = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex;
  const rgb = [0, 2, 4].map(index => { const value = parseInt(full.slice(index, index + 2), 16) / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]! < Math.sqrt(0.0525) - 0.05;
}
const hueColor = (theme: PluginTheme, hue: "red" | "amber", text = false) => darkTheme(theme) ? hue === "red" ? "#FB7185" : "#FBBF24" : hue === "red" ? text ? "#BE123C" : "#F43F5E" : text ? "#B45309" : "#D97706";


// Same shell as the board's status chips (border + quiet fill): icon + number, no label text.
const badgeStyle = { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, minHeight: 28, paddingHorizontal: 10, borderRadius: 6, borderWidth: Platform.OS === "web" ? 1 : StyleSheet.hairlineWidth } as const;
const numberStyle: TextStyle = { fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] };

/**
 * 「C4ISR」 in the sidebar with the host's 需要处理 count (opus-B1): chip-styled count (amber / red text, not a solid block),
 * radiating while an approval, a question or a plan blocks an Agent. The number is honest: none until the server has read
 * the directory, none after a failed or old read, 「N+」 when the directory was too large to read whole. The count opens
 * a popover (a sheet on phones) of the longest-waiting Agents, each with its one-line reason; a tap opens that Agent.
 */
export function ObservatorySidebarItem({ theme, host, currentScreen, openScreen, openPopover, stores, AttentionPopover }: PluginSidebarItemProps & { stores: AttentionStores; AttentionPopover: ComponentType<PluginPopoverProps & { store: AttentionStore }> }) {
  useI18n();
  const store = useAttentionStore(stores, host.id), view = useAttentionView(store);
  // While the page is open its directory observation reports changes; the badge follows them at once.
  useAgentActivity(() => { void store.refresh(); });
  const count = attentionCount(view), state = view.state;
  const Popover = useMemo(() => function AttentionPopoverItem(props: PluginPopoverProps) { return <AttentionPopover {...props} store={store} />; }, [store, AttentionPopover]);
  const loud = !!state?.loud, mark = hueColor(theme, loud ? "red" : "amber"), text = hueColor(theme, loud ? "red" : "amber", true);
  const trailing = count && count.value > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={t("boot.secondaryNeedYouViewAgents", { count: count.label })} onPress={() => openPopover(Popover)} hitSlop={6}
    style={pressed => ({ ...badgeStyle, borderColor: theme.colors.border, backgroundColor: pressed.pressed ? theme.colors.surface1 : "transparent", opacity: pressed.pressed ? 0.8 : 1 })}>
    {state?.blocking ? <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}><BadgePing size={20} color={mark} active={view.foreground !== false} /></View> : null}
    <Icon name="BellRing" size={12} color={mark} />
    <Text style={{ ...numberStyle, color: text }}>{count.label}</Text>
  </Pressable> : null;
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

export function ArchivesSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  useI18n();
  return <SidebarRow label={t("boot.archivesTitle")} icon="Archive" active={currentScreen?.screenId === "archives"} onPress={() => openScreen({ screenId: "archives" })} />;
}
