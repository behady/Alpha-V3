import { Service } from './types';

export const ALL_TEETH = [
  "18","17","16","15","14","13","12","11","21","22","23","24","25","26","27","28",
  "48","47","46","45","44","43","42","41","31","32","33","34","35","36","37","38",
];
export const UPPER_LEFT_TEETH = ["18","17","16","15","14","13","12","11"];
export const UPPER_RIGHT_TEETH = ["21","22","23","24","25","26","27","28"];
export const LOWER_LEFT_TEETH = ["48","47","46","45","44","43","42","41"];
export const LOWER_RIGHT_TEETH = ["31","32","33","34","35","36","37","38"];
/**
 * What the lab will charge for a procedure.
 *
 * Taken from the price list: a service marked as needing a lab carries its own estimated fee, and
 * the fee is charged once per tooth in the same way the price is.
 *
 * This is a *fee*, not an order. It comes off the top before the dentist's commission is worked
 * out, which is the only reason the system knows about labs at all — see resolvePaymentLabFee for
 * the rule that it is deducted once rather than on every instalment.
 */
export function computeProcedureLabFee(options: {
  matchedServices: Service[];
  pricingUnits: number;
}): { labFee: number; labFeePerUnit: number; reqLab: boolean } {
  const { matchedServices, pricingUnits } = options;
  const units = Math.max(pricingUnits, 1);

  const catalogPerUnit = matchedServices
    .filter((s) => s.requiresLab)
    .reduce((sum, s) => sum + (Number(s.estimatedLabFee || 0) || 0), 0);
  return {
    labFee: catalogPerUnit * units,
    labFeePerUnit: catalogPerUnit,
    reqLab: matchedServices.some((s) => s.requiresLab),
  };
}

export function parseTeethString(raw: string): string[] {
  if (!raw) return [];
  const tokens = raw
    .split(/[\s,;/-]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  return Array.from(new Set(tokens.filter((t) => ALL_TEETH.includes(t))));
}


export const compressImage = (file: File, maxWidth = 1200, quality = 0.8): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxWidth) {
            width = Math.round((width * maxWidth) / height);
            height = maxWidth;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas compression failed'));
          },
          'image/jpeg', 
          quality
        );
      };
    };
    reader.onerror = (error) => reject(error);
  });
};
