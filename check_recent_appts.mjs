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
  
  // Current time in seconds
  const now = Math.floor(Date.now() / 1000);
  
  // Find appointments created in the last 24 hours
  const recentDocs = docs.filter(d => {
    if (d.createdAt && d.createdAt.seconds) {
      return (now - d.createdAt.seconds) < 86400; // 24 hours
    }
    return false;
  });
  
  console.log(`Total appointments found: ${docs.length}`);
  console.log(`Recent appointments (last 24h): ${recentDocs.length}`);
  
  if (recentDocs.length > 0) {
      console.log("Sample recent appointment:");
      console.log(recentDocs[0]);
  }
}

run().then(() => process.exit(0)).catch(console.error);
