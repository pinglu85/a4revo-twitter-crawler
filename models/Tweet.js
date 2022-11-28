import mongoose from 'mongoose';

const tweetSchema = new mongoose.Schema(
  {
    text: String,
    media: [String],
    tweetId: { type: String, unique: true },
    tweetCreatedAt: Date,
  },
  { timestamps: true }
);

const Tweet = mongoose.model('Tweet', tweetSchema);

export default Tweet;
