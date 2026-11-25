import { memo, useMemo } from "react";
import Markdown, { sanitizer as mdSanitizer, type NativeStyles } from "markdown-to-jsx/native";
import type { PluginTheme } from "@getpaseo/plugin";
import { fontSize, hairline, hue, radius, space } from "./kit";
import { monoFont } from "./ui";
import { isHttpUrl, openExternalUrl } from "./open-url";

/** Theme styles for agent replies rendered by markdown-to-jsx/native. */
function replyStyles(theme: PluginTheme): NativeStyles {
  const { colors } = theme;
  const text = { color: colors.foreground, fontSize: fontSize.content, lineHeight: 24 } as const;
  return {
    text,
    paragraph: { ...text, marginBottom: space.sm },
    heading1: { color: colors.foreground, fontSize: fontSize.heading, fontWeight: "600", lineHeight: 28, marginBottom: space.sm },
    heading2: { color: colors.foreground, fontSize: fontSize.title, fontWeight: "600", lineHeight: 26, marginBottom: space.sm },
    heading3: { color: colors.foreground, fontSize: fontSize.body, fontWeight: "600", lineHeight: 22, marginBottom: space.xs },
    heading4: { color: colors.foreground, fontSize: fontSize.small, fontWeight: "600", marginBottom: space.xs },
    heading5: { color: colors.foreground, fontSize: fontSize.meta, fontWeight: "600" },
    heading6: { color: colors.foregroundMuted, fontSize: fontSize.meta, fontWeight: "600" },
    link: { color: hue(theme, "blue", "text"), textDecorationLine: "underline" },
    codeInline: { fontFamily: monoFont, fontSize: fontSize.small, backgroundColor: colors.surface2 },
    codeBlock: { backgroundColor: colors.surface1, borderRadius: radius.md, borderWidth: hairline, borderColor: colors.border, padding: space.sm, marginVertical: space.sm },
    blockquote: { borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: space.md, marginVertical: space.xs },
    listOrdered: { marginVertical: space.xs, gap: space.xs },
    listUnordered: { marginVertical: space.xs, gap: space.xs },
    listItem: { marginBottom: space.xs },
    strong: { fontWeight: "600" },
    table: { borderWidth: hairline, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden", marginVertical: space.sm },
    tableHeader: { backgroundColor: colors.surface1 },
    tableHeaderCell: { paddingHorizontal: space.sm, paddingVertical: space.xs, minWidth: 72 },
    tableHeaderText: { color: colors.foreground, fontSize: fontSize.small, fontWeight: "600", lineHeight: 20 },
    tableRow: { backgroundColor: colors.surface0 },
    tableCell: { paddingHorizontal: space.sm, paddingVertical: space.xs, minWidth: 72 },
    tableCellDivider: { borderRightWidth: hairline, borderRightColor: colors.border },
    tableRowDivider: { borderBottomWidth: hairline, borderBottomColor: colors.border },
    thematicBreak: { height: hairline, backgroundColor: colors.border, marginVertical: space.md },
  };
}

/** Drop images and non-http(s) URLs; keep the library's XSS filter for everything else. */
function replySanitizer(value: string, tag: string, attribute: string): string | null {
  const name = tag.toLowerCase(), attr = attribute.toLowerCase();
  if (name === "img" || attr === "src" || attr === "srcset") return null;
  const cleaned = mdSanitizer(value, tag, attribute);
  if (cleaned == null) return null;
  if (attr === "href" && !isHttpUrl(cleaned)) return null;
  return cleaned;
}

/** Full GFM replies via markdown-to-jsx/native: tables, lists, code, etc. Links open http(s) only; images and raw HTML are off.
    Memoized: the reply re-parses only when the text or the theme changes, not on every parent poll while a turn streams. */
export const OutputMarkdown = memo(function OutputMarkdown({ theme, text }: { theme: PluginTheme; text: string }) {
  const options = useMemo(() => ({
    disableParsingRawHTML: true,
    forceBlock: true,
    styles: replyStyles(theme),
    sanitizer: replySanitizer,
    onLinkPress: (url: string) => { if (isHttpUrl(url)) void openExternalUrl(url).catch(() => {}); },
  }), [theme]);
  return <Markdown options={options}>{text}</Markdown>;
});
