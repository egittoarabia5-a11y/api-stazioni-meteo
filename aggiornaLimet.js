import fs from "fs";
import path from "path";

import stationsLIMET from "./stationsLIMET.js"; // se lo hai come modulo

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
      const dateKey = now.toLocaleDateString("it-IT").replace(/\//g, "-");
      const hourKey = now.getHours().toString().padStart(2, "0");

      const filePath = path.join(dailyDir, `${id}.json`);
      let jsonData = {};

      if (fs.existsSync(filePath)) {
        try {
          jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        } catch {
          jsonData = {};
        }
      }

      if (!jsonData[dateKey]) jsonData[dateKey] = {};
      if (!jsonData[dateKey][hourKey]) jsonData[dateKey][hourKey] = [];

      jsonData[dateKey][hourKey].push(data.T);

      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2));

      console.log(`✅ Aggiornato ${id} (${data.T}°C)`);

    } catch (err) {
      console.error(`❌ Errore ${id}:`, err.message);
    }
  }
}

await aggiornaDatiLIMET();