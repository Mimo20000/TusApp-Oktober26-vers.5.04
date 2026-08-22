import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { api } from "@/src/api";

// Registers the device for push notifications and stores the token in the backend.
// Safe no-op on web / simulators / when permission is denied. Real push delivery
// only works in a published native build (not Expo Go).
export async function registerForPush(playerId: string) {
  try {
    if (!Device.isDevice) return;

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
    // ignore – push simply stays inactive until a real build is available
  }
}
