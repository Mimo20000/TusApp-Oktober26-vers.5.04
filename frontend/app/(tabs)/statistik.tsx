import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  Modal,
  TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font } from "@/src/theme";
import { api, StatsResponse, PlayerStat, TeamEvent, Attendance } from "@/src/api";
import { useSession } from "@/src/session";
import { Header, Chips, formatDate } from "@/src/ui";

type Mode = "overall" | "games" | "trainings" | "streak" | "gefahren" | "bier";
type Scope = "all" | "season";
type EditFilter = "open" | "all";
type AttStatus = "zugesagt" | "abgesagt" | null;

export default function Statistik() {
  const insets = useSafeAreaInsets();
  const { player: me } = useSession();
  const isCoach = (me?.position || "").toLowerCase() === "coach";

  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<Mode>("overall");
  const [scope, setScope] = useState<Scope>("all");

  // Coach: retroactive attendance editor
  const [editTarget, setEditTarget] = useState<PlayerStat | null>(null);
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [attMap, setAttMap] = useState<Record<string, AttStatus>>({});
  const [reasonMap, setReasonMap] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [editLoading, setEditLoading] = useState(false);
  const [editFilter, setEditFilter] = useState<EditFilter>("open");
  const [savingKey, setSavingKey] = useState<string | null>(null);

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

  // ── Coach editor ──────────────────────────────────────────────────────
  const todayIso = new Date().toISOString().slice(0, 10);

  const pastEvents = useMemo(
    () =>
      events
        .filter(
          (e) =>
            (e.type === "Spiel" || e.type === "Training") &&
            !e.cancelled &&
            (e.date || "") <= todayIso
        )
        .sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [events, todayIso]
  );

  const openEditor = async (p: PlayerStat) => {
    Haptics.selectionAsync();
    setEditTarget(p);
    setEditFilter("open");
    setTouched(new Set());
    if (events.length === 0) {
      setEditLoading(true);
      try {
        const [ev, att] = await Promise.all([api.events(), api.attendance()]);
        setEvents(ev);
        const m: Record<string, AttStatus> = {};
        const rm: Record<string, string> = {};
        att.forEach((a: Attendance) => {
          const k = `${a.player_id}|${a.event_id}`;
          m[k] = (a.status as AttStatus) ?? null;
          if (a.reason) rm[k] = a.reason;
        });
        setAttMap(m);
        setReasonMap(rm);
      } finally {
        setEditLoading(false);
      }
    }
  };

  const closeEditor = async () => {
    setEditTarget(null);
    await load(); // leaderboard reflects the retroactive edits
  };

  const setStatus = async (eid: string, status: AttStatus) => {
    if (!editTarget) return;
    const key = `${editTarget.id}|${eid}`;
    const prev = attMap[key] ?? null;
    if (prev === status) return;
    setSavingKey(key);
    setAttMap((m) => ({ ...m, [key]: status })); // optimistic
    setTouched((s) => new Set(s).add(eid)); // keep row visible in "Nur offene"
    try {
      await api.coachSetAttendance(
        eid,
        editTarget.id,
        status,
        status === "abgesagt" ? reasonMap[key] || "" : null
      );
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setAttMap((m) => ({ ...m, [key]: prev })); // revert on error
    } finally {
      setSavingKey(null);
    }
  };

  const saveReason = async (eid: string) => {
    if (!editTarget) return;
    const key = `${editTarget.id}|${eid}`;
    if ((attMap[key] ?? null) !== "abgesagt") return;
    try {
      await api.coachSetAttendance(eid, editTarget.id, "abgesagt", reasonMap[key] || "");
    } catch {
      // keep local text; coach can retry
    }
  };

  const editRows = useMemo(() => {
    if (!editTarget) return [];
    return pastEvents.filter((e) => {
      if (editFilter === "all") return true;
      const st = attMap[`${editTarget.id}|${e.id}`] ?? null;
      // "Nur offene": still show rows the coach just edited this session, so
      // an absence reason can be typed right after marking abwesend.
      return st === null || touched.has(e.id);
    });
  }, [editTarget, pastEvents, attMap, editFilter, touched]);

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
            {isCoach ? (
              <Text style={styles.coachHint}>
                <Ionicons name="create-outline" size={13} color={colors.brand} /> Tippe einen
                Spieler, um die Anwesenheit nachzutragen.
              </Text>
            ) : null}
            {ranked.map((p, i) => {
              const RowContent = (
                <>
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
                  {isCoach ? (
                    <Ionicons name="create-outline" size={18} color={colors.muted} />
                  ) : null}
                </>
              );
              return isCoach ? (
                <Pressable
                  key={p.id}
                  testID={`stat-edit-${p.id}`}
                  onPress={() => openEditor(p)}
                  style={({ pressed }) => [styles.statRow, pressed && { backgroundColor: colors.brandSecondary }]}
                >
                  {RowContent}
                </Pressable>
              ) : (
                <View key={p.id} style={styles.statRow} testID={`stat-row-${p.id}`}>
                  {RowContent}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Coach: retroactive attendance editor */}
      <Modal
        visible={!!editTarget}
        animationType="slide"
        transparent
        onRequestClose={closeEditor}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]} testID="att-editor">
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle} numberOfLines={1}>{editTarget?.name}</Text>
                <Text style={styles.sheetSub}>Anwesenheit nachtragen · nur vergangene Termine</Text>
              </View>
              <Pressable testID="att-editor-close" onPress={closeEditor} style={styles.closeBtn} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.onSurface} />
              </Pressable>
            </View>

            <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
              <Chips
                options={[
                  { key: "open", label: "Nur offene" },
                  { key: "all", label: "Alle Termine" },
                ]}
                value={editFilter}
                onChange={setEditFilter}
              />
            </View>

            {editLoading ? (
              <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing["2xl"] }} />
            ) : editRows.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="checkmark-done-outline" size={36} color={colors.muted} />
                <Text style={styles.emptyText}>
                  {editFilter === "open"
                    ? "Keine offenen Termine — alles abgestimmt. 👍"
                    : "Keine vergangenen Termine vorhanden."}
                </Text>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 460 }}
                contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}
                showsVerticalScrollIndicator={false}
              >
                {editRows.map((e) => {
                  const key = `${editTarget!.id}|${e.id}`;
                  const cur = attMap[key] ?? null;
                  const d = formatDate(e.date);
                  return (
                    <View key={e.id} style={styles.editItem}>
                      <View style={styles.editRow}>
                        <View style={styles.editDate}>
                          <Ionicons
                            name={e.type === "Spiel" ? "trophy" : "fitness"}
                            size={13}
                            color={e.type === "Spiel" ? colors.brand : colors.muted}
                          />
                          <Text style={styles.editDay}>{d.weekday} {d.day}.{d.month}</Text>
                        </View>
                        <Text style={styles.editLabel} numberOfLines={1}>
                          {e.type === "Spiel" ? (e.opponent ? e.opponent : "Spiel") : "Training"}
                        </Text>
                        <View style={styles.triState}>
                          <TriBtn
                            icon="checkmark"
                            active={cur === "zugesagt"}
                            color={colors.success}
                            busy={savingKey === key}
                            onPress={() => setStatus(e.id, "zugesagt")}
                            testID={`att-set-${e.id}-yes`}
                          />
                          <TriBtn
                            icon="close"
                            active={cur === "abgesagt"}
                            color={colors.error}
                            onPress={() => setStatus(e.id, "abgesagt")}
                            testID={`att-set-${e.id}-no`}
                          />
                          <TriBtn
                            icon="remove"
                            active={cur === null}
                            color={colors.muted}
                            onPress={() => setStatus(e.id, null)}
                            testID={`att-set-${e.id}-open`}
                          />
                        </View>
                      </View>
                      {cur === "abgesagt" ? (
                        <View style={styles.reasonWrap}>
                          <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.error} />
                          <TextInput
                            testID={`att-reason-${e.id}`}
                            style={styles.reasonInput}
                            value={reasonMap[key] ?? ""}
                            onChangeText={(t) => setReasonMap((m) => ({ ...m, [key]: t }))}
                            onEndEditing={() => saveReason(e.id)}
                            onBlur={() => saveReason(e.id)}
                            placeholder="Grund frei eintragen – z. B. krank, Arbeit, Urlaub"
                            placeholderTextColor={colors.muted}
                            returnKeyType="done"
                          />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TriBtn({
  icon,
  active,
  color,
  onPress,
  busy,
  testID,
}: {
  icon: any;
  active: boolean;
  color: string;
  onPress: () => void;
  busy?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={busy}
      style={[styles.triBtn, active && { backgroundColor: color, borderColor: color }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={active ? colors.onBrand : color} />
      ) : (
        <Ionicons name={icon} size={18} color={active ? colors.onBrand : color} />
      )}
    </Pressable>
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
    marginBottom: spacing.sm,
  },
  coachHint: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: colors.onSurfaceSecondary,
    marginBottom: spacing.md,
    lineHeight: 18,
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

  // Modal / editor
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.sm,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.sm,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  sheetTitle: { fontFamily: font.extra, fontSize: 19, color: colors.onSurface },
  sheetSub: { fontFamily: font.regular, fontSize: 13, color: colors.muted, marginTop: 2 },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyWrap: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing["3xl"], paddingHorizontal: spacing.xl },
  emptyText: { fontFamily: font.medium, fontSize: 14, color: colors.muted, textAlign: "center" },
  editItem: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.xs,
  },
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  editDate: { width: 92, flexDirection: "row", alignItems: "center", gap: 4 },
  editDay: { fontFamily: font.bold, fontSize: 12.5, color: colors.onSurface },
  editLabel: { flex: 1, fontFamily: font.medium, fontSize: 13, color: colors.onSurfaceSecondary },
  triState: { flexDirection: "row", gap: 6 },
  reasonWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 4,
    paddingBottom: spacing.sm,
  },
  reasonInput: {
    flex: 1,
    height: 38,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    fontFamily: font.regular,
    fontSize: 13,
    color: colors.onSurface,
    backgroundColor: colors.surfaceSecondary,
  },
  triBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});
