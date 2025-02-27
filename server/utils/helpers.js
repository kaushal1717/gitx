import { Pinecone } from "@pinecone-database/pinecone";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { config } from "dotenv";
import OpenAI from "openai";

config();

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

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
        model: "text-embedding-3-large", // Using latest OpenAI embedding model
        input: textChunks[i].pageContent, // Use chunked text content
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

export const ensurePineconeIndex = async (indexName) => {
  try {
    const existingIndexes = await pc.listIndexes();

    // Extract index names properly
    const indexNames = existingIndexes.indexes.map((index) => index.name);

    if (!indexNames.includes(indexName)) {
      console.log(`Index "${indexName}" not found. Creating it...`);

      await pc.createIndex({
        name: indexName,
        dimension: 3072, // Match OpenAI's "text-embedding-3-large"
        metric: "cosine",
        spec: {
          serverless: {
            cloud: "aws",
            region: "us-east-1", // Adjust to your Pinecone region
          },
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

// Store embeddings in Pinecone
export const storeEmbeddingsInPinecone = async (indexName, embeddingsArray) => {
  try {
    // Ensure the index exists before upserting
    await ensurePineconeIndex(indexName);

    const index = pc.index(indexName);
    await index.upsert(embeddingsArray);

    console.log("✅ Embeddings stored in Pinecone.");
  } catch (error) {
    console.error("Error storing in Pinecone:", error.message);
    throw new Error("Failed to store embeddings in Pinecone");
  }
};
