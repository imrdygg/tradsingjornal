import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ImagePlus, Loader2, Maximize2, Trash2 } from 'lucide-react';
import type { MemoryImage, MemoryImageRole } from '../../types';
import { compressAndReadImage, getImageFromPasteEvent } from '../../lib/utils/image-utils';
import {
  checksumDataUrl,
  createMemoryImageUrl,
  isMemoryStorageConfigured,
  uploadMemoryImage,
} from '../../lib/memory/storage';

/**
 * Attaches one chart screenshot to an observation.
 *
 * Deliberately NOT the app's `ImageUploader`. That one is built for trades and playbook setups and
 * uploads to the public `journal-media` bucket, which is fine for a chart attached to a trade
 * because the URL is only ever held by its owner. A library of several hundred charts is a
 * different object: it is the thing the trader uploads TODAY'S chart against, it accumulates, and
 * there is no reason for any of it to be reachable by URL. So this picker uploads to the private
 * `journal-memory` bucket instead, and the journal keeps the object's PATH rather than a URL that
 * expires.
 *
 * Three behaviours are deliberate:
 *
 *   1. **A failed upload never costs the picture.** If there is no cloud to upload to — signed
 *      out, or a local-only journal — the compressed image is kept inline instead. If an upload
 *      is attempted and fails, the inline copy is kept too. The trader never loses a screenshot to
 *      a storage problem, they only lose the space it was meant to free.
 *   2. **Consent decides whether a picture is queued for indexing, not whether it is stored.**
 *      Saving a screenshot the trader does not want sent to an AI provider is entirely normal, so
 *      the image is marked `skipped` rather than refused. That keeps the library honest: it says
 *      what is searchable and why, instead of claiming an embedding that does not exist.
 *   3. **Nothing is sent anywhere from here.** Picking a picture stores it. Indexing is a separate,
 *      explicit step, which is what makes "save without sending" a real option rather than a
 *      promise.
 */

export interface MemoryImagePickerProps {
  /** The picture already attached to this slot, if any. */
  image?: MemoryImage;
  role: MemoryImageRole;
  observationId: string;
  userId: string;
  label: string;
  helperText?: string;
  /** False when the observation itself has not been created yet. */
  disabled?: boolean;
  /** True when the trader has consented to cloud image processing. */
  consentToIndex: boolean;
  onChange: (image: MemoryImage | undefined) => void;
  idPrefix: string;
}

