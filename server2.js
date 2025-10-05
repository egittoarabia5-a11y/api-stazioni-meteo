import express from "express";
import fs from "fs";
import path from "path";
import fetch from "node-fetch"; // se usi Node <18, altrimenti fetch nativo

const app = express();
const PORT = 3000;

const DATA_DIR = path.join(process.cwd(), "DailyData");

// Configura le stazioni da aggiornare
const stations = [
  { source: "limet", id: "SantAlberto" },
  // aggiungi altre stazioni se vuoi
];

// Crea directory se non esiste
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Funzione per ottenere dati dall'API esterna
async function fetchStationData(source, id) {
  const url = `https://api-stazioni-meteo.vercel.app/${source}/${id}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // Manteniamo solo i dati utili: timestamp e temperatura
    return { timestamp: new Date().toISOString(), ...json };
  } catch (err) {
    console.error("Errore fetch dati:", err);
    return null;
  }
}

// Funzione che aggiorna il file JSON locale
async function updateStationFile(source, id) {
  const sourceDir = path.join(DATA_DIR, source);
  if (!fs.existsSync(sourceDir)) fs.mkdirSync(sourceDir, { recursive: true });

  const filePath = path.join(sourceDir, `${id}.json`);

  // Leggi file esistente
  let dailyData = { station: id, data: [] };
  if (fs.existsSync(filePath)) {
    try {
      dailyData = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      dailyData = { station: id, data: [] };
    }
  }

  // Prendi il nuovo dato
  const newRecord = await fetchStationData(source, id);
  if (!newRecord) return; // se errore, non scrivere

  dailyData.data.push(newRecord);

  // Mantieni solo ultimi 144 record (24h ogni 10 minuti)
  if (dailyData.data.length > 144) dailyData.data.shift();

  // Scrivi file JSON
  fs.writeFileSync(filePath, JSON.stringify(dailyData, null, 2));
  console.log(`✅ Aggiornato ${source}/${id}.json`);
}

// Endpoint per leggere i dati JSON
app.get("/DailyData/:source/:id", (req, res) => {
  const { source, id } = req.params;
  const filePath = path.join(DATA_DIR, source, `${id}.json`);
  if (!fs.existsSync(filePath)) return res.json({ station: id, data: [] });
  res.json(JSON.parse(fs.readFileSync(filePath, "utf8")));
});

// Aggiorna tutte le stazioni all'avvio
stations.forEach(({ source, id }) => updateStationFile(source, id));

// Aggiornamento periodico ogni 10 minuti
setInterval(() => {
  stations.forEach(({ source, id }) => updateStationFile(source, id));
}, 10 * 60 * 1000);

app.listen(PORT, () => console.log(`🚀 Server attivo su http://localhost:${PORT}`));
