import { Router } from "express";
import {
  chunkText,
  generateEmbeddings,
  pc,
  storeEmbeddingsInPinecone,
  redis,
} from "./utils/helpers.js";
import { exec } from "child_process";
import { streamText, embed } from "ai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { openai } from "@ai-sdk/openai";

import { config } from "dotenv";

const router = Router();

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

router.post("/process", async (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl)
    return res.status(400).json({ error: "GitHub repo URL is required" });

  console.log("Processing repo:", repoUrl);
  const projectName = repoUrl.split("/")[4]; // Extracts project name from URL
  const outputFilePath = path.join(tempDir, `${projectName}-output.txt`);

  try {
    // Check if the index already exists in Redis
    let cached;
    try {
      cached = await redis.get(projectName);
    } catch (redisError) {
      console.warn(
        "⚠️ Redis lookup failed, skipping cache check:",
        redisError.message
      );
      cached = null; // If Redis fails, continue without caching
    }

    if (cached) {
      console.log(
        `✅ Cache hit: Embeddings for "${projectName}" exist, skipping creation.`
      );
      return res.json({
        success: true,
        message: "Embeddings already cached",
        status: 200,
      });
    }

    // Run Repomix to extract code summary
    exec(
      `npx repomix --remote ${repoUrl} -o ${outputFilePath}`,
      async (error, stdout, stderr) => {
        if (error) {
          console.error(
            "❌ Repomix execution failed:",
            stderr || error.message
          );
          return res.status(500).json({
            error: "Repomix failed",
            details: stderr || error.message,
          });
        }

        console.log("✅ Repomix completed. Generating embeddings...");

        if (!fs.existsSync(outputFilePath)) {
          return res.status(500).json({ error: "Output file was not created" });
        }

        try {
          const fileContent = fs.readFileSync(outputFilePath, "utf-8");

          // Split the text into chunks using LangChain
          const textChunks = await chunkText(fileContent);

          // Generate embeddings for each chunk
          const embeddingsArray = await generateEmbeddings(textChunks);

          // Store embeddings in Pinecone and cache the index in Redis
          await storeEmbeddingsInPinecone(projectName, embeddingsArray);

          // Delete local file
          fs.unlinkSync(outputFilePath);

          return res.json({
            success: true,
            message: "Processing complete",
            status: 200,
          });
        } catch (processingError) {
          console.error("❌ Processing error:", processingError.message);
          return res.status(500).json({ error: processingError.message });
        }
      }
    );
  } catch (error) {
    console.error("❌ Unexpected error:", error.message);
    return res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

router.post("/query", async (req, res) => {
  const { query, projectName } = req.body;
  if (!query || !projectName)
    return res
      .status(400)
      .json({ error: "Query and project name are required" });

  console.log(`🔍 Searching for: ${query} in project: ${projectName}`);
  try {
    // Step 1: Generate embedding for the query
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-large"),
      value: query,
    });
    console.log("Embedding:", embedding);

    // Step 2: Query Pinecone index
    const index = pc.index(projectName);
    const queryResponse = await index.query({
      vector: embedding,
      topK: 5,
      includeMetadata: true,
    });
    console.log("Query Response:", JSON.stringify(queryResponse, null, 2));

    // Step 3: Extract relevant documents from matches
    const matches = queryResponse.matches;
    if (!matches || matches.length === 0) {
      return res.status(404).json({ error: "No relevant code found" });
    }

    // Extract content from metadata (adjust based on actual structure)
    const relevantDocs = matches
      .map((match) => match.metadata?.text || "No content available")
      .join("\n\n");
    console.log("Relevant Docs:", relevantDocs);

    if (!relevantDocs.trim()) {
      return res.status(404).json({ error: "No relevant code found" });
    }

    // Step 4: Stream AI-generated response using OpenAI & ai-sdk
    const responseStream = streamText({
      model: openai("gpt-4o"),
      messages: [
        {
          role: "system",
          content:
            "You are an AI assistant helping with codebase exploration & explaination by providing relevant code snippets in proper markdown format and details. Provide concise and clear explanations in markdown format.",
        },
        {
          role: "user",
          content: `Based on the following code snippets, answer the question in markdown format:\n\n ${relevantDocs} \n\n **Question:** ${query}`,
        },
      ],
    });

    console.log(responseStream);

    // Return the streamed response
    return responseStream.pipeDataStreamToResponse(res);
  } catch (error) {
    console.error("❌ Query processing error:", error.message);
    return res.status(500).json({ error: "Failed to process query" });
  }
});

export default router;
