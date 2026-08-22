import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  View,
  Text,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font } from "@/src/theme";

/**
 * Small blocking sheet that appears after a player taps "Absagen". The reason
 * is a required field; the placeholder ("z. B. Krank") is shown grayed out and
 * is fully overwritable.
 */

type Props = {
  visible: boolean;
  /** Optional initial text (e.g. when re-editing an existing reason). */
  initial?: string;
  onCancel: () => void;
  onSubmit: (reason: string) => Promise<void> | void;
};

export default function AbsageReasonModal({ visible, initial, onCancel, onSubmit }: Props) {
  const [text, setText] = useState(initial ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setText(initial ?? "");
      setError(null);
      setSaving(false);
    }
  }, [visible, initial]);

  const submit = async () => {
    const clean = text.trim();
    if (!clean) {
      setError("Bitte einen Grund für die Absage eingeben.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await onSubmit(clean);
    } catch {
      setError("Speichern fehlgeschlagen. Bitte erneut versuchen.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.overlay} onPress={onCancel} testID="absage-reason-overlay">
          <Pressable style={styles.sheet} testID="absage-reason-sheet">
            <View style={styles.headerRow}>
              <Ionicons name="close-circle" size={22} color={colors.error} />
              <Text style={styles.title}>Grund für die Absage</Text>
            </View>
            <Text style={styles.body}>
              Damit Trainer und Bierwart die Aufstellung planen können, brauchen wir einen kurzen Grund.
              Dieses Feld ist Pflicht.
            </Text>
            <TextInput
              testID="absage-reason-input"
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="z. B. Krank"
              placeholderTextColor={colors.muted}
              autoFocus
              multiline
              maxLength={280}
            />
            {error ? <Text style={styles.err} testID="absage-reason-error">{error}</Text> : null}
            <View style={styles.rowBtns}>
              <Pressable
                testID="absage-reason-cancel"
                style={[styles.secondaryBtn, saving && { opacity: 0.5 }]}
                onPress={onCancel}
                disabled={saving}
              >
                <Text style={styles.secondaryText}>Abbrechen</Text>
              </Pressable>
              <Pressable
                testID="absage-reason-submit"
                style={[styles.submitBtn, (saving || !text.trim()) && { opacity: 0.6 }]}
                onPress={submit}
                disabled={saving || !text.trim()}
              >
                {saving ? (
                  <ActivityIndicator color={colors.onError} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={16} color={colors.onError} />
                    <Text style={styles.submitText}>Absage senden</Text>
                  </>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    maxWidth: 380,
    width: "100%",
    gap: spacing.md,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { fontFamily: font.extra, fontSize: 18, color: colors.onSurface, flex: 1 },
  body: { fontFamily: font.regular, fontSize: 13, color: colors.onSurfaceSecondary, lineHeight: 18 },
  input: {
    minHeight: 72,
    maxHeight: 160,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    fontFamily: font.medium,
    fontSize: 15,
    color: colors.onSurface,
    backgroundColor: colors.surface,
    textAlignVertical: "top",
  },
  err: { fontFamily: font.medium, fontSize: 13, color: colors.error },
  rowBtns: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  secondaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontFamily: font.bold, fontSize: 14, color: colors.onSurfaceSecondary },
  submitBtn: {
    flex: 1.4,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.error,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  submitText: { fontFamily: font.extra, fontSize: 14, color: colors.onError },
});
