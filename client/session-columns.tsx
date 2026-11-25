import { t } from "../shared/text";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentProps, type ComponentRef, type ReactElement, type ReactNode, type Ref } from "react";
import { Animated, Easing, Platform, Pressable, Text, View, type LayoutChangeEvent } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { FlatList, Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { columnGeometry, RECENT_THREAD_LIMIT, SESSION_COLUMN } from "../shared/dashboard-model";
import { GroupHeader, SessionRowItem, groupTitles, type SessionItem } from "./session-list";
import { aria, fontSize, hairline, isDarkTheme, space } from "./kit";
import { useReducedMotion } from "./motion";
import { useHostLabels } from "./hosts";
import type { HeartbeatSummary } from "../shared/schedules";
import type { RecapView } from "../shared/recap";

/** 会话抽屉聚焦回列表行时要用到的 ref。 */
type PressableRef = ComponentRef<typeof Pressable>;
type RowItem = Extract<SessionItem, { kind: "row" }>;
/** `SessionRowItem` 的公共环境（除 `item`/`pressRef`），列、列尾「最近」共用一份。 */
type RowEnv = Omit<ComponentProps<typeof SessionRowItem>, "item" | "pressRef">;

export interface SessionColumnsData {
  attention: RowItem[]; running: RowItem[];
  /** 「最近」折叠段最多展示 `RECENT_THREAD_LIMIT` 个顶层线程；`recentHidden` 是折掉的数量。 */
  recent: RowItem[]; threads: { attention: number; running: number; recent: number }; recentHidden: number;
}
export interface SessionColumnsHandle { /** 抽屉关闭后把焦点还给刚选的卡。 */ focusRow(agentId: string): void }

/** Tracks top-level thread ids and claims the entrance of a single new arrival (单个新线程 160 ms 短入场). */
function useArrivals(resetKey: string, topIds: readonly string[]): (id: string) => boolean {
  const seen = useRef<{ ids: Set<string>; loaded: boolean; reset: string } | null>(null);
  const fresh = useRef(new Set<string>());
  // Reset on filter changes: 筛选出的「新」线程是揭示，不是新消息（审美定稿）。
  if (!seen.current || seen.current.reset !== resetKey) seen.current = { ids: new Set(topIds), loaded: topIds.length > 0, reset: resetKey };
  else {
    const state = seen.current;
    if (!state.loaded) state.loaded = topIds.length > 0; // 首次装载直接就位
    else {
      const added = topIds.filter(id => !state.ids.has(id));
      if (added.length === 1) fresh.current.add(added[0]!); // 批量更新（2 个及以上）不入场
    }
    for (const id of topIds) state.ids.add(id);
  }
  return useCallback((id: string) => { if (!fresh.current.has(id)) return false; fresh.current.delete(id); return true; }, []);
}

/** Fades the new thread's first card in and up 4 px into place, once (160 ms, 审美定值); consumed at mount so scrolling back never replays. */
function Arrive({ claim, children }: { claim: () => boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  const [animate] = useState(() => claim() && !reduce);
  const value = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    const animation = Animated.timing(value, { toValue: 1, duration: 160, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" });
    animation.start();
    return () => animation.stop();
  }, [animate, value]);
  if (!animate) return <>{children}</>;
  return <Animated.View style={{ opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }}>{children}</Animated.View>;
}

/** 「最近」折叠段：细分隔线、灰色时钟、标题、展开箭头；默认展开，最多 20 个顶层线程（仍受当前时间窗筛选）。无记录整段隐藏。 */
function RecentFold({ theme, threads, rows, hidden, open, onToggle, env, limit }: {
  theme: PluginTheme; threads: number; rows: RowItem[]; hidden: number; open: boolean; onToggle: () => void; env: RowEnv; limit: number;
}) {
  const { colors } = theme;
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={t(open ? "secondarySessionColumns.collapseRecent" : "secondarySessionColumns.expandRecent")} accessibilityState={{ expanded: open }} {...aria({ expanded: open })} onPress={onToggle}
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs + 2, minHeight: 32, marginTop: space.sm, paddingHorizontal: space.md, paddingTop: space.sm, borderTopWidth: hairline, borderTopColor: colors.border }}>
      <Icon name="History" size={12} color={colors.foregroundMuted} />
      <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta, fontWeight: "600" }}>{groupTitles.recent}</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta, fontVariant: ["tabular-nums"] }}>{threads}</Text>
      <View style={{ flex: 1 }} />
      <Icon name={open ? "ChevronDown" : "ChevronRight"} size={12} color={colors.foregroundMuted} />
    </Pressable>
    {open ? <>
      {rows.map(item => <SessionRowItem key={item.key} item={item} {...env} />)}
      {hidden > 0 ? <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta, lineHeight: 17, paddingHorizontal: space.md, paddingTop: space.xs }}>
        {t("secondarySessionColumns.recentLimit", { count: limit })}
      </Text> : null}
    </> : null}
  </View>;
}

