import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View, type ViewStyle } from "react-native";

// The tasks board's sidebar status marks (better-paseo `StatusIcon`), kept small for the eager sidebar: 需要处理 is a
// hollow ring, 执行中 a dim track with a turning quarter and a centre dot, 900 ms a turn. Web turns the arc with CSS
// keyframes; native uses Animated on the native driver. Reduced motion draws the arc still.
const web = Platform.OS === "web";
const styles = web ? StyleSheet.create({ spin: { animationKeyframes: [{ "0%": { transform: "rotate(0deg)" }, "100%": { transform: "rotate(360deg)" } }], animationDuration: "0.9s", animationIterationCount: "infinite", animationTimingFunction: "linear" } } as never) : { spin: {} };

export function SidebarStatusRing({ color, running = false, active = true, size = 14 }: { color: string; running?: boolean; active?: boolean; size?: number }) {
  const [reduce, setReduce] = useState(false), value = useRef(new Animated.Value(0)).current;
  useEffect(() => { let live = true; AccessibilityInfo.isReduceMotionEnabled?.().then(next => { if (live) setReduce(next); }).catch(() => {}); const listener = AccessibilityInfo.addEventListener?.("reduceMotionChanged", setReduce); return () => { live = false; listener?.remove(); }; }, []);
  const spin = running && active && !reduce;
  useEffect(() => { if (web || !spin) return; const animation = Animated.loop(Animated.timing(value, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true, isInteraction: false })); animation.start(); return () => animation.stop(); }, [spin, value]);
  // The reference's geometry at a 14 px box: a 10.5 px mark, 1.5 px stroke at 16 scaled down, a half-mark centre dot.
  const mark = size * 0.75, stroke = mark / 8, dot = mark / 2;
  const circle: ViewStyle = { position: "absolute", width: mark, height: mark, borderRadius: mark / 2, borderWidth: stroke };
  const arcStyle: ViewStyle = { ...circle, borderColor: "transparent", borderTopColor: color, opacity: 0.9 };
  const arc = web ? <View style={[arcStyle, styles.spin, !spin ? { animationPlayState: "paused" } as ViewStyle : null]} />
    : <Animated.View style={[arcStyle, { transform: [{ rotate: value.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }]} />;
  return <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
    {running ? <View style={[circle, { borderColor: color, opacity: 0.3 }]} /> : null}
    {running ? arc : <View style={[circle, { borderColor: color }]} />}
    {running ? <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} /> : null}
  </View>;
}
