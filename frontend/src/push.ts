import Constants from "expo-constants";
import { api } from "@/src/api";

/**
 * Registers the device for Expo push notifications.
 *
 * Guards against being run inside Expo Go on SDK 53+: `expo-notifications`
 * removed remote-push support there and simply importing it at the top of
 * a file throws an "Uncaught Error" that takes the app down. We therefore
 * require the module lazily so the app boots normally, and short-circuit
 * to a no-op when we detect Expo Go.
 *
 * Real push delivery only works in a Development Build or standalone APK.
 */
export async function registerForPush(playerId: string) {
  try {
    // storeClient = we're running inside Expo Go; skip entirely.
    if (Constants.executionEnvironment === "storeClient") return;

    // Dynamic requires so Expo Go never even parses the notifications module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require("expo-device");
    if (!Device.isDevice) return;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require("expo-notifications");

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return;

    const projectId =
      (Constants as any)?.expoConfig?.extra?.eas?.projectId ??
      (Constants as any)?.easConfig?.projectId;

    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    if (tokenResp?.data) {
      await api.registerPush(tokenResp.data);
    }
  } catch {
    // ignore – push simply stays inactive when unsupported (Expo Go, web, sim)
  }
}
