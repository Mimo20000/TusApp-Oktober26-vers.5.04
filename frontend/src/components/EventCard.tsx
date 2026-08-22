import { View, Text, StyleSheet, Pressable, Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { colors, spacing, radius, font } from "@/src/theme";
import { TeamEvent } from "@/src/api";
import { formatDate } from "@/src/ui";
import PaypalBierkasseButton from "@/src/PaypalBierkasseButton";

const CLUB = "TuS Oberhausen II";

function openInMaps(query: string) {
  const q = encodeURIComponent(query);
  // Universal URL that opens the native Maps app on iOS/Android and google.com/maps on web
  const url =
    Platform.OS === "ios"
      ? `https://maps.apple.com/?q=${q}`
      : `https://www.google.com/maps/search/?api=1&query=${q}`;
  Linking.openURL(url).catch(() => {});
}

type Props = {
  event: TeamEvent;
  status?: string;
  reason?: string;
  driving: boolean;
  beer: boolean;
  isAdmin: boolean;
  bierwartEmail: string;
  actorId?: string;
  onBierwartChanged?: (email: string) => void;
  onEdit: () => void;
  onOverview: () => void;
  onZusagen: () => void;
  onAbsagen: () => void;
  onToggleDrive: () => void;
  onToggleBeer: () => void;
};

export default function EventCard({
  event,
  status,
  reason,
  driving,
  beer,
  isAdmin,
  bierwartEmail,
  actorId,
  onBierwartChanged,
  onEdit,
  onOverview,
  onZusagen,
  onAbsagen,
  onToggleDrive,
  onToggleBeer,
}: Props) {
  const d = formatDate(event.date);
  const isGame = event.type === "Spiel";
  const cancelled = !!event.cancelled;
  const icon = event.type === "Spiel" ? "trophy" : event.type === "Training" ? "fitness" : "people";
  const title = event.type === "Spiel" ? `vs. ${event.opponent}` : event.type;
  return (
    <View style={[styles.card, cancelled && styles.cardCancelled]} testID={`event-card-${event.id}`}>
      <View style={styles.cardTop}>
        <View style={[styles.dateBox, cancelled && styles.dateBoxCancelled]}>
          <Text style={styles.dateDay}>{d.day}</Text>
          <Text style={styles.dateMonth}>{d.month}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.badgeRow}>
            <View style={[styles.typeBadge, isGame ? styles.gameBadge : styles.trainBadge]}>
              <Ionicons
                name={icon}
                size={12}
                color={isGame ? colors.brand : colors.onSurfaceSecondary}
              />
              <Text style={[styles.typeText, { color: isGame ? colors.brand : colors.onSurfaceSecondary }]}>
                {event.type}
              </Text>
            </View>
            {cancelled ? (
              <View style={styles.cancelBadge} testID={`cancelled-${event.id}`}>
                <Ionicons name="close-circle" size={12} color={colors.onError} />
                <Text style={styles.cancelBadgeText}>Abgesagt</Text>
              </View>
            ) : null}
          </View>
          <Text
            style={[styles.cardTitle, cancelled && styles.strikethrough]}
            numberOfLines={2}
          >
            {title}
          </Text>
          <View style={styles.metaLine}>
            <Ionicons name="time-outline" size={13} color={colors.muted} />
            <Text style={[styles.metaText, cancelled && styles.strikethrough]}>{d.weekday}, {event.time} Uhr</Text>
          </View>
          {event.location ? (
            <View style={styles.metaLine}>
              <Ionicons name="location-outline" size={13} color={colors.muted} />
              <Text style={[styles.metaText, cancelled && styles.strikethrough]} numberOfLines={1}>{event.location}</Text>
              {isGame && event.home && event.home !== CLUB && !cancelled ? (
                <Pressable
                  testID={`maps-${event.id}`}
                  onPress={() => {
                    Haptics.selectionAsync();
                    openInMaps(`${event.location}${event.opponent ? ", " + event.opponent : ""}`);
                  }}
                  hitSlop={8}
                  style={styles.mapsBtn}
                  accessibilityLabel="In Google Maps öffnen"
                >
                  <Ionicons name="navigate" size={14} color={colors.brand} />
                  <Text style={styles.mapsBtnText}>Route</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={styles.adminBtns}>
          <Pressable
            testID={`overview-event-${event.id}`}
            onPress={onOverview}
            hitSlop={8}
            style={styles.editBtn}
          >
            <Ionicons name="people" size={18} color={colors.brand} />
          </Pressable>
          {isAdmin ? (
            <Pressable
              testID={`edit-event-${event.id}`}
              onPress={onEdit}
              hitSlop={8}
              style={styles.editBtn}
            >
              <Ionicons name="create-outline" size={20} color={colors.brand} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {cancelled ? null : (
        <>
          <View style={styles.actions}>
            <Pressable
              testID={`zusagen-${event.id}`}
              onPress={onZusagen}
              style={[styles.actionBtn, status === "zugesagt" ? styles.zuActive : styles.zuIdle]}
            >
              <Ionicons
                name="checkmark-circle"
                size={18}
                color={status === "zugesagt" ? colors.onSuccess : colors.success}
              />
              <Text style={[styles.actionText, { color: status === "zugesagt" ? colors.onSuccess : colors.success }]}>
                Zusagen
              </Text>
            </Pressable>
            <Pressable
              testID={`absagen-${event.id}`}
              onPress={onAbsagen}
              style={[styles.actionBtn, status === "abgesagt" ? styles.abActive : styles.abIdle]}
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={status === "abgesagt" ? colors.onError : colors.error}
              />
              <Text style={[styles.actionText, { color: status === "abgesagt" ? colors.onError : colors.error }]}>
                Absagen
              </Text>
            </Pressable>
          </View>

          {status === "abgesagt" && reason ? (
            <Pressable
              testID={`absage-reason-${event.id}`}
              onPress={onAbsagen}
              style={styles.reasonRow}
              accessibilityLabel="Absage-Grund bearbeiten"
            >
              <Ionicons name="chatbox-ellipses-outline" size={13} color={colors.error} />
              <Text style={styles.reasonText} numberOfLines={2}>
                Grund: {reason}
              </Text>
              <Ionicons name="pencil" size={12} color={colors.error} />
            </Pressable>
          ) : null}

          {event.type === "Spiel" && event.home && event.home !== CLUB ? (
            <>
              <View style={styles.extrasRow}>
                <Pressable
                  testID={`fahre-${event.id}`}
                  onPress={onToggleDrive}
                  style={[styles.extraBtnSmall, driving ? styles.extraActive : styles.extraIdle]}
                >
                  <Ionicons name="car-sport" size={16} color={driving ? colors.onBrand : colors.brand} />
                  <Text style={[styles.extraTextSmall, { color: driving ? colors.onBrand : colors.brand }]}>
                    {driving ? "Ich fahre ✓" : "Ich fahre"}
                  </Text>
                </Pressable>
                <Pressable
                  testID={`bier-${event.id}`}
                  onPress={onToggleBeer}
                  style={[styles.extraBtnSmall, beer ? styles.extraActive : styles.extraIdle]}
                >
                  <Ionicons name="beer" size={16} color={beer ? colors.onBrand : colors.brand} />
                  <Text style={[styles.extraTextSmall, { color: beer ? colors.onBrand : colors.brand }]}>
                    {beer ? "Bringe Bier ✓" : "Bringe Bier"}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.paypalRow}>
                <PaypalBierkasseButton
                  testID={`paypal-${event.id}`}
                  email={bierwartEmail}
                  actorId={actorId}
                  isAdmin={isAdmin}
                  onEmailChanged={onBierwartChanged}
                  contextNote={`${d.day}.${d.month}`}
                  compact
                />
              </View>
            </>
          ) : null}

          {event.type === "Training" ? (
            <>
              <Pressable
                testID={`bier-${event.id}`}
                onPress={onToggleBeer}
                style={[styles.extraBtn, beer ? styles.extraActive : styles.extraIdle]}
              >
                <Ionicons name="beer" size={18} color={beer ? colors.onBrand : colors.brand} />
                <Text style={[styles.extraText, { color: beer ? colors.onBrand : colors.brand }]}>
                  {beer ? "Bringe Bier ✓" : "Bringe Bier"}
                </Text>
              </Pressable>
              <View style={styles.paypalRow}>
                <PaypalBierkasseButton
                  testID={`paypal-${event.id}`}
                  email={bierwartEmail}
                  actorId={actorId}
                  isAdmin={isAdmin}
                  onEmailChanged={onBierwartChanged}
                  contextNote={`${d.day}.${d.month}`}
                  compact
                />
              </View>
            </>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTop: { flexDirection: "row", gap: spacing.md },
  cardCancelled: { opacity: 0.75, borderColor: colors.errorSoft },
  adminBtns: { gap: spacing.sm },
  editBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, flexWrap: "wrap" },
  cancelBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: colors.error,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  cancelBadgeText: { fontFamily: font.bold, fontSize: 11, color: colors.onError },
  strikethrough: { textDecorationLine: "line-through", color: colors.muted },
  dateBox: {
    width: 58,
    height: 58,
    borderRadius: radius.md,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  dateBoxCancelled: { backgroundColor: colors.surfaceTertiary },
  dateDay: { fontFamily: font.extra, fontSize: 22, color: colors.brand, lineHeight: 24 },
  dateMonth: { fontFamily: font.bold, fontSize: 12, color: colors.brand },
  typeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    marginBottom: spacing.xs,
  },
  gameBadge: { backgroundColor: colors.brandSecondary },
  trainBadge: { backgroundColor: colors.surfaceTertiary },
  typeText: { fontFamily: font.bold, fontSize: 11 },
  cardTitle: { fontFamily: font.bold, fontSize: 16, color: colors.onSurface },
  metaLine: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  metaText: { fontFamily: font.regular, fontSize: 13, color: colors.onSurfaceSecondary, flex: 1 },
  mapsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
    marginLeft: spacing.xs,
  },
  mapsBtnText: { fontFamily: font.bold, fontSize: 11, color: colors.brand },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  actionBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
  },
  zuIdle: { backgroundColor: colors.successSoft, borderColor: colors.successSoft },
  zuActive: { backgroundColor: colors.success, borderColor: colors.success },
  abIdle: { backgroundColor: colors.errorSoft, borderColor: colors.errorSoft },
  abActive: { backgroundColor: colors.error, borderColor: colors.error },
  actionText: { fontFamily: font.bold, fontSize: 14 },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.errorSoft,
    borderLeftWidth: 3,
    borderLeftColor: colors.error,
  },
  reasonText: { flex: 1, fontFamily: font.medium, fontSize: 12, color: colors.error },
  extraBtn: {
    height: 44,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.sm,
    borderWidth: 1.5,
  },
  extraIdle: { backgroundColor: colors.brandSecondary, borderColor: colors.brandSecondary },
  extraActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  extraText: { fontFamily: font.bold, fontSize: 14 },
  extrasRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  paypalRow: { marginTop: spacing.sm, alignItems: "flex-start" },
  extraBtnSmall: {
    flex: 1,
    height: 40,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
  },
  extraTextSmall: { fontFamily: font.bold, fontSize: 13 },
});
