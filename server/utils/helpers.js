import { Pinecone } from "@pinecone-database/pinecone";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { config } from "dotenv";
import OpenAI from "openai";
import Redis from "ioredis";

config();

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

// Initialize Upstash Redis
export const redis = new Redis(process.env.UPSTASH_REDIS_URL);

// Function to split text into chunks
export const chunkText = async (text, chunkSize = 8000, chunkOverlap = 200) => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ["\n\n", "\n", " "], // Prioritize splitting at paragraphs, then lines, then words
  });

  return await splitter.createDocuments([text]);
};

// Function to generate embeddings using OpenAI
export const generateEmbeddings = async (textChunks) => {
  let embeddingsArray = [];

  for (let i = 0; i < textChunks.length; i++) {
    try {
      const response = await openai.embeddings.create({
        model: "text-embedding-3-large",
        input: textChunks[i].pageContent,
      });

      embeddingsArray.push({
        id: `chunk-${i}`,
        values: response.data[0].embedding,
        metadata: { chunk_index: i },
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

// Function to check and create Pinecone index
export const ensurePineconeIndex = async (indexName) => {
  try {
    const existingIndexes = await pc.listIndexes();
    const indexNames = existingIndexes.indexes.map((index) => index.name);

    if (!indexNames.includes(indexName)) {
      console.log(`Index "${indexName}" not found. Creating it...`);

      await pc.createIndex({
        name: indexName,
        dimension: 3072,
        metric: "cosine",
        spec: { serverless: { cloud: "aws", region: "us-east-1" } },
      });

      console.log(`✅ Pinecone index "${indexName}" created.`);
    } else {
      console.log(`✅ Pinecone index "${indexName}" already exists.`);
    }
  } catch (error) {
    console.error("Error ensuring Pinecone index:", error.message);
    throw new Error("Failed to create or find Pinecone index.");
  }
};

// Store embeddings in Pinecone with Redis caching
export const storeEmbeddingsInPinecone = async (indexName, embeddingsArray) => {
  try {
    const cachedIndex = await redis.get(indexName);

    if (cachedIndex) {
      console.log(`⚡ Cache hit: Skipping embedding for "${indexName}"`);
      return;
    }

    await ensurePineconeIndex(indexName);
    const index = pc.index(indexName);
    await index.upsert(embeddingsArray);

    console.log("✅ Embeddings stored in Pinecone.");

    // Cache index in Redis with a 5-minute expiration
    await redis.set(indexName, "cached", "EX", 300);
    console.log(`🟢 Cached index "${indexName}" in Redis.`);
  } catch (error) {
    console.error("Error storing in Pinecone:", error.message);
    throw new Error("Failed to store embeddings in Pinecone");
  }
};

// Cleanup function to remove expired embeddings
export const cleanupExpiredEmbeddings = async () => {
  try {
    console.log("🧹 Running cleanup for expired embeddings...");

    const storedIndexes = await redis.keys("*");

    for (const indexName of storedIndexes) {
      const exists = await redis.get(indexName);

      if (!exists) {
        console.log(`🚀 Deleting embeddings for expired index: ${indexName}`);

        try {
          const index = pc.index(indexName);
          await index.deleteAll();
          console.log(
            `✅ Deleted embeddings for "${indexName}" from Pinecone.`
          );
        } catch (pineconeError) {
          console.error(
            `❌ Error deleting embeddings for "${indexName}":`,
            pineconeError.message
          );
        }
      }
    }
  } catch (error) {
    console.error("❌ Cleanup process failed:", error.message);
  }
};

// Run cleanup every 1 minute
setInterval(cleanupExpiredEmbeddings, 60000);
