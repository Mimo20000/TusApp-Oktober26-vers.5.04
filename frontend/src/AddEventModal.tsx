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
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font } from "@/src/theme";
import { api, TeamEvent } from "@/src/api";
import { formatDate } from "@/src/ui";

const CLUB = "TuS Oberhausen II";

const pad = (n: number) => String(n).padStart(2, "0");

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date();
  if (y && m && d) dt.setFullYear(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function parseTime(s: string) {
  const [h, mi] = s.split(":").map(Number);
  const dt = new Date();
  dt.setHours(h || 0, mi || 0, 0, 0);
  return dt;
}

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  event?: TeamEvent | null;
};

export default function AddEventModal({ visible, onClose, onCreated, event }: Props) {
  const insets = useSafeAreaInsets();
  const isEdit = !!event;
  const [type, setType] = useState<"Spiel" | "Training" | "Treffen">("Spiel");
  const [dateStr, setDateStr] = useState(todayStr());
  const [timeStr, setTimeStr] = useState("20:00");
  const [opponent, setOpponent] = useState("");
  const [location, setLocation] = useState("Rheinhausen/Rheinmatthalle");
  const [homeGame, setHomeGame] = useState(true);
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && event) {
      setType(event.type);
      setDateStr(event.date);
      setTimeStr(event.time);
      setOpponent(event.opponent ?? "");
      setLocation(event.location ?? "");
      setHomeGame(event.home === CLUB);
      setError(null);
    } else if (visible && !event) {
      reset();
    }
  }, [visible, event]);

  const reset = () => {
    setType("Spiel");
    setDateStr(todayStr());
    setTimeStr("20:00");
    setOpponent("");
    setLocation("Rheinhausen/Rheinmatthalle");
    setHomeGame(true);
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const doCancelEvent = () => {
    if (!event) return;
    const run = async () => {
      setCancelling(true);
      setError(null);
      try {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        await api.cancelEvent(event.id);
        onCreated();
        close();
      } catch {
        setError("Löschen fehlgeschlagen. Bitte erneut versuchen.");
      } finally {
        setCancelling(false);
      }
    };
    if (Platform.OS === "web") {
      // Web: use the browser confirm since Alert is a no-op on RNWeb
      // eslint-disable-next-line no-alert
      if (typeof window !== "undefined" && !window.confirm("Termin wirklich löschen? Er wird bei allen aus der Liste entfernt.")) return;
      run();
    } else {
      Alert.alert(
        "Termin löschen?",
        "Der Termin verschwindet dauerhaft aus der Liste für alle Mitglieder.",
        [
          { text: "Abbrechen", style: "cancel" },
          { text: "Löschen", style: "destructive", onPress: run },
        ]
      );
    }
  };

  const save = async () => {
    if (type === "Spiel" && !opponent.trim()) {
      setError("Bitte Gegner eingeben.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) {
      setError("Bitte gültiges Datum und Uhrzeit angeben.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (isEdit && event) {
        await api.updateEvent(event.id, {
          type,
          date: dateStr,
          time: timeStr,
          location: location.trim() || null,
          opponent: type === "Spiel" ? opponent.trim() : undefined,
          home_game: type === "Spiel" ? homeGame : undefined,
        });
      } else {
        await api.createEvent({
          type,
          date: dateStr,
          time: timeStr,
          opponent: type === "Spiel" ? opponent.trim() : undefined,
          location: location.trim() || undefined,
          home_game: homeGame,
        });
      }
      onCreated();
      close();
    } catch {
      setError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setSaving(false);
    }
  };

  const dateLabel = formatDate(dateStr).full;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.overlay} onPress={close} testID="add-event-modal">
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.handle} />
            <View style={styles.headerRow}>
              <Text style={styles.title}>{isEdit ? "Termin bearbeiten" : "Neuer Termin"}</Text>
              <Pressable testID="add-event-close" onPress={close} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Type toggle — bei Edit erlauben Coaches jetzt die Umkategorisierung */}
              <View style={styles.segment}>
                {(["Spiel", "Training", "Treffen"] as const).map((t) => (
                  <Pressable
                    key={t}
                    testID={`type-${t}`}
                    onPress={() => setType(t)}
                    style={[
                      styles.segBtn,
                      type === t && styles.segBtnActive,
                    ]}
                  >
                    <Ionicons
                      name={t === "Spiel" ? "trophy" : t === "Training" ? "fitness" : "people"}
                      size={16}
                      color={type === t ? colors.onBrand : colors.onSurfaceSecondary}
                    />
                    <Text style={[styles.segText, type === t && styles.segTextActive]}>{t}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Date */}
              <Text style={styles.label}>Datum</Text>
              {Platform.OS === "web" ? (
                <TextInput
                  testID="input-date"
                  style={styles.input}
                  value={dateStr}
                  onChangeText={setDateStr}
                  placeholder="JJJJ-MM-TT"
                  placeholderTextColor={colors.muted}
                />
              ) : (
                <Pressable testID="pick-date" style={styles.pickBtn} onPress={() => setShowDate(true)}>
                  <Ionicons name="calendar-outline" size={18} color={colors.brand} />
                  <Text style={styles.pickText}>{dateLabel}</Text>
                </Pressable>
              )}

              {/* Time */}
              <Text style={styles.label}>Uhrzeit</Text>
              {Platform.OS === "web" ? (
                <TextInput
                  testID="input-time"
                  style={styles.input}
                  value={timeStr}
                  onChangeText={setTimeStr}
                  placeholder="HH:MM"
                  placeholderTextColor={colors.muted}
                />
              ) : (
                <Pressable testID="pick-time" style={styles.pickBtn} onPress={() => setShowTime(true)}>
                  <Ionicons name="time-outline" size={18} color={colors.brand} />
                  <Text style={styles.pickText}>{timeStr} Uhr</Text>
                </Pressable>
              )}

              {/* Spiel-only fields */}
              {type === "Spiel" && (
                <>
                  <Text style={styles.label}>Gegner</Text>
                  <TextInput
                    testID="input-opponent"
                    style={styles.input}
                    value={opponent}
                    onChangeText={setOpponent}
                    placeholder="z. B. TSV March II"
                    placeholderTextColor={colors.muted}
                  />
                  <Text style={styles.label}>Spielort</Text>
                  <View style={styles.segment}>
                    {[
                      { k: true, l: "Heimspiel" },
                      { k: false, l: "Auswärts" },
                    ].map((o) => (
                      <Pressable
                        key={String(o.k)}
                        testID={`home-${o.k}`}
                        onPress={() => setHomeGame(o.k)}
                        style={[styles.segBtn, homeGame === o.k && styles.segBtnActive]}
                      >
                        <Text style={[styles.segText, homeGame === o.k && styles.segTextActive]}>
                          {o.l}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              {/* Location */}
              <Text style={styles.label}>Ort / Halle</Text>
              <TextInput
                testID="input-location"
                style={styles.input}
                value={location}
                onChangeText={setLocation}
                placeholder="Halle / Adresse"
                placeholderTextColor={colors.muted}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Pressable
                testID="save-event"
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={save}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.onBrand} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={18} color={colors.onBrand} />
                    <Text style={styles.saveText}>
                      {isEdit ? "Änderungen speichern" : "Termin speichern"}
                    </Text>
                  </>
                )}
              </Pressable>

              {isEdit && !event?.cancelled ? (
                <Pressable
                  testID="cancel-event"
                  style={[styles.cancelBtn, cancelling && { opacity: 0.6 }]}
                  onPress={doCancelEvent}
                  disabled={cancelling}
                >
                  {cancelling ? (
                    <ActivityIndicator color={colors.error} />
                  ) : (
                    <>
                      <Ionicons name="close-circle-outline" size={18} color={colors.error} />
                      <Text style={styles.cancelText}>Termin absagen</Text>
                    </>
                  )}
                </Pressable>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>

      {showDate && Platform.OS !== "web" && (
        <DateTimePicker
          value={parseDate(dateStr)}
          mode="date"
          onChange={(_e, sel) => {
            setShowDate(Platform.OS === "ios");
            if (sel) {
              setDateStr(`${sel.getFullYear()}-${pad(sel.getMonth() + 1)}-${pad(sel.getDate())}`);
            }
          }}
        />
      )}
      {showTime && Platform.OS !== "web" && (
        <DateTimePicker
          value={parseTime(timeStr)}
          mode="time"
          is24Hour
          onChange={(_e, sel) => {
            setShowTime(Platform.OS === "ios");
            if (sel) setTimeStr(`${pad(sel.getHours())}:${pad(sel.getMinutes())}`);
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
    marginBottom: spacing.md,
  },
  title: { fontFamily: font.extra, fontSize: 20, color: colors.onSurface },
  segment: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segBtn: {
    flex: 1,
    height: 40,
    borderRadius: radius.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  segBtnActive: { backgroundColor: colors.brand },
  segText: { fontFamily: font.bold, fontSize: 14, color: colors.onSurfaceSecondary },
  segTextActive: { color: colors.onBrand },
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
    backgroundColor: colors.surface,
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
  error: {
    fontFamily: font.medium,
    fontSize: 13,
    color: colors.error,
    marginTop: spacing.md,
  },
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
  cancelBtn: {
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.errorSoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.md,
  },
  cancelText: { fontFamily: font.bold, fontSize: 15, color: colors.error },
});
