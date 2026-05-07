require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');

const dailyRoutes = require('./routes/daily');
const timedRoutes = require('./routes/timed');
const authRoutes  = require('./routes/auth');

const app = express();
const server = http.createServer(app);

// ── CORS ────────────────────────────────────────────────
const allowedOrigins = [
  'http://localhost:3000',
  'https://mathle.online',
  'https://www.mathle.online',
  'https://mathle-online.vercel.app',
];

const corsOptions = {
  origin: (origin, callback) => {
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      /^https:\/\/mathle-online.*\.vercel\.app$/.test(origin)
    ) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// ── SOCKET.IO ────────────────────────────────────────────
const io = new Server(server, {
  cors: corsOptions,
});

// salas: { [codigo]: { players: [socket1, socket2], problem, state } }
const salas = {};

function generarProblema() {
  const plantillas = [
    () => { const a = Math.floor(Math.random()*9)+1, b = Math.floor(Math.random()*9)+1; return { ecuacion: `? + ${b} = ${a+b}`, respuestas: [a] }; },
    () => { const a = Math.floor(Math.random()*9)+1, b = Math.floor(Math.random()*9)+1; return { ecuacion: `${a+b} - ? = ${b}`, respuestas: [a] }; },
    () => { const a = Math.floor(Math.random()*9)+1, b = Math.floor(Math.random()*9)+1; return { ecuacion: `? × ${b} = ${a*b}`, respuestas: [a] }; },
    () => { const b = Math.floor(Math.random()*8)+2, a = b*(Math.floor(Math.random()*9)+1); return { ecuacion: `${a} ÷ ${b} = ?`, respuestas: [a/b] }; },
    () => { const a = Math.floor(Math.random()*5)+1, b = Math.floor(Math.random()*5)+1, c = a*b+Math.floor(Math.random()*9)+1; return { ecuacion: `? + ${a} × ${b} = ${c}`, respuestas: [c - a*b] }; },
  ];
  return plantillas[Math.floor(Math.random()*plantillas.length)]();
}

function generarCodigo() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('Socket conectado:', socket.id);

  // Crear sala
  socket.on('crear-duelo', ({ username }) => {
    const codigo = generarCodigo();
    salas[codigo] = {
      players: [{ id: socket.id, username, listo: false }],
      problem: null,
      estado: 'esperando',
      ganador: null,
    };
    socket.join(codigo);
    socket.emit('duelo-creado', { codigo });
    console.log(`Sala ${codigo} creada por ${username}`);
  });

  // Unirse a sala
  socket.on('unirse-duelo', ({ codigo, username }) => {
    const sala = salas[codigo];
    if (!sala) {
      socket.emit('error-duelo', { mensaje: 'Código de duelo no encontrado' });
      return;
    }
    if (sala.players.length >= 2) {
      socket.emit('error-duelo', { mensaje: 'La sala ya está llena' });
      return;
    }
    if (sala.estado !== 'esperando') {
      socket.emit('error-duelo', { mensaje: 'El duelo ya ha comenzado' });
      return;
    }

    sala.players.push({ id: socket.id, username, listo: false });
    socket.join(codigo);

    // Generar problema y arrancar
    sala.problem = generarProblema();
    sala.estado = 'jugando';

    const nombres = sala.players.map(p => p.username);
    io.to(codigo).emit('duelo-iniciado', {
      problem: sala.problem,
      players: nombres,
    });

    console.log(`Sala ${codigo} iniciada: ${nombres.join(' vs ')}`);
  });

  // Enviar respuesta
  socket.on('respuesta-duelo', ({ codigo, respuesta }) => {
    const sala = salas[codigo];
    if (!sala || sala.estado !== 'jugando') return;

    const player = sala.players.find(p => p.id === socket.id);
    if (!player) return;

    const correctas = sala.problem.respuestas;
    const esCorrecta = correctas.every((r, i) => Number(respuesta[i]) === r);

    if (esCorrecta && !sala.ganador) {
      sala.ganador = player.username;
      sala.estado = 'terminado';
      io.to(codigo).emit('duelo-terminado', {
        ganador: player.username,
        perdedor: sala.players.find(p => p.id !== socket.id)?.username,
      });
      console.log(`Sala ${codigo}: ganador ${player.username}`);
      // Limpiar sala después de 30s
      setTimeout(() => delete salas[codigo], 30000);
    } else if (!esCorrecta) {
      socket.emit('respuesta-incorrecta');
    }
  });

  // Rendirse
  socket.on('rendirse', ({ codigo }) => {
    const sala = salas[codigo];
    if (!sala || sala.estado !== 'jugando') return;
    const player = sala.players.find(p => p.id === socket.id);
    const rival = sala.players.find(p => p.id !== socket.id);
    if (!player || !rival) return;
    sala.estado = 'terminado';
    sala.ganador = rival.username;
    io.to(codigo).emit('duelo-terminado', {
      ganador: rival.username,
      perdedor: player.username,
      rendido: true,
    });
    setTimeout(() => delete salas[codigo], 30000);
  });

  // Desconexión
  socket.on('disconnect', () => {
    for (const codigo in salas) {
      const sala = salas[codigo];
      const idx = sala.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        if (sala.estado === 'jugando') {
          const rival = sala.players.find(p => p.id !== socket.id);
          if (rival) {
            io.to(codigo).emit('duelo-terminado', {
              ganador: rival.username,
              perdedor: sala.players[idx].username,
              desconectado: true,
            });
          }
        }
        delete salas[codigo];
        break;
      }
    }
    console.log('Socket desconectado:', socket.id);
  });
});

// ── RATE LIMITING ────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Demasiadas peticiones, espera un momento' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos, espera 15 minutos' },
});

app.use(generalLimiter);
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// ── MONGODB ──────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.error('Error MongoDB:', err));

// ── RUTAS ────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'Mathle API running' }));
app.use('/api/auth',  authRoutes);
app.use('/api/daily', dailyRoutes);
app.use('/api/timed', timedRoutes);

// ── ERRORES ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.message === 'No permitido por CORS') {
    return res.status(403).json({ error: 'Origen no permitido' });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── ARRANQUE ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
