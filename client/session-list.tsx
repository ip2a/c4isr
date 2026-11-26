import { joinList } from "../shared/i18n";
import { t } from "../shared/text";
import { memo, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode, type Ref } from "react";
import { Animated, Easing, Platform, Pressable, Text, View, type FlatList as NativeFlatList, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { FlatList, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { HABITS_DEFAULTS, habitsSettings } from "../shared/habits";
import { acknowledgement, completionReadState, contextPressure, knownCompletionAt, ownTurnRunning, parentServerOf, type AgentRecord, type AgentTodo, type AgentTreeNode } from "../shared/model";
import { markCompletionRead, type ReadReceipt } from "../shared/read-state";
import { readReceiptQueryKey } from "./use-read-receipts";
import { useInvalidateAttention } from "./attention-context";
import { recapLook, type RecapView } from "../shared/recap";
import { RecapLine } from "./recap";
import type { DashboardGroup, DashboardRow } from "../shared/dashboard-model";
import { reasonLine, type AttentionPhase, type ReasonLine } from "../shared/attention";
import type { HeartbeatSummary } from "../shared/schedules";
import { HueDot, MetaLine, aria, fontSize, hairline, hueFor, isDarkTheme, radius, relativeTime, space } from "./kit";
import { providerLine, readLabel, shortDuration, stateName } from "./ui";
import { Pop, useChangeCount, useReducedMotion } from "./motion";
import { LiveTimer, PhasePill, PhaseTag, SnoozeCountdown, Spinner, StatusGlyph, activePhases, clock, hueColor, phaseOf, phases, tint, tintAlpha, type Hue, type Phase } from "./status";
import { ScheduleBadge } from "./schedule-looks";
import { HeartbeatBadge } from "./heartbeat-card";
import { openExternalUrl } from "./open-url";
import { CacheChip } from "./cache-clock";
import { useHostLabels } from "./hosts";

export const groupTitles: Record<DashboardGroup, string> = { get attention() { return t("secondarySessionList.needsYou"); }, get running() { return t("secondarySessionList.running"); }, get recent() { return t("secondarySessionList.recent"); } };
export type SessionItem =
  | { kind: "section"; key: string; group: DashboardGroup; title: string; count: number }
  /**
   * `childAttention`: descendants that need you, with the most urgent one's phase (`childPhase`), so a collapsed thread pulled
   * into 需要处理 says why; `childUnread`: the unread ones not among them (shared/attention.ts `threadAttention`).
   */
  | { kind: "row"; key: string; row: DashboardRow; childUnread: number; childAttention: number; childPhase: AttentionPhase | null; childRunning: number; snoozed: boolean; snoozeUntil: string | null };

/** Running turns show elapsed time; everything else the latest activity. */
export function agentTimeLabel(agent: AgentRecord, now: number): string {
  return agent.activeTurnStartedAt ? shortDuration(Math.max(0, now - Date.parse(agent.activeTurnStartedAt))) : relativeTime(agent.lastActivityAt || agent.updatedAt || agent.createdAt, now);
}
function countDescendants(row: DashboardRow, match: (agent: AgentRecord) => boolean): number {
  let count = 0;
  const stack: AgentTreeNode[] = [...row.node.children];
  while (stack.length) { const child = stack.pop()!; if (match(child.agent)) count++; stack.push(...child.children); }
  return count;
}
export const countRunningDescendants = (row: DashboardRow) => countDescendants(row, agent => agent.status === "running" || agent.status === "initializing");

/** Status caption beside the glyph (never the clock alone). */
function statusCaption(agent: AgentRecord, phase: Phase, signal: string | undefined, theme: PluginTheme): ReactNode {
  if (phase === "approval") return <PhaseTag theme={theme} phase={phase} count={agent.pendingPermissionCount} />;
  if (signal?.startsWith(t("secondarySessionList.failed"))) return <PhasePill theme={theme} hue="red" label={signal} />;
  if (signal && phase === "running") return <PhasePill theme={theme} hue="amber" label={signal} icon="Clock3" />;
  if (phase === "running" && agent.background && !agent.activeTurnStartedAt) {
    return <Text style={{ color: hueColor(theme, "blue", "text"), fontSize: fontSize.meta, fontWeight: "500" }}>{t("secondarySessionList.runningInBackground")}</Text>;
  }
  if (signal) return <PhasePill theme={theme} hue="amber" label={signal} icon="Clock3" />;
  return <PhaseTag theme={theme} phase={phase} />;
}

const DAY_MS = 86_400_000;
const pad2 = (value: number) => String(value).padStart(2, "0");

/** When the row entered its current phase (turn start, attention stamp, or last end). */
function statusSinceAt(agent: AgentRecord, phase: Phase): string | null {
  if (phase === "running" || phase === "starting") {
    return agent.activeTurnStartedAt ?? agent.background?.since ?? agent.lastActivityAt ?? agent.updatedAt ?? agent.createdAt;
  }
  if (activePhases.has(phase)) return agent.attentionTimestamp ?? agent.lastActivityAt ?? agent.updatedAt ?? agent.createdAt;
  return agent.observedTurnEndedAt ?? agent.lastActivityAt ?? agent.updatedAt ?? agent.createdAt;
}

/** Relative while under 24h; otherwise a local `YYYY-MM-DD HH:mm` stamp. */
function statusSinceLabel(iso: string | null, now: number): string {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  if (now - at >= DAY_MS) {
    const date = new Date(at);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }
  return relativeTime(at, now);
}

/** Elapsed run: live tick while working, otherwise observed turn span as `h:mm:ss`. */
function runElapsed(agent: AgentRecord, phase: Phase): { liveSince: string | null; fixedMs: number | null } {
  if ((phase === "running" || phase === "starting") && agent.activeTurnStartedAt) return { liveSince: agent.activeTurnStartedAt, fixedMs: null };
  if (phase === "running" && agent.background?.since) return { liveSince: agent.background.since, fixedMs: null };
  const start = Date.parse(agent.observedTurnStartedAt ?? ""), end = Date.parse(agent.observedTurnEndedAt ?? "");
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return { liveSince: null, fixedMs: end - start };
  return { liveSince: null, fixedMs: null };
}

/** The one-line reason under a row that needs you (opus-B3); a plain 未读 / 待回复 without the host's note says nothing new. */
function rowReason(agent: AgentRecord, phase: Phase, now: number): ReasonLine | null {
  if (!activePhases.has(phase) || phase === "running" || phase === "starting") return null;
  if ((phase === "unread" || phase === "idle") && !agent.note) return null;
  return reasonLine(agent, now);
}

/** Mix two `#rgb`/`#rrggbb` colors (the tasks board's `borderStrong` = border stepped 35% toward a muted foreground). */
function mixHex(a: string, b: string, amount: number): string {
  const parse = (hex: string) => { const raw = hex.replace(/^#/, ""); const full = raw.length === 3 ? raw.split("").map(c => c + c).join("") : raw; return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)); };
  const from = parse(a), to = parse(b);
  const channel = (index: number) => Math.round(from[index]! + (to[index]! - from[index]!) * amount).toString(16).padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** Memoized: a clock tick re-renders only rows whose time label or signal changed; running timers tick on their own. */
export const SessionRow = memo(function SessionRow({ item, theme, compact, selected, expanded, signal, rate, heartbeats, recap, day, now, marked = false, delegatedFrom = null, navigation, serverId, onToggle, onSelect, pressRef }: {
  item: Extract<SessionItem, { kind: "row" }>; theme: PluginTheme; compact: boolean; selected: boolean; expanded: boolean; signal?: string;
  /** Output tokens per second of a running agent (from the local provider logs), when it is writing. */
  rate?: number;
  /** Heartbeats that wake this Agent (opus-B8). */
  heartbeats?: readonly HeartbeatSummary[];
  /** Its 每轮小结, judged here against the turn the row shows. */
  recap?: RecapView | null;
  /** The device's day (a limit's row: the clock): reasons say 明天 / 今天 relative to it. */
  day: number;
  /** Wall clock for relative / stamp labels (timers tick on their own). */
  now: number;
  /** Picked for 归档已读完成 and waiting for the confirmation (opus-B18). */
  marked?: boolean;
  /** Delegated by an Agent on another host (Paseo 0.13): that host's name, "" when this app has not added it. */
  delegatedFrom?: string | null;
  /** The surface's navigation: the hover 打开 button opens the conversation tab with it (falls back to the drawer). */
  navigation?: PluginSurfaceProps["navigation"];
  /** This host's server id: marking read here refreshes this host's badge and 待办 at once. */
  serverId?: string;
  onToggle: (agentId: string) => void; onSelect: (agentId: string) => void;
  /** For the two-column board's Esc/focus-return: focus this row again when its drawer closes. */
  pressRef?: Ref<ComponentRef<typeof Pressable>>;
}) {
  const { colors } = theme;
  const { row, childUnread, childAttention, childPhase, childRunning, snoozed, snoozeUntil } = item;
  const agent = row.node.agent, children = row.node.children.length;
  const phase = phaseOf(agent, snoozed), active = activePhases.has(phase), color = hueColor(theme, phases[phase].hue);
  // 使用习惯 (2.19): the context thresholds are the host's `habits` setting; every row re-renders when they change.
  const habitStore = useSettings(habitsSettings), habitValues = habitStore.status === "ready" ? habitStore.values : HABITS_DEFAULTS;
  const reason = useMemo(() => rowReason(agent, phase, day), [agent, phase, day]);
  const look = useMemo(() => recap ? recapLook(recap, { startedAt: agent.observedTurnStartedAt ?? null, endedAt: agent.observedTurnEndedAt ?? null, running: ownTurnRunning(agent) }) : null, [recap, agent]);
  // A closed session's context matters only once it is loaded again, also when its row shows the turn the host cut off.
  const pressure = agent.archivedAt || agent.status === "closed" ? null : contextPressure(agent.usage, habitValues.contextHigh / 100, habitValues.contextCritical / 100);
  const link = agent.changeRequest ?? null;
  // Room the 「!128」 chip takes at the row's bottom right, so the meta or reason line never runs under it.
  const reserve = link ? 36 + 7 * link.label.length : 0;
  // A state change seen live pops the row's mark (the full-card color wash is gone — it read as lag).
  const changes = useChangeCount(phase);
  const caption = statusCaption(agent, phase, signal, theme);
  const elapsed = runElapsed(agent, phase);
  const since = statusSinceLabel(statusSinceAt(agent, phase), now);
  const depth = Math.min(row.depth, compact ? 3 : 6);
  const checkout = agent.branch ?? (agent.checkoutKind === "worktree" ? agent.worktreeName : null);
  // Project/workspace and the status-line clock already cover place and time; meta keeps branch + provider.
  const meta = depth === 0 ? [checkout, providerLine(agent)] : [providerLine(agent)];
  const settled = phase === "closed" || phase === "canceled" || phase === "snoozed";
  const sessionTitle = agent.title || t("secondarySessionList.unnamedAgent");
  const workspace = agent.workspaceName && agent.workspaceName !== agent.projectName ? agent.workspaceName : null;
  const pathParts = depth === 0 ? [agent.projectName, workspace].filter((part): part is string => !!part) : [];
  // Light: white card on gray list. Dark: raised surface on the darker wash (shadcn-like card bounds).
  const dark = isDarkTheme(theme), card = dark ? colors.surface1 : colors.surface0, cardHot = dark ? colors.surface2 : colors.surface1;
  // 外壳 state: hover lifts the card the tasks board's way (`surfaceLift`): no fill — the line steps stronger and the
  // shadow rises; keyboard focus draws a muted outline. `!hover` keeps the pointer click (which focuses too) ring-free.
  const [hover, setHover] = useState(false), [focused, setFocused] = useState(false);
  // 选中底色 100 ms 过渡（审美定值）；reduced motion lands on the end state at once.
  const reduce = useReducedMotion();
  const heat = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { heat.setValue(selected ? 1 : 0); return; }
    const animation = Animated.timing(heat, { toValue: selected ? 1 : 0, duration: 100, easing: Easing.out(Easing.quad), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [selected, reduce, heat]);
  // 悬停操作 (the tasks board's card footer): 标记已读 for an unread turn, 归档 for a quiet read one, 打开 always last.
  // The row keeps its height: the footer strip is reserved, buttons only fade in (4px drift) while hovered.
  const paseo = usePaseo(), toast = useToast(), queryCache = useQueryClient(), invalidateAttention = useInvalidateAttention();
  const markRead = useRpc(markCompletionRead);
  const [busy, setBusy] = useState<"read" | "archive" | null>(null);
  const readState = completionReadState(agent), ack = acknowledgement(agent, readState);
  const canRead = !marked && !!ack;
  // 归档 is one button in both states: a read row archives as is; an unread one marks read (receipt first) and archives.
  const canArchive = !marked && !agent.archivedAt && !active && (readState === "read" || canRead);
  const canOpen = !!navigation;
  const showActions = !compact && (canRead || canArchive || canOpen);
  const openConversation = () => {
    if (!navigation?.openAgent) { onSelect(agent.id); return; }
    const failed = (error: unknown) => toast.error(t("coreDashboard.couldNotOpenSession", { value1: error instanceof Error ? error.message : t("coreDashboard.tryAgainLater") }));
    try { Promise.resolve(navigation.openAgent({ agentId: agent.id })).catch(failed); } catch (error) { failed(error); }
  };
  // ponytail: no 结果更新 guard here (the row has no result data); the server answers `stale` and the drawer stays the rigorous path.
  const markReadCore = async (): Promise<boolean> => {
    if (!ack) return false;
    try {
      const completionAt = ack === "question" ? null : knownCompletionAt(agent);
      const round = ack === "question" ? { startedAt: agent.observedTurnStartedAt ?? null, endedAt: agent.observedTurnEndedAt ?? null } : null;
      const answer = await markRead({ agentId: agent.id, attentionTimestamp: agent.attentionTimestamp ?? null, lastUserMessageAt: agent.lastUserMessageAt,
        ...(ack === "problem" ? { kind: "error" as const } : {}), ...(completionAt ? { completionAt } : {}), ...(round ? { round } : {}) });
      if (answer.status === "read") {
        const receipt = answer.receipt as ReadReceipt | undefined;
        if (receipt) queryCache.setQueryData(readReceiptQueryKey, (previous: { receipts: ReadReceipt[]; error: string | null } | undefined) => ({ ...previous, receipts: [...(previous?.receipts ?? []).filter(item => item.agentId !== agent.id), receipt], error: null }));
        toast.show(answer.message, { variant: "success" });
      } else toast.error(answer.message);
      void queryCache.invalidateQueries({ queryKey: readReceiptQueryKey });
      if (serverId) invalidateAttention(serverId);
      return answer.status === "read";
    } catch (error) { toast.error(error instanceof Error ? error.message : t("coreAgentDetail.couldNotSyncReadStatus")); return false; }
  };
  const markReadOriginal = async () => {
    if (!ack) return;
    setBusy("read");
    try { await markReadCore(); }
    finally { setBusy(null); }
  };
  // 归档 is one button in both states: a read row archives as is; an unread one marks read (receipt first), then archives.
  const archiveOriginal = async () => {
    setBusy("archive");
    try {
      if (ack && !await markReadCore()) return;
      await paseo.agents.ref(agent.id).archive();
      toast.show(t("coreAgentDetail.archived"), { variant: "success" });
    }
    catch (error) { toast.error(error instanceof Error ? error.message : t("coreAgentDetail.couldNotArchiveTryAgain")); }
    finally { setBusy(null); }
  };
  const rise = useRef(new Animated.Value(hover ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { rise.setValue(hover ? 1 : 0); return; }
    const animation = Animated.timing(rise, { toValue: hover ? 1 : 0, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" });
    animation.start();
    return () => animation.stop();
  }, [hover, reduce, rise]);
  const actionStyle = (state: { pressed?: boolean }) => ({ flexDirection: "row" as const, alignItems: "center" as const, gap: 4, paddingVertical: 4, opacity: state.pressed ? 0.6 : 1 });
  const pressedHot = (state: { pressed?: boolean; hovered?: boolean }) => !!state.pressed;
  // Hover rides native `onMouseEnter/Leave` (forwarded by RN-web's View; `onHoverIn` only exists on Pressable, so it
  // never fired on a plain View). Touch web lacks `(hover: hover)` — skip the handlers there so a tap can't stick them.
  const media = (globalThis as { matchMedia?: (query: string) => { matches: boolean } }).matchMedia;
  const hoverable = Platform.OS !== "web" || (media?.("(hover: hover)").matches ?? true);
  const hoverHandlers = hoverable ? { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) } : undefined;
  return <View style={{ marginBottom: space.sm, ...(depth ? { marginLeft: 16 + (depth - 1) * 22, paddingLeft: 6, borderLeftWidth: hairline, borderLeftColor: colors.border } : undefined) }}>
    {/* One card shell wraps the row, the 子 Agent toggle and the hover actions (sibling buttons — web must not nest them).
        The shell owns the hover state: crossing between children keeps the footer out (no per-child flicker). */}
    <Animated.View {...hoverHandlers} style={{ borderRadius: radius.md, borderWidth: hairline,
      borderColor: selected ? colors.foreground : hover ? mixHex(colors.border, colors.foregroundMuted, 0.35) : colors.border,
      backgroundColor: heat.interpolate({ inputRange: [0, 1], outputRange: [card, cardHot] }), opacity: row.context ? 0.62 : 1, overflow: "hidden",
      // The tasks board's card shadow: a hair of rest shadow, rising to `0 2px 6px` on hover (no fill — the line carries it).
      boxShadow: hover ? `0px 2px 6px rgba(0, 0, 0, ${dark ? 0.38 : 0.14})` : `0px 1px 2px rgba(0, 0, 0, ${dark ? 0.18 : 0.06})`,
      ...(focused && !hover ? { outlineColor: colors.foregroundMuted, outlineWidth: hairline, outlineStyle: "solid", outlineOffset: 2 } : null) }}>
      <Pressable ref={pressRef} accessibilityRole="button" accessibilityLabel={t("secondarySessionList.view", { value1: sessionTitle, value2: stateName(agent), value3: marked ? t("secondarySessionList.awaitingArchive") : "" })} accessibilityState={{ selected }} {...aria({ selected })} onPress={() => onSelect(agent.id)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={state => ({ paddingTop: space.sm + 2, paddingBottom: children > 0 ? space.xs : space.sm + 2, paddingLeft: space.md, paddingRight: space.md,
          backgroundColor: pressedHot(state as { pressed?: boolean; hovered?: boolean }) ? cardHot : "transparent" })}>
        <View style={{ gap: space.xxs + 1 }}>
          {pathParts.length ? <Text numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: fontSize.meta, lineHeight: 17, fontWeight: "400" }}>
            {pathParts.map((part, index) => <Text key={`${part}:${index}`}>{index ? " > " : ""}{part}</Text>)}
          </Text> : null}
          <Text numberOfLines={2} style={{ color: settled ? colors.foregroundMuted : colors.foreground, fontSize: fontSize.body, lineHeight: 20, fontWeight: active ? "600" : "500" }}>{sessionTitle}</Text>
          <View accessibilityLabel={readLabel(agent)} style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.xxs + 1, minHeight: 18 }}>
            <Pop count={changes} size={10}><StatusGlyph theme={theme} phase={phase} size={10} /></Pop>
            {caption}
            {elapsed.liveSince || elapsed.fixedMs !== null ? <>
              <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta }}>·</Text>
              {elapsed.liveSince
                ? <LiveTimer since={elapsed.liveSince} color={hueColor(theme, "blue", "text")} />
                : <Text style={{ color: hueColor(theme, "blue", "text"), fontSize: fontSize.meta, fontWeight: "500", fontVariant: ["tabular-nums"] }}>{clock(elapsed.fixedMs!)}</Text>}
            </> : null}
            {snoozed && snoozeUntil && Date.parse(snoozeUntil) > now ? <>
              <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta }}>·</Text>
              <SnoozeCountdown until={snoozeUntil} color={hueColor(theme, phases.snoozed.hue, "text")} />
            </> : since ? <>
              <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta }}>·</Text>
              <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta, fontVariant: ["tabular-nums"] }}>{since}</Text>
            </> : null}
          </View>
          {/* 每轮小结: the second line, the goal, progress and next step in a few words. */}
          {look ? <RecapLine theme={theme} look={look} /> : null}
          {/* Chips first; when they leave too little room the project and time wrap to their own line instead of vanishing. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.xs + 1, rowGap: space.xxs + 1, paddingRight: link && !reason ? reserve : 0 }}>
            {agent.background && phase === "running" ? <BackgroundChip theme={theme} agent={agent} /> : null}
            {agent.todo && phase === "running" ? <TodoChip theme={theme} todo={agent.todo} /> : null}
            {rate && phase === "running" ? <View accessibilityLabel={t("secondarySessionList.outputtingTokensPerSecond", { value1: rate.toFixed(1) })} style={{ flexDirection: "row", alignItems: "center", gap: space.xxs, paddingHorizontal: space.xs + 1, height: 18, borderRadius: radius.sm }}>
              <Icon name="Zap" size={10} color={hueColor(theme, "orange")} />
              <Text style={{ color: hueColor(theme, "orange", "text"), fontSize: fontSize.meta, fontWeight: "500", fontVariant: ["tabular-nums"] }}>{rate >= 100 ? Math.round(rate) : rate.toFixed(1).replace(/\.0$/, "")}{t("secondarySessionList.tokS")}</Text>
            </View> : null}
            {pressure ? <ContextChip theme={theme} percent={pressure.percent} critical={pressure.level === "critical"} /> : null}
            {/* 提示缓存倒计时 (2.17): not on running rows (each request warms it again); a cold cache only where it waits for you. */}
            {phase !== "running" && phase !== "starting" && !agent.archivedAt ? <CacheChip theme={theme} agentId={agent.id} showCold={active} /> : null}
            {heartbeats?.length ? <HeartbeatBadge theme={theme} heartbeats={heartbeats} /> : null}
            {agent.labels["paseo.schedule-id"] ? <ScheduleBadge theme={theme} /> : null}
            {delegatedFrom !== null ? <DelegatedChip theme={theme} host={delegatedFrom} /> : null}
            <View style={{ flex: 1, minWidth: 120, flexDirection: "row", alignItems: "center", gap: space.xs + 1 }}>
              {depth === 0 ? <HueDot theme={theme} hue={hueFor(agent.projectName)} size={7} /> : null}
              <View style={{ flex: 1, minWidth: 0 }}><MetaLine theme={theme} parts={[...meta, row.node.cycleBroken ? t("secondarySessionList.aCycleInTheParentRelationship") : null]} /></View>
            </View>
          </View>
          {reason ? <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minWidth: 0, paddingRight: reserve }}>
            <Icon name={reason.icon} size={12} color={hueColor(theme, reason.hue)} />
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: hueColor(theme, reason.hue, "text"), fontSize: fontSize.meta, lineHeight: 17, fontWeight: "500" }}>{reason.text}</Text>
          </View> : null}
        </View>
      </Pressable>
      {link ? <ChangeRequestChip theme={theme} link={link} /> : null}
      {children > 0 ? <Pressable accessibilityRole="button" accessibilityLabel={expanded ? t("secondarySessionList.collapseSubagents", { name: agent.title }) : t("secondarySessionList.expandSubagents", { name: agent.title })} accessibilityState={{ expanded }} {...aria({ expanded })} onPress={() => onToggle(agent.id)} hitSlop={{ top: 4, bottom: 6, left: 6, right: 6 }}
        style={state => ({ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs, minHeight: 28, paddingHorizontal: space.md, paddingBottom: space.sm, backgroundColor: pressedHot(state as { pressed?: boolean; hovered?: boolean }) ? cardHot : "transparent" })}>
        <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={12} color={colors.foregroundMuted} />
        <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta }}>{t("secondarySessionList.subagents", { count: children })}</Text>
        {childAttention > 0 && childPhase ? <ChildAttention theme={theme} count={childAttention} phase={childPhase} /> : null}
        {childRunning > 0 ? <><Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta }}>·</Text><Spinner size={10} color={hueColor(theme, "run")} /><Text style={{ color: hueColor(theme, "run", "text"), fontSize: fontSize.meta }}>{t("secondarySessionList.running2", { value1: childRunning })}</Text></> : null}
        {childUnread > 0 ? <Text style={{ color: hueColor(theme, "pink", "text"), fontSize: fontSize.meta, fontWeight: "600" }}>{t("secondarySessionList.unread", { value1: childUnread })}</Text> : null}
      </Pressable> : null}
      {/* 悬停操作 (the tasks board's footer): the strip keeps its height so hovering moves nothing; the buttons fade in
          (4px drift), right-aligned, 打开 last. On touch there is no hover — tapping the row opens the drawer. */}
      {showActions ? <View style={{ minHeight: 34, paddingHorizontal: space.md, paddingBottom: space.xs + 1, justifyContent: "flex-end" }}>
        <Animated.View style={{ pointerEvents: hover ? "auto" : "none", flexDirection: "row", justifyContent: "flex-end", alignItems: "center", columnGap: space.lg,
          opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }}>
          {canRead ? <Pressable accessibilityRole="button" accessibilityLabel={t("coreAgentDetail.markRead")} disabled={busy !== null} onPress={() => void markReadOriginal()} style={actionStyle}>
            <Icon name="Check" size={12} color={colors.foregroundMuted} />
            <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta, fontWeight: "500" }}>{t("coreAgentDetail.markRead")}</Text>
          </Pressable> : null}
          {canArchive ? <Pressable accessibilityRole="button" accessibilityLabel={t("coreAgentDetail.archive")} disabled={busy !== null} onPress={() => void archiveOriginal()} style={actionStyle}>
            <Icon name="Archive" size={12} color={colors.foregroundMuted} />
            <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta, fontWeight: "500" }}>{t("coreAgentDetail.archive")}</Text>
          </Pressable> : null}
          {canOpen ? <Pressable accessibilityRole="button" accessibilityLabel={t("coreAgentDetail.openSession")} onPress={openConversation} style={actionStyle}>
            <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta, fontWeight: "500" }}>{t("coreAgentDetail.openSession")}</Text>
            <Icon name="ArrowUpRight" size={12} color={colors.foregroundMuted} />
          </Pressable> : null}
        </Animated.View>
      </View> : null}
    </Animated.View>
  </View>;
});

