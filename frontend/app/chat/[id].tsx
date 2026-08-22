import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  Linking,
  Platform,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";

import { colors, spacing, radius, font } from "@/src/theme";
import { api, ChatMessage } from "@/src/api";
import { useSession } from "@/src/session";
import { pickImageFile, pickDocumentFile } from "@/src/media";

function timeOf(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// On the mobile browser (PWA), the native TextInput doesn't push layout up when the
// soft keyboard opens — the browser just shrinks the visual viewport. We measure that
// shrink via `window.visualViewport` and lift the input bar by exactly that amount so
// the user always sees what they're typing.
function useWebKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    // @ts-ignore visualViewport exists in browsers
    const vv: any = typeof window !== "undefined" ? (window as any).visualViewport : null;
    if (!vv) return;
    const update = () => {
      const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setInset(overlap);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

export default function Conversation() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { player } = useSession();
  const { id, title, scope } = useLocalSearchParams<{ id: string; title: string; scope: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const listRef = useRef<FlatList>(null);
  const webKbInset = useWebKeyboardInset();

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const msgs = await api.messages(id);
      setMessages(msgs);
      if (player) api.markRead(player.id, id).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [id, player?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
      const iv = setInterval(load, 3000);
      return () => clearInterval(iv);
    }, [load])
  );

  const send = async () => {
    const t = text.trim();
    if (!t || !player || !id) return;
    setSending(true);
    setText("");
    try {
      const msg = await api.sendMessage(id, (scope as "team" | "direct") || "team", player.id, t);
      setMessages((prev) => [...prev, msg]);
    } catch {
      setText(t);
    } finally {
      setSending(false);
    }
  };

  const sendAttachment = async (kind: "image" | "file") => {
    setShowAttach(false);
    if (!player || !id) return;
    try {
      const picked = kind === "image" ? await pickImageFile() : await pickDocumentFile();
      if (!picked) return;
      setAttaching(true);
      const res = await api.uploadFile(picked.base64, picked.filename, picked.mime, picked.kind);
      const msg = await api.sendMessage(id, (scope as "team" | "direct") || "team", player.id, "", {
        file_id: res.file_id,
        mime: res.mime,
        filename: res.filename,
        kind: res.kind as "image" | "file",
      });
      setMessages((prev) => [...prev, msg]);
    } catch {
      // ignore; user can retry
    } finally {
      setAttaching(false);
    }
  };

  useEffect(() => {
    if (messages.length) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [messages.length]);

  // When the (web) keyboard opens, scroll list to end so latest message is visible
  useEffect(() => {
    if (webKbInset > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    }
  }, [webKbInset]);

  const toggleSekt = async (msgId: string) => {
    if (!player) return;
    try {
      const res = await api.voteSekt(msgId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.poll ? { ...m, poll: { ...m.poll, voters: res.voters } } : m
        )
      );
    } catch {
      // best-effort — swallow, next refresh will fix
    }
  };

  const renderItem = ({ item }: { item: ChatMessage }) => {
    const mine = item.sender_id === player?.id;

    if (item.poll?.kind === "sekt") {
      const voted = !!player && item.poll.voters.includes(player.id);
      const count = item.poll.voters.length;
      const isBirthdayPerson = player?.id === item.poll.target_player_id;
      return (
        <View style={[styles.bubbleRow, styles.rowOther]} testID={`sekt-poll-${item.id}`}>
          <View style={[styles.bubble, styles.sektCard]}>
            <Text style={styles.sektHeader}>🎂 Geburtstag</Text>
            <Text style={styles.sektTitle}>{item.poll.target_name}</Text>
            <Text style={styles.sektBody}>{item.text}</Text>
            <Pressable
              testID={`sekt-vote-${item.id}`}
              disabled={isBirthdayPerson}
              onPress={() => toggleSekt(item.id)}
              style={({ pressed }) => [
                styles.sektBtn,
                voted && styles.sektBtnActive,
                (pressed || isBirthdayPerson) && { opacity: 0.7 },
              ]}
            >
              <Text style={styles.sektEmoji}>🥂</Text>
              <Text style={[styles.sektBtnText, voted && { color: colors.onBrand }]}>
                {isBirthdayPerson
                  ? count === 0
                    ? "Dein Team stößt gleich an"
                    : `${count} stoßen mit dir an`
                  : voted
                    ? `Du stößt an (${count})`
                    : count === 0
                      ? "Anstoßen"
                      : `Mitmachen (${count})`}
              </Text>
            </Pressable>
            <Text style={[styles.time, styles.timeOther]}>{timeOf(item.created_at)}</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowOther]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
          {!mine && scope === "team" ? (
            <Text style={styles.sender}>{item.sender_name}</Text>
          ) : null}
          {item.attachment ? (
            item.attachment.kind === "image" ? (
              <Pressable
                testID={`attachment-image-${item.id}`}
                onPress={() => Linking.openURL(api.fileRawUrl(item.attachment!.file_id))}
              >
                <Image
                  source={{ uri: api.fileThumbUrl(item.attachment.file_id) }}
                  style={styles.attachImg}
                  contentFit="cover"
                  transition={150}
                />
              </Pressable>
            ) : (
              <Pressable
                testID={`attachment-file-${item.id}`}
                onPress={() => Linking.openURL(api.fileRawUrl(item.attachment!.file_id))}
                style={[styles.fileChip, mine && styles.fileChipMine]}
              >
                <Ionicons
                  name="document-text"
                  size={22}
                  color={mine ? colors.onBrand : colors.brand}
                />
                <Text
                  style={[styles.fileName, mine && { color: colors.onBrand }]}
                  numberOfLines={2}
                >
                  {item.attachment.filename}
                </Text>
              </Pressable>
            )
          ) : null}
          {item.text ? (
            <Text style={[styles.msgText, mine && { color: colors.onBrand }]}>{item.text}</Text>
          ) : null}
          <Text style={[styles.time, mine ? styles.timeMine : styles.timeOther]}>
            {timeOf(item.created_at)}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="chat-back" onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.onBrand} />
        </Pressable>
        <Ionicons
          name={scope === "team" ? "people" : "person"}
          size={18}
          color={colors.onBrand}
          style={{ marginRight: 6 }}
        />
        <Text style={styles.headerTitle} numberOfLines={1}>{title || "Chat"}</Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "translate-with-padding"}
        keyboardVerticalOffset={insets.top + 44}
      >
        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: spacing["3xl"] }} />
        ) : messages.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={40} color={colors.muted} />
            <Text style={styles.emptyText}>Noch keine Nachrichten. Schreib die erste!</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {showAttach ? (
          <View style={styles.attachRow}>
            <Pressable testID="attach-image" style={styles.attachOption} onPress={() => sendAttachment("image")}>
              <Ionicons name="image" size={20} color={colors.brand} />
              <Text style={styles.attachOptionText}>Foto</Text>
            </Pressable>
            <Pressable testID="attach-document" style={styles.attachOption} onPress={() => sendAttachment("file")}>
              <Ionicons name="document-attach" size={20} color={colors.brand} />
              <Text style={styles.attachOptionText}>Dokument</Text>
            </Pressable>
          </View>
        ) : null}

        <View
          testID="chat-input-bar"
          style={[
            styles.inputBar,
            // Native: safe-area bottom padding.
            // Web PWA: lift the input bar above the soft keyboard by the amount
            // the visual viewport shrunk, plus a small gap.
            {
              paddingBottom:
                Platform.OS === "web" && webKbInset > 0
                  ? webKbInset + spacing.sm
                  : insets.bottom + spacing.sm,
            },
          ]}
        >
          <Pressable
            testID="chat-attach"
            onPress={() => setShowAttach((v) => !v)}
            disabled={attaching}
            style={styles.attachBtn}
          >
            {attaching ? (
              <ActivityIndicator color={colors.brand} size="small" />
            ) : (
              <Ionicons name={showAttach ? "close" : "add"} size={24} color={colors.brand} />
            )}
          </Pressable>
          <TextInput
            testID="chat-input"
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Nachricht schreiben…"
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="center"
          />
          <Pressable
            testID="chat-send"
            onPress={send}
            disabled={sending || !text.trim()}
            style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]}
          >
            <Ionicons name="send" size={18} color={colors.onBrand} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  backBtn: { marginRight: spacing.xs },
  headerTitle: { fontFamily: font.extra, fontSize: 18, color: colors.onBrand, flex: 1 },
  bubbleRow: { flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowOther: { justifyContent: "flex-start" },
  bubble: { maxWidth: "80%", borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleMine: { backgroundColor: colors.brand, borderBottomRightRadius: 4 },
  bubbleOther: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  sender: { fontFamily: font.bold, fontSize: 12, color: colors.brand, marginBottom: 2 },
  attachImg: { width: 200, height: 200, borderRadius: radius.sm, marginBottom: 4 },
  fileChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: 4,
    maxWidth: 220,
  },
  fileChipMine: { backgroundColor: "rgba(255,255,255,0.18)" },
  fileName: { fontFamily: font.medium, fontSize: 13, color: colors.onSurface, flexShrink: 1 },
  msgText: { fontFamily: font.regular, fontSize: 15, color: colors.onSurface },
  time: { fontFamily: font.regular, fontSize: 10, marginTop: 3, alignSelf: "flex-end" },
  timeMine: { color: "rgba(255,255,255,0.8)" },
  timeOther: { color: colors.muted },
  sektCard: {
    maxWidth: "88%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.brandTertiary,
    borderColor: colors.brand,
    borderWidth: 1,
    borderBottomLeftRadius: 4,
    gap: spacing.xs,
  },
  sektHeader: {
    fontFamily: font.bold,
    fontSize: 11,
    color: colors.brand,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  sektTitle: { fontFamily: font.extra, fontSize: 20, color: colors.onSurface },
  sektBody: { fontFamily: font.regular, fontSize: 14, color: colors.onSurface, marginTop: 2 },
  sektBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  sektBtnActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  sektEmoji: { fontSize: 22 },
  sektBtnText: { fontFamily: font.bold, fontSize: 14, color: colors.brand },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  emptyText: { fontFamily: font.medium, fontSize: 14, color: colors.muted, textAlign: "center" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  attachBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  attachRow: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  attachOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.brandSecondary,
  },
  attachOptionText: { fontFamily: font.bold, fontSize: 14, color: colors.brand },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    fontFamily: font.regular,
    fontSize: 15,
    color: colors.onSurface,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
});
