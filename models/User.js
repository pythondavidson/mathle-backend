const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username:          { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 10 },
  email:             { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash:      { type: String, default: null },
  googleId:          { type: String, default: null },
  totalPoints:       { type: Number, default: 0 },
  totalTimedPoints:  { type: Number, default: 0 },
  streakDays:        { type: Number, default: 0 },
  lastPlayDate:      { type: String, default: "" },
  duelWins:          { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
