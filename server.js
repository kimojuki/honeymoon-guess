const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Lieu secret de la lune de miel — Majorque (Es Trenc)
const HONEYMOON = {
  lat: 39.3733,
  lng: 3.0153,
  name: 'Es Trenc, Majorque',
};

const rooms = new Map();

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getRoomState(room) {
  const players = Object.values(room.players).map((p) => ({
    id: p.id,
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    hasGuessed: p.lat !== null && p.lng !== null,
  }));

  let results = null;
  if (room.validated) {
    results = players
      .filter((p) => p.hasGuessed)
      .map((p) => ({
        id: p.id,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        distance: Math.round(haversine(p.lat, p.lng, HONEYMOON.lat, HONEYMOON.lng) * 10) / 10,
      }))
      .sort((a, b) => a.distance - b.distance);

    if (results.length > 0) {
      results[0].winner = true;
    }
  }

  return {
    code: room.code,
    validated: room.validated,
    players,
    results,
    honeymoon: room.validated ? HONEYMOON : null,
  };
}

function broadcastRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;
  io.to(roomCode).emit('roomUpdate', getRoomState(room));
}

const publicDir = path.join(__dirname, 'public');

app.use(express.static(publicDir));
app.use('/vendor/leaflet', express.static(path.join(__dirname, 'node_modules/leaflet/dist')));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

io.on('connection', (socket) => {
  socket.on('createRoom', ({ adminName }, cb) => {
    const code = generateRoomCode();
    const room = {
      code,
      validated: false,
      adminId: socket.id,
      players: {
        [socket.id]: {
          id: socket.id,
          name: adminName || 'Admin',
          lat: null,
          lng: null,
        },
      },
    };
    rooms.set(code, room);
    socket.join(code);
    socket.roomCode = code;
    socket.isAdmin = true;
    cb({ ok: true, code, state: getRoomState(room) });
  });

  socket.on('joinRoom', ({ code, playerName }, cb) => {
    const room = rooms.get(code?.toUpperCase());
    if (!room) return cb({ ok: false, error: 'Partie introuvable.' });
    if (room.validated) return cb({ ok: false, error: 'La partie est déjà terminée.' });

    const name = (playerName || 'Joueur').trim().slice(0, 24);
    room.players[socket.id] = {
      id: socket.id,
      name,
      lat: null,
      lng: null,
    };
    socket.join(code);
    socket.roomCode = code;
    socket.isAdmin = socket.id === room.adminId;
    cb({ ok: true, code, state: getRoomState(room), isAdmin: socket.isAdmin });
    broadcastRoom(code);
  });

  socket.on('placeGuess', ({ lat, lng }, cb) => {
    const code = socket.roomCode;
    const room = rooms.get(code);
    if (!room || room.validated) return cb?.({ ok: false });
    const player = room.players[socket.id];
    if (!player) return cb?.({ ok: false });

    player.lat = lat;
    player.lng = lng;
    cb?.({ ok: true });
    broadcastRoom(code);
  });

  socket.on('validateGame', (cb) => {
    const code = socket.roomCode;
    const room = rooms.get(code);
    if (!room || socket.id !== room.adminId) return cb?.({ ok: false, error: 'Non autorisé.' });
    if (room.validated) return cb?.({ ok: false, error: 'Déjà validé.' });

    room.validated = true;
    cb?.({ ok: true });
    broadcastRoom(code);
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    delete room.players[socket.id];

    if (Object.keys(room.players).length === 0) {
      rooms.delete(code);
      return;
    }

    if (socket.id === room.adminId) {
      const nextAdmin = Object.keys(room.players)[0];
      room.adminId = nextAdmin;
    }

    broadcastRoom(code);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌴 Lune de miel — jeu lancé sur http://localhost:${PORT}`);
});
