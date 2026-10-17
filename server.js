const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

// Встроенная база карт (аналог cardsData.js)
const CARDS_MAP = new Map();
// Хранилище комнат и активных матчей
const rooms = new Map();
const matches = new Map();

// Инициализируем карты
const rawCards = [
  { id: 'c1_1', mana: 1, name: 'Пехотинец', type: 'minion', atk: 2, hp: 1, icon: '🗡️' },
  { id: 'c1_2', mana: 1, name: 'Щитоносец', type: 'minion', atk: 0, hp: 4, icon: '🛡️', taunt: true },
  { id: 'c1_3', mana: 1, name: 'Гончая склепа', type: 'minion', atk: 1, hp: 1, icon: '🐕', rush: true },
  { id: 'c1_4', mana: 1, name: 'Чародейская стрела', type: 'spell', icon: '✨', dmg: 2 },
  { id: 'c1_5', mana: 1, name: 'Бинты полевого врача', type: 'spell', icon: '🩹', heal: 3 },
  { id: 'c1_12', mana: 1, name: 'Монах рассвета', type: 'minion', atk: 1, hp: 2, icon: '🕯️', healHero: 2 },
  { id: 'c2_1', mana: 2, name: 'Страж границ', type: 'minion', atk: 1, hp: 4, icon: '💂', taunt: true },
  { id: 'c2_2', mana: 2, name: 'Гоблин-подрывник', type: 'minion', atk: 3, hp: 2, icon: '🧨', enemyDmg: 1 },
  { id: 'c2_4', mana: 2, name: 'Ледяной шип', type: 'spell', icon: '❄️', dmg: 3 },
  { id: 'c2_5', mana: 2, name: 'Благословение', type: 'spell', icon: '🌟', heal: 5 },
  { id: 'c2_6', mana: 2, name: 'Бешеный вепрь', type: 'minion', atk: 2, hp: 1, icon: '🐗', rush: true },
  { id: 'c3_1', mana: 3, name: 'Всадник на волке', type: 'minion', atk: 3, hp: 1, icon: '🐺', rush: true },
  { id: 'c3_2', mana: 3, name: 'Огненная вспышка', type: 'spell', icon: '🔥', dmg: 4 },
  { id: 'c3_3', mana: 3, name: 'Адепт магии', type: 'minion', atk: 2, hp: 3, icon: '🔮', draw: 1 },
  { id: 'c3_4', mana: 3, name: 'Железный страж', type: 'minion', atk: 2, hp: 5, icon: '🤖', taunt: true },
  { id: 'c3_7', mana: 3, name: 'Вихрь клинков', type: 'spell', icon: '🌪️', aoeDmg: 1 },
  { id: 'c4_1', mana: 4, name: 'Сенегал-щитоносец', type: 'minion', atk: 3, hp: 5, icon: '🛡️', taunt: true },
  { id: 'c4_3', mana: 4, name: 'Огненный шар ученика', type: 'spell', icon: '☄️', dmg: 5 },
  { id: 'c4_4', mana: 4, name: 'Йети с ледника', type: 'minion', atk: 4, hp: 5, icon: '🦍' },
  { id: 'c4_5', mana: 4, name: 'Грифон небес', type: 'minion', atk: 4, hp: 3, icon: '🦅', rush: true },
  { id: 'c4_8', mana: 4, name: 'Освящение', type: 'spell', icon: '⛪', aoeDmg: 2 },
  { id: 'c5_1', mana: 5, name: 'Боевой Голем', type: 'minion', atk: 5, hp: 5, icon: '🗿' },
  { id: 'c5_2', mana: 5, name: 'Очищающий взрыв', type: 'spell', icon: '💥', aoeDmg: 3 },
  { id: 'c5_4', mana: 5, name: 'Древо мудрости', type: 'minion', atk: 3, hp: 6, icon: '🌲', taunt: true },
  { id: 'c5_5', mana: 5, name: 'Испепеление', type: 'spell', icon: '🔥', dmg: 6 },
  { id: 'c6_1', mana: 6, name: 'Лорд-Защитник', type: 'minion', atk: 4, hp: 8, icon: '🏰', taunt: true },
  { id: 'c6_4', mana: 6, name: 'Волна пламени', type: 'spell', icon: '🌊', aoeDmg: 4 },
  { id: 'c7_2', mana: 7, name: 'Огненный Шар Архимага', type: 'spell', icon: '☄️', dmg: 7 },
  { id: 'c7_3', mana: 7, name: 'Древний Треант', type: 'minion', atk: 5, hp: 9, icon: '🌳', taunt: true },
  { id: 'c8_1', mana: 8, name: 'Древний Дракон', type: 'minion', atk: 8, hp: 8, icon: '🐉' }
];
rawCards.forEach(c => CARDS_MAP.set(c.id, c));

function getCard(id) {
  return CARDS_MAP.get(id) || { id, mana: 1, name: 'Карта', type: 'minion', atk: 1, hp: 1, icon: '🃏' };
}

