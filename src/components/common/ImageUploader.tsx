import React, { useState, useRef } from 'react';
import {
  Upload,
  Image as ImageIcon,
  Trash2,
  ZoomIn,
  Loader2,
  AlertCircle,
  Video,
  Play,
} from 'lucide-react';
import { compressAndReadImage, getImageFromPasteEvent } from '../../lib/utils/image-utils';
import {
  isVideoUrl,
  uploadMediaFile,
  validateVideoFile,
  MAX_VIDEO_SECONDS,
} from '../../lib/media/media-utils';

export interface ImageUploaderProps {
  /** Attachment list. Images are data URLs, uploaded videos are cloud URLs. */
  images: string[];
  onChange: (newImages: string[]) => void;
  onPreviewImage?: (index: number) => void;
  /** Maximum number of attachments (images + videos) allowed. */
  maxImages?: number;
  label?: string;
  helperText?: string;
  idPrefix?: string;
  /** Allow quick 30-60 second chart clips in addition to images. */
  allowVideo?: boolean;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  images,
  onChange,
  onPreviewImage,
  maxImages = 6,
  label = 'Chart Screenshots & Video',
  helperText = 'Drag & drop, click to browse, or paste (Ctrl+V) chart screenshots. Videos up to 90 seconds.',
  idPrefix = 'uploader',
  allowVideo = true,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isBusy = status !== null;

  const processFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;

    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    const videoFiles = allowVideo ? files.filter((f) => f.type.startsWith('video/')) : [];
    const accepted = [...imageFiles, ...videoFiles];

    if (accepted.length === 0) {
      setError(
        allowVideo
          ? 'No valid image or video files detected.'
          : 'No valid image files detected.'
      );
      return;
    }

    if (images.length + accepted.length > maxImages) {
      setError(
        `You can attach up to ${maxImages} files total (${
          images.length
        } already attached). Remove one first.`
      );
      return;
    }

    setError(null);
    const newUrls: string[] = [];

    try {
      // Images first — they are instant and compressed locally.
      for (const file of imageFiles) {
        setStatus('Optimising image…');
        newUrls.push(await compressAndReadImage(file));
      }

      // Clips are validated, then uploaded to cloud storage.
      for (const file of videoFiles) {
        setStatus('Checking video…');
        const check = await validateVideoFile(file);
        if (!check.ok) {
          setError(check.error || 'That video could not be used.');
          continue;
        }
        setStatus(`Uploading video (${Math.round(check.durationSeconds || 0)}s)…`);
        newUrls.push(await uploadMediaFile(file));
      }

      if (newUrls.length > 0) {
        onChange([...images, ...newUrls]);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to attach that file.');
    } finally {
      setStatus(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFiles(e.target.files);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const file = getImageFromPasteEvent(e);
    if (file) {
      e.preventDefault();
      await processFiles([file]);
    }
  };

  const handleRemove = (indexToRemove: number) => {
    onChange(images.filter((_, idx) => idx !== indexToRemove));
  };

  const videoCount = images.filter((img) => isVideoUrl(img)).length;
  const imageCount = images.length - videoCount;

  return (
    <div
      id={`${idPrefix}-container`}
      className="space-y-2.5"
      onPaste={handlePaste}
    >
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5 text-zinc-400" />
          {label}
        </label>
        <span className="text-[11px] font-mono text-zinc-400">
          {images.length} / {maxImages} attached
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 text-[11px] text-rose-300 bg-rose-950/40 border border-rose-800/80 rounded-lg p-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {/* Upload Drop Zone */}
      {images.length < maxImages && (
        <div
          id={`${idPrefix}-dropzone`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isBusy && fileInputRef.current?.click()}
          className={`relative rounded-xl border border-dashed p-4 text-center transition-all ${
            isBusy ? 'cursor-wait' : 'cursor-pointer'
          } ${
            isDragging
              ? 'border-emerald-500 bg-emerald-950/20 text-emerald-300'
              : 'border-zinc-800 hover:border-zinc-700 bg-zinc-950/60 hover:bg-zinc-950 text-zinc-400'
          }`}
        >
          <input
            id={`${idPrefix}-file-input`}
            ref={fileInputRef}
            type="file"
            accept={allowVideo ? 'image/*,video/*' : 'image/*'}
            multiple
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="flex flex-col items-center justify-center gap-1.5 pointer-events-none">
            {isBusy ? (
              <>
                <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                <span className="text-xs text-zinc-300 font-medium">{status}</span>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 shadow-sm">
                    <Upload className="w-4 h-4" />
                  </div>
                  {allowVideo && (
                    <div className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-emerald-400 shadow-sm">
                      <Video className="w-4 h-4" />
                    </div>
                  )}
                </div>
                <div className="text-xs font-medium text-zinc-200">
                  <span className="text-emerald-400 underline decoration-emerald-500/40">
                    Click to browse
                  </span>{' '}
                  or drop files here
                </div>
                <p className="text-[11px] text-zinc-400 max-w-xs">{helperText}</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Thumbnails Grid */}
      {images.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-400">
            <span className="flex items-center gap-1">
              <ImageIcon className="w-3 h-3" /> {imageCount} image
              {imageCount === 1 ? '' : 's'}
            </span>
            {allowVideo && (
              <span className="flex items-center gap-1">
                <Video className="w-3 h-3" /> {videoCount} video
                {videoCount === 1 ? '' : 's'}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {images.map((img, idx) => {
              const isVideo = isVideoUrl(img);
              return (
                <div
                  key={idx}
                  className="group relative rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden aspect-[4/3] flex items-center justify-center"
                >
                  {isVideo ? (
                    <>
                      <video
                        src={img}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="p-1.5 rounded-full bg-black/60 border border-emerald-500/50 text-emerald-300">
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </span>
                      </div>
                    </>
                  ) : (
                    <img
                      src={img}
                      alt={`Chart screenshot ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-2">
                    <span className="text-[10px] font-mono font-semibold text-zinc-200 bg-black/60 px-1.5 py-0.5 rounded">
                      #{idx + 1}
                    </span>

                    <div className="flex items-center gap-1">
                      {onPreviewImage && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPreviewImage(idx);
                          }}
                          className="p-1.5 rounded-lg bg-zinc-900/90 text-zinc-200 hover:text-white hover:bg-zinc-800 border border-zinc-700/60 transition-colors shadow-sm"
                          title={isVideo ? 'Play video' : 'View big'}
                        >
                          <ZoomIn className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemove(idx);
                        }}
                        className="p-1.5 rounded-lg bg-zinc-900/90 text-rose-400 hover:text-rose-200 hover:bg-rose-950/80 border border-rose-900/60 transition-colors shadow-sm"
                        title="Remove file"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {allowVideo && (
        <p className="text-[10px] text-zinc-500 leading-relaxed">
          Videos upload to your cloud storage and play back anywhere you sign in. Keep clips
          under {MAX_VIDEO_SECONDS} seconds — they are for quick chart walk-throughs, not full
          reviews.
        </p>
      )}
    </div>
  );
};
