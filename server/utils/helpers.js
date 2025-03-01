import { Pinecone } from "@pinecone-database/pinecone";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { config } from "dotenv";
import { Redis } from "@upstash/redis";
import { google } from "@ai-sdk/google";
import { embed } from "ai";
import {
  S3,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
config();

export const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN,
});

const s3 = new S3({
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
  region: "ap-south-1",
});

export const chunkText = async (text, chunkSize = 8000, chunkOverlap = 200) => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ["\n\n", "\n", " "],
  });

  return await splitter.createDocuments([text]);
};

export const generateEmbeddings = async (textChunks) => {
  let embeddingsArray = [];

  for (let i = 0; i < textChunks.length; i++) {
    try {
      const { embedding } = await embed({
        model: google.textEmbeddingModel("text-embedding-004"),
        value: textChunks[i].pageContent,
      });

      embeddingsArray.push({
        id: `chunk-${i}`,
        values: embedding,
        metadata: { chunk_index: i, text: textChunks[i].pageContent },
      });
    } catch (error) {
      console.error(
        `Error generating embeddings for chunk ${i}:`,
        error.message
      );
      throw new Error("Failed to generate embeddings");
    }
  }
  return embeddingsArray;
};

export const ensurePineconeIndex = async (indexName) => {
  try {
    const existingIndexes = await pc.listIndexes();
    const indexNames = existingIndexes.indexes.map((index) => index.name);

    if (!indexNames.includes(indexName)) {
      console.log(`Index "${indexName}" not found. Creating it...`);

      await pc.createIndex({
        name: indexName,
        dimension: 768,
        metric: "cosine",
        spec: {
          serverless: { cloud: "aws", region: "us-east-1" },
        },
      });

      console.log(`✅ Pinecone index "${indexName}" created successfully.`);
    } else {
      console.log(`✅ Pinecone index "${indexName}" already exists.`);
    }
  } catch (error) {
    console.error("Error ensuring Pinecone index:", error.message);
    throw new Error("Failed to create or find Pinecone index.");
  }
};

export const storeEmbeddingsInPinecone = async (indexName, embeddingsArray) => {
  try {
    await ensurePineconeIndex(indexName);

    const index = pc.index(indexName);
    await index.upsert(embeddingsArray);

    console.log("✅ Embeddings stored in Pinecone.");

    try {
      await redis.set(indexName, "cached");
      console.log(`✅ Cached index "${indexName}" in Redis.`);
    } catch (redisError) {
      console.warn("⚠️ Failed to cache in Redis:", redisError.message);
    }
  } catch (error) {
    console.error("Error storing in Pinecone:", error.message);
    throw new Error("Failed to store embeddings in Pinecone");
  }
};

export const UploadToS3 = async (filePath) => {
  const fileStream = fs.createReadStream(filePath);
  const params = {
    Bucket: process.env.BUCKET_NAME,
    Key: path.basename(filePath),
    Body: fileStream,
  };

  try {
    const command = new PutObjectCommand(params);
    await s3.send(command);
    return { success: true, message: "File uploaded successfully" };
  } catch (error) {
    console.error("❌ Error uploading file to S3:", error.message);
    return { success: false, message: "Failed to upload file" };
  }
};

export const getPresignedUrl = async (fileName) => {
  const command = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: fileName,
  });

  const signedUrl = await getSignedUrl(s3, command, {
    expiresIn: 60 * 60, // 1 hour
  });

  return signedUrl;
};

export const checkFileExists = async (fileName) => {
  try {
    const command = new HeadObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: fileName,
    });

    await s3.send(command); // If the file exists, this will succeed
    return true;
  } catch (error) {
    if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 403) {
      return false;
    }

    throw error;
  }
};