function broadcastRooms() {
  const list = Array.from(rooms.values())
    .filter(r => r.status === 'waiting')
    .map(r => ({ id: r.id, hostName: r.hostName, bet: r.bet }));
  io.emit('lobby_update', list);
}

function startTurn(match) {
  const currentP = match.turn === 1 ? match.p1 : match.p2;
  const oppP = match.turn === 1 ? match.p2 : match.p1;

  // Увеличение маны (до макс. 8)
  if (currentP.maxMana < 8) currentP.maxMana++;
  currentP.currentMana = currentP.maxMana;

  // Существа готовы к бою
  currentP.board.forEach(m => { m.canAttack = true; });

  // Добор карты
  if (currentP.deck.length > 0) {
    if (currentP.hand.length < 6) {
      currentP.hand.push(currentP.deck.pop());
    } else {
      currentP.deck.pop(); // Сгорание карты при переполнении
    }
  } else {
    currentP.fatigue++;
    currentP.hp -= currentP.fatigue;
  }

  // Сброс таймера на 45 сек
  if (match.timer) clearTimeout(match.timer);
  match.timer = setTimeout(() => {
    switchTurn(match);
  }, 45000);

  sendMatchState(match);
}

function switchTurn(match) {
  if (checkGameOver(match)) return;
  match.turn = match.turn === 1 ? 2 : 1;
  startTurn(match);
}

function checkGameOver(match) {
  if (match.p1.hp <= 0 || match.p2.hp <= 0) {
    if (match.timer) clearTimeout(match.timer);
    const winner = match.p1.hp > 0 ? match.p1.id : match.p2.hp > 0 ? match.p2.id : null;
    io.to(match.p1.id).emit('game_over', { winner, p1Hp: match.p1.hp, p2Hp: match.p2.hp });
    io.to(match.p2.id).emit('game_over', { winner, p1Hp: match.p1.hp, p2Hp: match.p2.hp });
    matches.delete(match.roomId);
    rooms.delete(match.roomId);
    return true;
  }
  return false;
}

function sendMatchState(match) {
  const formatPlayer = (p, isSelf) => ({
    id: p.id,
    name: p.name,
    hp: p.hp,
    currentMana: p.currentMana,
    maxMana: p.maxMana,
    deckCount: p.deck.length,
    board: p.board,
    hand: isSelf ? p.hand : p.hand.length // скрываем карты соперника в руке
  });

  io.to(match.p1.id).emit('sync_state', {
    turn: match.turn,
    isMyTurn: match.turn === 1,
    me: formatPlayer(match.p1, true),
    opp: formatPlayer(match.p2, false)
  });

  io.to(match.p2.id).emit('sync_state', {
    turn: match.turn,
    isMyTurn: match.turn === 2,
    me: formatPlayer(match.p2, true),
    opp: formatPlayer(match.p1, false)
  });
}

