import cors from "cors";
import express from "express";
import fetch from "node-fetch";
import fs from 'fs';
import path from 'path';

const app = express();
const port = 3111;

app.use(cors());

// --- Variabili globali ---
const latestData = {};
const markers = {};
const stations3R = {};

// --- Funzione comune per convertire coordinate fittizie in reali ---
function fittizioAReale(xFittizio, yFittizio) {
  const lon = ((8260 + xFittizio / 1.18) / 1000).toFixed(3);
  const lat = ((46730 - yFittizio / 1.72) / 1000).toFixed(3);
  return { lat, lon };
}

// --- Funzioni per marker (placeholder) ---
function createMarker(id, lat, lon) {
  // logica per creare marker sulla mappa
}
function updateMarker(id) {
  // logica per aggiornare marker sulla mappa
}

// --- Endpoint CML ---
app.get('/cml.json', async (req, res) => {
  try {
    const CML_URL = 'https://corsproxy.io/?' + 
      encodeURIComponent('http://www.centrometeolombardo.com/Moduli/refx.php?t=all&r=1756559495232');

    const response = await fetch(CML_URL);
    const text = await response.text();

    const matchCoords = text.match(/var coords\s*=\s*(\[\[[\s\S]*?\]\]);/);
    const matchData = text.match(/datostazione\s*=\s*(\[\[[\s\S]*?\]\]);/);

    if (!matchCoords || !matchData) return res.status(500).json({ error: 'Dati non trovati' });

    const coords = JSON.parse(matchCoords[1].replace(/'/g, '"'));
    const datostazione = JSON.parse(matchData[1].replace(/'/g, '"'));

    const timestamp = new Date().toISOString();
    const lines = [JSON.stringify({ timestamp })];

    coords.forEach((c, i) => {
      const row = datostazione[i] || [];
      const { lat, lon } = fittizioAReale(parseFloat(c[3]), parseFloat(c[4]));
      const isInactive = row[0] === '1' || row[0] === 1;

      const obj = isInactive ? {
        S: "1", N: c[1] || c[0],
        T: null, TH: null, TL: null,
        D: null, DH: null, DL: null,
        H: null, HH: null, HL: null,
        V: null, G: null, R: null, RR: null,
        LAT: lat, LON: lon
      } : {
        S: "0", N: c[1] || c[0],
        T: row[4] || null, TH: row[5] || null, TL: row[7] || null,
        D: row[15] || null, DH: row[16] || null, DL: row[18] || null,
        H: row[9] || null, HH: row[10] || null, HL: row[12] || null,
        V: row[28] || null, G: row[25] || null, R: row[37] || null, RR: row[41] || null,
        LAT: lat, LON: lon
      };

      lines.push(JSON.stringify(obj));
    });

    res.setHeader('Content-Type', 'application/json');
    res.send(lines.join("\n"));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Endpoint OMIRL ---
app.get('/omirl.json', async (req, res) => {
  try {
    const fetchJson = async url => (await (await fetch("https://corsproxy.io/?" + encodeURIComponent(url))).json());

    const stations = await fetchJson("https://omirl.regione.liguria.it/Omirl/rest/stations/Termo");
    const tempsData = await fetchJson("https://omirl.regione.liguria.it/Omirl/rest/stations/sensorvalues/Termo");
    const windData = await fetchJson("https://omirl.regione.liguria.it/Omirl/rest/stations/sensorvalues/Vento");
    const humData = await fetchJson("https://omirl.regione.liguria.it/Omirl/rest/stations/sensorvalues/Igro");
    const rainData = await fetchJson("https://omirl.regione.liguria.it/Omirl/rest/stations/sensorvalues/Pluvio");

    const mapSensor = (data, keys) => {
      const map = {};
      if (!data.tableRows) return map;
      data.tableRows.forEach(st => {
        map[st.code] = {};
        keys.forEach(k => {
          if (st[k] !== undefined && st[k] !== null) map[st.code][k] = st[k];
        });
      });
      return map;
    };

    const tempsMap = mapSensor(tempsData, ['last', 'max', 'min']);
    const windMap = mapSensor(windData, ['last', 'max']);
    const humMap = mapSensor(humData, ['last', 'max', 'min']);
    const rainMap = mapSensor(rainData, ['last', 'max']);

    const timestamp = new Date().toISOString();
    const lines = [JSON.stringify({ timestamp })];

    stations.forEach(st => {
      const id = st.shortCode || st.code;
      const lat = st.lat;
      const lon = st.lon;

      const t = tempsMap[id] || {};
      const w = windMap[id] || {};
      const h = humMap[id] || {};
      const r = rainMap[id] || {};

      const obj = {
        S: (t.last == null && w.last == null && h.last == null && r.max == null) ? "1" : "0",
        N: st.name || id,
        T: t.last ?? null,
        TH: t.max ?? null,
        TL: t.min ?? null,
        D: null, DH: null, DL: null,
        H: h.last ?? null,
        HH: h.max ?? null,
        HL: h.min ?? null,
        V: w.last ?? null,
        G: w.last ?? null,
        R: r.max ?? null,
        RR: r.last ?? null,
        LAT: lat, LON: lon
      };

      lines.push(JSON.stringify(obj));
    });

    res.setHeader('Content-Type', 'application/json');
    res.send(lines.join("\n"));

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Endpoint TorinoMeteo ---
app.get('/torinometeo.json', async (req, res) => {
  try {
    const url = "https://www.torinometeo.org/api/v1/realtime/data/?format=json";
    const response = await fetch(url);
    const data = await response.json();

    if (!Array.isArray(data)) return res.status(500).json({ error: "Risposta TorinoMeteo inattesa" });

    const timestamp = new Date().toISOString();
    const lines = [JSON.stringify({ timestamp })];

    data.forEach(stationData => {
      const st = stationData.station;
      const name = st.name || st.slug;
      const lat = parseFloat(st.lat);
      const lon = parseFloat(st.lng);

      const temp = stationData.temperature ?? null;
      const tempHigh = stationData.temperature_max ?? null;
      const tempLow = stationData.temperature_min ?? null;

      const hum = stationData.relative_humidity ?? null;
      const humHigh = stationData.relative_humidity_max ?? null;
      const humLow = stationData.relative_humidity_min ?? null;

      const wind = stationData.wind_strength ?? null;
      const windGust = stationData.wind_strength_max ?? null;

      const rain = stationData.rain ?? null;
      const rainRate = stationData.rain_rate ?? null;

      const inactive = temp == null && hum == null && wind == null && rain == null;

      const obj = {
        S: inactive ? "1" : "0",
        N: name,
        T: temp, TH: tempHigh, TL: tempLow,
        D: null, DH: null, DL: null,
        H: hum, HH: humHigh, HL: humLow,
        V: wind, G: windGust,
        R: rain, RR: rainRate,
        LAT: lat, LON: lon
      };

      lines.push(JSON.stringify(obj));
    });

    res.setHeader('Content-Type', 'application/json');
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("Errore fetch TorinoMeteo:", err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/astrogeo.json', async (req, res) => {
  try {
    const url = "https://www.astrogeo.va.it/data/stazioni/mappa_meteo.json";
    const response = await fetch(url);
    if (!response.ok) throw new Error("HTTP " + response.status);

    const json = await response.json();
    if (!json.dati || !Array.isArray(json.dati)) {
      return res.status(500).json({ error: "Formato JSON inatteso" });
    }

    const timestamp = new Date().toISOString();
    const lines = [JSON.stringify({ timestamp })];

    json.dati.forEach(st => {
      const nome = st.nome || st.cod;
      const lat = parseFloat(st.lat);
      const lon = parseFloat(st.lon);

      const temp = st.tempcorr !== null ? parseFloat(st.tempcorr) : null;
      const tempHigh = st.tempmax !== null ? parseFloat(st.tempmax) : null;
      const tempLow = st.tempmin !== null ? parseFloat(st.tempmin) : null;

      const hum = st.rhcorr !== null ? parseFloat(st.rhcorr) : null;
      const humHigh = st.rhmax !== null ? parseFloat(st.rhmax) : null;
      const humLow = st.rhmin !== null ? parseFloat(st.rhmin) : null;

      const wind = st.ventocorr !== null ? parseFloat(st.ventocorr) : null;
      const windGust = st.ventomax !== null ? parseFloat(st.ventomax) : null;
      const rainDaily = st.pioggiacum !== null ? parseFloat(st.pioggiacum) : null;
      const rainRate = st.pioggia10min !== null ? parseFloat(st.pioggia10min) : null;

      const obj = {
        S: (temp == null && hum == null && wind == null && rainDaily == null) ? "1" : "0",
        N: nome,
        T: temp, TH: tempHigh, TL: tempLow,
        D: null, DH: null, DL: null,
        H: hum, HH: humHigh, HL: humLow,
        V: wind, G: windGust,
        R: rainDaily, RR: rainRate,
        LAT: lat, LON: lon
      };

      lines.push(JSON.stringify(obj));
    });

    res.setHeader("Content-Type", "application/json");
    res.send(lines.join("\n"));

  } catch (err) {
    console.error("Errore fetch Astrogeo:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Endpoint Meteo3R ---
app.get('/meteo3r.json', async (req, res) => {
  try {
    const url = "https://www.meteo3r.it/dati/mappe/misure.geojson";
    const response = await fetch(url);
    if (!response.ok) throw new Error("HTTP " + response.status);

    const geojson = await response.json();
    if (!geojson.features || !Array.isArray(geojson.features)) {
      return res.status(500).json({ error: "Formato GeoJSON inatteso" });
    }

    const timestamp = new Date().toISOString();
    const lines = [JSON.stringify({ timestamp })];

    geojson.features.forEach(st => {
      const id = st.properties.IDRETE_CODSTAZ;
      if (!id.startsWith("PIE") && !id.startsWith("VDA")) return;

      const lat = parseFloat(st.geometry.coordinates[1]);
      const lon = parseFloat(st.geometry.coordinates[0]);

      const temp = st.properties.T !== "" ? parseFloat(st.properties.T) : null;
      const tempHigh = st.properties.T_MAX !== "" ? parseFloat(st.properties.T_MAX) : null;
      const tempLow = st.properties.T_MIN !== "" ? parseFloat(st.properties.T_MIN) : null;
      const hum = st.properties.U !== "" ? parseFloat(st.properties.U) : null;
      const humHigh = st.properties.U_MAX !== "" ? parseFloat(st.properties.U_MAX) : null;
      const humLow = st.properties.U_MIN !== "" ? parseFloat(st.properties.U_MIN) : null;
      const wind = st.properties.VV !== "" ? parseFloat(st.properties.VV) : null;
      const windGust = st.properties.VV_MAX !== "" ? parseFloat(st.properties.VV_MAX) : null;
      const rainDaily = st.properties.P_24H !== "" ? parseFloat(st.properties.P_24H) : null;
      const rainRate = st.properties.P !== "" ? parseFloat(st.properties.P) : null;

      const obj = {
        S: (temp == null && hum == null && wind == null && rainDaily == null) ? "1" : "0",
        N: st.properties.STAZIONE || id,
        T: temp, TH: tempHigh, TL: tempLow,
        D: null, DH: null, DL: null,
        H: hum, HH: humHigh, HL: humLow,
        V: wind, G: windGust,
        R: rainDaily, RR: rainRate,
        LAT: lat, LON: lon
      };

      lines.push(JSON.stringify(obj));
    });

    res.setHeader("Content-Type", "application/json");
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("Errore fetch Meteo3R:", err);
    res.status(500).json({ error: err.message });
  }
});
app.get('/netatmoLiguria.json', async (req, res) => {
  try {
    const LinkLiguria = [
      // Zona Genova Ovest / Centro
      "https://app.netatmo.net/api/getpublicmeasures?limit=1&divider=7&quality=7&zoom=13&lat_ne=44.402391829093915&lon_ne=8.96484375&lat_sw=44.37098696297173&lon_sw=8.9208984375&date_end=last&access_token=52d42bfc1777599b298b456c%7Cfb7e4663b914d3ae3d36f23c65230494",
      
      // Zona Genova Est / Marassi – Quarto
      "https://app.netatmo.net/api/getpublicmeasures?limit=1&divider=7&quality=7&zoom=14&lat_ne=44.41808794374846&lon_ne=8.98681640625&lat_sw=44.402391829093915&lon_sw=8.96484375&date_end=last&access_token=52d42bfc1777599b298b456c%7Cfb7e4663b914d3ae3d36f23c65230494"
    ];


    const timestamp = new Date().toISOString();
    const lines = [JSON.stringify({ timestamp })];
    const allStations = [];

    // Fetch da tutti i link
    for (const url of LinkLiguria) {
      const response = await fetch(url);
      if (!response.ok) throw new Error("HTTP " + response.status + " su " + url);
      const data = await response.json();
      if (!data.body || !Array.isArray(data.body)) continue;

      data.body.forEach(st => {
        const id = st._id;
        const name = st.place?.street || st.place?.city || id;
        const lat = parseFloat(st.place?.location?.[1]);
        const lon = parseFloat(st.place?.location?.[0]);

        // Ricerca dei sensori
        let temp = null, hum = null, press = null;
        if (st.measures) {
          for (const [moduleId, measure] of Object.entries(st.measures)) {
            const types = measure.type || [];
            const values = Object.values(measure.res || {})[0];
            if (!values) continue;

            types.forEach((t, i) => {
              if (t === "temperature") temp = values[i];
              if (t === "humidity") hum = values[i];
              if (t === "pressure") press = values[i];
            });
          }
        }

        const obj = {
          S: (temp == null && hum == null && press == null) ? "1" : "0",
          N: name,
          T: temp, TH: null, TL: null,
          D: null, DH: null, DL: null,
          H: hum, HH: null, HL: null,
          V: null, G: null,
          R: null, RR: null,
          P: press,
          LAT: lat, LON: lon
        };

        allStations.push(obj);
      });
    }

    // Scrittura come nel tuo formato
    allStations.forEach(st => lines.push(JSON.stringify(st)));

    res.setHeader("Content-Type", "application/json");
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("Errore fetch Netatmo Liguria:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Nuovo endpoint LIMET ---
const stationsLIMET = {
  Molassana: { link: "terzereti", lat: 44.461, lon: 8.987 },
  Fabbriche: { link: "meteo-fabbriche-brusinetti", lat: 44.446, lon: 8.714 },
  Pietralavezzara: { link: "meteo-pietralavezzara", lat: 44.536, lon: 8.883 },
  SantOlcese: { link: "meteo-solcese", lat: 44.483, lon: 8.966 },
  Foce: { link: "meteo-ldoria", lat: 44.401, lon: 8.942 },
  Pontori: { link: "meteo-pontori", lat: 44.367, lon: 9.435 },
  Arenzano: { link: "terzereti", lat: 44.400, lon: 8.687 },
  WTC: { link: "meteo-wtc", lat: 44.408, lon: 8.901 },
  Sampierdarena: { link: "meteo-sampierdarena", lat: 44.416, lon: 8.886 },
  Parazzuolo: { link: "meteo-parazzuolo", lat: 44.478, lon: 9.325 },
  Montoggio: { link: "meteo-montoggio", lat: 44.517, lon: 9.050 },
  SanRocco: { link: "meteo-sanrocco", lat: 44.334, lon: 9.161 },
  SantAlberto: { link: "meteo-salberto", lat: 44.444, lon: 9.103 },
  LagoLame: { link: "meteo-lame", lat: 44.503, lon: 9.408 },
  Rezzoaglio: { link: "meteo-rezzoaglio", lat: 44.525, lon: 9.385 },
  RezzoaglioCerisola: { link: "meteo-rezzoaglio-cerisola", lat: 44.515, lon: 9.408 },
  PuntaChiappa: { link: "meteo-batterie-pchiappa", lat: 44.322, lon: 9.152 },
  Ventarola: { link: "meteo-ventarola", lat: 44.555, lon: 9.305 },
  ICBorzoli: { link: "meteo-borzoli", lat: 44.429, lon: 8.856 },
  SantEusebio: { link: "meteo-eusebio", lat: 44.442, lon: 8.991 },
  Fregarie: { link: "meteo-fregarie-scolombano", lat: 44.380, lon: 9.305 },
  Zoagli: { link: "meteo-zoagli-oliveto", lat: 44.344, lon: 9.275 },
  Moconesi: { link: "meteo-moconesi", lat: 44.424, lon: 9.190 },
  SantaMaria: { link: "meteo-smaria", lat: 44.358, lon: 9.186 },
  Murlo: { link: "meteo-murlo", lat: 44.055, lon: 9.956 },
  Urbe: { link: "meteo-urbe-monta", lat: 44.489, lon: 8.581 },
  UrbeSanPietro: { link: "meteo-urbe", lat: 44.486, lon: 8.587 },
  Tiglieto: { link: "meteo-tiglieto", lat: 44.529, lon: 8.626 },
  Giusvalla: { link: "meteo-giusvalla", lat: 44.448, lon: 8.394 },
  Casanova: { link: "meteo-casanova", lat: 44.375, lon: 8.574 },
  CelleLigure: { link: "meteo-celle", lat: 44.343, lon: 8.545 },
  Oregina: { link: "meteo-oregina", lat: 44.424, lon: 8.927 },
  MarassiFirpo: { link: "meteo-marassi-firpo", lat: 44.415, lon: 8.950 },
  Cornigliano: { link: "meteo-cornigliano", lat: 44.415, lon: 8.873 },
  TramontanaSurfVoltri: { link: "meteo-voltri", lat: 44.427, lon: 8.757 },
  Albisola: { link: "meteo-albisola", lat: 44.326, lon: 8.501 },
  SavonaNautico: { link: "meteo-savona", lat: 44.308, lon: 8.487 },
  Zinola: { link: "meteo-savona-zinola", lat: 44.282, lon: 8.443 },
  Masone: { link: "meteo-masone-vallechiara", lat: 44.503, lon: 8.720 },
  RossiglioneLIMET: { link: "meteo-rossiglione", lat: 44.560, lon: 8.672 },
  LaTerza: { link: "meteo-rifugio-laterza", lat: 44.059, lon: 7.730 },
  Piaggia: { link: "meteo-piaggia", lat: 44.082, lon: 7.749 },
  Bragalla: { link: "meteo-bragalla", lat: 44.446, lon: 9.102 },
  Caucaso: { link: "meteo-caucaso", lat: 44.455, lon: 9.225 },
  Rocca: { link: "meteo-rocca", lat: 44.552, lon: 9.471 },
  Oregin: { link: "meteo-oregina", lat: 44.423, lon: 8.928 },
  MoliniTriora: { link: "meteo-triora", lat: 43.988, lon: 7.774 },
  Imperia: { link: "meteo-imperia", lat: 43.882, lon: 7.999 },
  Andora: { link: "meteo-andora-marina", lat: 43.952, lon: 8.141 },
  Ceriale: { link: "meteo-ceriale", lat: 44.094, lon: 8.234 },
  Borghetto: { link: "meteo-borghetto", lat: 44.113, lon: 8.246 },
  PietraLigure: { link: "terzereti", lat: 44.161, lon: 8.292 },
  VadoLigure: { link: "meteo-vado", lat: 44.266, lon: 8.416 },
};



app.get('/limet.json', async (req, res) => {
  try {
    // Prima riga: timestamp globale
    const timestamp = new Date().toISOString();
    const lines = [JSON.stringify({ timestamp })];

    // Itera sulle stazioni LIMET
    for (const [name, st] of Object.entries(stationsLIMET)) {
      const url = `https://retelimet.centrometeoligure.it/stazioni/${st.link}/data/cu/realtimegauges.txt`;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          // stazione offline
          lines.push(JSON.stringify({ S: "1", N: name }));
          continue;
        }

        const data = await response.json();

        const obj = {
          S: "0",
          N: name,
          T: parseFloat(data.temp.replace(",", ".")),
          TL: parseFloat(data.tempTL.replace(",", ".")),
          TH: parseFloat(data.tempTH.replace(",", ".")),
          D: parseFloat(data.dew.replace(",", ".")),
          H: parseFloat(data.hum),
          V: parseFloat(data.wspeed.replace(",", ".")),
          G: parseFloat(data.wgust.replace(",", ".")),
          R: parseFloat(data.rfall.replace(",", ".")),
          RR: parseFloat(data.rrate.replace(",", ".")),
          LAT: st.lat,
          LON: st.lon
          // NOTA: non mettiamo 'time' qui
        };

        lines.push(JSON.stringify(obj));
      } catch (err) {
        lines.push(JSON.stringify({ S: "1", N: name }));
      }
    }

    res.setHeader("Content-Type", "application/json");
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("Errore fetch LIMET:", err);
    res.status(500).json({ error: err.message });
  }
});
 
app.get('/limet/:id.json', async (req, res) => {
  try {
    const id = req.params.id;
    const st = stationsLIMET[id];

    if (!st) {
      return res.status(404).json({ error: `Stazione ${id} non trovata` });
    }

    const timestamp = new Date().toISOString();
    const url = `https://retelimet.centrometeoligure.it/stazioni/${st.link}/data/cu/realtimegauges.txt`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        return res.send(JSON.stringify({ S: "1", N: id }));
      }

      const data = await response.json();
      const obj = {
        S: "0",
        N: id,
        T: parseFloat(data.temp.replace(",", ".")),
        TL: parseFloat(data.tempTL.replace(",", ".")),
        TH: parseFloat(data.tempTH.replace(",", ".")),
        D: parseFloat(data.dew.replace(",", ".")),
        DH: parseFloat(data.dewpointTH.replace(",", ".")),
        DL: parseFloat(data.dewpointTL.replace(",", ".")),
        H: parseFloat(data.hum),
        HH: parseFloat(data.humTH),
        HL: parseFloat(data.humTL),
        P: parseFloat(data.press.replace(",", ".")),
        PH: parseFloat(data.pressTH.replace(",", ".")),
        PL: parseFloat(data.pressTL.replace(",", ".")),
        V: parseFloat(data.wspeed.replace(",", ".")),
        VH: parseFloat(data.wgustTM.replace(",", ".")),
        G: parseFloat(data.wgust.replace(",", ".")),
        R: parseFloat(data.rfall.replace(",", ".")),
        RR: parseFloat(data.rrate.replace(",", ".")),
        HI: parseFloat(data.heatindex.replace(",", ".")),
        HIH: parseFloat(data.heatindexTH.replace(",", ".")),
        UV: parseFloat(data.UV),
        UVH: parseFloat(data.UVTH),
        LAT: st.lat,
        LON: st.lon
      };

      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify({ timestamp, ...obj }));

    } catch (err) {
      res.send(JSON.stringify({ S: "1", N: id }));
    }

  } catch (err) {
    console.error("Errore fetch LIMET singola stazione:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- Nuovo endpoint DMA ---
const stationsDMA = {
  Capriglio: { lat: 45.013, lon: 8.023, link: "capriglio" },
  AlluvioniCambio: { lat: 44.989, lon: 8.769, link: "alluvioni-cambio" },
  Castelceriolo: { lat: 44.915, lon: 8.686, link: "castelceriolo" },
  PietraMarazziReale: { lat: 44.958, lon: 8.660, link: "pietra-marazzi-reale" },
  PietraMarazzi: { lat: 44.949, lon: 8.668, link: "pietra-marazzi-bricchi" },
  Frascaro: { lat: 44.825, lon: 8.534, link: "B8:D8:12:66:BC:65" },
  Solero: { lat: 44.915, lon: 8.508, link: "solero" },
  CuccaroMonferrato: { lat: 44.962, lon: 8.461, link: "B8:D8:12:66:CE:39" },
  NoviLigureCaseSparse: { lat: 44.777, lon: 8.745, link: "novi-ligure" },
  NoviLigure: { lat: 44.765, lon: 8.801, link: "B8:27:EB:5A:83:8E" },
  NoviLigureConsorzioGavi: { lat: 44.741, lon: 8.810, link: "B8:D8:12:66:CE:A1" },
  NoviLigureLaBattistina: { lat: 44.722, lon: 8.797, link: "94:A4:08:E8:D1:01" },
  GaviMonterotondo: { lat: 44.697, lon: 8.809, link: "B8:D8:12:66:BD:95" },
  GaviRovereto: { lat: 44.709, lon: 8.781, link: "B8:D8:12:60:57:94" },
  GaviRoveretoConsorzio: { lat: 44.710, lon: 8.766, link: "B8:D8:12:66:CF:25" },
  CapriataOrba: { lat: 44.712, lon: 8.734, link: "B8:D8:12:66:CE:CD" },
  Zerbetta: { lat: 44.672, lon: 8.794, link: "B8:D8:12:66:C5:CD" },
  VoltaggioMolini: { lat: 44.583, lon: 8.869, link: "B8:D8:12:66:C6:E1" },
  Fraconalto: { lat: 44.576, lon: 8.878, link: "fraconalto" },
  Lerma: { lat: 44.632, lon: 8.699, link: "lerma" },
  Ovada: { lat: 44.631, lon: 8.641, link: "ovada" },
  Molare: { lat: 44.619, lon: 8.609, link: "ovada-coinova" },
  Grognardo: { lat: 44.630, lon: 8.486, link: "C4:93:00:1E:51:FF" },
  AcquiTerme: { lat: 44.682, lon: 8.449, link: "acqui-terme" },
  AcquiTermeBoschi: { lat: 44.704, lon: 8.425, link: "94:A4:08:E8:C9:75" },
  AliceBelColle: { lat: 44.725, lon: 8.451, link: "alice-bel-colle" },
  CastelBoglione: { lat: 44.717, lon: 8.376, link: "C4:93:00:10:12:67" },
  BriccoAlfieri: { lat: 44.728, lon: 8.385, link: "94:A4:08:E8:BC:CD" },
  FontanileCasello: { lat: 44.739, lon: 8.400, link: "B8:D8:12:66:BD:21" },
  MombaruzzoCasalotto: { lat: 44.762, lon: 8.415, link: "E8:DB:84:99:E6:72" },
  IncisaSpacaccino: { lat: 44.782, lon: 8.378, link: "incisa-scapaccino" },
  CastelnuovoBelbo: { lat: 44.804, lon: 8.414, link: "B8:D8:12:60:58:BF" },
  RoccaveranoMoretti: { lat: 44.624, lon: 8.307, link: "94:A4:08:E8:D0:39" },
  Sessame: { lat: 44.657, lon: 8.326, link: "C4:5B:BE:6E:87:7E" },
  Regnassini: { lat: 44.666, lon: 8.322, link: "B8:D8:12:66:C5:95" },
  Cassinasco: { lat: 44.688, lon: 8.319, link: "cassinasco" },
  Bubbio: { lat: 44.669, lon: 8.281, link: "bubbio" },
  SantaLibera: { lat: 44.688, lon: 8.236, link: "B8:D8:12:66:CE:E5" },
  CanelliBassano: { lat: 44.719, lon: 8.258, link: "B8:D8:12:60:59:73" },
  CastiglioneTinella: { lat: 44.721, lon: 8.191, link: "C4:93:00:10:21:D0" },
  AviosuperficieBoglietto: { lat: 44.756, lon: 8.185, link: "costigliole-d-asti" },
  Bionzo: { lat: 44.758, lon: 8.212, link: "B8:D8:12:60:59:C9" },
  Salera: { lat: 44.775, lon: 8.139, link: "B8:D8:12:66:BE:1D" },
  AstiSanMarzanotto: { lat: 44.863, lon: 8.214, link: "94:A4:08:E8:B0:79" },
  MontaldoSanCarlo: { lat: 44.851, lon: 8.293, link: "B8:D8:12:60:58:BD" },
  MontaldoScarampi: { lat: 44.821, lon: 8.249, link: "C4:93:00:10:1C:54" },
  Mombercelli: { lat: 44.816, lon: 8.295, link: "B8:D8:12:66:CF:89" },
  CastelnuovoCalcea: { lat: 44.785, lon: 8.287, link: "castelnuovo-calcea" },
  SanMarzano: { lat: 44.774, lon: 8.300, link: "B8:D8:12:66:B7:ED" },
  NizzaMonferrato: { lat: 44.771, lon: 8.306, link: "B8:D8:12:60:58:8A" },
  Perletto: { lat: 44.609, lon: 8.199, link: "94:A4:08:E8:B4:71" },
  Castino: { lat: 44.623, lon: 8.156, link: "castino" },
  MonesiglioBoschetto: { lat: 44.451, lon: 8.131, link: "94:A4:08:E8:AF:AD" },
  SanBenedettoBelbo: { lat: 44.495, lon: 8.071, link: "BC:FF:4D:0F:FE:94" },
  Ceva: { lat: 44.386, lon: 8.030, link: "ceva" },
  TettoCaban: { lat: 44.285, lon: 7.656, link: "chiusa-di-pesio" },
  Mondovi: { lat: 44.368, lon: 7.803, link: "mondovi" },
  MondoviSanGiacomo: { lat: 44.410, lon: 7.807, link: "mondovi-san-giacomo-delle-passere" },
  Dogliani: { lat: 44.511, lon: 7.962, link: "B8:D8:12:66:BD:3D" },
  Roddino: { lat: 44.544, lon: 7.996, link: "B8:D8:12:60:59:24" },
  Badarina: { lat: 44.594, lon: 8.004, link: "B8:D8:12:66:C6:4D" },
  Serralunga: { lat: 44.607, lon: 8.000, link: "B8:D8:12:60:5A:3C" },
  Perno: { lat: 44.606, lon: 7.980, link: "94:A4:08:E8:B0:45" },
  Novello: { lat: 44.600, lon: 7.933, link: "B8:D8:12:66:CF:61" },
  Barolo: { lat: 44.619, lon: 7.942, link: "C4:93:00:10:1B:76" },
  CastiglioneFalletto: { lat: 44.623, lon: 7.978, link: "B8:D8:12:60:58:FA" },
  LaMorra: { lat: 44.630, lon: 7.916, link: "B8:D8:12:66:CE:1D" },
  Cherasco: { lat: 44.638, lon: 7.900, link: "B8:D8:12:60:59:CE" },
  LaMorraAnnunziata: { lat: 44.638, lon: 7.953, link: "B8:D8:12:60:5A:76" },
  LaMorraSantaMaria: { lat: 44.652, lon: 7.944, link: "B8:D8:12:60:59:32" },
  Ravinali: { lat: 44.665, lon: 7.963, link: "C4:93:00:10:1C:4B" },
  Roddi: { lat: 44.678, lon: 7.972, link: "94:A4:08:E8:C0:B5" },
  RoddiFontanassa: { lat: 44.681, lon: 7.970, link: "B8:D8:12:60:5A:E1" },
  DianoDAlba: { lat: 44.652, lon: 8.027, link: "94:A4:08:E8:CF:79" },
  DianoCascinaVoghera: { lat: 44.638, lon: 8.031, link: "diano-cascina-voghera" },
  DianoBerfi: { lat: 44.635, lon: 8.023, link: "diano-borgata-berfi" },
  RodelloCagnassi: { lat: 44.628, lon: 8.072, link: "B8:D8:12:60:58:0E" },
  MadonnaDiComo: { lat: 44.678, lon: 8.064, link: "B8:D8:12:60:58:67" },
  AlbaRombone: { lat: 44.699, lon: 8.063, link: "treiso-rombone" },
  AlbaMussotto: { lat: 44.713, lon: 8.018, link: "B8:D8:12:60:5A:86" },
  Guarene: { lat: 44.738, lon: 8.033, link: "B8:D8:12:60:5A:12" },
  Castellinaldo: { lat: 44.772, lon: 8.036, link: "98:CD:AC:32:3D:9D" },
  Canale: { lat: 44.791, lon: .974, link: "94:A4:08:E8:B0:91" },
  MonteuRoero: { lat: 44.784, lon: 7.909, link: "94:A4:08:E8:B4:2D" },
  SanMartinoAlfieri: { lat: 44.816, lon: 8.109, link: "B8:D8:12:60:59:90" },
  AstiSanGiacomo: { lat: 44.867, lon: 8.068, link: "san-damiano-san-giacomo" },
  Bramairate: { lat: 44.816, lon: 8.109, link: "asti-bramairate" },
  AstiVallarone: { lat: 44.890, lon: 8.174, link: "B8:D8:12:60:59:95" },
  AstiNord: { lat: 44.915, lon: 8.197, link: "B8:D8:12:66:BD:69" },
  Valmanera: { lat: 44.940, lon: 8.188, link: "asti-valmanera" },
  Montemagno: { lat: 44.964, lon: 8.329, link: "B8:D8:12:66:BD:E1" },
  Portacomaro: { lat: 44.972, lon: 8.270, link: "B8:D8:12:60:5B:80" },
  CallianoMonferrato: { lat: 45.003, lon: 8.224, link: "BC:FF:4D:11:39:A3" },
  GrazzanoBadoglio: { lat: 45.046, lon: 8.300, link: "B8:D8:12:60:57:8B" },
  Moleto: { lat: 45.049, lon: 8.368, link: "B8:D8:12:60:59:FB" },
  Treville: { lat: 45.105, lon: 8.346, link: "94:A4:08:E8:B1:01" },
  CasaleAeroporto: { lat: 45.115, lon: 8.454, link: "60:E3:27:B6:77:6A" },
  CasaleMonferrato: { lat: 45.138, lon: 8.461, link: "casale-monferrato" },
  Camino: { lat: 5.167, lon: 8.289, link: "E8:DB:84:9A:07:B8" },
  Fabiano: { lat: 45.136, lon: 8.288, link: "B8:D8:12:66:BC:E5" },
  Solonghello: { lat: 45.128, lon: 8.283, link: "solonghello" },
  SettimeMeridiana: { lat: 44.965, lon: 8.129, link: "settime" },
  Settime: { lat: 44.963, lon: 8.113, link: "B8:D8:12:60:58:BB" },
  Castellero: { lat: 44.928, lon: 8.067, link: "castellero" },
  VillafrancaDAsti: { lat: 44.920, lon: 8.018, link: "villafranca-d-asti" },
  DusinoSanMichele: { lat: 44.921, lon: 7.976, link: "dusino-san-michele" },
  VillanovaDAsti: { lat: 44.944, lon: 7.938, link: "villanova-d-asti" },
  PiovaMassaia: { lat: 45.054, lon: 8.049, link: "DC:A6:32:F5:B1:89" },
  Montiglio: { lat: 45.061, lon: 8.100, link: "B8:D8:12:60:58:A5" },
  Corteranzo: { lat: 45.102, lon: 8.117, link: "B8:D8:12:66:BD:15" },
  Villamiroglio: { lat: 45.135, lon: 8.129, link: "villamiroglio" },
  Moransengo: { lat: 45.115, lon: 8.040, link: "B8:D8:12:60:58:BE" },
  Gonegno: { lat: 45.110, lon: 7.975, link: "B8:D8:12:60:57:6A" },
  Rivalba: { lat: 45.119, lon: 7.888, link: "B8:D8:12:60:40:BC" },
  CastagnetoPo: { lat: 45.159, lon: 7.889, link: "castagneto-po" },
  PinoTorinese: { lat: 45.049, lon: 7.795, link: "pino-torinese" },
  PecettoTorinese: { lat: 45.022, lon: 7.754, link: "pecetto-torinese" },
  Carignano: { lat: 44.992, lon: 7.674, link: "carignano" },
  Moncalieri: { lat: 44.996, lon: 7.654, link: "nichelino" },
  TorinoSanDonato: { lat: 45.087, lon: 7.650, link: "torino-san-donato" },
  Dronero: { lat: 44.483, lon: 7.383, link: "villar-san-costanzo" },
  Revello: { lat: 44.647, lon: 7.389, link: "B8:D8:12:66:BD:A1" },
  Argentera: { lat: 44.377, lon: 6.970, link: "argentera" },
  Prazzo: { lat: 44.521, lon: 7.060, link: "B8:D8:12:66:CE:3D" },
  Rucas: { lat: 44.753, lon: 7.207, link: "98:DA:C4:28:5E:6A" },
  VillarPellice: { lat: 44.807, lon: 7.143, link: "C4:93:00:09:76:8B" },
  TorrePellice: { lat: 44.819, lon: 7.214, link: "F4:F2:6D:6C:BC:70" },
  Rora: { lat: 44.779, lon: 7.196, link: "rora" },
  Angrogna: { lat: 44.842, lon: 7.237, link: "94:A4:08:E8:B6:59" },
  SanSecondo: { lat: 44.848, lon: 7.300, link: "C4:93:00:09:A2:68" },
  CostaMonteOliveto: { lat: 44.902, lon: 7.340, link: "34:60:F9:6E:38:12" },
  Pinerolo: { lat: 44.900, lon: 7.366, link: "C4:93:00:09:73:DF" },
  Piscina: { lat: 44.918, lon: 7.421, link: "piscina" },
  Bruino: { lat: 45.021, lon: 7.472, link: "bruino" },
  VillarPerosa: { lat: 44.917, lon: 7.247, link: "villar-perosa" },
  PerosaArgentina: { lat: 44.955, lon: 7.192, link: "C4:93:00:1E:58:CE" },
  Pomaretto: { lat: 44.954, lon: 7.182, link: "pomaretto" },
  Villaretto: { lat: 45.015, lon: 7.115, link: "C4:93:00:10:23:05" },
  OulxVazon: { lat: 45.016, lon: 6.813, link: "oulx-vazon" },
  Susa: { lat: 45.144, lon: 7.049, link: "mompantero" },
  RioReforno: { lat: 45.168, lon: 7.149, link: "bussoleno-rio-reforno" },
  AlpeCombe: { lat: 45.180, lon: 7.165, link: "chianocco-alpe-combe" },
  Chianocco: { lat: 45.149, lon: 7.170, link: "chianocco" },
  Usseglio: { lat: 45.233, lon: 7.218, link: "usseglio" },
  SacraSanMichele: { lat: 45.097, lon: 7.343, link: "sant-ambrogio" },
  Viu: { lat: 45.236, lon: 7.372, link: "viu" },
  Polpresa: { lat: 45.246, lon: 7.362, link: "viu-polpresa" },
  Nole: { lat: 45.240, lon: 7.567, link: "98:DA:C4:84:B6:60" },
  Ceretti: { lat: 45.273, lon: 7.630, link: "front" },
  RivaroloCanavese: { lat: 45.288, lon: 7.703, link: "oglianico-sfb" },
  Cantoira: { lat: 45.342, lon: 7.381, link: "cantoria" },
  FornoAlpi: { lat: 45.364, lon: 7.224, link: "groscavallo" },
  Ceresole: { lat: 45.430, lon: 7.247, link: "ceresole-reale" },
  Alpette: { lat: 45.408, lon: 7.578, link: "alpette" },
  Parella: { lat: 45.430, lon: 7.795, link: "parella" },
  Roppolo: { lat: 45.419, lon: 8.060, link: "roppolo" },
  Chiaverano: { lat: 45.503, lon: 7.892, link: "chiaverano-montresco" },
  SettimoVittone: { lat: 45.547, lon: 7.830, link: "settimo-vittone" },
  Trovinasse: { lat: 45.576, lon: 7.855, link: "settimo-vittone-trovinasse" },
  Muzzano: { lat: 45.560, lon: 7.989, link: "74:DA:88:D7:B2:37" },
  OcchieppoSuperiore: { lat: 45.562, lon: 8.008, link: "occhieppo-superiore" },
  Ponderano: { lat: 45.536, lon: 8.052, link: "ponderano" },
  Candelo: { lat: 45.542, lon: 8.103, link: "candelo" },
  Curino: { lat: 45.641, lon: 8.243, link: "curino" },
  AlpeDiMera: { lat: 45.746, lon: 8.049, link: "scopello-alpe-di-mera" },
  Scopa: { lat: 45.796, lon: 8.116, link: "scopa-muro-valsesia" },
  Alagna: { lat: 45.836, lon: 7.950, link: "94:A4:08:E8:B7:C1" },
  Macugnaga: { lat: 45.966, lon: 7.923, link: "macugnaga-ghiacciaio-belvedere" },
  Acquamorta: { lat: 46.144, lon: 8.196, link: "bognanco-acquamorta" },
  Devero: { lat: 46.333, lon: 8.284, link: "alpe-devero" },
  Domodossola: { lat: 46.108, lon: 8.290, link: "domodossola-monte-calvario" },
  Cannobio: { lat: 46.064, lon: 8.699, link: "cannobio" },
  Ornavasso: { lat: 45.970, lon: 8.413, link: "ornavasso" },
  GravellonaToce: { lat: 45.921, lon: 8.435, link: "gravellona-toce" },
  Baveno: { lat: 45.906, lon: 8.506, link: "baveno" },
  Belgirate: { lat: 45.838, lon: 8.571, link: "belgirate" },
  SanGiacomoVercellese: { lat: 45.499, lon: 8.332, link: "san-giacomo-vercellese" },
  Cameri: { lat: 45.512, lon: 8.644, link: "cameri" },
  Novara: { lat: 45.433, lon: 8.612, link: "novara" },
};

app.get('/datimeteoasti.json', async (req, res) => {
  try {
    const timestamp = new Date().toISOString();
    const lines = [JSON.stringify({ timestamp })];

    for (const stName in stationsDMA) {
      const station = stationsDMA[stName];
      const url = `https://maps.datimeteoasti.it/api/stationDataTrend/${station.link}`;

      const response = await fetch(url);
      if (!response.ok) {
        lines.push(JSON.stringify({ S: "1", N: stName }));
        continue;
      }

      const data = await response.json();
      const s = data.series || {};

      // Prende l'ultimo valore disponibile da ciascuna serie
      const getLastValue = (arr) =>
        Array.isArray(arr) && arr.length
          ? parseFloat(arr[arr.length - 1].value)
          : null;

      const getLastTimestamp = (arr) =>
        Array.isArray(arr) && arr.length
          ? arr[arr.length - 1].timestamp
          : null;

      const latestTemp = getLastValue(s.temperature);
      const latestHum = getLastValue(s.humidity);
      const latestDew = getLastValue(s.dew_point);
      const latestPres = getLastValue(s.pressure);
      const latestWind = getLastValue(s.wind_speed);
      const latestGust = getLastValue(s.wind_gust);
      const latestRain = getLastValue(s.rain_today);
      const latestRate = getLastValue(s.rain_rate);

      // Timestamp più recente disponibile
      const lastTime =
        getLastTimestamp(s.temperature) ||
        getLastTimestamp(s.humidity) ||
        getLastTimestamp(s.pressure) ||
        timestamp;

      // Formattazione con 1 decimale obbligatorio se .0
      const fmt = (val) =>
        val == null || isNaN(val)
          ? null
          : (val % 1 === 0 ? val.toFixed(1) : val);

      const obj = {
        S: "0",
        N: stName,
        T: fmt(latestTemp),
        H: fmt(latestHum),
        D: fmt(latestDew),
        P: fmt(latestPres),
        V: fmt(latestWind),
        G: fmt(latestGust),
        R: fmt(latestRain),
        RR: fmt(latestRate),
        LAT: stationsDMA[stName].lat,
        LON: stationsDMA[stName].lon,
      };

      lines.push(JSON.stringify(obj));
    }

    res.setHeader("Content-Type", "application/json");
    res.send(lines.join("\n"));
  } catch (err) {
    console.error("Errore fetch DMA:", err);
    res.status(500).json({ error: err.message });
  }
});






// --- Avvio server ---
app.listen(port, () => console.log(`Server in ascolto su http://localhost:${port}`));
