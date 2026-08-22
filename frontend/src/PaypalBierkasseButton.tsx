import { useEffect, useState } from "react";
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
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font } from "@/src/theme";
import { api, Cashbox } from "@/src/api";

const PAYPAL_SEND_URL = "https://www.paypal.com/myaccount/transfer/send";

type Props = {
  actorId?: string;
  isAdmin?: boolean;
  contextNote?: string;
  eventId?: string;
  testID?: string;
  compact?: boolean;
};

export default function PaypalBierkasseButton({
  actorId,
  isAdmin,
  contextNote,
  eventId,
  testID,
  compact,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [boxes, setBoxes] = useState<Cashbox[]>([]);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>("bierwart");
  const [editing, setEditing] = useState<Cashbox | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editPlayerId, setEditPlayerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setBoxes(await api.cashboxes());
    } catch {
      setError("Kassen konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible) load();
  }, [visible]);

  const selected = boxes.find((b) => b.key === selectedKey) || boxes[0];

  const openPaypal = async () => {
    if (!selected) return;
    Haptics.selectionAsync();
    try {
      await Clipboard.setStringAsync(selected.email);
    } catch {}
    if (actorId) {
      try {
        const amt = amount.trim() ? parseFloat(amount.replace(",", ".")) : undefined;
        await api.logPayment({
          cashbox_key: selected.key,
          amount: amt && !isNaN(amt) ? amt : undefined,
          note: contextNote,
          event_id: eventId,
        });
      } catch {
        // logging is best effort — the payment still opens
      }
    }
    try {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.open(PAYPAL_SEND_URL, "_blank", "noopener,noreferrer");
      } else {
        await Linking.openURL(PAYPAL_SEND_URL);
      }
    } catch {}
  };

  const startEdit = (box: Cashbox) => {
    setEditing(box);
    setEditEmail(box.email || "");
    setEditPlayerId(box.recipient_player_id || "");
  };

  const saveEdit = async () => {
    if (!editing || !actorId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.updateCashbox(editing.key, {
        email: editEmail.trim(),
        recipient_player_id: editPlayerId.trim() || undefined,
      });
      setBoxes((prev) => prev.map((b) => (b.key === editing.key ? { ...b, ...res } : b)));
      setEditing(null);
    } catch {
      setError("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Pressable
        testID={testID ?? "paypal-bierkasse"}
        onPress={() => setVisible(true)}
        style={[styles.btn, compact && styles.btnCompact]}
        hitSlop={6}
      >
        <Ionicons name="logo-paypal" size={compact ? 14 : 16} color={colors.brand} />
        <Text style={[styles.text, compact && styles.textCompact]}>Kasse</Text>
      </Pressable>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <Pressable style={styles.overlay} onPress={() => setVisible(false)}>
          <Pressable style={styles.sheet}>
            <View style={styles.headerRow}>
              <Ionicons name="logo-paypal" size={20} color={colors.brand} />
              <Text style={styles.title}>Kasse wählen</Text>
              <Pressable onPress={() => setVisible(false)} hitSlop={6}>
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>
            {loading ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <ScrollView style={{ maxHeight: 320 }}>
                {boxes.map((b) => {
                  const active = b.key === selectedKey;
                  return (
                    <Pressable
                      key={b.key}
                      testID={`cashbox-${b.key}`}
                      onPress={() => setSelectedKey(b.key)}
                      style={[styles.row, active && styles.rowActive]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowLabel}>{b.label}</Text>
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {b.recipient_name ? `${b.recipient_name} · ` : ""}
                          {b.email || "(keine E-Mail)"}
                        </Text>
                      </View>
                      {isAdmin ? (
                        <Pressable
                          testID={`cashbox-edit-${b.key}`}
                          onPress={() => startEdit(b)}
                          style={styles.editBtn}
                          hitSlop={6}
                        >
                          <Ionicons name="create-outline" size={16} color={colors.brand} />
                        </Pressable>
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <Text style={styles.amountLabel}>Betrag (optional)</Text>
            <TextInput
              testID="cashbox-amount"
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              placeholder="z. B. 3,00"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
            {selected && selected.email ? (
              <View style={styles.emailBox}>
                <Text style={styles.emailText} selectable>
                  {selected.email}
                </Text>
                <Pressable
                  testID="cashbox-copy-email"
                  onPress={() => {
                    Clipboard.setStringAsync(selected.email).catch(() => {});
                    Haptics.selectionAsync();
                  }}
                  style={styles.copyBtn}
                  hitSlop={6}
                >
                  <Ionicons name="copy-outline" size={14} color={colors.brand} />
                  <Text style={styles.copyText}>Kopieren</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.warn}>Für diese Kasse ist noch keine PayPal-E-Mail hinterlegt.</Text>
            )}
            {error ? <Text style={styles.err}>{error}</Text> : null}
            <Pressable
              testID="cashbox-open-paypal"
              onPress={openPaypal}
              style={[styles.primary, (!selected?.email) && { opacity: 0.5 }]}
              disabled={!selected?.email}
            >
              <Text style={styles.primaryText}>PayPal öffnen</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Coach edit sheet */}
      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <Pressable style={styles.overlay} onPress={() => setEditing(null)}>
          <Pressable style={styles.sheet}>
            <Text style={styles.title}>{editing?.label} bearbeiten</Text>
            <Text style={styles.small}>PayPal-E-Mail</Text>
            <TextInput
              testID="cashbox-edit-email"
              style={styles.amountInput}
              value={editEmail}
              onChangeText={setEditEmail}
              placeholder="paypal@empfaenger.de"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Text style={styles.small}>Verantwortlicher Spieler (player_id)</Text>
            <TextInput
              testID="cashbox-edit-player"
              style={styles.amountInput}
              value={editPlayerId}
              onChangeText={setEditPlayerId}
              placeholder="z. B. sascha-grins"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
            />
            {error ? <Text style={styles.err}>{error}</Text> : null}
            <Pressable testID="cashbox-edit-save" onPress={saveEdit} style={[styles.primary, saving && { opacity: 0.6 }]} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryText}>Speichern</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: radius.pill, backgroundColor: colors.brandSecondary,
    borderWidth: 1, borderColor: colors.brandTertiary, alignSelf: "flex-start",
  },
  btnCompact: { paddingHorizontal: spacing.sm, paddingVertical: 5, gap: 3 },
  text: { fontFamily: font.bold, fontSize: 13, color: colors.brand },
  textCompact: { fontSize: 11 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, width: "100%", maxWidth: 380, gap: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { fontFamily: font.extra, fontSize: 17, color: colors.onSurface, flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, marginBottom: 6 },
  rowActive: { backgroundColor: colors.brandSecondary, borderWidth: 1, borderColor: colors.brand },
  rowLabel: { fontFamily: font.bold, fontSize: 14, color: colors.onSurface },
  rowMeta: { fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  editBtn: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  amountLabel: { fontFamily: font.bold, fontSize: 12, color: colors.onSurfaceSecondary },
  amountInput: { height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, fontFamily: font.medium, fontSize: 14, color: colors.onSurface },
  emailBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  emailText: { flex: 1, fontFamily: font.bold, fontSize: 14, color: colors.onSurface },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.brandSecondary },
  copyText: { fontFamily: font.bold, fontSize: 12, color: colors.brand },
  warn: { fontFamily: font.regular, fontSize: 12, color: colors.muted },
  err: { fontFamily: font.medium, fontSize: 13, color: colors.error },
  small: { fontFamily: font.bold, fontSize: 12, color: colors.onSurfaceSecondary, marginTop: 4 },
  primary: { height: 46, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  primaryText: { fontFamily: font.extra, fontSize: 15, color: colors.onBrand },
});
