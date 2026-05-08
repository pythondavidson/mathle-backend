const express = require('express');
const router = express.Router();
const DailyScore = require('../models/DailyScore');
const User = require('../models/User');
const auth = require('../middleware/auth');

// POST /api/daily/score — requiere login
router.post('/score', auth, async (req, res) => {
  try {
    const { date, attempts, points, won } = req.body;
    const userId = req.user.userId;

    const existing = await DailyScore.findOne({ userId, date });
    if (existing) return res.status(409).json({ error: 'Ya has jugado hoy' });

    const score = await DailyScore.create({ userId, date, attempts, points, won });

    const user = await User.findById(userId);
    if (user) {
      user.totalPoints += points;
      const yesterday = new Date(new Date(date) - 86400000).toISOString().split('T')[0];
      user.streakDays = won ? (user.lastPlayDate === yesterday ? user.streakDays + 1 : 1) : 0;
      user.lastPlayDate = date;
      await user.save();
    }

    res.status(201).json(score);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/daily/leaderboard?filter=hoy|semana|alltime
// Devuelve el RÉCORD (mejor partida), no la acumulación
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
    // alltime: sin filtro de fecha

    const scores = await DailyScore.aggregate([
      { $match: { won: true, ...dateFilter } },
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
