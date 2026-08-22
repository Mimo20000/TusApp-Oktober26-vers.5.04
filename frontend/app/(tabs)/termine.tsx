import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";

import { colors, spacing, radius, font } from "@/src/theme";
import { api, TeamEvent, Attendance, Holiday } from "@/src/api";
import { useSession } from "@/src/session";
import { Header, Chips } from "@/src/ui";
import AddEventModal from "@/src/AddEventModal";
import AbsageReasonModal from "@/src/AbsageReasonModal";
import { buildIcs } from "@/src/ics";
import EventCard from "@/src/components/EventCard";
import HolidayInsert from "@/src/components/HolidayInsert";
import EmptyState from "@/src/components/EmptyState";

type Filter = "alle" | "Spiel" | "Training" | "Treffen";

export default function Termine() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { player, logout } = useSession();
  const isAdmin = player?.position === "Coach";
  const [events, setEvents] = useState<TeamEvent[]>([]);
  const [att, setAtt] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("alle");
  const [showAdd, setShowAdd] = useState(false);
  const [editEvent, setEditEvent] = useState<TeamEvent | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [driving, setDriving] = useState<Record<string, boolean>>({});
  const [beer, setBeer] = useState<Record<string, boolean>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pendingAbsage, setPendingAbsage] = useState<TeamEvent | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const exportCalendar = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const ics = buildIcs(events);
      if (Platform.OS === "web" || !(await Sharing.isAvailableAsync())) {
        showToast("Kalender-Export wird auf diesem Gerät nicht unterstützt.");
        return;
      }
      const file = new File(Paths.cache, "TuS_Termine.ics");
      if (file.exists) file.delete();
      file.create();
      file.write(ics);
      await Sharing.shareAsync(file.uri, {
        mimeType: "text/calendar",
        dialogTitle: "Termine zum Kalender hinzufügen",
        UTI: "public.calendar-event",
      });
    } catch {
      showToast("Export fehlgeschlagen.");
    }
  };

  const load = useCallback(async () => {
    try {
      const [ev, attList, hol] = await Promise.all([
        api.events(),
        api.attendance(),
        api.holidays().catch(() => [] as Holiday[]),
      ]);
      setEvents(ev);
      setHolidays(hol);
      const mine: Record<string, string> = {};
      const mineDrive: Record<string, boolean> = {};
      const mineBeer: Record<string, boolean> = {};
      const mineReason: Record<string, string> = {};
      attList.forEach((a: Attendance) => {
        if (a.player_id === player?.id) {
          mine[a.event_id] = a.status;
          if (a.driving) mineDrive[a.event_id] = true;
          if (a.beer) mineBeer[a.event_id] = true;
          if (a.reason) mineReason[a.event_id] = a.reason;
        }
      });
      setAtt(mine);
      setDriving(mineDrive);
      setBeer(mineBeer);
      setReasons(mineReason);
    } finally {
      setLoading(false);
    }
  }, [player?.id]);

  useFocusEffect(
    useCallback(() => {
      if (!player) {
        router.replace("/");
        return;
      }
      load();
      api.eventsSeen(player.id).catch(() => {});
    }, [player, load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const rsvp = async (eventId: string, status: "zugesagt" | "abgesagt") => {
    if (!player) return;
    // Für "Absagen" verlangen wir einen Grund — Modal öffnen und dort abschließen.
    if (status === "abgesagt") {
      const ev = events.find((e) => e.id === eventId);
      if (ev) setPendingAbsage(ev);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAtt((prev) => ({ ...prev, [eventId]: status }));
    setReasons((prev) => {
      const { [eventId]: _drop, ...rest } = prev;
      return rest;
    });
    try {
      await api.rsvp(eventId, player.id, status);
    } catch {
      load();
    }
  };

  const submitAbsageWithReason = async (reason: string) => {
    if (!player || !pendingAbsage) return;
    const eventId = pendingAbsage.id;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAtt((prev) => ({ ...prev, [eventId]: "abgesagt" }));
    setReasons((prev) => ({ ...prev, [eventId]: reason }));
    try {
      await api.rsvp(eventId, player.id, "abgesagt", reason);
      setPendingAbsage(null);
    } catch {
      // rollback optimistic update on network error
      load();
      throw new Error("rsvp failed");
    }
  };

  const toggleDrive = async (eventId: string) => {
    if (!player) return;
    Haptics.selectionAsync();
    const next = !driving[eventId];
    setDriving((prev) => ({ ...prev, [eventId]: next }));
    try {
      await api.setDriving(eventId, player.id, next);
    } catch {
      load();
    }
  };

  const toggleBeer = async (eventId: string) => {
    if (!player) return;
    Haptics.selectionAsync();
    const next = !beer[eventId];
    setBeer((prev) => ({ ...prev, [eventId]: next }));
    try {
      await api.setBeer(eventId, player.id, next);
    } catch {
      load();
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const feed = useMemo(() => {
    const evItems = events
      .filter((e) => (filter === "alle" ? true : e.type === filter))
      .filter((e) => e.date >= today)
      .map((e) => ({ kind: "event" as const, sort: e.date + e.time, event: e }));
    let items: (
      | { kind: "event"; sort: string; event: TeamEvent }
      | { kind: "holiday"; sort: string; holiday: Holiday }
    )[] = evItems;
    if (filter === "alle") {
      const hItems = holidays
        .filter((h) => (h.end ?? h.date) >= today)
        .map((h) => ({ kind: "holiday" as const, sort: h.date + " 00:00", holiday: h }));
      items = [...evItems, ...hItems];
    }
    items.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
    return items;
  }, [events, holidays, filter]);

  return (
    <View style={styles.container}>
      <Header
        title="Termine"
        subtitle={player ? `Angemeldet: ${player.name}` : undefined}
        right={
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Pressable
              testID="export-calendar"
              onPress={exportCalendar}
              style={styles.logoutBtn}
            >
              <Ionicons name="calendar-outline" size={20} color={colors.onBrand} />
            </Pressable>
            <Pressable
              testID="logout-button"
              onPress={async () => {
                await logout();
                router.replace("/");
              }}
              style={styles.logoutBtn}
            >
              <Ionicons name="log-out-outline" size={20} color={colors.onBrand} />
            </Pressable>
          </View>
        }
      />
      <Chips
        options={[
          { key: "alle", label: "Alle" },
          { key: "Spiel", label: "Spiele" },
          { key: "Training", label: "Trainings" },
          { key: "Treffen", label: "Treffen" },
        ]}
        value={filter}
        onChange={setFilter}
      />

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing["3xl"] }} />
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingBottom: insets.bottom + spacing["2xl"],
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
        >
          {feed.length === 0 ? (
            <EmptyState />
          ) : (
            feed.map((it) =>
              it.kind === "event" ? (
                <EventCard
                  key={it.event.id}
                  event={it.event}
                  status={att[it.event.id]}
                  reason={reasons[it.event.id]}
                  driving={!!driving[it.event.id]}
                  beer={!!beer[it.event.id]}
                  isAdmin={isAdmin}
                  actorId={player?.id}
                  onEdit={() => setEditEvent(it.event)}
                  onOverview={() => router.push(`/event/${it.event.id}`)}
                  onZusagen={() => rsvp(it.event.id, "zugesagt")}
                  onAbsagen={() => rsvp(it.event.id, "abgesagt")}
                  onToggleDrive={() => toggleDrive(it.event.id)}
                  onToggleBeer={() => toggleBeer(it.event.id)}
                />
              ) : (
                <HolidayInsert key={`h-${it.holiday.name}-${it.holiday.date}`} holiday={it.holiday} />
              )
            )
          )}
        </ScrollView>
      )}

      {isAdmin ? (
        <Pressable
          testID="add-event-fab"
          style={[styles.fab, { bottom: spacing.lg }]}
          onPress={() => setShowAdd(true)}
        >
          <Ionicons name="add" size={28} color={colors.onBrand} />
        </Pressable>
      ) : null}

      <AddEventModal
        visible={showAdd || !!editEvent}
        event={editEvent}
        onClose={() => {
          setShowAdd(false);
          setEditEvent(null);
        }}
        onCreated={load}
      />

      <AbsageReasonModal
        visible={!!pendingAbsage}
        initial={pendingAbsage ? reasons[pendingAbsage.id] : ""}
        onCancel={() => setPendingAbsage(null)}
        onSubmit={submitAbsageWithReason}
      />

      {toast ? (
        <View style={[styles.toast, { bottom: insets.bottom + 90 }]} testID="toast">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  logoutBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.surfaceInverse,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  toastText: { fontFamily: font.medium, color: colors.onSurfaceInverse, fontSize: 14 },
});
