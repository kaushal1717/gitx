import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import { S3, PutObjectCommand } from "@aws-sdk/client-s3";
import { config } from "dotenv";

config();
const app = express();
app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const s3Client = new S3({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

// Ensure temp directory exists
const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

app.post("/process", (req, res) => {
  const { repoUrl } = req.body;
  if (!repoUrl)
    return res.status(400).json({ error: "GitHub repo URL is required" });

  console.log("Processing repo:", repoUrl);

  const outputFilePath = path.join(
    tempDir,
    `${repoUrl.split("/")[3]}-${repoUrl.split("/")[4]}-output.txt`
  );

  exec(
    `npx repomix --remote ${repoUrl} -o ${outputFilePath}`,
    async (error, stdout, stderr) => {
      if (error) {
        console.error("Repomix execution failed:", stderr || error.message);
        return res
          .status(500)
          .json({ error: "Repomix failed", details: stderr || error.message });
      }

      console.log("Repomix completed. Uploading file to S3...");

      // Ensure the file exists before uploading
      if (!fs.existsSync(outputFilePath)) {
        return res.status(500).json({ error: "Output file was not created" });
      }

      try {
        const fileStream = fs.createReadStream(outputFilePath);
        const uploadParams = {
          Bucket: process.env.BUCKET_NAME,
          Key: path.basename(outputFilePath),
          Body: fileStream,
        };

        const command = new PutObjectCommand(uploadParams);
        await s3Client.send(command);

        console.log("File uploaded successfully to S3");
        fs.unlinkSync(outputFilePath);
        return res.json({ success: true, outputFile: outputFilePath });
      } catch (uploadError) {
        console.error("S3 Upload failed:", uploadError.message);
        return res
          .status(500)
          .json({ error: "S3 Upload failed", details: uploadError.message });
      }
    }
  );
});

app.listen(5001, () => console.log("✅ Server running on port 5001"));
