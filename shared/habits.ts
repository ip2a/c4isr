import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { t } from "./text";

/**
 * 使用习惯 (2.19): the observatory's configurable habits, saved as the host setting `habits`
 * (`$PASEO_HOME/plugin-settings/c4isr/habits.json`) so every device shares them. All optional with defaults, so an older
 * server strips nothing and a fresh install behaves as before. The server reads only the view defaults
 * (shared/preferences.ts `defaultViewPreferences`); everything else is client-side.
 */
export const habitsSettingsSchema = z.object({
  /** 稍后处理时长: how long a snoozed result waits before it returns to 需要处理. */
  snoozeMinutes: z.number().int().min(1).max(43_200).default(60),
  /** 默认时间范围: a fresh page's time window (reset 筛选 uses it too). */
  defaultRange: z.enum(["24h", "7d", "30d", "all"]).default("7d"),
  /** 默认排序 / 默认视图: a fresh overview page's list order and shape (归档 keeps its own). */
  defaultSort: z.enum(["attention", "recent"]).default("attention"),
  defaultViewMode: z.enum(["tree", "list"]).default("tree"),
  /** 「最近」折叠条数: the board's 最近 fold shows at most this many top-level threads. */
  recentThreads: z.number().int().min(5).max(200).default(20),
  /** 上下文提示阈值: the percent where a session's context use turns amber, then red. */
  contextHigh: z.number().int().min(50).max(99).default(85),
  contextCritical: z.number().int().min(60).max(100).default(95),
  /** 快捷回复文案: overrides by `nudge:key` (go-ahead:go / go-ahead:hold / keep-going:finish / keep-going:hold). */
  quickReplies: z.record(z.string().min(1).max(64), z.string().min(1).max(200)).default({}),
});
export const habitsSettings = defineSettings({ id: "habits", scope: "host", version: 1, schema: habitsSettingsSchema });
export type HabitsSettings = z.output<typeof habitsSettingsSchema>;
export const HABITS_DEFAULTS: HabitsSettings = habitsSettingsSchema.parse({});

/** 稍后处理时长 as words: 「1 小时」. Options are whole hours or minutes, so no fractions show. */
export function snoozeLabel(minutes: number): string {
  if (minutes % 1440 === 0) return t("sharedHabits.days", { value1: minutes / 1440 });
  if (minutes % 60 === 0) return t("sharedHabits.hours", { value1: minutes / 60 });
  return t("sharedHabits.minutes", { value1: minutes });
}
