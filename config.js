import dotenv from 'dotenv';

dotenv.config();

export default {
  twitterBaseUrl:
    process.env.NODE_ENV === 'development'
      ? process.env.TWITTER_API_DEV
      : process.env.TWITTER_API_PROD,

  awsRegion: process.env.AWS_REGION,

  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,

  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,

  awsBucket:
    process.env.NODE_ENV === 'development'
      ? process.env.AWS_S3_BUCKET_DEV
      : process.env.AWS_S3_BUCKET_PROD,

  dbUrl:
    process.env.NODE_ENV === 'development'
      ? process.env.DATABASE_URL_DEV
      : process.env.DATABASE_URL_PROD,

  port: process.env.PORT || 8000,

  domain:
    process.env.NODE_ENV === 'development'
      ? 'http://localhost'
      : process.env.SERVER_DOMAIN,

  redisOptions:
    process.env.NODE_ENV === 'development'
      ? undefined
      : {
          port: process.env.REDIS_PORT_PROD,
          host: process.env.REDIS_HOST_PROD,
          username: process.env.REDIS_USER_PROD,
          password: process.env.REDIS_PASSWORD_PROD,
        },
};
