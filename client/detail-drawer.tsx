import { t } from "../shared/text";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Platform } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useReducedMotion } from "./motion";

type WebDocument = { addEventListener(type: string, listener: (event: { key?: string; defaultPrevented?: boolean }) => void, options?: boolean): void; removeEventListener(type: string, listener: unknown, options?: boolean): void };

/**
 * 方案 A 的右侧详情抽屉。选中会话时它贴住 SplitView 详情半区的四边，用不透明主题表面完整覆盖下面的
 * StatsHero（Hero 保持挂载，关闭后原位回来，列表不动）；分界只有列表槽已有的一根细线，这里不再描边。
 * 动效（审美定值）：入 180 ms 从右偏 16 px 淡入归位，出 120 ms 反向，无回弹；动画可打断，换选时
 * 抽屉留在原位直接换内容，只入场一次；跟随系统的减少动态效果直接取终态。
 */
export function DetailDrawer({ theme, open, onClose, children }: { theme: PluginTheme; open: boolean; onClose?: () => void; children: ReactNode }) {
  const reduce = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);
  // Kept through the exit animation so the panel never flashes empty; replaced on every new selection.
  const last = useRef<ReactNode>(null);
  if (open && children) last.current = children;
  const wasOpen = useRef(open);
  useEffect(() => {
    const entering = open && !wasOpen.current;
    wasOpen.current = open;
    if (open) {
      setMounted(true);
      if (reduce || !entering) { progress.setValue(1); return; }
      progress.setValue(0);
      const animation = Animated.timing(progress, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" });
      animation.start();
      return () => animation.stop();
    }
    if (reduce) { progress.setValue(0); setMounted(false); return; }
    const animation = Animated.timing(progress, { toValue: 0, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" });
    animation.start(({ finished }) => { if (finished) setMounted(false); });
    return () => animation.stop();
  }, [open, reduce, progress]);
  // Esc 关闭（桌面）：宿主 Modal 打开时不抢它的 Esc。
  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const document = (globalThis as { document?: WebDocument }).document;
    if (!document) return;
    const onKey = (event: { key?: string; defaultPrevented?: boolean }) => { if (event.key === "Escape" && !event.defaultPrevented) onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted) return null;
  return <Animated.View accessibilityLabel={t("secondarySessionColumns.detail")} pointerEvents={open ? "auto" : "none"}
    style={{ ...absolute, overflow: "hidden", backgroundColor: theme.colors.surface0, opacity: progress,
      transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
    {open ? children : last.current}
  </Animated.View>;
}

/** React Native 0.86 removed absoluteFillObject; spell the four edges out. */
const absolute = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;