/** Chinese count contract before catalog extraction: {count} 个需要处理. Uses the most urgent child's color and mark (P3-3). */
function ChildAttention({ theme, count, phase }: { theme: PluginTheme; count: number; phase: AttentionPhase }) {
  const look = phases[phase];
  return <View style={{ flexDirection: "row", alignItems: "center", gap: space.xxs + 1 }}>
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: fontSize.meta }}>·</Text>
    <Icon name={look.icon} size={11} color={hueColor(theme, look.hue)} />
    <Text style={{ color: hueColor(theme, look.hue, "text"), fontSize: fontSize.meta, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{t("secondarySessionList.needYou", { count: count })}</Text>
  </View>;
}

/** 「3/7 · 正在跑测试」: the running turn's todo list, how far it got and the step it is on (opus-B12). */
function TodoChip({ theme, todo }: { theme: PluginTheme; todo: AgentTodo }) {
  const color = hueColor(theme, "cyan"), text = hueColor(theme, "cyan", "text"), share = todo.total ? todo.done / todo.total : 0;
  return <View accessibilityLabel={t("secondarySessionList.taskProgress", { value1: todo.done, value2: todo.total, value3: todo.current ? t("secondarySessionList.workingOn", { value1: todo.current }) : "" })}
    style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexShrink: 1, minWidth: 0, maxWidth: 240, paddingHorizontal: space.xs + 2, height: 18, borderRadius: radius.sm }}>
    <View style={{ width: 18, height: 4, borderRadius: 2, overflow: "hidden", backgroundColor: tint(color, 0.3) }}><View style={{ width: `${Math.round(share * 100)}%`, height: 4, backgroundColor: color }} /></View>
    <Text style={{ color: text, fontSize: fontSize.meta, fontWeight: "500", fontVariant: ["tabular-nums"] }}>{todo.done}/{todo.total}</Text>
    {todo.current ? <Text numberOfLines={1} style={{ flexShrink: 1, color: text, fontSize: fontSize.meta, fontWeight: "500" }}>· {todo.current}</Text> : null}
  </View>;
}

