import { useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsInput, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { HABITS_DEFAULTS, habitsSettings, type HabitsSettings } from "../shared/habits";
import { t } from "../shared/text";

/**
 * 使用习惯 of the observatory, in the board's 观测设置 and the plugin's settings screen: saved as the host setting
 * `habits`, so every device shows the same thing (shared/habits.ts). Selects save at once; the quick-reply texts debounce,
 * since a keystroke is not an edit worth a write.
 */
export function HabitSettingsSection() {
  const settings = useSettings(habitsSettings);
  const values: HabitsSettings = settings.status === "ready" ? settings.values : HABITS_DEFAULTS;
  const ready = settings.status === "ready" && !settings.saving;
  const save = (patch: Partial<HabitsSettings>) => { if (settings.status === "ready") void settings.save({ ...settings.values, ...patch }, settings.revision); };
  // Quick-reply drafts: keep typing local, write 600 ms after the last keystroke.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); }, []);
  const saveReply = (key: string, text: string) => {
    setDrafts(previous => ({ ...previous, [key]: text }));
    const pending = timers.current.get(key); if (pending) clearTimeout(pending);
    timers.current.set(key, setTimeout(() => { timers.current.delete(key); save({ quickReplies: { ...values.quickReplies, [key]: text } }); }, 600));
  };
  const replyField = (key: string, label: string, placeholder: string) =>
    <SettingsInput key={key} label={label} placeholder={placeholder} initialValue={drafts[key] ?? values.quickReplies[key] ?? ""} disabled={!ready}
      onChangeText={text => saveReply(key, text)} />;
  return <SettingsSection title={t("habitsSettings.title")}>
    <SettingsCard>
      <SettingsSelect label={t("habitsSettings.snoozeDuration")} hint={t("habitsSettings.snoozeDurationHint")} disabled={!ready}
        value={String(values.snoozeMinutes)} onValueChange={snoozeMinutes => save({ snoozeMinutes: Number(snoozeMinutes) })}
        options={[{ value: "30", label: t("habitsSettings.m30") }, { value: "60", label: t("habitsSettings.h1") }, { value: "240", label: t("habitsSettings.h4") }, { value: "1440", label: t("habitsSettings.h24") }]} />
      <SettingsSelect label={t("habitsSettings.defaultRange")} hint={t("habitsSettings.defaultRangeHint")} disabled={!ready}
        value={values.defaultRange} onValueChange={defaultRange => save({ defaultRange: defaultRange as HabitsSettings["defaultRange"] })}
        options={[{ value: "24h", label: t("habitsSettings.range24h") }, { value: "7d", label: t("habitsSettings.range7d") }, { value: "30d", label: t("habitsSettings.range30d") }, { value: "all", label: t("habitsSettings.rangeAll") }]} />
      <SettingsSelect label={t("habitsSettings.defaultSort")} disabled={!ready}
        value={values.defaultSort} onValueChange={defaultSort => save({ defaultSort: defaultSort as HabitsSettings["defaultSort"] })}
        options={[{ value: "attention", label: t("habitsSettings.sortAttention") }, { value: "recent", label: t("habitsSettings.sortRecent") }]} />
      <SettingsSelect label={t("habitsSettings.defaultViewMode")} disabled={!ready}
        value={values.defaultViewMode} onValueChange={defaultViewMode => save({ defaultViewMode: defaultViewMode as HabitsSettings["defaultViewMode"] })}
        options={[{ value: "tree", label: t("habitsSettings.viewTree") }, { value: "list", label: t("habitsSettings.viewList") }]} />
      <SettingsSelect label={t("habitsSettings.recentThreads")} hint={t("habitsSettings.recentThreadsHint")} disabled={!ready}
        value={String(values.recentThreads)} onValueChange={recentThreads => save({ recentThreads: Number(recentThreads) })}
        options={["10", "20", "50", "200"].map(value => ({ value, label: value }))} />
      <SettingsSelect label={t("habitsSettings.contextHigh")} hint={t("habitsSettings.contextHint")} disabled={!ready}
        value={String(values.contextHigh)} onValueChange={contextHigh => save({ contextHigh: Number(contextHigh) })}
        options={["80", "85", "90"].map(value => ({ value, label: `${value}%` }))} />
      <SettingsSelect label={t("habitsSettings.contextCritical")} disabled={!ready}
        value={String(values.contextCritical)} onValueChange={contextCritical => save({ contextCritical: Number(contextCritical) })}
        options={["90", "95", "98"].map(value => ({ value, label: `${value}%` }))} />
      {replyField("go-ahead:go", t("habitsSettings.replyGoAheadGo"), t("sharedReply.m004"))}
      {replyField("go-ahead:hold", t("habitsSettings.replyGoAheadHold"), t("sharedReply.m005"))}
      {replyField("keep-going:finish", t("habitsSettings.replyKeepGoingFinish"), t("sharedReply.m006"))}
      {replyField("keep-going:hold", t("habitsSettings.replyKeepGoingHold"), t("sharedReply.m007"))}
    </SettingsCard>
  </SettingsSection>;
}
