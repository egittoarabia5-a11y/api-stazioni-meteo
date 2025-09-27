import cors from "cors";
import express from 'express';
import fetch from 'node-fetch';

const app = express();
const port = 3111;

app.use(cors());

// --- Funzione comune per convertire coordinate fittizie in reali ---
function fittizioAReale(xFittizio, yFittizio) {
  const lon = ((8260 + xFittizio / 1.18) / 1000).toFixed(3);
  const lat = ((46730 - yFittizio / 1.72) / 1000).toFixed(3);
  return { lat, lon };
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
// --- Endpoint Meteo3R ---
app.get('/meteo3r.json', async (req, res) => {
  try {
    const url = "https://api.allorigins.win/raw?url=" + 
    encodeURIComponent("https://www.meteo3r.it/dati/mappe/misure.geojson");
  

    const response = await fetch(url);
    if (!response.ok) throw new Error("HTTP " + response.status);

    const geojson = await response.json();

    if (!geojson.features || !Array.isArray(geojson.features)) {
      return res.status(500).json({ error: "Formato GeoJSON inatteso" });
    }

    const timestamp = new Date().toISOString();
    const lines = [JSON.stringify({ timestamp })]; // prima riga: timestamp

    geojson.features.forEach(st => {
      const id = st.properties.IDRETE_CODSTAZ;
      if (!id.startsWith("PIE") && !id.startsWith("VDA")) return;

      const lat = parseFloat(st.geometry.coordinates[1]);
      const lon = parseFloat(st.geometry.coordinates[0]);

      // parsing sicuro dei valori
      const temp = st.properties.T !== "" ? parseFloat(st.properties.T) : null;
      const tempHigh = st.properties.T_MAX !== "" ? parseFloat(st.properties.T_MAX) : null;
      const tempLow = st.properties.T_MIN !== "" ? parseFloat(st.properties.T_MIN) : null;

      const hum = st.properties.U !== "" ? parseFloat(st.properties.U) : null;
      const humHigh = st.properties.U_MAX !== "" ? parseFloat(st.properties.U_MAX) : null;
      const humLow = st.properties.U_MIN !== "" ? parseFloat(st.properties.U_MIN) : null;

      const wind = st.properties.VV !== "" ? parseFloat(st.properties.VV) : null;
      const windGust = st.properties.VV_MAX !== "" ? parseFloat(st.properties.VV_MAX) : null;
      const windDir = st.properties.DD !== "" ? parseFloat(st.properties.DD) : null;

      const rainDaily = st.properties.P_24H !== "" ? parseFloat(st.properties.P_24H) : null;
      const rainRate = st.properties.P !== "" ? parseFloat(st.properties.P) : null;

      const obj = {
        S: (temp == null && hum == null && wind == null && rainDaily == null) ? "1" : "0",
        N: st.properties.STAZIONE || id,
        T: temp, TH: tempHigh, TL: tempLow,
        D: null, DH: null, DL: null,
        H: hum, HH: humHigh, HL: humLow,
        V: wind, G: windGust, R: rainDaily, RR: rainRate,
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


// --- Serve HTML ---
app.use(express.static('public'));

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
