const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const auth = require('../middleware/auth');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── REGISTRO ────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password)
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });

    if (username.length > 10)
      return res.status(400).json({ error: 'El usuario no puede tener más de 10 caracteres' });

    if (password.length < 6)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser)
      return res.status(409).json({ error: 'El usuario o email ya existe' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email, passwordHash });

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
    res.status(500).json({ error: err.message });
  }
});

// ── LOGIN ───────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ error: 'Email y contraseña son obligatorios' });

    const user = await User.findOne({ $or: [{ email }, { username: email }] });
    if (!user)
      return res.status(401).json({ error: 'Credenciales incorrectas' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid)
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
    res.status(500).json({ error: err.message });
  }
});

// ── GOOGLE LOGIN ─────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Credential requerido' });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email } = payload;

    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (user) {
      // Usuario existente — vincular googleId si no lo tiene y devolver token
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }

      const token = jwt.sign(
        { userId: user._id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      return res.json({ token, user: { id: user._id, username: user.username, email: user.email } });
    }

    // Usuario nuevo — pedir username al frontend
    return res.json({ needsUsername: true, email });

  } catch (err) {
    console.error('Google auth error:', err);
    res.status(401).json({ error: 'Token de Google inválido' });
  }
});

// ── GOOGLE COMPLETE (nuevo usuario elige username) ────────
router.post('/google/complete', async (req, res) => {
  try {
    const { credential, username } = req.body;
    if (!credential || !username)
      return res.status(400).json({ error: 'Faltan datos' });

    if (username.length < 3 || username.length > 10)
      return res.status(400).json({ error: 'El usuario debe tener entre 3 y 10 caracteres' });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email } = payload;

    const existingUsername = await User.findOne({ username });
    if (existingUsername)
      return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });

    const user = await User.create({ username, email, googleId, passwordHash: 'GOOGLE_AUTH' });

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

// ── VERIFICAR TOKEN ─────────────────────────────────────
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

// ── ELIMINAR CUENTA ─────────────────────────────────────
router.delete('/delete', auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    await User.findByIdAndDelete(userId);
    res.json({ message: 'Cuenta eliminada correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PERFIL PRIVADO ──────────────────────────────────────
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
      rank: rank + 1,
      last7: last7.reverse(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PERFIL PÚBLICO ──────────────────────────────────────
router.get('/profile/public/:username', async (req, res) => {
  try {
    const { username } = req.params;
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
      rank: rank + 1,
      last7: last7.reverse(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
