import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, font } from "@/src/theme";

type Props = {
  visible: boolean;
  base64: string; // input image, without the data:...;base64, prefix
  mime: string;
  onCancel: () => void;
  onConfirm: (cropped: { base64: string; mime: string }) => void;
};

const VIEWPORT = 280; // px — the fixed square viewport the user drags the image inside
const OUTPUT = 480; // px — final avatar bitmap size (larger than the 84px display for retina crispness)

/**
 * Web-only circle crop editor. Users drag the picked image inside a fixed
 * 280×280 viewport and pinch/zoom (slider) until the circle overlay covers
 * the part they want. On confirm we render that viewport to an off-screen
 * canvas and export a 480×480 JPEG so the uploaded avatar looks identical
 * on every phone.
 *
 * Native (iOS/Android) uses the ImagePicker's built-in `allowsEditing`
 * square crop UI, which is a better UX than a web polyfill would be, so we
 * skip mounting this modal on those platforms.
 */
export default function PhotoCropperModal({ visible, base64, mime, onCancel, onConfirm }: Props) {
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const dragRef = useRef<{ startX: number; startY: number; origTx: number; origTy: number } | null>(null);
  const dataUri = useMemo(
    () => (base64 ? `data:${mime || "image/jpeg"};base64,${base64}` : ""),
    [base64, mime]
  );

  // Reset the transform whenever a new image is opened. Fit the SHORTER side
  // of the image into the viewport so the user starts with a valid, centered
  // crop.
  useEffect(() => {
    if (!visible || !dataUri) return;
    setZoom(1);
    setTx(0);
    setTy(0);
    const img = new (window as any).Image();
    img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = dataUri;
  }, [visible, dataUri]);

  if (Platform.OS !== "web") return null; // native uses ImagePicker's own crop

  const displayScale = imgSize
    ? Math.max(VIEWPORT / imgSize.w, VIEWPORT / imgSize.h) * zoom
    : 1;
  const displayW = imgSize ? imgSize.w * displayScale : VIEWPORT;
  const displayH = imgSize ? imgSize.h * displayScale : VIEWPORT;

  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));
  const maxTx = Math.max(0, (displayW - VIEWPORT) / 2);
  const maxTy = Math.max(0, (displayH - VIEWPORT) / 2);
  const boundedTx = clamp(tx, -maxTx, maxTx);
  const boundedTy = clamp(ty, -maxTy, maxTy);

  const startDrag = (e: any) => {
    const pt = "touches" in e && e.touches?.[0] ? e.touches[0] : e;
    dragRef.current = {
      startX: pt.clientX,
      startY: pt.clientY,
      origTx: boundedTx,
      origTy: boundedTy,
    };
    e.preventDefault?.();
  };
  const moveDrag = (e: any) => {
    if (!dragRef.current) return;
    const pt = "touches" in e && e.touches?.[0] ? e.touches[0] : e;
    setTx(dragRef.current.origTx + (pt.clientX - dragRef.current.startX));
    setTy(dragRef.current.origTy + (pt.clientY - dragRef.current.startY));
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const doConfirm = async () => {
    if (!imgSize || !dataUri) {
      onConfirm({ base64, mime });
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      onConfirm({ base64, mime });
      return;
    }
    const img = new (window as any).Image();
    img.crossOrigin = "anonymous";
    img.src = dataUri;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
    });
    // Map the viewport centre back onto the original image coordinates.
    // The image was rendered at `displayScale` and translated by (tx, ty),
    // so the pixel at (VIEWPORT/2 - tx) / displayScale is the crop centre.
    const cropSize = VIEWPORT / displayScale;
    const cropX = imgSize.w / 2 - boundedTx / displayScale - cropSize / 2;
    const cropY = imgSize.h / 2 - boundedTy / displayScale - cropSize / 2;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, OUTPUT, OUTPUT);
    ctx.drawImage(
      img,
      Math.max(0, cropX),
      Math.max(0, cropY),
      Math.min(imgSize.w - Math.max(0, cropX), cropSize),
      Math.min(imgSize.h - Math.max(0, cropY), cropSize),
      0,
      0,
      OUTPUT,
      OUTPUT
    );
    const outMime = "image/jpeg";
    const dataUrl = canvas.toDataURL(outMime, 0.85);
    const outB64 = dataUrl.split(",")[1] || base64;
    onConfirm({ base64: outB64, mime: outMime });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.headerText}>Foto zuschneiden</Text>
            <Pressable testID="cropper-cancel" onPress={onCancel} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>

          <div
            style={{
              width: VIEWPORT,
              height: VIEWPORT,
              alignSelf: "center",
              position: "relative",
              borderRadius: VIEWPORT / 2,
              overflow: "hidden",
              backgroundColor: "#111",
              cursor: "grab",
              touchAction: "none",
              userSelect: "none",
            }}
            onMouseDown={startDrag}
            onMouseMove={moveDrag}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            onTouchStart={startDrag}
            onTouchMove={moveDrag}
            onTouchEnd={endDrag}
            data-testid="cropper-viewport"
          >
            {dataUri ? (
              <img
                src={dataUri}
                alt="Zuschnitt"
                draggable={false}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  width: displayW,
                  height: displayH,
                  transform: `translate(calc(-50% + ${boundedTx}px), calc(-50% + ${boundedTy}px))`,
                  pointerEvents: "none",
                  userSelect: "none",
                }}
              />
            ) : null}
          </div>

          <View style={styles.zoomRow}>
            <Ionicons name="remove-circle-outline" size={20} color={colors.muted} />
            <input
              type="range"
              min="1"
              max="3"
              step="0.01"
              value={String(zoom)}
              onChange={(e: any) => setZoom(parseFloat(e.target.value))}
              data-testid="cropper-zoom"
              style={{ flex: 1, accentColor: colors.brand }}
            />
            <Ionicons name="add-circle-outline" size={20} color={colors.muted} />
          </View>

          <Text style={styles.hint}>Ziehe das Bild und nutze den Slider zum Zoomen. Der Kreis zeigt, was später als Profilbild sichtbar ist.</Text>

          <View style={styles.actions}>
            <Pressable testID="cropper-cancel-btn" onPress={onCancel} style={[styles.btn, styles.btnGhost]}>
              <Text style={styles.btnGhostText}>Abbrechen</Text>
            </Pressable>
            <Pressable testID="cropper-confirm" onPress={doConfirm} style={[styles.btn, styles.btnPrimary]}>
              <Ionicons name="checkmark" size={18} color={colors.onBrand} />
              <Text style={styles.btnPrimaryText}>Übernehmen</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerText: { fontFamily: font.bold, fontSize: 16, color: colors.onSurface },
  zoomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  hint: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.onSurfaceSecondary,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  btnGhost: { backgroundColor: colors.surfaceTertiary },
  btnGhostText: { fontFamily: font.medium, fontSize: 14, color: colors.onSurfaceSecondary },
  btnPrimary: { backgroundColor: colors.brand },
  btnPrimaryText: { fontFamily: font.bold, fontSize: 14, color: colors.onBrand },
});