/** 「上下文 87%」 amber from 85 %, red from 95 % (opus-B13): the Agent is about to compact or run out of room. */
function ContextChip({ theme, percent, critical }: { theme: PluginTheme; percent: number; critical: boolean }) {
  const hue: Hue = critical ? "red" : "amber", color = hueColor(theme, hue);
  return <View accessibilityLabel={t("secondarySessionList.contextUsed", { value1: percent, value2: critical ? t("secondarySessionList.almostFull") : "" })} style={{ flexDirection: "row", alignItems: "center", gap: space.xxs + 1, height: 18, paddingHorizontal: space.xs + 2, borderRadius: radius.sm, backgroundColor: critical ? color : "transparent" }}>
    <Icon name="Gauge" size={10} color={critical ? "#ffffff" : color} />
    <Text style={{ color: critical ? "#ffffff" : hueColor(theme, hue, "text"), fontSize: fontSize.meta, fontWeight: critical ? "600" : "500", fontVariant: ["tabular-nums"] }}>{t("secondarySessionList.context", { value1: percent })}</Text>
  </View>;
}

/** 「!42」 / 「#17」: the merge or pull request a reply linked to (opus-B16); opens in the browser. */
function ChangeRequestChip({ theme, link }: { theme: PluginTheme; link: NonNullable<AgentRecord["changeRequest"]> }) {
  const toast = useToast(), hue: Hue = link.kind === "mr" ? "indigo" : "blue", color = hueColor(theme, hue);
  const open = () => { void openExternalUrl(link.url).catch(() => toast.error(t("secondarySessionList.couldNotOpenLinkYouCan"))); };
  return <Pressable accessibilityRole="link" accessibilityLabel={t("secondarySessionList.open", { value1: link.kind === "mr" ? t("secondarySessionList.mergeRequest") : t("secondarySessionList.pullRequest"), value2: link.label })} onPress={open} hitSlop={6}
    style={state => ({ position: "absolute", right: space.md, bottom: space.sm + 2, flexDirection: "row", alignItems: "center", gap: space.xxs + 1, height: 20, paddingHorizontal: space.xs + 2, borderRadius: radius.sm,
      backgroundColor: state.pressed || (state as { hovered?: boolean }).hovered ? theme.colors.surface1 : theme.colors.surface2, borderWidth: hairline, borderColor: theme.colors.border })}>
    <Icon name={link.kind === "mr" ? "GitMerge" : "GitPullRequest"} size={11} color={color} />
    <Text style={{ color: hueColor(theme, hue, "text"), fontSize: fontSize.meta, fontWeight: "500", fontVariant: ["tabular-nums"] }}>{link.label}</Text>
  </Pressable>;
}

