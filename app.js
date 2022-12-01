import { createServer } from 'http';
import express from 'express';
import Queue from 'bull';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter.js';
import { ExpressAdapter } from '@bull-board/express';
import { ToadScheduler, SimpleIntervalJob, AsyncTask } from 'toad-scheduler';
import mongoose from 'mongoose';
import { Server } from 'socket.io';

import Tweet from './models/Tweet.js';
import fetchTweets from './fetchTweets.js';
import uploadMediaToS3 from './uploadMediaToS3.js';
import config from './config.js';

const fetchTweetsScheduler = new ToadScheduler();
const tweetQueue = new Queue('tweetQueue', config.redisOptions);

const fetchTweetsTask = new AsyncTask(
  'fetch tweets',
  () => {
    return fetchTweets(tweetQueue);
  },
  (error) => {
    console.error(error);
  }
);

const job = new SimpleIntervalJob(
  { seconds: 20, runImmediately: true },
  fetchTweetsTask,
  {
    id: 'id_1',
    preventOverrun: true,
  }
);

//create and start jobs
fetchTweetsScheduler.addSimpleIntervalJob(job);

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

// eslint-disable-next-line no-unused-vars
const { addQueue, removeQueue } = createBullBoard({
  queues: [new BullAdapter(tweetQueue)],
  serverAdapter: serverAdapter,
});

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

io.on('connection', (socket) => {
  console.log('onConnection');

  socket.on('disconnect', () => {
    console.log('onDisconnect');
  });
});

const NOTIFICATION_COUNT = 5;
let completedJobCount = 0;

tweetQueue.process(async (job) => {
  const { data } = job;

  const newTweet = {
    text: data.text,
    media: [],
    tweetId: data.tweetId,
    tweetCreatedAt: data.tweetCreatedAt,
  };

  if (data.media.length > 0) {
    newTweet.media = await uploadMediaToS3(data.media);
  }

  await mongoose.connect(config.dbUrl, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  await Tweet.create(newTweet);

  completedJobCount++;
  if (completedJobCount === NOTIFICATION_COUNT) {
    io.emit('new tweets', { count: NOTIFICATION_COUNT });
    completedJobCount = 0;
  }
});

app.use('/admin/queues', serverAdapter.getRouter());

httpServer.listen(config.port, () => {
  console.log(`Running on ${config.port}...`);
  console.log(`For the UI, open ${config.domain}:${config.port}/admin/queues`);
  console.log('Make sure Redis is running on port 6379 by default');
});
