export interface Note {
  id: string;
  title?: string;
  date?: string;
  tooth?: string;
  procedure?: string;
  procedures?: string[];
  cost?: number | string;
  unitCost?: number | string;
  unitsCount?: number;
  pricingFormula?: string;
  note?: string;
  doctor?: string;
  doctorId?: string;
  ledgerId?: string;
  status?: 'Planned' | 'Ongoing' | 'Completed'; 
  serviceName?: string | null;
  serviceId?: string | null;
  /** Every price-list entry the free-text procedure names resolved to (a note can hold several). */
  serviceIds?: string[];
  /** Procedure names that matched no price-list entry, so reports can disclose what they missed. */
  unmatchedProcedures?: string[];
  beforeImage?: string;
  afterImage?: string;
  needsLabOrder?: boolean;
  labOrderLabId?: string;
  labOrderService?: string;
  labOrderShade?: string;
  labOrderImpressionType?: string;
  labOrderNoteToLab?: string;
  createdAt?: any;
  appointmentId?: string | null;
  isContinued?: boolean;
}

export interface RelatedAppointment {
  id: string;
  clinicalNoteId?: string;
  date?: string;
  time?: string;
  doctor?: string;
  doctorName?: string;
  status?: string;
  treatment?: string;
  createdAt?: { toMillis?: () => number, toDate?: () => Date };
}

export interface Staff { id: string; name: string; role: string; commissionPercentage?: number; }
export interface Service { id: string; name: string; price: number; requiresLab?: boolean; estimatedLabFee?: number; }
export interface LabServicePrice { name: string; price: number; turnaroundDays?: number; }
export interface LabInfo { id: string; name: string; phone: string; servicesPricing?: LabServicePrice[]; }