function Column({ group, title, threads, rows, empty, footer, env, claim, extraData, width, flex }: {
  group: "attention" | "running"; title: string; threads: number; rows: RowItem[]; empty: string; footer?: ReactElement | null; env: RowEnv;
  claim: (id: string) => boolean; extraData: string; width?: number; flex?: boolean;
}) {
  const { theme } = env;
  return <View style={[{ minHeight: 0 }, flex ? { flex: 1 } : { width }]}>
    <GroupHeader theme={theme} group={group} title={title} count={threads} />
    <FlatList data={rows} keyExtractor={item => item.key} style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ paddingTop: space.xs, paddingBottom: space.xl }}
      initialNumToRender={18} maxToRenderPerBatch={20} windowSize={7} keyboardShouldPersistTaps="handled" extraData={extraData}
      ListEmptyComponent={<Text style={{ color: theme.colors.foregroundMuted, fontSize: fontSize.small, lineHeight: 19, paddingHorizontal: space.md, paddingTop: space.xs }}>{empty}</Text>}
      ListFooterComponent={footer}
      renderItem={({ item }) => {
        const row = <SessionRowItem item={item} {...env} />;
        // 只有新顶层线程的首卡入场；子行、滚动重挂载、树展开都直接就位。
        return item.row.depth === 0 ? <Arrive claim={() => claim(item.key)}>{row}</Arrive> : row;
      }} />
  </View>;
}

/**
 * 方案 A 的会话板：左「执行中」右「需要处理」等宽竖排，列头（GroupHeader）钉在各自顶部；「最近」只在需要处理
 * 列尾默认展开。可用宽度容不下两列 320 px 时板区横向滚到第二列，单列不缩。列底亮色 surface1、暗色 surface0。
 */
export const SessionColumns = memo(forwardRef(function SessionColumns({ theme, columns, filtered, resetKey, now, selectedId, expanded, forceExpanded, signals, rates, heartbeats, recaps, recapsRevision, marked, serverId, navigation, onToggle, onSelect }: {
  theme: PluginTheme; columns: SessionColumnsData; filtered: boolean; resetKey: string; now: number; selectedId: string | null; expanded: ReadonlySet<string>;
  forceExpanded?: boolean; signals: ReadonlyMap<string, string>; rates?: ReadonlyMap<string, number>; heartbeats?: ReadonlyMap<string, HeartbeatSummary[]>;
  recaps?: ReadonlyMap<string, RecapView>; recapsRevision?: string; marked?: ReadonlySet<string>; serverId?: string; navigation?: PluginSurfaceProps["navigation"];
  onToggle: (agentId: string) => void; onSelect: (agentId: string) => void;
}, ref) {
  const { colors } = theme;
  const [width, setWidth] = useState(0);
  const [recentOpen, setRecentOpen] = useState(true);
  const rows = useRef<Map<string, PressableRef>>(new Map());
  useImperativeHandle(ref, () => ({
    focusRow: (agentId: string) => { const node = rows.current.get(agentId) as { focus?: () => void } | undefined; node?.focus?.(); },
  }), []);
  const hostLabels = useHostLabels();
  // Rows re-render only when a shown rate changes (rounded to 0.1 tok/s) — same extraData contract as SessionList.
  const ratesKey = useMemo(() => [...(rates ?? [])].map(([id, rate]) => `${id}:${rate.toFixed(1)}`).join(","), [rates]);
  const extraData = `${now}:${selectedId}:${expanded.size}:${forceExpanded}:${signals.size}:${ratesKey}:${heartbeats?.size ?? 0}:${marked?.size ?? 0}:${recapsRevision}:${hostLabels.size}`;
  const topIds = useMemo(() => [...columns.attention, ...columns.running].filter(item => item.row.depth === 0).map(item => item.row.node.agent.id), [columns]);
  const claim = useArrivals(resetKey, topIds);
  const env: RowEnv = { theme, compact: false, selectedId, expanded, forceExpanded, now, signals, rates, heartbeats, recaps, marked, serverId, navigation, onToggle, onSelect };
  const geometry = useMemo(() => columnGeometry(width || 2 * SESSION_COLUMN.min + SESSION_COLUMN.gap + 2 * SESSION_COLUMN.inset), [width]);
  const onLayout = (event: LayoutChangeEvent) => setWidth(Math.round(event.nativeEvent.layout.width));
  const emptyOf = (group: "attention" | "running") => filtered ? t("secondarySessionColumns.emptyFiltered")
    : group === "attention" ? t("secondarySessionColumns.emptyAttention") : t("secondarySessionColumns.emptyRunning");
  const recent = columns.threads.recent > 0
    ? <RecentFold theme={theme} threads={columns.threads.recent} rows={columns.recent} hidden={columns.recentHidden} open={recentOpen}
      onToggle={() => setRecentOpen(value => !value)} env={env} limit={RECENT_THREAD_LIMIT} />
    : null;
  const shared = { env, claim, extraData };
  return <View onLayout={onLayout} style={{ flex: 1, minHeight: 0, backgroundColor: isDarkTheme(theme) ? colors.surface0 : colors.surface1 }}>
    {geometry.sideBySide
      ? <View style={{ flex: 1, minHeight: 0, flexDirection: "row", gap: space.sm, paddingHorizontal: SESSION_COLUMN.inset }}>
        <Column group="running" title={groupTitles.running} threads={columns.threads.running} rows={columns.running} empty={emptyOf("running")} flex {...shared} />
        <Column group="attention" title={groupTitles.attention} threads={columns.threads.attention} rows={columns.attention} empty={emptyOf("attention")} footer={recent} flex {...shared} />
      </View>
      : <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexDirection: "row", gap: space.sm, paddingHorizontal: SESSION_COLUMN.inset, minHeight: "100%" }}>
        <Column group="running" title={groupTitles.running} threads={columns.threads.running} rows={columns.running} empty={emptyOf("running")} width={geometry.columnWidth} {...shared} />
        <Column group="attention" title={groupTitles.attention} threads={columns.threads.attention} rows={columns.attention} empty={emptyOf("attention")} footer={recent} width={geometry.columnWidth} {...shared} />
      </ScrollView>}
  </View>;
}));
