import { t } from "../shared/text";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { fontSize, formatDuration, radius, space, type Tone } from "./kit";
import { Spinner, hueColor, type Hue } from "./status";
import { parseTime, type RunStatus, type ScheduleRunRow } from "../shared/schedules";

/** How a schedule run looks everywhere: 执行中 blue and spinning, 失败 red, 成功 green, 结果未知 grey. */
export const runLooks: Record<RunStatus, { label: string; hue: Hue; icon: string }> = {
  running: { get label() { return t("secondaryScheduleLooks.running"); }, hue: "run", icon: "LoaderCircle" },
  succeeded: { get label() { return t("secondaryScheduleLooks.succeeded"); }, hue: "ok", icon: "Check" },
  failed: { get label() { return t("secondaryScheduleLooks.failed"); }, hue: "fail", icon: "X" },
  unknown: { get label() { return t("secondaryScheduleLooks.unknownResult"); }, hue: "muted", icon: "CircleHelp" },
};
const DAY = 86_400_000;
const pad = (value: number) => String(value).padStart(2, "0");

/** A spinner while running; otherwise a bare tinted Lucide icon (no disk). */
export function RunGlyph({ theme, status, size = 14 }: { theme: PluginTheme; status: RunStatus; size?: number }) {
  const look = runLooks[status], color = hueColor(theme, look.hue);
  if (status === "running") return <Spinner size={size} color={color} />;
  return <Icon name={look.icon} size={size} color={look.hue === "muted" ? theme.colors.foregroundMuted : color} />;
}

/** 「定时」 on a session row: the Agent was created by a schedule run. */
export function ScheduleBadge({ theme }: { theme: PluginTheme }) {
  const violet = hueColor(theme, "violet");
  return <View accessibilityLabel={t("secondaryScheduleLooks.createdByASchedule")} style={{ flexDirection: "row", alignItems: "center", gap: space.xxs, height: 18, paddingHorizontal: space.xs + 1, borderRadius: radius.sm }}>
    <Icon name="CalendarClock" size={10} color={violet} />
    <Text style={{ color: hueColor(theme, "violet", "text"), fontSize: fontSize.meta, fontWeight: "600" }}>{t("secondaryScheduleLooks.scheduled")}</Text>
  </View>;
}

/** Merged requests violet, closed red, GitLab-style MRs indigo, GitHub PRs blue. */
export function linkTone(run: Pick<ScheduleRunRow, "link">): Tone {
  return run.link?.state === "merged" ? "violet" : run.link?.state === "closed" ? "red" : run.link?.kind === "mr" ? "indigo" : "blue";
}

/** 23:24 inside the last week (the day group says which day), 10月4日 before. */
export function runTimeLabel(iso: string, now: number): string {
  const time = parseTime(iso);
  if (!time) return "";
  const date = new Date(time);
  return now - time < 7 * DAY ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : t("secondaryScheduleLooks.message", { value1: date.getMonth() + 1, value2: date.getDate() });
}
/** 10月8日 23:24 for cards outside the feed. */
export function runMoment(iso: string): string {
  const time = parseTime(iso);
  if (!time) return "";
  const date = new Date(time);
  return t("secondaryScheduleLooks.message2", { value1: date.getMonth() + 1, value2: date.getDate(), value3: pad(date.getHours()), value4: pad(date.getMinutes()) });
}
/** 9 分钟后 / 3 小时后 / 2 天后 for the next run. */
export function untilLabel(iso: string | null, now: number): string | null {
  const time = parseTime(iso);
  if (!time) return null;
  const minutes = Math.round((time - now) / 60_000);
  if (minutes <= 0) return t("secondaryScheduleLooks.runningSoon");
  return minutes < 60 ? t("secondaryScheduleLooks.inMinutes", { count: minutes }) : minutes < 1440 ? t("secondaryScheduleLooks.inHours", { count: Math.round(minutes / 60) }) : t("secondaryScheduleLooks.inDays", { count: Math.round(minutes / 1440) });
}
/** Finished runs only (a running one ticks in its LiveTimer); runs rebuilt from Agent labels have no reliable duration. */
export function runDurationLabel(run: Pick<ScheduleRunRow, "startedAt" | "endedAt" | "status" | "source">): string | null {
  if (run.status === "running" || run.source === "agent") return null;
  const started = parseTime(run.startedAt), ended = parseTime(run.endedAt);
  // A run that failed on the spot (no Agent started) has no duration worth showing.
  return started && ended && ended - started >= 1000 ? formatDuration(ended - started) : null;
}
