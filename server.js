const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const dailyRoutes = require('./routes/daily');
const timedRoutes = require('./routes/timed');
const authRoutes  = require('./routes/auth');

const app = express();

// ── CORS ────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (
      !origin ||
      origin === 'http://localhost:3000' ||
      origin === 'https://mathle.online' ||
      origin === 'https://www.mathle.online' ||
      origin === 'https://mathle-online.vercel.app' ||
      /^https:\/\/mathle-online.*\.vercel\.app$/.test(origin)
    ) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json());

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
