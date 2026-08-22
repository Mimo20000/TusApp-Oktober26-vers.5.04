import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { Alert, Linking, Platform } from "react-native";

export type PickedFile = {
  base64: string;
  mime: string;
  filename: string;
  kind: "image" | "file";
};

async function ensurePhotoPermission(): Promise<boolean> {
  // Web browsers use a native <input type="file"> and don't need any Expo
  // media-library permission — asking would just show a confusing dialog.
  if (Platform.OS === "web") return true;
  const current = await ImagePicker.getMediaLibraryPermissionsAsync();
  let status = current.status;
  if (status !== "granted" && current.canAskAgain) {
    const asked = await ImagePicker.requestMediaLibraryPermissionsAsync();
    status = asked.status;
  }
  if (status !== "granted") {
    Alert.alert(
      "Zugriff auf Fotos nötig",
      "Erlaube den Zugriff auf deine Fotos, um ein Bild auszuwählen.",
      [
        { text: "Abbrechen", style: "cancel" },
        { text: "Einstellungen öffnen", onPress: () => Linking.openSettings() },
      ]
    );
    return false;
  }
  return true;
}

export async function pickImageFile(): Promise<PickedFile | null> {
  if (!(await ensurePhotoPermission())) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.7,
    base64: true,
    // Native iOS/Android show a nice square crop UI when this is enabled.
    // Web ignores these two options — we handle web cropping via PhotoCropperModal.
    allowsEditing: Platform.OS !== "web",
    aspect: [1, 1],
  });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  let base64 = a.base64 ?? "";
  if (!base64) {
    // Web fallback: expo-file-system's File API doesn't run in the browser,
    // so read the picked blob via `fetch(uri)` → arrayBuffer → base64.
    if (Platform.OS === "web") {
      try {
        const r = await fetch(a.uri);
        const buf = await r.arrayBuffer();
        base64 = arrayBufferToBase64(buf);
      } catch (e) {
        console.warn("[media] web base64 read failed", e);
        return null;
      }
    } else {
      base64 = await new File(a.uri).base64();
    }
  }
  const mime = a.mimeType || "image/jpeg";
  const filename = a.fileName || `foto_${Date.now()}.jpg`;
  return { base64, mime, filename, kind: "image" };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000; // 32 KB per btoa call to stay well below stack limits
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

export async function pickDocumentFile(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ["application/pdf", "image/*"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const base64 = await new File(a.uri).base64();
  const mime = a.mimeType || "application/octet-stream";
  const filename = a.name || `datei_${Date.now()}`;
  const kind: "image" | "file" = mime.startsWith("image/") ? "image" : "file";
  return { base64, mime, filename, kind };
}
