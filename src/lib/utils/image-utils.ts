/**
 * Utility to compress and convert images/screenshots to base64 Data URLs.
 * Keeps storage compact and responsive while maintaining high fidelity for chart candles and text.
 */
export async function compressAndReadImage(
  file: File,
  maxDim = 1600,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    // If not an image, reject
    if (!file.type.startsWith('image/')) {
      return reject(new Error('Selected file is not an image.'));
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) {
        return reject(new Error('Empty image result.'));
      }

      const img = new Image();
      img.onerror = () => {
        // Fallback to raw data URL if image element load fails
        resolve(dataUrl);
      };
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(dataUrl);
            return;
          }

          // Draw and re-encode to jpeg/webp for efficient storage
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', quality);
          resolve(compressed);
        } catch {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * A downscaled copy of an image data URL, for storing rather than sending.
 *
 * A chart screenshot runs to a couple of hundred kilobytes, and a history of them would fill
 * the browser's storage on its own; this shrinks one to a thumbnail a list can render. It
 * resolves to null rather than throwing when the image cannot be drawn, because a saved
 * search without its picture is still a usable record.
 */
export function downscaleDataUrl(
  dataUrl: string,
  maxDim = 320,
  quality = 0.7
): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(null);
        }
      };
      img.src = dataUrl;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Extracts any image File from a browser paste event
 */
export function getImageFromPasteEvent(event: React.ClipboardEvent | ClipboardEvent): File | null {
  const items = event.clipboardData?.items;
  if (!items) return null;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      return items[i].getAsFile();
    }
  }
  return null;
}
