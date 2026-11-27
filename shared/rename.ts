import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * 更改标题: rename an Agent's display name from the session detail. The SDK handle has no setter,
 * so the server shells out to the host install's own CLI (`paseo agent update <id> --name`); the
 * daemon then pushes `agent_update` and every directory updates itself.
 */
export const renameAgentRpc = defineRpc({
  name: "observatory.agent.rename",
  input: z.object({ agentId: z.string().min(1).max(256), title: z.string().trim().min(1).max(200) }),
  output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
});
