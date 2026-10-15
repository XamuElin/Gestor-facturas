/**
 * Compresses and scales an image base64 or File down to an optimal size for OCR/Gemini analysis
 * while preserving high fidelity text readability.
 */
export async function optimizeImageForAnalysis(
  fileOrBase64: File | string,
  maxDimension: number = 1600,
  quality: number = 0.8
): Promise<{ base64: string; mimeType: string }> {
  // If input is a PDF, do not pass through canvas/image loader
  if (typeof fileOrBase64 === 'string') {
    if (fileOrBase64.startsWith('data:application/pdf') || fileOrBase64.startsWith('JVBERi0') || fileOrBase64.includes('application/pdf')) {
      return { base64: fileOrBase64, mimeType: 'application/pdf' };
    }
  } else if (fileOrBase64.type === 'application/pdf' || fileOrBase64.name.toLowerCase().endsWith('.pdf')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ base64: reader.result as string, mimeType: 'application/pdf' });
      reader.onerror = reject;
      reader.readAsDataURL(fileOrBase64);
    });
  }

  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      let { width, height } = img;

      // Scale down if exceeding max dimension
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        // Fallback to original
        if (typeof fileOrBase64 === 'string') {
          resolve({ base64: fileOrBase64, mimeType: 'image/jpeg' });
        } else {
          const reader = new FileReader();
          reader.onload = () => resolve({ base64: reader.result as string, mimeType: fileOrBase64.type });
          reader.onerror = reject;
          reader.readAsDataURL(fileOrBase64);
        }
        return;
      }

      // Fill white background in case of transparent pngs
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const mimeType = 'image/jpeg';
      const optimizedBase64 = canvas.toDataURL(mimeType, quality);
      resolve({ base64: optimizedBase64, mimeType });
    };

    img.onerror = (err) => {
      console.warn('Could not load image into canvas for optimization, using raw input', err);
      if (typeof fileOrBase64 === 'string') {
        resolve({ base64: fileOrBase64, mimeType: 'image/jpeg' });
      } else {
        const reader = new FileReader();
        reader.onload = () => resolve({ base64: reader.result as string, mimeType: fileOrBase64.type });
        reader.onerror = reject;
        reader.readAsDataURL(fileOrBase64);
      }
    };

    if (typeof fileOrBase64 === 'string') {
      img.src = fileOrBase64;
    } else {
      img.src = URL.createObjectURL(fileOrBase64);
    }
  });
}
