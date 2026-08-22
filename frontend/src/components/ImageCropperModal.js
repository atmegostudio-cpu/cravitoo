import React, { useCallback, useState } from 'react';
import Cropper from 'react-easy-crop';
import { X, Check, RotateCw, Loader2 } from 'lucide-react';

/**
 * ImageCropperModal — client-side crop-to-square helper.
 *
 * Small drop-in dialog wrapping ``react-easy-crop``. Vendors typically
 * shoot dishes on their phone in 9:16 portrait; if we upload those raw
 * the employee menu card ends up with a squished / letter-boxed image.
 * This modal forces a 1:1 crop, letting the vendor pan + zoom to frame
 * the dish, then returns a JPEG Blob at up to 1024×1024px.
 *
 * Props:
 *   file        — the raw File the user just picked (JPEG/PNG/WEBP).
 *   onConfirm(blob, previewUrl) — user cropped & confirmed. ``blob`` is
 *                 a fresh JPEG Blob suitable for FormData upload;
 *                 ``previewUrl`` is a same-page object URL for optimistic
 *                 UI (caller should URL.revokeObjectURL when done).
 *   onCancel()  — user dismissed the modal without cropping.
 *   testIdPrefix — string appended to data-testids so multiple instances
 *                  on the same page don't collide.
 *
 * Notes:
 *   • Output is JPEG @ q=0.9 → typically 30-80 KB for a 1024² dish photo.
 *   • Rotation is user-driven (RotateCw button flips +90° each tap).
 *   • Runs 100% client-side; no server round-trip.
 */
const OUTPUT_SIZE = 1024;               // final square edge in px
const JPEG_QUALITY = 0.9;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the image.'));
    img.src = src;
  });
}

/** Draw the requested crop rect onto a fresh canvas + rotation, then
 *  export it as a JPEG Blob at 1024×1024. */
async function getCroppedBlob(imageSrc, pixelCrop, rotation) {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');

  // Rotation-aware drawing: shift origin to canvas centre, rotate, draw the
  // pixelCrop rectangle from the source image, scaled to output size.
  ctx.save();
  ctx.translate(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    -OUTPUT_SIZE / 2,
    -OUTPUT_SIZE / 2,
    OUTPUT_SIZE,
    OUTPUT_SIZE,
  );
  ctx.restore();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

export const ImageCropperModal = ({ file, onConfirm, onCancel, testIdPrefix = '' }) => {
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pixelCrop, setPixelCrop] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Load the file into a data URL as soon as the modal mounts.
  React.useEffect(() => {
    let cancelled = false;
    readFileAsDataUrl(file)
      .then((src) => { if (!cancelled) setImageSrc(src); })
      .catch((e) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [file]);

  const onCropComplete = useCallback((_area, areaPixels) => {
    setPixelCrop(areaPixels);
  }, []);

  const handleConfirm = async () => {
    if (!imageSrc || !pixelCrop) return;
    setBusy(true);
    setErr('');
    try {
      const blob = await getCroppedBlob(imageSrc, pixelCrop, rotation);
      const previewUrl = URL.createObjectURL(blob);
      onConfirm(blob, previewUrl);
    } catch (e) {
      setErr(e.message || 'Crop failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      data-testid={`${testIdPrefix}image-cropper-modal`}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-card rounded-2xl w-full max-w-lg overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-light">
          <div>
            <h3 className="font-heading font-semibold text-text-primary">Crop the photo</h3>
            <p className="text-xs text-text-secondary">Pinch / drag to frame the dish. It'll be saved as a 1024×1024 square.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            data-testid={`${testIdPrefix}cropper-close-btn`}
            className="p-1 rounded-full text-text-secondary hover:bg-background"
            aria-label="Cancel crop"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative w-full bg-black" style={{ aspectRatio: '1 / 1' }}>
          {imageSrc ? (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              showGrid
              cropShape="rect"
              objectFit="contain"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-white">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-xs text-text-secondary shrink-0">Zoom</label>
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              data-testid={`${testIdPrefix}cropper-zoom-slider`}
              className="flex-1 accent-primary"
            />
            <button
              type="button"
              onClick={() => setRotation((r) => (r + 90) % 360)}
              data-testid={`${testIdPrefix}cropper-rotate-btn`}
              className="p-2 rounded-lg text-text-secondary hover:bg-background border border-border-light"
              title="Rotate 90°"
            >
              <RotateCw className="h-4 w-4" />
            </button>
          </div>

          {err && (
            <p className="text-sm text-red-600" data-testid={`${testIdPrefix}cropper-error`}>{err}</p>
          )}

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              data-testid={`${testIdPrefix}cropper-cancel-btn`}
              className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-background disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy || !pixelCrop}
              data-testid={`${testIdPrefix}cropper-confirm-btn`}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Use this crop
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageCropperModal;
