import fs from "fs";
import path from "path";
import fetch from "node-fetch"; // se Node < 18

const updateInterval = 10 * 60 * 1000; // 10 minuti
const dailyDir = path.join(process.cwd(), "public", "Daily", "limet");

async function aggiornaDatiLIMET() {
  const now = new Date();
  const dateKey = now.toLocaleDateString("it-IT").replace(/\//g, "-"); // "08-10-2025"
  const hourKey = now.getHours().toString().padStart(2, "0");

  for (const id in stationsLIMET) {
    try {
      const res = await fetch(`https://api-stazioni-meteo.vercel.app/limet/${id}.json`);
      if (!res.ok) continue;

      const data = await res.json();
      if (!data || data.S !== "0" || typeof data.T !== "number") continue;

      const filePath = path.join(dailyDir, `${id}.json`);
      let jsonData = {};

      if (fs.existsSync(filePath)) {
        jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      }

      if (!jsonData[dateKey]) jsonData[dateKey] = {};
      if (!jsonData[dateKey][hourKey]) jsonData[dateKey][hourKey] = [];

      jsonData[dateKey][hourKey].push(data.T);

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));

    } catch (err) {
      console.error(`Errore aggiornamento ${id}:`, err.message);
    }
  }
}

// Avvia subito e ogni 10 minuti
aggiornaDatiLIMET();
setInterval(aggiornaDatiLIMET, updateInterval);