/** Folder-safe id for a picture that was just picked. */
function newImageId(observationId: string, role: MemoryImageRole): string {
  return `${observationId}-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Resolves the URL to draw a memory picture from.
 *
 * A picture kept inline draws from its own data URL. One in the private bucket needs a signed URL,
 * which is fetched on demand and expires, so it is re-fetched rather than stored: the row keeps the
 * path, and a path is not a URL. Null means there is nothing drawable yet, which is a real state
 * for the moment between mount and the signed URL arriving.
 */
export function useMemoryImageSrc(image: MemoryImage | undefined): string | null {
  const [src, setSrc] = useState<string | null>(image?.dataUrl ?? null);
  const inline = image?.dataUrl;
  const path = image?.storagePath;

  useEffect(() => {
    let active = true;

    if (inline) {
      setSrc(inline);
      return () => {
        active = false;
      };
    }
    if (!path) {
      setSrc(null);
      return () => {
        active = false;
      };
    }

    setSrc(null);
    void createMemoryImageUrl(path).then((url) => {
      if (active) setSrc(url);
    });

    return () => {
      active = false;
    };
  }, [inline, path]);

  return src;
}

export const MemoryImagePicker: React.FC<MemoryImagePickerProps> = ({
  image,
  role,
  observationId,
  userId,
  label,
  helperText,
  disabled = false,
  consentToIndex,
  onChange,
  idPrefix,
}) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewSrc = useMemoryImageSrc(image);

  async function handleFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That is not an image. Drop a chart screenshot.');
      return;
    }
    setError(null);
    setNote(null);
    setBusy('Optimising the screenshot…');

    try {
      const dataUrl = await compressAndReadImage(file);
      const id = image?.id ?? newImageId(observationId, role);
      const checksum = await checksumDataUrl(dataUrl);

      const base: MemoryImage = {
        id,
        observationId,
        role,
        dataUrl,
        checksum: checksum ?? undefined,
        mimeType: 'image/jpeg',
        // The picture's own time is not known from a file drop, so it is left unset rather than
        // stamped with the moment it was uploaded. `capturedAt` is only ever written when the
        // trader says when the chart was taken, and the observation's own timestamp carries the
        // worst case it must be treated as.
        indexStatus: consentToIndex ? 'pending' : 'skipped',
        migratedAt: undefined,
        createdAt: image?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      if (isMemoryStorageConfigured()) {
        setBusy('Uploading to your private storage…');
        try {
          const uploaded = await uploadMemoryImage({ userId, observationId, imageId: id, dataUrl });
          // The inline copy goes only now that the object is confirmed readable and its path is
          // in hand. This is the whole reason the uploader verifies rather than assumes.
          onChange({
            ...base,
            storagePath: uploaded.storagePath,
            checksum: uploaded.checksum ?? base.checksum,
            dataUrl: undefined,
          });
          setBusy(null);
          return;
        } catch (uploadError) {
          setNote(
            uploadError instanceof Error
              ? `Kept in this browser instead of your private storage: ${uploadError.message}`
              : 'Kept in this browser instead of your private storage.'
          );
        }
      } else {
        setNote('No cloud storage is configured, so this picture is kept in this browser.');
      }

      onChange(base);
      setBusy(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That image could not be read.');
      setBusy(null);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2" onPaste={(e) => {
      const pasted = getImageFromPasteEvent(e);
      if (pasted) {
        e.preventDefault();
        void handleFile(pasted);
      }
    }}>
      <div className="flex items-center justify-between gap-2">
        <label className="text-[10px] font-mono uppercase font-bold text-zinc-400">{label}</label>
        {image && (
          <span className="flex items-center gap-1.5">
            <span className="rounded-md border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
              {image.storagePath ? 'private storage' : 'in this browser'}
            </span>
            <span
              className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${
                image.indexStatus === 'completed'
                  ? 'border-emerald-800 bg-emerald-950/70 text-emerald-300'
                  : image.indexStatus === 'failed'
                  ? 'border-rose-800 bg-rose-950/60 text-rose-300'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400'
              }`}
              title={
                image.indexStatus === 'skipped'
                  ? 'Not sent for indexing, so this picture cannot be found by a similarity search.'
                  : 'Whether this picture has an embedding yet.'
              }
            >
              {image.indexStatus}
            </span>
          </span>
        )}
      </div>

      {image && previewSrc ? (
        <div className="flex items-start gap-3">
          <div className="relative h-24 w-40 shrink-0 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
            <img
              id={`${idPrefix}-preview`}
              src={previewSrc}
              alt={`${label} screenshot`}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="space-y-1.5">
            <p className="text-[11px] leading-relaxed text-zinc-400">
              {helperText ??
                (role === 'before-setup' || role === 'entry'
                  ? 'This is the picture a search may match on. Only pictures from before the decision can be, so this is the one that counts.'
                  : 'This picture is from after the decision. It is never matched on — it is read only once the matches are chosen, to show what happened next.')}
            </p>
            <button
              type="button"
              id={`${idPrefix}-remove`}
              onClick={() => {
                setNote(null);
                setError(null);
                onChange(undefined);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Trash2 className="h-3 w-3" /> Remove
            </button>
          </div>
        </div>
      ) : image ? (
        <p className="text-[11px] text-zinc-500">
          The screenshot is stored privately. Its preview needs a signed link, which this device
          could not get right now — the picture itself is still there.
        </p>
      ) : (
        <div
          id={`${idPrefix}-dropzone`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFile(e.dataTransfer.files?.[0] ?? null);
          }}
          onClick={() => !busy && !disabled && fileInputRef.current?.click()}
          className={`rounded-xl border border-dashed p-3.5 text-center transition-all ${
            disabled
              ? 'cursor-not-allowed border-zinc-800/60 bg-zinc-950/30 opacity-60'
              : busy
              ? 'cursor-wait border-zinc-800 bg-zinc-950/60'
              : dragging
              ? 'cursor-pointer border-sky-500 bg-sky-950/20'
              : 'cursor-pointer border-zinc-800 bg-zinc-950/60 hover:border-zinc-700'
          }`}
        >
          <input
            id={`${idPrefix}-input`}
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={disabled}
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
          />
          <div className="pointer-events-none flex flex-col items-center justify-center gap-1">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                <span className="text-[11px] text-zinc-300">{busy}</span>
              </>
            ) : (
              <>
                <ImagePlus className="h-4 w-4 text-zinc-400" />
                <span className="text-[11px] text-zinc-300">
                  <span className="text-sky-400 underline decoration-sky-500/40">
                    Click to browse
                  </span>{' '}
                  or drop a chart here
                </span>
                <span className="text-[10px] text-zinc-500">
                  Saved to your private storage. Nothing is sent anywhere until you index it.
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-1.5 rounded-lg border border-rose-800/80 bg-rose-950/40 p-2 text-[11px] text-rose-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}
      {note && (
        <p className="text-[10px] leading-relaxed text-amber-300/90">{note}</p>
      )}
    </div>
  );
};

/** A small square preview of a stored picture, for a list row. */
export const MemoryImageThumb: React.FC<{
  image: MemoryImage;
  alt: string;
  id?: string;
  onOpen?: (src: string) => void;
}> = ({ image, alt, id, onOpen }) => {
  const src = useMemoryImageSrc(image);
  if (!src) {
    return (
      <div
        className="flex h-14 w-20 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-[9px] text-zinc-600"
        title="This picture needs a signed link to display."
      >
        no preview
      </div>
    );
  }
  return (
    <button
      type="button"
      id={id}
      onClick={() => onOpen?.(src)}
      className="group relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 transition-colors hover:border-sky-500/60 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
      title="Click to view this screenshot larger"
    >
      <img src={src} alt={alt} className="h-full w-full object-cover" />
      <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
        <Maximize2 className="h-3.5 w-3.5 text-zinc-100" />
      </span>
    </button>
  );
};
