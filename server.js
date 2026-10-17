const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

const rooms = new Map();
const matches = new Map();

function getFixedDeck() {
  return [
    { id: 'blade', name: 'Клинок', type: 'weapon', val: 3, icon: '⚔️' },
    { id: 'axe', name: 'Секира', type: 'weapon', val: 5, icon: '🪓' },
    { id: 'dragon', name: 'Дракон', type: 'weapon', val: 7, icon: '🐉' },
    { id: 'shield', name: 'Щит', type: 'shield', val: 0, icon: '🛡️' },
    { id: 'spy', name: 'Шпион', type: 'trap', val: 1, icon: '🦹' },
    { id: 'mine', name: 'Мина', type: 'trap', val: 0, icon: '💣' }
  ];
}

function resolveLane(p1Cards, p2Cards) {
  let p1Bonus = 0, p2Bonus = 0;
  let p1Weps = p1Cards.filter(c => c.type === 'weapon');
  let p2Weps = p2Cards.filter(c => c.type === 'weapon');
  let p1Shield = p1Cards.some(c => c.type === 'shield');
  let p2Shield = p2Cards.some(c => c.type === 'shield');
  let p1Spy = p1Cards.some(c => c.type === 'spy');
  let p2Spy = p2Cards.some(c => c.type === 'spy');
  let p1Mine = p1Cards.some(c => c.type === 'mine');
  let p2Mine = p2Cards.some(c => c.type === 'mine');

  let p1Total = p1Cards.reduce((acc, c) => acc + c.val, 0);
  let p2Total = p2Cards.reduce((acc, c) => acc + c.val, 0);

  // 1. Срабатывание Мин
  if (p1Mine && p2Total >= 6) p2Total = 0;
  if (p2Mine && p1Total >= 6) p1Total = 0;

  // 2. Срабатывание Щитов
  if (p1Shield && p2Weps.length > 0) {
    let maxEnemy = Math.max(...p2Weps.map(w => w.val));
    p2Total = Math.max(0, p2Total - maxEnemy);
    p1Bonus += maxEnemy;
  }
  if (p2Shield && p1Weps.length > 0) {
    let maxEnemy = Math.max(...p1Weps.map(w => w.val));
    p1Total = Math.max(0, p1Total - maxEnemy);
    p2Bonus += maxEnemy;
  }

  // 3. Срабатывание Шпиона
  if (p1Spy && p2Shield) { p2Total = Math.max(0, p2Total - 4); p1Bonus += 4; }
  if (p2Spy && p1Shield) { p1Total = Math.max(0, p1Total - 4); p2Bonus += 4; }

  return { p1Score: p1Total + p1Bonus, p2Score: p2Total + p2Bonus };
}

function broadcastRooms() {
  const list = Array.from(rooms.values())
    .filter(r => r.status === 'waiting')
    .map(r => ({ id: r.id, hostName: r.hostName, bet: r.bet }));
  io.emit('lobby_update', list);
}

io.on('connection', (socket) => {
  socket.on('get_lobby', () => {
    const list = Array.from(rooms.values())
      .filter(r => r.status === 'waiting')
      .map(r => ({ id: r.id, hostName: r.hostName, bet: r.bet }));
    socket.emit('lobby_update', list);
  });

  socket.on('create_room', ({ bet, hostName }) => {
    const roomId = 'room_' + Math.random().toString(36).substring(2, 9);
    rooms.set(roomId, { id: roomId, hostId: socket.id, hostName: hostName || 'Игрок 1', bet: Number(bet) || 10, status: 'waiting' });
    socket.join(roomId);
    socket.emit('room_created', { roomId });
    broadcastRooms();
  });

  socket.on('leave_room', ({ roomId }) => {
    const r = rooms.get(roomId);
    if (r && r.hostId === socket.id) {
      rooms.delete(roomId);
      broadcastRooms();
    }
  });

  socket.on('join_room', ({ roomId, guestName }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'waiting') return;

    room.status = 'playing';
    room.guestId = socket.id;
    room.guestName = guestName || 'Игрок 2';
    socket.join(roomId);
    broadcastRooms();

    const match = {
      roomId,
      bet: room.bet,
      round: 1, // Раунды: 1 (1 карта), 2 (1 карта), 3 (2 карты), 4 (2 карты)
      p1: { id: room.hostId, name: room.hostName, hand: getFixedDeck(), moves: [], lanes: [[], [], []] },
      p2: { id: room.guestId, name: room.guestName, hand: getFixedDeck(), moves: [], lanes: [[], [], []] }
    };
    matches.set(roomId, match);

    io.to(match.p1.id).emit('match_start', {
      roomId,
      bet: match.bet,
      oppName: match.p2.name,
      hand: match.p1.hand,
      round: 1,
      reqCards: 1
    });

    io.to(match.p2.id).emit('match_start', {
      roomId,
      bet: match.bet,
      oppName: match.p1.name,
      hand: match.p2.hand,
      round: 1,
      reqCards: 1
    });
  });

  socket.on('submit_moves', ({ roomId, moves }) => {
    const match = matches.get(roomId);
    if (!match) return;

    const isP1 = match.p1.id === socket.id;
    const player = isP1 ? match.p1 : match.p2;
    const opp = isP1 ? match.p2 : match.p1;

    player.moves = moves; // moves: [{ cardId, laneIndex }]
    io.to(opp.id).emit('opp_ready');

    if (match.p1.moves.length > 0 && match.p2.moves.length > 0) {
      // Применяем карты игроков к линиям
      match.p1.moves.forEach(m => {
        const cIdx = match.p1.hand.findIndex(c => c.id === m.cardId);
        if (cIdx !== -1) {
          const card = match.p1.hand.splice(cIdx, 1)[0];
          match.p1.lanes[m.laneIndex].push(card);
        }
      });

      match.p2.moves.forEach(m => {
        const cIdx = match.p2.hand.findIndex(c => c.id === m.cardId);
        if (cIdx !== -1) {
          const card = match.p2.hand.splice(cIdx, 1)[0];
          match.p2.lanes[m.laneIndex].push(card);
        }
      });

      // Пересчитываем все 3 линии
      const laneScores = [0, 1, 2].map(idx => resolveLane(match.p1.lanes[idx], match.p2.lanes[idx]));

      match.p1.moves = [];
      match.p2.moves = [];
      match.round++;

      const isGameOver = match.round > 4;

      // Отправляем итоги
      io.to(match.p1.id).emit('round_revealed', {
        myLanes: match.p1.lanes,
        oppLanes: match.p2.lanes,
        scores: laneScores.map(s => ({ my: s.p1Score, opp: s.p2Score })),
        hand: match.p1.hand,
        round: match.round,
        reqCards: match.round === 2 ? 1 : 2,
        isGameOver
      });

      io.to(match.p2.id).emit('round_revealed', {
        myLanes: match.p2.lanes,
        oppLanes: match.p1.lanes,
        scores: laneScores.map(s => ({ my: s.p2Score, opp: s.p1Score })),
        hand: match.p2.hand,
        round: match.round,
        reqCards: match.round === 2 ? 1 : 2,
        isGameOver
      });

      if (isGameOver) {
        matches.delete(roomId);
        rooms.delete(roomId);
      }
    }
  });

  socket.on('disconnect', () => {
    for (const [id, room] of rooms.entries()) {
      if (room.hostId === socket.id) {
        rooms.delete(id);
        broadcastRooms();
      }
    }
  });
});

server.listen(PORT, () => console.log(`Server online port ${PORT}`));
