import React, { useRef, useState } from 'react';
import axios from 'axios';
import { Upload, Trash2, Sparkles, Loader2, ImageIcon } from 'lucide-react';
import logger from '../lib/logger';
import ImageCropperModal from './ImageCropperModal';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * MenuImageUploader — a small self-contained card for uploading /
 * previewing / removing / AI-generating a menu-item photo.
 *
 * Works in three modes, controlled by ``target`` (mutually exclusive):
 *
 *   1. ``target={ type: 'draft', onboardingId, itemId }``
 *      Onboarding draft-menu row. Calls the
 *      /api/onboarding/vendors/{onbId}/menu/{itemId}/image endpoints.
 *      No AI regenerate here (AI is a live-menu concern).
 *
 *   2. ``target={ type: 'live', itemId }``
 *      A row in the ``menu_items`` collection. Calls the new
 *      /api/menu/{itemId}/image endpoints + the existing
 *      /api/ai/menu-photos/regenerate/{itemId} for one-click AI.
 *
 * Props:
 *   imageUrl   — current image URL (null / '' if none)
 *   onChange   — callback(newImageUrl | null) after any state change
 *   canGenerate— boolean, whether to render the "Generate" button
 *   canRemove  — boolean, whether to render the "Remove" button (default true)
 *   compact    — smaller preview + inline buttons for dense tables
 */
export const MenuImageUploader = ({
  target,
  imageUrl,
  onChange,
  canGenerate = true,
  canRemove = true,
  compact = false,
}) => {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(null); // 'upload' | 'remove' | 'generate' | null
  const [err, setErr] = useState('');
  // Raw file selected by the user, waiting for crop confirmation.
  const [pendingFile, setPendingFile] = useState(null);

  const endpointBase = target.type === 'draft'
    ? `${API}/onboarding/vendors/${target.onboardingId}/menu/${target.itemId}/image`
    : `${API}/menu/${target.itemId}/image`;

  const doUpload = async (blob) => {
    setBusy('upload'); setErr('');
    try {
      const form = new FormData();
      const name = blob.name || `menu-${Date.now()}.jpg`;
      form.append('file', blob, name);
      const { data } = await axios.post(endpointBase, form, {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      onChange(data.image_url);
    } catch (e) {
      logger.error('Upload failed:', e);
      setErr(e.response?.data?.detail || 'Upload failed.');
    } finally {
      setBusy(null);
    }
  };

  const handlePickFile = (e) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';   // reset so same-file re-pick fires change
    if (!file) return;
    setErr('');
    if (file.size > 5 * 1024 * 1024) {
      setErr('Image must be under 5 MB.');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setErr('Only PNG, JPG or WEBP allowed.');
      return;
    }
    // Open the crop dialog. On confirm we'll POST the cropped Blob.
    setPendingFile(file);
  };

  const handleCropConfirm = async (blob) => {
    setPendingFile(null);
    await doUpload(blob);
  };

  const handleRemove = async () => {
    if (!window.confirm('Remove this photo?')) return;
    setBusy('remove'); setErr('');
    try {
      await axios.delete(endpointBase, { withCredentials: true });
      onChange(null);
    } catch (e) {
      setErr(e.response?.data?.detail || 'Remove failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleGenerate = async () => {
    if (target.type !== 'live') return;   // AI is only for live items
    setBusy('generate'); setErr('');
    try {
      const { data } = await axios.post(
        `${API}/ai/menu-photos/regenerate/${target.itemId}`,
        { source: 'free' },
        { withCredentials: true, timeout: 90000 },
      );
      onChange(data.image_url);
    } catch (e) {
      setErr(e.response?.data?.detail || 'Generation failed. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const previewClass = compact
    ? 'w-14 h-14 rounded-lg object-cover border border-border-light'
    : 'w-full h-40 rounded-xl object-cover border border-border-light';

  return (
    <>
    {pendingFile && (
      <ImageCropperModal
        file={pendingFile}
        onConfirm={handleCropConfirm}
        onCancel={() => setPendingFile(null)}
        testIdPrefix={`${target.itemId || 'new'}-`}
      />
    )}
    <div className={compact ? 'flex items-center gap-2' : 'space-y-2'} data-testid={`menu-image-uploader-${target.itemId || 'new'}`}>
      {imageUrl ? (
        <img
          src={imageUrl}
          alt="Menu item"
          className={previewClass}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      ) : (
        <div
          className={`${previewClass} bg-background-secondary border-dashed flex items-center justify-center text-text-muted`}
          data-testid="menu-image-placeholder"
        >
          <ImageIcon className={compact ? 'h-5 w-5' : 'h-10 w-10'} />
        </div>
      )}

      <div className={`flex ${compact ? 'flex-col' : 'flex-row flex-wrap'} gap-1.5`}>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handlePickFile}
          className="hidden"
          data-testid={`menu-image-file-${target.itemId || 'new'}`}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!!busy}
          data-testid={`menu-image-upload-btn-${target.itemId || 'new'}`}
          className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 ${compact ? '' : 'text-xs px-3 py-1.5'}`}
        >
          {busy === 'upload' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {imageUrl ? 'Replace' : 'Upload'}
        </button>

        {canGenerate && target.type === 'live' && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!!busy}
            data-testid={`menu-image-generate-btn-${target.itemId}`}
            className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 ${compact ? '' : 'text-xs px-3 py-1.5'}`}
            title="Auto-generate a free food photo based on the item name"
          >
            {busy === 'generate' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Generate
          </button>
        )}

        {canRemove && imageUrl && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={!!busy}
            data-testid={`menu-image-remove-btn-${target.itemId || 'new'}`}
            className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md text-red-700 hover:bg-red-50 disabled:opacity-50 ${compact ? '' : 'text-xs px-3 py-1.5'}`}
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
        )}
      </div>

      {err && (
        <p className="text-[11px] text-red-600" data-testid={`menu-image-error-${target.itemId || 'new'}`}>
          {err}
        </p>
      )}
    </div>
    </>
  );
};

export default MenuImageUploader;
