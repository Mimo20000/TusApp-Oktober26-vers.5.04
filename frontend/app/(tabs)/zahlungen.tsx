import { useCallback, useState } from "react";
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
  Platform,
  Alert,
  Share,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";

import { colors, spacing, radius, font } from "@/src/theme";
import { api, Payment, PaymentSum, MonthlyOpen, PerPlayerOpen, Player, Cashbox } from "@/src/api";
import { useSession } from "@/src/session";
import { Header } from "@/src/ui";

export default function Zahlungen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { player } = useSession();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [sums, setSums] = useState<PaymentSum[]>([]);
  const [monthly, setMonthly] = useState<MonthlyOpen[]>([]);
  const [perPlayer, setPerPlayer] = useState<PerPlayerOpen[]>([]);
  const [manageable, setManageable] = useState<string[]>([]);
  const [totals, setTotals] = useState<{
    open_total: number;
    open_count: number;
    paid_total: number;
    paid_count: number;
  } | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [boxes, setBoxes] = useState<Cashbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Manual add-entry modal
  const [addOpen, setAddOpen] = useState(false);
  const [addBox, setAddBox] = useState<string>("");
  const [addPlayer, setAddPlayer] = useState<string>("");
  const [addAmount, setAddAmount] = useState("");
  const [addNote, setAddNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!player) return;
    setError(null);
    try {
      const res = await api.listPayments();
      setPayments(res.payments);
      setSums(res.sums);
      setMonthly(res.monthly_open || []);
      setPerPlayer(res.per_player_open || []);
      setManageable(res.manageable_cashboxes || []);
      setTotals(res.totals || null);
      setAllowed(true);
      // Players + cash boxes power the manual add form (best effort).
      try {
        const [pl, bx] = await Promise.all([api.players(), api.cashboxes()]);
        setPlayers(pl);
        setBoxes(bx);
      } catch {}
    } catch {
      setAllowed(false);
    } finally {
      setLoading(false);
    }
  }, [player]);

  useFocusEffect(
    useCallback(() => {
      if (!player) {
        router.replace("/");
        return;
      }
      load();
    }, [player, load, router])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const canManage = manageable.length > 0;
  const manageBoxes = boxes.filter((b) => manageable.includes(b.key));
  const paidHistory = payments
    .filter((p) => p.status === "completed")
    .sort((a, b) => (b.paid_at || "").localeCompare(a.paid_at || ""));
  const fmtEuro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

  const togglePaid = async (p: Payment) => {
    if (busyId) return;
    setBusyId(p.id);
    try {
      await api.setPaymentStatus(p.id, p.status === "completed" ? "open" : "completed");
      await load();
    } catch {
      setError("Status konnte nicht geändert werden.");
    } finally {
      setBusyId(null);
    }
  };

  const settleMonth = (m: MonthlyOpen) => {
    const doSettle = async () => {
      setBusyId(`month-${m.month}`);
      try {
        await api.settleMonth(m.month);
        await load();
      } catch {
        setError("Monat konnte nicht abgerechnet werden.");
      } finally {
        setBusyId(null);
      }
    };
    const msg = `Alle offenen Beträge aus ${m.month_label} (${m.count} ${
      m.count === 1 ? "Posten" : "Posten"
    }) als bezahlt markieren?`;
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm(msg)) doSettle();
    } else {
      Alert.alert("Monat abrechnen", msg, [
        { text: "Abbrechen", style: "cancel" },
        { text: "Als bezahlt", onPress: doSettle },
      ]);
    }
  };

  const shareOverview = async () => {
    const map = new Map<string, { name: string; open: number; paid: number }>();
    payments.forEach((p) => {
      const k = p.payer_id;
      const e = map.get(k) || { name: p.payer_name || k, open: 0, paid: 0 };
      if (p.amount) {
        if (p.status === "open") e.open += p.amount;
        else if (p.status === "completed") e.paid += p.amount;
      }
      map.set(k, e);
    });
    const rows = Array.from(map.values()).sort((a, b) => b.open - a.open || b.paid - a.paid);
    const euro = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
    const today = new Date().toLocaleDateString("de-DE");
    const lines = [
      "🍺 TuS Oberhausen II – Kassenübersicht",
      `Stand: ${today}`,
      "",
      `Offen gesamt: ${euro(totals?.open_total ?? 0)}`,
      `Bezahlt gesamt: ${euro(totals?.paid_total ?? 0)}`,
      "",
      "Pro Spieler (offen · bezahlt):",
      ...rows.map((r) => `• ${r.name}: ${euro(r.open)} offen · ${euro(r.paid)} bezahlt`),
      "",
      "— gesendet aus der TuS2 App",
    ];
    try {
      await Share.share({ message: lines.join("\n") });
    } catch {
      // user cancelled or sharing unavailable
    }
  };

  const removeEntry = (p: Payment) => {
    const doDelete = async () => {
      setBusyId(p.id);
      try {
        await api.deletePayment(p.id);
        await load();
      } catch {
        setError("Eintrag konnte nicht gelöscht werden.");
      } finally {
        setBusyId(null);
      }
    };
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.confirm("Diesen Eintrag wirklich löschen?")) doDelete();
    } else {
      Alert.alert("Eintrag löschen", "Diesen Eintrag wirklich löschen?", [
        { text: "Abbrechen", style: "cancel" },
        { text: "Löschen", style: "destructive", onPress: doDelete },
      ]);
    }
  };

  const openAdd = () => {
    setAddError(null);
    setAddAmount("");
    setAddNote("");
    setAddBox(manageBoxes[0]?.key || manageable[0] || "");
    setAddPlayer(players[0]?.id || "");
    setAddOpen(true);
  };

  const submitAdd = async () => {
    if (!addBox || !addPlayer) {
      setAddError("Bitte Kasse und Spieler wählen.");
      return;
    }
    const amt = addAmount.trim() ? parseFloat(addAmount.replace(",", ".")) : undefined;
    if (addAmount.trim() && (amt === undefined || isNaN(amt))) {
      setAddError("Bitte einen gültigen Betrag eingeben.");
      return;
    }
    setSaving(true);
    setAddError(null);
    try {
      await api.logPayment({
        cashbox_key: addBox,
        payer_id: addPlayer,
        amount: amt && !isNaN(amt) ? amt : undefined,
        note: addNote.trim() || undefined,
      });
      setAddOpen(false);
      await load();
    } catch {
      setAddError("Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  };

  if (allowed === false) {
    return (
      <View style={styles.container}>
        <Header title="Zahlungen" subtitle="Nur für Trainer und Kassenwarte sichtbar" />
        <View style={styles.empty}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.muted} />
          <Text style={styles.emptyText}>Diese Ansicht ist Trainern und Kassenwarten vorbehalten.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title="Zahlungen" subtitle="Bierkasse & offene Beträge verwalten" />
      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing["3xl"] }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
        >
          {error ? <Text style={styles.err}>{error}</Text> : null}
          {totals ? (
            <View style={styles.standRow} testID="kassenstand">
              <View style={[styles.standCard, styles.standOpen]}>
                <Text style={styles.standLabel}>Offen</Text>
                <Text style={styles.standValueOpen}>{fmtEuro(totals.open_total)}</Text>
                <Text style={styles.standMeta}>{totals.open_count} Posten</Text>
              </View>
              <View style={[styles.standCard, styles.standPaid]}>
                <Text style={styles.standLabel}>Bezahlt</Text>
                <Text style={styles.standValuePaid}>{fmtEuro(totals.paid_total)}</Text>
                <Text style={styles.standMeta}>{totals.paid_count} Posten</Text>
              </View>
            </View>
          ) : null}
          {canManage ? (
            <>
              <Pressable testID="add-entry" onPress={openAdd} style={styles.addBtn}>
                <Ionicons name="add-circle-outline" size={18} color={colors.onBrand} />
                <Text style={styles.addBtnText}>Eintrag hinzufügen</Text>
              </Pressable>
              <Pressable testID="share-overview" onPress={shareOverview} style={styles.shareBtn}>
                <Ionicons name="share-outline" size={18} color={colors.brand} />
                <Text style={styles.shareBtnText}>Übersicht teilen</Text>
              </Pressable>
            </>
          ) : null}
          <Text style={styles.sectionTitle}>Summe pro Kasse</Text>
          {sums.length === 0 ? (
            <Text style={styles.dim}>Noch keine Zahlungen erfasst.</Text>
          ) : (
            sums.map((s) => (
              <View key={s.cashbox_key} style={styles.sumRow} testID={`sum-${s.cashbox_key}`}>
                <Text style={styles.sumLabel}>{s.cashbox_label}</Text>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.sumTotal}>{s.total.toFixed(2).replace(".", ",")} €</Text>
                  <Text style={styles.sumMeta}>{s.count} Zahlung{s.count === 1 ? "" : "en"}</Text>
                </View>
              </View>
            ))
          )}

          {perPlayer.length > 0 ? (
            <>
              <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>Offen pro Spieler</Text>
              {perPlayer.map((pp) => (
                <View key={pp.payer_id} style={styles.sumRow} testID={`perplayer-${pp.payer_id}`}>
                  <Text style={styles.sumLabel}>{pp.payer_name}</Text>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.sumTotal}>{pp.total.toFixed(2).replace(".", ",")} €</Text>
                    <Text style={styles.sumMeta}>{pp.count} offen</Text>
                  </View>
                </View>
              ))}
            </>
          ) : null}

          {monthly.length > 0 ? (
            <>
              <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>
                Offene Beträge pro Monat
              </Text>
              {monthly.map((m) => (
                <View key={m.month} style={styles.sumRow} testID={`monthly-${m.month}`}>
                  <Text style={styles.sumLabel}>{m.month_label}</Text>
                  <View style={styles.monthRight}>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.sumTotal}>{m.total.toFixed(2).replace(".", ",")} €</Text>
                      <Text style={styles.sumMeta}>{m.count} offen</Text>
                    </View>
                    {canManage ? (
                      <Pressable
                        testID={`settle-${m.month}`}
                        onPress={() => settleMonth(m)}
                        disabled={busyId === `month-${m.month}`}
                        style={styles.settleBtn}
                      >
                        {busyId === `month-${m.month}` ? (
                          <ActivityIndicator size="small" color={colors.onBrand} />
                        ) : (
                          <>
                            <Ionicons name="checkmark-done" size={15} color={colors.onBrand} />
                            <Text style={styles.settleBtnText}>Abhaken</Text>
                          </>
                        )}
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
            </>
          ) : null}

          {paidHistory.length > 0 ? (
            <>
              <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>Bezahlt-Historie</Text>
              {paidHistory.map((p) => (
                <View key={`paid-${p.id}`} style={styles.payRow} testID={`paid-${p.id}`}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.payTitle} numberOfLines={1}>{p.payer_name || p.payer_id}</Text>
                    <Text style={styles.payMeta} numberOfLines={1}>
                      Bezahlt am {p.paid_at ? new Date(p.paid_at).toLocaleDateString("de-DE") : "—"}
                      {` · ${p.cashbox_label}`}
                      {p.note ? ` · ${p.note}` : ""}
                    </Text>
                  </View>
                  {p.amount != null ? (
                    <Text style={styles.payAmountPaid}>{fmtEuro(p.amount)}</Text>
                  ) : (
                    <Text style={styles.payAmountDim}>—</Text>
                  )}
                </View>
              ))}
            </>
          ) : null}

          <Text style={[styles.sectionTitle, { marginTop: spacing.xl }]}>Verlauf</Text>
          {payments.length === 0 ? (
            <Text style={styles.dim}>Noch keine Zahlungen erfasst.</Text>
          ) : (
            payments.map((p) => (
              <View key={p.id} style={styles.payRow} testID={`payment-${p.id}`}>
                <Ionicons name="logo-paypal" size={18} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.payTitle} numberOfLines={1}>
                    {p.payer_name || p.payer_id} → {p.cashbox_label}
                  </Text>
                  <Text style={styles.payMeta} numberOfLines={1}>
                    {new Date(p.created_at).toLocaleString("de-DE")}
                    {p.note ? ` · ${p.note}` : ""}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  {p.amount != null ? (
                    <Text style={styles.payAmount}>{p.amount.toFixed(2).replace(".", ",")} €</Text>
                  ) : (
                    <Text style={styles.payAmountDim}>—</Text>
                  )}
                  {manageable.includes(p.cashbox_key) ? (
                    <View style={styles.rowActions}>
                      <Pressable
                        testID={`toggle-${p.id}`}
                        onPress={() => togglePaid(p)}
                        disabled={busyId === p.id}
                        style={[styles.statusPill, p.status === "completed" ? styles.statusOk : styles.statusOpen]}
                      >
                        <Text style={[styles.statusPillText, { color: p.status === "completed" ? colors.onSuccess : colors.brand }]}>
                          {p.status === "completed" ? "bezahlt ✓" : "als bezahlt"}
                        </Text>
                      </Pressable>
                      <Pressable
                        testID={`delete-${p.id}`}
                        onPress={() => removeEntry(p)}
                        disabled={busyId === p.id}
                        hitSlop={6}
                        style={styles.trashBtn}
                      >
                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                      </Pressable>
                    </View>
                  ) : (
                    <View style={[styles.statusPill, p.status === "completed" ? styles.statusOk : styles.statusOpen]}>
                      <Text style={[styles.statusPillText, { color: p.status === "completed" ? colors.onSuccess : colors.brand }]}>
                        {p.status === "completed" ? "bezahlt" : "offen"}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setAddOpen(false)}>
          <Pressable style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Eintrag hinzufügen</Text>
              <Pressable onPress={() => setAddOpen(false)} hitSlop={6}>
                <Ionicons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>

            {manageBoxes.length > 1 ? (
              <>
                <Text style={styles.fieldLabel}>Kasse</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: spacing.xs, paddingVertical: 2 }}
                >
                  {manageBoxes.map((b) => (
                    <Pressable
                      key={b.key}
                      testID={`add-box-${b.key}`}
                      onPress={() => setAddBox(b.key)}
                      style={[styles.pick, addBox === b.key ? styles.pickActive : styles.pickIdle]}
                    >
                      <Text style={[styles.pickText, { color: addBox === b.key ? colors.onBrand : colors.onSurfaceSecondary }]}>
                        {b.label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}

            <Text style={styles.fieldLabel}>Spieler</Text>
            <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={{ gap: 4 }}>
              {players.map((pl) => (
                <Pressable
                  key={pl.id}
                  testID={`add-player-${pl.id}`}
                  onPress={() => setAddPlayer(pl.id)}
                  style={[styles.playerPick, addPlayer === pl.id && styles.playerPickActive]}
                >
                  <Text style={[styles.playerPickText, addPlayer === pl.id && { color: colors.onBrand }]}>
                    {pl.name}
                  </Text>
                  {addPlayer === pl.id ? <Ionicons name="checkmark" size={16} color={colors.onBrand} /> : null}
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.fieldLabel}>Betrag (optional)</Text>
            <TextInput
              testID="add-amount"
              style={styles.input}
              value={addAmount}
              onChangeText={setAddAmount}
              placeholder="z. B. 3,00"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />

            <Text style={styles.fieldLabel}>Notiz (optional)</Text>
            <TextInput
              testID="add-note"
              style={styles.input}
              value={addNote}
              onChangeText={setAddNote}
              placeholder="z. B. Bier Training"
              placeholderTextColor={colors.muted}
            />

            {addError ? <Text style={styles.err}>{addError}</Text> : null}
            <Pressable
              testID="add-save"
              onPress={submitAdd}
              disabled={saving}
              style={[styles.primary, saving && { opacity: 0.6 }]}
            >
              {saving ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryText}>Speichern</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  emptyText: { fontFamily: font.medium, fontSize: 14, color: colors.muted },
  err: { fontFamily: font.medium, fontSize: 13, color: colors.error, marginBottom: spacing.md },
  sectionTitle: { fontFamily: font.extra, fontSize: 16, color: colors.onSurface, marginBottom: spacing.sm },
  dim: { fontFamily: font.regular, fontSize: 13, color: colors.muted },
  sumRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  sumLabel: { fontFamily: font.bold, fontSize: 14, color: colors.onSurface },
  sumTotal: { fontFamily: font.extra, fontSize: 16, color: colors.brand },
  sumMeta: { fontFamily: font.regular, fontSize: 11, color: colors.muted, marginTop: 2 },
  standRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  standCard: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    alignItems: "center",
  },
  standOpen: { backgroundColor: colors.brandSecondary, borderColor: colors.brand },
  standPaid: { backgroundColor: colors.surface, borderColor: colors.success },
  standLabel: { fontFamily: font.bold, fontSize: 12, color: colors.onSurfaceSecondary },
  standValueOpen: { fontFamily: font.extra, fontSize: 22, color: colors.brand, marginTop: 4 },
  standValuePaid: { fontFamily: font.extra, fontSize: 22, color: colors.success, marginTop: 4 },
  standMeta: { fontFamily: font.regular, fontSize: 11, color: colors.muted, marginTop: 2 },
  payAmountPaid: { fontFamily: font.extra, fontSize: 14, color: colors.success },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  shareBtnText: { fontFamily: font.bold, fontSize: 14, color: colors.brand },
  monthRight: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  settleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.success,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
    minWidth: 48,
    justifyContent: "center",
  },
  settleBtnText: { fontFamily: font.bold, fontSize: 12, color: colors.onBrand },
  payRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  payTitle: { fontFamily: font.bold, fontSize: 14, color: colors.onSurface },
  payMeta: { fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  payAmount: { fontFamily: font.extra, fontSize: 14, color: colors.brand },
  payAmountDim: { fontFamily: font.medium, fontSize: 14, color: colors.muted },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  statusPillText: { fontFamily: font.bold, fontSize: 10 },
  statusOk: { backgroundColor: colors.success },
  statusOpen: { backgroundColor: colors.brandSecondary },
  rowActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  trashBtn: { padding: 4 },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: spacing.md, marginBottom: spacing.md },
  addBtnText: { fontFamily: font.bold, fontSize: 14, color: colors.onBrand },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, width: "100%", maxWidth: 400, gap: spacing.sm },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontFamily: font.extra, fontSize: 17, color: colors.onSurface },
  fieldLabel: { fontFamily: font.bold, fontSize: 12, color: colors.onSurfaceSecondary, marginTop: spacing.xs },
  pick: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1 },
  pickActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  pickIdle: { backgroundColor: colors.surface, borderColor: colors.border },
  pickText: { fontFamily: font.bold, fontSize: 13 },
  playerPick: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  playerPickActive: { backgroundColor: colors.brand },
  playerPickText: { fontFamily: font.bold, fontSize: 14, color: colors.onSurface },
  input: { height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, fontFamily: font.medium, fontSize: 14, color: colors.onSurface },
  primary: { height: 46, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
  primaryText: { fontFamily: font.extra, fontSize: 15, color: colors.onBrand },
});
