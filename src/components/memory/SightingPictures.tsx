import React from 'react';
import type { MemoryImage } from '../../types';
import { MemoryImagePicker } from './MemoryImagePicker';

/**
 * The pictures on one sighting, and what the trader saw in each.
 *
 * Deliberately a short list rather than a set of roles. A sighting is one moment being
 * studied: the trader pulls up a chart, then zooms in, then looks at the session before — one,
 * two, or three screenshots of the same thing, each with a sentence about what it showed. The
 * old form asked which picture was "before" and which was "after", and that question is what
 * made recording a sighting feel like filing a report.
 *
 * Every picture here is stored as a pre-decision role, because the whole record is the view the
 * trader had when they were studying the market. A search may therefore match any of them,
 * which is the point of keeping them.
 *
 * A note is optional. A chart with nothing written under it is still searchable by
 * resemblance; it just cannot contribute to a pattern, and the card that reads those patterns
 * says how many notes it actually had.
 */
export const MAX_SIGHTING_PICTURES = 3;

export interface SightingPicturesProps {
  images: MemoryImage[];
  observationId: string;
  userId: string;
  consentToIndex: boolean;
  onChange: (images: MemoryImage[]) => void;
}

export const SightingPictures: React.FC<SightingPicturesProps> = ({
  images,
  observationId,
  userId,
  consentToIndex,
  onChange,
}) => {
  /** Writes a new note onto one picture without touching the others. */
  function setNote(index: number, note: string) {
    onChange(
      images.map((image, position) =>
        position === index
          ? {
              ...image,
              // An empty note is absent rather than an empty string, so the counts that read
              // "sightings with a note" cannot be inflated by a field the trader cleared.
              note: note.trim() ? note : undefined,
              updatedAt: new Date().toISOString(),
            }
          : image
      )
    );
  }

  /** Replaces or removes one slot; a removal closes the gap so the list stays dense. */
  function setImage(index: number, image: MemoryImage | undefined) {
    if (!image) {
      onChange(images.filter((_, position) => position !== index));
      return;
    }
    onChange(images.map((existing, position) => (position === index ? image : existing)));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h4 className="text-[11px] font-bold text-zinc-100">The charts you studied</h4>
          <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">
            One to {MAX_SIGHTING_PICTURES} pictures. Write what you saw under each one — that is
            what your coach reads to find a pattern. A picture with no words is still searchable
            by likeness, just silent.
          </p>
        </div>
        <span className="rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
          {images.length} of {MAX_SIGHTING_PICTURES}
        </span>
      </div>

      {images.map((image, index) => (
        <MemoryImagePicker
          key={image.id}
          idPrefix={`observation-picture-${index}`}
          label={`Picture ${index + 1}`}
          role={image.role ?? 'before-setup'}
          observationId={observationId}
          userId={userId}
          image={image}
          note={image.note}
          onNoteChange={(note) => setNote(index, note)}
          consentToIndex={consentToIndex}
          helperText="This is one of the charts you were studying. A search may match on it."
          onChange={(next) => setImage(index, next)}
        />
      ))}

      {/*
        One empty slot after the filled ones, until the cap. That is the whole "add a picture"
        interaction: a dropzone that is already there reads as room to add, where a button that
        grows the form turns adding a second chart into a two-step job.
      */}
      {images.length < MAX_SIGHTING_PICTURES && (
        <MemoryImagePicker
          key={`empty-${images.length}`}
          idPrefix={`observation-picture-${images.length}`}
          label={`Picture ${images.length + 1}`}
          role="before-setup"
          observationId={observationId}
          userId={userId}
          consentToIndex={consentToIndex}
          helperText="Drop the next chart here. One to three pictures per sighting."
          onChange={(image) => {
            if (image) onChange([...images, image]);
          }}
        />
      )}
    </div>
  );
};
