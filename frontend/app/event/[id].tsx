import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";

import { Platform } from "react-native";

import { colors, spacing, radius, font } from "@/src/theme";
import { api, EventOverview, EventOverviewPlayer } from "@/src/api";
import { formatDate } from "@/src/ui";
import { useSession } from "@/src/session";

const CLUB = "TuS Oberhausen II";

function openInMaps(query: string) {
  const q = encodeURIComponent(query);
  const url =
    Platform.OS === "ios"
      ? `https://maps.apple.com/?q=${q}`
      : `https://www.google.com/maps/search/?api=1&query=${q}`;
  Linking.openURL(url).catch(() => {});
}

export default function EventDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { player } = useSession();
  const isCoach = (player?.position ?? "").toLowerCase() === "coach";
  const [data, setData] = useState<EventOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.eventOverview(id));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const ev = data?.event;
  const isGame = ev?.type === "Spiel";
  const isTraining = ev?.type === "Training";
  const d = ev ? formatDate(ev.date) : null;
  const title = ev ? (ev.type === "Spiel" ? `vs. ${ev.opponent}` : ev.type) : "Termin";

  const zusagen = data?.players.filter((p) => p.rsvp === "zugesagt") ?? [];
  const absagen = data?.players.filter((p) => p.rsvp === "abgesagt") ?? [];
  const offen = data?.players.filter((p) => !p.rsvp) ?? [];
  const fahrer = data?.players.filter((p) => p.driving) ?? [];
  const bier = data?.players.filter((p) => p.beer) ?? [];
  const isAwayGame = isGame && !!ev && ev.home !== CLUB && !ev.cancelled;
  const needsRide = isAwayGame ? zusagen.filter((p) => !p.driving) : [];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="event-detail-back" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onBrand} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing["3xl"] }} />
      ) : !ev ? (
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.muted} />
          <Text style={styles.emptyText}>Termin nicht gefunden.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
        >
          {/* Event info */}
          <View style={styles.infoCard}>
            {ev.cancelled ? (
              <View style={styles.cancelBadge}>
                <Ionicons name="close-circle" size={13} color={colors.onError} />
                <Text style={styles.cancelBadgeText}>Abgesagt</Text>
              </View>
            ) : null}
            <View style={styles.metaLine}>
              <Ionicons name="calendar-outline" size={15} color={colors.brand} />
              <Text style={styles.metaText}>{d?.full}</Text>
            </View>
            <View style={styles.metaLine}>
              <Ionicons name="time-outline" size={15} color={colors.brand} />
              <Text style={styles.metaText}>{ev.time} Uhr</Text>
            </View>
            {ev.location ? (
              <View style={styles.metaLine}>
                <Ionicons name="location-outline" size={15} color={colors.brand} />
                <Text style={styles.metaText}>{ev.location}</Text>
                {isGame && ev.home && ev.home !== CLUB && !ev.cancelled ? (
                  <Pressable
                    testID={`maps-detail-${ev.id}`}
                    onPress={() =>
                      openInMaps(`${ev.location}${ev.opponent ? ", " + ev.opponent : ""}`)
                    }
                    hitSlop={8}
                    style={styles.mapsBtn}
                    accessibilityLabel="In Google Maps öffnen"
                  >
                    <Ionicons name="navigate" size={14} color={colors.brand} />
                    <Text style={styles.mapsBtnText}>Route</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Summary */}
          <View style={styles.summaryRow}>
            <SummaryCard icon="checkmark-circle" value={data!.summary.zusagen} label="Zusagen" color={colors.success} />
            <SummaryCard icon="close-circle" value={data!.summary.absagen} label="Absagen" color={colors.error} />
            <SummaryCard icon="help-circle" value={data!.summary.offen} label="Offen" color={colors.muted} />
          </View>
          <View style={styles.summaryRow}>
            {isGame ? (
              <SummaryCard icon="car-sport" value={data!.summary.fahrer} label="Fahrer" color={colors.brand} wide />
            ) : null}
            {isTraining ? (
              <SummaryCard icon="beer" value={data!.summary.bier} label="Bier" color={colors.brand} wide />
            ) : null}
          </View>

          {/* Driving / Beer highlight */}
          {isGame ? (
            <Section title="Fahrgemeinschaft 🚗" players={fahrer} emptyText="Noch niemand fährt." highlight />
          ) : null}
          {isAwayGame ? <RideShareSuggestion needsRide={needsRide} drivers={fahrer} /> : null}
          {isTraining ? (
            <Section title="Bringt Bier 🍺" players={bier} emptyText="Noch kein Bier zugesagt." highlight />
          ) : null}

          <Section
            title="Zusagen"
            players={zusagen}
            emptyText="Noch keine Zusagen."
            tint={colors.success}
            isCoach={isCoach}
            eventId={ev.id}
            onChanged={load}
          />
          <Section
            title="Absagen"
            players={absagen}
            emptyText="Keine Absagen."
            tint={colors.error}
            isCoach={isCoach}
            eventId={ev.id}
            onChanged={load}
          />
          <Section
            title="Offen"
            players={offen}
            emptyText="Alle haben geantwortet."
            tint={colors.muted}
            isCoach={isCoach}
            eventId={ev.id}
            onChanged={load}
          />
        </ScrollView>
      )}
    </View>
  );
}

