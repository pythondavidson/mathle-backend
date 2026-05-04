const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Guardamos scores del contrareloj directamente en el usuario
// (no tiene fecha fija, se puede jugar varias veces al día)

// POST /api/timed/score — guardar puntuación del contrareloj
router.post('/score', async (req, res) => {
  try {
    const { userId, points } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    user.totalPoints += points;
    await user.save();

    res.status(201).json({ totalPoints: user.totalPoints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/timed/leaderboard — top 10 por puntos totales
router.get('/leaderboard', async (req, res) => {
  try {
    const users = await User.find()
      .sort({ totalPoints: -1 })
      .limit(10)
      .select('username totalPoints streakDays');

    const leaderboard = users.map((u, i) => ({
      pos: i + 1,
      username: u.username,
      pts: u.totalPoints,
      racha: u.streakDays,
    }));

    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
