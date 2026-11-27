// The daemon is single-threaded: one multi-MB JSON.stringify blocks every RPC for its whole duration
// (LESSONS 14). Stringify long arrays slice by slice with event-loop yields between them. The output
// is byte-identical to JSON.stringify of the same value — each element is stringified the same way,
// joined with ","; see tests/serialize-chunk.test.ts.
const SLICE = 500;

async function yieldOnce(): Promise<void> { await new Promise<void>(resolve => setImmediate(resolve)); }

/** JSON.stringify for an array that yields every SLICE elements. Byte-identical to JSON.stringify(items). */
export async function stringifyArrayChunked(items: readonly unknown[]): Promise<string> {
  const parts: string[] = [];
  for (let start = 0; start < items.length; start += SLICE) {
    parts.push(JSON.stringify(items.slice(start, start + SLICE)).slice(1, -1));
    if (start + SLICE < items.length) await yieldOnce();
  }
  return `[${parts.join(",")}]`;
}

/** JSON.stringify for a {key: value} record built entry by entry, yielding as it goes. Byte-identical to JSON.stringify(record). */
export async function stringifyRecordChunked(record: Iterable<[string, unknown]>): Promise<string> {
  const parts: string[] = [];
  for (const [key, value] of record) {
    parts.push(`${JSON.stringify(key)}:${Array.isArray(value) ? await stringifyArrayChunked(value) : JSON.stringify(value)}`);
    if (parts.length % SLICE === 0) await yieldOnce();
  }
  return `{${parts.join(",")}}`;
}
