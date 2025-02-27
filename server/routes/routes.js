import { Router } from "express";
import {
  chunkText,
  generateEmbeddings,
  openai,
  pc,
  storeEmbeddingsInPinecone,
} from "../utils/helpers";
import { exec } from "child_process";
import { OpenAIStream, StreamingTextResponse } from "ai";

const router = Router();

router.post("/process", (req, res) => {
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

router.post("/query", async (req, res) => {
  const { query, projectName } = req.body;
  if (!query || !projectName) {
    return res
      .status(400)
      .json({ error: "Query and project name are required" });
  }

  try {
    console.log(`🔍 Searching Pinecone for: "${query}"`);

    // Step 1: Generate embedding for query
    const queryEmbeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: query,
    });
    const queryEmbedding = queryEmbeddingResponse.data[0].embedding;

    const index = pc.index(projectName);
    const pineconeResults = await index.query({
      vector: queryEmbedding,
      topK: 5, // Retrieve top 5 most relevant chunks
      includeMetadata: true,
    });

    const retrievedTexts = pineconeResults.matches.map(
      (match) => match.metadata.text || "No relevant text found."
    );

    console.log(`✅ Retrieved ${retrievedTexts.length} relevant snippets`);

    const prompt = `
        The following are relevant code snippets from the project "${projectName}":
        ${retrievedTexts
          .map(
            (snippet, i) =>
              `### Snippet ${i + 1}:\n\`\`\`js\n${snippet}\n\`\`\``
          )
          .join("\n\n")}
  
        **User Query:** "${query}"
  
        **Instructions:** 
        - Answer in Markdown format.
        - If the answer contains code, format it using appropriate code blocks.
        - Keep explanations clear and concise.
      `;

    console.log(`⏳ Generating response using OpenAI...`);

    const stream = await OpenAIStream(openai.chat.completions.create, {
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are an AI assistant. Respond in Markdown format.",
        },
        { role: "user", content: prompt },
      ],
      stream: true,
    });

    return new StreamingTextResponse(stream, res);
  } catch (error) {
    console.error("Query processing error:", error.message);
    return res.status(500).json({ error: "Failed to process query" });
  }
});

export default router;
