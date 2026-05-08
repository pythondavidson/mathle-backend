const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const auth = require('../middleware/auth');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── VALIDACIONES ─────────────────────────────────────────────
const EMAIL_REGEX    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/; // solo alfanumérico y guion bajo

// ── REGISTRO ─────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password)
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });

    if (username.length < 3 || username.length > 10)
      return res.status(400).json({ error: 'El usuario debe tener entre 3 y 10 caracteres' });

    if (!USERNAME_REGEX.test(username))
      return res.status(400).json({ error: 'El usuario solo puede contener letras, números y guiones bajos' });

    if (!EMAIL_REGEX.test(email))
      return res.status(400).json({ error: 'Email no válido' });

    if (password.length < 6)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    if (password.length > 128)
      return res.status(400).json({ error: 'Contraseña demasiado larga' });

    const existingUser = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (existingUser)
      return res.status(409).json({ error: 'El usuario o email ya existe' });

    const passwordHash = await bcrypt.hash(password, 12); // subido de 10 a 12
    const user = await User.create({ username, email: email.toLowerCase(), passwordHash });

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al registrar el usuario' }); // no filtrar err.message en prod
  }
});

// ── LOGIN ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });

    if (typeof email !== 'string' || typeof password !== 'string')
      return res.status(400).json({ error: 'Datos inválidos' });

    const user = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username: email }] });

    // Siempre hacer bcrypt aunque no exista el user (evita timing attacks)
    const dummyHash = '$2b$12$invalidhashinvalidhashinvalidhashinvalidhashXXXXXXXXXX';
    const valid = user
      ? await bcrypt.compare(password, user.passwordHash)
      : await bcrypt.compare(password, dummyHash).then(() => false);

    if (!user || !valid)
      return res.status(401).json({ error: 'Credenciales incorrectas' });

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

// ── GOOGLE LOGIN ──────────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential || typeof credential !== 'string')
      return res.status(400).json({ error: 'Credential requerido' });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email } = payload;

    if (!email) return res.status(400).json({ error: 'No se pudo obtener el email de Google' });

    let user = await User.findOne({ $or: [{ googleId }, { email: email.toLowerCase() }] });

    if (user) {
      if (!user.googleId) { user.googleId = googleId; await user.save(); }
      const token = jwt.sign(
        { userId: user._id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      return res.json({ token, user: { id: user._id, username: user.username, email: user.email } });
    }

    return res.json({ needsUsername: true, email });

  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Token de Google inválido' });
  }
});

// ── GOOGLE COMPLETE ───────────────────────────────────────────
router.post('/google/complete', async (req, res) => {
  try {
    const { credential, username } = req.body;
    if (!credential || !username)
      return res.status(400).json({ error: 'Faltan datos' });

    if (typeof username !== 'string')
      return res.status(400).json({ error: 'Datos inválidos' });

    if (username.length < 3 || username.length > 10)
      return res.status(400).json({ error: 'El usuario debe tener entre 3 y 10 caracteres' });

    if (!USERNAME_REGEX.test(username))
      return res.status(400).json({ error: 'El usuario solo puede contener letras, números y guiones bajos' });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email } = payload;

    const existingUsername = await User.findOne({ username });
    if (existingUsername)
      return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });

    const user = await User.create({ username, email: email.toLowerCase(), googleId, passwordHash: 'GOOGLE_AUTH' });

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user._id, username: user.username, email: user.email } });

  } catch (err) {
    console.error('Google complete error:', err);
    res.status(401).json({ error: 'Token de Google inválido' });
  }
});

// ── VERIFICAR TOKEN ───────────────────────────────────────────
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Token requerido' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    res.json(user);
  } catch (err) {
    res.status(401).json({ error: 'Token inválido' });
  }
});

// ── ELIMINAR CUENTA ───────────────────────────────────────────
router.delete('/delete', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    await User.findByIdAndDelete(userId);
    res.json({ message: 'Cuenta eliminada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar la cuenta' });
  }
});

// ── PERFIL PRIVADO ────────────────────────────────────────────
router.get('/profile', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const rank = await User.countDocuments({ totalPoints: { $gt: user.totalPoints } });

    const DailyScore = require('../models/DailyScore');
    const last7 = await DailyScore.find({ userId })
      .sort({ date: -1 })
      .limit(7)
      .select('date points won attempts');

    res.json({
      username: user.username,
      email: user.email,
      totalPoints: user.totalPoints,
      streakDays: user.streakDays,
      duelWins: user.duelWins || 0,
      rank: rank + 1,
      last7: last7.reverse(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener el perfil' });
  }
});

// ── PERFIL PÚBLICO ────────────────────────────────────────────
router.get('/profile/public/:username', async (req, res) => {
  try {
    const { username } = req.params;

    // Validar que el username del param es seguro antes de buscar
    if (!USERNAME_REGEX.test(username) || username.length > 10)
      return res.status(400).json({ error: 'Username inválido' });

    const user = await User.findOne({ username }).select('-passwordHash -email');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const rank = await User.countDocuments({ totalPoints: { $gt: user.totalPoints } });

    const DailyScore = require('../models/DailyScore');
    const last7 = await DailyScore.find({ userId: user._id })
      .sort({ date: -1 })
      .limit(7)
      .select('date points won attempts');

    res.json({
      username: user.username,
      totalPoints: user.totalPoints,
      streakDays: user.streakDays,
      duelWins: user.duelWins || 0,
      rank: rank + 1,
      last7: last7.reverse(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener el perfil' });
  }
});

module.exports = router;
