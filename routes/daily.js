const express = require('express');
const router = express.Router();
const DailyScore = require('../models/DailyScore');
const User = require('../models/User');

// POST /api/daily/score — guardar resultado del juego diario
router.post('/score', async (req, res) => {
  try {
    const { userId, date, attempts, points, won } = req.body;

    // Evitar duplicados (un score por día por usuario)
    const existing = await DailyScore.findOne({ userId, date });
    if (existing) {
      return res.status(409).json({ error: 'Ya has jugado hoy' });
    }

    const score = await DailyScore.create({ userId, date, attempts, points, won });

    // Actualizar puntos totales y racha del usuario
    const user = await User.findById(userId);
    if (user) {
      user.totalPoints += points;

      const today = date;
      const yesterday = new Date(new Date(date) - 86400000).toISOString().split('T')[0];

      if (won) {
        user.streakDays = user.lastPlayDate === yesterday ? user.streakDays + 1 : 1;
      } else {
        user.streakDays = 0;
      }
      user.lastPlayDate = today;
      await user.save();
    }

    res.status(201).json(score);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/daily/leaderboard?filter=hoy|semana|alltime
router.get('/leaderboard', async (req, res) => {
  try {
    const { filter = 'hoy' } = req.query;
    const today = new Date().toISOString().split('T')[0];

    let dateFilter = {};
    if (filter === 'hoy') {
      dateFilter = { date: today };
    } else if (filter === 'semana') {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      dateFilter = { date: { $gte: weekAgo } };
    }
    // alltime → sin filtro de fecha

    const scores = await DailyScore.aggregate([
      { $match: { won: true, ...dateFilter } },
      { $group: { _id: '$userId', pts: { $sum: '$points' } } },
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
