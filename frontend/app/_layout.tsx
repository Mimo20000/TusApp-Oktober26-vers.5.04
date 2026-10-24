import { Stack } from "expo-router";
import { preventAutoHideAsync, hideAsync } from "expo-splash-screen";
import Constants from "expo-constants";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { SessionProvider } from "@/src/session";

// Configure the notifications banner ONLY outside Expo Go. Importing
// `expo-notifications` at the top level throws in Expo Go on SDK 53+ and
// takes the whole app down before it can render. Wrapping in try/catch and
// a runtime environment check keeps the app bootable everywhere.
try {
  if (Constants.executionEnvironment !== "storeClient") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  }
} catch {
  // ignore — falls back to system default banner behaviour when unavailable
}

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

// Keep the native splash visible from cold start until icon fonts register.
preventAutoHideAsync();

export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();
  const [appLoaded, appError] = useAppFonts();

  useEffect(() => {
    if ((iconsLoaded || iconsError) && (appLoaded || appError)) {
      hideAsync();
    }
  }, [iconsLoaded, iconsError, appLoaded, appError]);

  if (!iconsLoaded && !iconsError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <SessionProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </SessionProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
