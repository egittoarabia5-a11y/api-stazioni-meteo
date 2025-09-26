async function fetchData() {
  try {
    const response = await fetch('/update.json'); 
    const data = await response.json();
    document.getElementById('output').textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    console.error('Errore fetch:', err);
  }
}

fetchData();
