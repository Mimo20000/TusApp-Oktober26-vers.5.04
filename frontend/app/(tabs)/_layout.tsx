import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Platform } from "react-native";
import { useEffect, useState } from "react";

import { colors, font } from "@/src/theme";
import { useSession } from "@/src/session";
import { api } from "@/src/api";

export default function TabsLayout() {
  const { player } = useSession();
  const [unread, setUnread] = useState(0);
  const [eventsUnread, setEventsUnread] = useState(0);
  const [canSeeKasse, setCanSeeKasse] = useState(false);

  useEffect(() => {
    if (!player) return;
    let cancelled = false;
    const check = async () => {
      if (player.position === "Coach") {
        if (!cancelled) setCanSeeKasse(true);
        return;
      }
      try {
        const boxes = await api.cashboxes();
        if (cancelled) return;
        setCanSeeKasse(boxes.some((b) => b.recipient_player_id === player.id));
      } catch {
        if (!cancelled) setCanSeeKasse(false);
      }
    };
    check();
    // Re-check every 15s so a fresh Bierwart assignment shows up in the
    // tab bar without requiring a re-login.
    const iv = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [player?.id, player?.position]);

  useEffect(() => {
    if (!player) return;
    let active = true;
    const poll = async () => {
      try {
        const [c, e] = await Promise.all([
          api.unread(),
          api.eventsUnread(),
        ]);
        if (active) {
          setUnread(c.total);
          setEventsUnread(e.total);
        }
      } catch {
        // ignore
      }
    };
    poll();
    const iv = setInterval(poll, 8000);
    return () => {
      active = false;
      clearInterval(iv);
    };
  }, [player?.id]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: Platform.OS === "ios" ? 96 : 82,
          paddingBottom: Platform.OS === "ios" ? 34 : 26,
          paddingTop: 10,
        },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="termine"
        options={{
          title: "Termine",
          tabBarBadge: eventsUnread > 0 ? eventsUnread : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.brand, fontSize: 10 },
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.brand, fontSize: 10 },
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="kader"
        options={{
          title: "Kader",
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="statistik"
        options={{
          title: "Statistik",
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tabelle"
        options={{
          title: "Anwesenheit",
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="liga"
        options={{
          title: "Tabelle",
          tabBarIcon: ({ color, size }) => <Ionicons name="podium" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="zahlungen"
        options={{
          title: "Kasse",
          href: canSeeKasse ? undefined : null,
          tabBarIcon: ({ color, size }) => <Ionicons name="cash" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
