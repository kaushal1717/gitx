import { Router } from "express";
import {
  chunkText,
  generateEmbeddings,
  pc,
  storeEmbeddingsInPinecone,
  redis,
} from "./utils/helpers.js";
import { exec } from "child_process";
import { streamText } from "ai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { openai } from "@ai-sdk/openai";

const router = Router();

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
          return res
            .status(500)
            .json({
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
    // Step 1: Retrieve relevant code snippets from Pinecone
    const index = pc.index(projectName);
    const queryResponse = await index.query({
      vector: Array(3072).fill(0), // Placeholder vector (replace with proper embedding)
      topK: 5,
      includeMetadata: true,
    });

    const relevantDocs = queryResponse.matches
      .map((match) => match.metadata.content)
      .join("\n\n");

    if (!relevantDocs) {
      return res.status(404).json({ error: "No relevant code found" });
    }

    // Step 2: Stream AI-generated response using OpenAI & ai-sdk
    const responseStream = await streamText({
      model: openai("gpt-4o-mini"),
      messages: [
        {
          role: "system",
          content:
            "You are an AI assistant helping with code search. Provide concise and clear explanations in markdown format.",
        },
        {
          role: "user",
          content: `Based on the following code snippets, answer the question in markdown format:\n\n ${relevantDocs} \n\n **Question:** ${query}`,
        },
      ],
    });

    // Step 3: Stream response back to client
    responseStream
      .toTextStreamResponse({
        headers: { "Content-Type": "text/event-stream" },
      })
      .then((streamResponse) => {
        res
          .status(streamResponse.status)
          .set(streamResponse.headers)
          .send(streamResponse.body);
      });
  } catch (error) {
    console.error("❌ Query processing error:", error.message);
    return res.status(500).json({ error: "Failed to process query" });
  }
});

export default router;