/** 「后台 · 实现折叠」: what the subagents still running after the Agent's own turn work on. */
/** Paseo 0.13: an Agent on another host created this one; its parent hears when it finishes, as with any subagent. */
function DelegatedChip({ theme, host }: { theme: PluginTheme; host: string }) {
  const color = hueColor(theme, "indigo");
  return <View accessibilityLabel={host ? t("secondarySessionList.delegatedFromHost", { host }) : t("secondarySessionList.delegatedFromAnotherHost")}
    style={{ flexDirection: "row", alignItems: "center", gap: space.xxs + 1, flexShrink: 1, minWidth: 0, maxWidth: 200, paddingHorizontal: space.xs + 2, height: 18, borderRadius: radius.sm }}>
    <Icon name="Network" size={10} color={color} />
    <Text numberOfLines={1} style={{ flexShrink: 1, color: hueColor(theme, "indigo", "text"), fontSize: fontSize.meta, fontWeight: "500" }}>{host ? t("secondarySessionList.fromHost", { host }) : t("secondarySessionList.fromAnotherHost")}</Text>
  </View>;
}

function BackgroundChip({ theme, agent }: { theme: PluginTheme; agent: AgentRecord }) {
  const background = agent.background!, color = hueColor(theme, "blue");
  const label = background.running > 1 ? t("secondarySessionList.backgroundSubtasks", { value1: background.running }) : t("secondarySessionList.background2", { value1: background.labels[0] ?? t("secondarySessionList.subtasks") });
  return <View accessibilityLabel={t("secondarySessionList.backgroundSubtasksRunning", { value1: background.running, value2: background.labels.length ? t("secondarySessionList.message", { value1: joinList(background.labels) }) : "" })}
    style={{ flexDirection: "row", alignItems: "center", gap: space.xxs + 1, flexShrink: 1, minWidth: 0, maxWidth: 220, minHeight: 18 }}>
    <Spinner size={10} color={color} />
    <Text numberOfLines={1} style={{ flexShrink: 1, color: hueColor(theme, "blue", "text"), fontSize: fontSize.meta, fontWeight: "500" }}>{label}</Text>
  </View>;
}

