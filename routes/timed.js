const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

// POST /api/timed/score — requiere login
router.post('/score', auth, async (req, res) => {
  try {
    const { points } = req.body;
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    user.totalPoints += points;
    await user.save();

    res.status(201).json({ totalPoints: user.totalPoints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/timed/leaderboard — público
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
