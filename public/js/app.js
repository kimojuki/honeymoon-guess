if (window.location.protocol === 'file:') {
  document.body.innerHTML =
    '<div style="font-family:sans-serif;max-width:480px;margin:80px auto;padding:24px;text-align:center">' +
    '<h1>Lancez le serveur</h1>' +
    '<p>Ouvrez un terminal dans le dossier <code>honeymoon-guess</code>, puis :</p>' +
    '<pre style="background:#f0f0f0;padding:12px;border-radius:8px">npm start</pre>' +
    '<p>Ensuite allez sur <strong>http://localhost:3000</strong></p></div>';
  throw new Error('Utilisez le serveur Node, pas le fichier HTML directement.');
}

const socket = io();

let map = null;
let myId = null;
let isAdmin = false;
let roomCode = null;
let validated = false;
const playerMarkers = new Map();
let honeymoonMarker = null;
let myMarker = null;

const COLORS = ['#e07a5f', '#3d8b8b', '#9b5de5', '#f15bb5', '#00bbf9', '#fee440', '#00f5d4'];

// ── DOM ──
const screenHome = document.getElementById('screen-home');
const screenGame = document.getElementById('screen-game');
const homeError = document.getElementById('home-error');
const playersList = document.getElementById('players-list');
const resultsList = document.getElementById('results-list');
const resultsPanel = document.getElementById('results-panel');
const adminPanel = document.getElementById('admin-panel');
const instructions = document.getElementById('instructions');
const statusBadge = document.getElementById('status-badge');
const mapHint = document.getElementById('map-hint');
const winnerBanner = document.getElementById('winner-banner');

// ── Tabs ──
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    homeError.classList.add('hidden');
  });
});

function showError(msg) {
  homeError.textContent = msg;
  homeError.classList.remove('hidden');
}

function enterGame(state, admin) {
  myId = socket.id;
  isAdmin = admin;
  roomCode = state.code;
  validated = state.validated;

  document.getElementById('room-code-display').textContent = `Code : ${state.code}`;
  screenHome.classList.remove('active');
  screenGame.classList.add('active');

  // Leaflet a besoin que le conteneur soit visible avant l'init
  requestAnimationFrame(() => {
    initMap();
    renderState(state);
  });
}

// ── Create / Join ──
document.getElementById('btn-create').addEventListener('click', () => {
  const name = document.getElementById('admin-name').value.trim() || 'Admin';
  socket.emit('createRoom', { adminName: name }, (res) => {
    if (!res.ok) return showError('Erreur lors de la création.');
    enterGame(res.state, true);
  });
});

document.getElementById('btn-join').addEventListener('click', () => {
  const code = document.getElementById('join-code').value.trim();
  const name = document.getElementById('join-name').value.trim() || 'Joueur';
  if (!code) return showError('Entrez le code de la partie.');
  socket.emit('joinRoom', { code, playerName: name }, (res) => {
    if (!res.ok) return showError(res.error);
    enterGame(res.state, res.isAdmin);
  });
});

document.getElementById('btn-validate').addEventListener('click', () => {
  if (!confirm('Valider la partie ? Plus personne ne pourra placer de repère.')) return;
  socket.emit('validateGame', (res) => {
    if (!res.ok) alert(res.error || 'Erreur');
  });
});

socket.on('roomUpdate', (state) => {
  if (!roomCode) return;
  renderState(state);
});

// ── Map ──
function initMap() {
  if (typeof L === 'undefined') {
    alert('La bibliothèque carte n\'a pas chargé. Rechargez la page.');
    return;
  }

  if (map) {
    map.invalidateSize();
    return;
  }

  map = L.map('map', {
    zoomControl: true,
    minZoom: 2,
    maxZoom: 12,
  }).setView([20, 0], 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  }).addTo(map);

  map.on('click', (e) => {
    if (validated) return;
    socket.emit('placeGuess', { lat: e.latlng.lat, lng: e.latlng.lng });
  });

  // Recalcul de la taille une fois le layout stabilisé
  setTimeout(() => map.invalidateSize(), 150);
  setTimeout(() => map.invalidateSize(), 500);
}

