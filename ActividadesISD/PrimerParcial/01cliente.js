// con GET ruta: /api/talleres

const API_URL = "https://proyectobackcecyt9.onrender.com";

async function main() {
    console.log("Iniciando cliente petición GET -> a ${API_URL}/api/talleres");
    const inicio = Date.now();
    const response = await fetch(`${API_URL}/api/talleres`);

    const duracionMs = Date.now() - inicio;
    const cuerpo = await response.json();

    console.log("Ciclo de petición - respuesta");
    console.log("Protocolo HTTPS sobre TCP : ${response.url}");
    console.log("Status de recibido : ${response.status} ${response.statusText}");
    console.log("Tiempo de ida y vuelta (RTT): ${duracionMs} ms");
    console.log(JSON.stringify(cuerpo, null, 2));
}

main();