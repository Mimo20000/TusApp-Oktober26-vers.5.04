import { createElement } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";

type Props = {
  value: string; // YYYY-MM-DD
  onChange: (v: string) => void;
  testID?: string;
  min?: string;
  max?: string;
};

/**
 * Web-only birthday picker rendered as an HTML5 `<input type="date">`.
 *
 * The internal value stays ISO (YYYY-MM-DD) so it round-trips cleanly to the
 * backend, but we always render a big DD.MM.YYYY label above the input for
 * the user — many German browsers (Chrome/Edge/Firefox on non-de systems)
 * still show the date wheel in MM/DD/YYYY even when we set `lang="de-DE"`.
 * By showing the formatted label ourselves the display is deterministic.
 */
export default function WebDateInput({ value, onChange, testID, min, max }: Props) {
  const label = formatDe(value);
  return (
    <View>
      <View style={styles.previewRow} pointerEvents="none">
        <Ionicons name="calendar-outline" size={16} color={colors.brand} />
        <Text style={styles.previewText} testID={testID ? `${testID}-preview` : undefined}>
          {label || "Tippe zum Auswählen"}
        </Text>
      </View>
      {createElement("input", {
        type: "date",
        value: value || "",
        lang: "de-DE",
        onChange: (e: any) => onChange(e.target.value || ""),
        "data-testid": testID,
        min,
        max,
        style: {
          width: "100%",
          boxSizing: "border-box",
          borderRadius: radius.md,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: colors.border,
          backgroundColor: colors.surfaceTertiary,
          padding: `${spacing.sm}px ${spacing.md}px`,
          fontFamily: font.regular,
          fontSize: 15,
          color: colors.onSurface,
          outline: "none",
        },
      })}
    </View>
  );
}

function formatDe(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

const styles = StyleSheet.create({
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  previewText: {
    fontFamily: font.bold,
    fontSize: 15,
    color: colors.onSurface,
  },
});
