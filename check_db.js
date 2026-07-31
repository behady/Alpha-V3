const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

const config = {
  apiKey: "AIzaSyAlhXm6u3Wwmq8GJ1hb625x1mDSwGbwOQ4",
  authDomain: "alpha-dental-b9feb.firebaseapp.com",
  projectId: "alpha-dental-b9feb",
  storageBucket: "alpha-dental-b9feb.firebasestorage.app",
  messagingSenderId: "686350211010",
  appId: "1:686350211010:web:e8e35c659fc5c1f130685b"
};

const app = initializeApp(config);
const db = getFirestore(app);

async function run() {
  const snap = await getDocs(collection(db, 'appointments'));
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  
  const ahmedDocs = docs.filter(d => d.patientName && d.patientName.includes('Ahmed'));
  console.log("Found appointments for Ahmed:");
  ahmedDocs.forEach(d => {
    console.log(`- ID: ${d.id}, patientId: ${d.patientId} (Type: ${typeof d.patientId}), status: ${d.status}`);
  });
  
  const notesSnap = await getDocs(collection(db, 'clinical_notes'));
  const notes = notesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const ahmedNotes = notes.filter(d => d.patientName && d.patientName.includes('Ahmed'));
  console.log("\nFound notes for Ahmed:");
  ahmedNotes.forEach(d => {
    console.log(`- ID: ${d.id}, patientId: ${d.patientId} (Type: ${typeof d.patientId}), note: ${d.procedure}`);
  });
}

run();