function getPlayerColor(index) {
  return COLORS[index % COLORS.length];
}

function updateMarkers(state) {
  const activeIds = new Set();

  state.players.forEach((player, i) => {
    activeIds.add(player.id);

    if (!player.hasGuessed) {
      if (playerMarkers.has(player.id)) {
        map.removeLayer(playerMarkers.get(player.id));
        playerMarkers.delete(player.id);
      }
      return;
    }

    const isMe = player.id === myId;
    let marker = playerMarkers.get(player.id);

    if (marker) {
      marker.setLatLng([player.lat, player.lng]);
    } else {
      const icon = L.divIcon({
        className: 'player-marker-wrap',
        html: `<div class="player-marker${isMe ? ' me' : ''}"></div>`,
        iconSize: isMe ? [22, 22] : [18, 18],
        iconAnchor: isMe ? [11, 11] : [9, 9],
      });
      marker = L.marker([player.lat, player.lng], { icon })
        .bindPopup(`<strong>${player.name}</strong>`)
        .addTo(map);
      playerMarkers.set(player.id, marker);
    }

    if (isMe) myMarker = marker;
  });

  playerMarkers.forEach((marker, id) => {
    if (!activeIds.has(id)) {
      map.removeLayer(marker);
      playerMarkers.delete(id);
    }
  });

  if (state.honeymoon) {
    if (!honeymoonMarker) {
      const icon = L.divIcon({
        className: 'honeymoon-marker-wrap',
        html: '<div class="honeymoon-marker"></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      honeymoonMarker = L.marker([state.honeymoon.lat, state.honeymoon.lng], { icon })
        .bindPopup(`<strong>💛 Lune de miel</strong><br>${state.honeymoon.name}`)
        .addTo(map);
    }
    const bounds = L.latLngBounds(
      state.players.filter((p) => p.hasGuessed).map((p) => [p.lat, p.lng])
    );
    bounds.extend([state.honeymoon.lat, state.honeymoon.lng]);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60] });
  }
}

function renderState(state) {
  validated = state.validated;

  // Players list
  playersList.innerHTML = state.players
    .map(
      (p) => `
    <li class="${p.id === myId ? 'me' : ''}">
      <span>${p.name}${p.id === myId ? ' (vous)' : ''}${p.id === socket.id && isAdmin ? ' ★' : ''}</span>
      <span class="player-status ${p.hasGuessed ? 'done' : ''}">${p.hasGuessed ? '✓ Placé' : '…'}</span>
    </li>`
    )
    .join('');

  // Status
  if (validated) {
    statusBadge.textContent = 'Résultats';
    statusBadge.className = 'badge badge-done';
    mapHint.classList.add('hidden');
    instructions.classList.add('hidden');
    adminPanel.classList.add('hidden');
    resultsPanel.classList.remove('hidden');
    map.off('click');
  } else {
    statusBadge.textContent = 'En cours';
    statusBadge.className = 'badge badge-open';
    mapHint.classList.remove('hidden');
    instructions.classList.remove('hidden');
    resultsPanel.classList.add('hidden');
    if (isAdmin) adminPanel.classList.remove('hidden');
  }

  // Results
  if (state.results && state.results.length > 0) {
    const winner = state.results[0];
    winnerBanner.classList.remove('hidden');
    winnerBanner.innerHTML = `🏆 ${winner.name} gagne !<span>à ${winner.distance} km du lieu</span>`;

    resultsList.innerHTML = state.results
      .map(
        (r) => `
      <li class="${r.winner ? 'winner' : ''}">
        <span>${r.name}</span>
        <span class="result-distance">${r.distance} km</span>
      </li>`
      )
      .join('');
  }

  updateMarkers(state);
}
