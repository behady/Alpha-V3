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
  const notesSnap = await getDocs(collection(db, 'clinical_notes'));
  const notes = notesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const ahmedNotes = notes.filter(d => d.patientName && d.patientName.includes('Ahmed'));
  console.log("Found notes for Ahmed:");
  ahmedNotes.forEach(d => {
    let dateStr = d.date || (d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toISOString() : "unknown");
    console.log(`- ID: ${d.id}, apptId: ${d.appointmentId}, time: ${d.time}, lastScheduledTime: ${d.lastScheduledTime}, date: ${dateStr}, note: ${d.procedure}`);
  });
}

run();
