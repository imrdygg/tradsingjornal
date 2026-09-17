import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Download,
  Maximize2,
  ImageIcon,
} from 'lucide-react';

export interface ImageLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: string[];
  initialIndex?: number;
  title?: string;
  subtitle?: string;
}

export const ImageLightboxModal: React.FC<ImageLightboxModalProps> = ({
  isOpen,
  onClose,
  images,
  initialIndex = 0,
  title,
  subtitle,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isZoomed, setIsZoomed] = useState(false);

  // Sync initial index when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(Math.min(Math.max(0, initialIndex), Math.max(0, images.length - 1)));
      setIsZoomed(false);
    }
  }, [isOpen, initialIndex, images.length]);

  const handlePrev = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
    setIsZoomed(false);
  }, [images.length]);

  const handleNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
    setIsZoomed(false);
  }, [images.length]);

  // Keyboard navigation: Escape to close, Left/Right arrows to flip
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && images.length > 1) {
        handlePrev();
      } else if (e.key === 'ArrowRight' && images.length > 1) {
        handleNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, handlePrev, handleNext, images.length]);

  if (!isOpen || images.length === 0) return null;

  const currentImage = images[currentIndex];

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = currentImage;
    link.download = `${(title || 'chart-screenshot').toLowerCase().replace(/\s+/g, '-')}-${currentIndex + 1}.jpg`;
    link.click();
  };

  return (
    <div
      id="image-lightbox-overlay"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-black/95 backdrop-blur-md p-3 sm:p-5 select-none animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Top Bar: Title, Counter & Action Controls */}
      <div className="w-full max-w-6xl flex items-center justify-between gap-3 text-zinc-200 z-10 py-1 border-b border-zinc-800/80">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300">
            <ImageIcon className="w-4 h-4" />
          </div>
          <div className="truncate">
            <h3 className="text-xs sm:text-sm font-bold text-zinc-100 truncate">
              {title || 'Chart Screenshot'}
            </h3>
            {subtitle && (
              <p className="text-[11px] text-zinc-400 font-mono truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Counter and Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {images.length > 1 && (
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 mr-1">
              {currentIndex + 1} / {images.length}
            </span>
          )}

          <button
            id="lightbox-zoom-toggle"
            type="button"
            onClick={() => setIsZoomed(!isZoomed)}
            className="p-1.5 sm:p-2 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition-colors"
            title={isZoomed ? 'Fit to window' : 'Zoom to actual size'}
          >
            {isZoomed ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
          </button>

          <button
            id="lightbox-download-button"
            type="button"
            onClick={handleDownload}
            className="p-1.5 sm:p-2 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition-colors"
            title="Download image"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            id="lightbox-close-button"
            type="button"
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-xl text-zinc-400 hover:text-rose-400 hover:bg-zinc-800/80 transition-colors ml-1"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="relative flex-1 w-full max-w-6xl flex items-center justify-center overflow-hidden my-2">
        {/* Navigation Arrow: Previous */}
        {images.length > 1 && (
          <button
            id="lightbox-prev-button"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            className="absolute left-2 sm:left-4 z-20 p-2.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/60 shadow-xl transition-transform hover:scale-105 active:scale-95"
            title="Previous image (Left arrow)"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}

        {/* The Image Container */}
        <div
          className={`w-full h-full flex items-center justify-center p-1 sm:p-3 transition-all ${
            isZoomed ? 'overflow-auto cursor-zoom-out' : 'cursor-zoom-in'
          }`}
          onClick={() => setIsZoomed(!isZoomed)}
        >
          <img
            src={currentImage}
            alt={title || `Screenshot ${currentIndex + 1}`}
            className={`transition-transform duration-200 select-none rounded-lg shadow-2xl ${
              isZoomed
                ? 'max-w-none w-auto h-auto scale-125'
                : 'max-h-[75vh] sm:max-h-[80vh] max-w-full object-contain'
            }`}
          />
        </div>

        {/* Navigation Arrow: Next */}
        {images.length > 1 && (
          <button
            id="lightbox-next-button"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className="absolute right-2 sm:right-4 z-20 p-2.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/60 shadow-xl transition-transform hover:scale-105 active:scale-95"
            title="Next image (Right arrow)"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Bottom Thumbnails Strip (if multiple images) */}
      {images.length > 1 && (
        <div className="w-full max-w-2xl flex items-center justify-center gap-2 overflow-x-auto py-1 z-10">
          {images.map((img, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setCurrentIndex(idx);
                setIsZoomed(false);
              }}
              className={`relative rounded-lg overflow-hidden h-12 w-16 border transition-all shrink-0 ${
                idx === currentIndex
                  ? 'border-emerald-500 ring-2 ring-emerald-500/40 scale-105'
                  : 'border-zinc-800 opacity-60 hover:opacity-100'
              }`}
            >
              <img
                src={img}
                alt={`Thumbnail ${idx + 1}`}
                className="w-full h-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
