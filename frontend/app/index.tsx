import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font, statusColor } from "@/src/theme";
import { useSession } from "@/src/session";
import { api, Player } from "@/src/api";

const logo = require("../assets/images/tus-logo.jpg");

export default function Login() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ready, player, players, login } = useSession();
  const [selected, setSelected] = useState<Player | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"pw" | "reset">("pw");
  const [emailHint, setEmailHint] = useState("");
  const [code, setCode] = useState("");
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (ready && player) router.replace("/termine");
  }, [ready, player]);

  const openPlayer = (p: Player) => {
    Haptics.selectionAsync();
    setSelected(p);
    setPassword("");
    setConfirm("");
    setEmailInput("");
    setError(null);
    setInfo(null);
    setMode("pw");
    setCode("");
    setEmailHint("");
  };

  const back = () => {
    setSelected(null);
    setPassword("");
    setConfirm("");
    setEmailInput("");
    setError(null);
    setInfo(null);
    setMode("pw");
    setCode("");
    setEmailHint("");
  };

  const forgot = async () => {
    if (!selected) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const res = await api.forgotPassword(selected.id);
      setEmailHint(res.email_hint);
      setMode("reset");
      setPassword("");
      setConfirm("");
      setCode("");
    } catch {
      setError(
        "Für dich ist keine E-Mail hinterlegt. Bitte lass sie vom Coach im Kader eintragen."
      );
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    if (!selected) return;
    setError(null);
    try {
      await api.forgotPassword(selected.id);
      setInfo("Neuer Code wurde gesendet.");
    } catch {
      setError("Konnte keinen neuen Code senden.");
    }
  };

  const doReset = async () => {
    if (!selected) return;
    setError(null);
    setInfo(null);
    if (code.trim().length !== 6) {
      setError("Bitte den 6-stelligen Code eingeben.");
      return;
    }
    if (password.length < 4) {
      setError("Passwort muss mindestens 4 Zeichen haben.");
      return;
    }
    if (password !== confirm) {
      setError("Passwörter stimmen nicht überein.");
      return;
    }
    setBusy(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const res = await api.resetPassword(selected.id, code.trim(), password);
      await login({ ...selected, has_password: true }, res.access_token);
      router.replace("/termine");
    } catch {
      setError("Code ungültig oder abgelaufen. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!selected) return;
    const isNew = !selected.has_password;
    setError(null);
    if (password.length < 4) {
      setError("Passwort muss mindestens 4 Zeichen haben.");
      return;
    }
    if (isNew && password !== confirm) {
      setError("Passwörter stimmen nicht überein.");
      return;
    }
    const email = emailInput.trim();
    if (isNew && (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
      setError("Bitte gib eine gültige E-Mail-Adresse ein (für die Passwort-Wiederherstellung).");
      return;
    }
    setBusy(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const res = isNew
        ? await api.setPassword(selected.id, password)
        : await api.passwordLogin(selected.id, password);
      if (isNew) {
        try {
          await api.updateContact(selected.id, { email });
        } catch {
          // non-fatal: account is created; email can be added later in Kader
        }
      }
      await login({ ...selected, has_password: true, email: isNew ? email : selected.email }, res.access_token);
      router.replace("/termine");
    } catch {
      setError(isNew ? "Konnte Passwort nicht setzen." : "Falsches Passwort. Bitte erneut versuchen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      testID="login-screen"
    >
      <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
        <LinearGradient colors={[colors.brand, "#A81C12"]} style={StyleSheet.absoluteFill} />
        <Image source={logo} style={styles.logo} contentFit="contain" />
        <Text style={styles.clubName}>TuS Oberhausen II</Text>
        <Text style={styles.subtitle}>Handball · Team-Verwaltung</Text>
        <View style={styles.versionPill}>
          <Text style={styles.versionText}>Version 5.0</Text>
        </View>
      </View>

      <View style={styles.sheet}>
        {selected === null ? (
          <>
            <Text style={styles.pickTitle}>Wer bist du?</Text>
            <Text style={styles.pickHint}>Tippe deinen Namen zum Anmelden.</Text>
            {!ready ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: spacing["2xl"] }} testID="login-loading" />
            ) : players.length === 0 ? (
              <Text style={styles.empty}>Keine Spieler gefunden. Bitte Verbindung prüfen.</Text>
            ) : (
              <ScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
              >
                {players.map((p) => (
                  <Pressable
                    key={p.id}
                    testID={`login-player-${p.id}`}
                    onPress={() => openPlayer(p)}
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.brandSecondary }]}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {p.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName}>{p.name}</Text>
                      <View style={styles.metaRow}>
                        <Text style={styles.rowPos}>{p.position ?? "—"}</Text>
                        <View style={[styles.dot, { backgroundColor: statusColor(p.status) }]} />
                        <Text style={styles.rowStatus}>{p.status}</Text>
                      </View>
                    </View>
                    {p.has_password ? (
                      <Ionicons name="lock-closed" size={16} color={colors.muted} />
                    ) : (
                      <View style={styles.newBadge}>
                        <Text style={styles.newBadgeText}>Neu</Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Pressable testID="login-back" onPress={back} style={styles.backBtn} hitSlop={8}>
              <Ionicons name="chevron-back" size={20} color={colors.brand} />
              <Text style={styles.backText}>Zurück</Text>
            </Pressable>

            <View style={styles.selectedHeader}>
              <View style={styles.avatarLg}>
                <Text style={styles.avatarLgText}>
                  {selected.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.selName}>{selected.name}</Text>
                <Text style={styles.selHint}>
                  {mode === "reset"
                    ? `Code an ${emailHint} gesendet`
                    : selected.has_password
                    ? "Bitte Passwort eingeben"
                    : "Lege dein Passwort fest"}
                </Text>
              </View>
            </View>

            {mode === "reset" ? (
              <>
                <Text style={styles.label}>6-stelliger Code (aus der E-Mail)</Text>
                <TextInput
                  testID="reset-code"
                  style={styles.input}
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/[^0-9]/g, "").slice(0, 6))}
                  placeholder="______"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  maxLength={6}
                />
                <Text style={styles.label}>Neues Passwort</Text>
                <TextInput
                  testID="reset-password"
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Neues Passwort"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  autoCapitalize="none"
                />
                <Text style={styles.label}>Neues Passwort bestätigen</Text>
                <TextInput
                  testID="reset-password-confirm"
                  style={styles.input}
                  value={confirm}
                  onChangeText={setConfirm}
                  placeholder="Passwort wiederholen"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  autoCapitalize="none"
                />

                {info ? <Text style={styles.info}>{info}</Text> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                  testID="reset-submit"
                  style={[styles.submitBtn, busy && { opacity: 0.6 }]}
                  onPress={doReset}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.onBrand} />
                  ) : (
                    <Text style={styles.submitText}>Passwort zurücksetzen & anmelden</Text>
                  )}
                </Pressable>

                <Pressable testID="resend-code" onPress={resendCode} style={styles.forgotBtn} hitSlop={8}>
                  <Text style={styles.forgotText}>Code erneut senden</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.label}>Passwort</Text>
                <TextInput
                  testID="login-password"
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Passwort"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  autoCapitalize="none"
                />

                {!selected.has_password && (
                  <>
                    <Text style={styles.label}>Passwort bestätigen</Text>
                    <TextInput
                      testID="login-password-confirm"
                      style={styles.input}
                      value={confirm}
                      onChangeText={setConfirm}
                      placeholder="Passwort wiederholen"
                      placeholderTextColor={colors.muted}
                      secureTextEntry
                      autoCapitalize="none"
                    />
                    <Text style={styles.label}>E-Mail-Adresse</Text>
                    <TextInput
                      testID="login-email"
                      style={styles.input}
                      value={emailInput}
                      onChangeText={setEmailInput}
                      placeholder="dein@email.de"
                      placeholderTextColor={colors.muted}
                      keyboardType="email-address"
                      inputMode="email"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Text style={styles.helperText}>
                      Wird für die Passwort-Wiederherstellung benötigt.
                    </Text>
                  </>
                )}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                  testID="login-submit"
                  style={[styles.submitBtn, busy && { opacity: 0.6 }]}
                  onPress={submit}
                  disabled={busy}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.onBrand} />
                  ) : (
                    <Text style={styles.submitText}>
                      {selected.has_password ? "Anmelden" : "Passwort festlegen & anmelden"}
                    </Text>
                  )}
                </Pressable>

                {selected.has_password ? (
                  <Pressable testID="forgot-password" onPress={forgot} style={styles.forgotBtn} hitSlop={8}>
                    <Text style={styles.forgotText}>Passwort vergessen?</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.brand },
  hero: { alignItems: "center", paddingBottom: spacing["2xl"], paddingHorizontal: spacing.xl },
  logo: { width: 110, height: 150 },
  clubName: { color: colors.onBrand, fontFamily: font.extra, fontSize: 24, marginTop: spacing.md },
  subtitle: { color: "rgba(255,255,255,0.85)", fontFamily: font.medium, fontSize: 14, marginTop: spacing.xs },
  versionPill: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  versionText: { fontFamily: font.bold, fontSize: 11, color: colors.onBrand, letterSpacing: 0.5 },
  sheet: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  pickTitle: { fontFamily: font.extra, fontSize: 20, color: colors.onSurface },
  pickHint: {
    fontFamily: font.regular,
    fontSize: 14,
    color: colors.onSurfaceSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  empty: { fontFamily: font.medium, color: colors.muted, marginTop: spacing["2xl"], textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: font.bold, color: colors.brand, fontSize: 15 },
  rowName: { fontFamily: font.bold, fontSize: 16, color: colors.onSurface },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 2, gap: spacing.xs },
  rowPos: { fontFamily: font.medium, fontSize: 13, color: colors.onSurfaceSecondary },
  dot: { width: 7, height: 7, borderRadius: 4, marginLeft: spacing.xs },
  rowStatus: { fontFamily: font.regular, fontSize: 13, color: colors.muted },
  newBadge: {
    backgroundColor: colors.brandSecondary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  newBadgeText: { fontFamily: font.bold, fontSize: 11, color: colors.brand },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, marginBottom: spacing.md },
  backText: { fontFamily: font.bold, fontSize: 15, color: colors.brand },
  selectedHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xl },
  avatarLg: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLgText: { fontFamily: font.extra, color: colors.brand, fontSize: 18 },
  selName: { fontFamily: font.extra, fontSize: 20, color: colors.onSurface },
  selHint: { fontFamily: font.regular, fontSize: 14, color: colors.onSurfaceSecondary, marginTop: 2 },
  label: {
    fontFamily: font.bold,
    fontSize: 13,
    color: colors.onSurfaceSecondary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  input: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontFamily: font.medium,
    fontSize: 16,
    color: colors.onSurface,
  },
  error: { fontFamily: font.medium, fontSize: 13, color: colors.error, marginTop: spacing.md },
  info: { fontFamily: font.medium, fontSize: 13, color: colors.success, marginTop: spacing.md },
  forgotBtn: { alignSelf: "center", marginTop: spacing.lg, paddingVertical: spacing.sm },
  forgotText: { fontFamily: font.bold, fontSize: 14, color: colors.brand },
  helperText: { fontFamily: font.regular, fontSize: 12, color: colors.muted, marginTop: spacing.xs },
  submitBtn: {
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xl,
  },
  submitText: { fontFamily: font.extra, fontSize: 16, color: colors.onBrand },
});
