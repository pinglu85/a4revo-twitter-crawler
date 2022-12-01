import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

import config from './config.js';

const s3Client = new S3Client({
  region: config.awsRegion,
  credentials: {
    accessKeyId: config.awsAccessKeyId,
    secretAccessKey: config.awsSecretAccessKey,
  },
});

async function uploadMediaToS3(media) {
  const fetchPromises = new Array(media.length);

  for (let i = 0; i < media.length; i++) {
    const { url } = media[i];
    fetchPromises[i] = fetch(url);
  }

  const responses = await Promise.all(fetchPromises);
  const uploadPromises = new Array(media.length);

  for (let i = 0; i < responses.length; i++) {
    const { fileName, contentType } = media[i];
    const response = responses[i];

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
  return result.map((data) => data.Location);
}

function uploadStream(stream, fileName, contentType) {
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: config.awsBucket,
      Key: fileName,
      Body: stream,
      ContentType: contentType,
      ACL: 'public-read',
      queueSize: 5,
    },
  });

  return upload.done();
}

export default uploadMediaToS3;
