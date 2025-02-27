import express from "express";
import cors from "cors";
import fs, { stat } from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import { config } from "dotenv";
import { Pinecone } from "@pinecone-database/pinecone";
import { OpenAI } from "openai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";

config();
const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// Function to chunk text using LangChain
const chunkText = async (text, chunkSize = 8000, chunkOverlap = 200) => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ["\n\n", "\n", " "], // Prioritize splitting at paragraphs, then lines, then words
  });

  return await splitter.createDocuments([text]);
};

// Function to generate embeddings using OpenAI
const generateEmbeddings = async (textChunks) => {
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

// Ensure Pinecone index exists
const ensurePineconeIndex = async (indexName) => {
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
const storeEmbeddingsInPinecone = async (indexName, embeddingsArray) => {
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

// Main process API
app.post("/process", (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl)
    return res.status(400).json({ error: "GitHub repo URL is required" });

  console.log("Processing repo:", repoUrl);
  const projectName = repoUrl.split("/")[4]; // Extracts project name from URL
  const outputFilePath = path.join(tempDir, `${projectName}-output.txt`);

  exec(
    `npx repomix --remote ${repoUrl} -o ${outputFilePath}`,
    async (error, stdout, stderr) => {
      if (error) {
        console.error("Repomix execution failed:", stderr || error.message);
        return res
          .status(500)
          .json({ error: "Repomix failed", details: stderr || error.message });
      }

      console.log("Repomix completed. Generating embeddings...");

      if (!fs.existsSync(outputFilePath)) {
        return res.status(500).json({ error: "Output file was not created" });
      }

      try {
        const fileContent = fs.readFileSync(outputFilePath, "utf-8");

        // Split the text into chunks using LangChain
        const textChunks = await chunkText(fileContent);

        // Generate embeddings for each chunk
        const embeddingsArray = await generateEmbeddings(textChunks);

        // Store embeddings in Pinecone
        await storeEmbeddingsInPinecone(projectName, embeddingsArray);

        // Delete local file
        fs.unlinkSync(outputFilePath);

        return res.json({
          success: true,
          message: "Processing complete",
          status: 200,
        });
      } catch (processingError) {
        console.error("Processing error:", processingError.message);
        return res.status(500).json({ error: processingError.message });
      }
    }
  );
});

app.listen(5001, () => console.log("✅ Server running on port 5001"));
