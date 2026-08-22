import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, statusColor } from "@/src/theme";
import { api, Player } from "@/src/api";
import { pickImageFile } from "@/src/media";

const STATUS_OPTIONS: ("Aktiv" | "Verletzt" | "Inaktiv")[] = ["Aktiv", "Verletzt", "Inaktiv"];
const pad = (n: number) => String(n).padStart(2, "0");

function parseDate(s?: string | null) {
  const d = new Date(1995, 0, 1);
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, day] = s.split("-").map(Number);
    d.setFullYear(y, m - 1, day);
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

export function displayBirthdate(s?: string | null) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}

type Props = {
  visible: boolean;
  player: Player | null;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
};

export default function PlayerEditSheet({ visible, player, isAdmin, onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [email, setEmail] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [jersey, setJersey] = useState("");
  const [spielerId, setSpielerId] = useState("");
  const [avatarFileId, setAvatarFileId] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [status, setStatus] = useState<"Aktiv" | "Verletzt" | "Inaktiv">("Aktiv");
  const [showDate, setShowDate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (player) {
      setName(player.name ?? "");
      setPosition(player.position ?? "");
      setEmail(player.email ?? "");
      setBirthdate(player.birthdate ?? "");
      setJersey(player.jersey_number != null ? String(player.jersey_number) : "");
      setSpielerId(player.spieler_id ?? "");
      setAvatarFileId(player.avatar_file_id ?? "");
      setStatus((player.status as any) || "Aktiv");
      setConfirmDelete(false);
      setError(null);
    }
  }, [player]);

  const remove = async () => {
    if (!player) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await api.deletePlayer(player.id);
      onSaved();
      onClose();
    } catch {
      setError("Löschen fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  const choosePhoto = async () => {
    try {
      const picked = await pickImageFile();
      if (!picked) return;
      setUploadingPhoto(true);
      setError(null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const res = await api.uploadFile(picked.base64, picked.filename, picked.mime, "image");
      setAvatarFileId(res.file_id);
    } catch {
      setError("Foto konnte nicht hochgeladen werden.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const save = async () => {
    if (!player) return;
    if (isAdmin && !name.trim()) {
      setError("Name darf nicht leer sein.");
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Bitte gültige E-Mail eingeben.");
      return;
    }
    if (birthdate && !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) {
      setError("Geburtsdatum im Format JJJJ-MM-TT.");
      return;
    }
    const jerseyNum = jersey.trim() ? parseInt(jersey.trim(), 10) : 0;
    if (jersey.trim() && (isNaN(jerseyNum) || jerseyNum < 1 || jerseyNum > 99)) {
      setError("Trikotnummer zwischen 1 und 99.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (isAdmin) {
        const np: { name?: string; position?: string | null } = {};
        if (name.trim() && name.trim() !== player.name) np.name = name.trim();
        if ((position.trim() || "") !== (player.position ?? "")) np.position = position.trim() || null;
        if (Object.keys(np).length) await api.updatePlayer(player.id, np);
      }
      await api.updateContact(player.id, {
        email: email.trim(),
        birthdate: birthdate.trim(),
        jersey_number: jerseyNum,
        avatar_file_id: avatarFileId || "",
        spieler_id: spielerId.trim(),
      });
      if (isAdmin && status !== player.status) {
        await api.updateStatus(player.id, status);
      }
      onSaved();
      onClose();
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 401) {
        setError("Sitzung abgelaufen. Bitte erneut anmelden.");
      } else if (status === 403) {
        setError("Nur der Trainer darf dies für andere Spieler ändern.");
      } else {
        setError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
      }
    } finally {
      setSaving(false);
    }
  };

  const bdLabel = displayBirthdate(birthdate) ?? "Datum wählen";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.overlay} onPress={onClose} testID="player-edit-sheet">
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <View>
                <Text style={styles.title}>{player?.name}</Text>
                <Text style={styles.subtitle}>Kontaktdaten bearbeiten</Text>
              </View>
              <Pressable testID="player-edit-close" onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.photoBlock}>
                <View style={styles.photoWrap}>
                  {avatarFileId ? (
                    <Image
                      source={{ uri: api.fileThumbUrl(avatarFileId) }}
                      style={styles.photo}
                      contentFit="cover"
                      transition={150}
                    />
                  ) : jersey.trim() ? (
                    <Text style={styles.photoJersey} testID="photo-jersey">{jersey.trim()}</Text>
                  ) : (
                    <Ionicons name="person" size={38} color={colors.muted} />
                  )}
                  {uploadingPhoto ? (
                    <View style={styles.photoOverlay}>
                      <ActivityIndicator color={colors.onBrand} />
                    </View>
                  ) : null}
                </View>
                <View style={styles.photoBtns}>
                  <Pressable testID="choose-photo" onPress={choosePhoto} style={styles.photoBtn} disabled={uploadingPhoto}>
                    <Ionicons name="camera" size={16} color={colors.brand} />
                    <Text style={styles.photoBtnText}>{avatarFileId ? "Foto ändern" : "Foto wählen"}</Text>
                  </Pressable>
                  {avatarFileId ? (
                    <Pressable testID="remove-photo" onPress={() => setAvatarFileId("")} style={styles.photoBtn} disabled={uploadingPhoto}>
                      <Ionicons name="trash-outline" size={16} color={colors.error} />
                      <Text style={[styles.photoBtnText, { color: colors.error }]}>Entfernen</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              {isAdmin ? (
                <>
                  <Text style={styles.label}>Name</Text>
                  <TextInput
                    testID="input-name"
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="Vor- und Nachname"
                    placeholderTextColor={colors.muted}
                  />
                  <Text style={styles.label}>Position</Text>
                  <TextInput
                    testID="input-position"
                    style={styles.input}
                    value={position}
                    onChangeText={setPosition}
                    placeholder="z. B. RM, TW, LA"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="characters"
                  />
                </>
              ) : null}

              <Text style={styles.label}>E-Mail</Text>
              <TextInput
                testID="input-email"
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="name@example.de"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                keyboardType="email-address"
                inputMode="email"
              />

              <Text style={styles.label}>Geburtsdatum</Text>
              {Platform.OS === "web" ? (
                <TextInput
                  testID="input-birthdate"
                  style={styles.input}
                  value={birthdate}
                  onChangeText={setBirthdate}
                  placeholder="JJJJ-MM-TT"
                  placeholderTextColor={colors.muted}
                />
              ) : (
                <Pressable testID="pick-birthdate" style={styles.pickBtn} onPress={() => setShowDate(true)}>
                  <Ionicons name="calendar-outline" size={18} color={colors.brand} />
                  <Text style={styles.pickText}>{bdLabel}</Text>
                </Pressable>
              )}

              <Text style={styles.label}>Trikotnummer</Text>
              <TextInput
                testID="input-jersey"
                style={styles.input}
                value={jersey}
                onChangeText={(t) => setJersey(t.replace(/[^0-9]/g, "").slice(0, 2))}
                placeholder="z. B. 7"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={2}
              />

              <Text style={styles.label}>SpielerID (SL)</Text>
              <TextInput
                testID="input-spieler-id"
                style={styles.input}
                value={spielerId}
                onChangeText={setSpielerId}
                placeholder="z. B. 1234567 (aus SpielPlusR / Handball360)"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={40}
              />
              <Text style={styles.hint}>Öffne Handball360 → dein Profil → oben unter deinem Namen findest du die SpielerID.</Text>

              {isAdmin ? (
                <>
                  <Text style={styles.label}>Status (nur Trainer)</Text>
                  <View style={styles.statusRow}>
                    {STATUS_OPTIONS.map((opt) => {
                      const active = status === opt;
                      return (
                        <Pressable
                          key={opt}
                          testID={`status-option-${opt}`}
                          onPress={() => setStatus(opt)}
                          style={[styles.statusChip, active && styles.statusChipActive]}
                        >
                          <View style={[styles.dot, { backgroundColor: statusColor(opt) }]} />
                          <Text style={[styles.statusChipText, active && { color: colors.onSurface }]}>
                            {opt}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Pressable
                testID="save-player"
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={save}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.onBrand} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={18} color={colors.onBrand} />
                    <Text style={styles.saveText}>Speichern</Text>
                  </>
                )}
              </Pressable>

              {isAdmin ? (
                <Pressable
                  testID="delete-player"
                  style={[styles.deleteBtn, confirmDelete && styles.deleteBtnConfirm]}
                  onPress={remove}
                  disabled={saving}
                >
                  <Ionicons
                    name="trash-outline"
                    size={18}
                    color={confirmDelete ? colors.onError : colors.error}
                  />
                  <Text style={[styles.deleteText, confirmDelete && { color: colors.onError }]}>
                    {confirmDelete ? "Wirklich entfernen? Nochmal tippen" : "Spieler entfernen"}
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>

      {showDate && Platform.OS !== "web" && (
        <DateTimePicker
          value={parseDate(birthdate)}
          mode="date"
          minimumDate={new Date(1940, 0, 1)}
          maximumDate={new Date()}
          onChange={(_e, sel) => {
            setShowDate(Platform.OS === "ios");
            if (sel) {
              setBirthdate(`${sel.getFullYear()}-${pad(sel.getMonth() + 1)}-${pad(sel.getDate())}`);
            }
          }}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    maxHeight: "88%",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  title: { fontFamily: font.extra, fontSize: 20, color: colors.onSurface },
  subtitle: { fontFamily: font.regular, fontSize: 13, color: colors.muted, marginTop: 2 },
  label: {
    fontFamily: font.bold,
    fontSize: 13,
    color: colors.onSurfaceSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  input: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontFamily: font.medium,
    fontSize: 15,
    color: colors.onSurface,
  },
  pickBtn: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pickText: { fontFamily: font.medium, fontSize: 15, color: colors.onSurface },
  photoBlock: { alignItems: "center", marginTop: spacing.sm, marginBottom: spacing.sm },
  photoWrap: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  photo: { width: 84, height: 84, borderRadius: radius.pill },
  photoJersey: { fontFamily: font.extra, fontSize: 38, color: colors.brand, lineHeight: 44 },
  photoOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.pill,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoBtns: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
  photoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
  },
  photoBtnText: { fontFamily: font.bold, fontSize: 13, color: colors.brand },
  statusRow: { flexDirection: "row", gap: spacing.sm },
  statusChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusChipActive: { borderColor: colors.brand, backgroundColor: colors.brandSecondary },
  statusChipText: { fontFamily: font.bold, fontSize: 13, color: colors.onSurfaceSecondary },
  dot: { width: 8, height: 8, borderRadius: 4 },
  error: { fontFamily: font.medium, fontSize: 13, color: colors.error, marginTop: spacing.md },
  hint: { fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 6, lineHeight: 16 },
  saveBtn: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.xl,
  },
  saveText: { fontFamily: font.extra, fontSize: 16, color: colors.onBrand },
  deleteBtn: {
    height: 48,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.error,
    backgroundColor: colors.errorSoft,
  },
  deleteBtnConfirm: { backgroundColor: colors.error, borderColor: colors.error },
  deleteText: { fontFamily: font.bold, fontSize: 15, color: colors.error },
});
