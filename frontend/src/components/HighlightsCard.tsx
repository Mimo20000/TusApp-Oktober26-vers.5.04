import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { colors, spacing, radius, font } from "@/src/theme";
import { api, PlayerStat } from "@/src/api";

type Highlight = { icon: any; emoji: string; label: string; name: string; suffix: string; testID: string };

/**
 * Rotates two "Highlight of the Week" tiles at the top of Termine:
 *   🎖️ Treuster Spieler — highest overall attendance
 *   🍺 Bier-Champion — most beers brought to trainings
 *
 * The leader is computed from `/api/stats` (already returns full ranking).
 * If nobody has any activity yet, the card hides itself so the empty state
 * on new teams stays clean. Tapping the card jumps to the full Statistik tab.
 */
export default function HighlightsCard() {
  const router = useRouter();
  const [highlights, setHighlights] = useState<Highlight[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await api.stats();
        if (!alive) return;
        setHighlights(pickHighlights(s.players));
      } catch {
        if (alive) setHighlights([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!highlights || highlights.length === 0) return null;

  return (
    <Pressable
      testID="highlights-card"
      onPress={() => router.push("/statistik")}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.headerRow}>
        <Ionicons name="trophy" size={16} color={colors.brand} />
        <Text style={styles.headerText}>Diese Woche im Team</Text>
      </View>
      <View style={styles.row}>
        {highlights.map((h) => (
          <View key={h.testID} style={styles.tile} testID={h.testID}>
            <Text style={styles.tileEmoji}>{h.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.tileLabel}>{h.label}</Text>
              <Text style={styles.tileName} numberOfLines={1}>
                {h.name}
              </Text>
              <Text style={styles.tileSuffix}>{h.suffix}</Text>
            </View>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

function pickHighlights(players: PlayerStat[]): Highlight[] {
  const items: Highlight[] = [];
  const topLoyal = [...players]
    .filter((p) => p.overall_total > 0)
    .sort((a, b) => b.overall_rate - a.overall_rate || b.overall_confirmed - a.overall_confirmed)[0];
  if (topLoyal && topLoyal.overall_confirmed > 0) {
    items.push({
      icon: "medal",
      emoji: "🎖️",
      label: "Treuster Spieler",
      name: topLoyal.name,
      suffix: `${topLoyal.overall_rate}% Anwesenheit`,
      testID: "highlight-loyal",
    });
  }
  const topBeer = [...players]
    .filter((p) => (p.beer_count ?? 0) > 0)
    .sort((a, b) => (b.beer_count ?? 0) - (a.beer_count ?? 0))[0];
  if (topBeer) {
    items.push({
      icon: "beer",
      emoji: "🍺",
      label: "Bier-Champion",
      name: topBeer.name,
      suffix:
        (topBeer.beer_count ?? 0) === 1 ? "1× gebracht" : `${topBeer.beer_count}× gebracht`,
      testID: "highlight-beer",
    });
  }
  return items;
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  headerText: {
    fontFamily: font.bold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.brand,
  },
  row: { flexDirection: "row", gap: spacing.sm },
  tile: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
  },
  tileEmoji: { fontSize: 22 },
  tileLabel: {
    fontFamily: font.medium,
    fontSize: 11,
    color: colors.onSurfaceSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  tileName: {
    fontFamily: font.bold,
    fontSize: 14,
    color: colors.onSurface,
  },
  tileSuffix: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.onSurfaceSecondary,
    marginTop: 1,
  },
});
