import { Pinecone } from "@pinecone-database/pinecone";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { config } from "dotenv";
import { Redis } from "@upstash/redis";
import { google } from "@ai-sdk/google";
import { embed } from "ai";

config();

export const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN,
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
      await redis.set(indexName, "cached", { ex: 3600 });
      console.log(`✅ Cached index "${indexName}" in Redis.`);
    } catch (redisError) {
      console.warn("⚠️ Failed to cache in Redis:", redisError.message);
    }
  } catch (error) {
    console.error("Error storing in Pinecone:", error.message);
    throw new Error("Failed to store embeddings in Pinecone");
  }
};

export const listen = async () => {
  try {
    console.log("🧹 Checking for expired Redis keys...");

    const allKeys = await redis.keys("*");

    if (!allKeys.length) {
      console.log("✅ No keys found in Redis.");
      return;
    }

    for (const key of allKeys) {
      const value = await redis.get(key);

      if (value === null) {
        console.log(
          `🗑️ Key "${key}" has expired, removing from Redis and Pinecone...`
        );

        await redis.del(key);

        try {
          const indexExists = (await pc.listIndexes()).indexes.some(
            (index) => index.name === key
          );

          if (indexExists) {
            await pc.deleteIndex(key);
            console.log(`✅ Deleted Pinecone index: "${key}"`);
          } else {
            console.log(`⚠️ Pinecone index "${key}" does not exist.`);
          }
        } catch (pineconeError) {
          console.error(
            `❌ Failed to delete Pinecone index "${key}":`,
            pineconeError.message
          );
        }
      }
    }

    console.log("✅ Cleanup cycle completed.");
  } catch (error) {
    console.error("❌ Redis cleanup error:", error.message);
  }
};

setInterval(() => {
  listen().catch((error) => console.error("❌ Error in listening:", error));
}, 30 * 60 * 1000);
