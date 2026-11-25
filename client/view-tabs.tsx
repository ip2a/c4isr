import { Pressable, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { fontSize, hairline, space } from "./kit";

export interface ViewTab<Value extends string> { value: Value; label: string; count?: number }

/**
 * Main surface tabs: text + optional count, underline on the selected item (same language as kit `Tabs`).
 * Scrolls sideways when the row does not fit.
 */
export function ViewTabs<Value extends string>({ theme, value, tabs, onChange, accessibilityLabel }: {
  theme: PluginTheme; value: Value; tabs: readonly ViewTab<Value>[]; onChange: (value: Value) => void; accessibilityLabel?: string;
}) {
  const { colors } = theme;
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={{ flexDirection: "row", alignItems: "stretch", gap: space.lg, minHeight: 40 }}>
      {tabs.map(tab => {
        const selected = tab.value === value;
        const name = tab.count === undefined ? tab.label : `${tab.label} ${tab.count}`;
        return <Pressable key={tab.value} accessibilityRole="tab" accessibilityLabel={name} accessibilityState={{ selected }} aria-selected={selected} onPress={() => onChange(tab.value)}
          style={state => ({
            flexDirection: "row", alignItems: "center", gap: space.xs + 1, minHeight: 40, paddingBottom: 2,
            marginBottom: -hairline, borderBottomWidth: 2, borderBottomColor: selected ? colors.foreground : "transparent",
            opacity: (state as { pressed?: boolean }).pressed ? 0.8 : 1,
          })}>
          <Text numberOfLines={1} style={{ color: selected ? colors.foreground : colors.foregroundMuted, fontSize: fontSize.body, fontWeight: selected ? "500" : "400" }}>{tab.label}</Text>
          {tab.count !== undefined ? <Text style={{ color: colors.foregroundMuted, fontSize: fontSize.meta, fontWeight: selected && tab.count ? "600" : "400", fontVariant: ["tabular-nums"] }}>{tab.count}</Text> : null}
        </Pressable>;
      })}
    </View>
  </ScrollView>;
}
