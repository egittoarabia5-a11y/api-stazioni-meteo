import fs from "fs";
import path from "path";
import { stationsLIMET } from "./stationsLIMET.js";

const updateInterval = 10 * 60 * 1000; // 10 minuti
const baseURL = "https://api-stazioni-meteo.vercel.app";
const dailyDir = path.join(process.cwd(), "public", "Daily", "limet");

async function aggiornaDatiLIMET() {
  console.log("⏱️ Avvio aggiornamento LIMET...");

  for (const id in stationsLIMET) {
    try {
      const res = await fetch(`${baseURL}/limet/${id}.json`);
      if (!res.ok) throw new Error(`Errore fetch per ${id}`);

      const data = await res.json();
      if (!data || data.S !== "0" || typeof data.T !== "number") continue;

      const now = new Date();
      const nowIT = new Date(now.toLocaleString("it-IT", { timeZone: "Europe/Rome" }));

      const dateKey = nowIT.toLocaleDateString("it-IT").replace(/\//g, "-"); // "08-10-2025"
      const hourKey = nowIT.getHours().toString().padStart(2, "0");

      // Percorso del file giornaliero
      const filePath = path.join(dailyDir, `${id}.json`);

      let jsonData = {};
      try {
        if (fs.existsSync(filePath)) {
          jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        }
      } catch (err) {
        console.error(`Errore lettura ${id}.json:`, err);
        jsonData = {};
      }

      if (!jsonData[dateKey]) jsonData[dateKey] = {};
      if (!jsonData[dateKey][hourKey]) jsonData[dateKey][hourKey] = [];

      // Aggiungi temperatura
      jsonData[dateKey][hourKey].push(data.T);

      // Salva file
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));

      console.log(`✅ Aggiornati dati LIMET per ${id} - ${dateKey} ${hourKey}`);

    } catch (err) {
      console.error(`❌ Errore aggiornamento ${id}:`, err.message);
    }
  }
}

// Avvio immediato (utile se eseguito manualmente)
aggiornaDatiLIMET();

// Se vuoi farlo girare ogni 10 minuti anche localmente
setInterval(aggiornaDatiLIMET, updateInterval);
