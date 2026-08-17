/**
 * The demo clinic's content, kept apart from the seeding mechanics.
 *
 * Everything here is invented. The names are plausible but fictional, and every phone number sits
 * in the 0100 000 xxxx block that no real subscriber uses — screenshots taken against this clinic
 * can be published without exposing a single real patient.
 */

export const DEMO_MARKER = "__demo";

export const CLINIC_NAME = "Demo Clinic — Alpha Dental";

export const CLINIC_INFO = {
  name: CLINIC_NAME,
  doctorName: "Dr. Youssef Kamal",
  phone: "+20 2 2735 0000",
  address: "12 El-Nasr Street, Nasr City, Cairo",
  email: "hello@demo-alphadental.example",
  currency: "EGP",
  rxHeader: "Demo Clinic — Alpha Dental\n12 El-Nasr Street, Nasr City, Cairo\n+20 2 2735 0000",
  attendanceLat: "30.0596",
  attendanceLng: "31.3400",
  attendanceRadius: "80",
};

export const CLINIC_PROFILE = {
  clinicName: CLINIC_NAME,
  phone: "+20 2 2735 0000",
  address: "12 El-Nasr Street, Nasr City, Cairo",
  googleMapsUrl: "https://maps.google.com/?q=Nasr+City+Cairo",
  googleReviewUrl: "https://g.page/r/demo-alpha-dental/review",
  logoUrl: "",
};

/**
 * Two branches with rooms, matching the shape `src/lib/clinicLocations.ts` parses. Dentists
 * alternate branches by day in the seeder, so the calendar's branch filter and doctor view both
 * have something real to show. The ids are stable on purpose — appointments reference them.
 */
export const BRANCHES = [
  {
    id: "loc_demo_main",
    name: "Main Branch — Nasr City",
    address: "12 El-Nasr Street, Nasr City, Cairo",
    phone: "+20 2 2735 0000",
    rooms: [
      { id: "loc_demo_main_r1", name: "Room 1" },
      { id: "loc_demo_main_r2", name: "Room 2" },
      { id: "loc_demo_main_r3", name: "Room 3" },
    ],
  },
  {
    id: "loc_demo_maadi",
    name: "Maadi Branch",
    address: "5 Road 9, Maadi, Cairo",
    phone: "+20 2 2358 0000",
    rooms: [
      { id: "loc_demo_maadi_r1", name: "Room A" },
      { id: "loc_demo_maadi_r2", name: "Room B" },
    ],
  },
];

/** Online booking on, with dentist choice — the public page's branch step needs both. */
export const ONLINE_BOOKING = { enabled: true, enableDoctorSelection: true };

export const SCHEDULE = {
  start: "09:00",
  end: "21:00",
  slotDuration: "30",
  offDays: ["Friday"],
};

export const PATIENT_SOURCES = [
  "Walk-in",
  "Google",
  "Facebook",
  "Instagram",
  "Friend referral",
  "Existing patient",
];

export const VISIT_REASONS = [
  "Pain",
  "Check-up",
  "Cleaning",
  "Follow-up",
  "Broken tooth",
  "Cosmetic consultation",
  "Emergency",
];

/**
 * The owner is not listed here — they are the real signed-in account, added by the seeder with
 * their own uid so they can open the demo clinic from the clinic switcher.
 */
export const STAFF = [
  {
    key: "hana",
    name: "Dr. Hana Mostafa",
    email: "hana.mostafa@demo-alphadental.example",
    role: "Dentist",
    isDentist: true,
    permissions: ["access.patients", "access.appointments", "access.reports"],
  },
  {
    key: "omar",
    name: "Dr. Omar Sherif",
    email: "omar.sherif@demo-alphadental.example",
    role: "Dentist",
    isDentist: true,
    permissions: ["access.patients", "access.appointments", "access.reports", "access.clinical"],
  },
  {
    key: "mariam",
    name: "Mariam Adel",
    email: "mariam.adel@demo-alphadental.example",
    role: "Receptionist",
    isDentist: false,
    permissions: [
      "access.patients",
      "patients.add",
      "patients.edit",
      "access.appointments",
      "appointments.add",
      "appointments.edit",
      "access.finance",
      "finance.add",
    ],
  },
  {
    key: "nourhan",
    name: "Nourhan Saad",
    email: "nourhan.saad@demo-alphadental.example",
    role: "Assistant",
    isDentist: false,
    permissions: [
      "access.patients",
      "access.appointments",
      "access.inventory",
      "inventory.add",
      "inventory.edit",
    ],
  },
];

