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
  createdAt?: any;
  appointmentId?: string | null;
  isContinued?: boolean;
  /**
   * Position when the timeline is set to manual order, written by drag-and-drop.
   *
   * Stored on the note rather than in a per-user preference because the order a doctor arranges
   * their treatment plan into is clinical information — the assistant opening the same patient
   * needs to see the same sequence, not their own.
   */
  sortIndex?: number;
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
export interface Service { id: string; name: string; price: number; requiresLab?: boolean; estimatedLabFee?: number; category?: string; icon?: string; }
