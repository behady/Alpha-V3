import { LabInfo, Service } from './types';

export const ALL_TEETH = [
  "18","17","16","15","14","13","12","11","21","22","23","24","25","26","27","28",
  "48","47","46","45","44","43","42","41","31","32","33","34","35","36","37","38",
];
export const UPPER_LEFT_TEETH = ["18","17","16","15","14","13","12","11"];
export const UPPER_RIGHT_TEETH = ["21","22","23","24","25","26","27","28"];
export const LOWER_LEFT_TEETH = ["48","47","46","45","44","43","42","41"];
export const LOWER_RIGHT_TEETH = ["31","32","33","34","35","36","37","38"];
export const IMPRESSION_TYPES = ["Alginate", "Condensation", "Additional", "Scan"] as const;

export function labServiceUnitPrice(lab: LabInfo | undefined, serviceName: string): number {
  if (!lab || !serviceName.trim()) return 0;
  const key = serviceName.trim().toLowerCase();
  const row = (lab.servicesPricing || []).find(
    (s) => String(s.name || "").trim().toLowerCase() === key
  );
  return Number(row?.price) || 0;
}

export function computeProcedureLabFee(options: {
  needsLabOrderNow: boolean;
  formLabId: string;
  formLabService: string;
  labs: LabInfo[];
  matchedServices: Service[];
  pricingUnits: number;
}): { labFee: number; labFeePerUnit: number; reqLab: boolean } {
  const { needsLabOrderNow, formLabId, formLabService, labs, matchedServices, pricingUnits } = options;
  const units = Math.max(pricingUnits, 1);

  if (needsLabOrderNow && formLabId && formLabService.trim()) {
    const lab = labs.find((l) => l.id === formLabId);
    const labFeePerUnit = labServiceUnitPrice(lab, formLabService);
    return { labFee: labFeePerUnit * units, labFeePerUnit, reqLab: true };
  }

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

export function normalizeImpressionType(raw: unknown): (typeof IMPRESSION_TYPES)[number] | "" {
  const s = String(raw ?? "").trim();
  return (IMPRESSION_TYPES as readonly string[]).includes(s) ? (s as (typeof IMPRESSION_TYPES)[number]) : "";
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
