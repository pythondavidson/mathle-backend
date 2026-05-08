require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const http = require('http');
const { Server } = require('socket.io');

const dailyRoutes = require('./routes/daily');
const timedRoutes = require('./routes/timed');
const authRoutes  = require('./routes/auth');
const User        = require('./models/User');

const app = express();
const server = http.createServer(app);

// ── SEGURIDAD — headers HTTP ──────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false, // necesario para Google AdSense
  contentSecurityPolicy: false,     // Next.js gestiona su propio CSP
}));
app.disable('x-powered-by'); // helmet ya lo hace, doble garantía

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'https://mathle.online',
  'https://www.mathle.online',
  'https://mathle-online.vercel.app',
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || /^https:\/\/mathle-online.*\.vercel\.app$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));

// ── BODY PARSING ──────────────────────────────────────────────
app.use(express.json({ limit: '10kb' })); // limita tamaño del body
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ── MONGO INJECTION SANITIZE ──────────────────────────────────
// Sanitización manual compatible con todas las versiones de Express
// Elimina claves que empiecen por $ o contengan . de body y params
function sanitizeMongo(obj) {
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete obj[key];
      } else {
        sanitizeMongo(obj[key]);
      }
    }
  }
}
app.use((req, res, next) => {
  sanitizeMongo(req.body);
  sanitizeMongo(req.params);
  next();
});

// ── RATE LIMITING ─────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta más tarde' },
});

// Auth más estricto: 10 intentos cada 15 min por IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de acceso. Espera 15 minutos.' },
});

// Scores: evitar spam de puntuaciones
const scoreLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Demasiadas peticiones de puntuación' },
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login',        authLimiter);
app.use('/api/auth/register',     authLimiter);
app.use('/api/auth/google',       authLimiter);
app.use('/api/daily/score',       scoreLimiter);
app.use('/api/timed/score',       scoreLimiter);

// ── SOCKET.IO ─────────────────────────────────────────────────
const io = new Server(server, { cors: corsOptions });

const DUEL_DURATION = 60;
const salas = {};

function generarCodigo() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function terminarDuelo(codigo) {
  const sala = salas[codigo];
  if (!sala || sala.estado === 'terminado') return;
  sala.estado = 'terminado';
  clearInterval(sala.timer);

  const [p1, p2] = sala.players;
  let ganador, perdedor, empate = false;

  if (!p2) {
    if (p1) io.to(codigo).emit('duelo-terminado', { ganador: p1.username, perdedor: '???', desconectado: true, scores: { [p1.username]: p1.score } });
    setTimeout(() => delete salas[codigo], 30000);
    return;
  }

  if (p1.score === p2.score) {
    empate = true;
  } else if (p1.score > p2.score) {
    ganador = p1.username; perdedor = p2.username;
  } else {
    ganador = p2.username; perdedor = p1.username;
  }

  if (!empate && ganador) {
    User.findOneAndUpdate({ username: ganador }, { $inc: { duelWins: 1 } })
      .catch(err => console.error('Error actualizando duelWins:', err));
  }

  io.to(codigo).emit('duelo-terminado', {
    ganador: empate ? null : ganador,
    perdedor: empate ? null : perdedor,
    empate,
    scores: { [p1.username]: p1.score, [p2.username]: p2.score },
    solved: { [p1.username]: p1.solved, [p2.username]: p2.solved },
  });

  console.log(`Sala ${codigo} terminada. ${empate ? 'Empate' : `Ganador: ${ganador}`}`);
  setTimeout(() => delete salas[codigo], 30000);
}

