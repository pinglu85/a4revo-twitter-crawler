import mongoose from 'mongoose';

import Tweet from './models/Tweet.js';
import config from './config.js';

let lastTweetId = '';

async function fetchTweets(tweetQueue) {
  try {
    if (!lastTweetId) {
      await mongoose.connect(config.dbUrl, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });

      const tweets = await Tweet.find().sort({ tweetCreatedAt: -1 }).limit(1);

      lastTweetId = tweets[0].tweetId;
    }

    const params = {
      'media.fields':
        'type,url,alt_text,duration_ms,preview_image_url,public_metrics,variants',
      expansions: 'attachments.media_keys',
      'tweet.fields': 'attachments,created_at',
      max_results: 100,
      since_id: lastTweetId,
    };
    const searchParams = new URLSearchParams(params);

    const response = await fetch(
      `${config.twitterBaseUrl}?${searchParams.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.TWITTER_BEAR_TOKEN}`,
        },
      }
    );
    const result = await response.json();
    if (result && result.meta.result_count > 0) {
      addJobs(tweetQueue, result);
      lastTweetId = result.data[0].id;
    }
  } catch (error) {
    console.error(error);
  }
}

function addJobs(tweetQueue, result) {
  /**
   * interface Media {
   *   fileName: string;
   *   url: string;
   *   contentType: string;
   * }
   */
  const mediaKeyToMedia = new Map();

  if (result.includes?.media) {
    for (const data of result.includes.media) {
      let fileName = '';
      let url = '';
      let contentType = '';

      if (data.type === 'photo') {
        url = data.url;
        fileName = getImageFileName(data.url);
        const extension = fileName.split('.')[1];
        contentType = `image/${extension}`;
      } else {
        const mp4 = findLargestMp4(data.variants);
        fileName = getVideoFileName(mp4.url);
        url = mp4.url;
        contentType = 'video/mp4';
      }

      mediaKeyToMedia.set(data.media_key, { url, fileName, contentType });
    }
  }

  for (let i = result.data.length - 1; i >= 0; i--) {
    const tweet = result.data[i];
    const newTweet = {
      text: tweet.text,
      media: [],
      tweetId: tweet.id,
      tweetCreatedAt: tweet.created_at,
    };

    if (tweet.attachments && tweet.attachments.media_keys) {
      for (const mediaKey of tweet.attachments.media_keys) {
        if (mediaKeyToMedia.has(mediaKey)) {
          newTweet.media.push(mediaKeyToMedia.get(mediaKey));
        }
      }
    }

    tweetQueue.add(newTweet);
  }
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

export default fetchTweets;
