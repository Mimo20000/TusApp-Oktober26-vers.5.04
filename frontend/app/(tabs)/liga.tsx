import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font } from "@/src/theme";
import { api, BwhvTeam, BwhvClass, BwhvGame } from "@/src/api";
import { Header } from "@/src/ui";

type View2 = "tabelle" | "spielplan";

export default function Liga() {
  const insets = useSafeAreaInsets();
  const [teams, setTeams] = useState<BwhvTeam[]>([]);
  const [classId, setClassId] = useState<string | null>(null);
  const [data, setData] = useState<BwhvClass | null>(null);
  const [view, setView] = useState<View2>("tabelle");
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const loadTeams = useCallback(async () => {
    try {
      const res = await api.bwhvTeams();
      setTeams(res.teams);
      setClassId(
        (prev) => prev ?? (res.teams.find((t) => t.is_default) ?? res.teams[0])?.class_id ?? null
      );
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoadingTeams(false);
    }
  }, []);

  const loadClass = useCallback(async (cid: string) => {
    setLoading(true);
    try {
      setData(await api.bwhvClass(cid));
      setError(false);
    } catch {
      setError(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { loadTeams(); }, [loadTeams]));
  useEffect(() => { if (classId) loadClass(classId); }, [classId, loadClass]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadTeams();
    if (classId) await loadClass(classId);
    setRefreshing(false);
  };

  const selectTeam = (cid: string) => {
    if (cid === classId) return;
    Haptics.selectionAsync();
    setClassId(cid);
  };

  const hasTable = (data?.table?.length ?? 0) > 0;

  return (
    <View style={styles.container}>
      <Header
        title="Tabelle"
        subtitle={data?.team_name ? `${data.team_name} · offiziell` : "Offiziell · handball4all / BWHV"}
      />

      {/* Team switcher */}
      {teams.length > 0 ? (
        <View style={styles.chipsWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            {teams.map((t) => {
              const active = t.class_id === classId;
              return (
                <Pressable
                  key={t.class_id}
                  testID={`team-chip-${t.class_id}`}
                  onPress={() => selectTeam(t.class_id)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {/* View toggle */}
      <View style={styles.segment}>
        {(["tabelle", "spielplan"] as View2[]).map((v) => {
          const active = view === v;
          return (
            <Pressable
              key={v}
              testID={`seg-${v}`}
              onPress={() => setView(v)}
              style={[styles.segBtn, active && styles.segBtnActive]}
            >
              <Ionicons
                name={v === "tabelle" ? "podium-outline" : "calendar-outline"}
                size={16}
                color={active ? colors.onBrand : colors.muted}
              />
              <Text style={[styles.segText, active && styles.segTextActive]}>
                {v === "tabelle" ? "Tabelle" : "Spielplan"}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loadingTeams || loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing["3xl"] }} />
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.sm,
            paddingBottom: insets.bottom + spacing["2xl"],
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
        >
          {error ? (
            <EmptyState
              icon="cloud-offline-outline"
              title="Daten nicht erreichbar"
              text="Bitte später erneut versuchen (zum Aktualisieren ziehen)."
            />
          ) : view === "tabelle" ? (
            hasTable ? (
              <StandingsTable data={data!} />
            ) : (
              <EmptyState
                icon="hourglass-outline"
                title="Tabelle noch nicht verfügbar"
                text="Sobald Spiele gewertet wurden, erscheint hier der aktuelle Stand."
              />
            )
          ) : (data?.games?.length ?? 0) > 0 ? (
            <Schedule games={data!.games} />
          ) : (
            <EmptyState
              icon="calendar-outline"
              title="Keine Spiele gefunden"
              text="Für diese Mannschaft liegen aktuell keine Spiele vor."
            />
          )}

          {!error && data?.class_name ? (
            <Text style={styles.source}>{data.class_name}{"\n"}Quelle: handball4all · BWHV · zum Aktualisieren ziehen</Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function StandingsTable({ data }: { data: BwhvClass }) {
  return (
    <View style={styles.table} testID="liga-table">
      <View style={styles.headRow}>
        <Text style={[styles.hCell, styles.cRank]}>#</Text>
        <Text style={[styles.hCell, styles.cTeam]}>Team</Text>
        <Text style={[styles.hCell, styles.cNum]}>Sp</Text>
        <Text style={[styles.hCell, styles.cDiff]}>Diff</Text>
        <Text style={[styles.hCell, styles.cPts]}>Pkt</Text>
      </View>
      {data.table.map((r, i) => (
        <View
          key={`${r.rank}-${r.team}-${i}`}
          style={[styles.dataRow, r.is_own && styles.ownRow]}
          testID={`liga-row-${i + 1}`}
        >
          <Text style={[styles.cell, styles.cRank, styles.rankText]}>{r.rank}</Text>
          <Text style={[styles.cell, styles.cTeam, r.is_own && styles.ownText]} numberOfLines={1}>
            {r.team}
          </Text>
          <Text style={[styles.cell, styles.cNum]}>{r.games}</Text>
          <Text style={[styles.cell, styles.cDiff]}>
            {r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff}
          </Text>
          <Text style={[styles.cell, styles.cPts, styles.ptsText, r.is_own && styles.ownText]}>
            {r.points_str ?? r.points}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Schedule({ games }: { games: BwhvGame[] }) {
  return (
    <View style={{ gap: spacing.sm }} testID="liga-schedule">
      {games.map((g) => (
        <GameRow key={g.id || `${g.date}-${g.time}`} g={g} />
      ))}
    </View>
  );
}

function GameRow({ g }: { g: BwhvGame }) {
  const ownGoals = g.is_home ? g.home_goals : g.guest_goals;
  const oppGoals = g.is_home ? g.guest_goals : g.home_goals;
  let accent = colors.border;
  let resultLabel = "";
  let resultColor = colors.muted;
  if (g.played && ownGoals != null && oppGoals != null) {
    if (ownGoals > oppGoals) {
      accent = colors.success;
      resultLabel = "S";
      resultColor = colors.success;
    } else if (ownGoals < oppGoals) {
      accent = colors.error;
      resultLabel = "N";
      resultColor = colors.error;
    } else {
      accent = colors.muted;
      resultLabel = "U";
      resultColor = colors.muted;
    }
  }
  const homeWon = g.played && g.home_goals != null && g.guest_goals != null && g.home_goals > g.guest_goals;
  const guestWon = g.played && g.home_goals != null && g.guest_goals != null && g.guest_goals > g.home_goals;

  return (
    <View style={[styles.gameCard, { borderLeftColor: accent }]}>
      <View style={styles.dateCol}>
        <Text style={styles.gDate}>{g.weekday} {g.date}</Text>
        <Text style={styles.gTime}>{g.time} Uhr</Text>
        {g.town ? <Text style={styles.gTown} numberOfLines={1}>{g.town}</Text> : null}
      </View>

      <View style={styles.teamsCol}>
        <View style={styles.teamLine}>
          <Text style={[styles.teamName, g.is_home && styles.ownTeamName]} numberOfLines={1}>
            {g.home}
          </Text>
          <Text style={[styles.score, g.played && homeWon && styles.scoreWin]}>
            {g.played ? g.home_goals : "–"}
          </Text>
        </View>
        <View style={styles.teamLine}>
          <Text style={[styles.teamName, !g.is_home && styles.ownTeamName]} numberOfLines={1}>
            {g.guest}
          </Text>
          <Text style={[styles.score, g.played && guestWon && styles.scoreWin]}>
            {g.played ? g.guest_goals : "–"}
          </Text>
        </View>
      </View>

      {resultLabel ? (
        <View style={[styles.resultBadge, { backgroundColor: resultColor }]}>
          <Text style={styles.resultText}>{resultLabel}</Text>
        </View>
      ) : (
        <View style={styles.upcomingDot}>
          <Ionicons name="time-outline" size={16} color={colors.muted} />
        </View>
      )}
    </View>
  );
}

function EmptyState({ icon, title, text }: { icon: any; title: string; text: string }) {
  return (
    <View style={styles.info}>
      <Ionicons name={icon} size={40} color={colors.muted} />
      <Text style={styles.infoTitle}>{title}</Text>
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },

  chipsWrap: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  chipsRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontFamily: font.medium, fontSize: 13, color: colors.onSurfaceSecondary },
  chipTextActive: { color: colors.onBrand, fontFamily: font.bold },

  segment: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  segBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segBtnActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  segText: { fontFamily: font.medium, fontSize: 14, color: colors.muted },
  segTextActive: { color: colors.onBrand, fontFamily: font.bold },

  table: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSecondary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderStrong,
  },
  hCell: { fontFamily: font.bold, fontSize: 12, color: colors.onSurfaceSecondary },
  dataRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  ownRow: { backgroundColor: colors.brandSecondary },
  cell: { fontFamily: font.medium, fontSize: 13, color: colors.onSurface },
  cRank: { width: 26, textAlign: "center" },
  cTeam: { flex: 1, paddingHorizontal: spacing.sm },
  cNum: { width: 32, textAlign: "center" },
  cDiff: { width: 44, textAlign: "center" },
  cPts: { width: 54, textAlign: "right" },
  rankText: { fontFamily: font.extra, color: colors.onSurfaceSecondary },
  ptsText: { fontFamily: font.extra, color: colors.onSurface },
  ownText: { fontFamily: font.extra, color: colors.brand },

  gameCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 4,
    padding: spacing.md,
    gap: spacing.md,
  },
  dateCol: { width: 92 },
  gDate: { fontFamily: font.bold, fontSize: 13, color: colors.onSurface },
  gTime: { fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 1 },
  gTown: { fontFamily: font.regular, fontSize: 11, color: colors.muted, marginTop: 2 },
  teamsCol: { flex: 1, gap: 6 },
  teamLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  teamName: { flex: 1, fontFamily: font.medium, fontSize: 14, color: colors.onSurface, paddingRight: spacing.sm },
  ownTeamName: { fontFamily: font.extra, color: colors.brand },
  score: { fontFamily: font.bold, fontSize: 15, color: colors.onSurface, minWidth: 22, textAlign: "right" },
  scoreWin: { color: colors.success, fontFamily: font.extra },
  resultBadge: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  resultText: { fontFamily: font.extra, fontSize: 13, color: colors.onBrand },
  upcomingDot: { width: 26, alignItems: "center", justifyContent: "center" },

  source: {
    fontFamily: font.regular,
    fontSize: 11,
    color: colors.muted,
    textAlign: "center",
    paddingVertical: spacing.lg,
    lineHeight: 16,
  },
  info: { alignItems: "center", paddingTop: spacing["3xl"], paddingHorizontal: spacing.xl, gap: spacing.sm },
  infoTitle: { fontFamily: font.bold, fontSize: 17, color: colors.onSurface, marginTop: spacing.sm },
  infoText: { fontFamily: font.regular, fontSize: 14, color: colors.muted, textAlign: "center" },
});