/** Group header with the group's own mark: a waiting hand, a spinner for work in progress, a clock for the rest. */
export function GroupHeader({ theme, group, title, count }: { theme: PluginTheme; group: DashboardGroup; title: string; count: number }) {
  const { colors } = theme;
  const color = group === "attention" ? hueColor(theme, "warn") : group === "running" ? hueColor(theme, "run") : colors.foregroundMuted;
  return <View accessibilityRole="header" style={{ flexDirection: "row", alignItems: "center", gap: space.xs + 2, minHeight: 32, paddingHorizontal: space.md, paddingTop: space.sm }}>
    {group === "running" ? <Spinner size={12} color={color} active={count > 0} /> : <Icon name={group === "attention" ? "BellRing" : "History"} size={12} color={color} />}
    <Text style={{ color: group === "recent" ? colors.foregroundMuted : group === "attention" ? hueColor(theme, "warn", "text") : hueColor(theme, "run", "text"), fontSize: fontSize.meta, fontWeight: "600" }}>{title}</Text>
    <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta, fontVariant: ["tabular-nums"] }}>{count}</Text>
  </View>;
}

export function SessionList({ items, theme, compact, selectedId, expanded, forceExpanded = false, now, signals, rates, heartbeats, recaps, recapsRevision = "", marked, serverId, navigation, empty, listRef, onScrollEnd, onToggle, onSelect }: {
  items: readonly SessionItem[]; theme: PluginTheme; compact: boolean; selectedId: string | null; expanded: ReadonlySet<string>; forceExpanded?: boolean; now: number; signals: ReadonlyMap<string, string>;
  rates?: ReadonlyMap<string, number>;
  heartbeats?: ReadonlyMap<string, HeartbeatSummary[]>;
  /** 每轮小结 by Agent (absent while they are off), and their revision, so rows draw again when one changes. */
  recaps?: ReadonlyMap<string, RecapView>; recapsRevision?: string;
  /** Rows waiting for the 归档 confirmation. */
  marked?: ReadonlySet<string>;
  /** This host's server id: rows delegated from another host say which; hover 标记已读 refreshes its badge. */
  serverId?: string;
  /** Opens the hover footer's 打开 in the conversation tab (`openAgent`). */
  navigation?: PluginSurfaceProps["navigation"];
  empty: ReactNode; listRef?: Ref<NativeFlatList<SessionItem>>; onScrollEnd?: (offset: number) => void;
  onToggle: (agentId: string) => void; onSelect: (agentId: string) => void;
}) {
  // Rows re-render only when a shown rate changes (rounded to 0.1 tok/s).
  const ratesKey = useMemo(() => [...(rates ?? [])].map(([id, rate]) => `${id}:${rate.toFixed(1)}`).join(","), [rates]);
  const scrollEnd = onScrollEnd ? (event: NativeSyntheticEvent<NativeScrollEvent>) => onScrollEnd(event.nativeEvent.contentOffset.y) : undefined;
  const hostLabels = useHostLabels();
  const listBg = isDarkTheme(theme) ? theme.colors.surface0 : theme.colors.surface1;
  return <FlatList ref={listRef} data={items as SessionItem[]} keyExtractor={item => item.key} style={{ flex: 1, minHeight: 0, backgroundColor: listBg }} contentContainerStyle={{ paddingHorizontal: space.sm, paddingTop: space.xs, paddingBottom: space.xl }}
    onScrollEndDrag={scrollEnd} onMomentumScrollEnd={scrollEnd}
    initialNumToRender={18} maxToRenderPerBatch={20} windowSize={7} keyboardShouldPersistTaps="handled" extraData={`${now}:${selectedId}:${expanded.size}:${forceExpanded}:${signals.size}:${ratesKey}:${heartbeats?.size ?? 0}:${marked?.size ?? 0}:${recapsRevision}:${hostLabels.size}`}
    ListEmptyComponent={<View>{empty}</View>}
    renderItem={({ item }) => {
      if (item.kind === "section") return <GroupHeader theme={theme} group={item.group} title={item.title} count={item.count} />;
      return <SessionRowItem item={item} theme={theme} compact={compact} selectedId={selectedId} expanded={expanded} forceExpanded={forceExpanded} now={now} signals={signals} rates={rates} heartbeats={heartbeats} recaps={recaps} marked={marked} serverId={serverId} navigation={navigation} onToggle={onToggle} onSelect={onSelect} />;
    }} />;
}
/** Midnight of the device's day: rows without a live clock re-render once a day for 明天 / 今天. */
const dayOf = (now: number) => { const date = new Date(now); return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(); };

