<div align="center">

# POLYARENA

**Shooter FPS multijugador web de estética Low Poly ultra-ligero**  
*Arquitectura cliente/servidor autoritativa en un solo puerto (`8080`), lista para Docker.*

[![Node.js](https://img.shields.io/badge/Node.js-22_LTS-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Three.js](https://img.shields.io/badge/Three.js-Low_Poly-000000?style=for-the-badge&logo=threedotjs&logoColor=white)](https://threejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

</div>

---

## Características Principales

- **Ultra-Ligero (`< 40` Draw Calls) y Audio 0 KB:** Geometría 100% procedural con `THREE.InstancedMesh`, iluminación ligera y efectos sonoros sintetizados en tiempo real mediante **Web Audio API**.
- **Gunplay Basado en Habilidad:** Cero dispersión aleatoria injusta (*RNG bloom*). Las 6 armas tienen patrones de retroceso deterministas y apuntado (`ADS`) con clic derecho:
  1. **Vanguard AR** *(Rifle de Asalto)*
  2. **Vector-9 SMG** *(Subfusil rápido)*
  3. **Breacher SG** *(Escopeta táctica de 8 perdigones geométricos fijos)*
  4. **Magnum-6** *(Revólver pesado letal a la cabeza)*
  5. **Apex SR** *(Francotirador con mira telescópica `28°`)*
  6. **Shadow Kunai** *(Proyectil balístico silencioso letal a la cabeza)*
- **4 Clases Únicas (1 Pasiva + 2 Activas `E`/`Q`):**
  - **Fantasma** *(100 HP · 100% Vel.)* — Mira ADS `+35%` rápida, sigilo agachado | `E` Camuflaje Óptico | `Q` Pulso Recon (`30 m`)
  - **Asalto Ligero** *(100 HP · 108% Vel.)* — `+10%` cadencia/recarga | `E` Dash direccional | `Q` Sobrecarga Stim (`+40 HP`)
  - **Ninja** *(100 HP · 120% Vel.)* — Silencioso, doble salto aéreo, `+25%` Kunai | `E` Paso Sombrío (`10 m`) | `Q` Bomba de Humo
  - **Vanguardia** *(125 HP · 94% Vel.)* — `-20%` retroceso | `E` Granada de Impulso | `Q` Muro Táctico (`250 HP` / `12 s`)
- **Mapa Modular Cohesivo y Dinámico (`32 m` por sector):**
  - Evolución por fases (**Campo Abierto → Suburbio con casas → Ciudad con edificios enterables de 4–5 pisos, interiores, ventanas, escaleras y azoteas**).
  - Regla estricta de **8 vecinos** (Ciudad nunca colinda con Campo Abierto).
  - Advertencia visual de cuadrante completo (`10 s`) con pilares de luz, siluetas holográficas y alerta sonora antes de emerger suavemente (`4 s`) empujando hacia arriba sin atrapar jugadores.
- **6 Modos de Juego en Lobby Único Escalable:** **TDM**, **FFA**, **Buscar y Destruir (S&D)**, **Punto Caliente (Hardpoint)**, **Dominación (A/B/C)** y **Juego de Armas (Gun Game)**, con escalado automático de anillos (`3×3` / `5×5` / `7×7`), reparto 50/50 y votación rápida de `10 s` si hay número impar.
- **Rachas de Bajas (`X`):** `3` bajas (**Radar Táctico**), `5` bajas (**Sobrecarga Total**), `7` bajas (**Pulso PEM**).
- **Modo `Idle Sleep` (0% CPU en vacío):** Al quedar 0 jugadores conectados, detiene los bucles de simulación y congela los temporizadores hasta que entra el siguiente jugador.
- **Panel de Administración (`ESC → Panel Admin`):** Contraseña maestra (`ADMIN_PASSWORD`), llaves temporales delegables y revocables, control de modos/rondas/sectores (`1x` / `2x` / `4x`) y modificadores en vivo (*velocidad, tamaño gigante/mini, gravedad, salto, munición infinita*).

---

## Controles

| Acción | Tecla / Botón |
| :--- | :--- |
| Moverse | `W` `A` `S` `D` |
| Correr (Sprint) | `Shift` |
| Saltar / Doble Salto (Ninja) | `Space` |
| Deslizarse (Slide) / Agacharse | `C` o `Ctrl` |
| Disparar / Apuntar (ADS) | `Click Izq.` / `Click Der.` |
| Recargar / Interactuar (S&D) | `R` / `F` |
| Habilidades de Clase | `E` / `Q` |
| Activar Racha de Bajas | `X` |
| Cambiar Arma | `1` – `6` o Rueda del Mouse |
| Menú, Sensibilidad y Admin | `ESC` |

---

## Despliegue Rápido

### Con Docker (Recomendado)
```bash
export ADMIN_PASSWORD="tu-contraseña-segura"
docker compose up -d --build
```
Abre **http://localhost:8080** en tu navegador.

### En Local (Node.js 22+)
```bash
npm install
npm run build
ADMIN_PASSWORD="1234" npm start
```

### Tests
```bash
npm test
```

---

## Stack Tecnológico

- **Backend:** Node.js 22, TypeScript, Express, `ws` (WebSockets)
- **Frontend:** TypeScript, Three.js (`InstancedMesh` + `flatShading`), Vite, HTML5/CSS3, Web Audio API
- **Infraestructura:** Docker multi-stage (`node:22-alpine`), `docker-compose.yml`, Vitest
