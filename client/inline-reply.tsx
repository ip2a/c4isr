import { t } from "../shared/text";
import { useEffect, useRef, useState } from "react";
import { Text, View, type NativeSyntheticEvent, type TextInput as NativeTextInput, type TextInputKeyPressEventData } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { BUILTIN_SEND } from "../shared/steer";
import { onItsWay, type DeferredView } from "../shared/deferred-rpc";
import { Banner, Button, fontSize, radius, space } from "./kit";
import { PaneLabel } from "./ui";
import { useSteerableProviders } from "./insight-actions";
import { DeferredList, useDeferredQueue } from "./deferred";
import { SOURCES, ledgerNotice, messageKey, onItsWayLabel, rememberUnanswered, requestId, settleRequest, unansweredId } from "./deferred-state";
import { checkSend, ledgerInput, outgoingMessage, sendChecked, type LedgerAnswer, type OutgoingMessage, type SendCheck, type SendConfirmation } from "./send-check";
import { forkSend } from "../shared/fork-send";
import { isSlashCommand, type Consent, type SendPlan } from "./send-plan";
import { SchedulePicker, scheduleWhen } from "./schedule-send";

/** A message that certainly never went out: the text is free to be sent again, under a new id. */
const NEVER_SENT: ReadonlySet<DeferredView["state"]> = new Set(["canceled", "discarded", "expired"]);
type Problem = { tone: "danger" | "warning"; message: string; retry: boolean };

/** Ledger rows for free-text replies composed under the result. */
export const isInlineReply = (view: DeferredView) => view.source === SOURCES.reply || view.source.startsWith(SOURCES.reply);

/**
 * Free-text reply under the latest agent reply: same ledger as 快捷回复 / 发给这个 Agent
 * (`observatory.deferred.send`), with interrupt confirm, queue-until-idle, and schedule.
 * Selecting a session card remounts this (keyed by agentId) and focuses the field so typing can start at once.
 */
