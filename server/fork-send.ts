import { t } from "../shared/text";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { forkSend, type ForkSendResult } from "../shared/fork-send";
import type { ProviderBridge } from "./provider-subagents";

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Same ceiling as creation titles elsewhere (insight-runner). */
const TITLE_LIMIT = 60;
/** Resuming spawns the provider process and hydrates the timeline, so the host can legitimately take a while. */
const RESUME_TIMEOUT_MS = 120_000;

/**
 * 快捷分支发送 (2.20): forks the session and sends the draft there, so the current session stays untouched.
 * The host's `resume_agent_request` is its own fork: it always creates a NEW agent (session.js never passes an agent
 * id) resuming the same provider session in the same workspace with the same model, and a provider-side resume
 * branches the transcript instead of touching the original. The plugin SDK hides that message, so it rides the raw
 * session bridge like restore and refresh do.
 */
export function registerForkSend(server: PluginServerContext, bridge: Pick<ProviderBridge, "request">): void {
  server.handle(forkSend, async ({ agentId, text }, { paseo }) => {
    const fail = (error: string): ForkSendResult => ({ agentId: null, title: null, error });
    const snapshot = await paseo.agents.ref(agentId).refresh().catch(() => null);
    const agent = snapshot?.agent;
    if (!agent) return fail(t("serverForkSend.m001"));
    if (agent.archivedAt) return fail(t("serverForkSend.m002"));
    if (!agent.persistence || agent.providerUnavailable) return fail(t("serverForkSend.m003"));
    const title = `↗ ${agent.title ?? t("secondaryResultView.unnamedAgent")}`.slice(0, TITLE_LIMIT);
    let forkId: string;
    try {
      const resumed = await bridge.request({ type: "resume_agent_request", handle: agent.persistence, overrides: { title } }, "status", RESUME_TIMEOUT_MS);
      if (resumed.status !== "agent_resumed") return fail(t("serverForkSend.m004"));
      forkId = typeof resumed.agentId === "string" && resumed.agentId ? resumed.agentId : String(record(resumed.agent).id ?? "");
      if (!forkId) return fail(t("serverForkSend.m004"));
    } catch (error) { return fail(errorText(error)); }
    try {
      await paseo.agents.ref(forkId).send(text);
      return { agentId: forkId, title, error: null };
    } catch (error) {
      // The branch exists — the draft is safe to keep and retry by hand there, so clear nothing client-side.
      return { agentId: forkId, title, error: t("serverForkSend.m005", { value1: title, value2: errorText(error) }) };
    }
  });
}
