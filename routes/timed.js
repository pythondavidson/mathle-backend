const express = require('express');
const router  = express.Router();
const User    = require('../models/User');
const TimedScore = require('../models/TimedScore');
const auth    = require('../middleware/auth');

// POST /api/timed/score — requiere login
router.post('/score', auth, async (req, res) => {
  try {
    const { points } = req.body;
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const today = new Date().toISOString().split('T')[0];
    await TimedScore.create({ userId, date: today, points });

    user.totalTimedPoints = (user.totalTimedPoints || 0) + points;
    await user.save();

    res.status(201).json({ totalTimedPoints: user.totalTimedPoints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/timed/leaderboard?filter=hoy|semana|alltime
// Devuelve el RÉCORD (mejor partida), no la acumulación
router.get('/leaderboard', async (req, res) => {
  try {
    const { filter = 'alltime' } = req.query;
    const today = new Date().toISOString().split('T')[0];

    let dateFilter = {};
    if (filter === 'hoy') {
      dateFilter = { date: today };
    } else if (filter === 'semana') {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      dateFilter = { date: { $gte: weekAgo } };
    }
    // alltime: sin filtro de fecha

    const scores = await TimedScore.aggregate([
      { $match: { ...dateFilter } },
      // Récord: mejor puntuación individual, no suma
      { $group: { _id: '$userId', pts: { $max: '$points' } } },
      { $sort: { pts: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      { $project: { _id: 0, username: '$user.username', pts: 1, racha: '$user.streakDays' } },
    ]);

    res.json(scores);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