function CoachBtn({
  icon,
  active,
  activeColor,
  onPress,
  disabled,
  testID,
}: {
  icon: any;
  active: boolean;
  activeColor: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.coachBtn,
        active && { backgroundColor: activeColor, borderColor: activeColor },
        (pressed || disabled) && { opacity: 0.65 },
      ]}
    >
      <Ionicons name={icon} size={14} color={active ? colors.onBrand : colors.onSurfaceSecondary} />
    </Pressable>
  );
}

function RideShareSuggestion({
  needsRide,
  drivers,
}: {
  needsRide: EventOverviewPlayer[];
  drivers: EventOverviewPlayer[];
}) {
  const [driveCounts, setDriveCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await api.stats();
        if (!alive) return;
        const map: Record<string, number> = {};
        for (const p of s.players) map[p.id] = p.driving_count ?? 0;
        setDriveCounts(map);
      } catch {
        // ignore — the ranking just falls back to "unknown" (0).
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const need = needsRide.length;
  if (need === 0 && drivers.length === 0) return null;

  // Order drivers by fairness: fewest completed trips first.
  const rankedDrivers = [...drivers].sort(
    (a, b) => (driveCounts[a.id] ?? 0) - (driveCounts[b.id] ?? 0)
  );
  const pick = rankedDrivers[0] ?? null;

  return (
    <View style={styles.rideCard} testID="rideshare-suggestion">
      <View style={styles.rideHeader}>
        <Ionicons name="car-sport" size={16} color={colors.brand} />
        <Text style={styles.rideHeaderText}>Fahrgemeinschaft-Vorschlag</Text>
      </View>
      {need === 0 ? (
        <Text style={styles.rideEmpty}>Alle Zugesagten fahren selbst — top organisiert! ✅</Text>
      ) : drivers.length === 0 ? (
        <Text style={styles.rideEmpty}>
          {need === 1 ? "1 Spieler braucht" : `${need} Spieler brauchen`} eine Mitfahrgelegenheit — es hat sich aber noch kein Fahrer gemeldet. Bitte kurz koordinieren!
        </Text>
      ) : (
        <>
          <Text style={styles.rideBody}>
            {need === 1 ? "1 Spieler braucht" : `${need} Spieler brauchen`} eine Mitfahrgelegenheit:
          </Text>
          <View style={styles.rideChipRow}>
            {needsRide.map((p) => (
              <View key={p.id} style={styles.rideChip} testID={`needs-ride-${p.id}`}>
                {p.jersey_number != null ? (
                  <Text style={styles.rideChipNum}>{p.jersey_number}</Text>
                ) : null}
                <Text style={styles.rideChipName} numberOfLines={1}>
                  {p.name}
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.rideDivider} />
          <Text style={styles.rideBody}>Fahrer-Rotation (fair aufgeteilt):</Text>
          <View style={styles.rideChipRow}>
            {rankedDrivers.map((d, idx) => {
              const c = driveCounts[d.id] ?? 0;
              return (
                <View
                  key={d.id}
                  style={[styles.rideChip, idx === 0 && styles.rideChipTop]}
                  testID={`ride-rank-${d.id}`}
                >
                  {idx === 0 ? <Text style={styles.rideStar}>⭐</Text> : null}
                  <Text
                    style={[
                      styles.rideChipName,
                      idx === 0 && { color: colors.onBrand, fontFamily: font.bold },
                    ]}
                    numberOfLines={1}
                  >
                    {d.name}
                  </Text>
                  <View style={[styles.rideCountBadge, idx === 0 && styles.rideCountBadgeTop]}>
                    <Text
                      style={[styles.rideCountText, idx === 0 && { color: colors.brand }]}
                    >
                      {c}×
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
          {pick ? (
            <View style={styles.rideHintRow}>
              <Text style={styles.rideHintText}>
                💡 Als Nächste dran: <Text style={styles.rideHintName}>{pick.name}</Text>
                {(driveCounts[pick.id] ?? 0) === 0
                  ? " (war noch nie dran)"
                  : ` (bisher ${driveCounts[pick.id]}× gefahren)`}
                {pick.email ? " – Mail-Icon rechts nutzen." : " – im Team-Chat pingen."}
              </Text>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function SummaryCard({
  icon,
  value,
  label,
  color,
  wide,
}: {
  icon: any;
  value: number;
  label: string;
  color: string;
  wide?: boolean;
}) {
  return (
    <View style={[styles.summaryCard, wide && { flex: 1 }]}>
      <Ionicons name={icon} size={18} color={color} />
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function Section({
  title,
  players,
  emptyText,
  tint,
  highlight,
  isCoach,
  eventId,
  onChanged,
}: {
  title: string;
  players: EventOverviewPlayer[];
  emptyText: string;
  tint?: string;
  highlight?: boolean;
  isCoach?: boolean;
  eventId?: string;
  onChanged?: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  const setStatus = async (p: EventOverviewPlayer, next: "zugesagt" | "abgesagt" | null) => {
    if (!eventId || busyId) return;
    setBusyId(p.id);
    try {
      if (next === null) {
        // Reset to "Offen" by clearing status directly.
        await api.rsvpReset(eventId, p.id);
      } else if (next === "abgesagt") {
        // Coach quick-taps use a generic reason so the mandatory validation passes.
        await api.rsvp(eventId, p.id, "abgesagt", p.reason || "Vom Coach eingetragen");
      } else {
        await api.rsvp(eventId, p.id, "zugesagt");
      }
      onChanged?.();
    } catch (e) {
      console.warn("[coach-rsvp] failed", e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.countPill}>
          <Text style={styles.countText}>{players.length}</Text>
        </View>
      </View>
      {players.length === 0 ? (
        <Text style={styles.sectionEmpty}>{emptyText}</Text>
      ) : (
        <View style={[styles.playerWrap, highlight && styles.playerWrapHighlight]}>
          {players.map((p) => (
            <View key={p.id} style={styles.playerRow} testID={`overview-player-${p.id}`}>
              <View style={[styles.dot, { backgroundColor: tint ?? colors.brand }]} />
              {p.jersey_number != null ? (
                <View style={styles.jersey}>
                  <Text style={styles.jerseyText}>{p.jersey_number}</Text>
                </View>
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.playerName} numberOfLines={1}>{p.name}</Text>
                {p.rsvp === "abgesagt" && p.reason ? (
                  <Text
                    testID={`overview-reason-${p.id}`}
                    style={styles.playerReason}
                    numberOfLines={2}
                  >
                    Grund: {p.reason}
                  </Text>
                ) : null}
                {p.email ? (
                  <Pressable
                    testID={`overview-email-${p.id}`}
                    onPress={() => Linking.openURL(`mailto:${p.email}`)}
                    hitSlop={6}
                    style={styles.emailBtn}
                  >
                    <Ionicons name="mail" size={12} color={colors.brand} />
                    <Text style={styles.emailText} numberOfLines={1}>{p.email}</Text>
                  </Pressable>
                ) : null}
              </View>
              {isCoach && eventId ? (
                <View style={styles.coachActions} testID={`coach-actions-${p.id}`}>
                  <CoachBtn
                    icon="checkmark"
                    active={p.rsvp === "zugesagt"}
                    activeColor={colors.success}
                    testID={`coach-yes-${p.id}`}
                    disabled={busyId === p.id}
                    onPress={() => setStatus(p, "zugesagt")}
                  />
                  <CoachBtn
                    icon="close"
                    active={p.rsvp === "abgesagt"}
                    activeColor={colors.error}
                    testID={`coach-no-${p.id}`}
                    disabled={busyId === p.id}
                    onPress={() => setStatus(p, "abgesagt")}
                  />
                  <CoachBtn
                    icon="remove"
                    active={p.rsvp === null || p.rsvp === undefined}
                    activeColor={colors.muted}
                    testID={`coach-clear-${p.id}`}
                    disabled={busyId === p.id}
                    onPress={() => setStatus(p, null)}
                  />
                </View>
              ) : p.position ? (
                <Text style={styles.playerPos}>{p.position}</Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  backBtn: { marginRight: spacing.xs },
  headerTitle: { fontFamily: font.extra, fontSize: 18, color: colors.onBrand, flex: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  emptyText: { fontFamily: font.medium, fontSize: 14, color: colors.muted },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  cancelBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    backgroundColor: colors.error,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  cancelBadgeText: { fontFamily: font.bold, fontSize: 12, color: colors.onError },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaText: { fontFamily: font.medium, fontSize: 14, color: colors.onSurface, flex: 1 },
  mapsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
    marginLeft: spacing.xs,
  },
  mapsBtnText: { fontFamily: font.bold, fontSize: 11, color: colors.brand },
  summaryRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryValue: { fontFamily: font.extra, fontSize: 20, marginTop: 4 },
  summaryLabel: { fontFamily: font.medium, fontSize: 11, color: colors.muted, marginTop: 2 },
  rideCard: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand,
    gap: spacing.xs,
  },
  rideHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rideHeaderText: {
    fontFamily: font.bold,
    fontSize: 12,
    color: colors.brand,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  rideEmpty: { fontFamily: font.regular, fontSize: 13, color: colors.onSurfaceSecondary },
  rideBody: { fontFamily: font.medium, fontSize: 14, color: colors.onSurface },
  rideChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  rideChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
    maxWidth: 220,
  },
  rideChipTop: {
    backgroundColor: colors.brand,
  },
  rideStar: { fontSize: 14 },
  rideCountBadge: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 4,
  },
  rideCountBadgeTop: {
    backgroundColor: colors.surface,
  },
  rideCountText: {
    fontFamily: font.bold,
    fontSize: 11,
    color: colors.onSurfaceSecondary,
  },
  rideDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  rideChipNum: {
    fontFamily: font.extra,
    fontSize: 12,
    color: colors.brand,
    minWidth: 16,
    textAlign: "center",
  },
  rideChipName: { fontFamily: font.medium, fontSize: 13, color: colors.onSurface, flexShrink: 1 },
  rideHintRow: { marginTop: 6 },
  rideHintText: { fontFamily: font.regular, fontSize: 13, color: colors.onSurfaceSecondary },
  rideHintName: { fontFamily: font.bold, color: colors.brand },
  section: { marginTop: spacing.xl },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: font.bold, fontSize: 16, color: colors.onSurface },
  countPill: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontFamily: font.bold, fontSize: 12, color: colors.onSurfaceSecondary },
  sectionEmpty: { fontFamily: font.regular, fontSize: 13, color: colors.muted },
  playerWrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  playerWrapHighlight: { borderColor: colors.brand, backgroundColor: colors.brandSecondary },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  jersey: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  jerseyText: { fontFamily: font.extra, fontSize: 12, color: colors.onBrand },
  playerName: { fontFamily: font.medium, fontSize: 15, color: colors.onSurface },
  playerReason: {
    fontFamily: font.medium,
    fontSize: 12,
    color: colors.error,
    marginTop: 2,
  },
  emailBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  emailText: { fontFamily: font.medium, fontSize: 12, color: colors.brand, flexShrink: 1 },
  playerPos: { fontFamily: font.bold, fontSize: 12, color: colors.brand },
  coachActions: { flexDirection: "row", gap: 4 },
  coachBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceTertiary,
  },
});
