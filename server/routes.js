import { Router } from "express";
import {
  chunkText,
  generateEmbeddings,
  pc,
  storeEmbeddingsInPinecone,
  redis,
  UploadToS3,
  getPresignedUrl,
  checkFileExists,
} from "./utils/helpers.js";
import { exec } from "child_process";
import { streamText, embed } from "ai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "@ai-sdk/google";

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
  const userName = repoUrl.split("/")[3];
  const projectName = repoUrl.split("/")[4]; // Extracts project name from URL
  const outputFilePath = path.join(
    tempDir,
    `${userName}-${projectName}-output.txt`
  );

  const key = `${userName}-${projectName}`;

  try {
    // Check if the index already exists in Redis
    let cached;
    try {
      cached = await redis.get(key);
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
          await storeEmbeddingsInPinecone(key, embeddingsArray);

          const uploadResult = await UploadToS3(outputFilePath);

          if (!uploadResult.success) {
            return res.json({
              success: false,
              message: uploadResult.message,
              status: 400,
            });
          }
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
  const { query, projectName, userName } = req.body;
  const key = `${userName}-${projectName}`;
  if (!query || !projectName)
    return res
      .status(400)
      .json({ error: "Query and project name are required" });

  console.log(`🔍 Searching for: ${query} in project: ${projectName}`);

  try {
    // Step 1: Check if the Pinecone index exists
    const existingIndexes = await pc.listIndexes();
    const indexNames = existingIndexes.indexes.map((index) => index.name);

    if (!indexNames.includes(key)) {
      console.warn(`🚨 Index "${key}" not found. Ending session.`);
      return res.status(307).json({
        redirect: "/", // Redirect to homepage
        message: "Session expired. Redirecting to home page.",
      });
    }

    // Step 2: Generate embedding for the query
    const { embedding } = await embed({
      model: google.textEmbeddingModel("text-embedding-004"),
      value: query,
    });

    console.log("Embedding:", embedding);

    // Step 3: Query Pinecone index
    const index = pc.index(key);
    const queryResponse = await index.query({
      vector: embedding,
      topK: 5,
      includeMetadata: true,
    });

    console.log("Query Response:", JSON.stringify(queryResponse, null, 2));

    // Step 4: Extract relevant documents
    const matches = queryResponse.matches;
    if (!matches || matches.length === 0) {
      return res.status(404).json({ error: "No relevant code found" });
    }

    const relevantDocs = matches
      .map((match) => match.metadata?.text || "No content available")
      .join("\n\n");

    if (!relevantDocs.trim()) {
      return res.status(404).json({ error: "No relevant code found" });
    }

    // Step 5: Stream AI-generated response
    const responseStream = streamText({
      model: google("gemini-2.0-flash-001"),
      messages: [
        {
          role: "system",
          content:
            "You are an AI assistant helping with codebase exploration & explanation. Provide concise and clear explanations in proper markdown format.",
        },
        {
          role: "user",
          content: `Based on the following code snippets, answer the question in markdown format:\n\n ${relevantDocs} \n\n **Question:** ${query}`,
        },
      ],
    });

    console.log(responseStream);
    return responseStream.pipeDataStreamToResponse(res);
  } catch (error) {
    console.error("❌ Query processing error:", error.message);
    return res.status(500).json({ error: "Failed to process query" });
  }
});

router.get("/get-url", async (req, res) => {
  try {
    const { fileName } = req.query; // Expecting fileName as query param

    if (!fileName) {
      return res.status(400).json({ error: "fileName is required" });
    }
    const checkFile = await checkFileExists(fileName);
    if (!checkFile) {
      console.log("File does not exist in bucket");
      return res.status(400).json({ error: "file does not exist in bucket" });
    }

    const url = await getPresignedUrl(fileName);
    res.json({ url });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
