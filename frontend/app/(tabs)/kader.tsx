import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  Linking,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, statusColor } from "@/src/theme";
import { api, Player } from "@/src/api";
import { useSession } from "@/src/session";
import { Header, Chips } from "@/src/ui";
import PlayerEditSheet, { displayBirthdate } from "@/src/PlayerEditSheet";

type Filter = "alle" | "Aktiv" | "Verletzt" | "Inaktiv";

export default function Kader() {
  const insets = useSafeAreaInsets();
  const { player } = useSession();
  const isAdmin = player?.position === "Coach";
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>("alle");
  const [editing, setEditing] = useState<Player | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPos, setNewPos] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const addPlayer = async () => {
    if (!newName.trim()) {
      setAddError("Bitte Name eingeben.");
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await api.createPlayer({ name: newName.trim(), position: newPos.trim() || null });
      setNewName("");
      setNewPos("");
      setShowAdd(false);
      load();
    } catch {
      setAddError("Konnte Spieler nicht anlegen.");
    } finally {
      setAdding(false);
    }
  };

  const load = useCallback(async () => {
    try {
      setPlayers(await api.players());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const emailPlayer = (email: string) => {
    Haptics.selectionAsync();
    Linking.openURL(`mailto:${email}`);
  };

  const filtered = useMemo(() => {
    // Status priority: Aktiv → Verletzt → Inaktiv. Within a status, keep the
    // alphabetical order that the backend already returns so the list feels
    // stable when players are toggled.
    const rank: Record<string, number> = { Aktiv: 0, Verletzt: 1, Inaktiv: 2 };
    return [...players]
      .filter((p) => (filter === "alle" ? true : p.status === filter))
      .sort((a, b) => {
        const ra = rank[a.status] ?? 99;
        const rb = rank[b.status] ?? 99;
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name, "de");
      });
  }, [players, filter]);

  return (
    <View style={styles.container}>
      <Header
        title="Kader"
        subtitle={
          isAdmin
            ? `Trainer-Modus · Tippe eine Zeile zum Bearbeiten (Foto, E-Mail, Nummer, Status)`
            : `Tippe deinen Namen für Foto, E-Mail, Geburtsdatum & Trikotnummer`
        }
      />
      <Chips
        options={[
          { key: "alle", label: "Alle" },
          { key: "Aktiv", label: "Aktiv" },
          { key: "Verletzt", label: "Verletzt" },
          { key: "Inaktiv", label: "Inaktiv" },
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
          {filtered.map((p) => {
            const editable = isAdmin || player?.id === p.id;
            const bd = displayBirthdate(p.birthdate);
            const rowInner = (
              <>
                <View style={styles.avatar}>
                  {p.avatar_file_id ? (
                    <Image
                      source={{ uri: api.fileThumbUrl(p.avatar_file_id) }}
                      style={styles.avatarImg}
                      contentFit="cover"
                      transition={150}
                    />
                  ) : p.jersey_number != null ? (
                    <Text style={styles.avatarJersey} testID={`avatar-jersey-${p.id}`}>
                      {p.jersey_number}
                    </Text>
                  ) : (
                    <Text style={styles.avatarText}>{p.position ?? "?"}</Text>
                  )}
                  {p.avatar_file_id && p.jersey_number != null ? (
                    <View style={styles.jerseyBadge}>
                      <Text style={styles.jerseyBadgeText}>{p.jersey_number}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{p.name}</Text>
                  <Text style={styles.pos}>
                    {positionLabel(p.position)}
                    {p.jersey_number != null ? ` · Nr. ${p.jersey_number}` : ""}
                    {bd ? ` · Geb. ${bd}` : ""}
                  </Text>
                  {p.email ? (
                    <Pressable
                      testID={`email-btn-${p.id}`}
                      onPress={() => emailPlayer(p.email!)}
                      style={styles.emailBtn}
                      hitSlop={6}
                    >
                      <Ionicons name="mail" size={13} color={colors.brand} />
                      <Text style={styles.emailText} numberOfLines={1}>{p.email}</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.rightCol}>
                  <View style={styles.statusPill}>
                    <View style={[styles.dot, { backgroundColor: statusColor(p.status) }]} />
                    <Text style={[styles.statusText, { color: statusColor(p.status) }]}>
                      {p.status}
                    </Text>
                  </View>
                  {editable ? (
                    <Ionicons name="create-outline" size={16} color={colors.muted} />
                  ) : null}
                </View>
              </>
            );
            return editable ? (
              <Pressable
                key={p.id}
                testID={`kader-row-${p.id}`}
                onPress={() => setEditing(p)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.brandSecondary }]}
              >
                {rowInner}
              </Pressable>
            ) : (
              <View key={p.id} style={styles.row} testID={`kader-row-${p.id}`}>
                {rowInner}
              </View>
            );
          })}
        </ScrollView>
      )}

      <PlayerEditSheet
        visible={!!editing}
        player={editing}
        isAdmin={isAdmin}
        roster={players}
        onClose={() => setEditing(null)}
        onSaved={load}
      />

      {isAdmin ? (
        <Pressable
          testID="add-player-fab"
          style={[styles.fab, { bottom: spacing.lg }]}
          onPress={() => {
            setNewName("");
            setNewPos("");
            setAddError(null);
            setShowAdd(true);
          }}
        >
          <Ionicons name="person-add" size={24} color={colors.onBrand} />
        </Pressable>
      ) : null}

      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable style={styles.overlay} onPress={() => setShowAdd(false)} testID="add-player-modal">
            <Pressable style={[styles.addSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
              <View style={styles.addHandle} />
              <Text style={styles.addTitle}>Neuer Spieler</Text>
              <Text style={styles.addLabel}>Name</Text>
              <TextInput
                testID="new-player-name"
                style={styles.addInput}
                value={newName}
                onChangeText={setNewName}
                placeholder="Vor- und Nachname"
                placeholderTextColor={colors.muted}
                autoFocus
              />
              <Text style={styles.addLabel}>Position (optional)</Text>
              <TextInput
                testID="new-player-position"
                style={styles.addInput}
                value={newPos}
                onChangeText={setNewPos}
                placeholder="z. B. RM, TW, LA"
                placeholderTextColor={colors.muted}
                autoCapitalize="characters"
              />
              {addError ? <Text style={styles.addErr}>{addError}</Text> : null}
              <Pressable
                testID="save-new-player"
                style={[styles.addSaveBtn, adding && { opacity: 0.6 }]}
                onPress={addPlayer}
                disabled={adding}
              >
                {adding ? (
                  <ActivityIndicator color={colors.onBrand} />
                ) : (
                  <Text style={styles.addSaveText}>Spieler hinzufügen</Text>
                )}
              </Pressable>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function positionLabel(pos?: string | null) {
  const map: Record<string, string> = {
    TW: "Torwart",
    LA: "Linksaußen",
    RA: "Rechtsaußen",
    RL: "Rückraum links",
    RM: "Rückraum mitte",
    RR: "Rückraum rechts",
    KL: "Kreisläufer",
    Coach: "Trainer",
  };
  return pos ? map[pos] ?? pos : "Position offen";
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: { width: 46, height: 46, borderRadius: radius.pill },
  avatarText: { fontFamily: font.extra, fontSize: 14, color: colors.brand },
  avatarJersey: { fontFamily: font.extra, fontSize: 20, color: colors.brand, lineHeight: 24 },
  jerseyBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  jerseyBadgeText: { fontFamily: font.extra, fontSize: 11, color: colors.onBrand },
  name: { fontFamily: font.bold, fontSize: 16, color: colors.onSurface },
  pos: { fontFamily: font.regular, fontSize: 13, color: colors.onSurfaceSecondary, marginTop: 2 },
  emailBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    marginTop: 6,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
    maxWidth: "100%",
  },
  emailText: { fontFamily: font.medium, fontSize: 12, color: colors.brand, flexShrink: 1 },
  rightCol: { alignItems: "flex-end", gap: 6 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: font.medium, fontSize: 12 },
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
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  addSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  addHandle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  addTitle: { fontFamily: font.extra, fontSize: 20, color: colors.onSurface, marginBottom: spacing.sm },
  addLabel: {
    fontFamily: font.bold,
    fontSize: 13,
    color: colors.onSurfaceSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  addInput: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontFamily: font.medium,
    fontSize: 15,
    color: colors.onSurface,
  },
  addErr: { fontFamily: font.medium, fontSize: 13, color: colors.error, marginTop: spacing.md },
  addSaveBtn: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xl,
  },
  addSaveText: { fontFamily: font.extra, fontSize: 16, color: colors.onBrand },
});
