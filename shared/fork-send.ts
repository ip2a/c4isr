import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** 快捷分支发送: fork the session (same workspace, same model — the host's own resume-as-fork) and put the draft there. */
export const forkSendResultSchema = z.object({
  agentId: z.string().nullable(),
  title: z.string().nullable(),
  error: z.string().nullable(),
});
export type ForkSendResult = z.infer<typeof forkSendResultSchema>;

export const forkSend = defineRpc({
  name: "observatory.fork.send",
  input: z.object({ agentId: z.string().min(1).max(512), text: z.string().min(1).max(200_000) }),
  output: forkSendResultSchema,
});
