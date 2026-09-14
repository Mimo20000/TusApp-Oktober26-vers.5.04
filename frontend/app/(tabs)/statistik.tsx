import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";

import { colors, spacing, radius, font } from "@/src/theme";
import { api, StatsResponse, PlayerStat } from "@/src/api";
import { Header, Chips } from "@/src/ui";

type Mode = "overall" | "games" | "trainings" | "streak" | "gefahren" | "bier";
type Scope = "all" | "season";

export default function Statistik() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<Mode>("overall");
  const [scope, setScope] = useState<Scope>("all");

  const load = useCallback(async () => {
    try {
      setData(await api.stats(scope));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const isCount = mode === "gefahren" || mode === "bier" || mode === "streak";
  const valueOf = (p: PlayerStat) =>
    mode === "games"
      ? p.games_rate
      : mode === "trainings"
      ? p.trainings_rate
      : mode === "streak"
      ? p.streak ?? 0
      : mode === "gefahren"
      ? p.driving_count
      : mode === "bier"
      ? p.beer_count
      : p.overall_rate;

  const ranked = useMemo(() => {
    if (!data) return [];
    return [...data.players].sort((a, b) => valueOf(b) - valueOf(a));
  }, [data, mode]);

  const maxVal = useMemo(
    () => (isCount ? Math.max(1, ...ranked.map(valueOf)) : 100),
    [ranked, mode]
  );

  const subOf = (p: PlayerStat) => {
    if (mode === "gefahren") return `${p.driving_count}× gefahren`;
    if (mode === "bier") return `${p.beer_count}× Bier gebracht`;
    if (mode === "streak")
      return (p.streak ?? 0) === 0 ? "Noch keine Serie" : `${p.streak}× in Folge zugesagt`;
    if (mode === "games") return `${p.games_confirmed} von ${p.games_total} zugesagt`;
    if (mode === "trainings") return `${p.trainings_confirmed} von ${p.trainings_total} zugesagt`;
    return `${p.overall_confirmed} von ${p.overall_total} zugesagt`;
  };

  const teamAvg = useMemo(() => {
    if (!data || data.players.length === 0) return 0;
    return Math.round(data.players.reduce((s, p) => s + p.overall_rate, 0) / data.players.length);
  }, [data]);

  return (
    <View style={styles.container}>
      <Header title="Statistik" subtitle="Nur gespielte Termine · Zukünftiges zählt nicht" />
      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing["3xl"] }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing["2xl"] }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
        >
          <Chips
            options={[
              { key: "all", label: "Alle Jahre" },
              { key: "season", label: "Dieses Jahr" },
            ]}
            value={scope}
            onChange={setScope}
          />

          <View style={styles.metricRow}>
            <MetricCard icon="pulse" value={`${teamAvg}%`} label="Ø Beteiligung" highlight />
            <MetricCard icon="trophy" value={String(data?.games_count ?? 0)} label="Spiele" />
            <MetricCard icon="fitness" value={String(data?.trainings_count ?? 0)} label="Trainings" />
          </View>

          <Chips
            options={[
              { key: "overall", label: "Gesamt" },
              { key: "games", label: "Spiele" },
              { key: "trainings", label: "Trainings" },
              { key: "streak", label: "Serie 🔥" },
              { key: "gefahren", label: "Gefahren" },
              { key: "bier", label: "Bier gebracht" },
            ]}
            value={mode}
            onChange={setMode}
          />

          <View style={{ paddingHorizontal: spacing.lg }}>
            <Text style={styles.sectionTitle}>Rangliste</Text>
            {ranked.map((p, i) => (
              <View key={p.id} style={styles.statRow} testID={`stat-row-${p.id}`}>
                <View style={[styles.rank, i < 3 && styles.rankTop]}>
                  <Text style={[styles.rankText, i < 3 && { color: colors.onBrand }]}>{i + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.statHead}>
                    <Text style={styles.statName} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.statPct}>
                      {mode === "streak"
                        ? `${valueOf(p)} 🔥`
                        : isCount
                        ? `${valueOf(p)}×`
                        : `${valueOf(p)}%`}
                    </Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${Math.round((valueOf(p) / maxVal) * 100)}%` }]} />
                  </View>
                  <Text style={styles.statSub}>{subOf(p)}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function MetricCard({
  icon,
  value,
  label,
  highlight,
}: {
  icon: any;
  value: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.metric, highlight && styles.metricHighlight]}>
      <Ionicons name={icon} size={18} color={highlight ? colors.onBrand : colors.brand} />
      <Text style={[styles.metricValue, highlight && { color: colors.onBrand }]}>{value}</Text>
      <Text style={[styles.metricLabel, highlight && { color: "rgba(255,255,255,0.85)" }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  metricRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  metric: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricHighlight: { backgroundColor: colors.brand, borderColor: colors.brand },
  metricValue: { fontFamily: font.extra, fontSize: 20, color: colors.onSurface, marginTop: 4 },
  metricLabel: { fontFamily: font.medium, fontSize: 11, color: colors.muted, marginTop: 2 },
  sectionTitle: {
    fontFamily: font.bold,
    fontSize: 16,
    color: colors.onSurface,
    marginBottom: spacing.md,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rank: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  rankTop: { backgroundColor: colors.brand },
  rankText: { fontFamily: font.extra, fontSize: 13, color: colors.onSurfaceSecondary },
  statHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  statName: { fontFamily: font.bold, fontSize: 15, color: colors.onSurface, flex: 1 },
  statPct: { fontFamily: font.extra, fontSize: 15, color: colors.brand, marginLeft: spacing.sm },
  barTrack: {
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    marginTop: 6,
    overflow: "hidden",
  },
  barFill: { height: 7, borderRadius: radius.pill, backgroundColor: colors.brand },
  statSub: { fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 4 },
});
