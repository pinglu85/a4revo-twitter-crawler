import { createServer } from 'http';
import express from 'express';
import Queue from 'bull';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter.js';
import { ExpressAdapter } from '@bull-board/express';
import { ToadScheduler, SimpleIntervalJob, AsyncTask } from 'toad-scheduler';
import mongoose from 'mongoose';
import { Server } from 'socket.io';
import session from 'express-session';
import connectRedis from 'connect-redis';
import { createClient } from 'redis';
import passport from 'passport';
import passportLocal from 'passport-local';

import Admin from './models/Admin.js';
import Tweet from './models/Tweet.js';
import fetchTweets from './fetchTweets.js';
import uploadMediaToS3 from './uploadMediaToS3.js';
import ensureLoggedIn from './middleware/ensureLoggedIn.js';
import config from './config.js';

const NOTIFICATION_COUNT = 5;
let completedJobCount = 0;

const LocalStrategy = passportLocal.Strategy;

passport.use(
  new LocalStrategy(function (username, password, done) {
    Admin.findOne({ username }, async (error, admin) => {
      if (error) return done(error);

      if (!admin) return done(null, false);

      const result = await admin.verifyPassword(password);
      if (!result) return done(null, false);

      return done(null, admin);
    });
  })
);

passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

const RedisStore = connectRedis(session);

async function run() {
  await mongoose.connect(config.dbUrl, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const redisClient = new createClient({
    url: config.redisConnectionUrl,
    legacyMode: true,
  });

  redisClient.on('error', (error) => {
    console.error(`Redis Client Error: ${error}`);
  });

  await redisClient.connect();

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/ui');

  const sessionOptions = {
    store: new RedisStore({ client: redisClient }),
    secret: config.sessionSecret,
    cookie: {},
    saveUninitialized: false,
    resave: false,
  };

  // app.set('views', process.cwd() + '/views');
  app.set('view engine', 'ejs');

  if (app.get('env') === 'production') {
    app.set('trust proxy', 1); // trust first proxy
    sessionOptions.cookie.secure = true; // serve secure cookies
  }
  app.use(session(sessionOptions));
  app.use(express.urlencoded({ extended: false }));

  app.use(passport.initialize({}));
  app.use(passport.session({}));

  io.on('connection', (socket) => {
    console.log('on connection');

    socket.on('disconnect', () => {
      console.log('on disconnect');
    });
  });

  app.get('/ui/login', (req, res) => {
    res.render('login', { invalid: req.query.invalid === 'true' });
  });

  app.post(
    '/ui/login',
    passport.authenticate('local', {
      failureRedirect: '/ui/login?invalid=true',
    }),
    (_, res) => {
      res.redirect('/ui');
    }
  );

  const fetchTweetsScheduler = new ToadScheduler();
  const tweetQueue = new Queue('tweetQueue', config.redisConfig);

  // eslint-disable-next-line no-unused-vars
  const { addQueue, removeQueue } = createBullBoard({
    queues: [new BullAdapter(tweetQueue)],
    serverAdapter: serverAdapter,
  });

  app.use(
    '/ui',
    ensureLoggedIn({ redirectTo: '/ui/login' }),
    serverAdapter.getRouter()
  );

  const fetchTweetsTask = new AsyncTask(
    'fetch tweets',
    () => {
      return fetchTweets(tweetQueue);
    },
    (error) => {
      console.error(error);
    }
  );

  const fetchTweetJob = new SimpleIntervalJob(
    { seconds: 20, runImmediately: true },
    fetchTweetsTask,
    {
      id: 'id_1',
      preventOverrun: true,
    }
  );

  // create and start jobs
  fetchTweetsScheduler.addSimpleIntervalJob(fetchTweetJob);

  // Upload tweet media to s3
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

    const createdTweet = await Tweet.create(newTweet);

    completedJobCount++;
    if (completedJobCount === NOTIFICATION_COUNT) {
      io.emit('new tweets', { count: completedJobCount });
      completedJobCount = 0;
    }

    return createdTweet;
  });

  httpServer.listen(config.port, () => {
    console.log(`Running on ${config.port}...`);
    console.log(`For the UI, open ${config.domain}ui`);
    console.log('Make sure Redis is running on port 6379 by default');
  });
}

run().catch((error) => console.error(error));
