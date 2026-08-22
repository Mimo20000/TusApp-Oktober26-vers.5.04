import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";

import { colors, spacing, radius, font } from "@/src/theme";
import { api, Payment, PaymentSum } from "@/src/api";
import { useSession } from "@/src/session";
import { Header } from "@/src/ui";

export default function Zahlungen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { player } = useSession();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [sums, setSums] = useState<PaymentSum[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!player) return;
    setError(null);
    try {
      const res = await api.listPayments();
      setPayments(res.payments);
      setSums(res.sums);
      setAllowed(true);
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
      <Header title="Zahlungen" subtitle="Übersicht aller PayPal-Zahlungen" />
      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing["3xl"] }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
        >
          {error ? <Text style={styles.err}>{error}</Text> : null}
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
                <View style={{ alignItems: "flex-end" }}>
                  {p.amount != null ? (
                    <Text style={styles.payAmount}>{p.amount.toFixed(2).replace(".", ",")} €</Text>
                  ) : (
                    <Text style={styles.payAmountDim}>—</Text>
                  )}
                  <Text style={[styles.statusPill, p.status === "completed" ? styles.statusOk : styles.statusOpen]}>
                    {p.status === "completed" ? "bezahlt" : "offen"}
                  </Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
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
  payRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  payTitle: { fontFamily: font.bold, fontSize: 14, color: colors.onSurface },
  payMeta: { fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: 2 },
  payAmount: { fontFamily: font.extra, fontSize: 14, color: colors.brand },
  payAmountDim: { fontFamily: font.medium, fontSize: 14, color: colors.muted },
  statusPill: { fontFamily: font.bold, fontSize: 10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, marginTop: 3 },
  statusOk: { color: colors.onSuccess, backgroundColor: colors.success },
  statusOpen: { color: colors.brand, backgroundColor: colors.brandSecondary },
});