/** Two pending requests so the Join Requests screen has something to photograph. */
export const JOIN_REQUESTS = [
  { name: "Salma Ibrahim", email: "salma.ibrahim@demo-alphadental.example", daysAgo: 1 },
  { name: "Karim Fouad", email: "karim.fouad@demo-alphadental.example", daysAgo: 3 },
];

export const SERVICES = [
  { name: "Consultation", price: 200, durationMinutes: 20 },
  { name: "Scaling & Polishing", price: 600, durationMinutes: 45 },
  { name: "Composite Filling", price: 800, durationMinutes: 45 },
  { name: "Root Canal — Anterior", price: 2500, durationMinutes: 60 },
  { name: "Root Canal — Molar", price: 3500, durationMinutes: 90 },
  { name: "Extraction — Simple", price: 700, durationMinutes: 30 },
  { name: "Extraction — Surgical", price: 2000, durationMinutes: 60 },
  { name: "Teeth Whitening", price: 3500, durationMinutes: 60 },
  { name: "Orthodontic Consultation", price: 300, durationMinutes: 30 },
  { name: "Zirconia Crown", price: 5000, durationMinutes: 60, requiresLab: true, estimatedLabFee: 1800 },
  { name: "PFM Crown", price: 3000, durationMinutes: 60, requiresLab: true, estimatedLabFee: 1000 },
  { name: "Complete Denture", price: 8000, durationMinutes: 60, requiresLab: true, estimatedLabFee: 3000 },
];

/**
 * Phone numbers all sit in +20 100 000 01xx — a block reserved here for fiction.
 *
 * Stored in **E.164**, which is what the app itself writes: the New Patient form runs the number
 * through `buildE164FromCountryCode` before saving, and the duplicate-phone check queries for that
 * exact string. Seeding these in local `01000000101` form instead looks fine on screen but is a
 * different value to Firestore — the duplicate shield never fires, and WhatsApp has no number it
 * can dial. The first version of this file made exactly that mistake.
 *
 * `sourceIdx` and `dob` are spread deliberately so the patient-source report and any age grouping
 * have shape rather than one flat bar.
 */
