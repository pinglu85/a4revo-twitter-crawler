import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { ToadScheduler, SimpleIntervalJob, AsyncTask } from 'toad-scheduler';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import Tweet from './models/Tweet.js';

dotenv.config();

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const scheduler = new ToadScheduler();

const task = new AsyncTask(
  'fetch tweets',
  () => {
    return fetchTweets();
  },
  (error) => {
    console.error(error);
  }
);

const job = new SimpleIntervalJob({ minutes: 5, runImmediately: true }, task);

//create and start jobs
scheduler.addSimpleIntervalJob(job);

async function fetchTweets() {
  try {
    await mongoose.connect(process.env.DATABASE_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    const tweets = await Tweet.find().sort({ tweetCreatedAt: -1 }).limit(1);
    const sinceId = tweets.length === 0 ? '' : tweets[0].id;

    const { data, includes, meta } = await getTweets(sinceId);
    const mediaKeyToS3Url = await uploadMediaToS3(includes.media);

    const newTweets = [];
    for (const tweet of data) {
      const newTweet = {
        text: tweet.text,
        media: [],
        tweetId: tweet.id,
        tweetCreatedAt: tweet.created_at,
      };

      if (tweet.attachments && tweet.attachments.media_keys) {
        for (const mediaKey of tweet.attachments.media_keys) {
          if (mediaKeyToS3Url.has(mediaKey)) {
            newTweet.media.push(mediaKeyToS3Url.get(mediaKey));
          }
        }
      }

      newTweets.push(newTweet);
    }

    await Tweet.insertMany(newTweets);

    if (!meta.next_token) {
      scheduler.stop();
      process.exit(22);
    }
  } catch (error) {
    console.error(error);
  }
}

const URL = 'https://api.twitter.com/2/users/1260553941714186241/tweets';
const params = {
  'media.fields':
    'type,url,alt_text,duration_ms,preview_image_url,public_metrics,variants',
  expansions: 'attachments.media_keys',
  'tweet.fields': 'attachments,created_at',
  max_results: 5,
};
const searchParams = new URLSearchParams(params);

async function getTweets(sinceId) {
  if (!sinceId) {
    const startTime = '2022-11-25T00:00:00Z';
    searchParams.append('start_time', startTime);
  } else {
    searchParams.append('since_id', sinceId);
  }

  try {
    const response = await fetch(`${URL}?${searchParams.toString()}`, {
      headers: {
        Authorization: `Bearer ${process.env.TWITTER_BEAR_TOKEN}`,
      },
    });
    return response.json();
  } catch (error) {
    console.error(error);
  }
}

async function uploadMediaToS3(media) {
  const fetchPromises = new Array(media.length);

  for (let i = 0; i < media.length; i++) {
    const data = media[i];
    let url = data.url;

    if (data.type === 'video') {
      const mp4 = findLargestMp4(data.variants);
      url = mp4.url;
    }

    fetchPromises[i] = fetch(url);
  }

  try {
    const responses = await Promise.all(fetchPromises);
    const uploadPromises = new Array(media.length);

    for (let i = 0; i < responses.length; i++) {
      const data = media[i];
      const response = responses[i];
      let fileName = '';
      let contentType = '';

      if (data.type === 'photo') {
        fileName = getImageFileName(data.url);
        const extension = fileName.split('.')[1];
        contentType = `image/${extension}`;
      } else {
        const mp4 = findLargestMp4(data.variants);
        fileName = getVideoFileName(mp4.url);
        contentType = 'video/mp4';
      }

      const reader = response.body.getReader();

      // eslint-disable-next-line no-undef
      const stream = new ReadableStream({
        start(controller) {
          return pump();

          function pump() {
            return reader.read().then(({ done, value }) => {
              // When no more data needs to be consumed, close the stream
              if (done) {
                controller.close();
                return;
              }
              // Enqueue the next data chunk into our target stream
              controller.enqueue(value);
              return pump();
            });
          }
        },
      });

      uploadPromises[i] = uploadStream(stream, fileName, contentType);
    }

    const result = await Promise.all(uploadPromises);
    const mediaKeyToS3Url = new Map();

    for (let i = 0; i < media.length; i++) {
      mediaKeyToS3Url.set(media[i].media_key, result[i].Location);
    }

    return mediaKeyToS3Url;
  } catch (error) {
    console.error(error);
  }
}

function uploadStream(stream, fileName, contentType) {
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: fileName,
      Body: stream,
      ContentType: contentType,
      ACL: 'public-read',
      queueSize: 10,
    },
  });

  return upload.done();
}

function getImageFileName(url) {
  const lastSlashIndex = url.lastIndexOf('/');
  return url.slice(lastSlashIndex + 1);
}

function getVideoFileName(url) {
  const lastSlashIndex = url.lastIndexOf('/');
  const indexOfMp4 = url.indexOf('.mp4');
  return url.slice(lastSlashIndex + 1, indexOfMp4 + 4);
}

function findLargestMp4(variants) {
  const mp4s = variants.filter(
    (variant) => variant.content_type === 'video/mp4'
  );
  let largestMp4 = mp4s[0];

  for (let i = 1; i < mp4s.length; i++) {
    if (mp4s[i].bit_rate > largestMp4.bit_rate) {
      largestMp4 = mp4s[i];
    }
  }

  return largestMp4;
}
