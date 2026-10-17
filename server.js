const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// Хранилище комнат и активных матчей
const rooms = new Map();
const matches = new Map();

function generateDeck() {
  const elements = ['fire', 'water', 'earth'];
  const deck = [];
  let id = 1;
  elements.forEach(elem => {
    for (let power = 1; power <= 5; power++) {
      deck.push({ id: id++, element: elem, power });
    }
  });
  return deck.sort(() => Math.random() - 0.5);
}

function resolveBattle(c1, c2) {
  let p1Bonus = 0;
  let p2Bonus = 0;

  if (c1.element === 'fire' && c2.element === 'earth') p1Bonus = 2;
  else if (c1.element === 'earth' && c2.element === 'water') p1Bonus = 2;
  else if (c1.element === 'water' && c2.element === 'fire') p1Bonus = 2;

  if (c2.element === 'fire' && c1.element === 'earth') p2Bonus = 2;
  else if (c2.element === 'earth' && c1.element === 'water') p2Bonus = 2;
  else if (c2.element === 'water' && c1.element === 'fire') p2Bonus = 2;

  const total1 = c1.power + p1Bonus;
  const total2 = c2.power + p2Bonus;

  let winner = 0;
  let dmg = 0;
  if (total1 > total2) {
    winner = 1;
    dmg = total1 - total2;
  } else if (total2 > total1) {
    winner = 2;
    dmg = total2 - total1;
  }

  return { winner, dmg, p1Bonus, p2Bonus, total1, total2 };
}

function broadcastRooms() {
  const publicRooms = Array.from(rooms.values())
    .filter(r => r.status === 'waiting')
    .map(r => ({
      id: r.id,
      hostName: r.hostName,
      bet: r.bet
    }));
  io.emit('lobby_update', publicRooms);
}

io.on('connection', (socket) => {
  // Отправка текущих комнат при входе
  socket.on('get_lobby', () => {
    const publicRooms = Array.from(rooms.values())
      .filter(r => r.status === 'waiting')
      .map(r => ({
        id: r.id,
        hostName: r.hostName,
        bet: r.bet
      }));
    socket.emit('lobby_update', publicRooms);
  });

  // Создание комнаты
  socket.on('create_room', ({ bet, hostName }) => {
    const roomId = 'room_' + Math.random().toString(36).substring(2, 9);
    rooms.set(roomId, {
      id: roomId,
      hostId: socket.id,
      hostName: hostName || 'Игрок 1',
      bet: Number(bet) || 10,
      status: 'waiting'
    });
    socket.join(roomId);
    socket.emit('room_created', { roomId });
    broadcastRooms();
  });

  // Отмена комнаты создателем
  socket.on('leave_room', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (room && room.hostId === socket.id) {
      rooms.delete(roomId);
      broadcastRooms();
    }
  });

  // Подключение к существующей комнате
  socket.on('join_room', ({ roomId, guestName }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'waiting') {
      socket.emit('error_msg', 'Комната уже недоступна или заполнена');
      return;
    }

    room.status = 'playing';
    room.guestId = socket.id;
    room.guestName = guestName || 'Игрок 2';
    socket.join(roomId);
    broadcastRooms();

    // Инициализация матча
    const deck1 = generateDeck();
    const deck2 = generateDeck();
    const match = {
      roomId,
      bet: room.bet,
      p1: { id: room.hostId, name: room.hostName, hp: 20, deck: deck1, hand: deck1.splice(0, 3), playedCard: null },
      p2: { id: room.guestId, name: room.guestName, hp: 20, deck: deck2, hand: deck2.splice(0, 3), playedCard: null },
      round: 1
    };
    matches.set(roomId, match);

    // Старт матча для P1
    io.to(match.p1.id).emit('match_start', {
      bet: match.bet,
      oppName: match.p2.name,
      hand: match.p1.hand,
      myHp: match.p1.hp,
      oppHp: match.p2.hp
    });

    // Старт матча для P2
    io.to(match.p2.id).emit('match_start', {
      bet: match.bet,
      oppName: match.p1.name,
      hand: match.p2.hand,
      myHp: match.p2.hp,
      oppHp: match.p1.hp
    });
  });

  // Розыгрыш карты
  socket.on('play_card', ({ roomId, cardId }) => {
    const match = matches.get(roomId);
    if (!match) return;

    const isP1 = match.p1.id === socket.id;
    const player = isP1 ? match.p1 : match.p2;
    const opp = isP1 ? match.p2 : match.p1;

    if (player.playedCard) return;

    const cIdx = player.hand.findIndex(c => c.id === cardId);
    if (cIdx === -1) return;
    player.playedCard = player.hand.splice(cIdx, 1)[0];

    // Уведомляем оппонента, что сделан ход рубашкой
    io.to(opp.id).emit('opp_card_played');

    // Если оба походили — рассчитываем раунд
    if (match.p1.playedCard && match.p2.playedCard) {
      const c1 = match.p1.playedCard;
      const c2 = match.p2.playedCard;
      const res = resolveBattle(c1, c2);

      if (res.winner === 1) match.p2.hp = Math.max(0, match.p2.hp - res.dmg);
      if (res.winner === 2) match.p1.hp = Math.max(0, match.p1.hp - res.dmg);

      // Добор карт
      if (match.p1.deck.length > 0 && match.p1.hand.length < 4) match.p1.hand.push(match.p1.deck.pop());
      if (match.p2.deck.length > 0 && match.p2.hand.length < 4) match.p2.hand.push(match.p2.deck.pop());

      const gameOver = match.p1.hp <= 0 || match.p2.hp <= 0 || (match.p1.deck.length === 0 && match.p1.hand.length === 0);

      // Результат для P1
      io.to(match.p1.id).emit('round_result', {
        myCard: c1,
        oppCard: c2,
        myBonus: res.p1Bonus,
        oppBonus: res.p2Bonus,
        winner: res.winner === 1 ? 'win' : res.winner === 2 ? 'lose' : 'draw',
        dmg: res.dmg,
        myHp: match.p1.hp,
        oppHp: match.p2.hp,
        newHand: match.p1.hand,
        gameOver
      });

      // Результат для P2
      io.to(match.p2.id).emit('round_result', {
        myCard: c2,
        oppCard: c1,
        myBonus: res.p2Bonus,
        oppBonus: res.p1Bonus,
        winner: res.winner === 2 ? 'win' : res.winner === 1 ? 'lose' : 'draw',
        dmg: res.dmg,
        myHp: match.p2.hp,
        oppHp: match.p1.hp,
        newHand: match.p2.hand,
        gameOver
      });

      // Сброс ходов
      match.p1.playedCard = null;
      match.p2.playedCard = null;
      match.round++;

      if (gameOver) {
        matches.delete(roomId);
        rooms.delete(roomId);
      }
    }
  });

  // Отключение игрока
  socket.on('disconnect', () => {
    for (const [id, room] of rooms.entries()) {
      if (room.hostId === socket.id) {
        rooms.delete(id);
        broadcastRooms();
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Elemental Clash server running on port ${PORT}`);
});