io.on('connection', (socket) => {
  console.log('Socket conectado:', socket.id);

  socket.on('crear-duelo', ({ username }) => {
    // Sanitizar username por si acaso
    const safeUsername = String(username).slice(0, 10);
    const codigo = generarCodigo();
    salas[codigo] = {
      players: [{ id: socket.id, username: safeUsername, score: 0, solved: 0 }],
      estado: 'esperando',
      timer: null,
    };
    socket.join(codigo);
    socket.emit('duelo-creado', { codigo });
    console.log(`Sala ${codigo} creada por ${safeUsername}`);
  });

  socket.on('unirse-duelo', ({ codigo, username }) => {
    const safeUsername = String(username).slice(0, 10);
    const sala = salas[codigo];
    if (!sala)                       { socket.emit('error-duelo', { mensaje: 'Código no encontrado' }); return; }
    if (sala.players.length >= 2)    { socket.emit('error-duelo', { mensaje: 'La sala ya está llena' }); return; }
    if (sala.estado !== 'esperando') { socket.emit('error-duelo', { mensaje: 'El duelo ya ha comenzado' }); return; }

    sala.players.push({ id: socket.id, username: safeUsername, score: 0, solved: 0 });
    socket.join(codigo);
    sala.estado = 'countdown';

    const nombres = sala.players.map(p => p.username);
    io.to(codigo).emit('duelo-iniciado', { players: nombres });
    console.log(`Sala ${codigo} iniciada: ${nombres.join(' vs ')}`);

    setTimeout(() => {
      if (!salas[codigo] || salas[codigo].estado === 'terminado') return;
      salas[codigo].estado = 'jugando';
      io.to(codigo).emit('duelo-arranca');
      setTimeout(() => terminarDuelo(codigo), 65000);
    }, 6000);
  });

  socket.on('tiempo-agotado', ({ codigo, score, solved }) => {
    const sala = salas[codigo];
    if (!sala) return;
    const player = sala.players.find(p => p.id === socket.id);
    if (!player) return;
    // Validar que score es un número y no es absurdamente alto
    player.score  = typeof score === 'number' && score >= 0 && score < 1_000_000 ? Math.round(score) : 0;
    player.solved = typeof solved === 'number' && solved >= 0 ? Math.round(solved) : 0;
    player.finished = true;
    console.log(`${player.username} terminó con score ${player.score} en sala ${codigo}`);

    if (sala.players.length === 2 && sala.players.every(p => p.finished)) {
      terminarDuelo(codigo);
    }
  });

  socket.on('rendirse', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala || sala.estado === 'terminado') return;
    const player = sala.players.find(p => p.id === socket.id);
    const rival  = sala.players.find(p => p.id !== socket.id);
    if (!player) return;
    sala.estado = 'terminado';
    clearInterval(sala.timer);
    io.to(codigo).emit('duelo-terminado', {
      ganador: rival?.username ?? null,
      perdedor: player.username,
      rendido: true,
      scores: Object.fromEntries(sala.players.map(p => [p.username, p.score])),
      solved: Object.fromEntries(sala.players.map(p => [p.username, p.solved])),
    });
    setTimeout(() => delete salas[codigo], 30000);
  });

  socket.on('disconnect', () => {
    for (const codigo in salas) {
      const sala = salas[codigo];
      const idx = sala.players.findIndex(p => p.id === socket.id);
      if (idx === -1) continue;
      if (sala.estado === 'jugando' || sala.estado === 'countdown') {
        const rival = sala.players.find(p => p.id !== socket.id);
        sala.estado = 'terminado';
        clearInterval(sala.timer);
        if (rival) {
          io.to(codigo).emit('duelo-terminado', {
            ganador: rival.username,
            perdedor: sala.players[idx].username,
            desconectado: true,
            scores: { [rival.username]: rival.score, [sala.players[idx].username]: sala.players[idx].score },
            solved: { [rival.username]: rival.solved, [sala.players[idx].username]: sala.players[idx].solved },
          });
        }
        setTimeout(() => delete salas[codigo], 30000);
      } else {
        delete salas[codigo];
      }
      break;
    }
    console.log('Socket desconectado:', socket.id);
  });
});

// ── MONGODB ───────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
})
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.error('Error MongoDB:', err));

// ── RUTAS ─────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'ok' })); // no revelar nombre del proyecto
app.use('/api/auth',  authRoutes);
app.use('/api/daily', dailyRoutes);
app.use('/api/timed', timedRoutes);

// ── MANEJADOR DE ERRORES GLOBAL ───────────────────────────────
app.use((err, req, res, next) => {
  if (err.message === 'No permitido por CORS') return res.status(403).json({ error: 'Origen no permitido' });
  // No filtrar el stack en producción
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── ARRANQUE ──────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// bot para que no se apague
app.get('/health', (req, res) => res.sendStatus(200));