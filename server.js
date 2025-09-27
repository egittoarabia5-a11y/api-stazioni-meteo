import cors from "cors";
import express from "express";
import fetch from "node-fetch";

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

// --- Nuovo endpoint LIMET ---
const stationsLIMET = {
  Molassana: {
    link: "terzereti",
    lat: 44.461,
    lon: 8.987
  },
  Fabbriche: {
    link: "meteo-fabbriche-brusinetti",
    lat: 44.446,
    lon: 8.714
  },
  Pietralavezzara: {
    link: "meteo-pietralavezzara",
    lat: 44.536,
    lon: 8.883
  },
  SantOlcese: {
    link: "meteo-solcese",
    lat: 44.483,
    lon: 8.966
  },
  Foce: {
    link: "meteo-ldoria",
    lat: 44.401,
    lon: 8.942
  },
  Pontori: {
    link: "meteo-pontori",
    lat: 44.367,
    lon: 9.435
  },
  Arenzano: {
    link: "terzereti",
    lat: 44.400,
    lon: 8.687
  },
  WTC: {
    link: "meteo-wtc",
    lat: 44.408,
    lon: 8.901
  },
  Sampierdarena: {
    link: "meteo-sampierdarena",
    lat: 44.416,
    lon: 8.886
  },
  Parazzuolo: {
    link: "meteo-parazzuolo",
    lat: 44.478,
    lon: 9.325
  },
  Montoggio: {
    link: "meteo-montoggio",
    lat: 44.517,
    lon: 9.050
  },
  SanRocco: {
    link: "meteo-sanrocco",
    lat: 44.334,
    lon: 9.161
  },
  SantAlberto: {
    link: "meteo-salberto",
    lat: 44.444,
    lon: 9.103
  },
  LagoLame: {
    link: "meteo-lame",
    lat: 44.503,
    lon: 9.408
  },
  Rezzoaglio: {
    link: "meteo-rezzoaglio",
    lat: 44.525,
    lon: 9.385
  },
  RezzoaglioCerisola: {
    link: "meteo-rezzoaglio-cerisola",
    lat: 44.515,
    lon: 9.408
  },
  PuntaChiappa: {
    link: "meteo-batterie-pchiappa",
    lat: 44.322,
    lon: 9.152
  },
  Ventarola: {
    link: "meteo-ventarola",
    lat: 44.555,
    lon: 9.305
  },
  ICBorzoli: {
    link: "meteo-borzoli",
    lat: 44.429,
    lon: 8.856
  },
  SantEusebio: {
    link: "meteo-eusebio",
    lat: 44.442,
    lon: 8.991
  },
  Fregarie: {
    link: "meteo-fregarie-scolombano",
    lat: 44.380,
    lon: 9.305
  },
  Zoagli: {
    link: "meteo-zoagli-oliveto",
    lat: 44.344,
    lon: 9.275
  },
  Moconesi: {
    link: "meteo-moconesi",
    lat: 44.424,
    lon: 9.190
  },
  SantaMaria: {
    link: "meteo-smaria",
    lat: 44.358,
    lon: 9.186
  },
  Murlo: {
    link: "meteo-murlo",
    lat: 44.055,
    lon: 9.956
  },
  Urbe: {
    link: "meteo-urbe-monta",
    lat: 44.489,
    lon: 8.581
  },
  UrbeSanPietro: {
    link: "meteo-urbe",
    lat: 44.486,
    lon: 8.587
  },
  Tiglieto: {
    link: "meteo-tiglieto",
    lat: 44.529,
    lon: 8.626
  },
  Giusvalla: {
    link: "meteo-giusvalla",
    lat: 44.448,
    lon: 8.394
  },
  Casanova: {
    link: "meteo-casanova",
    lat: 44.375,
    lon: 8.574
  },
  CelleLigure: {
    link: "meteo-celle",
    lat: 44.343,
    lon: 8.545
  },
  Oregina: {
    link: "meteo-oregina",
    lat: 44.424,
    lon: 8.927
  },
  MarassiFirpo: {
    link: "meteo-marassi-firpo",
    lat: 44.415,
    lon: 8.950
  },
  Cornigliano: {
    link: "meteo-cornigliano",
    lat: 44.415,
    lon: 8.873
  },
  TramontanaSurfVoltri: {
    link: "meteo-voltri",
    lat: 44.427,
    lon: 8.757
  },
  Albisola: {
    link: "meteo-albisola",
    lat: 44.326,
    lon: 8.501
  },
  SavonaNautico: {
    link: "meteo-savona",
    lat: 44.308,
    lon: 8.487
  },
  Zinola: {
    link: "meteo-savona-zinola",
    lat: 44.282,
    lon: 8.443
  },
  Masone: {
    link: "meteo-masone-vallechiara",
    lat: 44.503,
    lon: 8.720
  },
  RossiglioneLIMET: {
    link: "meteo-rossiglione",
    lat: 44.560,
    lon: 8.672
  },
  LaTerza: {
    link: "meteo-rifugio-laterza",
    lat: 44.059,
    lon: 7.730
  },
  Piaggia: {
    link: "meteo-piaggia",
    lat: 44.082,
    lon: 7.749
  },
  Bragalla: {
    link: "meteo-bragalla",
    lat: 44.446,
    lon: 9.102
  },
  Caucaso: {
    link: "meteo-caucaso",
    lat: 44.455,
    lon: 9.225
  },
  Rocca: {
    link: "meteo-rocca",
    lat: 44.552,
    lon: 9.471
  },
  Oregin: {
    link: "meteo-oregina",
    lat: 44.423,
    lon: 8.928
  }
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

// --- Avvio server ---
app.listen(port, () => console.log(`Server in ascolto su http://localhost:${port}`));