export const PATIENTS = [
  { name: "Ahmed Hassan", phone: "+201000000101", gender: "Male", dob: "1985-03-14", sourceIdx: 1 },
  { name: "Fatma El-Sayed", phone: "+201000000102", gender: "Female", dob: "1992-07-02", sourceIdx: 0 },
  { name: "Mohamed Abdelrahman", phone: "+201000000103", gender: "Male", dob: "1978-11-23", sourceIdx: 4 },
  { name: "Nada Farouk", phone: "+201000000104", gender: "Female", dob: "1996-01-30", sourceIdx: 3 },
  { name: "Khaled Mansour", phone: "+201000000105", gender: "Male", dob: "1969-05-09", sourceIdx: 1 },
  { name: "Yara Ashraf", phone: "+201000000106", gender: "Female", dob: "2001-09-17", sourceIdx: 2 },
  { name: "Tarek Nabil", phone: "+201000000107", gender: "Male", dob: "1988-12-05", sourceIdx: 0 },
  { name: "Heba Gamal", phone: "+201000000108", gender: "Female", dob: "1994-04-21", sourceIdx: 4 },
  { name: "Amr Zaki", phone: "+201000000109", gender: "Male", dob: "1974-08-11", sourceIdx: 1 },
  { name: "Sara Lotfy", phone: "+201000000110", gender: "Female", dob: "1999-02-27", sourceIdx: 3 },
  { name: "Mostafa Ibrahim", phone: "+201000000111", gender: "Male", dob: "1983-06-16", sourceIdx: 5 },
  { name: "Dina Samir", phone: "+201000000112", gender: "Female", dob: "1990-10-08", sourceIdx: 2 },
  { name: "Hossam Ali", phone: "+201000000113", gender: "Male", dob: "1965-01-19", sourceIdx: 0 },
  { name: "Rana Magdy", phone: "+201000000114", gender: "Female", dob: "2003-05-25", sourceIdx: 2 },
  { name: "Sherif Adly", phone: "+201000000115", gender: "Male", dob: "1981-09-03", sourceIdx: 4 },
  { name: "Mai Hussein", phone: "+201000000116", gender: "Female", dob: "1997-03-12", sourceIdx: 1 },
  { name: "Ziad Refaat", phone: "+201000000117", gender: "Male", dob: "2010-07-28", sourceIdx: 4 },
  { name: "Laila Sobhy", phone: "+201000000118", gender: "Female", dob: "1972-11-06", sourceIdx: 0 },
  { name: "Hany Wagdy", phone: "+201000000119", gender: "Male", dob: "1959-02-14", sourceIdx: 5 },
  { name: "Salma Ezzat", phone: "+201000000120", gender: "Female", dob: "1986-08-30", sourceIdx: 3 },
  { name: "Bassem Roshdy", phone: "+201000000121", gender: "Male", dob: "1993-12-18", sourceIdx: 1 },
  { name: "Menna Tarek", phone: "+201000000122", gender: "Female", dob: "2007-04-04", sourceIdx: 4 },
  { name: "Ramy Shawky", phone: "+201000000123", gender: "Male", dob: "1976-06-22", sourceIdx: 0 },
  { name: "Aya Nour", phone: "+201000000124", gender: "Female", dob: "1998-10-15", sourceIdx: 2 },
];

/** Three items sit under their reorder threshold so low-stock alerts have something to show. */
export const INVENTORY = [
  { name: "Composite Resin A2", category: "Restorative", stock: 24, minStock: 10, costPerUnit: 320, unit: "syringe" },
  { name: "Composite Resin A3", category: "Restorative", stock: 6, minStock: 10, costPerUnit: 320, unit: "syringe" },
  { name: "Bonding Agent", category: "Restorative", stock: 11, minStock: 5, costPerUnit: 850, unit: "bottle" },
  { name: "Articaine 4% 1:100,000", category: "Anaesthetic", stock: 140, minStock: 50, costPerUnit: 28, unit: "carpule" },
  { name: "Lidocaine 2%", category: "Anaesthetic", stock: 38, minStock: 40, costPerUnit: 22, unit: "carpule" },
  { name: "Latex Gloves — Medium", category: "Disposables", stock: 18, minStock: 8, costPerUnit: 190, unit: "box" },
  { name: "Latex Gloves — Large", category: "Disposables", stock: 9, minStock: 8, costPerUnit: 190, unit: "box" },
  { name: "Face Masks", category: "Disposables", stock: 22, minStock: 10, costPerUnit: 120, unit: "box" },
  { name: "Saliva Ejectors", category: "Disposables", stock: 15, minStock: 6, costPerUnit: 95, unit: "pack" },
  { name: "Gutta Percha Points", category: "Endodontic", stock: 12, minStock: 5, costPerUnit: 260, unit: "box" },
  { name: "Endo Files 21mm", category: "Endodontic", stock: 3, minStock: 6, costPerUnit: 480, unit: "pack" },
  { name: "Sodium Hypochlorite 5%", category: "Endodontic", stock: 7, minStock: 4, costPerUnit: 75, unit: "bottle" },
  { name: "Impression Material", category: "Prosthetic", stock: 10, minStock: 4, costPerUnit: 1100, unit: "kit" },
  { name: "Alginate Powder", category: "Prosthetic", stock: 8, minStock: 3, costPerUnit: 420, unit: "bag" },
  { name: "Sterilisation Pouches", category: "Infection Control", stock: 26, minStock: 10, costPerUnit: 210, unit: "box" },
];
