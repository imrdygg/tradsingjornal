import React, { useState, useRef } from 'react';
import {
  Upload,
  Image as ImageIcon,
  Trash2,
  ZoomIn,
  Plus,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { compressAndReadImage, getImageFromPasteEvent } from '../../lib/utils/image-utils';

export interface ImageUploaderProps {
  images: string[];
  onChange: (newImages: string[]) => void;
  onPreviewImage?: (index: number) => void;
  maxImages?: number;
  label?: string;
  helperText?: string;
  idPrefix?: string;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  images,
  onChange,
  onPreviewImage,
  maxImages = 6,
  label = 'Chart Screenshots / Images',
  helperText = 'Drag & drop, click to browse, or paste (Ctrl+V) chart screenshots.',
  idPrefix = 'uploader',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;

    if (images.length + files.length > maxImages) {
      setError(`You can attach up to ${maxImages} images total.`);
      return;
    }

    setError(null);
    setIsProcessing(true);

    try {
      const newUrls: string[] = [];
      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          continue;
        }
        const dataUrl = await compressAndReadImage(file);
        newUrls.push(dataUrl);
      }

      if (newUrls.length > 0) {
        onChange([...images, ...newUrls]);
      } else {
        setError('No valid image files detected.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to process images.');
    } finally {
      setIsProcessing(false);
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

  return (
    <div
      id={`${idPrefix}-container`}
      className="space-y-2.5"
      onPaste={handlePaste}
    >
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
          <ImageIcon className="w-3.5 h-3.5 text-zinc-400" />
          {label}
        </label>
        <span className="text-[11px] font-mono text-zinc-400">
          {images.length} / {maxImages} attached
        </span>
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-[11px] text-rose-400 bg-rose-950/40 border border-rose-800/80 rounded-lg p-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Upload Drop Zone */}
      {images.length < maxImages && (
        <div
          id={`${idPrefix}-dropzone`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative rounded-xl border border-dashed p-4 text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-emerald-500 bg-emerald-950/20 text-emerald-300'
              : 'border-zinc-800 hover:border-zinc-700 bg-zinc-950/60 hover:bg-zinc-950 text-zinc-400'
          }`}
        >
          <input
            id={`${idPrefix}-file-input`}
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="flex flex-col items-center justify-center gap-1.5 pointer-events-none">
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                <span className="text-xs text-zinc-300 font-medium">
                  Optimizing and attaching image...
                </span>
              </>
            ) : (
              <>
                <div className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 shadow-sm">
                  <Upload className="w-4 h-4" />
                </div>
                <div className="text-xs font-medium text-zinc-200">
                  <span className="text-emerald-400 underline decoration-emerald-500/40">
                    Click to browse
                  </span>{' '}
                  or drop screenshots here
                </div>
                <p className="text-[11px] text-zinc-400">{helperText}</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Thumbnails Grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 pt-1">
          {images.map((img, idx) => (
            <div
              key={idx}
              className="group relative rounded-xl border border-zinc-800 bg-zinc-950/80 overflow-hidden aspect-[4/3] flex items-center justify-center"
            >
              <img
                src={img}
                alt={`Chart screenshot ${idx + 1}`}
                className="w-full h-full object-cover"
              />

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
                      title="View big"
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
                    title="Remove image"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
