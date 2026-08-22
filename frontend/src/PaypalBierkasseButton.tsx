import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Linking,
  Modal,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font } from "@/src/theme";
import { api } from "@/src/api";

/**
 * Small "Bierkasse" PayPal button. PayPal has no documented URL scheme that
 * pre-fills recipient + amount + note for a raw email address, so we
 *   1. copy the recipient email into the clipboard,
 *   2. open the supported send-money page,
 *   3. show a confirmation sheet with the details the user has to paste.
 *
 * The recipient email lives in the backend (`/api/settings/bierwart`) and can
 * be updated by the Coach directly from this component. Everyone else only
 * sees the "Bierkasse" pill.
 */

export const BIERKASSE_NOTE = "Bierkasse TuS 2";
const PAYPAL_SEND_URL = "https://www.paypal.com/myaccount/transfer/send";

type Props = {
  email: string;
  /** Full player id of the currently logged-in user — required for admin PATCH. */
  actorId?: string;
  isAdmin?: boolean;
  onEmailChanged?: (email: string) => void;
  testID?: string;
  contextNote?: string;
  compact?: boolean;
};

export default function PaypalBierkasseButton({
  email,
  actorId,
  isAdmin,
  onEmailChanged,
  testID,
  contextNote,
  compact,
}: Props) {
  const [showHint, setShowHint] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [draftEmail, setDraftEmail] = useState(email);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const openPaypal = async () => {
    Haptics.selectionAsync();
    try {
      await Clipboard.setStringAsync(email);
    } catch {
      // clipboard is optional — the sheet also shows the address for manual copy
    }
    setShowHint(true);
    try {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.open(PAYPAL_SEND_URL, "_blank", "noopener,noreferrer");
      } else {
        await Linking.openURL(PAYPAL_SEND_URL);
      }
    } catch {
      // keep hint sheet open so user can still copy the details
    }
  };

  const saveEmail = async () => {
    if (!actorId) return;
    const next = draftEmail.trim();
    if (!next || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      setEditError("Bitte gültige E-Mail-Adresse eingeben.");
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const res = await api.setBierwart(next, actorId);
      onEmailChanged?.(res.email);
      setShowEdit(false);
    } catch {
      setEditError("Speichern fehlgeschlagen — hat der eingeloggte Trainer die richtige Rolle?");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Pressable
        testID={testID ?? "paypal-bierkasse"}
        onPress={openPaypal}
        style={[styles.btn, compact && styles.btnCompact]}
        accessibilityLabel="Bierkasse per PayPal bezahlen"
        hitSlop={6}
      >
        <Ionicons name="logo-paypal" size={compact ? 14 : 16} color={colors.brand} />
        <Text style={[styles.text, compact && styles.textCompact]}>Bierkasse</Text>
      </Pressable>

      {/* Payment hint */}
      <Modal
        visible={showHint}
        transparent
        animationType="fade"
        onRequestClose={() => setShowHint(false)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setShowHint(false)}
          testID="paypal-hint-overlay"
        >
          <Pressable style={styles.sheet}>
            <View style={styles.headerRow}>
              <Ionicons name="logo-paypal" size={22} color={colors.brand} />
              <Text style={styles.title}>PayPal an Bierwart</Text>
              {isAdmin ? (
                <Pressable
                  testID="paypal-edit-open"
                  onPress={() => {
                    setDraftEmail(email);
                    setEditError(null);
                    setShowEdit(true);
                    setShowHint(false);
                  }}
                  style={styles.pencilBtn}
                  hitSlop={6}
                >
                  <Ionicons name="create-outline" size={18} color={colors.brand} />
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.body}>
              Die Empfänger-Adresse wurde in die Zwischenablage kopiert. Bitte in PayPal einfügen:
            </Text>
            <View style={styles.emailBox} testID="paypal-hint-email">
              <Text style={styles.emailText} selectable>
                {email}
              </Text>
              <Pressable
                testID="paypal-copy-email"
                onPress={() => {
                  Clipboard.setStringAsync(email).catch(() => {});
                  Haptics.selectionAsync();
                }}
                style={styles.copyBtn}
                hitSlop={6}
              >
                <Ionicons name="copy-outline" size={14} color={colors.brand} />
                <Text style={styles.copyText}>Kopieren</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              Betrag + Verwendungszweck ({BIERKASSE_NOTE}
              {contextNote ? ` · ${contextNote}` : ""}) bitte in PayPal eintragen. Die Zahlung wird
              nicht automatisch bestätigt.
            </Text>
            <Pressable
              testID="paypal-hint-close"
              style={styles.closeBtn}
              onPress={() => setShowHint(false)}
            >
              <Text style={styles.closeText}>Verstanden</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Admin: edit bierwart email */}
      <Modal
        visible={showEdit}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEdit(false)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setShowEdit(false)}
          testID="paypal-edit-overlay"
        >
          <Pressable style={styles.sheet}>
            <View style={styles.headerRow}>
              <Ionicons name="mail" size={20} color={colors.brand} />
              <Text style={styles.title}>Bierwart ändern</Text>
            </View>
            <Text style={styles.body}>
              Neue PayPal-E-Mail des Bierwarts. Änderung nur durch Trainer möglich.
            </Text>
            <TextInput
              testID="paypal-edit-input"
              style={styles.input}
              value={draftEmail}
              onChangeText={setDraftEmail}
              placeholder="paypal@bierwart.de"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              inputMode="email"
            />
            {editError ? <Text style={styles.err}>{editError}</Text> : null}
            <View style={styles.rowBtns}>
              <Pressable
                testID="paypal-edit-cancel"
                style={[styles.secondaryBtn, saving && { opacity: 0.5 }]}
                onPress={() => setShowEdit(false)}
                disabled={saving}
              >
                <Text style={styles.secondaryBtnText}>Abbrechen</Text>
              </Pressable>
              <Pressable
                testID="paypal-edit-save"
                style={[styles.closeBtn, { flex: 1 }, saving && { opacity: 0.6 }]}
                onPress={saveEmail}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color={colors.onBrand} />
                ) : (
                  <Text style={styles.closeText}>Speichern</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
    borderWidth: 1,
    borderColor: colors.brandTertiary,
    alignSelf: "flex-start",
  },
  btnCompact: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    gap: 3,
  },
  text: { fontFamily: font.bold, fontSize: 13, color: colors.brand },
  textCompact: { fontSize: 11 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    maxWidth: 360,
    width: "100%",
    gap: spacing.md,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { fontFamily: font.extra, fontSize: 17, color: colors.onSurface, flex: 1 },
  pencilBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { fontFamily: font.regular, fontSize: 14, color: colors.onSurfaceSecondary },
  emailBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  emailText: { fontFamily: font.bold, fontSize: 15, color: colors.onSurface, flexShrink: 1 },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
  },
  copyText: { fontFamily: font.bold, fontSize: 12, color: colors.brand },
  hint: { fontFamily: font.regular, fontSize: 12, color: colors.muted, lineHeight: 17 },
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
  err: { fontFamily: font.medium, fontSize: 13, color: colors.error },
  rowBtns: { flexDirection: "row", gap: spacing.sm },
  secondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontFamily: font.bold, fontSize: 14, color: colors.onSurfaceSecondary },
  closeBtn: {
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  closeText: { fontFamily: font.extra, fontSize: 15, color: colors.onBrand },
});
