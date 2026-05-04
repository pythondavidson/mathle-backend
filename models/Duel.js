const mongoose = require('mongoose');

const duelSchema = new mongoose.Schema({
  player1Id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  player2Id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  mode:      { type: String, enum: ['diario', 'contrareloj'], default: 'contrareloj' },
  winner:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  timestamp: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('Duel', duelSchema);
