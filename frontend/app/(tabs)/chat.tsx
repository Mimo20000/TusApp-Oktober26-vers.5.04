import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";

import { colors, spacing, radius, font } from "@/src/theme";
import { api, Conversations, ChatMessage } from "@/src/api";
import { useSession } from "@/src/session";
import { Header } from "@/src/ui";

function preview(last: ChatMessage | null) {
  if (!last) return "Noch keine Nachrichten";
  return `${last.sender_name.split(" ")[0]}: ${last.text}`;
}

function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 99 ? "99+" : count}</Text>
    </View>
  );
}

export default function ChatHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { player } = useSession();
  const [data, setData] = useState<Conversations | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!player) return;
    try {
      setData(await api.conversations());
    } finally {
      setLoading(false);
    }
  }, [player?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
      const iv = setInterval(load, 6000);
      return () => clearInterval(iv);
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openConversation = (id: string, title: string, scope: "team" | "direct") => {
    router.push({ pathname: "/chat/[id]", params: { id, title, scope } });
  };

  return (
    <View style={styles.container}>
      <Header title="Chat" subtitle="Team & persönliche Nachrichten" />
      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing["3xl"] }} />
      ) : (
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.lg,
            paddingBottom: insets.bottom + spacing["2xl"],
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
        >
          <Pressable
            testID="chat-team"
            onPress={() => openConversation("team", "Team-Chat", "team")}
            style={({ pressed }) => [styles.teamCard, pressed && { opacity: 0.9 }]}
          >
            <View style={styles.teamIcon}>
              <Ionicons name="people" size={22} color={colors.onBrand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.teamTitle}>Team-Chat</Text>
              <Text style={styles.teamPreview} numberOfLines={1}>
                {preview(data?.team.last ?? null)}
              </Text>
            </View>
            <Badge count={data?.team.unread ?? 0} />
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.8)" />
          </Pressable>

          <Text style={styles.sectionTitle}>Direktnachrichten</Text>
          {(data?.directs ?? []).map((c) => (
            <Pressable
              key={c.conversation_id}
              testID={`chat-direct-${c.player_id}`}
              onPress={() => openConversation(c.conversation_id, c.name, "direct")}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.brandSecondary }]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{c.name}</Text>
                <Text style={styles.rowPreview} numberOfLines={1}>{preview(c.last)}</Text>
              </View>
              <Badge count={c.unread} />
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  teamCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  teamIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  teamTitle: { fontFamily: font.extra, fontSize: 17, color: colors.onBrand },
  teamPreview: { fontFamily: font.regular, fontSize: 13, color: "rgba(255,255,255,0.85)", marginTop: 2 },
  sectionTitle: {
    fontFamily: font.bold,
    fontSize: 15,
    color: colors.onSurfaceSecondary,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: font.bold, color: colors.brand, fontSize: 14 },
  name: { fontFamily: font.bold, fontSize: 15, color: colors.onSurface },
  rowPreview: { fontFamily: font.regular, fontSize: 13, color: colors.muted, marginTop: 2 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: { fontFamily: font.bold, fontSize: 11, color: colors.onBrand },
});
