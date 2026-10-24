import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing, radius, font } from "@/src/theme";

const logo = require("../assets/images/tus-logo.jpg");

const MONTHS = [
  "Jan", "Feb", "März", "Apr", "Mai", "Juni",
  "Juli", "Aug", "Sept", "Okt", "Nov", "Dez",
];
const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export function formatDate(iso: string): { day: string; month: string; weekday: string; full: string } {
  const d = new Date(iso + "T00:00:00");
  return {
    day: String(d.getDate()),
    month: MONTHS[d.getMonth()],
    weekday: WEEKDAYS[d.getDay()],
    full: `${WEEKDAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
  };
}

export function Header({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[headerStyles.wrap, { paddingTop: insets.top + spacing.md }]} testID="app-header">
      <LinearGradient colors={[colors.brand, "#B41F13"]} style={StyleSheet.absoluteFill} />
      <View style={headerStyles.rowTop}>
        <Image source={logo} style={headerStyles.logo} contentFit="contain" />
        <View style={{ flex: 1 }}>
          <Text style={headerStyles.title}>{title}</Text>
          {subtitle ? <Text style={headerStyles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    overflow: "hidden",
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  logo: { width: 34, height: 46 },
  title: { fontFamily: font.extra, fontSize: 22, color: colors.onBrand },
  subtitle: {
    fontFamily: font.medium,
    fontSize: 13,
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
  },
});

export function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={chipStyles.row}
      style={chipStyles.scroller}
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            testID={`chip-${o.key}`}
            onPress={() => onChange(o.key)}
            style={[chipStyles.chip, active ? chipStyles.chipActive : chipStyles.chipIdle]}
          >
            <Text style={[chipStyles.text, active ? chipStyles.textActive : chipStyles.textIdle]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const chipStyles = StyleSheet.create({
  scroller: { maxHeight: 56, flexGrow: 0, flexShrink: 0 },
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  chip: {
    height: 36,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    justifyContent: "center",
    borderWidth: 1,
    flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipIdle: { backgroundColor: colors.surface, borderColor: colors.border },
  text: { fontFamily: font.bold, fontSize: 13 },
  textActive: { color: colors.onBrand },
  textIdle: { color: colors.onSurfaceSecondary },
});