export function InlineReply({ theme, agentId, agentTitle, compact = false, autoFocus = true, onSent }: {
  theme: PluginTheme; agentId: string; agentTitle: string; compact?: boolean; autoFocus?: boolean; onSent?: () => void;
}) {
  const paseo = usePaseo(), toast = useToast(), { colors } = theme;
  const forkBranch = useRpc(forkSend);
  const capabilities = useSteerableProviders(true), caps = capabilities.data ?? (capabilities.isError ? BUILTIN_SEND : undefined);
  const deferred = useDeferredQueue(agentId);
  const listed = useRef(deferred.all);
  listed.current = deferred.all;
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [problem, setProblem] = useState<Problem | null>(null);
  const [check, setCheck] = useState<SendCheck | null>(null), [confirming, setConfirming] = useState<SendConfirmation | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const message = useRef<OutgoingMessage | null>(null), slash = isSlashCommand(text), body = text.trim();
  const key = messageKey(SOURCES.reply, body);
  // Brief delay so the detail pane finishes laying out after a list tap (same as sheet fields). Focus without the
  // scroll-into-view: the field sits at the pane's bottom, and a bare DOM focus() drags the whole pane down to it
  // (the ref is the host node on web; native ignores the argument).
  const input = useRef<NativeTextInput>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => (input.current as unknown as { focus: (options?: { preventScroll: boolean }) => void } | null)?.focus({ preventScroll: true }), 350);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  useEffect(() => {
    if (!caps) return;
    let live = true;
    void checkSend(paseo, { agentId, text: text.trim(), what: t("secondaryResultView.reply") }, caps).then(next => { if (live) setCheck(next); }).catch(() => { if (live) setCheck(null); });
    return () => { live = false; };
  }, [agentId, caps, slash]);

  const onWay = onItsWay(deferred.all, agentId, key);
  const own = message.current?.text === body ? deferred.all.find(view => view.messageId === message.current!.messageId) ?? null : null;
  const delivered = own?.state === "sent" || own?.state === "maybe-sent" ? own : null;

  useEffect(() => {
    if (!own || NEVER_SENT.has(own.state)) return;
    setConfirming(null);
    if (own.state !== "sent" && own.state !== "maybe-sent") return;
    setProblem(null);
    if (unansweredId(agentId, own.key) === own.messageId) settleRequest(agentId, own.key);
  }, [own?.messageId, own?.state, agentId]);

  const current = (): OutgoingMessage => {
    const kept = message.current, record = kept && listed.current.find(view => view.messageId === kept.messageId);
    if (!kept || kept.text !== body || record && NEVER_SENT.has(record.state))
      message.current = outgoingMessage(agentId, body, {
        what: t("secondaryResultView.reply"),
        source: SOURCES.reply,
        key,
        messageId: requestId(agentId, key, listed.current),
      });
    return message.current!;
  };

  const taken = (next: OutgoingMessage) => {
    const way = onItsWay(listed.current, agentId, next.key), mine = listed.current.find(view => view.messageId === next.messageId);
    return !!way || mine?.state === "sent" || mine?.state === "maybe-sent";
  };

  const lost = (next: OutgoingMessage, reason: unknown) => {
    if (next.tried) rememberUnanswered(agentId, next.key, next.messageId);
    const words = (reason instanceof Error ? reason.message : String(reason)).replace(/[。.]$/, "");
    setProblem({ tone: "danger", retry: true, message: next.tried
      ? t("coreInsightActions.noSendResultReceivedIfTheMessage", { value1: words })
      : words });
  };

  const answeredWith = (next: OutgoingMessage, view: DeferredView, sentWords: string) => {
    if (view.messageId !== next.messageId) {
      toast.show(view.state === "sent" ? t("coreInsightActions.thisMessageWasJustSent") : t("coreInsightActions.thisMessageSeeBelow", { value1: onItsWayLabel(view) }), { variant: view.state === "maybe-sent" ? "warning" : "success" });
      return;
    }
    const notice = ledgerNotice(view, agentTitle);
    if (notice.kind === "sent" || view.state === "queued") {
      toast.show(notice.kind === "sent" ? sentWords : notice.text, { variant: "success" });
      if (notice.kind === "sent") { setText(""); onSent?.(); }
      return;
    }
    if (notice.kind === "waiting" || notice.kind === "attention" || notice.kind === "uncertain") toast.show(notice.text, { variant: notice.tone === "danger" ? "error" : notice.tone });
    else setProblem({ tone: notice.tone === "danger" ? "danger" : "warning", message: notice.text, retry: false });
  };

  const answered = (next: OutgoingMessage, answer: LedgerAnswer, plan: SendPlan) => {
    if ("message" in answer) { setProblem({ tone: answer.status === "busy" ? "warning" : "danger", message: answer.message, retry: answer.status === "busy" }); return; }
    answeredWith(next, answer.view, plan.kind === "steer" ? t("coreInsightActions.joinedSCurrentTurn", { value1: agentTitle }) : t("coreInsightActions.sentTo", { value1: agentTitle }));
  };

  const send = async (consent: Consent | null = null) => {
    if (!caps || !body || busy) return;
    const next = current();
    if (taken(next)) { setConfirming(null); return; }
    setBusy(true); setProblem(null);
    try {
      const result = await sendChecked(paseo, next, caps, deferred.send, consent);
      if ("confirm" in result) { setCheck(result.confirm.check); setConfirming(result.confirm); return; }
      settleRequest(agentId, next.key);
      setConfirming(null);
      answered(next, result.answered, result.plan);
    } catch (reason) {
      setConfirming(null);
      lost(next, reason);
    } finally { setBusy(false); }
  };

  const defer = async () => {
    if (!body || busy) return;
    const next = current();
    if (taken(next)) { setConfirming(null); return; }
    setBusy(true); setProblem(null);
    try {
      next.tried = true;
      const view = await deferred.enqueue(ledgerInput(next));
      settleRequest(agentId, next.key);
      setConfirming(null);
      answeredWith(next, view, t("coreInsightActions.sentTo", { value1: agentTitle }));
    } catch (reason) {
      setConfirming(null);
      lost(next, reason);
    } finally { setBusy(false); }
  };

  // 快捷分支发送: forks the session and puts the draft there — this session and its ledger stay out of it entirely.
  // An error keeps the text (a partial failure means the branch exists; the banner says where).
  const branch = async () => {
    if (!body || busy) return;
    setBusy(true); setProblem(null);
    try {
      const result = await forkBranch({ agentId, text: body });
      if (result.error || !result.agentId) {
        setProblem({ tone: "danger", retry: false, message: result.error || t("secondaryResultView.forkFailed") });
        return;
      }
      setConfirming(null);
      toast.show(t("secondaryResultView.forkSent", { value1: result.title ?? "" }), { variant: "success" });
      setText("");
      onSent?.();
    } catch (reason) {
      setProblem({ tone: "danger", retry: false, message: (reason instanceof Error ? reason.message : String(reason)).replace(/[。.]$/, "") });
    } finally { setBusy(false); }
  };

  const schedule = async (at: number) => {
    if (!body || busy) return;
    const next = current();
    if (taken(next)) { setConfirming(null); setScheduling(false); return; }
    setBusy(true); setProblem(null);
    try {
      next.tried = true;
      const view = await deferred.enqueue({ ...ledgerInput(next), notBefore: at });
      settleRequest(agentId, next.key);
      setConfirming(null); setScheduling(false);
      if (view.messageId === next.messageId && view.state === "queued" && view.notBefore !== undefined) {
        toast.show(t("alertsSchedule.scheduledMessage", { title: agentTitle, when: scheduleWhen(view.notBefore) }), { variant: "success" });
        setText("");
      } else answeredWith(next, view, t("coreInsightActions.sentTo", { value1: agentTitle }));
    } catch (reason) {
      setConfirming(null); setScheduling(false);
      lost(next, reason);
    } finally { setBusy(false); }
  };

  const plan = confirming?.check.plan ?? check?.plan, offer = confirming?.offer;
  const locked = !!onWay || !!delivered;

  const fieldHeight = compact ? 72 : 96;
  const sendLabel = onWay ? onItsWayLabel(onWay) : problem?.retry ? t("coreInsightActions.retry") : plan?.kind === "steer" ? t("coreInsightActions.joinThisTurn") : t("secondaryResultView.sendWithEnter");
  const sendReady = !busy && !!body && !!caps && plan?.kind !== "unavailable" && !locked;
  // Some IMEs fire Enter after compositionend with isComposing already false; hold one frame.
  const imeLock = useRef(false), imeEpoch = useRef(0);
  useEffect(() => {
    const node = input.current as unknown as { addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void } | null;
    if (!node?.addEventListener || !node.removeEventListener) return;
    const start = () => { imeLock.current = true; imeEpoch.current += 1; };
    const end = () => {
      const epoch = imeEpoch.current;
      requestAnimationFrame(() => { if (imeEpoch.current === epoch) imeLock.current = false; });
    };
    node.addEventListener("compositionstart", start);
    node.addEventListener("compositionend", end);
    return () => { node.removeEventListener!("compositionstart", start); node.removeEventListener!("compositionend", end); };
  }, [input]);
  // RN-web wires its own keydown and only honors preventDefault from onKeyPress; Shift+Enter stays a newline.
  // IME candidate confirm also fires Enter (isComposing / keyCode 229) — must not send (same guard as RN-web submit).
  const onKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData> & { shiftKey?: boolean; key?: string; isComposing?: boolean; preventDefault: () => void }) => {
    const native = event.nativeEvent as TextInputKeyPressEventData & { isComposing?: boolean; keyCode?: number };
    if (imeLock.current || event.isComposing || native.isComposing || native.keyCode === 229) return;
    const key = native.key || event.key;
    if (key !== "Enter" || event.shiftKey || confirming || !body) return;
    event.preventDefault();
    if (sendReady) void send();
  };
  return <View testID="inline-reply" style={{ gap: space.sm }}>
    <PaneLabel theme={theme} icon="Reply" tone="info">{t("secondaryResultView.reply")}</PaneLabel>
    <TextInput ref={input} accessibilityLabel={t("secondaryResultView.reply")} value={text} onChangeText={setText} placeholder={t("secondaryResultView.replyPlaceholder")}
      placeholderTextColor={colors.foregroundMuted} multiline textAlignVertical="top" blurOnSubmit={false} onKeyPress={onKeyPress}
      style={{ color: colors.foreground, backgroundColor: colors.surface2, borderRadius: radius.md, minHeight: fieldHeight, paddingHorizontal: space.md, paddingVertical: space.sm, fontSize: fontSize.body, lineHeight: 20 }} />
    {confirming?.check.plan.confirm ? <Banner theme={theme} tone="warning" message={confirming.check.plan.confirm} /> : null}
    {offer ? <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta, lineHeight: 17 }}>{t("coreInsightActions.message3", { value1: offer.label, value2: offer.note })}</Text> : null}
    {problem ? <Banner theme={theme} tone={problem.tone} message={problem.message} /> : null}
    {delivered ? <Banner theme={theme} tone={delivered.state === "sent" ? "success" : "warning"} message={delivered.state === "sent" ? t("coreInsightActions.thisMessageHasBeenDeliveredEditingIts") : t("coreInsightActions.thisMessageMayAlreadyHaveArrivedOpen")} /> : null}
    <DeferredList theme={theme} queue={deferred} only={isInlineReply} compact={compact} />
    {scheduling && !locked ? <SchedulePicker theme={theme} compact={compact} busy={busy} onClose={() => setScheduling(false)} onPick={at => void schedule(at)} /> : null}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, justifyContent: "flex-end" }}>
      <Button theme={theme} tone="violet" variant="ghost" label={t("secondaryResultView.forkSend")} size={compact ? "md" : "sm"}
        disabled={busy || !body} testID="inline-reply-fork" onPress={() => void branch()} />
      <Button theme={theme} tone="sky" variant={scheduling ? "secondary" : "ghost"} label={t("secondaryResultView.scheduleSend")} size={compact ? "md" : "sm"}
        disabled={busy || !body || locked || plan?.kind === "unavailable"} testID="inline-reply-schedule" onPress={() => setScheduling(!scheduling)} />
      {confirming ? <>
        <Button theme={theme} label={t("coreInsightActions.cancel")} size={compact ? "md" : "sm"} onPress={() => setConfirming(null)} />
        {offer ? <Button theme={theme} tone="info" label={offer.label} size={compact ? "md" : "sm"} busy={busy} disabled={busy || locked} onPress={() => void defer()} /> : null}
        <Button theme={theme} variant="danger" label={confirming.check.plan.label} size={compact ? "md" : "sm"} busy={busy} disabled={busy || !body || !caps || locked} onPress={() => void send(confirming.consent)} />
      </> : (
        <Button theme={theme} variant="primary" label={sendLabel} size={compact ? "md" : "sm"} busy={busy} disabled={!sendReady} testID="inline-reply-send" onPress={() => void send()} />
      )}
    </View>
  </View>;
}