/** One row with its per-item lookups (heartbeats, delegated-from label), shared by the single column and the two-column board. */
export function SessionRowItem({ item, theme, compact, selectedId, expanded, forceExpanded = false, now, signals, rates, heartbeats, recaps, marked, serverId, navigation, onToggle, onSelect, pressRef }: {
  item: Extract<SessionItem, { kind: "row" }>; theme: PluginTheme; compact: boolean; selectedId: string | null; expanded: ReadonlySet<string>; forceExpanded?: boolean; now: number;
  signals: ReadonlyMap<string, string>; rates?: ReadonlyMap<string, number>; heartbeats?: ReadonlyMap<string, HeartbeatSummary[]>;
  recaps?: ReadonlyMap<string, RecapView>; marked?: ReadonlySet<string>; serverId?: string; navigation?: PluginSurfaceProps["navigation"];
  onToggle: (agentId: string) => void; onSelect: (agentId: string) => void; pressRef?: Ref<ComponentRef<typeof Pressable>>;
}) {
  const id = item.row.node.agent.id, from = parentServerOf(item.row.node.agent, serverId);
  const hostLabels = useHostLabels();
  // The page clock ticks every 30 s, but a row's labels are minute-granular (relativeTime, stamps), and the running
  // timer and snooze countdown tick on their own. Bucket `now` to the minute so a tick is a memo no-op for every
  // row; labels settle at the minute boundary (up to a minute coarser than before — ponytail: per-row label diffing if that shows).
  const minute = Math.floor(now / 60_000) * 60_000;
  return <SessionRow item={item} theme={theme} compact={compact} selected={id === selectedId} expanded={forceExpanded || expanded.has(id)} now={minute}
    signal={signals.get(id)} rate={rates?.get(id)} heartbeats={heartbeats?.get(id)} recap={recaps?.get(id) ?? null} day={item.row.node.agent.stop ? minute : dayOf(minute)}
    marked={marked?.has(id) ?? false} delegatedFrom={from ? hostLabels.get(from) ?? "" : null} navigation={navigation} serverId={serverId} onToggle={onToggle} onSelect={onSelect} pressRef={pressRef} />;
}
