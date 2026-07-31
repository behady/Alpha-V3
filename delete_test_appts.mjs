import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc, doc } from 'firebase/firestore';

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
  
  // Find appointments created by the seeding script
  const testDocs = docs.filter(d => d.modifiedBy === 'Seeding Script');
  
  console.log(`Deleting ${testDocs.length} test appointments...`);
  
  let deletedCount = 0;
  for (const t of testDocs) {
      await deleteDoc(doc(db, 'appointments', t.id));
      deletedCount++;
  }
  
  console.log(`Successfully deleted ${deletedCount} test appointments.`);
}

run().then(() => process.exit(0)).catch(console.error);