io.on('connection', (socket) => {
  socket.on('get_lobby', () => {
    const list = Array.from(rooms.values())
      .filter(r => r.status === 'waiting')
      .map(r => ({ id: r.id, hostName: r.hostName, bet: r.bet }));
    socket.emit('lobby_update', list);
  });

  socket.on('create_room', ({ bet, hostName, deck }) => {
    const roomId = 'room_' + Math.random().toString(36).substring(2, 9);
    rooms.set(roomId, {
      id: roomId,
      hostId: socket.id,
      hostName: hostName || 'Игрок 1',
      bet: Number(bet) || 10,
      hostDeck: deck && deck.length === 15 ? deck : null,
      status: 'waiting'
    });
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

  socket.on('join_room', ({ roomId, guestName, deck }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'waiting') return;

    room.status = 'playing';
    room.guestId = socket.id;
    room.guestName = guestName || 'Игрок 2';
    socket.join(roomId);
    broadcastRooms();

    // Сборка колод из 15 карт
    const fallbackDeck = ['c1_1', 'c1_2', 'c1_3', 'c1_4', 'c2_1', 'c2_2', 'c2_4', 'c3_1', 'c3_2', 'c3_4', 'c4_1', 'c4_3', 'c5_1', 'c6_1', 'c8_1'];
    const p1DeckIds = (room.hostDeck || fallbackDeck).slice().sort(() => Math.random() - 0.5);
    const p2DeckIds = (deck && deck.length === 15 ? deck : fallbackDeck).slice().sort(() => Math.random() - 0.5);

    const p1Deck = p1DeckIds.map((id, idx) => ({ ...getCard(id), uid: 'p1_' + idx + '_' + id }));
    const p2Deck = p2DeckIds.map((id, idx) => ({ ...getCard(id), uid: 'p2_' + idx + '_' + id }));

    const match = {
      roomId,
      bet: room.bet,
      turn: 1,
      p1: {
        id: room.hostId,
        name: room.hostName,
        hp: 25,
        maxMana: 0,
        currentMana: 0,
        fatigue: 0,
        deck: p1Deck,
        hand: p1Deck.splice(0, 3),
        board: []
      },
      p2: {
        id: room.guestId,
        name: room.guestName,
        hp: 25,
        maxMana: 0,
        currentMana: 0,
        fatigue: 0,
        deck: p2Deck,
        hand: p2Deck.splice(0, 4), // Второй игрок берет 4 карты на старте
        board: []
      }
    };

    matches.set(roomId, match);
    startTurn(match);
  });

  // Разыгрывание карты из руки
  socket.on('play_card', ({ roomId, cardUid, targetId }) => {
    const match = matches.get(roomId);
    if (!match) return;

    const isP1 = match.turn === 1;
    const player = isP1 ? match.p1 : match.p2;
    const opp = isP1 ? match.p2 : match.p1;
    if (player.id !== socket.id) return;

    const cIdx = player.hand.findIndex(c => c.uid === cardUid);
    if (cIdx === -1) return;
    const card = player.hand[cIdx];

    if (player.currentMana < card.mana) return;

    // Розыгрыш существа
    if (card.type === 'minion') {
      if (player.board.length >= 4) return; // Макс 4 существа на столе
      player.currentMana -= card.mana;
      player.hand.splice(cIdx, 1);

      const minion = {
        uid: card.uid,
        id: card.id,
        name: card.name,
        atk: card.atk,
        hp: card.hp,
        maxHp: card.hp,
        icon: card.icon,
        taunt: !!card.taunt,
        canAttack: !!card.rush // Существо с Rush может атаковать сразу
      };

      if (card.healHero) player.hp = Math.min(25, player.hp + card.healHero);
      if (card.enemyDmg) opp.hp -= card.enemyDmg;
      if (card.draw && player.deck.length > 0 && player.hand.length < 6) {
        player.hand.push(player.deck.pop());
      }

      player.board.push(minion);
    } 
    // Розыгрыш заклинания
    else if (card.type === 'spell') {
      player.currentMana -= card.mana;
      player.hand.splice(cIdx, 1);

      if (card.dmg && targetId) {
        if (targetId === 'opp_hero') opp.hp -= card.dmg;
        else {
          const tMinion = opp.board.find(m => m.uid === targetId) || player.board.find(m => m.uid === targetId);
          if (tMinion) tMinion.hp -= card.dmg;
        }
      }
      if (card.heal && targetId) {
        if (targetId === 'my_hero') player.hp = Math.min(25, player.hp + card.heal);
        else {
          const tMinion = player.board.find(m => m.uid === targetId);
          if (tMinion) tMinion.hp = Math.min(tMinion.maxHp, tMinion.hp + card.heal);
        }
      }
      if (card.aoeDmg) {
        opp.board.forEach(m => { m.hp -= card.aoeDmg; });
      }
      if (card.draw) {
        for (let i = 0; i < card.draw; i++) {
          if (player.deck.length > 0 && player.hand.length < 6) player.hand.push(player.deck.pop());
        }
      }

      // Чистим погибших
      player.board = player.board.filter(m => m.hp > 0);
      opp.board = opp.board.filter(m => m.hp > 0);
    }

    checkGameOver(match);
    sendMatchState(match);
  });

  // Атака существом стола
  socket.on('attack', ({ roomId, attackerUid, targetId }) => {
    const match = matches.get(roomId);
    if (!match) return;

    const isP1 = match.turn === 1;
    const player = isP1 ? match.p1 : match.p2;
    const opp = isP1 ? match.p2 : match.p1;
    if (player.id !== socket.id) return;

    const attacker = player.board.find(m => m.uid === attackerUid);
    if (!attacker || !attacker.canAttack || attacker.atk <= 0) return;

    // Проверка Провокации (Taunt)
    const hasTaunt = opp.board.some(m => m.taunt);
    if (targetId === 'opp_hero') {
      if (hasTaunt) return; // Нельзя бить в лицо, если есть Taunt
      opp.hp -= attacker.atk;
      attacker.canAttack = false;
    } else {
      const defender = opp.board.find(m => m.uid === targetId);
      if (!defender) return;
      if (hasTaunt && !defender.taunt) return; // Если есть Taunt, бить можно только его

      // Взаимный размен характеристиками
      defender.hp -= attacker.atk;
      attacker.hp -= defender.atk;
      attacker.canAttack = false;
    }

    // Удаление павших существ
    player.board = player.board.filter(m => m.hp > 0);
    opp.board = opp.board.filter(m => m.hp > 0);

    checkGameOver(match);
    sendMatchState(match);
  });

  // Завершение хода кнопкой
  socket.on('end_turn', ({ roomId }) => {
    const match = matches.get(roomId);
    if (!match) return;
    const currentP = match.turn === 1 ? match.p1 : match.p2;
    if (currentP.id === socket.id) {
      switchTurn(match);
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

server.listen(PORT, () => console.log(`Arena server listening on ${PORT}`));
